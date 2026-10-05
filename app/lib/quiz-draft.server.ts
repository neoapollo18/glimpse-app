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
//   3. Surface state (`enabled` and `assistant_mode`, which together decide
//      whether shoppers see the quiz) never flows through config saves:
//      turning the quiz surface on/off is an explicit action, never an
//      editing, restore or undo side effect.
//
// Concurrency: saveLiveQuizConfig does NOT take the shop save lock; every
// caller already runs inside withShopSaveLock (studio actions, copilot tool
// application, generator save). Taking it here too would deadlock.

import { phasesPartitionFlow } from "./quiz-templates";
import { templateLivePatch, TEMPLATES_NEED_MIGRATION_ERROR } from "./template-live.server";
import { isMissingColumnError } from "./brand-library-status";
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
 * copy) is out of the builder's blast radius by construction. `enabled` and
 * `assistant_mode` are in the allowlist for capture fidelity but are
 * stripped from every write by saveLiveQuizConfig; only the surface writer
 * (writeQuizSurface) changes them.
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
 * Cheap pre-check for generation: does this shop already have a quiz with
 * real content (any question with a non-blank prompt)? Used by the
 * generate route BEFORE it consumes rate-limit quota, so a merchant who
 * already has a quiz is told so without burning a run. False on any read
 * error - the locked save's hasRealContent guard stays the authoritative,
 * fail-closed check.
 */
export async function shopHasRealQuiz(shopId: string): Promise<boolean> {
  try {
    const live = await captureLiveConfig(shopId);
    return live.flow.questions.some((q) => (q.prompt ?? "").trim() !== "");
  } catch (e) {
    console.warn(`[quiz-live] shopHasRealQuiz read failed for ${shopId}: ${(e as Error).message}`);
    return false;
  }
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

/** Label prefix shared by every template-switch restore point. */
const TEMPLATE_SWITCH_LABEL_PREFIX = "Before switching from ";

/**
 * Version-history insurance for a template switch, which bypasses
 * saveLiveQuizConfig (it writes one chat_assistant_config column directly).
 * MUST be called while holding withShopSaveLock(shopId).
 *
 * Coalesced per editing burst: when the newest version is already a
 * template-switch restore point younger than SNAPSHOT_BUCKET_MS, it holds
 * the quiz as it was before the merchant started switching, and a switch
 * changes nothing but quiz_template, so every in-between state is one
 * gallery click away. Forcing a row per click instead (switch, Undo,
 * switch...) floods history and prunes the restore points that matter
 * (before restore, before start over, the generated quiz) out of the
 * KEEP_VERSIONS window.
 */
export async function snapshotBeforeTemplateSwitch(
  shopId: string,
  fromName: string,
  toName: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: newest } = await supabase
    .from("quiz_config_versions")
    .select("created_at, label")
    .eq("shop_id", shopId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    newest &&
    typeof newest.label === "string" &&
    newest.label.startsWith(TEMPLATE_SWITCH_LABEL_PREFIX) &&
    Date.now() - new Date(newest.created_at as string).getTime() < SNAPSHOT_BUCKET_MS
  ) {
    return { ok: true };
  }
  const snap = await snapshotLive(shopId, {
    label: `${TEMPLATE_SWITCH_LABEL_PREFIX}${fromName} to ${toName}`,
    force: true,
  });
  if (snap.ok) await pruneVersions(shopId);
  return snap;
}

/** One version's stored config, shop-checked (Studio version preview). */
export async function getVersionConfig(shopId: string, versionId: string): Promise<QuizDraft | null> {
  const { data, error } = await supabase
    .from("quiz_config_versions")
    .select("config, shop_id")
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data || data.shop_id !== shopId) return null;
  const cfg = data.config as QuizDraft | null;
  if (!cfg?.flow || !Array.isArray(cfg.flow.questions)) return null;
  return cfg;
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

  // Settings: allowlisted keys, minus the surface state (`enabled` and
  // `assistant_mode`: turning the quiz on/off is an explicit action, never
  // an editing side effect, and a restore or copilot undo of a snapshot
  // taken while the shop was chat-only must not take a live quiz down),
  // and only keys that actually CHANGED vs live. Both sides are
  // default-coalesced, so writing everything would pin NULL columns to
  // literal default values on every editor flush.
  const shopDomain = await domainForShop(shopId);
  const liveSettings = filterSettings(
    opts.preWriteConfig?.settings ?? (await getChatAssistantConfig(shopDomain)),
  ) as Record<string, unknown>;
  const settingsToWrite: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(filterSettings(config.settings))) {
    if (key === "enabled" || key === "assistant_mode") continue;
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

  // v3 Match phases: a structural edit (add / remove / reorder) leaves the
  // generator-written quiz_phases describing a flow that no longer exists.
  // Clear them when they no longer partition the saved question order; the
  // widget then renders the plain segmented header. Isolated write: an
  // un-run migration 080 or any failure here is a warning, never a lost
  // save.
  const livePhases = (liveSettings as Record<string, unknown>).quiz_phases;
  if (livePhases != null) {
    const order = config.flow.questions.map((q) => q.axisKey);
    if (!phasesPartitionFlow(livePhases, order)) {
      try {
        await saveChatAssistantConfig(shopDomain, { quiz_phases: null });
      } catch (e) {
        console.warn(`quiz-live: could not clear stale quiz_phases for ${shopDomain}: ${(e as Error).message}`);
      }
    }
  }

  await pruneVersions(shopId);
  return { ok: true, warning };
}

export type QuizSurfaceResult = { ok: boolean; error?: string; templateLive?: boolean };

/**
 * The one write for quiz-surface state (Studio Turn on/off, Publish /
 * unpublish, the dashboard mode switch). The caller's `fields` (enabled /
 * assistant_mode) and the template go-live stamp (migration 081,
 * template-live.server.ts) land in ONE upsert, so the storefront can never
 * see the surface on with a half-applied template state.
 *
 *   - quizOn=true reads with throwOnError: a failed read must not be
 *     mistaken for "no template" (that would turn a template quiz on as
 *     classic, silently).
 *   - quizOn=false is the safety action and is never blocked by a read
 *     error: the bare fields are written, and migration 081's trigger
 *     clears the stamp whenever the surface ends up off.
 *   - republish=false (dashboard mode switch): a quiz that is ALREADY on
 *     keeps its stamp as is, so adding or removing the chat bubble never
 *     publishes (or un-publishes) a template as a side effect. Publish and
 *     Turn on pass republish=true: they are the deliberate publish acts.
 */
export async function writeQuizSurface(
  shopDomain: string,
  quizOn: boolean,
  fields: (current: ChatAssistantConfig | null) => Partial<ChatAssistantConfig>,
  opts: { republish?: boolean } = {},
): Promise<QuizSurfaceResult> {
  try {
    let current: ChatAssistantConfig | null = null;
    try {
      current = await getChatAssistantConfig(shopDomain, { throwOnError: true });
    } catch (readErr) {
      if (quizOn) throw readErr;
    }
    const wasOn = Boolean(
      current?.enabled && (current.assistant_mode === "quiz" || current.assistant_mode === "both"),
    );
    const unchanged: ReturnType<typeof templateLivePatch> = { ok: true, patch: {} };
    const stamp =
      !current || (quizOn && wasOn && !opts.republish) ? unchanged : templateLivePatch(current, quizOn);
    if (!stamp.ok) return { ok: false, error: stamp.error };
    await saveChatAssistantConfig(shopDomain, { ...fields(current), ...stamp.patch } as Partial<ChatAssistantConfig>);
    return { ok: true, templateLive: Boolean(stamp.patch.template_live_at) };
  } catch (e) {
    const msg = (e as Error).message;
    // Only a genuinely missing column means "migration 081 not run": any
    // other error that merely names the column must surface as itself.
    if (isMissingColumnError({ message: msg }) && msg.includes("template_live_at")) {
      console.error(`[quiz-live] template_live_at write failed for ${shopDomain} (migration 081 not run?): ${msg}`);
      return { ok: false, error: TEMPLATES_NEED_MIGRATION_ERROR };
    }
    return { ok: false, error: msg };
  }
}

/**
 * The Studio / publish surface switch: what "publish" used to gate.
 * Turning ON also ensures assistant_mode includes the quiz surface ('chat'
 * becomes 'both', never silently killing the bubble) and, for a template
 * quiz, publishes the template (stamp); turning OFF un-publishes it.
 */
export async function setQuizSurfaceEnabled(
  shopId: string,
  enabled: boolean,
): Promise<QuizSurfaceResult> {
  const shopDomain = await domainForShop(shopId);
  return writeQuizSurface(
    shopDomain,
    enabled,
    (current) =>
      enabled
        ? {
            enabled: true,
            assistant_mode:
              current?.assistant_mode === "chat" || current?.assistant_mode === "both" ? "both" : "quiz",
          }
        : { enabled: false },
    { republish: true },
  );
}

/**
 * Restore a version straight to LIVE (the draft slot is gone). The current
 * live config is snapshotted first (forced, labeled), so a restore is
 * itself always undoable. Surface state (`enabled`, `assistant_mode`)
 * never flows through (saveLiveQuizConfig strips both), so restoring an old
 * version can't flip the surface.
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
