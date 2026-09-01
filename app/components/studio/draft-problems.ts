// Client-side draft validity: powers the tree warning dots, the top-bar
// "Needs attention" badge, and the Publish checklist. Mirrors the blocking
// subset of validateGeneratedConfig (the server stays the authority at
// publish; this exists so problems surface while editing, with a slide to
// jump to).

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
