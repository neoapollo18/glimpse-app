import { useEffect, useState } from "react";
import { Badge, Button, InlineStack, Text } from "@shopify/polaris";
import { quizBlockStatusFrom, templateLabel, type QuizBlockStatus } from "../lib/theme-extension";

// App Bridge's `app` API isn't in @shopify/app-bridge-types 0.1.0 yet; the
// CDN app-bridge.js the admin loads provides it.
type AppApi = { extensions?: () => Promise<unknown> };

/** The live theme's editor in a new tab (same link the Studio setup guide
 * uses), from the shop App Bridge reports. Client-only: the unknown state
 * renders after the first check. */
function themeEditorUrl(): string | null {
  const shop = (window as unknown as { shopify?: { config?: { shop?: string } } }).shopify?.config?.shop;
  const handle = typeof shop === "string" ? shop.replace(".myshopify.com", "") : "";
  return handle ? `https://admin.shopify.com/store/${handle}/themes/current/editor` : null;
}

/**
 * Live status of the quiz app block in the published theme, via
 * `shopify.app.extensions()` (Built for Shopify 4.2.3: the homepage must
 * report app block status). Re-checks when the merchant comes back to the
 * tab, e.g. after adding the block in the theme editor. null while loading.
 * Reads the shopify global itself (not useAppBridge, which throws without
 * it), so a page outside the admin just reports "unknown".
 */
export function useQuizBlockStatus(): QuizBlockStatus | null {
  const [status, setStatus] = useState<QuizBlockStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const app = (window as unknown as { shopify?: { app?: AppApi } }).shopify?.app;
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
  }, []);

  return status;
}

/** One-line badge + note for the dashboard. Renders nothing while loading;
 * a check that can't run still says so (Built for Shopify 4.2.3). */
export function QuizPlacementStatus({ quizLive }: { quizLive: boolean }) {
  const status = useQuizBlockStatus();
  if (!status) return null;

  if (status.state === "unknown") {
    const editor = themeEditorUrl();
    return (
      <InlineStack gap="200" blockAlign="center">
        <Badge>Theme not checked</Badge>
        <Text as="span" variant="bodySm" tone="subdued">
          Couldn&rsquo;t check your theme{editor ? "." : ". Open the theme editor to see whether the quiz section is there."}
        </Text>
        {editor && (
          <Button variant="plain" url={editor} external>
            Open the theme editor
          </Button>
        )}
      </InlineStack>
    );
  }

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

  // Before go-live the badge sits under "Set up the quiz page", which says
  // the rest; once live, the note explains why a missing section is fine.
  return (
    <InlineStack gap="200" blockAlign="center">
      <Badge>Quiz section not added</Badge>
      {quizLive && (
        <Text as="span" variant="bodySm" tone="subdued">
          Not in your published theme. A quiz page made with one-click Publish works without it.
        </Text>
      )}
    </InlineStack>
  );
}
