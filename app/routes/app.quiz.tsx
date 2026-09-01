import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useRevalidator } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  Select,
} from "@shopify/polaris";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
  findShopByDomain,
  getChatAssistantConfig,
  getRecommendationCounts,
  getQuestionGuidance,
  saveChatAssistantConfig,
} from "../lib/supabase.server";

// ---------------------------------------------------------------------
// Quiz hub — one place that answers "is my quiz live, and what's left to
// set up?". The three config surfaces it links to (recommendation logic,
// quiz copy/design, theme section) predate this page and are unchanged;
// this page only adds orientation on top of them.
// ---------------------------------------------------------------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // The config fetch keys on the domain, so it doesn't need the shop row —
  // only the counts lookup does. Counts are head-only queries (the full
  // matrix can be thousands of rules for compiled brands) and a counts
  // failure must not take down a read-only status page.
  const [shop, config] = await Promise.all([
    findShopByDomain(shopDomain),
    getChatAssistantConfig(shopDomain),
  ]);
  const counts = shop
    ? await getRecommendationCounts(shop.id).catch(() => null)
    : null;
  // "Almost there" nudge: notes written on the logic page but nothing
  // generated/activated yet. Best-effort; never blocks the hub.
  const hasNotes = shop
    ? await getQuestionGuidance(shop.id)
        .then((n) => Object.values(n).some((v) => v.trim() !== ""))
        .catch(() => false)
    : false;

  return json({
    shopDomain,
    assistantMode: config.assistant_mode,
    assistantEnabled: config.enabled,
    recommendationMode: config.recommendation_mode ?? "matrix",
    hasGuidance: Boolean(String(config.ai_guidance ?? "").trim()),
    hasNotes,
    counts,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let session;
  try {
    ({ session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) {
      return json({ success: false, error: "Session expired. Please reload." }, { status: 401 });
    }
    throw err;
  }
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "set-mode") {
    const mode = formData.get("assistant_mode") as string;
    if (mode !== "chat" && mode !== "quiz" && mode !== "both") {
      return json({ error: "Invalid mode" }, { status: 400 });
    }
    try {
      // Turning a quiz surface on implies enabling the assistant — a
      // "quiz" mode with enabled=false renders nothing, which reads as
      // broken from this page.
      await saveChatAssistantConfig(shopDomain, {
        assistant_mode: mode,
        ...(mode === "quiz" || mode === "both" ? { enabled: true } : {}),
      });
    } catch (err) {
      return json({
        error: err instanceof Error ? err.message : "Failed to save",
      }, { status: 500 });
    }
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function QuizHub() {
  const { shopDomain, assistantMode, assistantEnabled, recommendationMode, hasGuidance, hasNotes, counts } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [params, setParams] = useSearchParams();
  const revalidator = useRevalidator();
  // Studio takeover: an App Bridge max modal hosting the standalone /studio
  // route. Deep link contract: /app/quiz?open=studio&step=build|logic|publish
  const studioOpen = params.get("open") === "studio";
  const studioStep = params.get("step") ?? "build";
  const openStudio = (step?: string) => {
    setParams(
      (p) => {
        p.set("open", "studio");
        if (step) p.set("step", step);
        return p;
      },
      { replace: true },
    );
  };
  const closeStudio = () => {
    setParams(
      (p) => {
        p.delete("open");
        p.delete("step");
        return p;
      },
      { replace: true },
    );
    // Publishes/discards inside the studio must refresh the hub status.
    revalidator.revalidate();
  };

  // assistantMode/assistantEnabled are the persisted truth — Remix
  // revalidates the loader after the fetcher action, so no optimistic
  // mirror is needed (an earlier one kept Save disabled after the first
  // successful save).
  const [mode, setMode] = useState<string>(assistantMode);
  const quizLive =
    assistantEnabled && (assistantMode === "quiz" || assistantMode === "both");
  // "Configured" = questions exist AND something maps answers to products:
  // matrix rules, or AI guidance in an ai/hybrid shop. The old rules-only
  // check read every ai-mode shop as unconfigured.
  const logicReady =
    counts !== null &&
    counts.questions > 0 &&
    (counts.rules > 0 || (recommendationMode !== "matrix" && hasGuidance));

  const storeHandle = shopDomain.replace(".myshopify.com", "");
  // Deep link that opens the theme editor with the Gleame Quiz app block
  // pre-added (addAppBlockId = <theme extension uid>/<block filename>).
  // The uid comes from extensions/glimpse-widget/shopify.extension.toml.
  const THEME_EXT_UUID = "1013fc3f-b18d-aa39-07f6-10dfd57397a6749693b0";
  const themeEditorUrl = `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?template=index&addAppBlockId=${THEME_EXT_UUID}/gleame-quiz&target=newAppsSection`;

  const saveMode = () => {
    const fd = new FormData();
    fd.append("intent", "set-mode");
    fd.append("assistant_mode", mode);
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <Page title="Quiz">
      <TitleBar title="Quiz" />
      <BlockStack gap="500">
        {fetcher.data?.error && (
          <Banner tone="critical">Save failed: {fetcher.data.error}</Banner>
        )}
        {fetcher.data?.success && (
          <Banner tone="success">
            Saved. Your quiz is {quizLive ? "on" : "off"}.
          </Banner>
        )}
        {!quizLive && (
          <Banner tone="warning" title="Your quiz is not live yet">
            Work through the steps below: turn the quiz on, set up questions
            and recommendation logic, then add the Gleame Quiz section to a
            page in your theme.
          </Banner>
        )}

        {/* Step 1: surface */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                1. Turn on the quiz
              </Text>
              <Badge tone={quizLive ? "success" : "attention"}>
                {quizLive ? "Quiz on" : "Quiz off"}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Choose where Gleame appears on your storefront. "Quiz page" or
              "Both" turns on the quiz section.
            </Text>
            {counts !== null && counts.questions === 0 && (
              <Text as="p" variant="bodySm" tone="caution">
                Your quiz has no questions yet, so shoppers would see an empty
                page. Build it in step 2 first.
              </Text>
            )}
            <InlineStack gap="300" blockAlign="end">
              <div style={{ minWidth: 260 }}>
                <Select
                  label="Where Gleame appears"
                  options={[
                    { label: "Chat bubble only", value: "chat" },
                    { label: "Quiz page only", value: "quiz" },
                    { label: "Both", value: "both" },
                  ]}
                  value={mode}
                  onChange={setMode}
                />
              </div>
              <Button
                variant="primary"
                onClick={saveMode}
                loading={fetcher.state !== "idle"}
                disabled={mode === assistantMode}
              >
                Save
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Step 2: the studio */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                2. Build your quiz
              </Text>
              <Badge
                tone={logicReady ? "success" : "attention"}
              >
                {counts === null
                  ? "Status unavailable (reload to retry)"
                  : logicReady
                    ? "Configured"
                    : hasNotes && counts.questions > 0
                      ? "Almost there"
                      : "Needs setup"}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {counts !== null && (
                <>
                  {counts.questions} {counts.questions === 1 ? "question" : "questions"}
                  {counts.rules > 0 && (
                    <> · {counts.rules} recommendation {counts.rules === 1 ? "rule" : "rules"}</>
                  )}
                  {recommendationMode !== "matrix" && hasGuidance && <> · AI logic active</>}
                  .{" "}
                </>
              )}
              Questions, branching, recommendation logic, live preview, and
              the Gleame AI, all in one full-screen editor. New stores get a
              guided setup that drafts the whole quiz from the catalog.
            </Text>
            <InlineStack gap="300">
              <Button variant="primary" onClick={() => openStudio("build")}>
                Open Quiz Studio
              </Button>
              <Button variant="plain" url="/app/assistant/recommendations">
                Advanced rules editor
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Step 3: copy + design */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                3. Copy &amp; design
              </Text>
              <Badge>Optional</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Landing headline, trust items, results copy, colors, fonts,
              progress style, and layout. Everything ships with polished
              defaults, so customize as much or as little as you want.
            </Text>
            <InlineStack>
              <Button url="/app/assistant/quiz">Customize quiz page</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Step 4: theme section */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                4. Add the section to your theme
              </Text>
              <Badge tone="attention">Manual step</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              In the theme editor, open the page where the quiz should live
              (a dedicated quiz page works best), click "Add
              section", and pick "Gleame Quiz" under Apps.
            </Text>
            <InlineStack>
              <Button url={themeEditorUrl} external>
                Open theme editor
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Mounted ONLY while open: the App Bridge Modal wrapper calls
          .hide() on the ui-modal element when rendered closed, which
          crashes the page if the custom element hasn't upgraded yet
          ("t.hide is not a function"). Conditional mount sidesteps the
          closed state entirely; onHide unmounts it again. */}
      {studioOpen && (
        <Modal
          variant="max"
          open
          src={`/studio?step=${studioStep}`}
          onHide={closeStudio}
        >
          <TitleBar title="Quiz Studio" />
        </Modal>
      )}
    </Page>
  );
}
