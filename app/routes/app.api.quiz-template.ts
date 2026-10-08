// Template switching (v3, docs/overhaul/V3-CONTRACTS.md §7).
//
// POST intent=set: assign quiz_template (t1-t5) for the session's shop.
// Each template owns its visual design, so there is no separate Look
// (removed 2026-10-01; the quiz_look column is no longer written or read).
// Used by the Templates gallery and onboarding. Emits template_switched.
// Image-gate eligibility is advisory: a pick is saved and a `warning` is
// returned when the store's images look thin for that template.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import {
  saveChatAssistantConfig,
  getChatAssistantConfig,
  findShopByDomain,
} from "../lib/supabase.server";
import { getBrandProfile, templateSignalsFromProfile } from "../lib/brand-profile.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";
import { TEMPLATES, isTemplateEligible, isTemplateId, type TemplateId } from "../lib/quiz-templates";
import { snapshotBeforeTemplateSwitch } from "../lib/quiz-draft.server";
import { withShopSaveLock } from "../lib/shop-save-lock.server";

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
  const template = templateRaw === null || templateRaw === "" ? null : String(templateRaw);
  // v3 event delta: where the switch came from.
  const sourceRaw = String(form.get("source") ?? "");
  const source = ["gallery", "style_panel", "chat", "onboarding"].includes(sourceRaw) ? sourceRaw : "style_panel";

  if (template === null) {
    return json({ ok: false, error: "Nothing to set" }, { status: 400 });
  }
  // "classic" = back to the classic layout (quiz_template NULL): the
  // gallery's Undo after a classic quiz's first template, and the way back
  // for any shop. Only quiz_template changes; every classic styling column
  // was never touched by the template, so the classic quiz returns exactly.
  const toClassic = template === "classic";
  if (!toClassic && !isTemplateId(template)) {
    return json({ ok: false, error: "Unknown template" }, { status: 400 });
  }
  const target: TemplateId | null = toClassic ? null : (template as TemplateId);

  // Image gates are advisory (2026-10-07): a merchant's explicit pick is
  // honored. The store-level image signals are guesses that often go stale,
  // and blocking here (422) left merchants unable to switch at all; the
  // gallery shows the reason as a warning instead and every template
  // renders without imagery.
  let warning: string | null = null;
  if (target !== null && target !== "t5") {
    const profile = await getBrandProfile(session.shop).catch(() => null);
    if (profile && !isTemplateEligible(target, templateSignalsFromProfile(profile))) {
      warning = TEMPLATES[target].ineligibleReason || null;
    }
  }

  const before = await getChatAssistantConfig(session.shop);
  if (target === before.quiz_template) return json({ ok: true, template: target });
  const shopRow = await findShopByDomain(session.shop);
  if (!shopRow) return json({ ok: false, error: "Shop not found" }, { status: 404 });
  // Classic quizzes may adopt a template (2026-10-05). The 09-25 incident
  // guard that refused this is no longer needed: since migration 081 an
  // assigned template never reaches shoppers until the merchant publishes
  // it (template_live_at), so picking one only changes the Studio. A
  // restore point is taken first (below), and "classic" switches back.

  // Version history: snapshot the quiz as it was BEFORE the switch, so the
  // previous template is one Restore away. Under the shop save lock so a
  // concurrent Studio save can't interleave between snapshot and write; the
  // template is re-read under the lock so overlapping switches (two tabs, a
  // retry) neither snapshot twice nor label/log the wrong "from". A failed
  // snapshot aborts the switch (same rule as every other live write: no
  // edit without rollback insurance).
  const result = await withShopSaveLock(shopRow.id, async () => {
    const current = await getChatAssistantConfig(session.shop);
    if (current.quiz_template === target) return { ok: true as const, from: null, changed: false };
    const fromName = isTemplateId(current.quiz_template) ? TEMPLATES[current.quiz_template].name : "classic";
    const toName = target ? TEMPLATES[target].name : "classic";
    const snap = await snapshotBeforeTemplateSwitch(shopRow.id, fromName, toName);
    if (!snap.ok) return { ok: false as const, error: `Couldn't save a restore point: ${snap.error}` };
    await saveChatAssistantConfig(session.shop, { quiz_template: target });
    return { ok: true as const, from: current.quiz_template, changed: true };
  });
  if (!result.ok) return json({ ok: false, error: result.error }, { status: 500 });

  if (result.changed) {
    trackOverhaulEvent(session.shop, "template_switched", {
      from: result.from,
      to: target,
      source,
    });
  }

  return json({ ok: true, template: target, warning });
};
