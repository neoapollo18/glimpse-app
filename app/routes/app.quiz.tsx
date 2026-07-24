import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
  findShopByDomain,
  getChatAssistantConfig,
  getRecommendationCounts,
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

  return json({
    shopDomain,
    assistantMode: config.assistant_mode,
    assistantEnabled: config.enabled,
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
  const { shopDomain, assistantMode, assistantEnabled, counts } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();

  // assistantMode/assistantEnabled are the persisted truth — Remix
  // revalidates the loader after the fetcher action, so no optimistic
  // mirror is needed (an earlier one kept Save disabled after the first
  // successful save).
  const [mode, setMode] = useState<string>(assistantMode);
  const quizLive =
    assistantEnabled && (assistantMode === "quiz" || assistantMode === "both");
  const logicReady =
    counts !== null && counts.questions > 0 && counts.rules > 0;

  const storeHandle = shopDomain.replace(".myshopify.com", "");
  const themeEditorUrl = `https://admin.shopify.com/store/${storeHandle}/themes/current/editor`;

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
        {!quizLive && (
          <Banner tone="warning" title="Your quiz is not live yet">
            Work through the steps below. The quiz shows on your storefront
            once the surface is on, the logic has questions and rules, and the
            section is added to a page in your theme.
          </Banner>
        )}

        {/* Step 1: surface */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                1. Storefront surface
              </Text>
              <Badge tone={quizLive ? "success" : "attention"}>
                {quizLive ? "Quiz on" : "Quiz off"}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Choose which Gleame surface runs on your storefront. "Quiz page"
              or "Both" activates the Find My Fit quiz section.
            </Text>
            <InlineStack gap="300" blockAlign="end">
              <div style={{ minWidth: 260 }}>
                <Select
                  label="Surface"
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

        {/* Step 2: logic */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                2. Questions &amp; recommendation logic
              </Text>
              <Badge
                tone={logicReady ? "success" : "attention"}
              >
                {counts === null
                  ? "Status unavailable"
                  : logicReady
                    ? "Configured"
                    : "Needs setup"}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {counts !== null && (
                <>
                  {counts.axes} criteria {counts.axes === 1 ? "axis" : "axes"} ·{" "}
                  {counts.questions} {counts.questions === 1 ? "question" : "questions"} ·{" "}
                  {counts.rules} recommendation {counts.rules === 1 ? "rule" : "rules"}.{" "}
                </>
              )}
              Questions ask shoppers about their preferences; rules map their
              answers to the products you want recommended.
            </Text>
            <InlineStack>
              <Button url="/app/assistant/recommendations">
                {logicReady ? "Edit logic" : "Set up questions & rules"}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Step 3: copy + design */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              3. Copy &amp; design
            </Text>
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
            <Text as="h2" variant="headingMd">
              4. Add the section to your theme
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              In the theme editor, open the page where the quiz should live
              (a dedicated "Find My Fit" page works best), click "Add
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
    </Page>
  );
}
