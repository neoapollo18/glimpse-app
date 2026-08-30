import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  ProgressBar,
  Modal,
  TextField,
  Select,
  Spinner,
  InlineGrid,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect, useRef, useState } from "react";
import jwt from "jsonwebtoken";
import { authenticate } from "../shopify.server";
import { findShopByDomain, supabase } from "../lib/supabase.server";
import {
  getQuizDraft,
  initDraftFromLive,
  discardQuizDraft,
  publishQuizDraft,
  listVersions,
  restoreVersion,
  type QuizDraft,
} from "../lib/quiz-draft.server";
import { enableCatalogSync, syncCatalogPage } from "../lib/catalog-sync.server";
import { isClaudeConfigured } from "../lib/claude.server";
import { getLatestSessionId } from "../lib/quiz-copilot.server";
import { readSseStream } from "../lib/sse-client";
import { useCatalogSync } from "../lib/use-catalog-sync";

// ---------------------------------------------------------------------
// Quiz Builder — the self-serve surface for creating and editing the quiz
// as a DRAFT, separate from the live config. Publishing snapshots the live
// config first (rollback insurance) and then writes through the existing
// save path. The AI copilot ("Build with Gleame") mounts into this page.
// ---------------------------------------------------------------------

function draftSummary(draft: QuizDraft | null) {
  if (!draft) return null;
  return {
    axes: draft.flow.axes?.length ?? 0,
    questions: draft.flow.questions?.length ?? 0,
    rules: draft.flow.rules?.length ?? 0,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await findShopByDomain(shopDomain);
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const [draft, versions, shopRowRes, copilotSessionId] = await Promise.all([
    getQuizDraft(shop.id).catch((e) => {
      // Table missing (migration 058 not run yet) should render a setup
      // banner, not a crash page.
      console.error("[quiz-builder] draft load failed:", e.message);
      return null;
    }),
    listVersions(shop.id).catch(() => []),
    // select('*') so this works before AND after migration 057.
    supabase.from("shops").select("*").eq("id", shop.id).single(),
    getLatestSessionId(shop.id).catch(() => null),
  ]);
  const shopRow = shopRowRes.data;

  // Short-lived token for the preview iframe (it can't share the embedded
  // admin session; see quiz-preview[.]html.ts).
  const previewToken = process.env.SHOPIFY_API_SECRET
    ? jwt.sign({ shopId: shop.id, shopDomain }, process.env.SHOPIFY_API_SECRET, { expiresIn: "12h" })
    : null;

  return json({
    shopDomain,
    aiConfigured: isClaudeConfigured(),
    previewToken,
    copilotSessionId,
    draft: draftSummary(draft),
    hasDraft: draft !== null,
    versions,
    catalog: {
      syncEnabled: (shopRow as any)?.catalog_sync_enabled === true,
      lastSyncedAt: ((shopRow as any)?.catalog_last_synced_at as string | null) ?? null,
      cursor: ((shopRow as any)?.catalog_sync_cursor as string | null) ?? null,
      productCount: ((shopRow as any)?.catalog_product_count as number | null) ?? null,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let session, admin;
  try {
    ({ session, admin } = await authenticate.admin(request));
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
      case "init-draft": {
        await initDraftFromLive(shop.id);
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
      case "sync-catalog": {
        const cursor = (formData.get("cursor") as string) || null;
        if (!cursor) {
          const enabled = await enableCatalogSync(shopDomain);
          if (!enabled.ok) return json({ ok: false, error: enabled.error, intent });
        }
        const page = await syncCatalogPage(admin, shopDomain, cursor);
        return json({
          ok: page.errors.length === 0,
          error: page.errors.length ? page.errors.slice(0, 3).join("; ") : undefined,
          intent,
          nextCursor: page.nextCursor,
          synced: page.synced,
          total: page.total,
        });
      }
      default:
        return json({ ok: false, error: "Unknown intent" }, { status: 400 });
    }
  } catch (err) {
    console.error(`[quiz-builder] ${intent} failed:`, err);
    return json({ ok: false, error: err instanceof Error ? err.message : "Action failed", intent }, { status: 500 });
  }
};

type ActionData = {
  ok: boolean;
  error?: string;
  intent?: string;
  nextCursor?: string | null;
  synced?: number;
  total?: number | null;
};

type GenerateEvent =
  | { type: "progress"; phase: string }
  | { type: "result"; summary: { axes: number; questions: number; rules: number; mode: string }; warnings: string[] }
  | { type: "error"; error: string; warnings?: string[] }
  | { type: "heartbeat" };

export default function QuizBuilder() {
  const { shopDomain, aiConfigured, previewToken, copilotSessionId: initialSessionId, draft, hasDraft, versions, catalog } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const revalidator = useRevalidator();

  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const sync = useCatalogSync({ onComplete: () => revalidator.revalidate() });

  // ---- AI generation (Build with Gleame) ----
  const [brief, setBrief] = useState({
    category: "",
    brandVoice: "",
    quizLength: "standard",
    modePreference: "auto",
    extraNotes: "",
  });
  const [genPhase, setGenPhase] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [genWarnings, setGenWarnings] = useState<string[]>([]);
  const [genSummary, setGenSummary] = useState<{ axes: number; questions: number; rules: number; mode: string } | null>(null);

  const generateRunningRef = useRef(false);
  const runGenerate = async () => {
    if (generateRunningRef.current) return;
    generateRunningRef.current = true;
    setGenPhase("Starting…");
    setGenError(null);
    setGenWarnings([]);
    setGenSummary(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(brief)) fd.append(k, v);
    let gotTerminal = false;
    try {
      // App Bridge patches global fetch with the session token in embedded
      // apps; EventSource can't POST, so we read the SSE body manually.
      const res = await fetch("/app/api/quiz-generate", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await readSseStream<GenerateEvent>(res, (event) => {
        if (event.type === "progress") setGenPhase(event.phase);
        else if (event.type === "result") {
          gotTerminal = true;
          setGenSummary(event.summary);
          setGenWarnings(event.warnings ?? []);
          revalidator.revalidate();
          reloadPreview();
        } else if (event.type === "error") {
          gotTerminal = true;
          setGenError(event.error);
          setGenWarnings(event.warnings ?? []);
        }
      });
      if (!gotTerminal) {
        // Stream cut cleanly (deploy, proxy) without a result or error
        // frame — without this the button just stops spinning in silence.
        setGenError("Generation was interrupted. Check the draft status above, or try again.");
        revalidator.revalidate();
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      // A severed stream (deploy, proxy cut) must not leave the button
      // spinning forever.
      setGenPhase(null);
      generateRunningRef.current = false;
    }
  };

  const submit = (intent: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append("intent", intent);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    fetcher.submit(fd, { method: "POST" });
  };

  // ---- Copilot chat (Build with Gleame) ----
  type ChatItem =
    | { kind: "user"; text: string }
    | { kind: "assistant"; text: string }
    | { kind: "change"; tool: string; target: string; description: string; snapshotId: string; undone?: boolean };
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  // Seeded from the loader so the copilot resumes the shop's latest session
  // (model memory + undo snapshots) across page loads.
  const copilotSessionId = useRef<string | null>(initialSessionId);

  type CopilotEvent =
    | { type: "token"; text: string }
    | { type: "change"; tool: string; target: string; description: string; snapshotId: string }
    | { type: "done"; sessionId: string }
    | { type: "error"; error: string }
    | { type: "heartbeat" };

  const appendAssistantText = (text: string) => {
    setChatItems((items) => {
      const last = items[items.length - 1];
      if (last?.kind === "assistant") {
        return [...items.slice(0, -1), { kind: "assistant", text: last.text + text }];
      }
      return [...items, { kind: "assistant", text }];
    });
  };

  const sendChat = async (text: string) => {
    const message = text.trim();
    if (!message || chatBusy) return;
    setChatInput("");
    setChatBusy(true);
    setChatItems((items) => [...items, { kind: "user", text: message }]);
    const fd = new FormData();
    fd.append("intent", "message");
    fd.append("text", message);
    if (copilotSessionId.current) fd.append("sessionId", copilotSessionId.current);
    let sawChange = false;
    try {
      const res = await fetch("/app/api/quiz-copilot", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await readSseStream<CopilotEvent>(res, (event) => {
        if (event.type === "token") {
          appendAssistantText(event.text);
        } else if (event.type === "change") {
          sawChange = true;
          setChatItems((items) => [
            ...items,
            { kind: "change", tool: event.tool, target: event.target, description: event.description, snapshotId: event.snapshotId },
          ]);
        } else if (event.type === "done") {
          copilotSessionId.current = event.sessionId;
        } else if (event.type === "error") {
          appendAssistantText(`\nSomething went wrong: ${event.error}`);
        }
      });
      if (sawChange) {
        reloadPreview();
        revalidator.revalidate();
      }
    } catch (err) {
      appendAssistantText(`\nSomething went wrong: ${err instanceof Error ? err.message : "please try again"}`);
    } finally {
      setChatBusy(false);
    }
  };

  const resetChat = async () => {
    if (chatBusy) return;
    if (copilotSessionId.current) {
      const fd = new FormData();
      fd.append("intent", "reset");
      fd.append("sessionId", copilotSessionId.current);
      await fetch("/app/api/quiz-copilot", { method: "POST", body: fd }).catch(() => {});
    }
    setChatItems([]);
  };

  const undoChange = async (snapshotId: string) => {
    if (!copilotSessionId.current) return;
    const fd = new FormData();
    fd.append("intent", "undo");
    fd.append("sessionId", copilotSessionId.current);
    fd.append("snapshotId", snapshotId);
    const res = await fetch("/app/api/quiz-copilot", { method: "POST", body: fd });
    const body = await res.json().catch(() => null);
    if (body?.ok) {
      setChatItems((items) =>
        items.map((it) => (it.kind === "change" && it.snapshotId === snapshotId ? { ...it, undone: true } : it)),
      );
      reloadPreview();
      revalidator.revalidate();
    } else {
      setChatItems((items) => [...items, { kind: "assistant", text: `Undo failed: ${body?.error ?? "unknown error"}` }]);
    }
  };

  const SUGGESTION_CHIPS = ["Shorten the quiz", "Make it more playful", "Match my brand colors", "Add a budget question"];

  // ---- Preview iframe ----
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewStep, setPreviewStep] = useState("intro");
  // The loader mints a fresh JWT every revalidation; pin the first one so
  // routine revalidations (each catalog-sync page, copilot bookkeeping)
  // don't change the iframe src and hard-reload the preview. Intentional
  // reloads go through previewNonce. Tokens last 12h, far beyond a session.
  const stableTokenRef = useRef(previewToken);
  const reloadPreview = () => setPreviewNonce((n) => n + 1);
  const gotoPreviewStep = (step: string) => {
    setPreviewStep(step);
    iframeRef.current?.contentWindow?.postMessage({ type: "gleame-preview-goto", step }, "*");
  };
  const previewSteps = draft
    ? ["intro", ...Array.from({ length: draft.questions }, (_, i) => `q${i + 1}`), "results"]
    : ["intro", "results"];

  // Reload the preview when a DRAFT-MUTATING action completes. Not on
  // sync-catalog: a 2,000-product sync is ~40 actions and would reload the
  // iframe 40 times, resetting whatever step the merchant was inspecting.
  const DRAFT_MUTATING_INTENTS = ["init-draft", "discard-draft", "publish", "restore"];
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && DRAFT_MUTATING_INTENTS.includes(fetcher.data.intent ?? "")) {
      reloadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const busy = fetcher.state !== "idle";
  const lastError = fetcher.data?.ok === false ? fetcher.data.error : sync.syncError;
  const published = fetcher.data?.ok === true && fetcher.data.intent === "publish";

  return (
    <Page
      title="Quiz Builder"
      primaryAction={{
        content: "Publish draft",
        disabled: !hasDraft || busy,
        onAction: () => setPublishModalOpen(true),
      }}
    >
      <TitleBar title="Quiz Builder" />
      <BlockStack gap="500">
        {lastError && <Banner tone="critical">{lastError}</Banner>}
        {published && (
          <Banner
            tone="success"
            title="Draft published"
            action={{ content: "Finish setup", url: "/app/quiz" }}
          >
            Your quiz now runs the draft configuration. The previous version
            is archived in version history. If you haven't yet, add the
            Gleame Quiz section to your theme so shoppers can see it.
          </Banner>
        )}

        {/* Draft status */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Draft</Text>
              <Badge tone={hasDraft ? "attention" : "info"}>
                {hasDraft ? "Draft in progress" : "No draft"}
              </Badge>
            </InlineStack>
            {hasDraft && draft ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {draft.questions} {draft.questions === 1 ? "question" : "questions"} · {draft.rules}{" "}
                {draft.rules === 1 ? "rule" : "rules"}. Changes here never
                touch your live quiz until you publish.
              </Text>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                Start a draft from your current live quiz (or from scratch if
                you have none), then edit safely and publish when ready.
              </Text>
            )}
            <InlineStack gap="300">
              {!hasDraft && (
                <Button variant="primary" onClick={() => submit("init-draft")} loading={busy}>
                  Start a draft
                </Button>
              )}
              {hasDraft && (
                <Button tone="critical" variant="secondary" onClick={() => submit("discard-draft")} loading={busy}>
                  Discard draft
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Copilot chat rail + live draft preview (mockup layout) */}
        {previewToken && hasDraft && (
          <InlineGrid columns={{ xs: 1, lg: aiConfigured ? ["oneThird", "twoThirds"] : ["oneThird"] }} gap="400">
            {aiConfigured && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Refine with Gleame</Text>
                    {chatItems.length > 0 && (
                      <Button size="micro" variant="plain" onClick={resetChat} disabled={chatBusy}>
                        Reset conversation
                      </Button>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Describe a change and it appears in the preview. Every
                    change has an Undo.
                  </Text>
                  <div
                    style={{
                      maxHeight: 480,
                      minHeight: 240,
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      padding: "4px 0",
                    }}
                  >
                    {chatItems.length === 0 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Try: "Make the first question feel more editorial,
                        less like a survey."
                      </Text>
                    )}
                    {chatItems.map((item, i) => {
                      if (item.kind === "change") {
                        return (
                          <div
                            key={i}
                            style={{
                              border: "1px solid #E1E3E5",
                              borderRadius: 10,
                              padding: 10,
                              background: item.undone ? "#F6F6F7" : "#F2F7FE",
                              opacity: item.undone ? 0.6 : 1,
                            }}
                          >
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="150" blockAlign="center">
                                <Badge tone={item.undone ? undefined : "info"}>{`Applied to ${item.target}`}</Badge>
                                <Text as="span" variant="bodySm">{item.description}</Text>
                              </InlineStack>
                              {!item.undone && (
                                <Button size="micro" variant="plain" onClick={() => undoChange(item.snapshotId)}>
                                  Undo
                                </Button>
                              )}
                            </InlineStack>
                            {item.undone && (
                              <Text as="p" variant="bodySm" tone="subdued">Undone (later changes were reverted too)</Text>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={i}
                          style={{
                            alignSelf: item.kind === "user" ? "flex-end" : "flex-start",
                            maxWidth: "88%",
                            background: item.kind === "user" ? "#1a1a1a" : "#F6F6F7",
                            color: item.kind === "user" ? "#fff" : "inherit",
                            borderRadius: 12,
                            padding: "8px 12px",
                            whiteSpace: "pre-wrap",
                            fontSize: 13,
                            lineHeight: 1.45,
                          }}
                        >
                          {item.text}
                        </div>
                      );
                    })}
                    {chatBusy && (
                      <InlineStack gap="150" blockAlign="center">
                        <Spinner size="small" />
                        <Text as="span" variant="bodySm" tone="subdued">Thinking…</Text>
                      </InlineStack>
                    )}
                  </div>
                  <InlineStack gap="150" wrap>
                    {SUGGESTION_CHIPS.map((chip) => (
                      <Button key={chip} size="micro" disabled={chatBusy} onClick={() => sendChat(chip)}>
                        {chip}
                      </Button>
                    ))}
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="end">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Message Gleame"
                        labelHidden
                        placeholder="Tell Gleame what to change…"
                        value={chatInput}
                        onChange={setChatInput}
                        autoComplete="off"
                        multiline={1}
                      />
                    </div>
                    <Button variant="primary" onClick={() => sendChat(chatInput)} loading={chatBusy} disabled={!chatInput.trim()}>
                      Send
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Preview</Text>
                  <Badge tone="attention">Draft preview</Badge>
                </InlineStack>
                <InlineStack gap="200" wrap>
                  {previewSteps.map((step) => (
                    <Button
                      key={step}
                      size="slim"
                      pressed={previewStep === step}
                      onClick={() => gotoPreviewStep(step)}
                    >
                      {step === "intro" ? "Intro" : step === "results" ? "Results" : step.toUpperCase()}
                    </Button>
                  ))}
                </InlineStack>
                <div style={{ display: "flex", justifyContent: "center", background: "#F6F6F7", borderRadius: 16, padding: 24 }}>
                  <div
                    style={{
                      width: 390,
                      height: 720,
                      border: "10px solid #1a1a1a",
                      borderRadius: 36,
                      overflow: "hidden",
                      background: "#fff",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                    }}
                  >
                    <iframe
                      key={previewNonce}
                      ref={iframeRef}
                      title="Quiz preview"
                      src={`/quiz-preview.html?token=${encodeURIComponent(stableTokenRef.current ?? "")}&v=${previewNonce}`}
                      style={{ width: "100%", height: "100%", border: "0" }}
                    />
                  </div>
                </div>
              </BlockStack>
            </Card>
          </InlineGrid>
        )}

        {/* Build with Gleame (AI) */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Generate a quiz with AI</Text>
              <Badge tone="info">AI</Badge>
            </InlineStack>
            {!aiConfigured ? (
              <Banner tone="warning">
                AI quiz creation isn't set up for this installation. Contact
                Gleame support.
              </Banner>
            ) : (
              <>
                <Text as="p" variant="bodySm" tone="subdued">
                  Tell Gleame about your brand and it drafts the whole quiz from
                  your synced catalog: questions, answer options, recommendation
                  logic, and copy in your voice. It only ever writes to your
                  draft. You review and publish. Takes about a minute.
                </Text>
                <InlineStack gap="300" wrap>
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <TextField
                      label="What do you sell?"
                      placeholder="e.g. nail polish, hair extensions"
                      value={brief.category}
                      onChange={(v) => setBrief((b) => ({ ...b, category: v }))}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <TextField
                      label="Brand voice"
                      placeholder="e.g. playful and bold"
                      value={brief.brandVoice}
                      onChange={(v) => setBrief((b) => ({ ...b, brandVoice: v }))}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ minWidth: 160 }}>
                    <Select
                      label="Quiz length"
                      options={[
                        { label: "Standard (5-7 questions)", value: "standard" },
                        { label: "Short (3-4 questions)", value: "short" },
                      ]}
                      value={brief.quizLength}
                      onChange={(v) => setBrief((b) => ({ ...b, quizLength: v }))}
                    />
                  </div>
                  <div style={{ minWidth: 180 }}>
                    <Select
                      label="Matching style"
                      options={[
                        { label: "Let Gleame decide", value: "auto" },
                        { label: "Exact rules", value: "matrix" },
                        { label: "AI ranking", value: "ai" },
                        { label: "Rules + AI", value: "hybrid" },
                      ]}
                      value={brief.modePreference}
                      onChange={(v) => setBrief((b) => ({ ...b, modePreference: v }))}
                      helpText="How answers map to products. Let Gleame decide is right for most stores."
                    />
                  </div>
                </InlineStack>
                <TextField
                  label="Anything else Gleame should know? (optional)"
                  placeholder="Bestsellers, collections to feature, things to avoid…"
                  value={brief.extraNotes}
                  onChange={(v) => setBrief((b) => ({ ...b, extraNotes: v }))}
                  multiline={2}
                  autoComplete="off"
                />
                {genPhase && (
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text as="span" variant="bodySm" tone="subdued">{genPhase}</Text>
                  </InlineStack>
                )}
                {genError && <Banner tone="critical">{genError}</Banner>}
                {genSummary && (
                  <Banner tone="success" title="Draft quiz generated">
                    {genSummary.questions} questions · {genSummary.rules} rules ·{" "}
                    {({ matrix: "Rules only", ai: "AI", hybrid: "Rules + AI" } as Record<string, string>)[genSummary.mode] ?? genSummary.mode}{" "}
                    matching. Review it in the preview, then publish.
                  </Banner>
                )}
                {genWarnings.length > 0 && (
                  <Banner tone="warning" title="Heads up">
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {genWarnings.slice(0, 5).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </Banner>
                )}
                <InlineStack>
                  <Button
                    variant="primary"
                    onClick={runGenerate}
                    loading={genPhase !== null}
                    disabled={!brief.category || !catalog.syncEnabled}
                  >
                    {hasDraft ? "Regenerate draft with AI" : "Generate my quiz"}
                  </Button>
                </InlineStack>
                {!catalog.syncEnabled && (
                  <Banner tone="info">
                    Gleame builds your quiz from your real products. Sync your
                    catalog in the Catalog card below to get started.
                  </Banner>
                )}
                {catalog.syncEnabled && !brief.category && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Tell Gleame what you sell to enable generation.
                  </Text>
                )}
              </>
            )}
          </BlockStack>
        </Card>

        {/* Catalog sync */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Catalog</Text>
              <Badge tone={catalog.syncEnabled ? "success" : "attention"}>
                {catalog.syncEnabled ? "Sync on" : "Not synced"}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {catalog.syncEnabled
                ? `Your products stay in sync automatically. Last synced ${catalog.lastSyncedAt ? new Date(catalog.lastSyncedAt).toLocaleString() : "never"}.`
                : "Sync your Shopify catalog so the quiz can recommend your products. Existing product configuration is never overwritten."}
            </Text>
            {sync.progress && (
              <BlockStack gap="200">
                <ProgressBar
                  progress={sync.progress.total ? Math.min(100, Math.round((sync.progress.done / sync.progress.total) * 100)) : 10}
                  size="small"
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  Synced {sync.progress.done}{sync.progress.total ? ` of ${sync.progress.total}` : ""} products…
                </Text>
              </BlockStack>
            )}
            <InlineStack>
              <Button
                onClick={() => sync.start(catalog.cursor ?? undefined)}
                loading={sync.busy}
                disabled={sync.progress !== null}
              >
                {catalog.cursor ? "Resume sync" : catalog.syncEnabled ? "Re-sync catalog" : "Sync catalog"}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Advanced editors */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Advanced editing</Text>
            <Banner tone="warning">
              Changes made in these editors update your live quiz immediately,
              without going through a draft.
            </Banner>
            <InlineStack gap="300">
              <Button url="/app/quiz/questions">Questions</Button>
              <Button url="/app/quiz/logic">Recommendation logic</Button>
              <Button url="/app/assistant/quiz">Copy &amp; design</Button>
              <Button variant="plain" url="/app/assistant/recommendations">
                Advanced rules editor
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Version history */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Version history</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Restoring a version replaces your current draft (never your live
              quiz directly).
            </Text>
            {versions.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                No versions yet. Every publish archives the previous live
                config here so you can always roll back.
              </Text>
            ) : (
              <BlockStack gap="300">
                {versions.filter((v): v is NonNullable<typeof v> => v != null).map((v) => (
                  <InlineStack key={v.id} align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge
                        tone={v.status === "draft" ? "attention" : v.status === "published" ? "success" : "info"}
                      >
                        {v.status === "draft" ? "Draft" : v.status === "published" ? "Published" : "Archived"}
                      </Badge>
                      <Text as="span" variant="bodySm">
                        {v.label || (v.createdBy === "ai" ? "Generated by Gleame" : v.createdBy === "system" ? "Auto-archived at publish" : "Saved manually")}
                        {" · "}
                        {new Date(v.createdAt).toLocaleString()}
                      </Text>
                    </InlineStack>
                    {v.status !== "draft" && (
                      <Button
                        size="slim"
                        onClick={() => submit("restore", { versionId: v.id })}
                        loading={busy}
                      >
                        Restore to draft
                      </Button>
                    )}
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        title="Publish draft to your live quiz?"
        primaryAction={{
          content: "Publish",
          destructive: false,
          onAction: () => {
            setPublishModalOpen(false);
            submit("publish");
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setPublishModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              This replaces your live quiz configuration for {shopDomain} with
              the current draft. The existing live config is archived first,
              so you can restore it from version history at any time.
            </Text>
            <Text as="p" tone="subdued">
              Heads up: any changes made in the live editors (Questions,
              Recommendation logic, Copy &amp; design) since this draft was
              created are replaced too.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
