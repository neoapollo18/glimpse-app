// Recommendation Logic Spec v2: the Check matches tab's endpoint.
//
// intents:
//   draft      — draft sentences for every answer that has none (never
//                overwrites a row). Active only for a quiz with no logic of
//                its own yet (answer-rules.server draftActiveDefault).
//   save       — one sentence edit: derive mode, resolve, ACTIVATE.
//   refresh    — re-resolve sentences cached against an older catalog.
//   set-global — replace store-wide always/never (✕ on Overview + Undo).
//   undo-rules — restore sentence rows from a chat change's undo payload.
//   chat       — scoped Chat turn (matches-chat.server).
//
// Additive by construction: nothing here writes recommendation rules,
// ai_guidance or priority products.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { findShopByDomain } from "../lib/supabase.server";
import { isClaudeConfigured } from "../lib/claude.server";
import { checkRateLimits, RATE_LIMITS } from "../lib/rate-limiter.server";
import {
  ensureAnswerRules,
  saveSentence,
  refreshStaleResolutions,
  setGlobalRules,
  getGlobalRules,
  restoreRuleUndo,
  parseRuleUndo,
} from "../lib/answer-rules.server";
import { invalidateAnswerLayer } from "../lib/answer-rules-runtime.server";
import { runMatchesChat, type MatchesChatTurn } from "../lib/matches-chat.server";
import { normalizeGlobalRules, deriveMode, hasGlobalRules } from "../lib/answer-rules-shared";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";

const KEY_RE = /^[a-z_][a-z0-9_]{0,63}$/;

export const action = async ({ request }: ActionFunctionArgs) => {
  let session;
  try {
    ({ session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) return json({ ok: false, error: "Session expired. Please reload." }, { status: 401 });
    throw err;
  }
  const shopDomain = session.shop;
  if (await shopNeedsBilling(shopDomain, session.accessToken ?? "")) {
    return json({ ok: false, error: "Your Gleame subscription isn't active. Visit Billing to continue." }, { status: 402 });
  }
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const aiIntents = new Set(["draft", "save", "refresh", "chat"]);
  if (aiIntents.has(intent)) {
    if (!isClaudeConfigured()) return json({ ok: false, error: "AI isn't configured." }, { status: 503 });
    const limit = checkRateLimits([
      { key: `answer-rules:${intent}:${shopDomain}:minute`, limit: intent === "save" ? 30 : RATE_LIMITS.QUIZ_COPILOT_PER_SHOP_MINUTE.limit, windowMs: 60_000 },
      { key: `answer-rules:${shopDomain}:day`, limit: RATE_LIMITS.QUIZ_COPILOT_PER_SHOP_DAY.limit * 4, windowMs: RATE_LIMITS.QUIZ_COPILOT_PER_SHOP_DAY.windowMs },
    ]);
    if (!limit.allowed) {
      return json({ ok: false, error: `Slow down a moment — try again in ${limit.retryAfterSeconds}s.` }, { status: 429 });
    }
  }

  try {
    switch (intent) {
      case "draft": {
        const r = await ensureAnswerRules({ shopId: shop.id, shopDomain });
        if (r.drafted > 0) invalidateAnswerLayer(shop.id);
        return json({ ok: true, ...r });
      }
      case "save": {
        const axisKey = String(form.get("axisKey") ?? "");
        const axisValue = String(form.get("axisValue") ?? "");
        const sentence = String(form.get("sentence") ?? "");
        if (!KEY_RE.test(axisKey) || !KEY_RE.test(axisValue)) return json({ ok: false, error: "Bad answer key" }, { status: 400 });
        const rule = await saveSentence({ shopId: shop.id, shopDomain, axisKey, axisValue, sentence, source: "edited" });
        invalidateAnswerLayer(shop.id);
        trackOverhaulEvent(shopDomain, "rule_edited", { question_id: axisKey, answer_id: axisValue, source: "edited", mode: deriveMode(sentence) });
        if (rule.status === "unresolved") {
          trackOverhaulEvent(shopDomain, "rule_unresolved", { question_id: axisKey, answer_id: axisValue });
        }
        return json({ ok: true, rule });
      }
      case "refresh": {
        const r = await refreshStaleResolutions(shop.id, shopDomain);
        if (r.refreshed > 0) invalidateAnswerLayer(shop.id);
        return json({ ok: true, ...r });
      }
      case "set-global": {
        let raw: unknown = null;
        try {
          raw = JSON.parse(String(form.get("global") ?? "null"));
        } catch {
          return json({ ok: false, error: "Bad rules payload" }, { status: 400 });
        }
        const global = await setGlobalRules(shopDomain, normalizeGlobalRules(raw));
        invalidateAnswerLayer(shop.id);
        return json({ ok: true, global });
      }
      case "undo-rules": {
        let raw: unknown = null;
        try {
          raw = JSON.parse(String(form.get("undo") ?? "null"));
        } catch {
          return json({ ok: false, error: "Bad undo payload" }, { status: 400 });
        }
        const undo = parseRuleUndo(raw);
        if (!undo) return json({ ok: false, error: "Bad undo payload" }, { status: 400 });
        await restoreRuleUndo(shop.id, undo);
        invalidateAnswerLayer(shop.id);
        return json({ ok: true });
      }
      case "chat": {
        const message = String(form.get("message") ?? "").trim();
        if (!message) return json({ ok: false, error: "Say what's wrong first." }, { status: 400 });
        const scopeRaw = String(form.get("scope") ?? "");
        const scopeAxisKey = KEY_RE.test(scopeRaw) ? scopeRaw : null;
        let history: MatchesChatTurn[] = [];
        try {
          const h = JSON.parse(String(form.get("history") ?? "[]"));
          if (Array.isArray(h)) {
            history = h
              .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
              .slice(-10);
          }
        } catch {
          /* no history */
        }
        const before = await getGlobalRules(shopDomain);
        const result = await runMatchesChat({ shopId: shop.id, shopDomain, scopeAxisKey, history, message });
        for (const c of result.changes) {
          if (c.undo.kind === "rules") {
            for (const u of c.undo.rules) {
              trackOverhaulEvent(shopDomain, "rule_edited", { question_id: u.axisKey, answer_id: u.axisValue, source: "chat" });
            }
          }
        }
        const after = await getGlobalRules(shopDomain);
        if (after.always.length + after.never.length > before.always.length + before.never.length) {
          trackOverhaulEvent(shopDomain, "global_rule_added", { source: "chat", has_rules: hasGlobalRules(after) });
        }
        return json({ ok: true, ...result, global: after });
      }
      default:
        return json({ ok: false, error: "Unknown intent" }, { status: 400 });
    }
  } catch (e) {
    console.error(`[answer-rules] ${intent} failed for ${shopDomain}:`, e);
    return json({ ok: false, error: (e as Error).message || "Something went wrong" }, { status: 500 });
  }
};
