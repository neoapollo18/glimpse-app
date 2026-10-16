import { useMemo, useState } from "react";
import { Banner, BlockStack, Icon, InlineStack, Text, TextField } from "@shopify/polaris";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "@shopify/polaris-icons";
import { EditorHeader, useSettingsAutosave } from "./SettingsEditors";
import {
  UI_TEXT_ENTRIES,
  UI_TEXT_GROUPS,
  UI_TEXT_MAX_LEN,
  sanitizeUiText,
  uiTextApplies,
  uiTextDefault,
  type UiTextEntry,
  type UiTextGroupId,
} from "../../lib/quiz-ui-text";

// Studio → Text & labels (2026-10-16): every fixed string shoppers see,
// pre-filled with the default, in one place. This is what makes a
// non-English store possible: the merchant types their own wording. Most
// strings save to quiz_ui_text through update_ui_text; the few that
// already had their own column (view product, add to cart, photo
// buttons...) save through update_copy exactly as their slide editors do.

const VAR_HINTS: Record<string, string> = {
  count: "the number of items",
  total: "the price",
  n: "a number",
  max: "the pick limit",
  s: "seconds",
  amount: "the discount",
  name: "a name",
  option: "the option name, like shade",
  answers: "the shopper’s answers",
};

function varsHelp(entry: UiTextEntry): string | undefined {
  if (!entry.vars?.length) return entry.help;
  const parts = entry.vars.map((v) => `{${v}} is ${entry.varHints?.[v] ?? VAR_HINTS[v] ?? v}`);
  const line = `Keep the braces: ${parts.join(", ")}.`;
  return entry.help ? `${entry.help} ${line}` : line;
}

export function TextLabelsEditor({
  settings,
  template,
  chatBusy,
  onPreviewUpdate,
}: {
  settings: Record<string, unknown>;
  /** Loader `studio.template` (single source of truth). */
  template: string | null;
  chatBusy: boolean;
  onPreviewUpdate: (p: { flow?: unknown; config?: unknown }) => void;
}) {
  const { schedule, saveState, error, clearError } = useSettingsAutosave(onPreviewUpdate);
  const layout = {
    template,
    grid: !template && settings.quiz_results_layout === "grid",
    boutique: !template && settings.quiz_ui_style === "boutique",
  };
  const entries = useMemo(
    () => UI_TEXT_ENTRIES.filter((e) => uiTextApplies(e, layout)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, layout.grid, layout.boutique],
  );

  // Pre-filled: the merchant's text where set, else the default.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const overrides = sanitizeUiText(settings.quiz_ui_text);
    const out: Record<string, string> = {};
    for (const e of UI_TEXT_ENTRIES) {
      if (e.column) {
        const v = settings[e.key];
        out[e.key] = typeof v === "string" ? v : uiTextDefault(e, template);
      } else {
        out[e.key] = overrides[e.key] ?? uiTextDefault(e, template);
      }
    }
    return out;
  });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Partial<Record<UiTextGroupId, boolean>>>({ nav: true });

  const setValue = (entry: UiTextEntry, value: string) => {
    setValues((prev) => ({ ...prev, [entry.key]: value }));
    // Blank = back to the default. Columns take "" like their slide
    // editors (the widget falls back on empty); the text map takes null.
    if (entry.column) schedule("copy", entry.key, value.trim());
    else schedule("uitext", entry.key, value.trim() === "" ? null : value);
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? entries.filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          uiTextDefault(e, template).toLowerCase().includes(q) ||
          (values[e.key] ?? "").toLowerCase().includes(q),
      )
    : entries;
  const edited = (e: UiTextEntry) => {
    const v = (values[e.key] ?? "").trim();
    return v !== "" && v !== uiTextDefault(e, template);
  };
  const disabled = chatBusy;

  return (
    <BlockStack gap="400">
      <EditorHeader title="Text & labels" saveState={saveState} />
      <Text as="p" variant="bodySm" tone="subdued">
        Every button and line shoppers see, filled in with Gleame&rsquo;s wording. Type your own, or another
        language, and it updates on your store as you go. Clear a field to go back to the default. Headlines and
        questions are edited on their own screens.
      </Text>
      {error && (
        <Banner tone="critical" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      <TextField
        label="Search text"
        labelHidden
        placeholder="Search, e.g. back or bag"
        value={query}
        onChange={setQuery}
        prefix={<Icon source={SearchIcon} tone="subdued" />}
        clearButton
        onClearButtonClick={() => setQuery("")}
        autoComplete="off"
      />
      {UI_TEXT_GROUPS.map((g) => {
        const items = visible.filter((e) => e.group === g.id);
        if (items.length === 0) return null;
        const isOpen = q !== "" || open[g.id] === true;
        const editedCount = items.filter(edited).length;
        return (
          <div key={g.id} style={{ borderTop: "1px solid #E3E3E3", paddingTop: 12 }}>
            <button
              type="button"
              onClick={() => setOpen((prev) => ({ ...prev, [g.id]: !isOpen }))}
              aria-expanded={isOpen}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: 0,
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ width: 16, height: 16, display: "inline-flex", flexShrink: 0 }}>
                <Icon source={isOpen ? ChevronDownIcon : ChevronRightIcon} tone="subdued" />
              </span>
              <Text as="h4" variant="headingSm">
                {g.title}
              </Text>
              <span style={{ marginLeft: "auto" }}>
                <Text as="span" variant="bodySm" tone="subdued">
                  {editedCount > 0 ? `${editedCount} edited · ${items.length}` : String(items.length)}
                </Text>
              </span>
            </button>
            {isOpen && (
              <div style={{ paddingTop: 12 }}>
                <BlockStack gap="300">
                  {g.description && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {g.description}
                    </Text>
                  )}
                  {items.map((e) => (
                    <TextField
                      key={e.key}
                      label={e.label}
                      value={values[e.key] ?? ""}
                      placeholder={uiTextDefault(e, template)}
                      onChange={(v) => setValue(e, v)}
                      helpText={varsHelp(e)}
                      maxLength={UI_TEXT_MAX_LEN}
                      disabled={disabled}
                      autoComplete="off"
                      labelAction={
                        edited(e)
                          ? { content: "Reset", onAction: () => setValue(e, uiTextDefault(e, template)) }
                          : undefined
                      }
                    />
                  ))}
                </BlockStack>
              </div>
            )}
          </div>
        );
      })}
      {visible.length === 0 && (
        <InlineStack>
          <Text as="p" tone="subdued">
            No text matches &ldquo;{query}&rdquo;.
          </Text>
        </InlineStack>
      )}
    </BlockStack>
  );
}
