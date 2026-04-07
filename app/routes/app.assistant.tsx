import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
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
  RangeSlider,
  Select,
  Checkbox,
  Tag,
  Banner,
  Box,
  Divider,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import {
  getChatAssistantConfig,
  saveChatAssistantConfig,
  getConfiguredProducts,
} from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const [config, products] = await Promise.all([
    getChatAssistantConfig(shopDomain),
    getConfiguredProducts(shopDomain),
  ]);

  return json({ shopDomain, config, products });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Use authenticate.admin but catch token bounce (same issue as admin.tsx).
  // For embedded app pages, the fetcher POST can trigger a 204 session token
  // exchange if the id_token has expired.
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

  if (intent === "save") {
    const config = {
      enabled: formData.get("enabled") === "true",
      assistant_name: formData.get("assistant_name") as string,
      avatar_url: (formData.get("avatar_url") as string) || null,
      bubble_color: formData.get("bubble_color") as string,
      accent_color: formData.get("accent_color") as string,
      greeting_message: formData.get("greeting_message") as string,
      greeting_delay_seconds: parseInt(formData.get("greeting_delay_seconds") as string, 10),
      recommend_button_text: formData.get("recommend_button_text") as string,
      preference_question: formData.get("preference_question") as string,
      preference_options: JSON.parse(formData.get("preference_options") as string),
      num_recommendations: parseInt(formData.get("num_recommendations") as string, 10),
      product_scope: formData.get("product_scope") as string,
      selected_product_ids: JSON.parse(formData.get("selected_product_ids") as string || "[]"),
    };

    await saveChatAssistantConfig(shopDomain, config);
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function AssistantConfig() {
  const { config, products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const isSaving = fetcher.state !== "idle";

  // Form state
  const [enabled, setEnabled] = useState(config.enabled);
  const [assistantName, setAssistantName] = useState(config.assistant_name);
  const [avatarUrl, setAvatarUrl] = useState(config.avatar_url || "");
  const [bubbleColor, setBubbleColor] = useState(config.bubble_color);
  const [accentColor, setAccentColor] = useState(config.accent_color);
  const [greetingMessage, setGreetingMessage] = useState(config.greeting_message);
  const [greetingDelay, setGreetingDelay] = useState(config.greeting_delay_seconds);
  const [recommendButtonText, setRecommendButtonText] = useState(config.recommend_button_text);
  const [preferenceQuestion, setPreferenceQuestion] = useState(config.preference_question);
  const [preferenceOptions, setPreferenceOptions] = useState<string[]>(config.preference_options);
  const [numRecommendations, setNumRecommendations] = useState(config.num_recommendations);
  const [productScope, setProductScope] = useState(config.product_scope);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(config.selected_product_ids);
  const [newOption, setNewOption] = useState("");

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("enabled", String(enabled));
    formData.append("assistant_name", assistantName);
    formData.append("avatar_url", avatarUrl);
    formData.append("bubble_color", bubbleColor);
    formData.append("accent_color", accentColor);
    formData.append("greeting_message", greetingMessage);
    formData.append("greeting_delay_seconds", String(greetingDelay));
    formData.append("recommend_button_text", recommendButtonText);
    formData.append("preference_question", preferenceQuestion);
    formData.append("preference_options", JSON.stringify(preferenceOptions));
    formData.append("num_recommendations", String(numRecommendations));
    formData.append("product_scope", productScope);
    formData.append("selected_product_ids", JSON.stringify(selectedProductIds));
    fetcher.submit(formData, { method: "POST" });
  }, [
    fetcher, enabled, assistantName, avatarUrl, bubbleColor, accentColor,
    greetingMessage, greetingDelay, recommendButtonText, preferenceQuestion,
    preferenceOptions, numRecommendations, productScope, selectedProductIds,
  ]);

  const addOption = useCallback(() => {
    const trimmed = newOption.trim();
    if (trimmed && !preferenceOptions.includes(trimmed)) {
      setPreferenceOptions([...preferenceOptions, trimmed]);
      setNewOption("");
    }
  }, [newOption, preferenceOptions]);

  const removeOption = useCallback((option: string) => {
    setPreferenceOptions(preferenceOptions.filter((o) => o !== option));
  }, [preferenceOptions]);

  const toggleProduct = useCallback((productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  }, []);

  return (
    <Page>
      <TitleBar title="AI Assistant" />
      <BlockStack gap="500">
        {fetcher.data?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            Settings saved successfully.
          </Banner>
        )}

        {/* Enable/Disable */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  AI Shopping Assistant
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  A branded chat assistant that appears on every page of your store.
                  Shoppers can get personalized product recommendations with AI try-on previews.
                </Text>
              </BlockStack>
              <Button
                role="switch"
                ariaChecked={enabled ? "true" : "false"}
                onClick={() => setEnabled(!enabled)}
                variant={enabled ? "primary" : undefined}
                size="slim"
              >
                {enabled ? "Enabled" : "Disabled"}
              </Button>
            </InlineStack>
            {enabled && (
              <Banner tone="info">
                Make sure to enable the "Gleame AI Assistant" app embed in your theme editor
                for it to appear on your storefront.
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* Assistant Identity */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Assistant Identity
            </Text>
            <TextField
              label="Name"
              value={assistantName}
              onChange={setAssistantName}
              autoComplete="off"
              helpText="The name shown in the chat header and greeting"
            />
            <TextField
              label="Avatar URL"
              value={avatarUrl}
              onChange={setAvatarUrl}
              autoComplete="off"
              placeholder="https://example.com/avatar.png"
              helpText="URL to the avatar image (square, at least 80x80px)"
            />
            <InlineStack gap="400">
              <TextField
                label="Bubble Color"
                value={bubbleColor}
                onChange={setBubbleColor}
                autoComplete="off"
                prefix={
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: bubbleColor,
                      border: "1px solid #ccc",
                    }}
                  />
                }
              />
              <TextField
                label="Accent Color"
                value={accentColor}
                onChange={setAccentColor}
                autoComplete="off"
                prefix={
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: accentColor,
                      border: "1px solid #ccc",
                    }}
                  />
                }
              />
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Greeting */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Greeting
            </Text>
            <TextField
              label="Greeting Message"
              value={greetingMessage}
              onChange={setGreetingMessage}
              autoComplete="off"
              helpText="Shown as a notification bubble when shoppers first visit"
            />
            <RangeSlider
              label={`Greeting delay: ${greetingDelay} seconds`}
              value={greetingDelay}
              min={0}
              max={10}
              step={1}
              onChange={(val) => setGreetingDelay(val as number)}
              output
            />
          </BlockStack>
        </Card>

        {/* Recommendation Flow */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Recommendation Flow
            </Text>
            <TextField
              label="Recommend Button Text"
              value={recommendButtonText}
              onChange={setRecommendButtonText}
              autoComplete="off"
            />
            <TextField
              label="Preference Question"
              value={preferenceQuestion}
              onChange={setPreferenceQuestion}
              autoComplete="off"
              helpText="The question asked before photo upload"
            />
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Preference Options
              </Text>
              <InlineStack gap="200" wrap>
                {preferenceOptions.map((option) => (
                  <Tag key={option} onRemove={() => removeOption(option)}>
                    {option}
                  </Tag>
                ))}
              </InlineStack>
              <InlineStack gap="200">
                <div style={{ flex: 1 }}>
                  <TextField
                    label=""
                    labelHidden
                    value={newOption}
                    onChange={setNewOption}
                    autoComplete="off"
                    placeholder="Add an option..."
                  />
                </div>
                <Button onClick={addOption} size="slim">
                  Add
                </Button>
              </InlineStack>
            </BlockStack>
            <RangeSlider
              label={`Number of recommendations: ${numRecommendations}`}
              value={numRecommendations}
              min={1}
              max={5}
              step={1}
              onChange={(val) => setNumRecommendations(val as number)}
              output
            />
          </BlockStack>
        </Card>

        {/* Product Selection */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Product Selection
            </Text>
            <Select
              label="Which products can be recommended?"
              options={[
                { label: "All configured products", value: "all_configured" },
                { label: "Selected products only", value: "selected" },
              ]}
              value={productScope}
              onChange={setProductScope}
            />
            {productScope === "selected" && (
              <BlockStack gap="200">
                {products.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No products configured yet. Go to the Products page to set up products first.
                  </Text>
                ) : (
                  products.map((product: { id: string; product_name: string }) => (
                    <Checkbox
                      key={product.id}
                      label={product.product_name || product.id}
                      checked={selectedProductIds.includes(product.id)}
                      onChange={() => toggleProduct(product.id)}
                    />
                  ))
                )}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* Save */}
        <InlineStack align="end">
          <Button variant="primary" onClick={handleSave} loading={isSaving}>
            Save Settings
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
