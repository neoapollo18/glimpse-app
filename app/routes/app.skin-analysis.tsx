import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Banner,
  Box,
  Divider,
  Badge,
  Checkbox,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useMemo } from "react";
import { authenticate } from "../shopify.server";
import {
  isSkinAnalysisEnabledForShop,
  getSkinAnalysisConfig,
  saveSkinAnalysisConfig,
  DEFAULT_SYSTEM_PROMPT,
  SCORE_KEYS,
  type ScoreKey,
  type SkinAnalysisConfig,
} from "../lib/skin-analysis.server";
import { getConfiguredProducts } from "../lib/supabase.server";

// Friendly labels for the 8 metrics — mirrored from skin-analysis.server.ts.
const CONCERN_LABELS: Record<ScoreKey, string> = {
  wrinkles: "Wrinkles",
  sun_damage: "Sun damage",
  firmness: "Firmness",
  dark_circles: "Dark circles",
  texture: "Texture",
  moisture: "Moisture",
  spots: "Spots",
  acne: "Acne",
};

interface ConfiguredProduct {
  id: string;
  shopify_id: string;
  product_name: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Feature-flag gate. If the founders haven't enabled it for this shop,
  // hide the page entirely. The nav link in app.tsx is also hidden — this
  // is a defense-in-depth check for someone navigating directly.
  const enabled = await isSkinAnalysisEnabledForShop(shopDomain);
  if (!enabled) throw redirect("/app");

  const [config, products] = await Promise.all([
    getSkinAnalysisConfig(shopDomain),
    getConfiguredProducts(shopDomain),
  ]);

  return json({
    shopDomain,
    config: config ?? null,
    products: (products ?? []).map((p: { id: string; shopify_id: string; product_name: string }) => ({
      id: p.id,
      shopify_id: p.shopify_id,
      product_name: p.product_name,
    })) as ConfiguredProduct[],
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    scoreKeys: SCORE_KEYS as readonly ScoreKey[],
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Mirror app.assistant.tsx — catch the 204 session-token bounce so a
  // useFetcher POST doesn't blank the page.
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

  // Re-check the flag in the action — never trust the page alone.
  const enabled = await isSkinAnalysisEnabledForShop(shopDomain);
  if (!enabled) {
    return json({ success: false, error: "Feature not enabled for this shop" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save") {
    const systemPromptRaw = formData.get("system_prompt");
    // Empty string clears the override (use built-in default). Null/missing
    // means "don't change" — but we don't differentiate here; UI always
    // submits the field.
    const systemPrompt = typeof systemPromptRaw === "string" && systemPromptRaw.trim() !== ""
      ? systemPromptRaw
      : null;

    const emphasisRaw = formData.get("emphasis_concerns");
    let emphasisConcerns: ScoreKey[] = [];
    try {
      const parsed = JSON.parse((emphasisRaw as string) || "[]");
      if (Array.isArray(parsed)) {
        emphasisConcerns = parsed.filter((k): k is ScoreKey =>
          (SCORE_KEYS as readonly string[]).includes(k)
        );
      }
    } catch {
      // ignore — empty defaults
    }

    const mapRaw = formData.get("concern_product_map");
    let concernProductMap: Record<string, string[]> = {};
    try {
      const parsed = JSON.parse((mapRaw as string) || "{}");
      if (parsed && typeof parsed === "object") {
        for (const key of SCORE_KEYS) {
          const arr = parsed[key];
          if (Array.isArray(arr)) {
            concernProductMap[key] = arr.filter((v): v is string => typeof v === "string");
          }
        }
      }
    } catch {
      // ignore — empty defaults
    }

    const result = await saveSkinAnalysisConfig(shopDomain, {
      system_prompt: systemPrompt,
      emphasis_concerns: emphasisConcerns,
      concern_product_map: concernProductMap,
    });
    return json(result);
  }

  return json({ success: false, error: "Unknown intent" }, { status: 400 });
};

export default function SkinAnalysisAdmin() {
  const { shopDomain, config, products, defaultSystemPrompt, scoreKeys } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const isSaving = fetcher.state !== "idle";

  // Form state
  const [systemPrompt, setSystemPrompt] = useState<string>(config?.system_prompt ?? "");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(Boolean(config?.system_prompt));
  const [emphasisConcerns, setEmphasisConcerns] = useState<ScoreKey[]>(
    (config?.emphasis_concerns ?? []) as ScoreKey[]
  );
  const [concernProductMap, setConcernProductMap] = useState<Record<string, string[]>>(
    (config?.concern_product_map ?? {}) as Record<string, string[]>
  );

  // Preview state
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const toggleEmphasis = useCallback((key: ScoreKey) => {
    setEmphasisConcerns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const toggleConcernProduct = useCallback((concern: ScoreKey, productGid: string) => {
    setConcernProductMap((prev) => {
      const current = prev[concern] ?? [];
      const next = current.includes(productGid)
        ? current.filter((p) => p !== productGid)
        : [...current, productGid];
      return { ...prev, [concern]: next };
    });
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("system_prompt", systemPrompt);
    formData.append("emphasis_concerns", JSON.stringify(emphasisConcerns));
    formData.append("concern_product_map", JSON.stringify(concernProductMap));
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, systemPrompt, emphasisConcerns, concernProductMap]);

  const handlePreview = useCallback(async () => {
    if (!previewFile) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);
    try {
      const fd = new FormData();
      fd.append("image", previewFile);
      fd.append("shopDomain", shopDomain);
      const res = await fetch("/api/storefront/analyze-skin", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setPreviewError(data.error || `Request failed (${res.status})`);
      } else {
        setPreviewResult(data);
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [previewFile, shopDomain]);

  const embedSnippet = useMemo(
    () =>
      `<script src="https://glimpse-app-charles.onrender.com/skin-analysis-embed.js" defer></script>\n<div id="gleame-skin-analysis" data-shop="${shopDomain}"></div>`,
    [shopDomain]
  );

  const productOptions = products as ConfiguredProduct[];

  return (
    <Page>
      <TitleBar title="Skin Analysis" />

      <BlockStack gap="500">
        <Banner tone="info">
          <Text as="p" variant="bodyMd">
            <strong>Early access feature.</strong> Customers upload a selfie and see an
            AI-generated skin profile that recommends your products. Drop the embed
            snippet below into any page or section.
          </Text>
        </Banner>

        {fetcher.data?.success && (
          <Banner tone="success" onDismiss={() => fetcher.load(window.location.pathname)}>
            <Text as="p">Saved.</Text>
          </Banner>
        )}
        {fetcher.data?.error && (
          <Banner tone="critical">
            <Text as="p">{fetcher.data.error}</Text>
          </Banner>
        )}

        <Layout>
          {/* LEFT: configuration */}
          <Layout.Section>
            <BlockStack gap="500">
              {/* Emphasis concerns */}
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Emphasis</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Concerns to highlight in the analysis notes. This steers narration
                      only — it does not inflate scores.
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200" wrap>
                    {scoreKeys.map((key) => {
                      const selected = emphasisConcerns.includes(key);
                      return (
                        <Button
                          key={key}
                          size="slim"
                          pressed={selected}
                          onClick={() => toggleEmphasis(key)}
                        >
                          {CONCERN_LABELS[key]}
                        </Button>
                      );
                    })}
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Concern → product map */}
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Product recommendations</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      For each detected concern, pick the products that should be
                      recommended. Top 3 concerns by score appear to the customer; one
                      product per concern.
                    </Text>
                  </BlockStack>

                  {productOptions.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No products configured yet. Add products on the Products page first.
                    </Text>
                  ) : (
                    <BlockStack gap="400">
                      {scoreKeys.map((key) => {
                        const selected = concernProductMap[key] ?? [];
                        return (
                          <Box key={key} padding="300" background="bg-surface-secondary" borderRadius="200">
                            <BlockStack gap="200">
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="h3" variant="headingSm">{CONCERN_LABELS[key]}</Text>
                                {selected.length > 0 && (
                                  <Badge tone="info">{`${selected.length} product${selected.length === 1 ? "" : "s"}`}</Badge>
                                )}
                              </InlineStack>
                              <BlockStack gap="100">
                                {productOptions.map((product) => (
                                  <Checkbox
                                    key={product.id}
                                    label={product.product_name || product.shopify_id}
                                    checked={selected.includes(product.shopify_id)}
                                    onChange={() => toggleConcernProduct(key, product.shopify_id)}
                                  />
                                ))}
                              </BlockStack>
                            </BlockStack>
                          </Box>
                        );
                      })}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* Advanced: system prompt */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Advanced</Text>
                    <Button
                      variant="plain"
                      onClick={() => setShowAdvanced((s) => !s)}
                    >
                      {showAdvanced ? "Hide" : "Show"}
                    </Button>
                  </InlineStack>
                  {showAdvanced && (
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Override the system prompt sent to the AI. The fairness and
                        non-medical-language safety block is always appended server-side
                        and cannot be edited from here. Leave empty to use the built-in
                        default.
                      </Text>
                      <TextField
                        label="System prompt override"
                        labelHidden
                        multiline={14}
                        autoComplete="off"
                        value={systemPrompt}
                        onChange={setSystemPrompt}
                        placeholder={defaultSystemPrompt}
                      />
                      <InlineStack gap="200">
                        <Button onClick={() => setSystemPrompt("")}>Reset to default</Button>
                        <Button onClick={() => setSystemPrompt(defaultSystemPrompt)}>
                          Insert default
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              <InlineStack align="end">
                <Button variant="primary" onClick={handleSave} loading={isSaving}>
                  Save settings
                </Button>
              </InlineStack>

              {/* Embed snippet */}
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Embed on storefront</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Drop this anywhere in your theme — a page, a section, or a custom
                      Liquid block. The widget renders into the placeholder div.
                    </Text>
                  </BlockStack>
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "monospace", fontSize: "12px" }}>
                      {embedSnippet}
                    </pre>
                  </Box>
                  <InlineStack>
                    <Button onClick={() => navigator.clipboard?.writeText(embedSnippet)}>
                      Copy snippet
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* RIGHT: preview */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Preview</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Test what your customers will see. Photos are processed in memory and
                  never stored.
                </Text>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setPreviewFile(f);
                    setPreviewResult(null);
                    setPreviewError(null);
                  }}
                />
                <Button
                  variant="primary"
                  onClick={handlePreview}
                  disabled={!previewFile || previewLoading}
                  loading={previewLoading}
                >
                  Run preview
                </Button>

                {previewError && (
                  <Banner tone="critical">
                    <Text as="p">{previewError}</Text>
                  </Banner>
                )}

                {previewLoading && (
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text as="p" variant="bodySm" tone="subdued">Analyzing…</Text>
                  </InlineStack>
                )}

                {previewResult?.rejected && (
                  <Banner tone="warning">
                    <Text as="p">Photo was rejected: {previewResult.reason}</Text>
                  </Banner>
                )}

                {previewResult?.success && !previewResult.rejected && previewResult.scores && (
                  <BlockStack gap="300">
                    <Divider />
                    {previewResult.skin_type && (
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">Skin type:</Text>
                        <Badge>{previewResult.skin_type}</Badge>
                      </InlineStack>
                    )}
                    <BlockStack gap="200">
                      {scoreKeys.map((key) => {
                        const score = (previewResult.scores as Record<string, number>)[key] ?? 0;
                        return (
                          <BlockStack key={key} gap="050">
                            <InlineStack align="space-between">
                              <Text as="span" variant="bodySm">{CONCERN_LABELS[key]}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{score}</Text>
                            </InlineStack>
                            <div style={{
                              width: "100%",
                              height: 6,
                              background: "var(--p-color-bg-surface-tertiary, #e1e3e5)",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}>
                              <div style={{
                                width: `${Math.max(0, Math.min(100, score))}%`,
                                height: "100%",
                                background: "var(--p-color-bg-fill-info, #2c6ecb)",
                              }} />
                            </div>
                          </BlockStack>
                        );
                      })}
                    </BlockStack>
                    {previewResult.notes && (
                      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                        <Text as="p" variant="bodySm">{previewResult.notes}</Text>
                      </Box>
                    )}
                    {previewResult.recommendations?.length > 0 && (
                      <BlockStack gap="200">
                        <Text as="span" variant="bodySm" tone="subdued">Recommendations:</Text>
                        {previewResult.recommendations.map((r: {
                          concern: string;
                          productId: string;
                          title: string | null;
                          imageUrl: string | null;
                          url: string | null;
                        }) => (
                          <InlineStack key={r.productId} gap="200" blockAlign="center">
                            {r.imageUrl && (
                              <img
                                src={r.imageUrl}
                                alt={r.title || ""}
                                style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }}
                              />
                            )}
                            <BlockStack gap="050">
                              <Badge>{CONCERN_LABELS[r.concern as ScoreKey] ?? r.concern}</Badge>
                              <Text as="span" variant="bodySm">{r.title || r.productId}</Text>
                            </BlockStack>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
