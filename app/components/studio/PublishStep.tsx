import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  Icon,
  InlineStack,
  Modal,
  Spinner,
  Text,
  Box,
  InlineGrid,
} from "@shopify/polaris";
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, XIcon } from "@shopify/polaris-icons";
import type { StudioLoaderData, StudioActionData } from "../../routes/studio";
import type { DraftProblem } from "./draft-problems";
import { isQuestionServable } from "../../lib/option-visibility";
import { useAppBridge } from "@shopify/app-bridge-react";
import { addQuizBlockUrl, templateLabel } from "../../lib/theme-extension";
import { useQuizBlockStatus } from "../QuizPlacementStatus";
import { matchingReadiness } from "../../lib/matching-readiness";
import { answerRuleSavesSettled } from "./MatchesTab";

// Optional scopes for one-click publish (shopify.app.glimpse-app.toml).
// read_themes only lets Publish check the theme for the quiz block, so
// publishing goes ahead without it.
const PAGE_SCOPE = "write_online_store_pages";
const NAV_SCOPE = "write_online_store_navigation";
const THEME_SCOPE = "read_themes";
const SCOPE_DECLINED_LINE =
  "Publishing needs permission to add the Find My Match page to your Online Store. Click Publish again to allow it, or add the Gleame Quiz block from the theme editor instead.";

/** A publish that went through (publish.server PublishResult). */
interface PublishOutcome {
  liveUrl: string | null;
  /** The quiz shows on the page. False: the page exists, empty, until the
   * Gleame Quiz block is added in the theme editor. */
  quizOnPage: boolean;
  /** The page's theme template ("page.find-my-match"), or null when it is
   * on the default page template (the merchant creates ours first). */
  pageTemplate: string | null;
}

// V2-SPEC Part 7 (Live tab restored 2026-10-16 with the setup guide):
//   1. PublishSheet: a Polaris modal reachable from the title bar Publish
//      button on ANY tab: pre-publish checklist, placement (dedicated
//      page default), add-to-menu checkbox (default on), and Publish in
//      the modal's primary action slot (Built for Shopify 4.1.6) through
//      the existing /app/api/publish-quiz mechanics, then a success state
//      with the live URL.
//   2. LiveTab: status + on/off, the setup guide (video + four manual
//      steps, collapsed once live), version history (VersionHistoryModal)
//      and the placements link; TemplatePendingBanner over the canvas.

const MODE_LABELS: Record<string, string> = {
  matrix: "Rules only",
  ai: "AI",
  hybrid: "Rules + AI",
};

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

/** Matching readiness from the Studio loader: every source the recommender
 * matches on (lib/matching-readiness), read on each load. Data without it
 * (older fixtures) falls back to the draft's rules and mode. */
function loaderMatchingReady(data: StudioLoaderData): boolean {
  if (data.matchingReady) return data.matchingReady.ready;
  const settings = (data.draft?.settings ?? {}) as Record<string, unknown>;
  return matchingReadiness({
    ruleCount: data.draft?.flow.rules.length ?? 0,
    mode: String(settings.recommendation_mode ?? "matrix"),
  }).ready;
}

/** Matching readiness, re-read whenever `active` turns true: Check matches
 * saves through a plain fetch that doesn't revalidate the Studio loader, so
 * the loader's answer could predate a sentence written seconds ago. Saves
 * still in flight (a sentence commits on blur, as Publish is clicked)
 * finish first. A failed re-read keeps the loader's answer. */
function useMatchingReady(data: StudioLoaderData, active: boolean): { ready: boolean; checking: boolean } {
  const [fresh, setFresh] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!active) return;
    setFresh(null);
    setChecking(true);
    let cancelled = false;
    answerRuleSavesSettled()
      .then(() => fetch("/app/api/matching-readiness"))
      .then((r) => r.json())
      .then((d: { ok?: boolean; ready?: unknown }) => {
        if (!cancelled && d?.ok && typeof d.ready === "boolean") setFresh(d.ready);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);
  return { ready: fresh ?? loaderMatchingReady(data), checking };
}


// ---------------------------------------------------------------------
// Publish sheet (modal)
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
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Finish was clicked and the block still isn't on the page.
  const [stillMissing, setStillMissing] = useState(false);
  // Matching is re-read on every opening (useMatchingReady).
  const { ready: logicReady, checking: checkingMatching } = useMatchingReady(data, open);
  // Each opening starts at the checklist (the Hidden badge opens this sheet
  // to show which questions are hidden), not at the last publish's result.
  useEffect(() => {
    if (open) {
      setOutcome(null);
      setError(null);
      setStillMissing(false);
    }
  }, [open]);
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  // Where the admin reports the quiz block (re-checked when the merchant
  // comes back from the theme editor). Sent with Publish for stores whose
  // theme Gleame can't read.
  const blockStatus = useQuizBlockStatus();
  const blockTemplates = blockStatus?.state === "active" ? blockStatus.placements.map((p) => p.template) : [];

  const flow = data.draft?.flow;
  const questionCount = flow?.questions.length ?? 0;
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
  // `optional` scopes are asked for in the same prompt but never block.
  const ensureScopes = async (needed: string[], optional: string[] = []): Promise<string | null> => {
    // Scopes API absent (not embedded, old host): let the server decide;
    // it reports missingScopes if access is really absent.
    if (!shopify?.scopes) return null;
    try {
      const { granted } = await shopify.scopes.query();
      const missing = [...needed, ...optional].filter((sc) => !granted.includes(sc));
      if (missing.length === 0) return null;
      const res = await shopify.scopes.request(missing);
      if (res.result === "granted-all") return null;
      if (!needed.some((sc) => missing.includes(sc))) return null;
      const after = await shopify.scopes.query();
      return needed.every((sc) => after.granted.includes(sc)) ? null : SCOPE_DECLINED_LINE;
    } catch (e) {
      console.error("[publish] scopes request failed", e);
      return `Shopify couldn't ask for permission to add the page (${(e as Error)?.message || "unknown error"}). Reload the app and try again, or add the Gleame Quiz block from the theme editor instead.`;
    }
  };

  const publish = async () => {
    const finishing = outcome !== null;
    setBusy(true);
    setError(null);
    try {
      // The menu link is best-effort on the server, so only the page scope
      // gates the publish; the nav scope rides along when the box is ticked.
      const needed = addToMenu ? [PAGE_SCOPE, NAV_SCOPE] : [PAGE_SCOPE];
      const scopeError = await ensureScopes(needed, [THEME_SCOPE]);
      if (scopeError) {
        setError(scopeError);
        return;
      }
      const post = async () => {
        const fd = new FormData();
        fd.append("intent", "publish");
        fd.append("addToMenu", String(addToMenu));
        fd.append("blockTemplates", blockTemplates.join(","));
        const res = await fetch("/app/api/publish-quiz", { method: "POST", body: fd });
        return res.json().catch(() => null);
      };
      let body = await post();
      // Server still saw no access (query raced the grant, or the API was
      // unavailable above): request what it named, then retry once.
      if (!body?.ok && Array.isArray(body?.missingScopes) && body.missingScopes.length > 0) {
        const retryError = await ensureScopes(body.missingScopes);
        if (retryError) {
          setError(retryError);
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
        const quizOnPage = body.quizOnPage !== false;
        setOutcome({
          liveUrl: body.liveUrl ?? null,
          quizOnPage,
          pageTemplate: typeof body.pageTemplate === "string" ? body.pageTemplate : null,
        });
        setStillMissing(finishing && !quizOnPage);
        revalidator.revalidate();
      } else {
        setError(body?.error ?? "Publishing failed");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const live = Boolean(outcome?.quizOnPage);
  // Published, but the page is empty until the Gleame Quiz block is added.
  const placing = Boolean(outcome && !outcome.quizOnPage);
  const admin = `https://admin.shopify.com/store/${data.shopDomain.replace(".myshopify.com", "")}`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={live ? "Your quiz is live" : placing ? "Add the quiz to your page" : "Publish your quiz"}
      primaryAction={
        live
          ? outcome!.liveUrl
            ? { content: "Open the live page", url: outcome!.liveUrl, external: true }
            : undefined
          : placing
            ? { content: "Finish", onAction: () => void publish(), loading: busy }
            : previewOnly
              ? undefined
              : { content: "Publish", onAction: () => void publish(), loading: busy, disabled: questionCount === 0 }
      }
      secondaryActions={[{ content: live ? "Done" : placing ? "Close" : "Cancel", onAction: onClose }]}
    >
      {live ? (
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              Your quiz is on your store.
            </Text>
            {outcome!.liveUrl && (
              <Text as="p" variant="bodySm" tone="subdued">
                {outcome!.liveUrl.replace(/^https:\/\//, "")}
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      ) : placing ? (
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Your Find My Match page is ready and your quiz is turned on. Last step: add the Gleame Quiz block to
              the page in your theme editor.
            </Text>
            {stillMissing && (
              <Banner tone="warning">
                The Gleame Quiz block isn&rsquo;t on the page yet. Add it in the theme editor and click Save, then
                click Finish.
              </Banner>
            )}
            {error && <Banner tone="critical">{error}</Banner>}
            <BlockStack gap="0">
              {outcome!.pageTemplate ? (
                <SetupStep
                  n={1}
                  title="Add the quiz block"
                  action={
                    <Button url={addQuizBlockUrl(data.shopDomain, data.apiKey, outcome!.pageTemplate)} external>
                      Add the quiz block
                    </Button>
                  }
                >
                  Your theme editor opens with the Gleame Quiz block ready to add. Click <b>Save</b>.
                </SetupStep>
              ) : (
                <SetupStep
                  n={1}
                  title="Create the quiz template"
                  action={
                    <Button url={`${admin}/themes/current/editor?template=page`} external>
                      Open theme editor
                    </Button>
                  }
                >
                  In your theme editor, open the page menu at the top and go to <b>Pages → Create template</b>. Name
                  it <b>find-my-match</b>, then click <b>Add block → Gleame Quiz → Save</b>.
                </SetupStep>
              )}
              <SetupStep n={2} title="Come back and click Finish">
                {outcome!.pageTemplate
                  ? addToMenu
                    ? "Gleame checks the block is there and adds the page to your main menu."
                    : "Gleame checks the block is there."
                  : addToMenu
                    ? "Gleame puts your Find My Match page on that template and adds it to your main menu."
                    : "Gleame puts your Find My Match page on that template."}
              </SetupStep>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      ) : (
        <>
          <Modal.Section>
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
                    <InlineStack key={i} gap="200" blockAlign="center" wrap={false}>
                      <span style={{ flexShrink: 0 }}>
                        <Icon source={AlertTriangleIcon} tone="caution" />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text as="span" variant="bodyMd">
                          {p.message}
                        </Text>
                      </div>
                      <Button size="slim" onClick={() => onFix(p.slideId)}>
                        Fix
                      </Button>
                    </InlineStack>
                  ))}
                </>
              )}
              {checkingMatching ? (
                <ChecklistRow ok={false} pending label="Checking matching…" />
              ) : (
                <ChecklistRow
                  ok={logicReady}
                  warn={!logicReady}
                  label={
                    logicReady
                      ? "Matching is set up"
                      : "No matching set up yet. Shoppers still get results, but generic ones."
                  }
                />
              )}
              <ChecklistRow
                ok={data.catalog.syncEnabled}
                warn={!data.catalog.syncEnabled}
                label={data.catalog.syncEnabled ? "Catalog is synced" : "Catalog isn't synced (top bar)"}
              />
            </BlockStack>
          </Modal.Section>
          <Modal.Section>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Placement
              </Text>
              <Text as="p" variant="bodyMd">
                Dedicated page (recommended): Gleame creates a Find My Match page in your
                Online Store and turns the quiz on. Then you add the Gleame Quiz block to it in
                your theme editor.
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
                helpText="Puts a Find My Match link in your store's main navigation once the quiz is on the page."
              />
              <Divider />
              {error && <Banner tone="critical">{error}</Banner>}
              <Text as="p" variant="bodySm" tone="subdued">
                {previewOnly ? PREVIEW_ONLY_LINE : "Nothing is visible to shoppers until you publish."}
              </Text>
            </BlockStack>
          </Modal.Section>
        </>
      )}
    </Modal>
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

// Setup tutorial (2026-10-16, Shopify asked for an in-app "how to publish"
// guide): a short video plus the four manual steps for putting the quiz on
// a store with the native Gleame Quiz block. One-click Publish stays the
// shortcut for steps 1 to 3.
export const SETUP_VIDEO_ID = "SXsqr9xmgo4";
const SETUP_VIDEO_URL = `https://youtu.be/${SETUP_VIDEO_ID}`;

function SetupVideo() {
  // Click-to-play: the YouTube player loads only when asked for, so the
  // Live tab stays light and nothing from YouTube loads by default.
  const [playing, setPlaying] = useState(false);
  return (
    <BlockStack gap="150">
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 12, overflow: "hidden", background: "#1a1a1a" }}>
        {playing ? (
          <iframe
            title="How to put the Gleame quiz on your store"
            src={`https://www.youtube-nocookie.com/embed/${SETUP_VIDEO_ID}?autoplay=1&rel=0`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Play the setup video"
            style={{ position: "absolute", inset: 0, border: 0, padding: 0, cursor: "pointer", background: "transparent" }}
          >
            <img
              src={`https://i.ytimg.com/vi/${SETUP_VIDEO_ID}/hqdefault.jpg`}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.85 }}
            />
            <span
              aria-hidden
              style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 56, height: 56, borderRadius: "50%", background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <span style={{ width: 0, height: 0, borderTop: "10px solid transparent", borderBottom: "10px solid transparent", borderLeft: "16px solid #fff", marginLeft: 4 }} />
            </span>
            <span style={{ position: "absolute", left: 12, bottom: 12, background: "rgba(255,255,255,0.92)", color: "#1a1a1a", fontSize: 13, fontWeight: 500, padding: "3px 8px", borderRadius: 6 }}>
              Watch the full setup
            </span>
          </button>
        )}
      </div>
      <Button variant="plain" url={SETUP_VIDEO_URL} external>
        Watch on YouTube
      </Button>
    </BlockStack>
  );
}

function SetupStep({ n, title, children, action }: { n: number; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 10, padding: "12px 0", borderTop: n > 1 ? "1px solid #E3E3E3" : undefined }}>
      <span
        aria-hidden
        style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid #C9CCCF", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#616161" }}
      >
        {n}
      </span>
      <BlockStack gap="150">
        <Text as="h4" variant="headingSm">
          {title}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {children}
        </Text>
        {action ? <InlineStack>{action}</InlineStack> : null}
      </BlockStack>
    </div>
  );
}

function SetupGuide({ data, quizName, onViewStore, onOpenPublish, previewOnly }: { data: StudioLoaderData; quizName: string; onViewStore: () => void; onOpenPublish: () => void; previewOnly: boolean }) {
  const handle = data.shopDomain.replace(".myshopify.com", "");
  const admin = `https://admin.shopify.com/store/${handle}`;
  const pageName = quizName.trim() || "Find my match";
  return (
    <InlineGrid columns={{ xs: 1, md: "2fr 3fr" }} gap="500">
      <SetupVideo />
      <BlockStack gap="0">
        {!previewOnly && (
          <Box paddingBlockEnd="300">
            <InlineStack gap="200" blockAlign="center" wrap>
              <Text as="p" variant="bodySm">
                Faster: Publish creates the page, turns the quiz on and opens the theme editor for the block.
              </Text>
              <Button size="slim" onClick={onOpenPublish}>
                Publish
              </Button>
            </InlineStack>
          </Box>
        )}
        <SetupStep
          n={1}
          title="Create the quiz template"
          action={
            <Button url={`${admin}/themes/current/editor?template=page`} external>
              Open theme editor
            </Button>
          }
        >
          In your theme editor, open the page menu at the top and go to <b>Pages → Create template</b>. Name it <b>find-my-match</b>, then click <b>Add block → Gleame Quiz → Save</b>. Use your live theme: templates made in a draft theme won&rsquo;t show up in the next step.
        </SetupStep>
        <SetupStep
          n={2}
          title="Create the quiz page"
          action={
            <Button url={`${admin}/pages/new`} external>
              Add a page
            </Button>
          }
        >
          In Shopify, go to <b>Online Store → Pages → Add page</b>. Title it <b>{pageName}</b>. On the right, under <b>Theme template</b>, choose <b>find-my-match</b>, then click <b>Save</b>.
        </SetupStep>
        <SetupStep
          n={3}
          title="Add it to your menu"
          action={
            <Button url={`${admin}/menus`} external>
              Open navigation
            </Button>
          }
        >
          Go to <b>Online Store → Navigation → Main menu</b>, click <b>Add menu item</b>, choose the <b>{pageName}</b> page, then click <b>Save</b>.
        </SetupStep>
        <SetupStep
          n={4}
          title="Check it on your store"
          action={previewOnly ? undefined : <Button onClick={onViewStore}>View on my store</Button>}
        >
          Take the quiz once as a shopper to make sure everything looks right. Your quiz needs an Online Store 2.0 theme.
        </SetupStep>
      </BlockStack>
    </InlineGrid>
  );
}

// ---------------------------------------------------------------------
// Live tab (restored 2026-10-16): status and on/off first, then the setup
// guide (collapsed once the quiz is live), version history and placements.
// ---------------------------------------------------------------------

export function LiveTab({
  data,
  quizName,
  onOpenPublish,
  onOpenHistory,
  onViewStore,
  viewStoreBusy,
}: {
  data: StudioLoaderData;
  quizName: string;
  onOpenPublish: () => void;
  onOpenHistory: () => void;
  onViewStore: () => void;
  viewStoreBusy: boolean;
}) {
  const { setLive, toggling, error } = useSetLive();
  const settings = (data.draft?.settings ?? {}) as Record<string, unknown>;
  const questionCount = data.draft?.flow.questions.length ?? 0;
  const ruleCount = data.draft?.flow.rules.length ?? 0;
  const mode = String(settings.recommendation_mode ?? "matrix");
  const surfaceOn = data.quizSurfaceEnabled !== false;
  // Re-read on arrival: matching may have been written in Check matches
  // since the Studio loaded.
  const noMatching = !useMatchingReady(data, true).ready;
  const previewOnly = isPreviewOnly(data);
  const awaitingPublish = templateAwaitingPublish(data);
  // Two separate facts: the on/off switch (shoppers may see the quiz) and
  // placement (the quiz section is on a page of the live theme). "Show to
  // shoppers" never places anything, so the steps stay open until the
  // theme check confirms a placement.
  const placement = useQuizBlockStatus();
  const placementState = placement?.state ?? "loading";
  const placed = placementState === "active";
  const placedWhere =
    placement?.state === "active" ? placement.placements.map((p) => templateLabel(p.template)).join(", ") : "";
  const [showSteps, setShowSteps] = useState(!surfaceOn);
  useEffect(() => {
    if (placementState === "loading") return;
    setShowSteps(!(surfaceOn && placed));
  }, [surfaceOn, placed, placementState]);
  // Live = on AND on a page. On but not placed is the trap this splits out.
  const notPlaced = surfaceOn && placementState === "inactive";
  const unchecked = surfaceOn && placementState === "unknown";
  const tone: "live" | "warn" | "neutral" = surfaceOn && placed ? "live" : notPlaced ? "warn" : "neutral";
  const headline = previewOnly
    ? "Your quiz is in preview"
    : !surfaceOn
      ? "Not showing to shoppers yet"
      : placed
        ? "Live on your store"
        : notPlaced
          ? "On, but not on a page yet"
          : "Showing to shoppers wherever it’s placed";
  const subline = previewOnly
    ? null
    : !surfaceOn
      ? "Put it on a page with the steps below (or use Publish), then show it to shoppers."
      : placed
        ? placedWhere
          ? `On the ${placedWhere}.`
          : null
        : notPlaced
          ? "Shoppers can’t see it until it’s on a page. Finish the steps below, or use Publish."
          : unchecked
            ? "We couldn’t check your theme. If the quiz isn’t on a page yet, finish the steps below."
            : null;

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Status */}
        <div
          style={{
            border: `1px solid ${tone === "live" ? "#B4E1C3" : tone === "warn" ? "#FFD79D" : "#E3E3E3"}`,
            background: tone === "live" ? "#ECF8F0" : tone === "warn" ? "#FFF8EB" : "#FFFFFF",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                {tone === "live" && statusDot(awaitingPublish ? "#B98900" : "#29845A")}
                {tone === "warn" && statusDot("#B98900")}
                <BlockStack gap="050">
                  <Text as="p" variant="headingSm" tone={tone === "live" ? "success" : undefined}>
                    {headline}
                  </Text>
                  {subline && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {subline}
                    </Text>
                  )}
                </BlockStack>
              </InlineStack>
              <InlineStack gap="200">
                {!previewOnly && (
                  <Button onClick={onViewStore} loading={viewStoreBusy}>
                    View on my store
                  </Button>
                )}
                {/* The emergency kill pauses going live, never turning off. */}
                {surfaceOn ? (
                  <Button loading={toggling} onClick={() => setLive(false)}>
                    Hide from shoppers
                  </Button>
                ) : !previewOnly ? (
                  <Button loading={toggling} disabled={questionCount === 0 || noMatching} onClick={() => setLive(true)}>
                    Show to shoppers
                  </Button>
                ) : null}
              </InlineStack>
            </InlineStack>
            {previewOnly && (
              <Text as="p" variant="bodySm" tone="subdued">
                {PREVIEW_ONLY_LINE}
              </Text>
            )}
            {/* Re-sends Turn on (which stamps the template live), not the
                full Publish, which would also create a page and a main-menu
                link. The Studio hides its canvas copy of this banner on the
                Live tab, so it shows once. */}
            {awaitingPublish && (
              <Banner tone="warning" action={{ content: "Put template live", onAction: () => setLive(true), loading: toggling }}>
                Your store is still showing your previous quiz layout. Put this template live to show it where your quiz already appears.
              </Banner>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              Edits save to {data.shopDomain} {data.adminBars ? "when you click Save" : "as you make them"}; shoppers see the
              quiz only while it&rsquo;s showing. {questionCount}{" "}
              {questionCount === 1 ? "question" : "questions"}
              {ruleCount > 0 ? ` · ${ruleCount} ${ruleCount === 1 ? "rule" : "rules"}` : ""} · {MODE_LABELS[mode] ?? mode} matching.
            </Text>
            {noMatching && !surfaceOn && !previewOnly && (
              <Text as="p" variant="bodySm" tone="subdued">
                Pin products to answer paths in Check matches before showing the quiz to shoppers.
              </Text>
            )}
            {error && <Banner tone="critical">{error}</Banner>}
          </BlockStack>
        </div>

        {/* Setup guide */}
        {surfaceOn && !showSteps ? (
          <div style={{ border: "1px solid #E3E3E3", borderRadius: 12, padding: "12px 16px", background: "#FFFFFF" }}>
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <span aria-hidden style={{ display: "inline-flex" }}>
                  <Icon source={CheckCircleIcon} tone="success" />
                </span>
                <Text as="p" variant="bodyMd">
                  Setup complete
                </Text>
              </InlineStack>
              <Button variant="plain" onClick={() => setShowSteps(true)}>
                Show setup steps
              </Button>
            </InlineStack>
          </div>
        ) : (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  Put the quiz on your store
                </Text>
                {surfaceOn && (
                  <Button variant="plain" onClick={() => setShowSteps(false)}>
                    Hide steps
                  </Button>
                )}
              </InlineStack>
              <SetupGuide data={data} quizName={quizName} onViewStore={onViewStore} onOpenPublish={onOpenPublish} previewOnly={previewOnly} />
            </BlockStack>
          </Card>
        )}

        {/* Version history */}
        {data.versions.length > 0 && (
          <Card>
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">
                  Version history
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Gleame saves restore points as you edit, and before template switches and restores. Preview any version and restore it if you want it back.
                </Text>
              </BlockStack>
              <Button onClick={onOpenHistory}>{`View ${data.versions.length} ${data.versions.length === 1 ? "version" : "versions"}`}</Button>
            </InlineStack>
          </Card>
        )}

        <InlineStack gap="200">
          <Button variant="plain" url={addQuizBlockUrl(data.shopDomain, data.apiKey)} external>
            Placement settings in the theme editor
          </Button>
        </InlineStack>
      </div>
    </div>
  );
}

/** Banner over the canvas while a template quiz is on but its template
 * isn't served yet: shoppers still see the previous layout. A failed
 * attempt turns it critical, with the reason, until the next try. */
export function TemplatePendingBanner({ data }: { data: StudioLoaderData }) {
  const { setLive, toggling, error } = useSetLive();
  if (!templateAwaitingPublish(data)) return null;
  return (
    <Banner
      tone={error ? "critical" : "warning"}
      action={{ content: "Put template live", onAction: () => setLive(true), loading: toggling }}
    >
      {error
        ? `Couldn't put the template live: ${error}`
        : "Your store is still showing your previous quiz layout. Put this template live to show it to shoppers where your quiz already appears."}
    </Banner>
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
              needs to be put live from the Live tab).
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

function ChecklistRow({ ok, warn, pending, label }: { ok: boolean; warn?: boolean; pending?: boolean; label: string }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <span style={{ flexShrink: 0, display: "inline-flex", width: 20, justifyContent: "center" }}>
        {pending ? (
          <Spinner size="small" accessibilityLabel="Checking" />
        ) : (
          <Icon
            source={ok ? CheckIcon : warn ? AlertTriangleIcon : XIcon}
            tone={ok ? "success" : warn ? "caution" : "critical"}
            accessibilityLabel={ok ? "Done" : warn ? "Check" : "Missing"}
          />
        )}
      </span>
      <Text as="span" variant="bodyMd">
        {label}
      </Text>
    </InlineStack>
  );
}
