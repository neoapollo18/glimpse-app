import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Checkbox,
  InlineStack,
  Select,
  Spinner,
  Tag,
  Text,
  TextField,
} from "@shopify/polaris";
import type { StudioActionData } from "../../routes/studio";

// In-studio editors for the fixed slides (Intro, Photo, Results) and the
// Theme item. These edit DRAFT SETTINGS through the same update_copy /
// update_design_tokens appliers the AI uses, so the live preview hot-swaps
// on every change and everything goes live at publish. This replaces the
// old standalone "copy & design" page as the primary editing surface.

type Kind = "copy" | "design";

// ---------------------------------------------------------------------
// Shared autosave: batches field edits per tool, debounced, submitted
// sequentially through one fetcher (copy first, then design).
// ---------------------------------------------------------------------

function useSettingsAutosave(onPreviewUpdate: (p: { flow?: unknown; config?: unknown }) => void) {
  const fetcher = useFetcher<StudioActionData>();
  const pending = useRef<{ copy: Record<string, unknown>; design: Record<string, unknown> }>({
    copy: {},
    design: {},
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const submitBatch = () => {
    const kind: Kind | null = Object.keys(pending.current.copy).length
      ? "copy"
      : Object.keys(pending.current.design).length
        ? "design"
        : null;
    if (!kind) return false;
    const fields = pending.current[kind];
    pending.current[kind] = {};
    const fd = new FormData();
    fd.append("intent", "apply-tool");
    fd.append("tool", kind === "copy" ? "update_copy" : "update_design_tokens");
    fd.append("input", JSON.stringify({ fields }));
    fetcher.submit(fd, { method: "POST", action: "/studio" });
    return true;
  };

  const flush = () => {
    if (fetcher.state !== "idle") return; // drained on idle effect below
    submitBatch();
  };

  const schedule = (kind: Kind, key: string, value: unknown) => {
    pending.current[kind][key] = value;
    setSaveState("saving");
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  };

  const processedRef = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (processedRef.current === fetcher.data) return;
    processedRef.current = fetcher.data;
    if (fetcher.data.ok) {
      if (fetcher.data.previewFlow || fetcher.data.previewConfig) {
        onPreviewUpdate({ flow: fetcher.data.previewFlow, config: fetcher.data.previewConfig });
      }
    } else if (fetcher.data.error) {
      setError(fetcher.data.error);
    }
    // Drain the other batch (or newly accumulated edits).
    if (!submitBatch()) {
      setSaveState(fetcher.data.ok ? "saved" : "idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      // Deliver anything still pending: unmounting inside the debounce
      // window (or with edits queued behind an in-flight submit) must not
      // silently drop copy/theme edits. Fire-and-forget; the next mount
      // reloads fresh data.
      const calls: Array<{ tool: string; input: unknown }> = [];
      if (Object.keys(pending.current.copy).length > 0) {
        calls.push({ tool: "update_copy", input: { fields: pending.current.copy } });
      }
      if (Object.keys(pending.current.design).length > 0) {
        calls.push({ tool: "update_design_tokens", input: { fields: pending.current.design } });
      }
      if (calls.length > 0) {
        pending.current = { copy: {}, design: {} };
        const fd = new FormData();
        fd.append("intent", "apply-tools");
        fd.append("calls", JSON.stringify(calls));
        fetch("/studio", { method: "POST", body: fd }).catch(() => {});
      }
    },
    [],
  );

  const flushNow = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    flush();
  };

  return { schedule, saveState, error, clearError: () => setError(null), flushNow };
}

function EditorHeader({
  title,
  saveState,
}: {
  title: string;
  saveState: "idle" | "saving" | "saved";
}) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="h3" variant="headingMd">
        {title}
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
  );
}

function str(settings: Record<string, unknown>, key: string): string {
  const v = settings[key];
  return v == null ? "" : String(v);
}

// ---------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------

function CopyField({
  label,
  fieldKey,
  values,
  setValue,
  disabled,
  multiline,
  placeholder,
  helpText,
}: {
  label: string;
  fieldKey: string;
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  disabled?: boolean;
  multiline?: number;
  placeholder?: string;
  helpText?: string;
}) {
  return (
    <TextField
      label={label}
      value={values[fieldKey] ?? ""}
      onChange={(v) => setValue(fieldKey, v)}
      disabled={disabled}
      multiline={multiline}
      placeholder={placeholder}
      helpText={helpText}
      autoComplete="off"
    />
  );
}

function ColorField({
  label,
  fieldKey,
  values,
  setValue,
  disabled,
  helpText,
}: {
  label: string;
  fieldKey: string;
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  disabled?: boolean;
  helpText?: string;
}) {
  const value = values[fieldKey] ?? "";
  const invalid = value !== "" && !/^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <TextField
      label={label}
      value={value}
      onChange={(v) => setValue(fieldKey, v)}
      disabled={disabled}
      placeholder="Blank = default"
      helpText={helpText}
      error={invalid ? "Use a 6-digit hex like #1a1a1a (not saved until valid)" : undefined}
      autoComplete="off"
      connectedLeft={
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#1a1a1a"}
          onChange={(e) => setValue(fieldKey, e.target.value)}
          disabled={disabled}
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
    />
  );
}

function ImageField({
  label,
  fieldKey,
  values,
  setValue,
  disabled,
}: {
  label: string;
  fieldKey: string;
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const value = values[fieldKey] ?? "";

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(false);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload-avatar", { method: "POST", body: fd });
      const data = await res.json();
      if (data.avatarUrl) setValue(fieldKey, data.avatarUrl);
      else setUploadError(true);
    } catch {
      setUploadError(true);
    } finally {
      setUploading(false);
    }
  };

  return (
    <BlockStack gap="150">
      <TextField
        label={label}
        value={value}
        onChange={(v) => setValue(fieldKey, v)}
        disabled={disabled}
        placeholder="https://… (empty = hidden)"
        autoComplete="off"
      />
      <InlineStack gap="200" blockAlign="center">
        {value && (
          <img
            src={value}
            alt=""
            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid #E1E3E5" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <Button size="slim" loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>
          Upload image
        </Button>
        {value && (
          <Button size="slim" variant="plain" tone="critical" disabled={disabled} onClick={() => setValue(fieldKey, "")}>
            Remove
          </Button>
        )}
        {uploadError && (
          <Text as="span" variant="bodySm" tone="critical">
            Upload failed. Try a smaller JPG or PNG.
          </Text>
        )}
      </InlineStack>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
    </BlockStack>
  );
}

// ---------------------------------------------------------------------
// Intro
// ---------------------------------------------------------------------

export function IntroEditor({
  settings,
  chatBusy,
  onPreviewUpdate,
}: {
  settings: Record<string, unknown>;
  chatBusy: boolean;
  onPreviewUpdate: (p: { flow?: unknown; config?: unknown }) => void;
}) {
  const { schedule, saveState, error, clearError } = useSettingsAutosave(onPreviewUpdate);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    quiz_eyebrow: str(settings, "quiz_eyebrow"),
    quiz_headline: str(settings, "quiz_headline"),
    quiz_subtext: str(settings, "quiz_subtext"),
    quiz_before_image_url: str(settings, "quiz_before_image_url"),
    quiz_after_image_url: str(settings, "quiz_after_image_url"),
    quiz_visual_caption: str(settings, "quiz_visual_caption"),
    quiz_alt_audience_label: str(settings, "quiz_alt_audience_label"),
    quiz_alt_audience_url: str(settings, "quiz_alt_audience_url"),
  }));
  const [trustItems, setTrustItems] = useState<string[]>(
    Array.isArray(settings.quiz_trust_items) ? (settings.quiz_trust_items as string[]) : [],
  );
  const [newTrust, setNewTrust] = useState("");

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    schedule("copy", key, value);
  };
  const saveTrust = (items: string[]) => {
    setTrustItems(items);
    schedule("copy", "quiz_trust_items", items);
  };

  const disabled = chatBusy;
  return (
    <BlockStack gap="400">
      <EditorHeader title="Intro slide" saveState={saveState} />
      {error && (
        <Banner tone="critical" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      <CopyField label="Eyebrow" fieldKey="quiz_eyebrow" values={values} setValue={setValue} disabled={disabled} helpText="Small uppercase label above the headline" />
      <CopyField
        label="Headline"
        fieldKey="quiz_headline"
        values={values}
        setValue={setValue}
        disabled={disabled}
        helpText="Wrap a phrase in **stars** to color it in the accent"
      />
      <CopyField label="Subtext" fieldKey="quiz_subtext" values={values} setValue={setValue} disabled={disabled} multiline={2} />
      <BlockStack gap="200">
        <Text as="h4" variant="headingSm">
          Trust items
        </Text>
        <InlineStack gap="150" wrap>
          {trustItems.map((item) => (
            <Tag key={item} onRemove={disabled ? undefined : () => saveTrust(trustItems.filter((t) => t !== item))}>
              {item}
            </Tag>
          ))}
        </InlineStack>
        <InlineStack gap="150" blockAlign="center" wrap={false}>
          <div style={{ flex: 1 }}>
            <TextField
              label="Add a trust phrase"
              labelHidden
              value={newTrust}
              onChange={setNewTrust}
              placeholder="Add a trust phrase…"
              disabled={disabled || trustItems.length >= 4}
              autoComplete="off"
            />
          </div>
          <Button
            size="slim"
            disabled={disabled || !newTrust.trim() || trustItems.length >= 4}
            onClick={() => {
              const t = newTrust.trim();
              if (t && !trustItems.includes(t)) saveTrust([...trustItems, t]);
              setNewTrust("");
            }}
          >
            Add
          </Button>
        </InlineStack>
      </BlockStack>
      <ImageField label="Before image" fieldKey="quiz_before_image_url" values={values} setValue={setValue} disabled={disabled} />
      <ImageField label="After image" fieldKey="quiz_after_image_url" values={values} setValue={setValue} disabled={disabled} />
      <CopyField label="Visual caption" fieldKey="quiz_visual_caption" values={values} setValue={setValue} disabled={disabled} helpText="Small caption under the before/after visual" />
      <InlineStack gap="200">
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Alternate audience label" fieldKey="quiz_alt_audience_label" values={values} setValue={setValue} disabled={disabled} helpText='e.g. "Shopping for someone else?"' />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Alternate audience link" fieldKey="quiz_alt_audience_url" values={values} setValue={setValue} disabled={disabled} placeholder="https://… or /pages/…" />
        </div>
      </InlineStack>
    </BlockStack>
  );
}

// ---------------------------------------------------------------------
// Photo step
// ---------------------------------------------------------------------

export function PhotoEditor({
  settings,
  chatBusy,
  onPreviewUpdate,
}: {
  settings: Record<string, unknown>;
  chatBusy: boolean;
  onPreviewUpdate: (p: { flow?: unknown; config?: unknown }) => void;
}) {
  const { schedule, saveState, error, clearError } = useSettingsAutosave(onPreviewUpdate);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    quiz_gate_headline: str(settings, "quiz_gate_headline"),
    quiz_gate_helper: str(settings, "quiz_gate_helper"),
    quiz_gate_photo_label: str(settings, "quiz_gate_photo_label"),
    quiz_gate_skip_label: str(settings, "quiz_gate_skip_label"),
    quiz_privacy_note: str(settings, "quiz_privacy_note"),
    quiz_shade_headline: str(settings, "quiz_shade_headline"),
    quiz_shade_body: str(settings, "quiz_shade_body"),
    quiz_shade_cta_photo: str(settings, "quiz_shade_cta_photo"),
    quiz_shade_cta_manual: str(settings, "quiz_shade_cta_manual"),
  }));
  const [manualShade, setManualShade] = useState<boolean>(settings.quiz_manual_shade_enabled !== false);
  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    schedule("copy", key, value);
  };
  const disabled = chatBusy;
  return (
    <BlockStack gap="400">
      <EditorHeader title="Photo step" saveState={saveState} />
      {error && (
        <Banner tone="critical" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      <CopyField label="Headline" fieldKey="quiz_gate_headline" values={values} setValue={setValue} disabled={disabled} />
      <CopyField label="Helper text" fieldKey="quiz_gate_helper" values={values} setValue={setValue} disabled={disabled} multiline={2} />
      <InlineStack gap="200">
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Photo button" fieldKey="quiz_gate_photo_label" values={values} setValue={setValue} disabled={disabled} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Skip button" fieldKey="quiz_gate_skip_label" values={values} setValue={setValue} disabled={disabled} />
        </div>
      </InlineStack>
      <CopyField label="Privacy note" fieldKey="quiz_privacy_note" values={values} setValue={setValue} disabled={disabled} helpText="Small reassurance line under the photo button" />
      <Text as="h4" variant="headingSm">
        Shade picker
      </Text>
      <Checkbox
        label="Manual shade picker on this step"
        checked={manualShade}
        disabled={disabled}
        onChange={(v) => {
          setManualShade(v);
          schedule("copy", "quiz_manual_shade_enabled", v);
        }}
        helpText='When off, the "No photo handy?" shade rail is hidden here; the results page picker stays available either way.'
      />
      <CopyField label="Shade step headline" fieldKey="quiz_shade_headline" values={values} setValue={setValue} disabled={disabled} />
      <CopyField label="Shade step body" fieldKey="quiz_shade_body" values={values} setValue={setValue} disabled={disabled} multiline={2} />
      <InlineStack gap="200">
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Photo button label" fieldKey="quiz_shade_cta_photo" values={values} setValue={setValue} disabled={disabled} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Manual picker button label" fieldKey="quiz_shade_cta_manual" values={values} setValue={setValue} disabled={disabled} />
        </div>
      </InlineStack>
    </BlockStack>
  );
}

// ---------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------

export function ResultsEditor({
  settings,
  chatBusy,
  onPreviewUpdate,
}: {
  settings: Record<string, unknown>;
  chatBusy: boolean;
  onPreviewUpdate: (p: { flow?: unknown; config?: unknown }) => void;
}) {
  const { schedule, saveState, error, clearError } = useSettingsAutosave(onPreviewUpdate);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    quiz_results_headline_photo: str(settings, "quiz_results_headline_photo"),
    quiz_results_headline_nophoto: str(settings, "quiz_results_headline_nophoto"),
    quiz_results_subtext: str(settings, "quiz_results_subtext"),
    quiz_best_match_pill: str(settings, "quiz_best_match_pill"),
    quiz_also_matched_label: str(settings, "quiz_also_matched_label"),
    quiz_view_product_label: str(settings, "quiz_view_product_label"),
    quiz_retake_label: str(settings, "quiz_retake_label"),
    quiz_show_matches_label: str(settings, "quiz_show_matches_label"),
    quiz_add_button_template: str(settings, "quiz_add_button_template"),
    quiz_upsell_title: str(settings, "quiz_upsell_title"),
    quiz_upsell_body: str(settings, "quiz_upsell_body"),
    quiz_upsell_cta: str(settings, "quiz_upsell_cta"),
  }));
  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    schedule("copy", key, value);
  };
  const disabled = chatBusy;
  return (
    <BlockStack gap="400">
      <EditorHeader title="Results slide" saveState={saveState} />
      {error && (
        <Banner tone="critical" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      <CopyField label="Headline (with photo)" fieldKey="quiz_results_headline_photo" values={values} setValue={setValue} disabled={disabled} />
      <CopyField label="Headline (no photo)" fieldKey="quiz_results_headline_nophoto" values={values} setValue={setValue} disabled={disabled} />
      <CopyField label="Subtext" fieldKey="quiz_results_subtext" values={values} setValue={setValue} disabled={disabled} multiline={2} />
      <InlineStack gap="200">
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Best match pill" fieldKey="quiz_best_match_pill" values={values} setValue={setValue} disabled={disabled} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Also matched label" fieldKey="quiz_also_matched_label" values={values} setValue={setValue} disabled={disabled} />
        </div>
      </InlineStack>
      <InlineStack gap="200">
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="View product button" fieldKey="quiz_view_product_label" values={values} setValue={setValue} disabled={disabled} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Retake link" fieldKey="quiz_retake_label" values={values} setValue={setValue} disabled={disabled} />
        </div>
      </InlineStack>
      <InlineStack gap="200">
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Show matches label" fieldKey="quiz_show_matches_label" values={values} setValue={setValue} disabled={disabled} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <CopyField label="Add to cart template" fieldKey="quiz_add_button_template" values={values} setValue={setValue} disabled={disabled} helpText="{price} inserts the price" />
        </div>
      </InlineStack>
      <Text as="h4" variant="headingSm">
        Try-on upsell
      </Text>
      <CopyField label="Title" fieldKey="quiz_upsell_title" values={values} setValue={setValue} disabled={disabled} />
      <CopyField label="Body" fieldKey="quiz_upsell_body" values={values} setValue={setValue} disabled={disabled} multiline={2} />
      <CopyField label="Button" fieldKey="quiz_upsell_cta" values={values} setValue={setValue} disabled={disabled} />
    </BlockStack>
  );
}

// Curated, theme-safe font stacks — merchants pick, never type CSS. A
// stored value outside this list (set via chat or the old page) shows as a
// Custom option so it round-trips untouched.
const FONT_CHOICES: Array<{ label: string; value: string }> = [
  { label: "Match your theme (default)", value: "" },
  { label: "Modern sans (Helvetica)", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "System sans (crisp)", value: 'Inter, system-ui, sans-serif' },
  { label: "Classic serif (Georgia)", value: 'Georgia, "Times New Roman", serif' },
  { label: "Editorial serif (Palatino)", value: '"Palatino Linotype", Palatino, Georgia, serif' },
  { label: "Friendly rounded (Trebuchet)", value: '"Trebuchet MS", Verdana, sans-serif' },
  { label: "Typewriter (Courier)", value: '"Courier New", Courier, monospace' },
];

function FontSelect({
  label,
  fieldKey,
  values,
  onPick,
  disabled,
}: {
  label: string;
  fieldKey: string;
  values: Record<string, string>;
  onPick: (key: string, value: string) => void;
  disabled?: boolean;
}) {
  const value = values[fieldKey] ?? "";
  const options = FONT_CHOICES.some((c) => c.value === value)
    ? FONT_CHOICES
    : [...FONT_CHOICES, { label: `Custom (${value.split(",")[0].replace(/"/g, "").trim()})`, value }];
  return (
    <Select
      label={label}
      options={options}
      value={value}
      onChange={(v) => onPick(fieldKey, v)}
      disabled={disabled}
      helpText={
        value && !FONT_CHOICES.some((c) => c.value === value)
          ? "Custom font set via chat. Pick an option to replace it."
          : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------
// Theme (design tokens)
// ---------------------------------------------------------------------

export function ThemeEditor({
  settings,
  chatBusy,
  onPreviewUpdate,
}: {
  settings: Record<string, unknown>;
  chatBusy: boolean;
  onPreviewUpdate: (p: { flow?: unknown; config?: unknown }) => void;
}) {
  const { schedule, saveState, error, clearError } = useSettingsAutosave(onPreviewUpdate);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    quiz_accent_color: str(settings, "quiz_accent_color"),
    quiz_ink_color: str(settings, "quiz_ink_color"),
    quiz_card_bg_color: str(settings, "quiz_card_bg_color"),
    quiz_line_color: str(settings, "quiz_line_color"),
    quiz_cta_color: str(settings, "quiz_cta_color"),
    quiz_button_radius: str(settings, "quiz_button_radius"),
    quiz_card_radius: str(settings, "quiz_card_radius"),
    quiz_progress_style: str(settings, "quiz_progress_style"),
    quiz_intro_layout: str(settings, "quiz_intro_layout"),
    quiz_animation_style: str(settings, "quiz_animation_style"),
    quiz_heading_font_override: str(settings, "quiz_heading_font_override"),
    quiz_body_font_override: str(settings, "quiz_body_font_override"),
  }));

  // Colors must reach the applier as #rrggbb or null (it rejects other
  // strings); numbers as numbers or null; enums as valid values or null.
  const setColor = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (value === "" || /^#[0-9a-fA-F]{6}$/.test(value)) {
      schedule("design", key, value === "" ? null : value);
    }
  };
  const setNumber = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    const n = Number(value);
    schedule(
      "design",
      key,
      value.trim() === "" || !Number.isFinite(n) ? null : Math.max(0, Math.min(60, Math.round(n))),
    );
  };
  const setEnum = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    schedule("design", key, value === "" ? null : value);
  };
  const setFont = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    schedule("design", key, value.trim() === "" ? null : value);
  };

  const disabled = chatBusy;
  return (
    <BlockStack gap="400">
      <EditorHeader title="Theme" saveState={saveState} />
      {error && (
        <Banner tone="critical" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      <Text as="p" variant="bodySm" tone="subdued">
        Blank fields inherit the quiz's polished defaults.
      </Text>
      <ColorField label="Accent color" fieldKey="quiz_accent_color" values={values} setValue={setColor} disabled={disabled} helpText="Buttons, highlights, and **starred** headline words" />
      <ColorField label="Text color" fieldKey="quiz_ink_color" values={values} setValue={setColor} disabled={disabled} />
      <ColorField label="Card background" fieldKey="quiz_card_bg_color" values={values} setValue={setColor} disabled={disabled} />
      <ColorField label="Border color" fieldKey="quiz_line_color" values={values} setValue={setColor} disabled={disabled} helpText="Card and option borders" />
      <ColorField label="Button color" fieldKey="quiz_cta_color" values={values} setValue={setColor} disabled={disabled} />
      <InlineStack gap="200">
        <div style={{ flex: 1, minWidth: 120 }}>
          <TextField label="Button radius" type="number" value={values.quiz_button_radius} onChange={(v) => setNumber("quiz_button_radius", v)} disabled={disabled} placeholder="Default" suffix="px" autoComplete="off" />
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <TextField label="Card radius" type="number" value={values.quiz_card_radius} onChange={(v) => setNumber("quiz_card_radius", v)} disabled={disabled} placeholder="Default" suffix="px" autoComplete="off" />
        </div>
      </InlineStack>
      <Select
        label="Progress indicator"
        options={[
          { label: "Default (dots)", value: "" },
          { label: "Bar", value: "bar" },
          { label: "Counter (2 of 6)", value: "counter" },
          { label: "None", value: "none" },
        ]}
        value={values.quiz_progress_style}
        onChange={(v) => setEnum("quiz_progress_style", v)}
        disabled={disabled}
      />
      <Select
        label="Intro layout"
        options={[
          { label: "Split (copy + visual)", value: "split" },
          { label: "Centered", value: "centered" },
        ]}
        value={values.quiz_intro_layout || "split"}
        onChange={(v) => setEnum("quiz_intro_layout", v)}
        disabled={disabled}
      />
      <Select
        label="Animations"
        options={[
          { label: "Default (full)", value: "" },
          { label: "Minimal (fades only)", value: "minimal" },
          { label: "Off", value: "off" },
        ]}
        value={values.quiz_animation_style}
        onChange={(v) => setEnum("quiz_animation_style", v)}
        disabled={disabled}
      />
      <FontSelect label="Heading font" fieldKey="quiz_heading_font_override" values={values} onPick={setFont} disabled={disabled} />
      <FontSelect label="Body font" fieldKey="quiz_body_font_override" values={values} onPick={setFont} disabled={disabled} />
    </BlockStack>
  );
}
