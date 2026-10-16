import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Badge, InlineStack, Text } from "@shopify/polaris";
import { quizBlockStatusFrom, templateLabel, type QuizBlockStatus } from "../lib/theme-extension";

// App Bridge's `app` API isn't in @shopify/app-bridge-types 0.1.0 yet; the
// CDN app-bridge.js the admin loads provides it.
type AppApi = { extensions?: () => Promise<unknown> };

/**
 * Live status of the quiz app block in the published theme, via
 * `shopify.app.extensions()` (Built for Shopify 4.2.3: the homepage must
 * report app block status). Re-checks when the merchant comes back to the
 * tab, e.g. after adding the block in the theme editor. null while loading.
 */
export function useQuizBlockStatus(): QuizBlockStatus | null {
  const shopify = useAppBridge();
  const [status, setStatus] = useState<QuizBlockStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const app = (shopify as unknown as { app?: AppApi }).app;
      if (!app?.extensions) {
        setStatus({ state: "unknown" });
        return;
      }
      app.extensions().then(
        (extensions) => {
          if (!cancelled) setStatus(quizBlockStatusFrom(extensions));
        },
        () => {
          if (!cancelled) setStatus({ state: "unknown" });
        },
      );
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [shopify]);

  return status;
}

/** One-line badge + note for the dashboard. Renders nothing until known. */
export function QuizPlacementStatus({ quizLive }: { quizLive: boolean }) {
  const status = useQuizBlockStatus();
  if (!status || status.state === "unknown") return null;

  if (status.state === "active") {
    const where = status.placements.map((p) => templateLabel(p.template)).join(", ");
    return (
      <InlineStack gap="200" blockAlign="center">
        <Badge tone="success">Quiz section added</Badge>
        <Text as="span" variant="bodySm" tone="subdued">
          {where ? `In your theme on the ${where}.` : "In your published theme."}
        </Text>
      </InlineStack>
    );
  }

  return (
    <InlineStack gap="200" blockAlign="center">
      <Badge>Quiz section not added</Badge>
      <Text as="span" variant="bodySm" tone="subdued">
        {quizLive
          ? "Not in your published theme. A quiz page made with one-click Publish works without it."
          : "Not in your published theme yet. The setup guide in Studio walks you through it, or publish with one click."}
      </Text>
    </InlineStack>
  );
}
