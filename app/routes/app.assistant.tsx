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
      bubble_text: formData.get("bubble_text") as string,
      accent_color: formData.get("accent_color") as string,
      greeting_message: formData.get("greeting_message") as string,
      greeting_delay_seconds: parseInt(formData.get("greeting_delay_seconds") as string, 10),
      recommend_button_text: formData.get("recommend_button_text") as string,
      preference_question: formData.get("preference_question") as string,
      preference_options: JSON.parse(formData.get("preference_options") as string),
      photo_upload_message: formData.get("photo_upload_message") as string,
      num_recommendations: parseInt(formData.get("num_recommendations") as string, 10),
      product_scope: formData.get("product_scope") as string,
      selected_product_ids: JSON.parse(formData.get("selected_product_ids") as string || "[]"),
      hero_enabled: formData.get("hero_enabled") === "true",
      hero_eyebrow: formData.get("hero_eyebrow") as string,
      hero_headline: formData.get("hero_headline") as string,
      hero_body: formData.get("hero_body") as string,
      hero_cta_label: formData.get("hero_cta_label") as string,
      hero_footer: formData.get("hero_footer") as string,
      hero_sample_label: formData.get("hero_sample_label") as string,
      hero_position_desktop: formData.get("hero_position_desktop") as
        | "top_right"
        | "top_left"
        | "bottom_right"
        | "bottom_left",
      hero_trust_items: JSON.parse(formData.get("hero_trust_items") as string),
      hero_show_delay_seconds: parseInt(formData.get("hero_show_delay_seconds") as string, 10),
      hero_sample_count: parseInt(formData.get("hero_sample_count") as string, 10),
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
  const [bubbleText, setBubbleText] = useState(config.bubble_text);
  const [accentColor, setAccentColor] = useState(config.accent_color);
  const [greetingMessage, setGreetingMessage] = useState(config.greeting_message);
  const [greetingDelay, setGreetingDelay] = useState(config.greeting_delay_seconds);
  const [recommendButtonText, setRecommendButtonText] = useState(config.recommend_button_text);
  const [preferenceQuestion, setPreferenceQuestion] = useState(config.preference_question);
  const [preferenceOptions, setPreferenceOptions] = useState<string[]>(config.preference_options);
  const [photoUploadMessage, setPhotoUploadMessage] = useState(config.photo_upload_message);
  const [numRecommendations, setNumRecommendations] = useState(config.num_recommendations);
  const [productScope, setProductScope] = useState(config.product_scope);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(config.selected_product_ids);
  const [newOption, setNewOption] = useState("");
  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // Hero popup state
  const [heroEnabled, setHeroEnabled] = useState(config.hero_enabled);
  const [heroEyebrow, setHeroEyebrow] = useState(config.hero_eyebrow);
  const [heroHeadline, setHeroHeadline] = useState(config.hero_headline);
  const [heroBody, setHeroBody] = useState(config.hero_body);
  const [heroCtaLabel, setHeroCtaLabel] = useState(config.hero_cta_label);
  const [heroFooter, setHeroFooter] = useState(config.hero_footer);
  const [heroSampleLabel, setHeroSampleLabel] = useState(config.hero_sample_label);
  const [heroPosition, setHeroPosition] = useState<string>(config.hero_position_desktop);
  const [heroTrustItems, setHeroTrustItems] = useState<string[]>(config.hero_trust_items);
  const [heroShowDelay, setHeroShowDelay] = useState(config.hero_show_delay_seconds);
  const [heroSampleCount, setHeroSampleCount] = useState(config.hero_sample_count);
  const [newTrustItem, setNewTrustItem] = useState("");

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
    formData.append("bubble_text", bubbleText);
    formData.append("accent_color", accentColor);
    formData.append("greeting_message", greetingMessage);
    formData.append("greeting_delay_seconds", String(greetingDelay));
    formData.append("recommend_button_text", recommendButtonText);
    formData.append("preference_question", preferenceQuestion);
    formData.append("preference_options", JSON.stringify(preferenceOptions));
    formData.append("photo_upload_message", photoUploadMessage);
    formData.append("num_recommendations", String(numRecommendations));
    formData.append("product_scope", productScope);
    formData.append("selected_product_ids", JSON.stringify(selectedProductIds));
    formData.append("hero_enabled", String(heroEnabled));
    formData.append("hero_eyebrow", heroEyebrow);
    formData.append("hero_headline", heroHeadline);
    formData.append("hero_body", heroBody);
    formData.append("hero_cta_label", heroCtaLabel);
    formData.append("hero_footer", heroFooter);
    formData.append("hero_sample_label", heroSampleLabel);
    formData.append("hero_position_desktop", heroPosition);
    formData.append("hero_trust_items", JSON.stringify(heroTrustItems));
    formData.append("hero_show_delay_seconds", String(heroShowDelay));
    formData.append("hero_sample_count", String(heroSampleCount));
    fetcher.submit(formData, { method: "POST" });
  }, [
    fetcher, enabled, assistantName, avatarUrl, bubbleColor, bubbleText, accentColor,
    greetingMessage, greetingDelay, recommendButtonText, preferenceQuestion,
    preferenceOptions, photoUploadMessage, numRecommendations, productScope, selectedProductIds,
    heroEnabled, heroEyebrow, heroHeadline, heroBody, heroCtaLabel, heroFooter,
    heroSampleLabel, heroPosition, heroTrustItems, heroShowDelay, heroSampleCount,
  ]);

  const addTrustItem = useCallback(() => {
    const trimmed = newTrustItem.trim();
    if (trimmed && !heroTrustItems.includes(trimmed) && heroTrustItems.length < 4) {
      setHeroTrustItems([...heroTrustItems, trimmed]);
      setNewTrustItem("");
    }
  }, [newTrustItem, heroTrustItems]);

  const removeTrustItem = useCallback((item: string) => {
    setHeroTrustItems(heroTrustItems.filter((t) => t !== item));
  }, [heroTrustItems]);

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
                <TextField
                  label="Bubble Text"
                  value={bubbleText}
                  onChange={setBubbleText}
                  autoComplete="off"
                  maxLength={40}
                  showCharacterCount
                  helpText='Label shown inside the floating pill (e.g. "Try on a shade")'
                />
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
                      helpText="The floating chat pill"
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

            {/* Hero Popup */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start" gap="500">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Hero Popup
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      A larger entry point that previews what shoppers get before they click. Appears top-corner on desktop, as a bottom sheet on mobile. When dismissed, the pill bubble takes over.
                    </Text>
                  </BlockStack>
                  <div style={{ flexShrink: 0 }}>
                    <Button
                      role="switch"
                      ariaChecked={heroEnabled ? "true" : "false"}
                      onClick={() => setHeroEnabled(!heroEnabled)}
                      variant={heroEnabled ? "primary" : undefined}
                      size="slim"
                    >
                      {heroEnabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                </InlineStack>

                {heroEnabled && (
                  <BlockStack gap="400">
                    <Banner tone="info">
                      The sample preview row pulls automatically from your configured product variants that have a color set. If you have fewer than 2 variants with <code>display_color</code> configured, the hero still appears — the swatch row is just hidden. Set <code>display_color</code> on at least 2 variants in the Products page to surface the value-preview tiles.
                    </Banner>
                    <TextField
                      label="Eyebrow"
                      value={heroEyebrow}
                      onChange={setHeroEyebrow}
                      autoComplete="off"
                      maxLength={40}
                      showCharacterCount
                      helpText="Small uppercase label above the headline"
                    />
                    <TextField
                      label="Headline"
                      value={heroHeadline}
                      onChange={setHeroHeadline}
                      autoComplete="off"
                      maxLength={60}
                      showCharacterCount
                      helpText="The hero's main attention-grabber"
                    />
                    <TextField
                      label="Body"
                      value={heroBody}
                      onChange={setHeroBody}
                      autoComplete="off"
                      multiline={3}
                      helpText="Sentence below the sample preview explaining the value"
                    />
                    <TextField
                      label="CTA Label"
                      value={heroCtaLabel}
                      onChange={setHeroCtaLabel}
                      autoComplete="off"
                      maxLength={40}
                      helpText="Big button that opens the chat"
                    />
                    <TextField
                      label="Footer Line"
                      value={heroFooter}
                      onChange={setHeroFooter}
                      autoComplete="off"
                      helpText="Use {assistant_name} to insert the configured name"
                    />
                    <TextField
                      label="Sample Preview Label"
                      value={heroSampleLabel}
                      onChange={setHeroSampleLabel}
                      autoComplete="off"
                      maxLength={40}
                      helpText='Small label above the swatch row (e.g. "Sample result preview")'
                    />
                    <Select
                      label="Desktop position"
                      options={[
                        { label: "Top right", value: "top_right" },
                        { label: "Top left", value: "top_left" },
                        { label: "Bottom right", value: "bottom_right" },
                        { label: "Bottom left", value: "bottom_left" },
                      ]}
                      value={heroPosition}
                      onChange={setHeroPosition}
                    />
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        Trust Row Items
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Up to 4 short reassurance phrases shown dot-separated below the body
                      </Text>
                      <InlineStack gap="200" wrap>
                        {heroTrustItems.map((item) => (
                          <Tag key={item} onRemove={() => removeTrustItem(item)}>
                            {item}
                          </Tag>
                        ))}
                      </InlineStack>
                      <InlineStack gap="200">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label=""
                            labelHidden
                            value={newTrustItem}
                            onChange={setNewTrustItem}
                            autoComplete="off"
                            placeholder="Add a trust phrase..."
                            disabled={heroTrustItems.length >= 4}
                          />
                        </div>
                        <Button onClick={addTrustItem} size="slim" disabled={heroTrustItems.length >= 4}>
                          Add
                        </Button>
                      </InlineStack>
                    </BlockStack>
                    <RangeSlider
                      label={`Show delay: ${heroShowDelay} second${heroShowDelay !== 1 ? "s" : ""}`}
                      value={heroShowDelay}
                      min={0}
                      max={15}
                      step={1}
                      onChange={(val) => setHeroShowDelay(val as number)}
                      output
                    />
                    <RangeSlider
                      label={`Sample swatches: ${heroSampleCount}`}
                      value={heroSampleCount}
                      min={2}
                      max={4}
                      step={1}
                      onChange={(val) => setHeroSampleCount(val as number)}
                      output
                      helpText="Auto-sourced from your configured variants with a color set. Hidden if none available."
                    />
                  </BlockStack>
                )}
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
                <TextField
                  label="Photo Upload Prompt"
                  value={photoUploadMessage}
                  onChange={setPhotoUploadMessage}
                  autoComplete="off"
                  multiline={2}
                  helpText="Shown after the shopper picks a preference, prompting them to upload a selfie"
                />
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

                {/* Bubble — pill when closed, circle × when open */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 12,
                    right: 12,
                    height: previewOpen ? 40 : 44,
                    minWidth: previewOpen ? 40 : 44,
                    padding: previewOpen ? 0 : "0 16px 0 14px",
                    borderRadius: previewOpen ? "50%" : 999,
                    background: bubbleColor,
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: previewOpen ? 0 : 8,
                    boxShadow: "0 6px 20px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)",
                    cursor: "pointer",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    transition: "height 0.25s, min-width 0.25s, padding 0.25s, border-radius 0.25s, gap 0.25s",
                  }}
                  onClick={() => setPreviewOpen(!previewOpen)}
                >
                  {previewOpen ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="#fff" style={{ flexShrink: 0 }} aria-hidden="true">
                        <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" />
                        <path d="M19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9z" opacity="0.7" />
                      </svg>
                      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.01em", lineHeight: 1 }}>
                        {bubbleText || "Try on a shade"}
                      </span>
                    </>
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
