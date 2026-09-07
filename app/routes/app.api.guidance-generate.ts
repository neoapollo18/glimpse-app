import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { findShopByDomain, upsertQuestionGuidance } from "../lib/supabase.server";
import { checkRateLimits, RATE_LIMITS } from "../lib/rate-limiter.server";
import { isClaudeConfigured } from "../lib/claude.server";
import { generateGuidance } from "../lib/guidance-generator.server";
import { getQuizDraft, saveQuizDraft, type QuizDraft } from "../lib/quiz-draft.server";
import { withShopSaveLock } from "../lib/shop-save-lock.server";
import { APPLIERS, type DraftShape } from "../lib/quiz-copilot-tools.server";
import { loadCatalogForShop } from "../lib/quiz-generator.server";

// Recommendation-logic guidance compiler endpoint (admin-authenticated, NOT
// storefront). Streams SSE progress; the client uses fetch + a stream reader
// (EventSource can't POST with App Bridge session tokens).
//
// Generation saves NOTHING while the client is connected — the result event
// carries the compiled guidance back to the logic page for merchant review;
// applying it is a separate explicit action there. EXCEPTION: if the stream
// cut before the result could be delivered, the paid Opus output would be
// discarded, so a draft-sourced compile lands in the draft's ai_guidance
// (same destination as the explicit apply, ranking mode untouched) and the
// Logic page surfaces it on reload.
//
// Events: {type:"progress", phase}
//       | {type:"result", guidanceText, perQuestionSummary, warnings}
//       | {type:"error", error} | {type:"heartbeat"}

export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response("Method Not Allowed", { status: 405 });
};

const encoder = new TextEncoder();
const sse = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

export const action = async ({ request }: ActionFunctionArgs) => {
  let session;
  try {
    ({ session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) {
      return json({ ok: false, error: "Session expired. Please reload." }, { status: 401 });
    }
    throw err;
  }
  const shopDomain = session.shop;
  // Resource routes never run app.tsx's loader, so its billing gate does
  // not cover them; without this an unsubscribed shop can drive paid work.
  if (await shopNeedsBilling(shopDomain, session.accessToken ?? "")) {
    return json({ ok: false, error: "Your Gleame subscription isn't active. Visit Billing to continue." }, { status: 402 });
  }

  if (!isClaudeConfigured()) {
    return json(
      { ok: false, error: "AI generation isn't set up for this installation. Contact Gleame support." },
      { status: 503 },
    );
  }

  // Atomic across both windows: a blocked request must not burn the sibling
  // window's quota (see checkRateLimits).
  const limit = checkRateLimits([
    {
      key: `guidance-generate:shop:${shopDomain}:hour`,
      limit: RATE_LIMITS.GUIDANCE_GENERATE_PER_SHOP_HOUR.limit,
      windowMs: RATE_LIMITS.GUIDANCE_GENERATE_PER_SHOP_HOUR.windowMs,
    },
    {
      key: `guidance-generate:shop:${shopDomain}:day`,
      limit: RATE_LIMITS.GUIDANCE_GENERATE_PER_SHOP_DAY.limit,
      windowMs: RATE_LIMITS.GUIDANCE_GENERATE_PER_SHOP_DAY.windowMs,
    },
  ]);
  if (!limit.allowed) {
    const retryAfterSeconds = limit.retryAfterSeconds;
    const wait =
      retryAfterSeconds > 7200
        ? `${Math.ceil(retryAfterSeconds / 3600)} hours`
        : `${Math.ceil(retryAfterSeconds / 60)} minutes`;
    return json(
      {
        ok: false,
        error: `Generation limit reached. Try again in ${wait}. Use Save notes to keep your edits meanwhile.`,
        retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  // Generate implicitly saves the notes it was asked to compile — otherwise
  // a merchant could edit a box, hit Generate, and get output built from
  // stale DB notes. Presence-guarded: only keys submitted by the form are
  // touched.
  const formData = await request.formData();
  // Studio compiles against the DRAFT flow; the legacy logic page (and any
  // caller omitting the field) stays on live.
  const source = formData.get("source") === "draft" ? ("draft" as const) : ("live" as const);
  const NOTE_KEY_RE = /^[a-z_][a-z0-9_]*$/;
  for (const [field, value] of formData.entries()) {
    if (!field.startsWith("notes:") || typeof value !== "string") continue;
    const axisKey = field.slice("notes:".length);
    if (!NOTE_KEY_RE.test(axisKey)) continue;
    const saved = await upsertQuestionGuidance(shop.id, axisKey, value.slice(0, 4000));
    if (!saved.ok) {
      return json({ ok: false, error: `Couldn't save your notes: ${saved.error}` }, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Enqueue throws once the client disconnects. The Opus call is paid
      // for either way — swallow send failures instead of letting them
      // propagate into generateGuidance.
      let closed = false;
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(sse(data));
        } catch {
          closed = true;
        }
      };
      // Heartbeats keep Render's proxy from idling out the connection.
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10_000);

      try {
        const result = await generateGuidance({
          shopId: shop.id,
          shopDomain,
          source,
          onProgress: (phase, streamed) => send({ type: "progress", phase, streamed }),
        });
        if (result.ok) {
          send({
            type: "result",
            guidanceText: result.guidanceText,
            perQuestionSummary: result.perQuestionSummary,
            warnings: result.warnings,
          });
          // Stream-cut recovery: `closed` here means the result was never
          // delivered — without a save the paid compile is discarded and a
          // rate-limit slot is burned for nothing. Land it in the draft so
          // the Logic page's "draft already has recommendation logic"
          // banner picks it up on reload. Connected clients keep the
          // review-then-apply contract untouched.
          if (closed && source === "draft" && result.guidanceText) {
            const guidanceText = result.guidanceText;
            try {
              const saved = await withShopSaveLock(shop.id, async () => {
                const draft = await getQuizDraft(shop.id);
                if (!draft) return { ok: false as const, error: "no draft to save into" };
                const catalog = await loadCatalogForShop(shop.id);
                const applied = APPLIERS.update_guidance(draft as DraftShape, { aiGuidance: guidanceText }, catalog);
                if (!applied.ok) return { ok: false as const, error: applied.error };
                return saveQuizDraft(shop.id, applied.draft as QuizDraft, "manual");
              });
              if (!saved.ok) {
                console.warn(`[guidance-generate] stream cut; recovery save to draft failed for ${shopDomain}: ${saved.error}`);
              } else {
                console.log(`[guidance-generate] stream cut; compiled guidance saved to draft for ${shopDomain}`);
              }
            } catch (saveErr) {
              console.warn(`[guidance-generate] stream cut; recovery save to draft failed for ${shopDomain}:`, saveErr);
            }
          }
        } else {
          send({ type: "error", error: result.error, warnings: result.warnings });
        }
      } catch (err) {
        console.error("[guidance-generate] failed:", err);
        send({ type: "error", error: err instanceof Error ? err.message : "Generation failed" });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed by the client disconnect
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};
