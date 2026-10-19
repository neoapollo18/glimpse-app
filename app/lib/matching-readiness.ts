// Does the quiz match shoppers on anything beyond the generic fallback?
// Mirrors computeQuizRecommendations (quiz-recommend.server.ts), which
// personalises results from any of:
//   - the columnar engine (recommendation_tuning.columnar.enabled)
//   - matrix rules (recommendation_rules)
//   - ai / hybrid mode (the ranker reads the answers, guidance optional)
//   - active answer sentences from Check matches (quiz_answer_rules that
//     lean, prefer or narrow; "no preference" rows change nothing)
// Store-wide always/never rules and priority products apply to every
// shopper alike, so on their own they are still generic results.
//
// Pure: shared by the Studio loader, the publish readiness endpoint, the
// set-live gate and the client.

export type MatchingSource = "columnar" | "rules" | "ai" | "answers";

export interface MatchingReadiness {
  ready: boolean;
  sources: MatchingSource[];
}

export function matchingReadiness(input: {
  ruleCount: number;
  mode?: string | null;
  columnar?: boolean;
  answerRules?: number;
}): MatchingReadiness {
  const sources: MatchingSource[] = [];
  if (input.columnar) sources.push("columnar");
  if (input.ruleCount > 0) sources.push("rules");
  if (input.mode === "ai" || input.mode === "hybrid") sources.push("ai");
  if ((input.answerRules ?? 0) > 0) sources.push("answers");
  return { ready: sources.length > 0, sources };
}
