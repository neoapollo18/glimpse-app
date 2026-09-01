import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError, useSearchParams } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
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
} from "../lib/supabase.server";
import {
  getQuizDraft,
  saveQuizDraft,
  initDraftFromLive,
  discardQuizDraft,
  publishQuizDraft,
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
import { GENERAL_GUIDANCE_KEY } from "../lib/quiz-guidance-shared";

import { StudioShell } from "../components/studio/StudioShell";
import { StudioTopBar } from "../components/studio/StudioTopBar";
import { SlideTree, slideIdForQuestion } from "../components/studio/SlideTree";
import { PreviewCanvas } from "../components/studio/PreviewCanvas";
import { EditPanel } from "../components/studio/EditPanel";
import { ChatPanel } from "../components/studio/ChatPanel";
import { LogicStep } from "../components/studio/LogicStep";
import { PublishStep } from "../components/studio/PublishStep";
import { OnboardingWizard } from "../components/studio/OnboardingWizard";
import { FlowMap } from "../components/studio/FlowMap";
import { draftProblems } from "../components/studio/draft-problems";

// ---------------------------------------------------------------------
// Quiz Studio — the full-screen takeover editor (opened from the quiz hub
// in an App Bridge max modal, or directly at /studio). Lives OUTSIDE the
// /app layout on purpose: no NavMenu (we're a takeover), and no Mantle
// billing check on every one of the many revalidations an editing session
// produces. Same standalone-route precedent as quiz-preview[.]html.ts.
//
// The studio edits the DRAFT only. Manual edits go through the SAME
// appliers the AI copilot uses (apply-tool intent), so both paths share
// validation (including the earlier-axis showIf rule) and can never
// produce a draft the publish path rejects for shape reasons.
// ---------------------------------------------------------------------

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

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
  const shop = await findShopByDomain(shopDomain);
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const [draftInitial, versions, shopRowRes, copilotSessionId, notes, counts] = await Promise.all([
    getQuizDraft(shop.id).catch((e) => {
      console.error("[studio] draft load failed:", e.message);
      return null;
    }),
    listVersions(shop.id).catch(() => []),
    supabase.from("shops").select("*").eq("id", shop.id).single(),
    getLatestSessionId(shop.id).catch(() => null),
    getQuestionGuidance(shop.id).catch(() => ({}) as Record<string, string>),
    getRecommendationCounts(shop.id).catch(() => null),
  ]);
  const shopRow = shopRowRes.data;
  const liveQuestionCount = counts?.questions ?? 0;

  // Auto-seed: a shop with a live quiz but no draft gets one from live so
  // the studio always has something to edit. Idempotent; zero-question
  // shops are NOT seeded (the onboarding wizard's generation creates the
  // draft itself).
  let draft = draftInitial;
  let seeded = false;
  if (draft === null && liveQuestionCount > 0) {
    try {
      draft = await initDraftFromLive(shop.id);
      seeded = true;
    } catch (e) {
      console.error("[studio] draft seed failed:", e);
    }
  }

  const previewToken = process.env.SHOPIFY_API_SECRET
    ? jwt.sign({ shopId: shop.id, shopDomain }, process.env.SHOPIFY_API_SECRET, { expiresIn: "12h" })
    : null;

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopDomain,
    draft,
    hasDraft: draft !== null,
    seeded,
    versions,
    notes,
    aiConfigured: isClaudeConfigured(),
    previewToken,
    copilotSessionId,
    liveQuestionCount,
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
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    switch (intent) {
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
        // Serialized per shop: a copilot turn or a second tab saving the
        // draft concurrently would otherwise interleave read-modify-write.
        const result = await withShopSaveLock(shop.id, async () => {
          const draft = await getQuizDraft(shop.id);
          if (!draft) return { ok: false as const, error: "No draft to edit. Reload the studio." };
          const catalog = await loadCatalogForShop(shop.id);
          const applied = APPLIERS[tool](draft as DraftShape, input, catalog);
          if (!applied.ok) return { ok: false as const, error: applied.error };
          const saved = await saveQuizDraft(shop.id, applied.draft as QuizDraft, "manual");
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
      case "init-draft": {
        await initDraftFromLive(shop.id);
        return json({ ok: true, intent });
      }
      case "start-blank-draft": {
        // "Start from scratch" in the wizard: one untitled question with two
        // blank answers, ready to edit. Uses the same applier the + Add
        // question button uses so shape/validation stay identical.
        const blank: QuizDraft = { flow: { axes: [], questions: [], rules: [] }, settings: {} };
        const catalog = await loadCatalogForShop(shop.id);
        const applied = APPLIERS.add_question(
          blank as DraftShape,
          {
            axis: { key: "question_1", label: "Question 1", values: [
              { value: "option_1", label: "Option 1" },
              { value: "option_2", label: "Option 2" },
            ] },
            question: {
              prompt: "",
              options: [
                { label: "", axisValueValue: "option_1" },
                { label: "", axisValueValue: "option_2" },
              ],
            },
          },
          catalog,
        );
        const next = applied.ok ? (applied.draft as QuizDraft) : blank;
        const saved = await saveQuizDraft(shop.id, next, "manual");
        if (!saved.ok) return json({ ok: false, error: saved.error, intent });
        return json({ ok: true, intent });
      }
      case "discard-draft": {
        const result = await discardQuizDraft(shop.id);
        return json({ ...result, intent });
      }
      case "publish": {
        const result = await publishQuizDraft(shop.id);
        return json({ ...result, intent });
      }
      case "restore": {
        const versionId = formData.get("versionId") as string;
        if (!versionId) return json({ ok: false, error: "Missing versionId", intent });
        const result = await restoreVersion(shop.id, versionId);
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
      case "activate-guidance": {
        // Studio semantics: guidance + mode land in the DRAFT settings and
        // go live at publish, atomically with the questions they reference.
        const guidanceText = String(formData.get("guidanceText") ?? "").trim();
        const mode = formData.get("mode");
        if (!guidanceText) return json({ ok: false, error: "Guidance is empty", intent });
        if (mode !== "ai" && mode !== "hybrid") {
          return json({ ok: false, error: "Invalid ranking mode", intent });
        }
        const result = await withShopSaveLock(shop.id, async () => {
          const draft = await getQuizDraft(shop.id);
          if (!draft) return { ok: false as const, error: "No draft to edit. Reload the studio." };
          const catalog = await loadCatalogForShop(shop.id);
          const g = APPLIERS.update_guidance(draft as DraftShape, { aiGuidance: guidanceText }, catalog);
          if (!g.ok) return { ok: false as const, error: g.error };
          const m = APPLIERS.update_recommendation_mode(g.draft as DraftShape, { mode }, catalog);
          if (!m.ok) return { ok: false as const, error: m.error };
          const saved = await saveQuizDraft(shop.id, m.draft as QuizDraft, "manual");
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
        const draft = await getQuizDraft(shop.id);
        const notes = await getQuestionGuidance(shop.id);
        const knownKeys = new Set((draft?.flow.axes ?? []).map((a) => a.key));
        for (const key of Object.keys(notes)) {
          if (key === GENERAL_GUIDANCE_KEY || knownKeys.has(key)) continue;
          const deleted = await deleteQuestionGuidance(shop.id, key);
          if (!deleted.ok) return json({ ok: false, error: deleted.error, intent });
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

export type StudioStep = "build" | "logic" | "publish";
export type StudioLoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function Studio() {
  const data = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();

  const step = ((): StudioStep => {
    const s = params.get("step");
    return s === "logic" || s === "publish" ? s : "build";
  })();
  const setStep = useCallback(
    (next: StudioStep) => {
      setParams(
        (p) => {
          p.set("step", next);
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
    if (s === "intro" || s === "photo" || s === "results") return s;
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
  // Bumped whenever a chat change/undo lands so the Edit tab's local form
  // state remounts with the fresh draft (manual edits are chat-gated, so
  // no in-progress typing is ever lost by the remount).
  const [chatEpoch, setChatEpoch] = useState(0);
  const [flashSlide, setFlashSlide] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  const gotoPreviewStep = useCallback(
    (slideId: string) => {
      const qi = questions.findIndex((q) => slideIdForQuestion(q.axisKey) === slideId);
      const previewStep =
        slideId === "intro" ? "intro" : slideId === "photo" ? "gate" : slideId === "results" ? "results" : `q${qi + 1}`;
      iframeRef.current?.contentWindow?.postMessage({ type: "gleame-preview-goto", step: previewStep }, "*");
    },
    [questions],
  );
  const reloadPreview = useCallback(() => setPreviewNonce((n) => n + 1), []);
  const updatePreview = useCallback((payload: { flow?: unknown; config?: unknown }) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "gleame-preview-update", flow: payload.flow, config: payload.config },
      "*",
    );
  }, []);

  const selectSlide = useCallback(
    (slideId: string) => {
      setSelectedSlide(slideId);
      gotoPreviewStep(slideId);
    },
    [setSelectedSlide, gotoPreviewStep],
  );

  // Tree structural edits (add/reorder) go through the same apply-tool path
  // as the panel editors; the response carries fresh preview payloads.
  const treeFetcher = useFetcher<StudioActionData>();
  const pendingSelectRef = useRef<string | null>(null);
  const treeProcessedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (treeFetcher.state !== "idle" || !treeFetcher.data) return;
    if (treeProcessedRef.current === treeFetcher.data) return;
    treeProcessedRef.current = treeFetcher.data;
    if (treeFetcher.data.ok) {
      if (treeFetcher.data.previewFlow || treeFetcher.data.previewConfig) {
        updatePreview({ flow: treeFetcher.data.previewFlow, config: treeFetcher.data.previewConfig });
      }
      if (pendingSelectRef.current) {
        selectSlide(pendingSelectRef.current);
        pendingSelectRef.current = null;
      }
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

  const problems = data.draft ? draftProblems(data.draft.flow) : [];
  const needsOnboarding = !data.hasDraft && data.liveQuestionCount === 0;

  return (
    <AppProvider isEmbeddedApp apiKey={data.apiKey}>
      <StudioShell
        topBar={
          <StudioTopBar
            step={step}
            onStepChange={setStep}
            hasDraft={data.hasDraft}
            problemCount={problems.length}
            catalog={data.catalog}
            onPublishClick={() => setStep("publish")}
          />
        }
        rail={
          step === "logic" ? (
            <LogicStep.Rail data={data} />
          ) : (
            <SlideTree
              flow={data.draft?.flow ?? null}
              selectedSlide={selectedSlide}
              onSelect={selectSlide}
              onAdd={addQuestion}
              onMove={moveQuestion}
              onReorder={(axisKeysInOrder) => submitTreeTool("reorder_questions", { axisKeysInOrder })}
              flowMapOpen={flowMapOpen && step === "build"}
              onToggleFlowMap={() => setFlowMapOpen((v) => !v)}
              flashSlide={flashSlide}
              disabled={chatBusy || treeFetcher.state !== "idle"}
              readOnly={step === "publish"}
              onReturnToBuild={step === "publish" ? () => setStep("build") : undefined}
            />
          )
        }
        canvas={
          step === "logic" ? (
            <LogicStep data={data} chatBusy={chatBusy} />
          ) : step === "publish" ? (
            <PublishStep
              data={data}
              problems={problems}
              onFix={(slideId) => {
                setStep("build");
                selectSlide(slideId);
              }}
            />
          ) : flowMapOpen ? (
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
            />
          )
        }
        panel={
          <EditPanel
            data={data}
            step={step}
            selectedSlide={selectedSlide}
            chatEpoch={chatEpoch}
            chatBusy={chatBusy}
            onSelectSlide={selectSlide}
            onPreviewUpdate={updatePreview}
            onPreviewReload={reloadPreview}
            chat={
              <ChatPanel
                aiConfigured={data.aiConfigured}
                initialSessionId={data.copilotSessionId}
                selectedSlide={selectedSlide}
                questions={questions}
                onBusyChange={setChatBusy}
                onChangeApplied={(target) => {
                  setChatEpoch((n) => n + 1);
                  reloadPreview();
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
            <OnboardingWizard data={data} onDone={(firstSlide) => selectSlide(firstSlide)} />
          ) : null
        }
      />
    </AppProvider>
  );
}
