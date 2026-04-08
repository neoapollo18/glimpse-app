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
import { useState, useCallback, useMemo, useRef } from "react";
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
  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/upload-avatar", { method: "POST", body: formData });
      const data = await res.json();
      if (data.avatarUrl) {
        setAvatarUrl(data.avatarUrl);
      }
    } catch (e) {
      console.error("Avatar upload failed", e);
    } finally {
      setUploading(false);
    }
  }, []);

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

  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <Page>
      <TitleBar title="AI Assistant" />
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: Settings */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <BlockStack gap="500">
            {fetcher.data?.success && (
              <Banner tone="success" onDismiss={() => {}}>
                Settings saved successfully.
              </Banner>
            )}

            {/* Enable/Disable */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start" gap="500">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      AI Shopping Assistant
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      A branded chat assistant that appears on every page of your store.
                      Shoppers can get personalized product recommendations with AI try-on previews.
                    </Text>
                  </BlockStack>
                  <div style={{ flexShrink: 0 }}>
                    <Button
                      role="switch"
                      ariaChecked={enabled ? "true" : "false"}
                      onClick={() => setEnabled(!enabled)}
                      variant={enabled ? "primary" : undefined}
                      size="slim"
                    >
                      {enabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                </InlineStack>
                {enabled && (
                  <Banner tone="info">
                    Make sure to enable the "Gleame AI Assistant" app embed in your theme editor
                    for it to appear on your storefront.
                  </Banner>
                )}
              </BlockStack>
            </Card>

            {/* Appearance */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Appearance
                </Text>
                <TextField
                  label="Assistant Name"
                  value={assistantName}
                  onChange={setAssistantName}
                  autoComplete="off"
                  helpText="Shown in the chat header and greeting"
                />
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    Avatar
                  </Text>
                  <InlineStack gap="300" blockAlign="center">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Avatar"
                        style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", border: "1px solid #ddd" }}
                      />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #ddd" }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </div>
                    )}
                    <Button
                      size="slim"
                      onClick={() => avatarInputRef.current?.click()}
                      loading={uploading}
                    >
                      Upload Image
                    </Button>
                    {avatarUrl && (
                      <Button size="slim" variant="plain" tone="critical" onClick={() => setAvatarUrl("")}>
                        Remove
                      </Button>
                    )}
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleAvatarUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Square image, at least 80x80px. Leave empty for default icon.
                  </Text>
                </BlockStack>
                <InlineStack gap="400" wrap={false}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Bubble Color"
                      value={bubbleColor}
                      onChange={setBubbleColor}
                      autoComplete="off"
                      connectedLeft={
                        <input
                          type="color"
                          value={bubbleColor}
                          onChange={(e) => setBubbleColor(e.target.value)}
                          style={{
                            width: 34,
                            height: 34,
                            padding: 2,
                            border: "1px solid #c9cccf",
                            borderRadius: "8px 0 0 8px",
                            cursor: "pointer",
                            background: "#fff",
                          }}
                        />
                      }
                      helpText="The floating chat button"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Accent Color"
                      value={accentColor}
                      onChange={setAccentColor}
                      autoComplete="off"
                      connectedLeft={
                        <input
                          type="color"
                          value={accentColor}
                          onChange={(e) => setAccentColor(e.target.value)}
                          style={{
                            width: 34,
                            height: 34,
                            padding: 2,
                            border: "1px solid #c9cccf",
                            borderRadius: "8px 0 0 8px",
                            cursor: "pointer",
                            background: "#fff",
                          }}
                        />
                      }
                      helpText="Header, buttons, and links"
                    />
                  </div>
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
                  helpText="Notification bubble shown when shoppers first visit"
                />
                <RangeSlider
                  label={`Greeting delay: ${greetingDelay} second${greetingDelay !== 1 ? "s" : ""}`}
                  value={greetingDelay}
                  min={0}
                  max={10}
                  step={1}
                  onChange={(val) => setGreetingDelay(val as number)}
                  output
                />
              </BlockStack>
            </Card>

            {/* Conversation Flow */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Conversation Flow
                </Text>
                <TextField
                  label="Recommend Button Text"
                  value={recommendButtonText}
                  onChange={setRecommendButtonText}
                  autoComplete="off"
                  helpText="The call-to-action shown after the greeting"
                />
                <TextField
                  label="Preference Question"
                  value={preferenceQuestion}
                  onChange={setPreferenceQuestion}
                  autoComplete="off"
                  helpText="Asked before photo upload to personalize results"
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
        </div>

        {/* Right: Live Preview */}
        <div style={{ width: 340, flexShrink: 0, position: "sticky", top: 16 }}>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Preview</Text>
                <Button
                  size="slim"
                  onClick={() => setPreviewOpen(!previewOpen)}
                  variant="plain"
                >
                  {previewOpen ? "Show closed" : "Show open"}
                </Button>
              </InlineStack>

              {/* Preview container */}
              <div
                style={{
                  position: "relative",
                  background: "#f6f6f7",
                  borderRadius: 12,
                  height: previewOpen ? 500 : 200,
                  overflow: "hidden",
                  transition: "height 0.3s ease",
                  border: "1px solid #e1e3e5",
                }}
              >
                {/* Simulated storefront background */}
                <div style={{ padding: 16, opacity: 0.4 }}>
                  <div style={{ background: "#ddd", borderRadius: 4, height: 12, width: "70%", marginBottom: 8 }} />
                  <div style={{ background: "#ddd", borderRadius: 4, height: 12, width: "50%", marginBottom: 8 }} />
                  <div style={{ background: "#ddd", borderRadius: 4, height: 12, width: "60%" }} />
                </div>

                {/* Chat panel (when open) */}
                {previewOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: 100,
                      bottom: 68,
                      right: 12,
                      width: 260,
                      background: "#fff",
                      borderRadius: 16,
                      boxShadow: "0 12px 40px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {/* Header */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 12px",
                        background: accentColor,
                        color: "#fff",
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          background: "rgba(255,255,255,0.2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          flexShrink: 0,
                        }}
                      >
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                          {assistantName || "Assistant"}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.8 }}>Online</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        {/* Expand button */}
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 3 21 3 21 9" />
                            <polyline points="9 21 3 21 3 15" />
                            <line x1="21" y1="3" x2="14" y2="10" />
                            <line x1="3" y1="21" x2="10" y2="14" />
                          </svg>
                        </div>
                        {/* Close button */}
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.15)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Messages */}
                    <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                      {/* Bot greeting */}
                      <div style={{ alignSelf: "flex-start", maxWidth: "85%" }}>
                        <div
                          style={{
                            background: "#f3f4f6",
                            color: "#1f2937",
                            padding: "8px 12px",
                            borderRadius: "14px 14px 14px 4px",
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        >
                          {greetingMessage || "Hey! How can I help?"}
                        </div>
                      </div>
                      {/* CTA button */}
                      <div style={{ alignSelf: "flex-start", maxWidth: "85%" }}>
                        <div
                          style={{
                            border: `1.5px solid ${accentColor}`,
                            color: accentColor,
                            padding: "8px 12px",
                            borderRadius: 10,
                            fontSize: 12,
                            fontWeight: 500,
                            textAlign: "center",
                            cursor: "default",
                          }}
                        >
                          {recommendButtonText || "Find my perfect shade"}
                        </div>
                      </div>
                    </div>

                  </div>
                )}

                {/* Greeting bubble (when closed) */}
                {!previewOpen && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 68,
                      right: 12,
                      maxWidth: 200,
                      background: "#fff",
                      borderRadius: "14px 14px 4px 14px",
                      padding: "10px 14px",
                      boxShadow: "0 8px 28px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)",
                      fontSize: 12,
                      lineHeight: 1.4,
                      color: "#1f2937",
                      border: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    {greetingMessage || "Hey! How can I help?"}
                  </div>
                )}

                {/* Bubble */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 12,
                    right: 12,
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: bubbleColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                  onClick={() => setPreviewOpen(!previewOpen)}
                >
                  {previewOpen ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  ) : avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  )}
                </div>
              </div>

              <Text as="p" variant="bodySm" tone="subdued">
                Click the bubble to toggle the open/closed view. Changes update live.
              </Text>
            </BlockStack>
          </Card>
        </div>
      </div>
    </Page>
  );
}
