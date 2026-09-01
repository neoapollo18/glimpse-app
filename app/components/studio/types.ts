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
