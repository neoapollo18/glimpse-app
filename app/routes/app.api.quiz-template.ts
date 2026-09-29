// Template / Look switching (v3, docs/overhaul/V3-CONTRACTS.md §7).
//
// POST intent=set: assign quiz_template (t1-t5) and/or quiz_look
// (editorial|minimal|bold) for the session's shop. Used by the Templates
// gallery and the Studio Style panel. Emits template_switched /
// look_switched. Eligibility is enforced here too — an ineligible template
// must be unreachable, not just visually disabled.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import {
  saveChatAssistantConfig,
  getChatAssistantConfig,
  findShopByDomain,
  getRecommendationCounts,
} from "../lib/supabase.server";
import { getBrandProfile, templateSignalsFromProfile } from "../lib/brand-profile.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";
import { TEMPLATES, isLookId, isTemplateEligible, isTemplateId } from "../lib/quiz-templates";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Resource routes bypass app.tsx's billing gate.
  if (await shopNeedsBilling(session.shop, session.accessToken ?? "")) {
    return json({ ok: false, error: "Your Gleame subscription isn't active. Visit Billing to continue." }, { status: 402 });
  }
  const form = await request.formData();
  if (form.get("intent") !== "set") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  const templateRaw = form.get("template");
  const lookRaw = form.get("look");
  const template = templateRaw === null || templateRaw === "" ? null : String(templateRaw);
  const look = lookRaw === null || lookRaw === "" ? null : String(lookRaw);
  // v3 event delta: where the switch came from.
  const sourceRaw = String(form.get("source") ?? "");
  const source = ["gallery", "style_panel", "chat", "onboarding"].includes(sourceRaw) ? sourceRaw : "style_panel";

  if (template === null && look === null) {
    return json({ ok: false, error: "Nothing to set" }, { status: 400 });
  }
  if (template !== null && !isTemplateId(template)) {
    return json({ ok: false, error: "Unknown template" }, { status: 400 });
  }
  if (look !== null && !isLookId(look)) {
    return json({ ok: false, error: "Unknown look" }, { status: 400 });
  }

  if (template !== null && template !== "t5") {
    const profile = await getBrandProfile(session.shop).catch(() => null);
    if (profile) {
      const signals = templateSignalsFromProfile(profile);
      if (!isTemplateEligible(template, signals)) {
        return json(
          { ok: false, error: TEMPLATES[template].ineligibleReason || "Not eligible" },
          { status: 422 }
        );
      }
    }
  }

  const before = await getChatAssistantConfig(session.shop);
  // Legacy guard (2026-09-25 incident): a shop whose quiz has never had a
  // template (quiz_template NULL) and already has questions is a live
  // classic quiz. Assigning a template to it must be a deliberate,
  // separate step - never a side effect of a stray POST. Onboarding is the
  // one caller allowed to set the first template (the shop has no quiz yet).
  if (template !== null && before.quiz_template === null && source !== "onboarding") {
    const shop = await findShopByDomain(session.shop);
    const counts = shop ? await getRecommendationCounts(shop.id).catch(() => null) : null;
    if ((counts?.questions ?? 0) > 0) {
      return json(
        { ok: false, error: "This quiz uses the classic layout. Templates can't be switched on for it from here." },
        { status: 409 }
      );
    }
  }
  await saveChatAssistantConfig(session.shop, {
    ...(template !== null ? { quiz_template: template } : {}),
    ...(look !== null ? { quiz_look: look } : {}),
  });

  if (template !== null && template !== before.quiz_template) {
    trackOverhaulEvent(session.shop, "template_switched", {
      from: before.quiz_template,
      to: template,
      look: look ?? before.quiz_look,
      source,
    });
  }
  if (look !== null && look !== before.quiz_look) {
    trackOverhaulEvent(session.shop, "look_switched", { from: before.quiz_look, to: look, source });
  }

  return json({ ok: true, template: template ?? before.quiz_template, look: look ?? before.quiz_look });
};
