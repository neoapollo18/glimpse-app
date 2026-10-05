import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Modal,
  Text,
} from "@shopify/polaris";
import type { StudioLoaderData, StudioActionData } from "../../routes/studio";
import type { DraftProblem } from "./draft-problems";
import { isQuestionServable } from "../../lib/option-visibility";
import { useAppBridge } from "@shopify/app-bridge-react";

// Optional scopes for one-click publish (shopify.app.glimpse-app.toml).
const PAGE_SCOPE = "write_online_store_pages";
const NAV_SCOPE = "write_online_store_navigation";
const SCOPE_DECLINED_LINE =
  "Publishing needs permission to add the Find My Match page to your Online Store. Click Publish again to allow it, or add the Gleame Quiz block from the theme editor instead.";

// V2-SPEC Part 7: the 3-panel Live tab collapses to
//   1. PublishSheet — a slide-over reachable from the topbar Publish
//      button on ANY tab: pre-publish checklist, placement (dedicated
//      page default), add-to-menu checkbox (default on), one Publish
//      action through the existing /app/api/publish-quiz mechanics, then
//      a success state with the live URL.
//   2. LiveTab — status header (Live/Off + URL + surface switch), version
//      history as a simple restore list, and the placements settings
//      link. Nothing else.

const MODE_LABELS: Record<string, string> = {
  matrix: "Rules only",
  ai: "AI",
  hybrid: "Rules + AI",
};

const THEME_EXT_UUID = "1013fc3f-b18d-aa39-07f6-10dfd57397a6749693b0";

/** V3-SPEC 6.4: a template quiz cannot be published while the
 * QUIZ_TEMPLATES_LIVE=off emergency kill is set. Otherwise templates go
 * live per shop through Publish (migration 081). Legacy shops are never
 * gated by it. Shared with the Studio top bar (studio.tsx). */
export function isPreviewOnly(data: StudioLoaderData): boolean {
  return Boolean(data.studio.template) && !data.studio.templatesLive;
}

/** Template quiz that is on, but whose template the storefront isn't
 * serving yet (never published since the quiz was turned on, e.g. turned on
 * before per-shop publishing existed). Shoppers see the classic layout.
 * Shared with the Studio top bar (studio.tsx), so the mismatch is visible
 * from every tab (spec 6.4). */
export function templateAwaitingPublish(data: StudioLoaderData): boolean {
  return (
    Boolean(data.studio.template) &&
    data.studio.templatesLive &&
    !data.studio.templateServed &&
    data.quizSurfaceEnabled !== false
  );
}

const PREVIEW_ONLY_LINE =
  "Template quizzes are paused on storefronts right now, so publishing is paused for this quiz. While paused, shoppers see the classic quiz layout.";

function themeEditorUrl(shopDomain: string): string {
  const handle = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${handle}/themes/current/editor?template=page.gleame-quiz&addAppBlockId=${THEME_EXT_UUID}/gleame-quiz&target=newAppsSection`;
}

// ---------------------------------------------------------------------
// Publish sheet (slide-over)
// ---------------------------------------------------------------------

export function PublishSheet({
  data,
  problems,
  open,
  onClose,
  onFix,
}: {
  data: StudioLoaderData;
  problems: DraftProblem[];
  open: boolean;
  onClose: () => void;
  onFix: (slideId: string) => void;
}) {
  const [addToMenu, setAddToMenu] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ liveUrl: string | null; error: string | null } | null>(null);
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const flow = data.draft?.flow;
  const settings = (data.draft?.settings ?? {}) as Record<string, unknown>;
  const questionCount = flow?.questions.length ?? 0;
  const ruleCount = flow?.rules.length ?? 0;
  const mode = String(settings.recommendation_mode ?? "matrix");
  const hasGuidance = String(settings.ai_guidance ?? "").trim() !== "";
  const logicReady = ruleCount > 0 || (mode !== "matrix" && hasGuidance);
  const servableCount = (flow?.questions ?? []).filter((q) =>
    isQuestionServable(q as Parameters<typeof isQuestionServable>[0]),
  ).length;
  const previewOnly = isPreviewOnly(data);

  // One-click publish writes a page (and optionally a main-menu link),
  // which needs optional access scopes most shops haven't granted (toml
  // optional_scopes). Ask in context, right before the write, instead of a
  // store-wide re-auth. Returns false only when the merchant declined.
  const ensureScopes = async (needed: string[]): Promise<boolean> => {
    try {
      const { granted } = await shopify.scopes.query();
      const missing = needed.filter((sc) => !granted.includes(sc));
      if (missing.length === 0) return true;
      const res = await shopify.scopes.request(missing);
      return res.result === "granted-all";
    } catch {
      // Scopes API unavailable (not embedded, old host): let the server
      // decide; it reports missingScopes if access is really absent.
      return true;
    }
  };

  const publish = async () => {
    setBusy(true);
    setResult(null);
    try {
      // The menu link is best-effort on the server, so only the page scope
      // gates the publish; the nav scope rides along when the box is ticked.
      const needed = addToMenu ? [PAGE_SCOPE, NAV_SCOPE] : [PAGE_SCOPE];
      if (!(await ensureScopes(needed))) {
        setResult({ liveUrl: null, error: SCOPE_DECLINED_LINE });
        return;
      }
      const post = async () => {
        const fd = new FormData();
        fd.append("intent", "publish");
        fd.append("addToMenu", String(addToMenu));
        const res = await fetch("/app/api/publish-quiz", { method: "POST", body: fd });
        return res.json().catch(() => null);
      };
      let body = await post();
      // Server still saw no access (query raced the grant, or the API was
      // unavailable above): request what it named, then retry once.
      if (!body?.ok && Array.isArray(body?.missingScopes) && body.missingScopes.length > 0) {
        if (!(await ensureScopes(body.missingScopes))) {
          setResult({ liveUrl: null, error: SCOPE_DECLINED_LINE });
          return;
        }
        body = await post();
      }
      if (body?.ok) {
        setResult({ liveUrl: body.liveUrl ?? null, error: null });
        revalidator.revalidate();
      } else {
        setResult({ liveUrl: null, error: body?.error ?? "Publishing failed" });
      }
    } catch (e) {
      setResult({ liveUrl: null, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <>
      {/* Scrim + sheet: a slide-over, deliberately NOT a modal card. */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: "56px 0 0 0", background: "rgba(20,22,26,0.35)", zIndex: 40 }}
      />
      <div
        style={{
          position: "fixed",
          top: 56,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: "90vw",
          background: "#fff",
          borderLeft: "1px solid #E1E3E5",
          boxShadow: "-12px 0 32px rgba(20,22,26,0.12)",
          zIndex: 41,
          overflowY: "auto",
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Publish your quiz
            </Text>
            <Button variant="tertiary" onClick={onClose} accessibilityLabel="Close">
              ✕
            </Button>
          </InlineStack>

          {result?.liveUrl ? (
            <Card>
              <BlockStack gap="200">
                <Badge tone="success">Live</Badge>
                <Text as="p" variant="bodyMd">
                  Your quiz is on your store.
                </Text>
                <Button url={result.liveUrl} external variant="primary">
                  Open the live page
                </Button>
                <Text as="p" variant="bodySm" tone="subdued">
                  {result.liveUrl.replace(/^https:\/\//, "")}
                </Text>
              </BlockStack>
            </Card>
          ) : (
            <>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Before it goes live
                  </Text>
                  <ChecklistRow
                    ok={questionCount > 0}
                    label={questionCount > 0 ? "Quiz has questions" : "Quiz has no questions yet"}
                  />
                  {problems.length === 0 ? (
                    <ChecklistRow ok label="Every question is complete and showing" />
                  ) : (
                    <>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Incomplete questions are automatically hidden from shoppers until you
                        finish them ({servableCount} of {questionCount} currently showing):
                      </Text>
                      {problems.map((p, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: "#B98900" }}>!</span>
                          <span style={{ flex: 1, fontSize: 13 }}>{p.message}</span>
                          <Button size="slim" onClick={() => onFix(p.slideId)}>
                            Fix
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  <ChecklistRow
                    ok={logicReady}
                    warn={!logicReady}
                    label={
                      logicReady
                        ? "Matching is set up"
                        : "No matching set up yet. Shoppers still get results, but generic ones."
                    }
                  />
                  <ChecklistRow
                    ok={data.catalog.syncEnabled}
                    warn={!data.catalog.syncEnabled}
                    label={data.catalog.syncEnabled ? "Catalog is synced" : "Catalog isn't synced (top bar)"}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Placement
                  </Text>
                  <Text as="p" variant="bodySm">
                    Dedicated page (recommended): Gleame creates a Find My Match page in your
                    Online Store and turns the quiz on.
                  </Text>
                  {data.studio.template && !previewOnly && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.studio.templateServed
                        ? "This template is already live. Publishing again keeps it live."
                        : data.quizSurfaceEnabled !== false
                          ? "Publishing puts this template live. Until then, shoppers see your previous quiz layout."
                          : "Publishing turns your quiz on with this template."}
                    </Text>
                  )}
                  <Checkbox
                    label="Add to main menu"
                    checked={addToMenu}
                    onChange={setAddToMenu}
                    helpText="Puts a Find My Match link in your store's main navigation."
                  />
                </BlockStack>
              </Card>

              {result?.error && <Banner tone="critical">{result.error}</Banner>}

              {previewOnly ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {PREVIEW_ONLY_LINE}
                </Text>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    loading={busy}
                    disabled={questionCount === 0}
                    onClick={publish}
                  >
                    Publish
                  </Button>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Nothing is visible to shoppers until you publish.
                  </Text>
                </>
              )}
            </>
          )}
        </BlockStack>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Live tab (slim)
// ---------------------------------------------------------------------

export function LiveTab({
  data,
  onOpenPublish,
}: {
  data: StudioLoaderData;
  onOpenPublish: () => void;
}) {
  const fetcher = useFetcher<StudioActionData>();
  const revalidator = useRevalidator();
  const [confirmingRestore, setConfirmingRestore] = useState<string | null>(null);
  // The preview token is pinned when the preview opens: data.previewToken is
  // re-minted on every loader run, and a src change would reload the
  // preview back to its intro mid-click-through.
  const [previewing, setPreviewing] = useState<{ id: string; token: string } | null>(null);
  const previewingVersionRow = previewing
    ? (data.versions as any[]).find((v) => v?.id === previewing.id) ?? null
    : null;
  const processedRef = useRef<StudioActionData | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (processedRef.current === fetcher.data) return;
    processedRef.current = fetcher.data;
    if (fetcher.data.ok && (fetcher.data.intent === "set-live" || fetcher.data.intent === "restore")) {
      setConfirmingRestore(null);
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const settings = (data.draft?.settings ?? {}) as Record<string, unknown>;
  const questionCount = data.draft?.flow.questions.length ?? 0;
  const ruleCount = data.draft?.flow.rules.length ?? 0;
  const mode = String(settings.recommendation_mode ?? "matrix");
  const surfaceOn = data.quizSurfaceEnabled !== false;
  const toggling = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "set-live";
  const matrixWithoutRules = mode === "matrix" && ruleCount === 0;
  const liveUrl = `https://${data.shopDomain}/pages/find-my-match`;
  const previewOnly = isPreviewOnly(data);
  const awaitingPublish = templateAwaitingPublish(data);

  const setLive = (enabled: boolean) => {
    const fd = new FormData();
    fd.append("intent", "set-live");
    fd.append("enabled", String(enabled));
    fetcher.submit(fd, { method: "POST", action: "/studio" });
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Status header */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone={surfaceOn ? "success" : "info"}>{surfaceOn ? "Live" : "Off"}</Badge>
                {surfaceOn && (
                  <a href={liveUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#2C6ECB" }}>
                    {liveUrl.replace(/^https:\/\//, "")}
                  </a>
                )}
              </InlineStack>
              {/* The emergency kill pauses going live, never turning off: a
                  live template quiz keeps its Turn off switch. */}
              {previewOnly && !surfaceOn ? (
                <Badge tone="new">Preview only</Badge>
              ) : surfaceOn ? (
                <Button loading={toggling} onClick={() => setLive(false)}>
                  Turn off
                </Button>
              ) : (
                <Button
                  variant="primary"
                  loading={toggling}
                  disabled={questionCount === 0 || matrixWithoutRules}
                  onClick={() => setLive(true)}
                >
                  Turn on
                </Button>
              )}
            </InlineStack>
            {previewOnly && (
              <Text as="p" variant="bodySm" tone="subdued">
                {PREVIEW_ONLY_LINE}
              </Text>
            )}
            {awaitingPublish && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    Your store is still showing your previous quiz layout. Put this template live
                    to show it to shoppers where your quiz already appears.
                  </Text>
                  <InlineStack>
                    {/* The quiz is already on and placed: only the template's
                        go-live stamp is missing, so this re-sends Turn on
                        (which stamps it) rather than the full Publish, which
                        would also create a page and a main-menu link. */}
                    <Button variant="primary" loading={toggling} onClick={() => setLive(true)}>
                      Put template live
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Banner>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              Edits save to {data.shopDomain} as you make them; shoppers see the quiz only while
              it's on. {questionCount} {questionCount === 1 ? "question" : "questions"}
              {ruleCount > 0 ? ` · ${ruleCount} ${ruleCount === 1 ? "rule" : "rules"}` : ""} ·{" "}
              {MODE_LABELS[mode] ?? mode} matching.
            </Text>
            {matrixWithoutRules && !surfaceOn && !previewOnly && (
              <Text as="p" variant="bodySm" tone="subdued">
                Pin products to answer paths in Check matches before turning the quiz on.
              </Text>
            )}
            {fetcher.data && !fetcher.data.ok && fetcher.data.error && (
              <Banner tone="critical">{fetcher.data.error}</Banner>
            )}
            {!surfaceOn && !previewOnly && (
              <InlineStack gap="200">
                <Button variant="plain" onClick={onOpenPublish}>
                  Publish for the first time
                </Button>
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {/* Version history */}
        {data.versions.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Version history
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Gleame saves restore points as you edit, and before template switches and
                restores. Preview any version, then restore it if you want it back.
              </Text>
              {data.versions
                .filter((v: any) => v != null)
                .map((v: any) => (
                  <InlineStack key={v.id} align="space-between" blockAlign="center" wrap={false}>
                    <Text as="span" variant="bodySm">
                      {versionLabel(v)} · {new Date(v.createdAt).toLocaleString()}
                    </Text>
                    <InlineStack gap="100" wrap={false}>
                      {data.previewToken && (
                        <Button
                          size="slim"
                          variant="tertiary"
                          onClick={() => data.previewToken && setPreviewing({ id: v.id, token: data.previewToken })}
                        >
                          Preview
                        </Button>
                      )}
                      <Button size="slim" onClick={() => setConfirmingRestore(v.id)}>
                        Restore
                      </Button>
                    </InlineStack>
                  </InlineStack>
                ))}
              <Modal
                open={previewing !== null}
                onClose={() => setPreviewing(null)}
                title={previewingVersionRow ? `${versionLabel(previewingVersionRow)} · ${new Date(previewingVersionRow.createdAt).toLocaleString()}` : "Version preview"}
                size="large"
                primaryAction={{
                  content: "Restore this version",
                  onAction: () => {
                    const id = previewing?.id ?? null;
                    setPreviewing(null);
                    setConfirmingRestore(id);
                  },
                }}
                secondaryActions={[{ content: "Close", onAction: () => setPreviewing(null) }]}
              >
                <Modal.Section flush>
                  {previewing && (
                    <iframe
                      key={previewing.id}
                      title="Version preview"
                      src={`/quiz-preview.html?token=${encodeURIComponent(previewing.token)}&version=${encodeURIComponent(previewing.id)}`}
                      style={{ width: "100%", height: "70vh", border: 0, display: "block" }}
                    />
                  )}
                </Modal.Section>
              </Modal>
              <Modal
                open={confirmingRestore !== null}
                onClose={() => setConfirmingRestore(null)}
                title="Restore this version?"
                primaryAction={{
                  content: "Restore",
                  loading: fetcher.state !== "idle" && fetcher.formData?.get("intent") === "restore",
                  onAction: () => {
                    if (!confirmingRestore) return;
                    const fd = new FormData();
                    fd.append("intent", "restore");
                    fd.append("versionId", confirmingRestore);
                    fetcher.submit(fd, { method: "POST", action: "/studio" });
                  },
                }}
                secondaryActions={[{ content: "Cancel", onAction: () => setConfirmingRestore(null) }]}
              >
                <Modal.Section>
                  <Text as="p">
                    This version replaces your current quiz configuration, including its template.
                    Your current setup is saved first, so a restore is always reversible. If the
                    quiz is on, shoppers see the restored version right away (a template that
                    isn't live yet still needs to be put live from this tab).
                  </Text>
                </Modal.Section>
              </Modal>
            </BlockStack>
          </Card>
        )}

        {/* Placements settings link */}
        <InlineStack gap="200">
          <Button variant="plain" url={themeEditorUrl(data.shopDomain)} external>
            Placement settings in the theme editor
          </Button>
        </InlineStack>
      </div>
    </div>
  );
}

/** Readable name for a version row. Auto snapshots carry the literal
 * label "auto-snapshot"; explicit ones carry a sentence ("before restore"). */
function versionLabel(v: { label: string | null; createdBy: string }): string {
  const label = (v.label ?? "").trim();
  if (label && label !== "auto-snapshot") return label.charAt(0).toUpperCase() + label.slice(1);
  if (v.createdBy === "ai") return "Generated by Gleame";
  if (v.createdBy === "manual") return "Saved manually";
  return "Auto-saved";
}

function ChecklistRow({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: ok ? "#008060" : warn ? "#B98900" : "#D82C0D" }}>
        {ok ? "✓" : warn ? "!" : "✕"}
      </span>
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}
