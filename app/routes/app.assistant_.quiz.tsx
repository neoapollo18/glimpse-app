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
  TextField,
  Tag,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useRef } from "react";
import { authenticate } from "../shopify.server";
import {
  getChatAssistantConfig,
  saveChatAssistantConfig,
} from "../lib/supabase.server";

// ---------------------------------------------------------------------
// Loader: current chat-assistant config (quiz fields live on the same row)
// ---------------------------------------------------------------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const config = await getChatAssistantConfig(shopDomain);

  return json({ shopDomain, config });
};

// ---------------------------------------------------------------------
// Action: save only the quiz_* fields. Mirrors app.assistant.tsx's save,
// including the token-bounce catch for expired embedded sessions.
// ---------------------------------------------------------------------
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

  if (intent === "save") {
    // Empty string → NULL for the nullable columns (means "inherit"/"unset").
    const orNull = (name: string) => {
      const v = (formData.get(name) as string) || "";
      return v.trim() === "" ? null : v;
    };
    const radiusRaw = ((formData.get("quiz_button_radius") as string) || "").trim();
    const radius = radiusRaw === "" ? null : parseInt(radiusRaw, 10);

    const config = {
      // Landing
      quiz_eyebrow: formData.get("quiz_eyebrow") as string,
      quiz_headline: formData.get("quiz_headline") as string,
      quiz_subtext: formData.get("quiz_subtext") as string,
      quiz_trust_items: JSON.parse((formData.get("quiz_trust_items") as string) || "[]"),
      quiz_before_image_url: orNull("quiz_before_image_url"),
      quiz_after_image_url: orNull("quiz_after_image_url"),
      quiz_visual_caption: formData.get("quiz_visual_caption") as string,
      quiz_alt_audience_label: formData.get("quiz_alt_audience_label") as string,
      quiz_alt_audience_url: formData.get("quiz_alt_audience_url") as string,
      // Try-on gate
      quiz_gate_headline: formData.get("quiz_gate_headline") as string,
      quiz_gate_helper: formData.get("quiz_gate_helper") as string,
      quiz_gate_photo_label: formData.get("quiz_gate_photo_label") as string,
      quiz_gate_skip_label: formData.get("quiz_gate_skip_label") as string,
      quiz_privacy_note: formData.get("quiz_privacy_note") as string,
      // Results
      quiz_results_headline_photo: formData.get("quiz_results_headline_photo") as string,
      quiz_results_headline_nophoto: formData.get("quiz_results_headline_nophoto") as string,
      quiz_best_match_pill: formData.get("quiz_best_match_pill") as string,
      quiz_also_matched_label: formData.get("quiz_also_matched_label") as string,
      quiz_add_button_template: formData.get("quiz_add_button_template") as string,
      quiz_view_product_label: formData.get("quiz_view_product_label") as string,
      quiz_retake_label: formData.get("quiz_retake_label") as string,
      // Shade gate
      quiz_shade_headline: formData.get("quiz_shade_headline") as string,
      quiz_shade_body: formData.get("quiz_shade_body") as string,
      quiz_shade_cta_photo: formData.get("quiz_shade_cta_photo") as string,
      quiz_shade_cta_manual: formData.get("quiz_shade_cta_manual") as string,
      // Style — NULL means inherit (accent → assistant accent, radius →
      // widget default, fonts → runtime theme detection)
      quiz_accent_color: orNull("quiz_accent_color"),
      quiz_button_radius: radius !== null && Number.isNaN(radius) ? null : radius,
      quiz_heading_font_override: orNull("quiz_heading_font_override"),
      quiz_body_font_override: orNull("quiz_body_font_override"),
    };

    try {
      await saveChatAssistantConfig(shopDomain, config);
    } catch (err) {
      return json({
        error: err instanceof Error ? err.message : "Failed to save quiz settings",
      }, { status: 500 });
    }
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

// String-valued form fields (everything except trust items). Nullable DB
// columns are represented as "" here and converted to NULL in the action.
type QuizFormState = {
  quiz_eyebrow: string;
  quiz_headline: string;
  quiz_subtext: string;
  quiz_before_image_url: string;
  quiz_after_image_url: string;
  quiz_visual_caption: string;
  quiz_alt_audience_label: string;
  quiz_alt_audience_url: string;
  quiz_gate_headline: string;
  quiz_gate_helper: string;
  quiz_gate_photo_label: string;
  quiz_gate_skip_label: string;
  quiz_privacy_note: string;
  quiz_results_headline_photo: string;
  quiz_results_headline_nophoto: string;
  quiz_best_match_pill: string;
  quiz_also_matched_label: string;
  quiz_add_button_template: string;
  quiz_view_product_label: string;
  quiz_retake_label: string;
  quiz_shade_headline: string;
  quiz_shade_body: string;
  quiz_shade_cta_photo: string;
  quiz_shade_cta_manual: string;
  quiz_accent_color: string;
  quiz_button_radius: string;
  quiz_heading_font_override: string;
  quiz_body_font_override: string;
};

export default function AssistantQuiz() {
  const { config } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const isSaving = fetcher.state !== "idle";

  const [form, setForm] = useState<QuizFormState>({
    quiz_eyebrow: config.quiz_eyebrow,
    quiz_headline: config.quiz_headline,
    quiz_subtext: config.quiz_subtext,
    quiz_before_image_url: config.quiz_before_image_url || "",
    quiz_after_image_url: config.quiz_after_image_url || "",
    quiz_visual_caption: config.quiz_visual_caption,
    quiz_alt_audience_label: config.quiz_alt_audience_label,
    quiz_alt_audience_url: config.quiz_alt_audience_url,
    quiz_gate_headline: config.quiz_gate_headline,
    quiz_gate_helper: config.quiz_gate_helper,
    quiz_gate_photo_label: config.quiz_gate_photo_label,
    quiz_gate_skip_label: config.quiz_gate_skip_label,
    quiz_privacy_note: config.quiz_privacy_note,
    quiz_results_headline_photo: config.quiz_results_headline_photo,
    quiz_results_headline_nophoto: config.quiz_results_headline_nophoto,
    quiz_best_match_pill: config.quiz_best_match_pill,
    quiz_also_matched_label: config.quiz_also_matched_label,
    quiz_add_button_template: config.quiz_add_button_template,
    quiz_view_product_label: config.quiz_view_product_label,
    quiz_retake_label: config.quiz_retake_label,
    quiz_shade_headline: config.quiz_shade_headline,
    quiz_shade_body: config.quiz_shade_body,
    quiz_shade_cta_photo: config.quiz_shade_cta_photo,
    quiz_shade_cta_manual: config.quiz_shade_cta_manual,
    quiz_accent_color: config.quiz_accent_color || "",
    quiz_button_radius:
      config.quiz_button_radius !== null && config.quiz_button_radius !== undefined
        ? String(config.quiz_button_radius)
        : "",
    quiz_heading_font_override: config.quiz_heading_font_override || "",
    quiz_body_font_override: config.quiz_body_font_override || "",
  });

  const setField = useCallback(
    (key: keyof QuizFormState) => (value: string) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  // Trust items — same tag-list editing pattern as hero_trust_items.
  const [trustItems, setTrustItems] = useState<string[]>(config.quiz_trust_items);
  const [newTrustItem, setNewTrustItem] = useState("");

  const addTrustItem = useCallback(() => {
    const trimmed = newTrustItem.trim();
    if (trimmed && !trustItems.includes(trimmed) && trustItems.length < 4) {
      setTrustItems([...trustItems, trimmed]);
      setNewTrustItem("");
    }
  }, [newTrustItem, trustItems]);

  const removeTrustItem = useCallback(
    (item: string) => {
      setTrustItems(trustItems.filter((t) => t !== item));
    },
    [trustItems],
  );

  // Before/after image uploads — reuses the generic authenticated image
  // upload endpoint (same as the assistant avatar / hero sample images).
  const [uploadingImage, setUploadingImage] = useState<"before" | "after" | null>(null);
  const uploadTargetRef = useRef<"before" | "after">("before");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(
    async (file: File) => {
      const target = uploadTargetRef.current;
      setUploadingImage(target);
      try {
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch("/api/upload-avatar", { method: "POST", body: fd });
        const data = await res.json();
        if (data.avatarUrl) {
          setForm((prev) => ({
            ...prev,
            [target === "before" ? "quiz_before_image_url" : "quiz_after_image_url"]:
              data.avatarUrl,
          }));
        }
      } catch (e) {
        console.error("Quiz image upload failed", e);
      } finally {
        setUploadingImage(null);
      }
    },
    [],
  );

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "save");
    for (const [key, value] of Object.entries(form)) {
      formData.append(key, value);
    }
    formData.append("quiz_trust_items", JSON.stringify(trustItems));
    fetcher.submit(formData, { method: "POST" });
  }, [fetcher, form, trustItems]);

  const renderImageField = (
    label: string,
    key: "quiz_before_image_url" | "quiz_after_image_url",
    target: "before" | "after",
  ) => (
    <BlockStack gap="200">
      <TextField
        label={label}
        value={form[key]}
        onChange={setField(key)}
        autoComplete="off"
        placeholder="https://…"
        helpText="Paste an image URL or upload one. Leave empty to hide."
      />
      <InlineStack gap="300" blockAlign="center">
        {form[key] && (
          <img
            src={form[key]}
            alt=""
            style={{
              width: 56,
              height: 56,
              objectFit: "cover",
              borderRadius: 8,
              border: "1px solid #e1e3e5",
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <Button
          size="slim"
          loading={uploadingImage === target}
          onClick={() => {
            uploadTargetRef.current = target;
            imageInputRef.current?.click();
          }}
        >
          Upload image
        </Button>
        {form[key] && (
          <Button size="slim" variant="plain" tone="critical" onClick={() => setField(key)("")}>
            Remove
          </Button>
        )}
      </InlineStack>
    </BlockStack>
  );

  return (
    <Page backAction={{ content: "Assistant", url: "/app/assistant" }} title="Quiz Page">
      <TitleBar title="Quiz Page" />
      <BlockStack gap="500">
        {fetcher.data?.success && (
          <Banner tone="success">Quiz page settings saved.</Banner>
        )}
        {fetcher.data?.error && (
          <Banner tone="critical">Save failed: {fetcher.data.error}</Banner>
        )}

        <Banner tone="info">
          The quiz appears on your storefront once you add the "Gleame Quiz" section to a
          page in the theme editor and set the assistant surface to "Quiz page" or "Both".
          Question content comes from your recommendation logic — this page controls the
          copy and styling around it.
        </Banner>

        {/* Landing */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Landing
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The first screen shoppers see before starting the quiz.
              </Text>
            </BlockStack>
            <TextField
              label="Eyebrow"
              value={form.quiz_eyebrow}
              onChange={setField("quiz_eyebrow")}
              autoComplete="off"
              maxLength={40}
              showCharacterCount
              helpText="Small uppercase label above the headline"
            />
            <TextField
              label="Headline"
              value={form.quiz_headline}
              onChange={setField("quiz_headline")}
              autoComplete="off"
              maxLength={80}
              showCharacterCount
            />
            <TextField
              label="Subtext"
              value={form.quiz_subtext}
              onChange={setField("quiz_subtext")}
              autoComplete="off"
              multiline={3}
              helpText="Sentence under the headline explaining the value"
            />
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Trust Items
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Up to 4 short reassurance phrases shown on the landing screen
              </Text>
              <InlineStack gap="200" wrap>
                {trustItems.map((item) => (
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
                    disabled={trustItems.length >= 4}
                  />
                </div>
                <Button onClick={addTrustItem} size="slim" disabled={trustItems.length >= 4}>
                  Add
                </Button>
              </InlineStack>
            </BlockStack>
            {renderImageField("Before Image", "quiz_before_image_url", "before")}
            {renderImageField("After Image", "quiz_after_image_url", "after")}
            <TextField
              label="Visual Caption"
              value={form.quiz_visual_caption}
              onChange={setField("quiz_visual_caption")}
              autoComplete="off"
              helpText="Small caption under the before/after visual. Leave empty to hide."
            />
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Alternate Audience Label"
                  value={form.quiz_alt_audience_label}
                  onChange={setField("quiz_alt_audience_label")}
                  autoComplete="off"
                  placeholder='e.g. "Shopping for someone else?"'
                  helpText="Optional link under the CTA for a different audience"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Alternate Audience URL"
                  value={form.quiz_alt_audience_url}
                  onChange={setField("quiz_alt_audience_url")}
                  autoComplete="off"
                  placeholder="/collections/all"
                  helpText="Where the alternate audience link goes"
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Try-on gate */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Try-On Gate
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The optional photo step after the questions — shoppers can add a
                photo to see their match on themselves, or skip.
              </Text>
            </BlockStack>
            <TextField
              label="Headline"
              value={form.quiz_gate_headline}
              onChange={setField("quiz_gate_headline")}
              autoComplete="off"
            />
            <TextField
              label="Helper Text"
              value={form.quiz_gate_helper}
              onChange={setField("quiz_gate_helper")}
              autoComplete="off"
              multiline={3}
            />
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Photo Button Label"
                  value={form.quiz_gate_photo_label}
                  onChange={setField("quiz_gate_photo_label")}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Skip Button Label"
                  value={form.quiz_gate_skip_label}
                  onChange={setField("quiz_gate_skip_label")}
                  autoComplete="off"
                />
              </div>
            </InlineStack>
            <TextField
              label="Privacy Note"
              value={form.quiz_privacy_note}
              onChange={setField("quiz_privacy_note")}
              autoComplete="off"
              helpText="Small reassurance line under the photo button"
            />
          </BlockStack>
        </Card>

        {/* Results */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Results
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The final screen showing the shopper's matched products.
              </Text>
            </BlockStack>
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Headline (with photo)"
                  value={form.quiz_results_headline_photo}
                  onChange={setField("quiz_results_headline_photo")}
                  autoComplete="off"
                  helpText="Shown when the shopper added a photo"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Headline (no photo)"
                  value={form.quiz_results_headline_nophoto}
                  onChange={setField("quiz_results_headline_nophoto")}
                  autoComplete="off"
                  helpText="Shown when the shopper skipped the photo"
                />
              </div>
            </InlineStack>
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Best Match Pill"
                  value={form.quiz_best_match_pill}
                  onChange={setField("quiz_best_match_pill")}
                  autoComplete="off"
                  maxLength={30}
                  helpText="Badge on the top-ranked product"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Also Matched Label"
                  value={form.quiz_also_matched_label}
                  onChange={setField("quiz_also_matched_label")}
                  autoComplete="off"
                  helpText="Heading above the runner-up products"
                />
              </div>
            </InlineStack>
            <TextField
              label="Add-to-Bag Button"
              value={form.quiz_add_button_template}
              onChange={setField("quiz_add_button_template")}
              autoComplete="off"
              helpText="Supports {count}, {set_word}, and {total} tokens, replaced at render time"
            />
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="View Product Label"
                  value={form.quiz_view_product_label}
                  onChange={setField("quiz_view_product_label")}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Retake Label"
                  value={form.quiz_retake_label}
                  onChange={setField("quiz_retake_label")}
                  autoComplete="off"
                  helpText="Button to retake the try-on photo"
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Shade gate */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Shade Gate
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The step where shoppers choose between AI shade matching and
                picking a shade themselves.
              </Text>
            </BlockStack>
            <TextField
              label="Headline"
              value={form.quiz_shade_headline}
              onChange={setField("quiz_shade_headline")}
              autoComplete="off"
            />
            <TextField
              label="Body"
              value={form.quiz_shade_body}
              onChange={setField("quiz_shade_body")}
              autoComplete="off"
              multiline={2}
            />
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Photo CTA"
                  value={form.quiz_shade_cta_photo}
                  onChange={setField("quiz_shade_cta_photo")}
                  autoComplete="off"
                  helpText="Button for AI shade matching from a photo"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Manual CTA"
                  value={form.quiz_shade_cta_manual}
                  onChange={setField("quiz_shade_cta_manual")}
                  autoComplete="off"
                  helpText="Button for picking a shade manually"
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Style */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Style
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Leave any field empty to inherit from the assistant settings or
                your storefront theme.
              </Text>
            </BlockStack>
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Accent Color"
                  value={form.quiz_accent_color}
                  onChange={setField("quiz_accent_color")}
                  autoComplete="off"
                  placeholder="Blank = assistant accent"
                  connectedLeft={
                    <input
                      type="color"
                      value={form.quiz_accent_color || config.accent_color}
                      onChange={(e) => setField("quiz_accent_color")(e.target.value)}
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
                  helpText="Buttons, pills, and highlights on the quiz page"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Button Radius"
                  value={form.quiz_button_radius}
                  onChange={setField("quiz_button_radius")}
                  autoComplete="off"
                  type="number"
                  suffix="px"
                  placeholder="Blank = default"
                  helpText="Corner radius for quiz buttons"
                />
              </div>
            </InlineStack>
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Heading Font Override"
                  value={form.quiz_heading_font_override}
                  onChange={setField("quiz_heading_font_override")}
                  autoComplete="off"
                  placeholder='e.g. "Playfair Display", serif'
                  helpText="CSS font-family for headings. Empty = inherit the storefront theme's fonts."
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Body Font Override"
                  value={form.quiz_body_font_override}
                  onChange={setField("quiz_body_font_override")}
                  autoComplete="off"
                  placeholder='e.g. "Inter", sans-serif'
                  helpText="CSS font-family for body text. Empty = inherit the storefront theme's fonts."
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Save */}
        <InlineStack align="end">
          <Button variant="primary" onClick={handleSave} loading={isSaving}>
            Save Quiz Settings
          </Button>
        </InlineStack>
      </BlockStack>

      {/* Shared hidden file input for the before/after image uploads */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageUpload(file);
          e.target.value = "";
        }}
      />
    </Page>
  );
}
