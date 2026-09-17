// Client-side config validity: powers the tree warning dots, the top-bar
// "Hidden from shoppers" badge, and the Live step checklist. With
// save-to-live editing these never block a save — the storefront read path
// (getRecommendationFlow) filters incomplete questions/options out of what
// shoppers see, and this list tells the merchant what's hidden and why,
// with a slide to jump to. Keep the blank-option visibility rule here in
// sync with that serve-time filter.

import { isOptionVisible } from "../../lib/option-visibility";
import type { StudioFlow } from "./types";

export interface DraftProblem {
  slideId: string; // "q:<axisKey>"
  axisKey: string;
  message: string;
}

export function draftProblems(flow: StudioFlow): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const askedSoFar = new Set<string>();

  for (const q of flow.questions) {
    const slideId = `q:${q.axisKey}`;
    const push = (message: string) => problems.push({ slideId, axisKey: q.axisKey, message });

    if (!q.prompt.trim()) push("Question text is empty");
    const labeled = q.options.filter((o) => o.label.trim() !== "");
    if (labeled.length < 2) push("Needs at least 2 answers");
    // Leftover blank answers (e.g. "+ Add answer" never filled in) would
    // render as empty buttons; the storefront filter hides them (shared
    // rule: option-visibility.ts). Skipped below the 2-labeled floor,
    // which is already flagged on its own.
    const blank = q.options.filter(
      (o) => !isOptionVisible(o as Parameters<typeof isOptionVisible>[0]),
    ).length;
    if (labeled.length >= 2 && blank > 0) {
      push(
        blank === 1
          ? "An answer is blank. Fill it in or delete it"
          : `${blank} answers are blank. Fill them in or delete them`,
      );
    }

    if (q.showIf) {
      const source = q.showIf.axis_key;
      const sourceQ = flow.questions.find((x) => x.axisKey === source);
      if (!askedSoFar.has(source)) {
        push(sourceQ ? 'The "only show when" condition points at a later question' : 'The "only show when" condition points at a question that no longer exists');
      } else if (!sourceQ?.options.some((o) => o.axisValueValue === q.showIf!.axis_value)) {
        push('The "only show when" condition points at an answer that no longer exists');
      }
    }
    if (
      q.maxSelections != null &&
      !(Number.isInteger(q.maxSelections) && q.maxSelections > 0)
    ) {
      push("Max picks must be a whole number above zero");
    }

    askedSoFar.add(q.axisKey);
  }
  return problems;
}

export function problemsForSlide(problems: DraftProblem[], slideId: string): DraftProblem[] {
  return problems.filter((p) => p.slideId === slideId);
}
