// Manual setup: skip auto-generate (onboarding scope / build-failure screens).
//
// The Studio has no blank state (a shop with no quiz is routed back to
// onboarding), so "set it up myself" seeds a one-question starter quiz the
// merchant edits from there: "What are you shopping for?" with answers taken
// from the shop's own product types (generic answers when the catalog has
// fewer than two), AI matching (no rules needed to recommend), surface left
// OFF. Idempotent: a shop that already has questions just goes to the Studio.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { findShopByDomain } from "../lib/supabase.server";
import { captureLiveConfig, saveLiveQuizConfig, type QuizDraft } from "../lib/quiz-draft.server";
import { withShopSaveLock } from "../lib/shop-save-lock.server";
import { loadCatalogForShop } from "../lib/quiz-generator.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";
import { getBrandProfile, servedTemplateFor } from "../lib/brand-profile.server";
import { isTemplateId, type TemplateId } from "../lib/quiz-templates";

const AXIS_KEY = "shopping_for";
const FALLBACK_ANSWERS = ["Something for every day", "Something special", "A gift"];

function slug(label: string, taken: Set<string>): string {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!/^[a-z_]/.test(base)) base = `opt_${base}`;
  if (!base || base === "opt_") base = "option";
  let value = base;
  for (let n = 2; taken.has(value); n++) value = `${base}_${n}`;
  taken.add(value);
  return value;
}

/** Up to four most common product types, in catalog frequency order. */
function answersFromCatalog(types: Array<string | null | undefined>): string[] {
  const counts = new Map<string, number>();
  for (const raw of types) {
    const t = (raw ?? "").trim();
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
  return top.length >= 2 ? top : FALLBACK_ANSWERS;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (await shopNeedsBilling(session.shop, session.accessToken ?? "")) {
    return json({ ok: false, error: "Your Gleame subscription isn't active. Visit Billing to continue." }, { status: 402 });
  }
  const shop = await findShopByDomain(session.shop);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const catalog = await loadCatalogForShop(shop.id).catch(() => []);
  const answers = answersFromCatalog(catalog.map((p) => p.productType));
  const taken = new Set<string>();
  const values = answers.map((label, i) => ({ value: slug(label, taken), label, position: i }));

  // The merchant's pick on the scope screen (persisted on click), else the
  // brand profile's suggestion, else Clean (t5, always eligible). Degraded
  // through servedTemplateFor so an ineligible pick never lands.
  const profile = await getBrandProfile(session.shop).catch(() => null);

  const result = await withShopSaveLock(shop.id, async () => {
    const current = await captureLiveConfig(shop.id);
    // Anything already there (a finished generation, an earlier manual
    // start, another tab) wins: never overwrite a quiz from here.
    if (current.flow.questions.length > 0) return { ok: true as const, seeded: false };
    const picked = current.settings.quiz_template;
    const suggested = profile?.templateAssignment?.template;
    const template: TemplateId =
      servedTemplateFor(isTemplateId(picked) ? picked : isTemplateId(suggested) ? suggested : "t5", profile) ?? "t5";
    const starter: QuizDraft = {
      flow: {
        axes: [
          {
            key: AXIS_KEY,
            label: "Shopping for",
            source: "user_question",
            position: 0,
            values: values.map((v) => ({ ...v, swatchColor: null })),
          },
        ],
        questions: [
          {
            axisKey: AXIS_KEY,
            prompt: "What are you shopping for?",
            helperText: null,
            multiSelect: false,
            maxSelections: null,
            screenGroup: null,
            showIf: null,
            optionStyle: null,
            options: values.map((v) => ({
              label: v.label,
              axisValueValue: v.value,
              botResponse: null,
              reasonText: null,
              imageUrl: null,
              showIf: null,
              selectAll: false,
              displayMeta: null,
              position: v.position,
            })),
          },
        ],
        rules: [],
      },
      // AI matching ranks from the catalog without rules, so the starter
      // recommends something real the moment it's turned on. A template is
      // always assigned: a template-less quiz with questions is "classic",
      // and classic quizzes can't adopt a template from the Studio later.
      settings: { ...current.settings, recommendation_mode: "ai", quiz_template: template },
    };
    const saved = await saveLiveQuizConfig(shop.id, starter, {
      snapshotLabel: "before manual setup",
      preWriteConfig: current,
    });
    return saved.ok ? { ok: true as const, seeded: true } : { ok: false as const, error: saved.error };
  });

  if (!result.ok) {
    return json({ ok: false, error: result.error ?? "Couldn't start your quiz" }, { status: 500 });
  }
  if (result.seeded) trackOverhaulEvent(session.shop, "studio_opened", { source: "manual_setup" });
  return json({ ok: true, seeded: result.seeded });
};
