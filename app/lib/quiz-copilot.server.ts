// Copilot chat engine (Phase 7): "Build with Gleame".
//
// Manual agentic loop (we need per-tool-call interception for change cards +
// undo snapshots, so the SDK tool runner isn't used):
//   1. Load session history (raw MessageParam[]) + current draft
//   2. Same CACHED system prefix as the generator (role + schema + catalog)
//      + a volatile draft-summary system block AFTER the cache breakpoint
//   3. Stream; on tool_use: snapshot draft -> apply patch -> save draft ->
//      emit change event (or tool_result is_error so the model self-corrects)
//   4. Loop until end_turn, max 6 tool iterations, 90s total budget
//
// Fail-soft: patches already applied stay applied (each was individually
// validated); an error mid-turn just ends the turn.

import type Anthropic from "@anthropic-ai/sdk";
import {
  claudeClient,
  isPermanentClaudeError,
  logClaudeUsage,
  CLAUDE_MODEL_MAIN,
  type ClaudeUsage,
} from "./claude.server";
import { serializeCatalog } from "./quiz-config-schema.server";
import { buildSystemBlocks, loadCatalogForShop } from "./quiz-generator.server";
import { getQuizDraft, saveQuizDraft, type QuizDraft } from "./quiz-draft.server";
import { APPLIERS, COPILOT_TOOLS, type ChangeSummary, type DraftShape } from "./quiz-copilot-tools.server";
import { supabase } from "./supabase.server";

const MAX_TOOL_ITERATIONS = 6;
/**
 * Behavioral contract for the editing copilot. The generator's shared role
 * block optimizes for building a WHOLE quiz; in the studio chat the failure
 * mode is the opposite — a vague prompt turning into a sweeping rewrite.
 * These rules trade thoroughness for precision and consent.
 */
const COPILOT_BEHAVIOR_BLOCK = `YOU ARE NOW IN COPILOT MODE, editing an existing draft conversationally. These rules OVERRIDE the generation rules above where they conflict:

GROUND TRUTH
- The CURRENT DRAFT SUMMARY below is the ONLY source of truth for the quiz's current state. The conversation history describes PAST states — question numbers, prompts, and option labels in it may be stale. Never quote quiz content from memory: re-read the summary, or call get_draft_details, EVERY time you describe the quiz.
- If the merchant says your description doesn't match what they see, call get_draft_details and reconcile from the data. Never tell them to refresh, never insist you're right.

BIAS TO ACTION
- Small additive requests ("add a budget question") get DONE, not interviewed: make a sensible choice, apply it, summarize it, and offer one optional tweak. Doing something reasonable that they can adjust beats a round of questions.
- Ask ONE short clarifying question ONLY when materially different edits are plausible AND picking wrong would be hard to undo. Never ask twice for the same request — after the merchant answers once, act on your best interpretation.
- Make the SMALLEST change that satisfies the request. One request = one focused edit. Never "improve" things the merchant didn't mention.

BIG CHANGES NEED A YES FIRST
- Before any sweeping edit — rewriting copy across many fields, adding/removing/reordering more than one question, changing the recommendation mode, replacing the rules, or restyling the whole quiz — reply with a short dash-list plan of exactly what you would change and ask for a go-ahead. Call NO tools until the merchant confirms in their next message.
- Small single-target edits need no confirmation; just make them.

AFTER EDITING
- Summarize precisely what changed — name the question/field and the before/after where short. Then offer AT MOST one concrete, optional next suggestion.

STYLE
- Brief, plain sentences. Dash lists are fine. Use **bold** sparingly; no headers, no long essays.`;

const TURN_BUDGET_MS = 90_000;
const MAX_HISTORY_MESSAGES = 40;
const MAX_SNAPSHOTS = 20;

export type CopilotEvent =
  | { type: "token"; text: string }
  | { type: "change"; tool: string; target: string; description: string; snapshotId: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; error: string };

interface SessionRow {
  id: string;
  messages: Anthropic.MessageParam[];
  snapshots: Array<{ id: string; label: string; draft: QuizDraft; createdAt: string }>;
}

async function loadOrCreateSession(shopId: string, sessionId?: string | null): Promise<SessionRow> {
  if (sessionId) {
    const { data } = await supabase
      .from("quiz_copilot_sessions")
      .select("id, messages, snapshots, shop_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (data && data.shop_id === shopId) {
      return { id: data.id, messages: data.messages ?? [], snapshots: data.snapshots ?? [] };
    }
  }
  const { data, error } = await supabase
    .from("quiz_copilot_sessions")
    .insert({ shop_id: shopId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`copilot session create failed: ${error?.message}`);
  return { id: data.id, messages: [], snapshots: [] };
}

/**
 * Trim history WITHOUT breaking tool_use/tool_result pairing: an arbitrary
 * slice can start on a user message whose tool_result ids reference a dropped
 * assistant tool_use — the API 400s on that (permanently bricking the
 * session). Always cut at a real user TEXT turn boundary.
 */
export function trimHistory(
  messages: Anthropic.MessageParam[],
  max: number = MAX_HISTORY_MESSAGES,
): Anthropic.MessageParam[] {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length) {
    const m = messages[start];
    if (m.role === "user" && typeof m.content === "string") break;
    start++;
  }
  // No clean boundary found (pathological) — keep only the trailing plain
  // user turn if any, else return empty and let the turn start fresh.
  if (start >= messages.length) {
    const last = messages[messages.length - 1];
    return last.role === "user" && typeof last.content === "string" ? [last] : [];
  }
  return messages.slice(start);
}

/** Latest session for a shop, so the builder resumes context across loads. */
export async function getLatestSessionId(shopId: string): Promise<string | null> {
  const { data } = await supabase
    .from("quiz_copilot_sessions")
    .select("id")
    .eq("shop_id", shopId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function persistSession(session: SessionRow): Promise<void> {
  const { data, error } = await supabase
    .from("quiz_copilot_sessions")
    .update({
      messages: trimHistory(session.messages),
      snapshots: session.snapshots.slice(-MAX_SNAPSHOTS),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .select("id");
  if (error || !data?.length) {
    console.error(`copilot session persist failed for ${session.id}:`, error?.message ?? "0 rows");
  }
}

/** Compact draft outline (volatile — sits AFTER the cache breakpoint). */
function draftSummaryBlock(draft: QuizDraft): string {
  const flow = draft.flow;
  const lines: string[] = ["CURRENT DRAFT SUMMARY:"];
  lines.push(
    `mode=${draft.settings.recommendation_mode ?? "matrix"} axes=${flow.axes.length} questions=${flow.questions.length} rules=${flow.rules.length}`,
  );
  for (const a of flow.axes) {
    lines.push(`axis ${a.key} (${a.source}): ${a.values.map((v) => v.value).join(", ")}`);
  }
  flow.questions.forEach((q, i) => {
    lines.push(
      `Q${i + 1} [${q.axisKey}]${q.showIf ? ` (showIf ${q.showIf.axis_key}=${q.showIf.axis_value})` : ""}: "${q.prompt}" -> ${q.options.map((o) => o.label).join(" | ")}`,
    );
  });
  const settingsKeys = Object.keys(draft.settings).filter((k) => k !== "ai_guidance");
  lines.push(`settings keys present: ${settingsKeys.join(", ") || "none"}`);
  lines.push(
    `Use get_draft_details for exact text of any slice before editing it. Make the smallest edit that satisfies the merchant's request; prefer one targeted tool call over many.`,
  );
  return lines.join("\n");
}

export async function runCopilotTurn(args: {
  shopId: string;
  shopDomain: string;
  sessionId?: string | null;
  userMessage: string;
  onEvent: (event: CopilotEvent) => void;
}): Promise<{ sessionId: string; usage: ClaudeUsage[] }> {
  const { shopId, shopDomain, userMessage, onEvent } = args;
  const usage: ClaudeUsage[] = [];
  const startedAt = Date.now();

  const [session, draftLoaded, catalog] = await Promise.all([
    loadOrCreateSession(shopId, args.sessionId),
    getQuizDraft(shopId),
    loadCatalogForShop(shopId),
  ]);
  if (!draftLoaded) {
    onEvent({ type: "error", error: "No draft to edit. Generate or create a draft first." });
    return { sessionId: session.id, usage };
  }
  let draft: QuizDraft = draftLoaded;

  const { text: catalogText } = serializeCatalog(catalog);
  // Cached prefix (byte-identical with the generator) + copilot behavior
  // contract and volatile draft summary AFTER the breakpoint.
  const system: Anthropic.TextBlockParam[] = [
    ...buildSystemBlocks(catalogText),
    { type: "text", text: COPILOT_BEHAVIOR_BLOCK },
    { type: "text", text: draftSummaryBlock(draft) },
  ];

  session.messages.push({ role: "user", content: userMessage });

  const client = claudeClient();
  let iterations = 0;

  try {
    for (;;) {
      if (Date.now() - startedAt > TURN_BUDGET_MS) {
        onEvent({ type: "error", error: "That took too long — the changes made so far were kept. Try a smaller request." });
        break;
      }

      // Manual retry (not callClaudeWithRetry): once tokens have streamed to
      // the client, a retry would replay them into the same chat bubble, so
      // only retry when NOTHING was emitted yet.
      let response: Anthropic.Message | null = null;
      for (let attempt = 0; attempt <= 2; attempt++) {
        let sawText = false;
        try {
          const stream = client.messages.stream({
            model: CLAUDE_MODEL_MAIN,
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            tools: COPILOT_TOOLS,
            system,
            messages: session.messages,
          });
          stream.on("text", (delta) => {
            sawText = true;
            onEvent({ type: "token", text: delta });
          });
          response = await stream.finalMessage();
          break;
        } catch (error) {
          if (isPermanentClaudeError(error) || sawText || attempt === 2) throw error;
          const delayMs = 1000 * Math.pow(2, attempt);
          console.warn(`[Claude] quiz-copilot attempt ${attempt + 1} failed (${(error as Error).message}), retrying in ${delayMs}ms`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      if (!response) throw new Error("copilot call failed");
      usage.push(response.usage as ClaudeUsage);
      logClaudeUsage(shopDomain, "quiz-copilot", response.usage as ClaudeUsage);

      session.messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) break;
      if (response.stop_reason !== "tool_use") {
        // Truncated mid-tool-call (e.g. max_tokens): the assistant message
        // contains tool_use blocks that MUST be answered or the persisted
        // history is invalid and every future turn 400s.
        session.messages.push({
          role: "user",
          content: toolUses.map((t) => ({
            type: "tool_result" as const,
            tool_use_id: t.id,
            content: "Cancelled: the response was truncated before this tool call could be applied.",
            is_error: true,
          })),
        });
        onEvent({ type: "error", error: "That request was too large to finish in one go — try breaking it into smaller changes." });
        break;
      }

      iterations++;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const applier = APPLIERS[toolUse.name];
        if (!applier) {
          results.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Unknown tool ${toolUse.name}`, is_error: true });
          continue;
        }
        const outcome = applier(draft as DraftShape, toolUse.input, catalog);
        if (!outcome.ok) {
          results.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Rejected: ${outcome.error}`, is_error: true });
          continue;
        }
        if (outcome.readOnly) {
          results.push({ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(outcome.data ?? null) });
          continue;
        }
        // Snapshot BEFORE the change so undo restores the pre-change draft.
        const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        session.snapshots.push({
          id: snapshotId,
          label: outcome.summary.description,
          draft,
          createdAt: new Date().toISOString(),
        });
        draft = outcome.draft as QuizDraft;
        const saved = await saveQuizDraft(shopId, draft, "ai");
        if (!saved.ok) {
          results.push({ type: "tool_result", tool_use_id: toolUse.id, content: `Draft save failed: ${saved.error}`, is_error: true });
          session.snapshots.pop();
          continue;
        }
        onEvent({ type: "change", ...(outcome.summary as ChangeSummary), snapshotId });
        results.push({ type: "tool_result", tool_use_id: toolUse.id, content: "Applied." });
      }
      session.messages.push({ role: "user", content: results });

      if (iterations >= MAX_TOOL_ITERATIONS) {
        onEvent({ type: "error", error: "Change limit reached for one message — the applied changes were kept." });
        break;
      }
    }
  } catch (err) {
    console.error("[quiz-copilot] turn failed:", err);
    onEvent({ type: "error", error: err instanceof Error ? err.message : "Copilot turn failed" });
  } finally {
    // Always persist: applied patches are already in the draft, and losing
    // the matching history/snapshots would desync the model's memory (and
    // drop undo) for changes the merchant can see.
    await persistSession(session);
  }
  onEvent({ type: "done", sessionId: session.id });
  return { sessionId: session.id, usage };
}

/**
 * Restore the draft to a snapshot. Undoing an older snapshot also reverts
 * every later change (snapshot = full draft state). Appends an honest note
 * to the session history so the model's mental state stays truthful.
 */
export async function undoToSnapshot(args: {
  shopId: string;
  sessionId: string;
  snapshotId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { shopId, sessionId, snapshotId } = args;
  const { data, error } = await supabase
    .from("quiz_copilot_sessions")
    .select("id, shop_id, messages, snapshots")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data || data.shop_id !== shopId) return { ok: false, error: "Session not found" };

  const snapshots = (data.snapshots ?? []) as SessionRow["snapshots"];
  const idx = snapshots.findIndex((s) => s.id === snapshotId);
  if (idx === -1) return { ok: false, error: "Snapshot not found (it may have been pruned)" };

  const snapshot = snapshots[idx];
  const saved = await saveQuizDraft(shopId, snapshot.draft, "ai");
  if (!saved.ok) return { ok: false, error: saved.error };

  const messages = [...((data.messages ?? []) as Anthropic.MessageParam[])];
  messages.push({
    role: "user",
    content: `[The merchant clicked Undo on "${snapshot.label}". The draft has been restored to the state before that change (later changes were reverted too). Acknowledge briefly if asked; do not re-apply the undone changes unprompted.]`,
  });

  const { data: updated, error: updateError } = await supabase
    .from("quiz_copilot_sessions")
    .update({
      messages: trimHistory(messages),
      snapshots: snapshots.slice(0, idx), // later snapshots describe reverted states
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select("id");
  if (updateError || !updated?.length) {
    console.error(`[quiz-copilot] undo bookkeeping failed:`, updateError?.message ?? "0 rows");
  }
  return { ok: true };
}

export async function resetSession(shopId: string, sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("quiz_copilot_sessions")
    .update({ messages: [], snapshots: [], updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("shop_id", shopId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: error?.message ?? "Session not found" };
  return { ok: true };
}
