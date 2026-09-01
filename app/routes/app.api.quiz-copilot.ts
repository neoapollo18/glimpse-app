import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { findShopByDomain } from "../lib/supabase.server";
import { checkRateLimit, RATE_LIMITS } from "../lib/rate-limiter.server";
import { isClaudeConfigured } from "../lib/claude.server";
import { runCopilotTurn, undoToSnapshot, resetSession } from "../lib/quiz-copilot.server";

// Copilot chat endpoint (admin-authenticated). Intents:
//   message {sessionId?, text} -> SSE stream: token | change | error | done
//   undo    {sessionId, snapshotId} -> JSON
//   reset   {sessionId} -> JSON

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
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const sessionId = (formData.get("sessionId") as string) || null;

  if (intent === "undo") {
    const snapshotId = formData.get("snapshotId") as string;
    if (!sessionId || !snapshotId) return json({ ok: false, error: "Missing sessionId/snapshotId" }, { status: 400 });
    const result = await undoToSnapshot({ shopId: shop.id, sessionId, snapshotId });
    return json(result, { status: result.ok ? 200 : 400 });
  }

  if (intent === "reset") {
    if (!sessionId) return json({ ok: false, error: "Missing sessionId" }, { status: 400 });
    const result = await resetSession(shop.id, sessionId);
    return json(result, { status: result.ok ? 200 : 400 });
  }

  if (intent !== "message") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  if (!isClaudeConfigured()) {
    return json({ ok: false, error: "AI copilot is not configured (missing ANTHROPIC_API_KEY)." }, { status: 503 });
  }

  const perMinute = checkRateLimit(`quiz-copilot:shop:${shopDomain}:minute`, RATE_LIMITS.QUIZ_COPILOT_PER_SHOP_MINUTE.limit, RATE_LIMITS.QUIZ_COPILOT_PER_SHOP_MINUTE.windowMs);
  const perDay = checkRateLimit(`quiz-copilot:shop:${shopDomain}:day`, RATE_LIMITS.QUIZ_COPILOT_PER_SHOP_DAY.limit, RATE_LIMITS.QUIZ_COPILOT_PER_SHOP_DAY.windowMs);
  if (!perMinute.allowed || !perDay.allowed) {
    const retryAfterSeconds = Math.max(perMinute.retryAfterSeconds, perDay.retryAfterSeconds);
    return json({ ok: false, error: `Copilot limit reached. Try again in ${retryAfterSeconds}s.`, retryAfterSeconds }, { status: 429 });
  }

  const text = String(formData.get("text") ?? "").slice(0, 4000).trim();
  if (!text) return json({ ok: false, error: "Empty message" }, { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      // Enqueue throws once the client disconnects; the turn must keep
      // running (patches are already applied and history/snapshots must
      // persist), so sends are swallowed after close.
      let closed = false;
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(sse(data));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10_000);
      try {
        await runCopilotTurn({
          shopId: shop.id,
          shopDomain,
          sessionId,
          userMessage: text,
          onEvent: send,
        });
      } catch (err) {
        console.error("[quiz-copilot] stream failed:", err);
        send({ type: "error", error: err instanceof Error ? err.message : "Copilot failed" });
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
