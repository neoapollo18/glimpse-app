import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Banner, BlockStack, Button, Icon, InlineStack, Spinner, Text, TextField } from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import type { StudioActionData } from "../../routes/studio";
import { postStudioAction } from "./studio-data";
import { PRODUCT_WHY_MAX_LEN, sanitizeProductWhy } from "../../lib/quiz-ui-text";

// "Why this fits" lines (migration 092, Results slide): one optional line
// per product, shown under that product on the result cards. Replaces the
// auto-generated answer echo ("occasion: a special event"); blank shows
// nothing. Saves through the set_product_why tool, batched per pause.

export type WhyProduct = { id: string; name: string; imageUrl: string | null };

const PAGE = 20;

export function ProductWhyEditor({
  products,
  initial,
  chatBusy,
  onPreviewUpdate,
}: {
  products: WhyProduct[];
  /** settings.quiz_product_why (products.id -> line). */
  initial: unknown;
  chatBusy: boolean;
  onPreviewUpdate: (p: { flow?: unknown; config?: unknown }) => void;
}) {
  const fetcher = useFetcher<StudioActionData>();
  const [values, setValues] = useState<Record<string, string>>(() => sanitizeProductWhy(initial));
  // Products with a line first (as loaded), then A-Z. Frozen at mount so a
  // row doesn't jump while the merchant types into it.
  const [order] = useState<string[]>(() => {
    const has = sanitizeProductWhy(initial);
    return [...products]
      .sort((a, b) => Number(Boolean(has[b.id])) - Number(Boolean(has[a.id])) || a.name.localeCompare(b.name))
      .map((p) => p.id);
  });
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submit = () => {
    const lines = Object.entries(pending.current).map(([productId, text]) => ({ productId, text: text.trim() || null }));
    if (lines.length === 0) return false;
    pending.current = {};
    const fd = new FormData();
    fd.append("intent", "apply-tool");
    fd.append("tool", "set_product_why");
    fd.append("input", JSON.stringify({ lines: lines.slice(0, 60) }));
    fetcher.submit(fd, { method: "POST", action: "/studio" });
    return true;
  };

  const setLine = (id: string, text: string) => {
    setValues((prev) => ({ ...prev, [id]: text }));
    pending.current[id] = text;
    setSaveState("saving");
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (fetcher.state === "idle") submit();
    }, 600);
  };

  const processed = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || processed.current === fetcher.data) return;
    processed.current = fetcher.data;
    if (fetcher.data.ok) {
      if (fetcher.data.previewConfig) onPreviewUpdate({ config: fetcher.data.previewConfig });
    } else if (fetcher.data.error) {
      setError(fetcher.data.error);
    }
    if (!submit()) setSaveState(fetcher.data.ok ? "saved" : "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState]);

  // Leaving the slide inside the debounce window must not drop a line.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const lines = Object.entries(pending.current).map(([productId, text]) => ({ productId, text: text.trim() || null }));
      if (lines.length === 0) return;
      pending.current = {};
      const fd = new FormData();
      fd.append("intent", "apply-tool");
      fd.append("tool", "set_product_why");
      fd.append("input", JSON.stringify({ lines: lines.slice(0, 60) }));
      postStudioAction(fd).catch(() => {});
    },
    [],
  );

  const byId = new Map(products.map((p) => [p.id, p]));
  const q = query.trim().toLowerCase();
  const list = order
    .map((id) => byId.get(id))
    .filter((p): p is WhyProduct => Boolean(p))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (values[p.id] ?? "").toLowerCase().includes(q));
  const withLines = Object.values(values).filter((v) => v.trim()).length;

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h4" variant="headingSm">
          Why this fits
        </Text>
        {saveState === "saving" && (
          <InlineStack gap="100" blockAlign="center">
            <Spinner size="small" />
            <Text as="span" variant="bodySm" tone="subdued">
              Saving…
            </Text>
          </InlineStack>
        )}
        {saveState === "saved" && (
          <Text as="span" variant="bodySm" tone="subdued">
            Saved
          </Text>
        )}
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">
        One short line under a product on the results, like &ldquo;Gentle enough for every day.&rdquo; Leave it
        blank to show nothing. {withLines > 0 ? `${withLines} of ${products.length} products have a line.` : ""}
      </Text>
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {products.length > 8 && (
        <TextField
          label="Search products"
          labelHidden
          placeholder="Search products"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setShown(PAGE);
          }}
          prefix={<Icon source={SearchIcon} tone="subdued" />}
          clearButton
          onClearButtonClick={() => setQuery("")}
          autoComplete="off"
        />
      )}
      {products.length === 0 && (
        <Text as="p" variant="bodySm" tone="subdued">
          No products found in your catalog yet.
        </Text>
      )}
      {list.slice(0, shown).map((p) => (
        <div key={p.id} style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: 10, alignItems: "start" }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: "#F1F1F1",
              overflow: "hidden",
              marginTop: 22,
            }}
          >
            {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          </div>
          <TextField
            label={p.name}
            value={values[p.id] ?? ""}
            onChange={(v) => setLine(p.id, v)}
            placeholder="Why this fits (optional)"
            maxLength={PRODUCT_WHY_MAX_LEN}
            disabled={chatBusy}
            autoComplete="off"
          />
        </div>
      ))}
      {list.length > shown && (
        <InlineStack>
          <Button variant="plain" onClick={() => setShown((n) => n + PAGE)}>
            {`Show ${Math.min(PAGE, list.length - shown)} more`}
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}
