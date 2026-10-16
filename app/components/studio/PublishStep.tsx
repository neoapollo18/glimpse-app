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
  Box,
  Popover,
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
//   2. The Live tab itself folded into the top bar (2026-10-15):
//      LiveStatusControl (Live/Off + URL + surface switch + placements
//      link), VersionHistoryModal (restore list with preview) and
//      TemplatePendingBanner over the canvas.

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
  // Each opening starts at the checklist (the Hidden badge opens this sheet
  // to show which questions are hidden), not at the last publish's result.
  useEffect(() => {
    if (open) setResult(null);
  }, [open]);
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
  // store-wide re-auth. Returns null when access is (or may be) there, or
  // the line to show. A FAILED request is not a grant: treating it as one
  // hid the real error behind the server's "needs permission" card.
  const ensureScopes = async (needed: string[]): Promise<string | null> => {
    // Scopes API absent (not embedded, old host): let the server decide;
    // it reports missingScopes if access is really absent.
    if (!shopify?.scopes) return null;
    try {
      const { granted } = await shopify.scopes.query();
      const missing = needed.filter((sc) => !granted.includes(sc));
      if (missing.length === 0) return null;
      const res = await shopify.scopes.request(missing);
      return res.result === "granted-all" ? null : SCOPE_DECLINED_LINE;
    } catch (e) {
      console.error("[publish] scopes request failed", e);
      return `Shopify couldn't ask for permission to add the page (${(e as Error)?.message || "unknown error"}). Reload the app and try again, or add the Gleame Quiz block from the theme editor instead.`;
    }
  };

  const publish = async () => {
    setBusy(true);
    setResult(null);
    try {
      // The menu link is best-effort on the server, so only the page scope
      // gates the publish; the nav scope rides along when the box is ticked.
      const needed = addToMenu ? [PAGE_SCOPE, NAV_SCOPE] : [PAGE_SCOPE];
      const scopeError = await ensureScopes(needed);
      if (scopeError) {
        setResult({ liveUrl: null, error: scopeError });
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
        const retryError = await ensureScopes(body.missingScopes);
        if (retryError) {
          setResult({ liveUrl: null, error: retryError });
          return;
        }
        body = await post();
        // Granted on the client but the server still can't write: say so
        // instead of repeating the same permission card.
        if (!body?.ok && Array.isArray(body?.missingScopes) && body.missingScopes.length > 0) {
          console.error("[publish] server still missing scopes after grant", body.missingScopes, body.grantedScopes);
          body = {
            ...body,
            error:
              "Shopify shows the permission as granted, but the page still couldn't be created. Reload the app and publish again; if it keeps happening, contact support.",
          };
        }
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
// Live status + version history. The Live tab folded into the top bar
// (2026-10-15): status and the on/off switch live in a header popover,
// version history in a modal opened from the header, and the "template not
// live" warning in a banner over the canvas.
// ---------------------------------------------------------------------

/** set-live with a revalidate on success. Shared by the status popover and
 * the template banner (each keeps its own fetcher). */
function useSetLive() {
  const fetcher = useFetcher<StudioActionData>();
  const revalidator = useRevalidator();
  const processedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (processedRef.current === fetcher.data) return;
    processedRef.current = fetcher.data;
    if (fetcher.data.ok && fetcher.data.intent === "set-live") revalidator.revalidate();
  }, [fetcher.state, fetcher.data, revalidator]);
  const setLive = (enabled: boolean) => {
    const fd = new FormData();
    fd.append("intent", "set-live");
    fd.append("enabled", String(enabled));
    fetcher.submit(fd, { method: "POST", action: "/studio" });
  };
  return {
    setLive,
    toggling: fetcher.state !== "idle" && fetcher.formData?.get("intent") === "set-live",
    error: fetcher.data && !fetcher.data.ok ? fetcher.data.error ?? null : null,
    data: fetcher.data,
  };
}

const statusDot = (color: string) => (
  <span
    aria-hidden
    style={{ width: 8, height: 8, borderRadius: 999, background: color, display: "inline-block", flexShrink: 0 }}
  />
);

/** Top bar "Live / Off" menu: where the quiz is, the on/off switch, and the
 * template go-live action. */
export function LiveStatusControl({
  data,
  open,
  onToggle,
  onClose,
  onOpenPublish,
  onOpenHistory,
}: {
  data: StudioLoaderData;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenPublish: () => void;
  onOpenHistory: () => void;
}) {
  const live = useSetLive();
  const { setLive, toggling } = live;
  // An error from an earlier attempt doesn't greet the next opening.
  const [dismissed, setDismissed] = useState<unknown>(null);
  useEffect(() => {
    if (open) setDismissed(live.data ?? null);
    // Only on opening; a new attempt's response is a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const error = live.data && live.data !== dismissed ? live.error : null;
  const settings = (data.draft?.settings ?? {}) as Record<string, unknown>;
  const questionCount = data.draft?.flow.questions.length ?? 0;
  const ruleCount = data.draft?.flow.rules.length ?? 0;
  const mode = String(settings.recommendation_mode ?? "matrix");
  const surfaceOn = data.quizSurfaceEnabled !== false;
  const matrixWithoutRules = mode === "matrix" && ruleCount === 0;
  const liveUrl = `https://${data.shopDomain}/pages/find-my-match`;
  const previewOnly = isPreviewOnly(data);
  const awaitingPublish = templateAwaitingPublish(data);
  const label = surfaceOn ? "Live" : previewOnly ? "Preview only" : "Off";

  return (
    <Popover
      active={open}
      onClose={onClose}
      preferredAlignment="right"
      activator={
        // Plain button: Polaris Button takes text only, and the status dot
        // is the point of this control.
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Quiz status: ${label}`}
          aria-expanded={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 10px",
            border: "1px solid #C9CCCF",
            borderRadius: 8,
            background: "#fff",
            fontSize: 13,
            fontWeight: 600,
            color: "#202223",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {statusDot(surfaceOn ? (awaitingPublish ? "#B98900" : "#29845A") : "#8C9196")}
          {label}
          <span aria-hidden style={{ fontSize: 10, color: "#6D7175" }}>
            {open ? "\u25B2" : "\u25BC"}
          </span>
        </button>
      }
    >
      <Box padding="400" width="340px">
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Badge tone={surfaceOn ? "success" : "info"}>{surfaceOn ? "Live" : "Off"}</Badge>
            {surfaceOn && (
              <a href={liveUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#2C6ECB", overflowWrap: "anywhere" }}>
                {liveUrl.replace(/^https:\/\//, "")}
              </a>
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
                  Your store is still showing your previous quiz layout. Put this template live to
                  show it where your quiz already appears.
                </Text>
                <InlineStack>
                  {/* Re-sends Turn on (which stamps the template live), not
                      the full Publish, which would also create a page and a
                      main-menu link. */}
                  <Button variant="primary" loading={toggling} onClick={() => setLive(true)}>
                    Put template live
                  </Button>
                </InlineStack>
              </BlockStack>
            </Banner>
          )}
          <Text as="p" variant="bodySm" tone="subdued">
            Edits save to {data.shopDomain} as you make them; shoppers see the quiz only while it's on.{" "}
            {questionCount} {questionCount === 1 ? "question" : "questions"}
            {ruleCount > 0 ? ` · ${ruleCount} ${ruleCount === 1 ? "rule" : "rules"}` : ""} · {MODE_LABELS[mode] ?? mode}{" "}
            matching.
          </Text>
          {matrixWithoutRules && !surfaceOn && !previewOnly && (
            <Text as="p" variant="bodySm" tone="subdued">
              Pin products to answer paths in Check matches before turning the quiz on.
            </Text>
          )}
          {error && <Banner tone="critical">{error}</Banner>}
          {/* The emergency kill pauses going live, never turning off: a live
              template quiz keeps its Turn off switch. */}
          {!(previewOnly && !surfaceOn) && (
            <InlineStack gap="200">
              {surfaceOn ? (
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
              {!surfaceOn && (
                <Button variant="plain" onClick={onOpenPublish}>
                  Publish for the first time
                </Button>
              )}
            </InlineStack>
          )}
          <InlineStack gap="300">
            {data.versions.length > 0 && (
              <Button variant="plain" onClick={onOpenHistory}>
                Version history
              </Button>
            )}
            <Button variant="plain" url={themeEditorUrl(data.shopDomain)} external>
              Placement settings
            </Button>
          </InlineStack>
        </BlockStack>
      </Box>
    </Popover>
  );
}

/** Banner over the canvas while a template quiz is on but its template
 * isn't served yet: shoppers still see the previous layout. */
export function TemplatePendingBanner({ data }: { data: StudioLoaderData }) {
  const { setLive, toggling, error } = useSetLive();
  if (!templateAwaitingPublish(data)) return null;
  return (
    <div style={{ padding: "12px 16px 0" }}>
      <Banner tone="warning">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            Your store is still showing your previous quiz layout. Put this template live to show it
            to shoppers where your quiz already appears.
          </Text>
          {error && (
            <Text as="p" variant="bodySm" tone="critical">
              {error}
            </Text>
          )}
          <InlineStack>
            <Button variant="primary" loading={toggling} onClick={() => setLive(true)}>
              Put template live
            </Button>
          </InlineStack>
        </BlockStack>
      </Banner>
    </div>
  );
}

type HistoryView = { kind: "list" } | { kind: "preview"; id: string; token: string } | { kind: "confirm"; id: string };

/** Version history: the list, a preview of any version, and restore. One
 * modal whose content steps list -> preview -> confirm. */
export function VersionHistoryModal({
  data,
  open,
  onClose,
  onBeforeRestore,
  onRestored,
}: {
  data: StudioLoaderData;
  open: boolean;
  onClose: () => void;
  onBeforeRestore?: () => void;
  onRestored?: () => void;
}) {
  const fetcher = useFetcher<StudioActionData>();
  const revalidator = useRevalidator();
  // The preview token is pinned when a preview opens: data.previewToken is
  // re-minted on every loader run, and a src change would reload the
  // preview back to its intro mid-click-through.
  const [view, setView] = useState<HistoryView>({ kind: "list" });
  const processedRef = useRef<StudioActionData | null>(null);
  const close = () => {
    setView({ kind: "list" });
    onClose();
  };
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (processedRef.current === fetcher.data) return;
    processedRef.current = fetcher.data;
    if (fetcher.data.ok && fetcher.data.intent === "restore") {
      revalidator.revalidate();
      onRestored?.();
      close();
    }
    // close/revalidator identities don't matter for a once-per-response effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const versions = (data.versions as any[]).filter((v) => v != null);
  const rowFor = (id: string) => versions.find((v) => v.id === id) ?? null;
  const restoring = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "restore";
  // Which version the last restore attempt was for: its error shows only on
  // that version's confirm step, and reopening the modal clears it.
  const [errorFor, setErrorFor] = useState<string | null>(null);
  useEffect(() => {
    if (open) setErrorFor(null);
  }, [open]);
  const restoreError =
    errorFor &&
    view.kind === "confirm" &&
    view.id === errorFor &&
    fetcher.state === "idle" &&
    fetcher.data &&
    !fetcher.data.ok &&
    fetcher.data.intent === "restore"
      ? fetcher.data.error ?? "Restore failed"
      : null;

  if (view.kind === "preview") {
    const row = rowFor(view.id);
    return (
      <Modal
        open={open}
        onClose={close}
        size="large"
        title={row ? `${versionLabel(row)} · ${new Date(row.createdAt).toLocaleString()}` : "Version preview"}
        primaryAction={{ content: "Restore this version", onAction: () => setView({ kind: "confirm", id: view.id }) }}
        secondaryActions={[{ content: "Back", onAction: () => setView({ kind: "list" }) }]}
      >
        <Modal.Section flush>
          <iframe
            key={view.id}
            title="Version preview"
            src={`/quiz-preview.html?token=${encodeURIComponent(view.token)}&version=${encodeURIComponent(view.id)}`}
            style={{ width: "100%", height: "70vh", border: 0, display: "block" }}
          />
        </Modal.Section>
      </Modal>
    );
  }

  if (view.kind === "confirm") {
    return (
      <Modal
        open={open}
        onClose={close}
        title="Restore this version?"
        primaryAction={{
          content: "Restore",
          loading: restoring,
          onAction: () => {
            onBeforeRestore?.();
            setErrorFor(null);
            const fd = new FormData();
            fd.append("intent", "restore");
            fd.append("versionId", view.id);
            fetcher.submit(fd, { method: "POST", action: "/studio" });
            setErrorFor(view.id);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setView({ kind: "list" }) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              This version replaces your current quiz configuration, including its template. Your
              current setup is saved first, so a restore is always reversible. If the quiz is on,
              shoppers see the restored version right away (a template that isn't live yet still
              needs to be put live from the status menu in the top bar).
            </Text>
            {restoreError && <Banner tone="critical">{restoreError}</Banner>}
          </BlockStack>
        </Modal.Section>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title="Version history" secondaryActions={[{ content: "Close", onAction: close }]}>
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" variant="bodySm" tone="subdued">
            Gleame saves restore points as you edit, and before template switches and restores.
            Preview any version, then restore it if you want it back.
          </Text>
          {versions.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              No restore points yet. They appear as you edit the quiz.
            </Text>
          ) : (
            versions.map((v) => (
              <InlineStack key={v.id} align="space-between" blockAlign="center" wrap={false}>
                <Text as="span" variant="bodySm">
                  {versionLabel(v)} · {new Date(v.createdAt).toLocaleString()}
                </Text>
                <InlineStack gap="100" wrap={false}>
                  {data.previewToken && (
                    <Button
                      size="slim"
                      variant="tertiary"
                      onClick={() => data.previewToken && setView({ kind: "preview", id: v.id, token: data.previewToken })}
                    >
                      Preview
                    </Button>
                  )}
                  <Button size="slim" onClick={() => setView({ kind: "confirm", id: v.id })}>
                    Restore
                  </Button>
                </InlineStack>
              </InlineStack>
            ))
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
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
