// Quiz config draft/publish layer (quiz-first overhaul, Phase 2).
//
// Drafts live in quiz_config_versions (migration 058) as
// { flow, settings } JSON, completely separate from the live tables. The AI
// builder and the self-serve builder ONLY write drafts; the sole path to the
// live config is publishQuizDraft, which:
//   1. validates + referentially checks the draft,
//   2. snapshots the CURRENT live config as an archived version (rollback
//      insurance — the wipe-and-rewrite save destroyed admin styling once
//      before; never again),
//   3. writes through the existing saveRecommendationConfig RPC +
//      saveChatAssistantConfig (whitelisted keys only).
//
// The storefront read path never touches this table. Manual editors
// (app.assistant_.*) keep writing live exactly as before.

import {
  supabase,
  saveRecommendationConfig,
  saveChatAssistantConfig,
  getChatAssistantConfig,
  getRecommendationAdminConfig,
  getShopVariantsFlat,
  type ChatAssistantConfig,
} from "./supabase.server";
import { normalizeFlowOrder } from "./quiz-config-schema.server";
import { withShopSaveLock } from "./shop-save-lock.server";
import { draftProblems } from "../components/studio/draft-problems";
import type { StudioFlow } from "../components/studio/types";

export type SaveRecommendationConfigInput = Parameters<typeof saveRecommendationConfig>[1];

export interface QuizDraft {
  flow: SaveRecommendationConfigInput;
  settings: Partial<ChatAssistantConfig>;
}

export interface VersionSummary {
  id: string;
  status: "draft" | "published" | "archived";
  label: string | null;
  createdBy: "ai" | "manual" | "system";
  createdAt: string;
  publishedAt: string | null;
}

/**
 * Only these chat_assistant_config fields may flow from a draft to live.
 * Everything else on that row (chat/hero/bundle settings, analytics copy)
 * is out of the builder's blast radius by construction.
 */
const SETTINGS_KEY_ALLOWLIST = new Set([
  "enabled",
  "assistant_mode",
  "assistant_name",
  "accent_color",
  "title_font",
  "num_recommendations",
  "product_scope",
  "selected_product_ids",
  "recommendation_mode",
  "ai_guidance",
  "recommendation_tuning",
  "priority_product_ids",
]);

function filterSettings(settings: Partial<ChatAssistantConfig>): Partial<ChatAssistantConfig> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (key.startsWith("quiz_") || SETTINGS_KEY_ALLOWLIST.has(key)) out[key] = value;
  }
  return out as Partial<ChatAssistantConfig>;
}

async function domainForShop(shopId: string): Promise<string> {
  const { data, error } = await supabase
    .from("shops")
    .select("shop_domain")
    .eq("id", shopId)
    .single();
  if (error || !data) throw new Error(`quiz-draft: unknown shop id ${shopId}: ${error?.message ?? ""}`);
  return data.shop_domain as string;
}

/** Cheap draft-existence check (no config jsonb fetch) for pages that only
 * need to warn "an unpublished draft exists". excludeSeeded ignores drafts
 * auto-seeded from live and never edited (created_by='seed') — the studio
 * loader re-seeds seconds after every publish, and counting those made the
 * dashboard claim "unpublished edits" forever after a clean publish. */
export async function hasQuizDraft(
  shopId: string,
  opts?: { excludeSeeded?: boolean },
): Promise<boolean> {
  let query = supabase
    .from("quiz_config_versions")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("status", "draft");
  if (opts?.excludeSeeded) query = query.neq("created_by", "seed");
  const { count, error } = await query;
  if (error) {
    console.error("hasQuizDraft error", error);
    return false;
  }
  return (count ?? 0) > 0;
}

export async function getQuizDraft(shopId: string): Promise<QuizDraft | null> {
  const { data, error } = await supabase
    .from("quiz_config_versions")
    .select("config")
    .eq("shop_id", shopId)
    .eq("status", "draft")
    .maybeSingle();
  if (error) throw new Error(`quiz-draft: load failed: ${error.message}`);
  return (data?.config as QuizDraft) ?? null;
}

export async function saveQuizDraft(
  shopId: string,
  draft: QuizDraft,
  createdBy: "ai" | "manual" | "seed" = "manual",
): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString();
  // Update-then-insert against the one-draft-per-shop partial unique index,
  // with write verification (an UPDATE matching 0 rows succeeds silently).
  const { data: updated, error: updateError } = await supabase
    .from("quiz_config_versions")
    .update({ config: draft, created_by: createdBy, updated_at: now })
    .eq("shop_id", shopId)
    .eq("status", "draft")
    .select("id");
  if (updateError) return { ok: false, error: updateError.message };
  if (updated && updated.length > 0) return { ok: true };

  const { data: inserted, error: insertError } = await supabase
    .from("quiz_config_versions")
    .insert({ shop_id: shopId, status: "draft", config: draft, created_by: createdBy })
    .select("id");
  if (insertError) {
    // Lost the update-then-insert race against the one-draft partial unique
    // index (23505): another writer created the draft row between our two
    // statements — the retry UPDATE now matches it.
    if (insertError.code === "23505") {
      const { data: retried, error: retryError } = await supabase
        .from("quiz_config_versions")
        .update({ config: draft, created_by: createdBy, updated_at: new Date().toISOString() })
        .eq("shop_id", shopId)
        .eq("status", "draft")
        .select("id");
      if (retryError || !retried?.length) {
        return { ok: false, error: retryError?.message ?? "draft save race retry wrote 0 rows" };
      }
      return { ok: true };
    }
    return { ok: false, error: insertError.message };
  }
  if (!inserted?.length) return { ok: false, error: "draft insert wrote 0 rows" };
  return { ok: true };
}

export async function discardQuizDraft(shopId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("quiz_config_versions")
    .delete()
    .eq("shop_id", shopId)
    .eq("status", "draft");
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function listVersions(shopId: string): Promise<VersionSummary[]> {
  const { data, error } = await supabase
    .from("quiz_config_versions")
    .select("id, status, label, created_by, created_at, published_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`quiz-draft: listVersions failed: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    status: r.status,
    label: r.label ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    publishedAt: r.published_at ?? null,
  }));
}

/**
 * Capture the CURRENT live config in draft shape. Used both to seed a fresh
 * draft ("Edit as draft") and as the pre-publish safety snapshot.
 */
export async function captureLiveConfig(shopId: string): Promise<QuizDraft> {
  const shopDomain = await domainForShop(shopId);
  const [admin, chatConfig] = await Promise.all([
    getRecommendationAdminConfig(shopId),
    getChatAssistantConfig(shopDomain),
  ]);

  // Map admin shape (row ids, camelCase, axisId/axisValueId references) into
  // the save-input shape (keys + values). Mirrors the mapping the matrix
  // editor performs on save.
  const axisById = new Map(admin.axes.map((a) => [a.id, a]));
  const valueById = new Map(
    admin.axes.flatMap((a) => a.values.map((v) => [v.id, v] as const)),
  );

  // The admin questions query is unordered (PostgREST heap order) while the
  // storefront orders questions by AXIS position — sort so the captured
  // draft's array order matches what shoppers actually see (Q1/Q2 numbering,
  // showIf earlier-axis validation, and preview all depend on array order).
  const axisPositionOf = (q: (typeof admin.questions)[number]) => {
    const axis = axisById.get(q.axisId);
    return axis ? admin.axes.indexOf(axis) : Number.MAX_SAFE_INTEGER;
  };
  const orderedQuestions = [...admin.questions].sort((a, b) => axisPositionOf(a) - axisPositionOf(b));

  const flow: SaveRecommendationConfigInput = {
    axes: admin.axes.map((a, i) => ({
      key: a.key,
      label: a.label,
      source: a.source as "photo" | "user_question",
      position: a.position ?? i,
      values: a.values.map((v, j) => ({
        value: v.value,
        label: v.label,
        position: v.position ?? j,
        swatchColor: v.swatchColor ?? null,
      })),
    })),
    questions: orderedQuestions.map((q) => {
      const axis = axisById.get(q.axisId);
      if (!axis) throw new Error(`quiz-draft: question ${q.id} references unknown axis ${q.axisId}`);
      return {
        axisKey: axis.key,
        prompt: q.prompt,
        helperText: q.helperText ?? null,
        multiSelect: q.multiSelect ?? false,
        maxSelections: q.maxSelections ?? null,
        screenGroup: q.screenGroup ?? null,
        showIf: q.showIf ? { axis_key: q.showIf.axisKey, axis_value: q.showIf.axisValue } : null,
        optionStyle: q.optionStyle ?? null,
        options: q.options.map((opt, j) => {
          const axisValue = valueById.get(opt.axisValueId);
          if (!axisValue) {
            throw new Error(`quiz-draft: option ${opt.id} references unknown axis value ${opt.axisValueId}`);
          }
          return {
            label: opt.label,
            axisValueValue: axisValue.value,
            botResponse: opt.botResponse ?? null,
            reasonText: opt.reasonText ?? null,
            imageUrl: opt.imageUrl ?? null,
            showIf: opt.showIf ? { axis_key: opt.showIf.axisKey, axis_value: opt.showIf.axisValue } : null,
            selectAll: opt.selectAll ?? false,
            displayMeta: opt.displayMeta ?? null,
            position: opt.position ?? j,
          };
        }),
      };
    }),
    rules: admin.rules.map((r) => ({
      criteria: r.criteria,
      variantId: r.variantId ?? null,
      productId: r.productId ?? null,
      rank: r.rank,
      quantity: r.quantity ?? 1,
    })),
  };

  return { flow, settings: filterSettings(chatConfig) };
}

/** Seed (or return the existing) draft from the live config. */
export async function initDraftFromLive(shopId: string): Promise<QuizDraft> {
  const existing = await getQuizDraft(shopId);
  if (existing) return existing;
  const draft = await captureLiveConfig(shopId);
  // "seed": an auto-seeded, never-edited draft — any real edit overwrites
  // created_by via saveQuizDraft, which is what flips "unpublished edits".
  const saved = await saveQuizDraft(shopId, draft, "seed");
  if (!saved.ok) throw new Error(`quiz-draft: init failed: ${saved.error}`);
  return draft;
}

/**
 * Referential check: every rule target must exist in the shop's non-deleted
 * catalog. Drafts can go stale against catalog sync (or reference AI
 * hallucinations that slipped past generation-time validation).
 */
async function checkRuleTargets(shopId: string, flow: SaveRecommendationConfigInput): Promise<string[]> {
  const targets = await getShopVariantsFlat(shopId);
  const productIds = new Set(targets.filter((t) => t.kind === "product").map((t) => t.id));
  const variantIds = new Set(targets.filter((t) => t.kind === "variant").map((t) => t.id));
  const problems: string[] = [];
  (flow.rules || []).forEach((rule, i) => {
    if (rule.productId && !productIds.has(rule.productId)) {
      problems.push(`rule ${i + 1} targets missing product ${rule.productId}`);
    }
    if (rule.variantId && !variantIds.has(rule.variantId)) {
      problems.push(`rule ${i + 1} targets missing variant ${rule.variantId}`);
    }
    if (!rule.productId && !rule.variantId) {
      problems.push(`rule ${i + 1} has no target`);
    }
  });
  return problems;
}

export async function publishQuizDraft(shopId: string): Promise<{ ok: boolean; error?: string }> {
  // Same lock the questions-page patch saves take: publish is a
  // snapshot-then-rewrite, and racing a live editor save would let one
  // silently erase the other.
  return withShopSaveLock(shopId, () => publishQuizDraftLocked(shopId));
}

async function publishQuizDraftLocked(shopId: string): Promise<{ ok: boolean; error?: string }> {
  const shopDomain = await domainForShop(shopId);
  const draft = await getQuizDraft(shopId);
  if (!draft) return { ok: false, error: "No draft to publish" };
  if (!draft.flow || !Array.isArray(draft.flow.axes)) {
    return { ok: false, error: "Draft is malformed (missing flow.axes)" };
  }

  // The Publish checklist runs these client-side, but the server is the
  // authority: a stale tab or a direct POST must not publish blank
  // questions over a live config.
  if (!Array.isArray(draft.flow.questions) || draft.flow.questions.length === 0) {
    return { ok: false, error: "Draft has no questions — nothing to publish." };
  }
  const structural = draftProblems(draft.flow as unknown as StudioFlow);
  if (structural.length > 0) {
    return {
      ok: false,
      error: `Draft isn't publishable: ${structural.slice(0, 3).map((p) => p.message).join("; ")}${structural.length > 3 ? ` (+${structural.length - 3} more)` : ""}`,
    };
  }

  const targetProblems = await checkRuleTargets(shopId, draft.flow);
  if (targetProblems.length > 0) {
    return { ok: false, error: `Draft references missing catalog items: ${targetProblems.slice(0, 5).join("; ")}` };
  }

  // Safety snapshot of the live config BEFORE any write. If capture fails we
  // abort: publishing without rollback insurance is how configs get lost.
  let snapshot: QuizDraft;
  try {
    snapshot = await captureLiveConfig(shopId);
  } catch (e) {
    return { ok: false, error: `Could not snapshot live config, publish aborted: ${(e as Error).message}` };
  }
  const { data: snapRow, error: snapError } = await supabase
    .from("quiz_config_versions")
    .insert({
      shop_id: shopId,
      status: "archived",
      config: snapshot,
      created_by: "system",
      label: "pre-publish snapshot",
    })
    .select("id");
  if (snapError || !snapRow?.length) {
    return { ok: false, error: `Snapshot write failed, publish aborted: ${snapError?.message ?? "0 rows"}` };
  }

  // Storefront question order = axis position; drafts/preview use array
  // order. Renumber axis positions from the question array so what the
  // merchant previewed is exactly what publishes.
  const orderedFlow = normalizeFlowOrder(draft.flow as Parameters<typeof normalizeFlowOrder>[0]) as QuizDraft["flow"];

  // Atomic RPC: constraint failure rolls back the whole flow rewrite.
  const flowResult = await saveRecommendationConfig(shopId, orderedFlow);
  if (!flowResult.ok) return { ok: false, error: flowResult.error };

  // Only write settings keys that exist on the live config row: a stale or
  // AI-invented quiz_* key would fail the whole upsert AFTER the flow went
  // live (half-published state). Unknown keys are dropped loudly instead.
  const liveSettings = (await getChatAssistantConfig(shopDomain)) as unknown as Record<string, unknown>;
  const liveKeys = new Set(Object.keys(snapshot.settings).concat(Object.keys(liveSettings)));
  const settingsToWrite: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  const snapshotSettings = snapshot.settings as Record<string, unknown>;
  for (const [key, value] of Object.entries(filterSettings(draft.settings))) {
    if (!liveKeys.has(key)) {
      droppedKeys.push(key);
      continue;
    }
    // Write only keys that actually CHANGED vs the pre-publish snapshot.
    // Both sides are default-coalesced, so writing everything would pin
    // NULL columns to literal default values on every publish.
    if (JSON.stringify(value) !== JSON.stringify(snapshotSettings[key])) {
      settingsToWrite[key] = value;
    }
  }
  if (droppedKeys.length) {
    console.warn(`quiz-draft: publish dropped unknown settings keys for ${shopDomain}: ${droppedKeys.join(", ")}`);
  }
  try {
    await saveChatAssistantConfig(shopDomain, settingsToWrite as Partial<ChatAssistantConfig>);
  } catch (e) {
    // The flow IS live at this point — say so plainly instead of a generic
    // failure (and the pre-publish snapshot above still holds the true
    // rollback state).
    return {
      ok: false,
      error: `Questions and rules published, but copy/design settings failed to save: ${(e as Error).message}. Retry publish; your previous config is archived in version history.`,
    };
  }

  const now = new Date().toISOString();
  const { data: published, error: publishError } = await supabase
    .from("quiz_config_versions")
    .update({ status: "published", published_at: now, updated_at: now })
    .eq("shop_id", shopId)
    .eq("status", "draft")
    .select("id");
  if (publishError || !published?.length) {
    // Live write succeeded; only the bookkeeping failed. Surface but don't
    // pretend the publish failed.
    console.error(`quiz-draft: publish bookkeeping failed for ${shopId}:`, publishError?.message ?? "0 rows");
  }

  // Bound version history: full-config jsonb rows grow unboundedly otherwise
  // (2 rows per publish). Keep the newest 30 non-draft versions per shop.
  try {
    const { data: old } = await supabase
      .from("quiz_config_versions")
      .select("id")
      .eq("shop_id", shopId)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .range(30, 1029);
    if (old?.length) {
      await supabase.from("quiz_config_versions").delete().in("id", old.map((r) => r.id));
    }
  } catch (e) {
    console.warn(`quiz-draft: version pruning failed for ${shopId}:`, e);
  }
  return { ok: true };
}

/** Copy an archived/published version into the draft slot (does NOT publish). */
export async function restoreVersion(shopId: string, versionId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("quiz_config_versions")
    .select("config, shop_id")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "version not found" };
  if (data.shop_id !== shopId) return { ok: false, error: "version belongs to a different shop" };
  return saveQuizDraft(shopId, data.config as QuizDraft, "manual");
}
