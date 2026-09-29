/**
 * Studio arrival banner (V3-SPEC 6.5, V3-CONTRACTS §7/§8).
 *
 * The banner is assembled ONLY from the generation report the generator
 * wrote (`chat_assistant_config.quiz_generation_report`), never from copy
 * or from heuristics over the resolved tokens. Every chip appears only
 * when its value is real; if nothing qualifies (or there is no report at
 * all) the banner falls back to a claim-free line.
 *
 * Client-safe: no server imports. Unit-tested per chip with the value
 * absent (app/lib/__tests__/arrival-banner.test.ts).
 */

import { LOOKS, TEMPLATES, isLookId, isTemplateId, type LookId, type TemplateId } from "./quiz-templates";
// Type-only: erased at compile time, so this module stays client-safe.
// The generator owns the shape and the parser (parseGenerationReport);
// the studio loader parses server-side and hands the result here.
import type { GenerationReport } from "./generation-report.server";

export type { GenerationReport };

export interface ArrivalBanner {
  lead: string;
  chips: string[];
  fallback: boolean;
}

export const FALLBACK_LEAD = "Built from your catalog.";
export const FALLBACK_HINT = "Tap Style to match your brand.";

/** Minimum grounded questions before the banner may claim a product count. */
const MIN_GROUNDED_QUESTIONS = 4;

/**
 * Spec 6.5 truth rules, one chip per rule:
 *   lead   `Built from your {N} products.` needs groundedQuestions >= 4 AND
 *          productCount >= groundedQuestions.
 *   font   `{font} headings` needs a detected name with high|medium confidence.
 *   palette`{paletteWord} palette` needs >= 2 extracted colors and a word.
 *   template `{Template} template` reads the ASSIGNED template (argument).
 *   look   `{Look} look` reads the assigned look; only meaningful alongside
 *          a template (legacy shops have no Look applied).
 * No report → nothing is claimed.
 */
export function arrivalBannerChips(
  report: GenerationReport | null,
  template: TemplateId | string | null,
  look: LookId | string | null
): ArrivalBanner {
  if (!report) return { lead: FALLBACK_LEAD, chips: [], fallback: true };

  const chips: string[] = [];
  const fontName = report.headingFont?.name ?? null;
  const fontConfidence = report.headingFont?.confidence ?? null;
  if (fontName && (fontConfidence === "high" || fontConfidence === "medium")) {
    chips.push(`${fontName} headings`);
  }
  if ((report.colors?.length ?? 0) >= 2 && report.paletteWord) {
    chips.push(`${report.paletteWord} palette`);
  }
  if (isTemplateId(template)) {
    chips.push(`${TEMPLATES[template].name} template`);
    if (isLookId(look)) chips.push(`${LOOKS[look].name} look`);
  }

  const grounded = report.groundedQuestions ?? 0;
  const products = report.productCount ?? 0;
  const leadQualifies = grounded >= MIN_GROUNDED_QUESTIONS && products >= grounded;
  if (!leadQualifies && chips.length === 0) {
    return { lead: FALLBACK_LEAD, chips: [], fallback: true };
  }
  return {
    lead: leadQualifies ? `Built from your ${products} products.` : FALLBACK_LEAD,
    chips,
    fallback: false,
  };
}
