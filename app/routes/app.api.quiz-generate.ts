import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { findShopByDomain } from "../lib/supabase.server";
import { checkRateLimit, RATE_LIMITS } from "../lib/rate-limiter.server";
import { isClaudeConfigured } from "../lib/claude.server";
import { generateQuizConfig, type BrandBrief } from "../lib/quiz-generator.server";

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

  const hourly = checkRateLimit(`quiz-generate:shop:${shopDomain}:hour`, RATE_LIMITS.QUIZ_GENERATE_PER_SHOP_HOUR.limit, RATE_LIMITS.QUIZ_GENERATE_PER_SHOP_HOUR.windowMs);
  const daily = checkRateLimit(`quiz-generate:shop:${shopDomain}:day`, RATE_LIMITS.QUIZ_GENERATE_PER_SHOP_DAY.limit, RATE_LIMITS.QUIZ_GENERATE_PER_SHOP_DAY.windowMs);
  if (!hourly.allowed || !daily.allowed) {
    const retryAfterSeconds = Math.max(hourly.retryAfterSeconds, daily.retryAfterSeconds);
    const wait =
      retryAfterSeconds > 7200
        ? `${Math.ceil(retryAfterSeconds / 3600)} hours`
        : `${Math.ceil(retryAfterSeconds / 60)} minutes`;
    return json({ ok: false, error: `Generation limit reached. Try again in ${wait}.`, retryAfterSeconds }, { status: 429 });
  }

  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const brief: BrandBrief = {
    category: String(formData.get("category") ?? "").slice(0, 200) || "beauty products",
    brandVoice: String(formData.get("brandVoice") ?? "").slice(0, 400) || "warm and confident",
    quizLength: formData.get("quizLength") === "short" ? "short" : "standard",
    modePreference: (["matrix", "ai", "hybrid"] as const).find((m) => m === formData.get("modePreference")) ?? "auto",
    extraNotes: String(formData.get("extraNotes") ?? "").slice(0, 2000) || undefined,
  };

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
      // Heartbeats keep Render's proxy from idling out the connection.
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10_000);

      try {
        const result = await generateQuizConfig({
          shopId: shop.id,
          shopDomain,
          brief,
          accentColor: String(formData.get("accentColor") ?? "") || null,
          onProgress: (phase) => send({ type: "progress", phase }),
        });
        if (result.ok) {
          send({ type: "result", summary: result.summary, warnings: result.warnings });
        } else {
          send({ type: "error", error: result.error, warnings: result.warnings });
        }
      } catch (err) {
        console.error("[quiz-generate] failed:", err);
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
