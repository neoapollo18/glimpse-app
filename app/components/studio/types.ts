// Client-safe structural types for the draft flow the studio edits.
// Mirrors SaveRecommendationConfigInput (supabase.server.ts) — declared here
// so client components never import a .server module.

export interface StudioShowIf {
  axis_key: string;
  axis_value: string;
}

export interface StudioOption {
  label: string;
  axisValueValue: string;
  botResponse?: string | null;
  reasonText?: string | null;
  imageUrl?: string | null;
  showIf?: StudioShowIf | null;
  selectAll?: boolean;
  displayMeta?: Record<string, unknown> | null;
  position?: number;
}

export interface StudioQuestion {
  axisKey: string;
  prompt: string;
  helperText?: string | null;
  multiSelect?: boolean;
  maxSelections?: number | null;
  screenGroup?: string | null;
  showIf?: StudioShowIf | null;
  optionStyle?: string | null;
  options: StudioOption[];
}

export interface StudioAxis {
  key: string;
  label: string;
  source: "photo" | "user_question";
  position?: number;
  values: Array<{ value: string; label: string; position?: number; swatchColor?: string | null }>;
}

export interface StudioFlow {
  axes: StudioAxis[];
  questions: StudioQuestion[];
  rules: Array<{
    criteria: Record<string, string>;
    variantId?: string | null;
    productId?: string | null;
    rank: number;
    quantity?: number;
  }>;
}

/** Resolve an answer's display label from the flow, for branch tooltips and
 * visibility summaries. Falls back to the raw value. */
export function answerLabel(flow: StudioFlow, axisKey: string, axisValue: string): string {
  const q = flow.questions.find((x) => x.axisKey === axisKey);
  const opt = q?.options.find((o) => o.axisValueValue === axisValue);
  if (opt?.label) return opt.label;
  const axis = flow.axes.find((a) => a.key === axisKey);
  return axis?.values.find((v) => v.value === axisValue)?.label ?? axisValue;
}

// ---------------------------------------------------------------------
// v3 Studio contract (docs/overhaul/V3-CONTRACTS.md §7). These mirror the
// loader's `studio` object so client components type against one shape
// without importing the route module's inferred loader type everywhere.
// ---------------------------------------------------------------------

export type StudioSlotSource = "merchant" | "answer" | "library" | "auto" | null;

/** A declared image slot (quiz-templates declareSlots) resolved for the
 * Images rail: where the image comes from today, or "Not found yet". */
export interface StudioSlot {
  key: string;
  kind: "hero" | "lifestyle" | "product" | "variant" | "swatch" | "icon" | "logo" | "thumb";
  ratio: string;
  screen: "intro" | "question" | "results";
  screenLabel: string;
  label: string;
  optional: boolean;
  sizePx?: number;
  autoSource?: string;
  url: string | null;
  source: StudioSlotSource;
  sourceLabel: string;
}

/** A slot the merchant still has to fill: nothing resolved and the widget
 * cannot pick it itself. Optional slots never gate anything. */
export function isSlotUnresolved(slot: Pick<StudioSlot, "url" | "source">): boolean {
  return slot.url === null && slot.source !== "auto";
}

export interface StudioLibraryStatus {
  status: "pending" | "building" | "ready" | "failed" | null;
  error: string | null;
  imageCount: number;
  indexedAt: string | null;
}

export type StudioColorKey =
  | "quiz_accent_color"
  | "quiz_ink_color"
  | "quiz_card_bg_color"
  | "quiz_line_color"
  | "quiz_cta_color";

export const STUDIO_COLOR_KEYS: StudioColorKey[] = [
  "quiz_accent_color",
  "quiz_ink_color",
  "quiz_card_bg_color",
  "quiz_line_color",
  "quiz_cta_color",
];

export interface StudioColorSource {
  /** The value the quiz actually renders with right now. */
  value: string;
  source: "theme" | "preset" | "merchant";
  /** What the field returns to when a merchant override is cleared. */
  fallback: { value: string; source: "theme" | "preset" };
}
