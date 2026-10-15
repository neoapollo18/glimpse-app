import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Checkbox,
  Divider,
  InlineStack,
  RangeSlider,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import type { RecommendationTuning } from "../../lib/supabase.server";
import type { StudioActionData } from "../../routes/studio";
import { EditorHeader } from "./SettingsEditors";

// Matching settings (moved here 2026-10-15 from the retired Quiz settings
// page, /app/assistant): how many matches the quiz shows, which products
// can be recommended, and the AI ranking controls (migrations 050/051).
// These are store-wide recommendation settings outside the quiz_* copy
// namespace, so they save through their own intent (save-match-settings)
// with an explicit Save, never keystroke autosave: a scope change alters
// what every shopper is recommended.

export interface MatchSettings {
  numRecommendations: number;
  productScope: string;
  selectedProductIds: string[];
  recommendationMode: "matrix" | "ai" | "hybrid";
  aiGuidance: string;
  priorityProductIds: string[];
  tuning: RecommendationTuning;
  photoFrameHint: string;
}

export interface MatchProduct {
  id: string;
  product_name: string | null;
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function MatchSettingsEditor({
  initial,
  products,
  chatBusy,
  onPreviewReload,
}: {
  initial: MatchSettings;
  products: MatchProduct[];
  chatBusy: boolean;
  onPreviewReload: () => void;
}) {
  const fetcher = useFetcher<StudioActionData>();
  const [numRecommendations, setNumRecommendations] = useState(initial.numRecommendations);
  const [productScope, setProductScope] = useState(initial.productScope);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(initial.selectedProductIds);
  const [recommendationMode, setRecommendationMode] = useState(initial.recommendationMode);
  const [aiGuidance, setAiGuidance] = useState(initial.aiGuidance);
  const [priorityProductIds, setPriorityProductIds] = useState<string[]>(initial.priorityProductIds);
  const [tuning, setTuning] = useState<RecommendationTuning>(initial.tuning);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "critical"; text: string } | null>(null);

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
    setMessage(null);
  };
  const setTuningField = (patch: Partial<RecommendationTuning>) => {
    setTuning((prev) => ({ ...prev, ...patch }));
    setDirty(true);
    setMessage(null);
  };

  const saving = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.intent !== "save-match-settings") return;
    if (fetcher.data.ok) {
      setDirty(false);
      setMessage({ tone: "success", text: fetcher.data.message ?? "Matching settings saved" });
      onPreviewReload();
    } else {
      setMessage({ tone: "critical", text: fetcher.data.error ?? "Saving failed" });
    }
    // onPreviewReload is stable enough for a once-per-response effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const save = () => {
    const fd = new FormData();
    fd.append("intent", "save-match-settings");
    fd.append(
      "patch",
      JSON.stringify({
        num_recommendations: numRecommendations,
        product_scope: productScope,
        selected_product_ids: selectedProductIds,
        recommendation_mode: recommendationMode,
        // Only sent where the textarea renders, so a rules-only shop's
        // generated rulebook is never blanked by an unrelated save.
        ...(recommendationMode !== "matrix" ? { ai_guidance: aiGuidance } : {}),
        priority_product_ids: priorityProductIds,
        recommendation_tuning: tuning,
      }),
    );
    fetcher.submit(fd, { method: "POST", action: "/studio" });
  };

  const disabled = chatBusy || saving;
  // Only in-scope products can ever be recommended, so only they can
  // meaningfully be prioritized.
  const eligible = productScope === "selected" ? products.filter((p) => selectedProductIds.includes(p.id)) : products;

  return (
    <BlockStack gap="400">
      <EditorHeader title="Matching" saveState={saving ? "saving" : "idle"} />
      <Text as="p" variant="bodySm" tone="subdued">
        How many matches the quiz shows and which products it can recommend. Answer-by-answer
        rules live in Check matches.
      </Text>
      <RangeSlider
        label={`Number of matches: ${numRecommendations}`}
        value={numRecommendations}
        min={1}
        max={8}
        step={1}
        onChange={touch((v: number | [number, number]) => setNumRecommendations(v as number))}
        disabled={disabled}
        output
      />
      <Select
        label="Which products can be recommended?"
        options={[
          { label: "All configured products", value: "all_configured" },
          { label: "Selected products only", value: "selected" },
        ]}
        value={productScope}
        onChange={touch(setProductScope)}
        disabled={disabled}
      />
      {productScope === "selected" && (
        <BlockStack gap="100">
          {products.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              No products are set up for the quiz yet.
            </Text>
          ) : (
            products.map((product) => (
              <Checkbox
                key={product.id}
                label={product.product_name || product.id}
                checked={selectedProductIds.includes(product.id)}
                onChange={() => touch(setSelectedProductIds)(toggle(selectedProductIds, product.id))}
                disabled={disabled}
              />
            ))
          )}
        </BlockStack>
      )}
      <Divider />
      <Select
        label="Ranking mode"
        options={[
          { label: "Rules only (classic)", value: "matrix" },
          { label: "Rules + AI: your rules first, AI ranks the rest", value: "hybrid" },
          { label: "AI only", value: "ai" },
        ]}
        value={recommendationMode}
        onChange={touch((v: string) => setRecommendationMode(v as MatchSettings["recommendationMode"]))}
        disabled={disabled}
        helpText="AI scores every eligible product against the shopper's answers, no rule authoring needed. Rules + AI keeps your rules in charge and uses AI only where no rule matches."
      />
      {recommendationMode !== "matrix" && (
        <BlockStack gap="400">
          <TextField
            label="Recommendation logic (advanced text)"
            value={aiGuidance}
            onChange={touch(setAiGuidance)}
            multiline={3}
            autoComplete="off"
            disabled={disabled}
            placeholder={'e.g. "Our hero product is the Silk Set. Suggest it to first-timers. Push bundles over singles."'}
            helpText="Notes the AI follows when ranking. Regenerating recommendation logic from your answers replaces this text."
          />
          <Select
            label="Color matching filter"
            options={[
              { label: "Off: rank everything", value: "off" },
              { label: "Loose: drop clearly different colors", value: "loose" },
              { label: "Normal: keep the same color neighborhood", value: "normal" },
              { label: "Strict: same color family only", value: "strict" },
            ]}
            value={tuning.colorFilter}
            onChange={(v) => setTuningField({ colorFilter: v as RecommendationTuning["colorFilter"] })}
            disabled={disabled}
            helpText="Removes variants whose swatch color is far from the shade the shopper picked, before the AI ranks. Variants without a display color always pass."
          />
          <Checkbox
            label="Mismatch guard"
            checked={tuning.mismatchGuard}
            onChange={(v) => setTuningField({ mismatchGuard: v })}
            disabled={disabled}
            helpText="Blocks obviously wrong colors (shopper picks purple, product is white) even with the color filter off. Recommended on."
          />
          <Select
            label="Priority style"
            options={[
              { label: "Boost: nudge priority products up a few spots", value: "boost" },
              { label: "Pin: suitable priority products always go first", value: "pin" },
            ]}
            value={tuning.priorityStyle}
            onChange={(v) => setTuningField({ priorityStyle: v as RecommendationTuning["priorityStyle"] })}
            disabled={disabled}
            helpText="Pin still needs the AI to judge the product suitable; it can't force a bad match to the top."
          />
          {tuning.priorityStyle === "boost" && (
            <RangeSlider
              label={`Boost strength: ${tuning.priorityBoostSlots} position${tuning.priorityBoostSlots === 1 ? "" : "s"}`}
              value={tuning.priorityBoostSlots}
              min={1}
              max={10}
              step={1}
              onChange={(v) => setTuningField({ priorityBoostSlots: v as number })}
              disabled={disabled}
              output
            />
          )}
          <Select
            label="AI model"
            options={[
              { label: "Fastest: lightest model, snappiest results", value: "lite" },
              { label: "Fast (recommended): ranks in about a second", value: "flash" },
              { label: "Precise: slower, better with nuanced guidance", value: "pro" },
            ]}
            value={tuning.rankerModel}
            onChange={(v) => setTuningField({ rankerModel: v as RecommendationTuning["rankerModel"] })}
            disabled={disabled}
          />
          <Checkbox
            label="Show 'why we picked this' on cards"
            checked={tuning.llmReasons}
            onChange={(v) => setTuningField({ llmReasons: v })}
            disabled={disabled}
          />
          <Checkbox
            label="Prefer variety across products"
            checked={tuning.productDiversity}
            onChange={(v) => setTuningField({ productDiversity: v })}
            disabled={disabled}
          />
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              Priority products
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Surfaced first when they suit the shopper equally well. A clearly better match still wins.
            </Text>
            {eligible.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {productScope === "selected"
                  ? "Select products above first. Priority picks come from the selected set."
                  : "No products are set up for the quiz yet."}
              </Text>
            ) : (
              eligible.map((product) => (
                <Checkbox
                  key={`priority-${product.id}`}
                  label={product.product_name || product.id}
                  checked={priorityProductIds.includes(product.id)}
                  onChange={() => touch(setPriorityProductIds)(toggle(priorityProductIds, product.id))}
                  disabled={disabled}
                />
              ))
            )}
          </BlockStack>
        </BlockStack>
      )}
      {message && (
        <Banner tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Banner>
      )}
      {dirty && (
        <InlineStack align="end">
          <Button variant="primary" loading={saving} disabled={chatBusy} onClick={save}>
            Save matching settings
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}

/** Camera framing hint for the quiz's try-on step: one field, saved on
 * blur through the same intent (it lives outside the quiz_* namespace). */
export function CameraHintField({ initial, disabled }: { initial: string; disabled: boolean }) {
  const fetcher = useFetcher<StudioActionData>();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const commit = () => {
    const next = value.trim();
    if (next === saved) return;
    const fd = new FormData();
    fd.append("intent", "save-match-settings");
    fd.append("patch", JSON.stringify({ photo_frame_hint: next }));
    fetcher.submit(fd, { method: "POST", action: "/studio" });
    setSaved(next);
  };
  const failed = fetcher.state === "idle" && fetcher.data?.intent === "save-match-settings" && !fetcher.data.ok;
  return (
    <TextField
      label="Camera framing hint"
      value={value}
      onChange={setValue}
      onBlur={commit}
      autoComplete="off"
      disabled={disabled}
      placeholder="Position your face in the frame"
      helpText="Shown inside the camera on the try-on step (e.g. “Position your nails in the frame”)."
      error={failed ? fetcher.data?.error ?? "Saving failed" : undefined}
    />
  );
}
