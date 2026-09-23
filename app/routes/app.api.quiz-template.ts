// Template / preset switching (Overhaul Parts 2-3).
//
// POST intent=set: assign quiz_template (t1-t5) and/or quiz_preset for
// the session's shop. Used by the Reveal style bar and the Studio Style
// panel. Emits template_switched. Eligibility is enforced here too — an
// ineligible template must be unreachable, not just visually disabled.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { saveChatAssistantConfig, getChatAssistantConfig } from "../lib/supabase.server";
import { getBrandProfile } from "../lib/brand-profile.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";
import {
  TEMPLATE_IDS,
  TEMPLATES,
  findPreset,
  isTemplateEligible,
  type TemplateId,
  type TemplateSignals,
} from "../lib/quiz-templates";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "set") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  const template = String(form.get("template") ?? "");
  const presetRaw = form.get("preset");
  const preset = presetRaw === null ? undefined : String(presetRaw) || null;
  // v2 event delta (spec Part 8): where the switch came from.
  const sourceRaw = String(form.get("source") ?? "");
  const source = ["overlay", "style_panel", "chat"].includes(sourceRaw) ? sourceRaw : "style_panel";

  if (!TEMPLATE_IDS.includes(template as TemplateId)) {
    return json({ ok: false, error: "Unknown template" }, { status: 400 });
  }
  if (preset && !findPreset(preset)) {
    return json({ ok: false, error: "Unknown preset" }, { status: 400 });
  }

  const profile = await getBrandProfile(session.shop).catch(() => null);
  if (profile) {
    const signals: TemplateSignals = {
      serifHeading: false,
      roundedHeading: false,
      avgSaturation: profile.homepage.avgSaturation,
      imageryDensity: profile.homepage.imageryDensity,
      lifestyleImageCount:
        profile.homepage.lifestyleImageCount + (profile.brand.coverImageUrl ? 1 : 0),
      imagePerAnswerCoverage: profile.catalog.imageCoverage,
      buttonRadius: profile.tokens.radiusButton,
      category: profile.category,
    };
    if (!isTemplateEligible(template as TemplateId, signals)) {
      return json(
        { ok: false, error: TEMPLATES[template as TemplateId].ineligibleReason || "Not eligible" },
        { status: 422 }
      );
    }
  }

  const before = await getChatAssistantConfig(session.shop);
  await saveChatAssistantConfig(session.shop, {
    quiz_template: template,
    ...(preset !== undefined ? { quiz_preset: preset } : {}),
  } as any);

  trackOverhaulEvent(session.shop, "template_switched", {
    from: before.quiz_template,
    to: template,
    preset: preset ?? null,
    source,
  });

  return json({ ok: true, template, preset: preset ?? before.quiz_preset });
};
