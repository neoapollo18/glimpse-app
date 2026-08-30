// Client-safe pieces of the recommendation-logic guidance flow (no .server
// suffix on purpose: the logic page's component renders framing prompts and
// keys note state by GENERAL_GUIDANCE_KEY in the browser). Pure constants
// and string builders only — no Supabase, no env.

/**
 * Reserved axis_key for store-wide guidance in quiz_question_guidance
 * (migration 059). Derived question keys can never collide with it:
 * slugifyKey never emits a leading underscore.
 */
export const GENERAL_GUIDANCE_KEY = "__general";

/**
 * The guiding question shown above each merchant-notes box. Computed at
 * render time from the current question — never stored, so it can't go
 * stale after a rename.
 */
// Display caps: the framing prompt inlines answer labels, and a question
// with dozens of long options would bury the instruction in a wall of text.
const FRAMING_MAX_LABELS = 8;
const FRAMING_MAX_LABEL_LEN = 40;

function framingLabels(optionLabels: string[]): string {
  const shown = optionLabels
    .slice(0, FRAMING_MAX_LABELS)
    .map((l) => (l.length > FRAMING_MAX_LABEL_LEN ? `${l.slice(0, FRAMING_MAX_LABEL_LEN - 1)}…` : l));
  const rest = optionLabels.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : shown.join(", ");
}

export function framingPrompt(question: {
  prompt: string;
  multiSelect: boolean;
  optionLabels: string[];
}): string {
  const labels = framingLabels(question.optionLabels);
  if (question.multiSelect) {
    return (
      `Shoppers can pick several answers to "${question.prompt}". For each one (${labels}), ` +
      `describe the products, collections, or product traits that fit. If combinations matter ` +
      `(e.g. picking two together), say how to combine them.`
    );
  }
  return (
    `For each answer to "${question.prompt}" (${labels}), tell us which products, ` +
    `collections, or product traits fit best.`
  );
}

export function photoFramingPrompt(axisLabel: string): string {
  return (
    `"${axisLabel}" is detected from the shopper's photo. Tell us how it should steer ` +
    `recommendations (e.g. which products suit each detected value), or leave this blank ` +
    `to let the AI rely on color matching.`
  );
}

export const GENERAL_FRAMING_PROMPT =
  "Anything that applies across all answers: bestsellers to feature, products to avoid pushing, " +
  "how many results to show and in what shape, brand priorities.";
