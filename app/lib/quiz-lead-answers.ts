// Lead answers allowlist (quiz-lead, migration 067). The lead endpoint is
// public, and the answers it stores ride into the merchant's Klaviyo
// events as property names and values. The widget only ever sends the
// shop's own question prompts and answer labels (leadAnswersPayload in
// gleame-quiz.js), so a pair that isn't made of those is dropped before it
// is stored or forwarded. Pure module: the route passes the live flow and
// the merchant's "Open to anything" text.

// Structural slice of RecommendationFlow (getRecommendationFlow), so this
// stays importable without the server client.
type LeadFlow = {
  questions: Array<{
    prompt: string;
    options: Array<{ label: string | null; axisValue: string }>;
  }>;
  photoAxisDetails: Array<{
    label: string;
    values: Array<{ value: string; label: string | null }>;
  }>;
};

// The widget's built-in fallback when a select-all answer has no option
// of its own and no merchant override (answerLabels in gleame-quiz.js).
const WIDGET_OPEN_TO_ANYTHING = "Open to anything";
// Multi-select answers are the picked labels joined with this.
const SEPARATOR = ", ";

export type LeadAnswerAllowlist = Map<string, { labels: string[]; maxLength: number }>;

/**
 * Question text -> the labels its answer can be built from: option labels
 * and axis values (answerLabels falls back to the raw value), the "Open to
 * anything" text, and for the shade axis its value labels and values.
 */
export function leadAnswerAllowlist(
  flow: LeadFlow | null | undefined,
  openToAnything: string | null | undefined,
): LeadAnswerAllowlist {
  const out: LeadAnswerAllowlist = new Map();
  const add = (question: string, labels: Array<string | null | undefined>, picks: number) => {
    if (typeof question !== "string" || !question) return;
    // answerLabels joins a null label as empty text.
    const texts = labels.map((l) => (typeof l === "string" ? l : ""));
    const prev = out.get(question);
    const all = [...new Set([...(prev?.labels ?? []), ...texts])].sort((a, b) => b.length - a.length);
    // Longest legit answer: one label per distinct pick, plus separators.
    const longest = all.length > 0 ? all[0].length : 0;
    const maxLength = Math.max(prev?.maxLength ?? 0, Math.max(1, picks) * (longest + SEPARATOR.length));
    out.set(question, { labels: all, maxLength });
  };
  const anyTexts = [WIDGET_OPEN_TO_ANYTHING];
  if (typeof openToAnything === "string" && openToAnything) anyTexts.push(openToAnything);
  for (const q of flow?.questions ?? []) {
    const options = q.options ?? [];
    add(q.prompt, [...options.map((o) => o.label), ...options.map((o) => o.axisValue), ...anyTexts], options.length);
  }
  for (const axis of flow?.photoAxisDetails ?? []) {
    const values = axis.values ?? [];
    add(axis.label, [...values.map((v) => v.label), ...values.map((v) => v.value)], 1);
  }
  return out;
}

/** True when the pair is one of the shop's questions with an answer made of its labels. */
export function isAllowedLeadAnswer(allow: LeadAnswerAllowlist, question: string, answer: string): boolean {
  const entry = allow.get(question);
  if (!entry || answer.length > entry.maxLength) return false;
  // A label can itself contain ", " ("Dry, flaky"), so walk every way the
  // labels can tile the answer instead of splitting on the separator.
  const pending = [0];
  const seen = new Set<number>([0]);
  while (pending.length > 0) {
    const at = pending.pop()!;
    for (const label of entry.labels) {
      if (!answer.startsWith(label, at)) continue;
      const end = at + label.length;
      if (end === answer.length) return true;
      const next = end + SEPARATOR.length;
      if (answer.startsWith(SEPARATOR, end) && !seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return false;
}
