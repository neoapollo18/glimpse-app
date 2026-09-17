// Quiz config live-editing layer (save = live, 2026-09-16 rework).
//
// The draft model is gone: the studio, the AI copilot, and the generator all
// edit the LIVE config directly. quiz_config_versions still exists but only
// as version history: automatic time-bucketed snapshots taken before writes,
// restorable from the studio's Live step. What used to be "publish" is now
// just the surface toggle (setQuizSurfaceEnabled); config edits are on the
// site the moment they save.
//
// Safety model replacing the draft gate:
//   1. Every write is preceded by an archived snapshot of the current live
//      config (at most one per SNAPSHOT_BUCKET_MS, so an editing burst does
//      not flood history). Restore is one click.
//   2. Mid-edit invalid states (blank prompts, blank option labels) DO land
//      in the live tables, but the storefront read path
//      (getRecommendationFlow) filters them out, so shoppers only ever see
//      the valid subset. The studio problems checklist reports these as
//      "hidden from shoppers".
//   3. `enabled` never flows through config saves: turning the quiz surface
//      on/off is an explicit action, never an editing side effect.
//
// Concurrency: saveLiveQuizConfig does NOT take the shop save lock; every
// caller already runs inside withShopSaveLock (studio actions, copilot tool
// application, generator save). Taking it here too would deadlock.

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

export type SaveRecommendationConfigInput = Parameters<typeof saveRecommendationConfig>[1];

/** Shape kept from the draft era: every editor and applier speaks it. */
export interface QuizDraft {
  flow: SaveRecommendationConfigInput;
  settings: Partial<ChatAssistantConfig>;
}

export interface VersionSummary {
  id: string;
  status: "draft" | "published" | "archived";
  label: string | null;
  createdBy: "ai" | "manual" | "system" | "seed";
  createdAt: string;
  publishedAt: string | null;
}

/** One auto-snapshot per bucket while editing; restore granularity is the
 * burst, not the keystroke. Explicit snapshots (restore, legacy-archive)
 * bypass the bucket. */
const SNAPSHOT_BUCKET_MS = 10 * 60 * 1000;
const KEEP_VERSIONS = 30;

/**
 * Only these chat_assistant_config fields may flow from a config save to
 * live. Everything else on that row (chat/hero/bundle settings, analytics
 * copy) is out of the builder's blast radius by construction. `enabled` is
 * in the allowlist for capture/restore fidelity but is stripped from every
 * write by saveLiveQuizConfig; only setQuizSurfaceEnabled writes it.
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
  if (error || !data) throw new Error(`quiz-live: unknown shop id ${shopId}: ${error?.message ?? ""}`);
  return data.shop_domain as string;
}

export async function listVersions(shopId: string): Promise<VersionSummary[]> {
  const { data, error } = await supabase
    .from("quiz_config_versions")
    .select("id, status, label, created_by, created_at, published_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`quiz-live: listVersions failed: ${error.message}`);
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
 * Capture the CURRENT live config in editor shape. THE read path for every
 * editing surface (studio loader, copilot turn start, preview, guidance).
 * A shop with no quiz yet returns an empty flow, not null.
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
  // config's array order matches what shoppers actually see (Q1/Q2 numbering,
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
      if (!axis) throw new Error(`quiz-live: question ${q.id} references unknown axis ${q.axisId}`);
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
            throw new Error(`quiz-live: option ${opt.id} references unknown axis value ${opt.axisValueId}`);
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

/**
 * Referential check: every rule target must exist in the shop's non-deleted
 * catalog. Vanished targets (product archived/deleted since the rule was
 * written) are pruned from what goes live, not blocked: the runtime
 * candidate pool drops non-live products anyway, and the pre-write snapshot
 * keeps the full rule set restorable. Only rules with no target at all
 * block the save.
 */
async function checkRuleTargets(
  shopId: string,
  flow: SaveRecommendationConfigInput,
): Promise<{ blocking: string[]; pruneIndexes: Set<number>; prunedNames: string[] }> {
  // Nothing to validate without rules — skip the catalog-wide variant
  // fetch on the (hot) editing path of ai-mode and rule-less shops.
  if (!flow.rules || flow.rules.length === 0) {
    return { blocking: [], pruneIndexes: new Set(), prunedNames: [] };
  }
  const targets = await getShopVariantsFlat(shopId);
  const productIds = new Set(targets.filter((t) => t.kind === "product").map((t) => t.id));
  const variantIds = new Set(targets.filter((t) => t.kind === "variant").map((t) => t.id));
  const blocking: string[] = [];
  const pruneIndexes = new Set<number>();
  const missingProducts = new Set<string>();
  const missingVariants = new Set<string>();
  (flow.rules || []).forEach((rule, i) => {
    if (rule.productId && !productIds.has(rule.productId)) {
      pruneIndexes.add(i);
      missingProducts.add(rule.productId);
    }
    if (rule.variantId && !variantIds.has(rule.variantId)) {
      pruneIndexes.add(i);
      missingVariants.add(rule.variantId);
    }
    if (!rule.productId && !rule.variantId) {
      blocking.push(`rule ${i + 1} has no target`);
    }
  });

  // Best-effort names for the save warning: vanished targets usually still
  // exist as archived/soft-deleted rows, so the merchant sees "Cherry Red"
  // instead of a UUID they can't map to anything.
  const prunedNames: string[] = [];
  if (missingProducts.size > 0) {
    const { data } = await supabase
      .from("products")
      .select("id, product_name")
      .in("id", [...missingProducts]);
    const nameById = new Map((data ?? []).map((p: any) => [p.id as string, p.product_name as string]));
    for (const id of missingProducts) prunedNames.push(nameById.get(id) || `product ${id.slice(0, 8)}`);
  }
  if (missingVariants.size > 0) {
    const { data } = await supabase
      .from("product_variants")
      .select("id, variant_title, products ( product_name )")
      .in("id", [...missingVariants]);
    const labelById = new Map(
      (data ?? []).map((v: any) => [
        v.id as string,
        [(v.products?.product_name as string) || "", (v.variant_title as string) || ""].filter(Boolean).join(" / "),
      ]),
    );
    for (const id of missingVariants) prunedNames.push(labelById.get(id) || `variant ${id.slice(0, 8)}`);
  }
  return { blocking, pruneIndexes, prunedNames };
}

/**
 * Snapshot the current live config into version history. Auto snapshots
 * (label null) are time-bucketed; explicit ones (restore insurance, legacy
 * draft archive) always write. Failure to snapshot ABORTS the caller's
 * write: editing live without rollback insurance is how configs get lost.
 */
async function snapshotLive(
  shopId: string,
  opts: { label?: string; force?: boolean; preCaptured?: QuizDraft } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!opts.force) {
    const { data: newest } = await supabase
      .from("quiz_config_versions")
      .select("created_at")
      .eq("shop_id", shopId)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (newest && Date.now() - new Date(newest.created_at as string).getTime() < SNAPSHOT_BUCKET_MS) {
      return { ok: true }; // bucket already has a snapshot; skip
    }
  }
  // Editing callers just read the live config under the same lock — reuse
  // it instead of re-running the multi-query capture on every save.
  let snapshot: QuizDraft;
  try {
    snapshot = opts.preCaptured ?? (await captureLiveConfig(shopId));
  } catch (e) {
    return { ok: false, error: `could not snapshot live config: ${(e as Error).message}` };
  }
  // A shop with no quiz yet has nothing worth archiving.
  if (snapshot.flow.questions.length === 0 && snapshot.flow.axes.length === 0) return { ok: true };
  const { data, error } = await supabase
    .from("quiz_config_versions")
    .insert({
      shop_id: shopId,
      status: "archived",
      config: snapshot,
      created_by: "system",
      label: opts.label ?? "auto-snapshot",
    })
    .select("id");
  if (error || !data?.length) return { ok: false, error: error?.message ?? "snapshot wrote 0 rows" };
  return { ok: true };
}

async function pruneVersions(shopId: string): Promise<void> {
  // Bound version history: full-config jsonb rows grow unboundedly otherwise.
  try {
    const { data: old } = await supabase
      .from("quiz_config_versions")
      .select("id")
      .eq("shop_id", shopId)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .range(KEEP_VERSIONS, KEEP_VERSIONS + 999);
    if (old?.length) {
      await supabase.from("quiz_config_versions").delete().in("id", old.map((r) => r.id));
    }
  } catch (e) {
    console.warn(`quiz-live: version pruning failed for ${shopId}:`, e);
  }
}

/**
 * Write a config to the LIVE tables. This is the single write path for the
 * studio appliers, the copilot, the generator, and restore.
 *
 * MUST be called while holding withShopSaveLock(shopId) — it does not take
 * the lock itself (its callers already do, and the lock is not reentrant).
 */
export async function saveLiveQuizConfig(
  shopId: string,
  config: QuizDraft,
  opts: {
    snapshotLabel?: string;
    forceSnapshot?: boolean;
    /** The live config as read (under the SAME lock) just before the
     * caller applied its patches. Passing it saves a full re-capture for
     * the pre-write snapshot AND provides the settings baseline for the
     * changed-keys diff. Editing paths should always pass it. */
    preWriteConfig?: QuizDraft;
  } = {},
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  if (!config?.flow || !Array.isArray(config.flow.axes) || !Array.isArray(config.flow.questions)) {
    return { ok: false, error: "Malformed config (missing flow)" };
  }

  const ruleCheck = await checkRuleTargets(shopId, config.flow);
  if (ruleCheck.blocking.length > 0) {
    return { ok: false, error: `Invalid rules: ${ruleCheck.blocking.slice(0, 5).join("; ")}` };
  }

  const snap = await snapshotLive(shopId, {
    label: opts.snapshotLabel,
    force: opts.forceSnapshot,
    preCaptured: opts.preWriteConfig,
  });
  if (!snap.ok) return { ok: false, error: `Save aborted: ${snap.error}` };

  // Storefront question order = axis position; editors use array order.
  // Renumber axis positions from the question array so what the merchant
  // sees in the studio is exactly what serves.
  const orderedFlow = normalizeFlowOrder(config.flow as Parameters<typeof normalizeFlowOrder>[0]) as QuizDraft["flow"];

  let warning: string | undefined;
  if (ruleCheck.pruneIndexes.size > 0) {
    orderedFlow.rules = (orderedFlow.rules || []).filter((_, i) => !ruleCheck.pruneIndexes.has(i));
    const shown = ruleCheck.prunedNames.slice(0, 5).join(", ");
    const more = ruleCheck.prunedNames.length > 5 ? ` (+${ruleCheck.prunedNames.length - 5} more)` : "";
    warning = `${ruleCheck.pruneIndexes.size} recommendation rule${ruleCheck.pruneIndexes.size === 1 ? "" : "s"} pointing at products no longer in your catalog ${ruleCheck.pruneIndexes.size === 1 ? "was" : "were"} skipped: ${shown}${more}.`;
    console.warn(`quiz-live: save pruned ${ruleCheck.pruneIndexes.size} vanished-target rule(s) for shop ${shopId}: ${ruleCheck.prunedNames.join(", ")}`);
  }

  // Atomic RPC: constraint failure rolls back the whole flow rewrite.
  const flowResult = await saveRecommendationConfig(shopId, orderedFlow);
  if (!flowResult.ok) return { ok: false, error: flowResult.error };

  // Settings: allowlisted keys, minus `enabled` (surface on/off is an
  // explicit action, never an editing side effect), and only keys that
  // actually CHANGED vs live. Both sides are default-coalesced, so writing
  // everything would pin NULL columns to literal default values on every
  // editor flush.
  const shopDomain = await domainForShop(shopId);
  const liveSettings = filterSettings(
    opts.preWriteConfig?.settings ?? (await getChatAssistantConfig(shopDomain)),
  ) as Record<string, unknown>;
  const settingsToWrite: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(filterSettings(config.settings))) {
    if (key === "enabled") continue;
    // Only write keys that exist on the live row: a stale quiz_* key (an
    // old restored version predating a column rename, or an AI-invented
    // key) would fail the whole settings upsert AFTER the flow already
    // went live. Drop them loudly instead — the old publish had this
    // guard and losing it reintroduced the half-write hazard.
    if (!(key in liveSettings)) {
      droppedKeys.push(key);
      continue;
    }
    if (JSON.stringify(value) !== JSON.stringify(liveSettings[key])) {
      settingsToWrite[key] = value;
    }
  }
  if (droppedKeys.length) {
    console.warn(`quiz-live: save dropped unknown settings keys for ${shopDomain}: ${droppedKeys.join(", ")}`);
  }
  if (Object.keys(settingsToWrite).length > 0) {
    try {
      await saveChatAssistantConfig(shopDomain, settingsToWrite as Partial<ChatAssistantConfig>);
    } catch (e) {
      return {
        ok: false,
        error: `Questions saved, but copy/design settings failed: ${(e as Error).message}. Your previous config is in version history.`,
        warning,
      };
    }
  }

  await pruneVersions(shopId);
  return { ok: true, warning };
}

/**
 * The one write path for the quiz surface flag: what "publish" used to
 * gate. Turning ON also ensures assistant_mode includes the quiz surface
 * ('chat' becomes 'both', never silently killing the bubble).
 */
export async function setQuizSurfaceEnabled(
  shopId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const shopDomain = await domainForShop(shopId);
  try {
    const patch: Partial<ChatAssistantConfig> = { enabled } as Partial<ChatAssistantConfig>;
    if (enabled) {
      const current = await getChatAssistantConfig(shopDomain);
      (patch as Record<string, unknown>).assistant_mode =
        current.assistant_mode === "chat" || current.assistant_mode === "both" ? "both" : "quiz";
    }
    await saveChatAssistantConfig(shopDomain, patch);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Restore a version straight to LIVE (the draft slot is gone). The current
 * live config is snapshotted first (forced, labeled), so a restore is
 * itself always undoable. `enabled` never flows through (saveLiveQuizConfig
 * strips it), so restoring an old version can't flip the surface.
 *
 * MUST be called while holding withShopSaveLock(shopId).
 */
export async function restoreVersion(shopId: string, versionId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("quiz_config_versions")
    .select("config, shop_id")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "version not found" };
  if (data.shop_id !== shopId) return { ok: false, error: "version belongs to a different shop" };
  return saveLiveQuizConfig(shopId, data.config as QuizDraft, {
    snapshotLabel: "before restore",
    forceSnapshot: true,
  });
}

/**
 * One-time lazy migration from the draft era: archive any leftover
 * status='draft' row so its work stays restorable from version history.
 * Never-edited seed drafts are just deleted (they were snapshots of live).
 * Returns whether a real (edited) draft was archived, so the studio can
 * tell the merchant where their old work went.
 */
export async function archiveLegacyDraft(shopId: string): Promise<{ archived: boolean }> {
  const { data, error } = await supabase
    .from("quiz_config_versions")
    .select("id, created_by")
    .eq("shop_id", shopId)
    .eq("status", "draft")
    .maybeSingle();
  if (error || !data) return { archived: false };
  if (data.created_by === "seed") {
    await supabase.from("quiz_config_versions").delete().eq("id", data.id);
    return { archived: false };
  }
  const { error: updErr } = await supabase
    .from("quiz_config_versions")
    .update({ status: "archived", label: "your old draft (from before live editing)", updated_at: new Date().toISOString() })
    .eq("id", data.id);
  if (updErr) {
    console.error(`quiz-live: legacy draft archive failed for ${shopId}:`, updErr.message);
    return { archived: false };
  }
  return { archived: true };
}
