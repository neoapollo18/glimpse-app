import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { findShopByDomain } from "../lib/supabase.server";
import { checkRateLimits, RATE_LIMITS } from "../lib/rate-limiter.server";
import { isClaudeConfigured } from "../lib/claude.server";
import { generateQuizConfig, type BrandBrief } from "../lib/quiz-generator.server";
import { recordGenStart, recordGenHeartbeat, recordGenOutcome } from "../lib/gen-status.server";

// AI quiz generation endpoint (admin-authenticated, NOT storefront).
// Streams SSE progress events; the client uses fetch + a stream reader
// (EventSource can't POST with App Bridge session tokens).
//
// Events: {type:"progress", phase} | {type:"result", summary, warnings}
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
    return json({ ok: false, error: "AI quiz creation is not configured (missing ANTHROPIC_API_KEY)." }, { status: 503 });
  }

  // Atomic across both windows: a blocked request must not burn the sibling
  // window's quota (retrying while hourly-blocked used to drain the day).
  const limit = checkRateLimits([
    { key: `quiz-generate:shop:${shopDomain}:hour`, limit: RATE_LIMITS.QUIZ_GENERATE_PER_SHOP_HOUR.limit, windowMs: RATE_LIMITS.QUIZ_GENERATE_PER_SHOP_HOUR.windowMs },
    { key: `quiz-generate:shop:${shopDomain}:day`, limit: RATE_LIMITS.QUIZ_GENERATE_PER_SHOP_DAY.limit, windowMs: RATE_LIMITS.QUIZ_GENERATE_PER_SHOP_DAY.windowMs },
  ]);
  if (!limit.allowed) {
    const retryAfterSeconds = limit.retryAfterSeconds;
    const wait =
      retryAfterSeconds > 7200
        ? `${Math.ceil(retryAfterSeconds / 3600)} hours`
        : `${Math.ceil(retryAfterSeconds / 60)} minutes`;
    return json({ ok: false, error: `Generation limit reached. Try again in ${wait}.`, retryAfterSeconds }, { status: 429 });
  }

  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  // v2 spec Part 0.1 (failure 4): generation consumes ONLY machine-derived
  // inputs. category/brandVoice arrive from the Brand Profile (the build
  // screen posts profile.category/profile.tone) and the generator re-derives
  // them server-side anyway; the old free-text extraNotes field is gone.
  // The only merchant free text allowed near generation is the scope
  // product filter below - and that is scope, not brief.
  const brief: BrandBrief = {
    category: String(formData.get("category") ?? "").slice(0, 200) || "beauty products",
    brandVoice: String(formData.get("brandVoice") ?? "").slice(0, 400) || "warm and confident",
    quizLength: formData.get("quizLength") === "short" ? "short" : "standard",
    modePreference: (["matrix", "ai", "hybrid"] as const).find((m) => m === formData.get("modePreference")) ?? "auto",
  };
  // Overhaul Part 3 scope: product subset from the install-flow scope
  // screen. scopeProductIds is a JSON array of gleame product uuids.
  const scopeKind = String(formData.get("scopeKind") ?? "");
  if (["all", "collection", "type", "tag", "freetext"].includes(scopeKind)) {
    let ids: string[] | null = null;
    try {
      const parsed = JSON.parse(String(formData.get("scopeProductIds") ?? "null"));
      if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === "string").slice(0, 5000);
    } catch {
      /* whole catalog */
    }
    brief.scope = {
      kind: scopeKind as NonNullable<BrandBrief["scope"]>["kind"],
      label: String(formData.get("scopeLabel") ?? "").slice(0, 120),
      productIds: scopeKind === "all" ? null : ids,
    };
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Enqueue throws once the client disconnects. Generation must SURVIVE
      // that (the Opus call is paid for and the draft save comes after the
      // last progress event) — swallow send failures instead of letting them
      // propagate into generateQuizConfig.
      let closed = false;
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(sse(data));
        } catch {
          closed = true;
        }
      };
      // Outcome is ALSO recorded server-side: when the stream cuts, the
      // wizard's watch mode reads it from the studio loader — otherwise a
      // post-cut failure left the merchant watching a bar for the full
      // watch budget, and post-cut warnings were silently dropped. The
      // token scopes heartbeat/outcome writes to THIS run so concurrent
      // runs for one shop can't cross-talk status.
      const genToken = recordGenStart(shop.id);
      // Heartbeats keep Render's proxy from idling out the connection, and
      // keep the server-side status fresh so watch mode can tell a live
      // generation from one that died without recording an outcome.
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat" });
        recordGenHeartbeat(shop.id, genToken);
      }, 10_000);

      try {
        const result = await generateQuizConfig({
          shopId: shop.id,
          shopDomain,
          brief,
          accentColor: String(formData.get("accentColor") ?? "") || null,
          onProgress: (phase, streamed) => send({ type: "progress", phase, streamed }),
        });
        if (result.ok) {
          recordGenOutcome(shop.id, genToken, { warnings: result.warnings });
          send({ type: "result", summary: result.summary, warnings: result.warnings });
        } else {
          recordGenOutcome(shop.id, genToken, { error: result.error, warnings: result.warnings });
          send({ type: "error", error: result.error, warnings: result.warnings });
        }
      } catch (err) {
        console.error("[quiz-generate] failed:", err);
        recordGenOutcome(shop.id, genToken, { error: err instanceof Error ? err.message : "Generation failed" });
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
