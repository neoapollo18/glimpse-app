// The ONE definition of "can a shopper see this option / question".
// With save-to-live editing, mid-edit incomplete rows exist in the live
// tables; the storefront read path (getRecommendationFlow) filters with
// these predicates, and the studio (draft-problems checklist, Live step
// "currently showing" count) uses the SAME predicates so what the studio
// reports as hidden is exactly what doesn't serve. No .server suffix on
// purpose: imported by both server code and studio components.

/** Visible when it has a text label, an image, or a color swatch. */
export function isOptionVisible(opt: {
  label?: string | null;
  imageUrl?: string | null;
  displayMeta?: { swatch?: string | null } | null;
}): boolean {
  return (
    String(opt.label ?? "").trim() !== "" ||
    Boolean(opt.imageUrl) ||
    Boolean(opt.displayMeta?.swatch)
  );
}

/** Servable when the prompt is non-blank and at least one option shows. */
export function isQuestionServable(q: {
  prompt?: string | null;
  options: Array<{
    label?: string | null;
    imageUrl?: string | null;
    displayMeta?: { swatch?: string | null } | null;
  }>;
}): boolean {
  return String(q.prompt ?? "").trim() !== "" && q.options.some(isOptionVisible);
}
