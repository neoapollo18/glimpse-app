import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator, useRouteError, useSearchParams } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { Banner, Button, Modal, Text } from "@shopify/polaris";
import { useCallback, useEffect, useRef, useState } from "react";
import jwt from "jsonwebtoken";

import { authenticate } from "../shopify.server";
import {
  findShopByDomain,
  supabase,
  getQuestionGuidance,
  upsertQuestionGuidance,
  deleteQuestionGuidance,
  getRecommendationCounts,
  getChatAssistantConfig,
} from "../lib/supabase.server";
import {
  captureLiveConfig,
  saveLiveQuizConfig,
  setQuizSurfaceEnabled,
  archiveLegacyDraft,
  restoreVersion,
  listVersions,
  type QuizDraft,
} from "../lib/quiz-draft.server";
import { APPLIERS, type DraftShape } from "../lib/quiz-copilot-tools.server";
import { loadCatalogForShop } from "../lib/quiz-generator.server";
import { buildPreviewFlow, buildPreviewQuizConfig } from "../lib/quiz-preview.server";
import { withShopSaveLock } from "../lib/shop-save-lock.server";
import { getLatestSessionId } from "../lib/quiz-copilot.server";
import { isClaudeConfigured } from "../lib/claude.server";
import { getGenStatus } from "../lib/gen-status.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { draftQuestionNotes, type NotesDraft } from "../lib/guidance-generator.server";
import { GENERAL_GUIDANCE_KEY } from "../lib/quiz-guidance-shared";
import { getBrandProfile } from "../lib/brand-profile.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";
import {
  TEMPLATES,
  TEMPLATE_IDS,
  findPreset,
  resolveQuizTokens,
  type TemplateId,
} from "../lib/quiz-templates";

import { StudioShell } from "../components/studio/StudioShell";
import { StudioTopBar } from "../components/studio/StudioTopBar";
import { SlideTree, slideIdForQuestion, buildScreens } from "../components/studio/SlideTree";
import { PreviewCanvas, type CanvasTheme } from "../components/studio/PreviewCanvas";
import { EditPanel } from "../components/studio/EditPanel";
import { ChatPanel } from "../components/studio/ChatPanel";
import { CheckMatches } from "../components/studio/CheckMatches";
import { LiveTab, PublishSheet } from "../components/studio/PublishStep";
import { TemplateOverlay } from "../components/studio/TemplateOverlay";
import { ImagesRail } from "../components/studio/ImagesRail";
import { FlowMap } from "../components/studio/FlowMap";
import { draftProblems } from "../components/studio/draft-problems";
import { navigateParent } from "../components/studio/navigate-parent";
import { postStudioAction } from "../components/studio/studio-data";
import type { StudioFlow } from "../components/studio/types";

// ---------------------------------------------------------------------
// Quiz Studio — the full-screen takeover editor (opened from the quiz hub
// in an App Bridge max modal, or directly at /studio). Lives OUTSIDE the
// /app layout on purpose: no NavMenu (we're a takeover), and no Mantle
// billing check on every one of the many revalidations an editing session
// produces. Same standalone-route precedent as quiz-preview[.]html.ts.
//
// The studio edits the LIVE config directly (save = live; the draft layer
// is gone). Manual edits go through the SAME appliers the AI copilot uses
// (apply-tool intent), so both paths share validation (including the
// earlier-axis showIf rule). Every save auto-snapshots the previous state
// into version history; mid-edit invalid questions are filtered out at
// storefront serve time, never shown to shoppers.
//
// NAMING NOTE: the loader key and component props are still called `draft`
// (QuizDraft type, data.draft) to keep this rework reviewable — they now
// always hold the live config.
// ---------------------------------------------------------------------

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

// Catalog sync submits one fetcher action per 8-product page; each would
// otherwise re-run this heavy loader (a 400-product store = ~50 loader
// runs). The sync UIs render from the hook's own progress state, and the
// completion handler revalidates explicitly.
export const shouldRevalidate = ({ formAction, defaultShouldRevalidate }: { formAction?: string; defaultShouldRevalidate: boolean }) => {
  if (formAction?.includes("/app/api/catalog-sync")) return false;
  return defaultShouldRevalidate;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  // Keep it self-contained: boundary.error handles Shopify auth responses
  // (redirects/reauth); anything else gets a plain message since the studio
  // chrome itself may be what failed.
  return boundary.error(useRouteError());
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  // Standalone route = not under app.tsx's billing gate; enforce it here.
  // NOT a redirect: the studio loads inside an App Bridge max-modal iframe,
  // and a loader redirect would render the full /app/billing page (nested
  // admin layout and all) INSIDE the modal. Return a marker instead; the
  // client breaks out via navigateParent (same channel the publish screen
  // uses).
  if (await shopNeedsBilling(shopDomain, session.accessToken ?? "")) {
    return json({ billingRequired: true as const, apiKey: process.env.SHOPIFY_API_KEY || "" });
  }
  const shop = await findShopByDomain(shopDomain);
  if (!shop) throw new Response("Shop not found", { status: 404 });

  // Lazy migration from the draft era: park any leftover draft row in
  // version history (restorable from the Live step) BEFORE reading live.
  const legacy = await archiveLegacyDraft(shop.id).catch(() => ({ archived: false }));

  const [liveLoaded, versions, shopRowRes, copilotSessionId, notes, counts, liveConfig, brandProfile, imageSlots] =
    await Promise.all([
      captureLiveConfig(shop.id).catch((e) => {
        console.error("[studio] live config load failed:", e.message);
        return null;
      }),
      listVersions(shop.id).catch(() => []),
      supabase.from("shops").select("*").eq("id", shop.id).single(),
      getLatestSessionId(shop.id).catch(() => null),
      getQuestionGuidance(shop.id),
      getRecommendationCounts(shop.id).catch(() => null),
      getChatAssistantConfig(shopDomain).catch(() => null),
      getBrandProfile(shopDomain).catch(() => null),
      // Image slot assignments (V2-SPEC 4.4). Read directly and tolerantly:
      // the column ships with the brand-library package, so a missing
      // column must degrade to "no assignments", never a 500.
      (async (): Promise<Record<string, string>> => {
        try {
          const r = await supabase
            .from("chat_assistant_config")
            .select("quiz_image_slots")
            .eq("shop_domain", shopDomain)
            .maybeSingle();
          const v = (r.data as Record<string, unknown> | null)?.quiz_image_slots;
          return v && typeof v === "object" ? (v as Record<string, string>) : {};
        } catch {
          return {};
        }
      })(),
    ]);
  const shopRow = shopRowRes.data;
  const liveQuestionCount = counts?.questions ?? 0;

  // `draft` now IS the live config (see naming note above). A shop with no
  // quiz yet gets null so the onboarding wizard shows.
  const draft = liveLoaded && liveLoaded.flow.questions.length > 0 ? liveLoaded : null;

  // Settings the slide editors show: live quiz_* values as the base (the
  // preview merges the same way). With save-to-live editing the captured
  // config's settings ARE the live values; the merge stays because the
  // capture only carries allowlisted keys while liveConfig has them all.
  const settings: Record<string, unknown> = {};
  if (liveConfig) {
    for (const [k, v] of Object.entries(liveConfig as unknown as Record<string, unknown>)) {
      if (k.startsWith("quiz_")) settings[k] = v;
    }
  }
  Object.assign(settings, (draft?.settings ?? {}) as Record<string, unknown>);

  // Is the storefront quiz surface on right now? Storefront gate:
  // enabled && mode in (quiz, both) (api.storefront.quiz-config). Unknown
  // values fail open so a config load hiccup doesn't wrongly tell the
  // merchant their quiz is hidden.
  const liveSurface = liveConfig as unknown as Record<string, unknown> | null;
  const surfaceEnabled = liveSurface?.enabled !== false;
  const surfaceMode = liveSurface?.assistant_mode;
  const quizSurfaceEnabled =
    surfaceEnabled && (surfaceMode == null || surfaceMode === "quiz" || surfaceMode === "both");

  // ---- Themed-canvas + first-run banner data (V2-SPEC Part 2) ----
  const template = typeof settings.quiz_template === "string" ? (settings.quiz_template as string) : null;
  const preset = typeof settings.quiz_preset === "string" ? (settings.quiz_preset as string) : null;
  const tokens = resolveQuizTokens(template, preset, brandProfile?.tokens ?? null);
  const storeName = shopDomain
    .replace(".myshopify.com", "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const headingFont = tokens?.fontHeading ?? "inherit";
  const fontWord = /serif/i.test(headingFont) && !/sans-serif/i.test(headingFont.split(",")[0])
    ? "Serif headings"
    : /rounded|nunito|quicksand/i.test(headingFont)
      ? "Rounded headings"
      : "Clean sans headings";
  const paletteWord = ((): string => {
    const hex = /^#([0-9a-f]{6})$/i.exec(tokens?.colorBg ?? "");
    if (!hex) return "soft neutral palette";
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum > 0.96) return "clean white palette";
    if (lum > 0.82) return r > b ? "warm ivory palette" : "cool porcelain palette";
    if (lum < 0.25) return "deep noir palette";
    return "soft neutral palette";
  })();
  const templateName = template && TEMPLATE_IDS.includes(template as TemplateId)
    ? TEMPLATES[template as TemplateId].name
    : null;
  const studio = {
    storeName,
    logoUrl: brandProfile?.brand.logoUrl ?? null,
    canvasBg: tokens?.colorBg ?? "#F6F6F7",
    canvasInk: tokens?.colorText ?? "#1A1C1E",
    headingFont,
    template,
    preset,
    templateName,
    presetLabel: preset ? findPreset(preset)?.label ?? null : null,
    // Eligibility from the brand profile's assignment; absent profile =
    // everything selectable (spec 2.4 default).
    eligible: (brandProfile?.templateAssignment?.eligible as TemplateId[] | undefined) ?? [...TEMPLATE_IDS],
    confidence: brandProfile?.confidence ?? null,
    chips: [fontWord, paletteWord, templateName ? `${templateName} template` : null].filter(
      (c): c is string => c !== null,
    ),
    imageSlots,
  };

  // 2h: re-minted on every studio load, so only a tab left open past 2h
  // needs a reload for the preview iframe. Keeping it short limits how long
  // a leaked preview URL can read the shop's draft.
  const previewToken = process.env.SHOPIFY_API_SECRET
    ? jwt.sign({ shopId: shop.id, shopDomain }, process.env.SHOPIFY_API_SECRET, { expiresIn: "2h" })
    : null;

  // Intercom renders per-document, and the studio is its own document
  // (max-modal iframe) — the /app layout's launcher sits obscured UNDER the
  // modal for the whole editing session. Boot a second messenger instance
  // in here, with the same identity-verification JWT app.tsx mints.
  const intercomSecretKey = process.env.INTERCOM_SECRET_KEY || "";
  const intercomUserJwt = intercomSecretKey
    ? jwt.sign({ user_id: shopDomain }, intercomSecretKey, { expiresIn: "1h" })
    : "";

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    intercomAppId: process.env.INTERCOM_APP_ID || "",
    intercomUserJwt,
    shopDomain,
    draft,
    hasDraft: draft !== null,
    legacyDraftArchived: legacy.archived,
    versions,
    notes,
    settings,
    aiConfigured: isClaudeConfigured(),
    previewToken,
    copilotSessionId,
    liveQuestionCount,
    quizSurfaceEnabled,
    studio,
    genStatus: getGenStatus(shop.id),
    catalog: {
      syncEnabled: (shopRow as any)?.catalog_sync_enabled === true,
      lastSyncedAt: ((shopRow as any)?.catalog_last_synced_at as string | null) ?? null,
      cursor: ((shopRow as any)?.catalog_sync_cursor as string | null) ?? null,
      productCount: ((shopRow as any)?.catalog_product_count as number | null) ?? null,
    },
  });
};

export type StudioActionData = {
  ok: boolean;
  error?: string;
  intent?: string;
  needsConfirm?: boolean;
  /** Fresh preview payloads after a successful apply-tool, for the
   * no-reload gleame-preview-update postMessage. */
  previewFlow?: unknown;
  previewConfig?: unknown;
  /** AI-drafted logic notes (draft-notes intent). */
  notesDraft?: NotesDraft;
};

const NOTE_KEY_RE = /^[a-z_][a-z0-9_]*$/;
const NOTE_MAX_LEN = 4000;

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
  if (await shopNeedsBilling(shopDomain, session.accessToken ?? "")) {
    return json({ ok: false, error: "Your Gleame subscription isn't active. Visit Billing to continue." }, { status: 402 });
  }
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    switch (intent) {
      case "apply-tools": {
        // Batched edits from one editor flush (e.g. question patch + options
        // replace). ONE submission per flush — two sequential fetcher
        // submits abort the first request client-side and silently dropped
        // the question patch.
        let calls: Array<{ tool: string; input: unknown }>;
        try {
          calls = JSON.parse((formData.get("calls") as string) || "[]");
        } catch {
          return json({ ok: false, error: "Malformed edit", intent }, { status: 400 });
        }
        if (!Array.isArray(calls) || calls.length === 0 || calls.length > 5) {
          return json({ ok: false, error: "Malformed edit", intent }, { status: 400 });
        }
        for (const c of calls) {
          if (!c?.tool || !(c.tool in APPLIERS) || c.tool === "get_draft_details") {
            return json({ ok: false, error: "Unknown edit", intent }, { status: 400 });
          }
        }
        const batchResult = await withShopSaveLock(shop.id, async () => {
          const before = await captureLiveConfig(shop.id);
          const catalog = await loadCatalogForShop(shop.id);
          let draft = before;
          for (const c of calls) {
            const applied = APPLIERS[c.tool](draft as DraftShape, c.input, catalog);
            if (!applied.ok) return { ok: false as const, error: applied.error };
            draft = applied.draft as QuizDraft;
          }
          const saved = await saveLiveQuizConfig(shop.id, draft, { preWriteConfig: before });
          if (!saved.ok) return { ok: false as const, error: saved.error ?? "Save failed" };
          return { ok: true as const, draft };
        });
        if (!batchResult.ok) return json({ ok: false, error: batchResult.error, intent });
        const batchConfig = await buildPreviewQuizConfig(shopDomain, batchResult.draft).catch(() => null);
        return json({
          ok: true,
          intent,
          previewFlow: buildPreviewFlow(batchResult.draft),
          previewConfig: batchConfig,
        });
      }
      case "apply-tool": {
        const tool = formData.get("tool") as string;
        if (!tool || !(tool in APPLIERS) || tool === "get_draft_details") {
          return json({ ok: false, error: "Unknown edit", intent }, { status: 400 });
        }
        let input: unknown;
        try {
          input = JSON.parse((formData.get("input") as string) || "{}");
        } catch {
          return json({ ok: false, error: "Malformed edit", intent }, { status: 400 });
        }
        // Serialized per shop: a copilot turn or a second tab saving
        // concurrently would otherwise interleave read-modify-write.
        const result = await withShopSaveLock(shop.id, async () => {
          const draft = await captureLiveConfig(shop.id);
          const catalog = await loadCatalogForShop(shop.id);
          const applied = APPLIERS[tool](draft as DraftShape, input, catalog);
          if (!applied.ok) return { ok: false as const, error: applied.error };
          // Question deletes force a labeled snapshot (the confirm dialog
          // promises one); ordinary edits use the time-bucketed auto ones.
          const saved = await saveLiveQuizConfig(shop.id, applied.draft as QuizDraft, {
            preWriteConfig: draft,
            ...(tool === "remove_question"
              ? { snapshotLabel: "before question delete", forceSnapshot: true }
              : {}),
          });
          if (!saved.ok) return { ok: false as const, error: saved.error ?? "Save failed" };
          return { ok: true as const, draft: applied.draft as QuizDraft };
        });
        if (!result.ok) return json({ ok: false, error: result.error, intent });
        const [previewConfig] = await Promise.all([
          buildPreviewQuizConfig(shopDomain, result.draft).catch(() => null),
        ]);
        return json({
          ok: true,
          intent,
          previewFlow: buildPreviewFlow(result.draft),
          previewConfig,
        });
      }
      case "start-blank-draft": {
        // "Start from scratch" in the wizard: one untitled question with two
        // blank answers, ready to edit. Built directly (drafts are lazily
        // validated; the applier's revalidation would reject blank prompts)
        // and guarded so a stale tab can't blank an existing draft.
        // The wizard's accent color is applied HERE: revalidation unmounts
        // the wizard before its fetcher settles, so a client-side follow-up
        // apply never ran.
        const rawAccent = String(formData.get("accentColor") ?? "");
        const accentColor = /^#[0-9a-fA-F]{6}$/.test(rawAccent) ? rawAccent : null;
        const result = await withShopSaveLock(shop.id, async () => {
          const existing = await captureLiveConfig(shop.id);
          if (existing.flow.questions.length > 0) {
            return { ok: true as const }; // already have content; nothing to do
          }
          const blank: QuizDraft = {
            flow: {
              axes: [
                {
                  key: "question_1",
                  label: "Question 1",
                  source: "user_question",
                  position: 0,
                  values: [
                    { value: "option_1", label: "Option 1", position: 0 },
                    { value: "option_2", label: "Option 2", position: 1 },
                  ],
                },
              ],
              questions: [
                {
                  axisKey: "question_1",
                  prompt: "",
                  helperText: null,
                  multiSelect: false,
                  maxSelections: null,
                  screenGroup: null,
                  showIf: null,
                  optionStyle: null,
                  options: [
                    { label: "", axisValueValue: "option_1", botResponse: null, position: 0 },
                    { label: "", axisValueValue: "option_2", botResponse: null, position: 1 },
                  ],
                },
              ],
              rules: [],
            },
            settings: {
              ...(existing.settings ?? {}),
              ...(accentColor ? { quiz_accent_color: accentColor } : {}),
              // NOT enabled here: with save-to-live editing the surface
              // toggle is an explicit action on the Live step, never a
              // side effect of starting to build.
            },
          };
          const saved = await saveLiveQuizConfig(shop.id, blank, { preWriteConfig: existing });
          if (!saved.ok) return { ok: false as const, error: saved.error ?? "Save failed" };
          return { ok: true as const };
        });
        return json({ ...result, intent });
      }
      case "set-live": {
        // The Live step's surface toggle: the one deliberate action left
        // from the publish era. Config edits are already on the site.
        const enabled = String(formData.get("enabled")) === "true";
        if (enabled) {
          // The old publish gate, relocated: a matrix-mode quiz with zero
          // rules recommends from the generic fallback pool — don't let it
          // in front of shoppers. (ai/hybrid rank without rules by design.)
          const [counts, cfg] = await Promise.all([
            getRecommendationCounts(shop.id).catch(() => null),
            getChatAssistantConfig(shopDomain).catch(() => null),
          ]);
          if ((counts?.questions ?? 0) === 0) {
            return json({ ok: false, error: "Your quiz has no questions yet.", intent });
          }
          if ((counts?.rules ?? 0) === 0 && (cfg?.recommendation_mode ?? "matrix") === "matrix") {
            return json({
              ok: false,
              error:
                "Your quiz has no recommendation logic yet. Open Check matches to pin products to answer paths (or generate logic under Advanced) before turning the quiz on.",
              intent,
            });
          }
        }
        const result = await setQuizSurfaceEnabled(shop.id, enabled);
        return json({ ...result, intent });
      }
      case "start-over": {
        // Wipe the quiz back to nothing so the onboarding wizard shows and
        // the merchant can generate or build fresh. The current quiz is
        // snapshotted (forced, labeled) so this is one restore away from
        // undone. Refused while the surface is on: shoppers would hit an
        // empty quiz between the wipe and the rebuild.
        const result = await withShopSaveLock(shop.id, async () => {
          const current = await captureLiveConfig(shop.id);
          if (current.flow.questions.length === 0 && current.flow.axes.length === 0) {
            return { ok: true as const }; // already blank
          }
          const cfg = await getChatAssistantConfig(shopDomain).catch(() => null);
          const surfaceOn = Boolean(
            cfg?.enabled && (cfg?.assistant_mode === "quiz" || cfg?.assistant_mode === "both"),
          );
          if (surfaceOn) {
            return {
              ok: false as const,
              error: "Turn the quiz off for shoppers first (the switch above), then start over.",
            };
          }
          // Settings (styling, pool, guidance) are kept — starting over
          // rebuilds the questions, not the brand look. The snapshot holds
          // the full old config either way.
          const saved = await saveLiveQuizConfig(
            shop.id,
            { flow: { axes: [], questions: [], rules: [] }, settings: current.settings },
            { snapshotLabel: "before start over", forceSnapshot: true, preWriteConfig: current },
          );
          if (!saved.ok) return { ok: false as const, error: saved.error ?? "Start over failed" };
          return { ok: true as const };
        });
        return json({ ...result, intent });
      }
      case "restore": {
        const versionId = formData.get("versionId") as string;
        if (!versionId) return json({ ok: false, error: "Missing versionId", intent });
        // Locked for the same reason as discard: a concurrent editor save
        // based on the pre-restore draft must not overwrite the restore.
        const result = await withShopSaveLock(shop.id, () => restoreVersion(shop.id, versionId));
        return json({ ...result, intent });
      }
      case "save-notes": {
        // Presence-guarded: only submitted keys are written (client sends
        // dirty keys only), so a stale tab can't blank other notes.
        for (const [field, value] of formData.entries()) {
          if (!field.startsWith("notes:") || typeof value !== "string") continue;
          const axisKey = field.slice("notes:".length);
          if (!NOTE_KEY_RE.test(axisKey)) continue;
          const saved = await upsertQuestionGuidance(shop.id, axisKey, value.slice(0, NOTE_MAX_LEN));
          if (!saved.ok) return json({ ok: false, error: saved.error ?? "Save failed", intent });
        }
        return json({ ok: true, intent });
      }
      case "draft-notes": {
        // AI first-pass of the Logic notes. Returns the draft to the client
        // only — the merchant reviews/edits and the rows save via save-notes.
        if (!isClaudeConfigured()) {
          return json({ ok: false, error: "AI drafting isn't available for this installation.", intent });
        }
        let axisKeys: string[] | undefined;
        const rawKeys = formData.get("axisKeys");
        if (typeof rawKeys === "string" && rawKeys) {
          try {
            const parsed = JSON.parse(rawKeys);
            if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string" && NOTE_KEY_RE.test(k))) {
              axisKeys = parsed;
            } else {
              return json({ ok: false, error: "Malformed request", intent }, { status: 400 });
            }
          } catch {
            return json({ ok: false, error: "Malformed request", intent }, { status: 400 });
          }
        }
        const drafted = await draftQuestionNotes({ shopId: shop.id, shopDomain, axisKeys });
        if (!drafted.ok) return json({ ok: false, error: drafted.error, intent });
        return json({ ok: true, intent, notesDraft: drafted.draft });
      }
      case "activate-guidance": {
        // Guidance + mode save straight to live, same as every other edit.
        const guidanceText = String(formData.get("guidanceText") ?? "").trim();
        const mode = formData.get("mode");
        if (!guidanceText) return json({ ok: false, error: "Guidance is empty", intent });
        if (mode !== "ai" && mode !== "hybrid") {
          return json({ ok: false, error: "Invalid ranking mode", intent });
        }
        const result = await withShopSaveLock(shop.id, async () => {
          const draft = await captureLiveConfig(shop.id);
          const catalog = await loadCatalogForShop(shop.id);
          const g = APPLIERS.update_guidance(draft as DraftShape, { aiGuidance: guidanceText }, catalog);
          if (!g.ok) return { ok: false as const, error: g.error };
          const m = APPLIERS.update_recommendation_mode(g.draft as DraftShape, { mode }, catalog);
          if (!m.ok) return { ok: false as const, error: m.error };
          const saved = await saveLiveQuizConfig(shop.id, m.draft as QuizDraft, { preWriteConfig: draft });
          if (!saved.ok) return { ok: false as const, error: saved.error ?? "Save failed" };
          return { ok: true as const };
        });
        return json({ ...result, intent });
      }
      case "delete-orphan-note": {
        const axisKey = String(formData.get("axisKey") ?? "");
        if (!NOTE_KEY_RE.test(axisKey) || axisKey === GENERAL_GUIDANCE_KEY) {
          return json({ ok: false, error: "Invalid key", intent });
        }
        const deleted = await deleteQuestionGuidance(shop.id, axisKey);
        return json({ ok: deleted.ok, error: deleted.error, intent });
      }
      case "delete-all-orphan-notes": {
        const draft = await captureLiveConfig(shop.id);
        if (draft.flow.axes.length === 0) {
          // With no axes at all "orphaned" is undefined — bailing beats
          // deleting every note a shop has.
          return json({ ok: false, error: "No quiz loaded. Reload the studio.", intent });
        }
        const notes = await getQuestionGuidance(shop.id);
        const knownKeys = new Set(draft.flow.axes.map((a) => a.key));
        for (const key of Object.keys(notes)) {
          if (key === GENERAL_GUIDANCE_KEY || knownKeys.has(key)) continue;
          const deleted = await deleteQuestionGuidance(shop.id, key);
          if (!deleted.ok) return json({ ok: false, error: deleted.error, intent });
        }
        return json({ ok: true, intent });
      }
      case "set-image-slot": {
        // Images rail (V2-SPEC 4.4-4.5): slot assignments live in the quiz
        // settings row as quiz_image_slots {slotKey: url}. Written directly
        // (the column ships with the brand-library package; a missing
        // column returns a clear error instead of a half-save). Empty url
        // clears the slot, which is how the Undo toast reverts.
        const slotKey = String(formData.get("slotKey") ?? "");
        const url = String(formData.get("url") ?? "");
        const source = String(formData.get("source") ?? "library");
        if (!/^[a-z0-9:_-]{1,120}$/i.test(slotKey)) {
          return json({ ok: false, error: "Invalid image slot", intent }, { status: 400 });
        }
        if (url && !/^https?:\/\//.test(url)) {
          return json({ ok: false, error: "Invalid image URL", intent }, { status: 400 });
        }
        const read = await supabase
          .from("chat_assistant_config")
          .select("quiz_image_slots")
          .eq("shop_domain", shopDomain)
          .maybeSingle();
        if (read.error) {
          return json({
            ok: false,
            error: "Your brand library is still being set up. Try again in a few minutes.",
            intent,
          });
        }
        const slots: Record<string, string> = {
          ...(((read.data as Record<string, unknown> | null)?.quiz_image_slots as Record<string, string>) ?? {}),
        };
        if (url) slots[slotKey] = url;
        else delete slots[slotKey];
        const write = await supabase
          .from("chat_assistant_config")
          .upsert(
            { shop_domain: shopDomain, quiz_image_slots: slots, updated_at: new Date().toISOString() },
            { onConflict: "shop_domain" },
          );
        if (write.error) {
          return json({ ok: false, error: `Saving the image failed: ${write.error.message}`, intent });
        }
        if (url) {
          trackOverhaulEvent(shopDomain, "image_slot_changed", {
            slot: slotKey,
            source: source === "upload" ? "upload" : "library",
          });
        }
        return json({ ok: true, intent });
      }
      default:
        return json({ ok: false, error: "Unknown intent" }, { status: 400 });
    }
  } catch (err) {
    console.error(`[studio] ${intent} failed:`, err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Action failed", intent },
      { status: 500 },
    );
  }
};

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------

// V2-SPEC 1.1 routes the studio as /studio/:quizId/build|matches|live.
// DELIBERATE DEVIATION: this app's data model is one quiz per shop, so a
// :quizId path param would be fake; the single /studio route carries a
// ?tab=build|matches|live search param instead (legacy ?step= deep links
// map onto it).
export type StudioTab = "build" | "matches" | "live";
export type StudioLoaderData = Exclude<
  ReturnType<typeof useLoaderData<typeof loader>>,
  { billingRequired: true }
>;

export default function Studio() {
  const data = useLoaderData<typeof loader>();
  // Separate component, not an early return: billing can start failing on
  // any revalidation mid-session, and swapping hook counts inside one
  // component would break React's hook order.
  if ("billingRequired" in data) return <BillingRequired apiKey={data.apiKey} />;
  return <StudioEditor data={data} />;
}

function BillingRequired({ apiKey }: { apiKey: string }) {
  // Break OUT of the max-modal iframe: navigating this frame to
  // /app/billing renders the whole admin layout inside the modal. The hub
  // page listens on the nav channel, closes the modal, and routes the app
  // frame properly.
  useEffect(() => {
    navigateParent("/app/billing");
  }, []);
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <div
        style={{
          maxWidth: 420,
          margin: "80px auto",
          padding: 24,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <Text as="h2" variant="headingMd">
          Your Gleame subscription isn't active
        </Text>
        <Text as="p" tone="subdued">
          The quiz studio needs an active subscription. Taking you to Billing…
        </Text>
        <div>
          <Button variant="primary" onClick={() => navigateParent("/app/billing")}>
            Go to Billing
          </Button>
        </div>
      </div>
    </AppProvider>
  );
}

// Z0 (V2-SPEC Part 1.2): the free-text "tell us more" wizard is deleted.
// A shop with no quiz gets this minimal blank state; generated quizzes come
// from the /app/onboard flow, which consumes machine-derived inputs only.
function BlankState() {
  const fetcher = useFetcher<StudioActionData>();
  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "96px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Text as="h2" variant="headingLg">
        No quiz here yet
      </Text>
      <Text as="p" tone="subdued">
        Start with a blank question and build by hand. Once a question exists,
        the Chat tab can rewrite, restyle, and extend the quiz for you.
      </Text>
      <div>
        <Button
          variant="primary"
          loading={fetcher.state !== "idle"}
          onClick={() => {
            const fd = new FormData();
            fd.append("intent", "start-blank-draft");
            fetcher.submit(fd, { method: "POST", action: "/studio" });
          }}
        >
          Start with a blank question
        </Button>
      </div>
      {fetcher.data && !fetcher.data.ok && fetcher.data.error && (
        <Banner tone="critical">{fetcher.data.error}</Banner>
      )}
    </div>
  );
}

function StudioEditor({ data }: { data: StudioLoaderData }) {
  const [params, setParams] = useSearchParams();

  // Intercom for THIS document — the /app frame's launcher is under the
  // max-modal while the studio is open. The SDK is idempotent per window,
  // so revalidations don't stack instances.
  useEffect(() => {
    if (!data.intercomAppId || typeof window === "undefined") return;
    import("@intercom/messenger-js-sdk").then(({ default: Intercom }) => {
      Intercom({
        app_id: data.intercomAppId,
        intercom_user_jwt: data.intercomUserJwt || undefined,
        name: data.shopDomain,
        // The default bottom-right spot is the right rail's chat input —
        // shift the launcher left of the rail, onto the canvas.
        horizontal_padding: 340,
      });
    });
  }, [data.intercomAppId, data.intercomUserJwt, data.shopDomain]);

  const tab = ((): StudioTab => {
    const t = params.get("tab") ?? params.get("step");
    if (t === "matches" || t === "logic") return "matches";
    if (t === "live" || t === "publish") return "live";
    return "build";
  })();
  const setTab = useCallback(
    (next: StudioTab) => {
      editorFlushRef.current?.();
      setParams(
        (p) => {
          p.set("tab", next);
          p.delete("step");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const overlayOpen = params.get("overlay") === "templates";
  const setOverlay = useCallback(
    (open: boolean) => {
      setParams(
        (p) => {
          if (open) p.set("overlay", "templates");
          else p.delete("overlay");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const questions = data.draft?.flow.questions ?? [];
  const selectedSlide = ((): string => {
    const s = params.get("slide");
    if (s === "intro" || s === "photo" || s === "results" || s === "theme" || s === "images" || s === "lead") return s;
    if (s?.startsWith("q:") && questions.some((q) => slideIdForQuestion(q.axisKey) === s)) return s;
    return questions.length > 0 ? slideIdForQuestion(questions[0].axisKey) : "intro";
  })();
  const setSelectedSlide = useCallback(
    (next: string) => {
      setParams(
        (p) => {
          p.set("slide", next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [flowMapOpen, setFlowMapOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  // Post-generation warnings worth reading (e.g. brief/catalog mismatch);
  // shown once above the canvas, dismissible.
  const [genNotice, setGenNotice] = useState<string | null>(null);
  // One-time notice after the draft-era migration: the merchant's old
  // draft was parked in version history, not deleted.
  const [legacyNotice, setLegacyNotice] = useState<boolean>(data.legacyDraftArchived === true);
  // Question delete that would touch rules/branching: confirm first, then
  // remove_question with pruneRules cleans everything in one call.
  const [pendingDelete, setPendingDelete] = useState<{
    axisKey: string;
    fallbackSlide: string;
    ruleCount: number;
    showIfCount: number;
  } | null>(null);
  // Bumped whenever a chat change/undo lands so the Edit tab's local form
  // state remounts with the fresh draft (manual edits are chat-gated, so
  // no in-progress typing is ever lost by the remount).
  const [chatEpoch, setChatEpoch] = useState(0);
  const pendingEpochBumpRef = useRef(false);
  // Editors stay locked from the first applied chat change until the
  // post-turn revalidation lands: chatBusy alone released at "done", and an
  // edit typed in that gap flushed a stale full-question patch that
  // reverted the AI's change.
  const [postTurnLock, setPostTurnLock] = useState(false);
  const revalidator = useRevalidator();
  useEffect(() => {
    if (revalidator.state === "idle" && pendingEpochBumpRef.current) {
      pendingEpochBumpRef.current = false;
      setPostTurnLock(false);
      setChatEpoch((n) => n + 1);
    }
  }, [revalidator.state]);
  const [flashSlide, setFlashSlide] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const matchesIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  // ---- V2 surfaces state ----
  const [publishOpen, setPublishOpen] = useState(false);
  const [viewStoreBusy, setViewStoreBusy] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [slotBusy, setSlotBusy] = useState(false);
  // One toast slot for template switches and image-slot changes, with an
  // optional Undo action (spec 2.4 / 4.5).
  const [undoToast, setUndoToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showUndoToast = useCallback((message: string, undo?: () => void) => {
    setUndoToast({ message, undo });
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setUndoToast(null), 6000);
  }, []);
  // First-run banner (spec 2.2): dismissal persists per quiz. One quiz per
  // shop, so localStorage keyed by shop domain is the quiz key.
  const bannerKey = `gleame-reveal-banner:${data.shopDomain}`;
  const [bannerVisible, setBannerVisible] = useState(false);
  useEffect(() => {
    try {
      setBannerVisible(window.localStorage.getItem(bannerKey) !== "1");
    } catch {
      setBannerVisible(true);
    }
  }, [bannerKey]);
  const playModeRef = useRef(false);
  const playedRef = useRef(false);
  // reveal_viewed once per quiz, on first render of the first-run state.
  useEffect(() => {
    if (tab !== "build" || !data.hasDraft || !bannerVisible) return;
    const seenKey = `gleame-reveal-viewed:${data.shopDomain}`;
    try {
      if (window.localStorage.getItem(seenKey) === "1") return;
      window.localStorage.setItem(seenKey, "1");
    } catch {
      /* still fire */
    }
    fireOverhaulEvent("reveal_viewed", { surface: "studio_build" });
  }, [tab, data.hasDraft, bannerVisible, data.shopDomain]);

  const canvasTheme: CanvasTheme = {
    bg: data.studio.canvasBg,
    ink: data.studio.canvasInk,
    headingFont: data.studio.headingFont,
    storeName: data.studio.storeName,
    logoUrl: data.studio.logoUrl,
  };

  // Step we last COMMANDED the preview to show. The widget echoes every
  // render as gleame-preview-at; while an expectation is pending we treat
  // echoes as acks (or boot noise to correct), never as user navigation —
  // otherwise every iframe (re)load yanked the selection back to Intro.
  const expectedStepRef = useRef<string | null>(null);
  // Bounded corrections: a mismatch that can never converge (e.g. a step
  // the widget refuses to land on) must not ping-pong goto/echo forever.
  const expectedRetryRef = useRef(0);
  // Post-ack grace: the widget may auto-skip a showIf-hidden screen right
  // after honoring our goto and echo the NEXT screen — swallowing echoes
  // briefly keeps gated questions selectable.
  const echoMuteUntilRef = useRef(0);
  const stepForSlide = useCallback(
    (slideId: string) => {
      if (slideId === "intro" || slideId === "theme" || slideId === "images") return "intro";
      if (slideId === "lead") return "lead";
      if (slideId === "photo") return "gate";
      if (slideId === "results") return "results";
      const qi = questions.findIndex((q) => slideIdForQuestion(q.axisKey) === slideId);
      if (qi < 0) return "intro";
      // Normalize to the screen's FIRST question: the widget renders and
      // reports grouped questions by their screen representative, so
      // expecting the raw index deadlocked the ack protocol in a goto/echo
      // loop whenever a non-first grouped question was selected.
      if (data.draft) {
        const screen = buildScreens(data.draft.flow).find((s) => s.indices.includes(qi));
        if (screen) return `q${screen.indices[0] + 1}`;
      }
      return `q${qi + 1}`;
    },
    [questions, data.draft],
  );
  const gotoPreviewStep = useCallback(
    (slideId: string) => {
      const previewStep = stepForSlide(slideId);
      expectedStepRef.current = previewStep;
      expectedRetryRef.current = 0;
      iframeRef.current?.contentWindow?.postMessage(
        { type: "gleame-preview-goto", step: previewStep },
        window.location.origin,
      );
    },
    [stepForSlide],
  );
  const reloadPreview = useCallback(() => setPreviewNonce((n) => n + 1), []);
  // One reload per window, not one per streamed chat change event.
  const reloadTimerRef = useRef<number | null>(null);
  const scheduleReloadPreview = useCallback(() => {
    if (reloadTimerRef.current != null) return;
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      reloadPreview();
    }, 400);
  }, [reloadPreview]);
  useEffect(() => () => {
    if (reloadTimerRef.current != null) window.clearTimeout(reloadTimerRef.current);
  }, []);
  const updatePreview = useCallback((payload: { flow?: unknown; config?: unknown }) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "gleame-preview-update", flow: payload.flow, config: payload.config },
      window.location.origin,
    );
  }, []);

  // Editors register their pending-edit flush here; switching slides or
  // steps delivers in-flight debounced edits through the editor's own
  // fetcher BEFORE the switch (the unmount raw-fetch stays as a backstop
  // for modal close, but racing the next loader read is worse than
  // flushing up front).
  const editorFlushRef = useRef<(() => void) | null>(null);

  const selectSlide = useCallback(
    (slideId: string) => {
      editorFlushRef.current?.();
      setSelectedSlide(slideId);
      gotoPreviewStep(slideId);
    },
    [setSelectedSlide, gotoPreviewStep],
  );

  // Two-way sync: clicking through the quiz INSIDE the preview advances the
  // widget, which reports its step (gleame-preview-at) — follow it in the
  // tree + editor so the settings always match what's on screen. Scoped to
  // the BUILD iframe: the Check-matches iframe echoes too, and its play
  // path must never steal the rail selection.
  const selectedSlideRef = useRef(selectedSlide);
  selectedSlideRef.current = selectedSlide;
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
      const d = e.data as { type?: string; step?: string } | null;
      if (!d || d.type !== "gleame-preview-at") return;
      const step = String(d.step ?? "");

      // Reveal instrumentation (spec 2.2): the banner's Play reached the
      // results screen.
      if (step === "results" && playModeRef.current && !playedRef.current) {
        playedRef.current = true;
        fireOverhaulEvent("reveal_quiz_played", {});
      }

      // Pending expectation: this echo is an ack of our own goto (clear it)
      // or boot noise from an iframe (re)load (re-send the goto, bounded).
      if (expectedStepRef.current !== null) {
        if (step === expectedStepRef.current) {
          expectedStepRef.current = null;
          // Grace window: the widget may auto-skip a hidden screen right
          // after this ack; don't let that follow-up echo steal selection.
          echoMuteUntilRef.current = Date.now() + 800;
        } else if (expectedRetryRef.current >= 3) {
          // The widget won't land where we asked (e.g. unreachable step);
          // stop correcting instead of ping-ponging goto/echo forever.
          expectedStepRef.current = null;
        } else {
          expectedRetryRef.current += 1;
          iframeRef.current?.contentWindow?.postMessage(
            { type: "gleame-preview-goto", step: expectedStepRef.current },
            window.location.origin,
          );
        }
        return;
      }
      if (Date.now() < echoMuteUntilRef.current) return;

      let slideId: string | null = null;
      if (step === "intro") slideId = "intro";
      else if (step === "lead") slideId = "lead";
      else if (step === "gate") slideId = "photo";
      else if (step === "results") slideId = "results";
      else if (/^q\d+$/.test(step)) {
        const q = questions[parseInt(step.slice(1), 10) - 1];
        if (q) slideId = slideIdForQuestion(q.axisKey);
      }
      if (!slideId) return;
      // Theme/Images map their goto to the intro step — don't let an echo
      // steal that selection.
      if (
        (selectedSlideRef.current === "theme" || selectedSlideRef.current === "images") &&
        slideId === "intro"
      )
        return;
      // Grouped screens report their FIRST question; if the current
      // selection lives on that same screen, keep it (otherwise later
      // questions in a group were unselectable).
      if (data.draft && selectedSlideRef.current.startsWith("q:")) {
        const screens = buildScreens(data.draft.flow);
        const selIdx = questions.findIndex(
          (q) => slideIdForQuestion(q.axisKey) === selectedSlideRef.current,
        );
        const repIdx = questions.findIndex((q) => slideIdForQuestion(q.axisKey) === slideId);
        const sameScreen = screens.some(
          (scr) => scr.indices.includes(selIdx) && scr.indices.includes(repIdx),
        );
        if (sameScreen) return;
      }
      if (slideId !== selectedSlideRef.current) setSelectedSlide(slideId);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [questions, setSelectedSlide, data.draft]);

  // A freshly (re)loaded iframe boots at the intro — steer it back to the
  // current slide instead of letting its boot echo win.
  const onPreviewLoad = useCallback(() => {
    gotoPreviewStep(selectedSlideRef.current);
  }, [gotoPreviewStep]);

  // Tree structural edits (add/reorder) go through the same apply-tool path
  // as the panel editors; the response carries fresh preview payloads.
  const treeFetcher = useFetcher<StudioActionData>();
  const pendingSelectRef = useRef<string | null>(null);
  const treeProcessedRef = useRef<StudioActionData | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  useEffect(() => {
    if (treeFetcher.state !== "idle" || !treeFetcher.data) return;
    if (treeProcessedRef.current === treeFetcher.data) return;
    treeProcessedRef.current = treeFetcher.data;
    if (treeFetcher.data.ok) {
      setTreeError(null);
      if (treeFetcher.data.previewFlow || treeFetcher.data.previewConfig) {
        // The widget re-renders on update and echoes its step POSITIONALLY;
        // after a reorder that position maps to a different question, which
        // used to yank the id-based selection. Mute echoes briefly.
        echoMuteUntilRef.current = Date.now() + 800;
        updatePreview({ flow: treeFetcher.data.previewFlow, config: treeFetcher.data.previewConfig });
      }
      if (pendingSelectRef.current) {
        selectSlide(pendingSelectRef.current);
        pendingSelectRef.current = null;
      }
    } else {
      pendingSelectRef.current = null;
      const raw = treeFetcher.data.error ?? "Couldn't apply that change.";
      // remove_question's applier error is written for the copilot
      // (update_rules / removeAxis=false); translate it for merchants.
      setTreeError(
        raw.includes("is referenced by rules")
          ? "This question can't be deleted while recommendation rules use its answers to pick products. Ask Gleame in the Chat tab to delete it; it will update those rules at the same time."
          : raw,
      );
    }
  }, [treeFetcher.state, treeFetcher.data, updatePreview, selectSlide]);

  const submitTreeTool = useCallback(
    (tool: string, input: unknown) => {
      const fd = new FormData();
      fd.append("intent", "apply-tool");
      fd.append("tool", tool);
      fd.append("input", JSON.stringify(input));
      treeFetcher.submit(fd, { method: "POST", action: "/studio" });
    },
    [treeFetcher],
  );

  const addQuestion = useCallback(() => {
    const taken = new Set((data.draft?.flow.axes ?? []).map((a) => a.key));
    let n = questions.length + 1;
    let key = `question_${n}`;
    while (taken.has(key)) key = `question_${++n}`;
    pendingSelectRef.current = slideIdForQuestion(key);
    submitTreeTool("add_question", {
      axis: {
        key,
        label: `Question ${n}`,
        values: [
          { value: "option_1", label: "Option 1" },
          { value: "option_2", label: "Option 2" },
        ],
      },
      question: {
        prompt: "",
        options: [
          { label: "", axisValueValue: "option_1" },
          { label: "", axisValueValue: "option_2" },
        ],
      },
    });
  }, [data.draft, questions.length, submitTreeTool]);

  const moveQuestion = useCallback(
    (axisKey: string, direction: -1 | 1) => {
      const order = questions.map((q) => q.axisKey);
      const from = order.indexOf(axisKey);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= order.length) return;
      const [k] = order.splice(from, 1);
      order.splice(to, 0, k);
      submitTreeTool("reorder_questions", { axisKeysInOrder: order });
    },
    [questions, submitTreeTool],
  );

  // Quiz name = the quiz headline (one quiz per shop; see StudioTopBar).
  const quizName = String((data.settings as Record<string, unknown>)?.quiz_headline ?? "") || "Your quiz";
  const saveQuizName = useCallback(
    (name: string) => {
      submitTreeTool("update_copy", { fields: { quiz_headline: name } });
    },
    [submitTreeTool],
  );

  // "View on my store" (spec 2.3): mint the app-proxy preview link, open
  // it in a new tab. The window opens synchronously so popup blockers
  // don't eat it while the link is minted.
  const viewStore = useCallback(async () => {
    setViewStoreBusy(true);
    const w = window.open("", "_blank");
    try {
      const fd = new FormData();
      fd.append("intent", "preview-link");
      fd.append("draftId", "live");
      const res = await fetch("/app/api/publish-quiz", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (body?.ok && body.url && w) {
        w.location.href = body.url;
        fireOverhaulEvent("store_preview_opened", {});
      } else {
        w?.close();
        showUndoToast(body?.error ?? "Couldn't open the store preview");
      }
    } catch {
      w?.close();
      showUndoToast("Couldn't open the store preview");
    } finally {
      setViewStoreBusy(false);
    }
  }, [showUndoToast]);

  // Template switching (spec 2.4): the overlay's Use-this-template CTA.
  const applyTemplate = useCallback(async (template: string, preset: string | null, source: string) => {
    const fd = new FormData();
    fd.append("intent", "set");
    fd.append("template", template);
    fd.append("preset", preset ?? "");
    fd.append("source", source);
    const res = await fetch("/app/api/quiz-template", { method: "POST", body: fd });
    return (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  }, []);

  const useTemplate = useCallback(
    async (id: TemplateId) => {
      setTplBusy(true);
      const prior = { template: data.studio.template, preset: data.studio.preset };
      const r = await applyTemplate(id, null, "overlay");
      setTplBusy(false);
      if (r?.ok) {
        setOverlay(false);
        revalidator.revalidate();
        reloadPreview();
        showUndoToast(
          `Switched to ${TEMPLATES[id].name}`,
          prior.template
            ? () => {
                void applyTemplate(prior.template!, prior.preset, "overlay").then((rr) => {
                  if (rr?.ok) {
                    revalidator.revalidate();
                    reloadPreview();
                  }
                });
              }
            : undefined,
        );
      } else {
        showUndoToast(r?.error ?? "Switching templates failed");
      }
    },
    [applyTemplate, data.studio.template, data.studio.preset, revalidator, reloadPreview, setOverlay, showUndoToast],
  );

  // Image slot changes (spec 4.5): write, re-render, offer Undo.
  const setImageSlot = useCallback(
    async (slotKey: string, url: string, source: string, prevUrl: string | null) => {
      setSlotBusy(true);
      try {
        const fd = new FormData();
        fd.append("intent", "set-image-slot");
        fd.append("slotKey", slotKey);
        fd.append("url", url);
        fd.append("source", source);
        const res = await postStudioAction(fd);
        const body = (await res.json().catch(() => null)) as StudioActionData | null;
        if (body?.ok) {
          revalidator.revalidate();
          reloadPreview();
          showUndoToast("Image updated", () => {
            const fd2 = new FormData();
            fd2.append("intent", "set-image-slot");
            fd2.append("slotKey", slotKey);
            fd2.append("url", prevUrl ?? "");
            fd2.append("source", source);
            void postStudioAction(fd2).then(() => {
              revalidator.revalidate();
              reloadPreview();
            });
          });
        } else {
          showUndoToast(body?.error ?? "Saving the image failed");
        }
      } finally {
        setSlotBusy(false);
      }
    },
    [revalidator, reloadPreview, showUndoToast],
  );

  const problems = data.draft ? draftProblems(data.draft.flow) : [];
  const needsOnboarding = !data.hasDraft && data.liveQuestionCount === 0;

  // Watch-mode landing: when generation (e.g. from /app/onboard) finally
  // writes the quiz, reload the stale "Nothing to preview yet" iframe and
  // surface any recorded generation warnings.
  const prevNeedsOnboardingRef = useRef(needsOnboarding);
  useEffect(() => {
    if (prevNeedsOnboardingRef.current && !needsOnboarding) {
      reloadPreview();
      const warnings = data.genStatus?.warnings ?? [];
      if (warnings.length > 0) setGenNotice(warnings.slice(0, 2).join(" "));
    }
    prevNeedsOnboardingRef.current = needsOnboarding;
  }, [needsOnboarding, reloadPreview, data.genStatus]);

  const lowConfidence = data.studio.confidence === "low" || !data.studio.template;

  return (
    <AppProvider isEmbeddedApp apiKey={data.apiKey}>
      <StudioShell
        topBar={
          <StudioTopBar
            tab={tab}
            onTabChange={setTab}
            quizName={quizName}
            onQuizNameChange={saveQuizName}
            hasDraft={data.hasDraft}
            problemCount={problems.length}
            catalog={data.catalog}
            onViewStore={() => void viewStore()}
            viewStoreBusy={viewStoreBusy}
            onPublishClick={() => setPublishOpen(true)}
          />
        }
        rail={
          tab === "build" && selectedSlide === "images" && data.draft ? (
            <ImagesRail
              template={data.studio.template}
              flow={data.draft.flow as unknown as StudioFlow}
              imageSlots={(data.studio.imageSlots ?? {}) as Record<string, string>}
              busy={slotBusy}
              onBack={() =>
                selectSlide(questions.length > 0 ? slideIdForQuestion(questions[0].axisKey) : "intro")
              }
              onSetSlot={(slotKey, url, source, prevUrl) => void setImageSlot(slotKey, url, source, prevUrl)}
            />
          ) : (
            <SlideTree
              error={treeError}
              onDismissError={() => setTreeError(null)}
              flow={data.draft?.flow ?? null}
              selectedSlide={selectedSlide}
              onSelect={selectSlide}
              onAdd={addQuestion}
              onMove={moveQuestion}
              onReorder={(axisKeysInOrder) => submitTreeTool("reorder_questions", { axisKeysInOrder })}
              flowMapOpen={flowMapOpen && tab === "build"}
              onToggleFlowMap={() => setFlowMapOpen((v) => !v)}
              flashSlide={flashSlide}
              disabled={chatBusy || treeFetcher.state !== "idle"}
              readOnly={tab !== "build"}
              onReturnToBuild={tab !== "build" ? () => setTab("build") : undefined}
            />
          )
        }
        canvas={
          tab === "matches" ? (
            <CheckMatches
              data={data}
              chatBusy={chatBusy}
              previewToken={data.previewToken}
              theme={canvasTheme}
              iframeRef={matchesIframeRef}
            />
          ) : tab === "live" ? (
            <LiveTab data={data} onOpenPublish={() => setPublishOpen(true)} />
          ) : (
            <>
              {genNotice && (
                <div style={{ padding: "12px 16px 0" }}>
                  <Banner tone="warning" title="Heads up from the quiz generator" onDismiss={() => setGenNotice(null)}>
                    {genNotice}
                  </Banner>
                </div>
              )}
              {legacyNotice && (
                <div style={{ padding: "12px 16px 0" }}>
                  <Banner tone="info" title="The studio now edits your live quiz directly" onDismiss={() => setLegacyNotice(false)}>
                    Changes save to your store as you make them (the quiz still only
                    shows to shoppers while it's turned on in the Live tab). Your
                    old draft wasn't lost: it's in version history on the Live tab,
                    one click to restore.
                  </Banner>
                </div>
              )}
              {data.hasDraft && bannerVisible && (
                <FirstRunBanner
                  productCount={data.catalog.productCount}
                  chips={data.studio.chips as string[]}
                  lowConfidence={lowConfidence}
                  presetLabel={(data.studio.presetLabel ?? data.studio.templateName) as string | null}
                  onPlay={() => {
                    playModeRef.current = true;
                    selectSlide("intro");
                  }}
                  onStyle={() => selectSlide("theme")}
                  onDismiss={() => {
                    setBannerVisible(false);
                    try {
                      window.localStorage.setItem(bannerKey, "1");
                    } catch {
                      /* session-only dismissal */
                    }
                  }}
                />
              )}
              {flowMapOpen ? (
                <FlowMap
                  flow={data.draft?.flow ?? null}
                  selectedSlide={selectedSlide}
                  onSelect={selectSlide}
                  onClose={() => setFlowMapOpen(false)}
                />
              ) : (
                <PreviewCanvas
                  iframeRef={iframeRef}
                  previewToken={data.previewToken}
                  nonce={previewNonce}
                  onLoad={onPreviewLoad}
                  theme={canvasTheme}
                />
              )}
            </>
          )
        }
        panel={
          <EditPanel
            data={data}
            step={tab}
            selectedSlide={selectedSlide}
            chatEpoch={chatEpoch}
            chatBusy={chatBusy || postTurnLock}
            registerFlush={(fn) => {
              editorFlushRef.current = fn;
            }}
            flushEditor={() => editorFlushRef.current?.()}
            // Flushes fired around a slide/step switch outlive the editor
            // that owned the local error banner; surface their rejections
            // in the rail banner, which survives the switch.
            onSaveError={setTreeError}
            onSelectSlide={selectSlide}
            onOpenTemplateOverlay={() => setOverlay(true)}
            onDeleteQuestion={(axisKey, fallbackSlide) => {
              // Hoisted here because the revalidation after a delete
              // unmounts the question editor: its own fetcher effect never
              // ran, leaving the preview on the deleted question.
              // A delete that would touch rules or branching isn't blocked
              // anymore — it confirms, then remove_question with pruneRules
              // updates the rules and clears the branching in one call.
              const flow = data.draft?.flow;
              const ruleCount = (flow?.rules ?? []).filter((r) => axisKey in r.criteria).length;
              const showIfCount =
                (flow?.questions ?? []).filter((q) => q.showIf?.axis_key === axisKey).length +
                (flow?.questions ?? []).reduce(
                  (n, q) => n + q.options.filter((o) => o.showIf?.axis_key === axisKey).length,
                  0,
                );
              if (ruleCount > 0 || showIfCount > 0) {
                setPendingDelete({ axisKey, fallbackSlide, ruleCount, showIfCount });
                return;
              }
              pendingSelectRef.current = fallbackSlide;
              submitTreeTool("remove_question", { axisKey, removeAxis: true, pruneRules: true });
            }}
            onPreviewUpdate={updatePreview}
            onPreviewReload={reloadPreview}
            chat={
              <ChatPanel
                aiConfigured={data.aiConfigured}
                initialSessionId={data.copilotSessionId}
                selectedSlide={selectedSlide}
                questions={questions}
                onBusyChange={setChatBusy}
                onBeforeSend={() => editorFlushRef.current?.()}
                onChangeApplied={(target) => {
                  // Bump AFTER revalidation lands: an immediate remount would
                  // reinitialize editors from the pre-change loader snapshot.
                  pendingEpochBumpRef.current = true;
                  setPostTurnLock(true);
                  scheduleReloadPreview();
                  const m = /^Q(\d+)$/i.exec(target);
                  if (m) {
                    const q = questions[Number(m[1]) - 1];
                    if (q) {
                      const id = slideIdForQuestion(q.axisKey);
                      setFlashSlide(id);
                      setTimeout(() => setFlashSlide(null), 1600);
                    }
                  }
                }}
              />
            }
          />
        }
        overlay={
          needsOnboarding ? (
            <BlankState />
          ) : overlayOpen ? (
            <TemplateOverlay
              previewToken={data.previewToken}
              currentTemplate={data.studio.template}
              eligible={(data.studio.eligible ?? []) as TemplateId[]}
              busy={tplBusy}
              onUse={(id) => void useTemplate(id)}
              onFixImages={() => {
                setOverlay(false);
                selectSlide("images");
              }}
              onClose={() => setOverlay(false)}
            />
          ) : null
        }
      />
      <PublishSheet
        data={data}
        problems={problems}
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onFix={(slideId) => {
          setPublishOpen(false);
          setTab("build");
          selectSlide(slideId);
        }}
      />
      {undoToast && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: 16,
            background: "#141519",
            color: "#fff",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12.5,
            display: "flex",
            gap: 14,
            alignItems: "center",
            zIndex: 70,
            boxShadow: "0 8px 24px rgba(20,22,26,.25)",
          }}
        >
          <span>{undoToast.message}</span>
          {undoToast.undo && (
            <button
              onClick={() => {
                undoToast.undo?.();
                setUndoToast(null);
              }}
              style={{
                border: 0,
                background: "transparent",
                color: "#9AA4FF",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 12.5,
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this question?"
        primaryAction={{
          content: "Delete and clean up",
          destructive: true,
          onAction: () => {
            if (!pendingDelete) return;
            pendingSelectRef.current = pendingDelete.fallbackSlide;
            submitTreeTool("remove_question", {
              axisKey: pendingDelete.axisKey,
              removeAxis: true,
              pruneRules: true,
            });
            setPendingDelete(null);
          },
        }}
        secondaryActions={[{ content: "Keep it", onAction: () => setPendingDelete(null) }]}
      >
        <Modal.Section>
          <Text as="p">
            {[
              pendingDelete && pendingDelete.ruleCount > 0
                ? `${pendingDelete.ruleCount} recommendation ${pendingDelete.ruleCount === 1 ? "rule uses" : "rules use"} this question's answers — deleting it removes that condition from ${pendingDelete.ruleCount === 1 ? "the rule" : "those rules"} (rules with no other conditions are deleted).`
                : null,
              pendingDelete && pendingDelete.showIfCount > 0
                ? `${pendingDelete.showIfCount} "only show when" ${pendingDelete.showIfCount === 1 ? "condition points" : "conditions point"} at its answers — ${pendingDelete.showIfCount === 1 ? "it" : "they"} will be cleared, so the affected ${pendingDelete.showIfCount === 1 ? "question or answer" : "questions or answers"} will always show.`
                : null,
              "A snapshot of your current quiz is saved to version history first.",
            ]
              .filter(Boolean)
              .join(" ")}
          </Text>
        </Modal.Section>
      </Modal>
    </AppProvider>
  );
}

// ---------------------------------------------------------------------
// First-run banner (V2-SPEC 2.2): one dismissible row between the top bar
// and the canvas. Real detected chips, never invented copy.
// ---------------------------------------------------------------------

function FirstRunBanner({
  productCount,
  chips,
  lowConfidence,
  presetLabel,
  onPlay,
  onStyle,
  onDismiss,
}: {
  productCount: number | null;
  chips: string[];
  lowConfidence: boolean;
  presetLabel: string | null;
  onPlay: () => void;
  onStyle: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "11px 16px",
        background: "#F4F3FF",
        borderBottom: "1px solid #E2E0F7",
        fontSize: 13,
        flexShrink: 0,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "#4A3AFF", flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        {lowConfidence ? (
          <>
            <strong>
              Built from your {productCount ?? "synced"} products.
            </strong>{" "}
            <span style={{ color: "#6D7175" }}>
              Styled with {presetLabel ?? "a neutral preset"}.{" "}
              <button
                onClick={onStyle}
                style={{ border: 0, background: "none", padding: 0, color: "#4A3AFF", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
              >
                Tap Style to match your brand.
              </button>
            </span>
          </>
        ) : (
          <>
            <strong>
              Built from your {productCount ?? "synced"} products in your store's style.
            </strong>{" "}
            <span style={{ color: "#6D7175" }}>{chips.join(" · ")}.</span>{" "}
            <span style={{ color: "#6D7175" }}>Nothing is live until you publish.</span>
          </>
        )}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={onPlay}
          style={{ border: 0, background: "none", color: "#4A3AFF", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          Play the quiz
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{ border: 0, background: "none", color: "#9A9EAB", fontSize: 15, cursor: "pointer" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** Fire an overhaul funnel event from the studio client (server-side sink
 * whitelists the names). Fire-and-forget by design. */
function fireOverhaulEvent(event: string, properties: Record<string, unknown> = {}) {
  const fd = new FormData();
  fd.append("event", event);
  fd.append("properties", JSON.stringify(properties));
  fetch("/app/api/overhaul-event", { method: "POST", body: fd }).catch(() => {});
}
