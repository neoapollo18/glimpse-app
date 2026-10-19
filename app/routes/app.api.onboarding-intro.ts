// Welcome intro answers (routes/app.onboarding.welcome.tsx,
// lib/onboarding-intro.server.ts): a step reached, the goals picked, and
// the finish (which path, or a skip). "complete" is awaited by the client
// before it leaves, so the next screen never sees an unfinished intro.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { supabase } from "../lib/supabase.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";
import { INTRO_STEP_COUNT, cleanGoals, completeIntro, saveIntroGoals, type IntroGoal, type IntroPath } from "../lib/onboarding-intro.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  let goals: IntroGoal[] = [];
  try {
    goals = cleanGoals(JSON.parse(String(form.get("goals") ?? "[]")));
  } catch {
    goals = [];
  }
  const step = Math.max(0, Math.min(INTRO_STEP_COUNT - 1, Math.floor(Number(form.get("step")) || 0)));

  if (intent === "step") {
    trackOverhaulEvent(session.shop, "onboarding_intro_step", { step });
    return json({ ok: true });
  }
  if (intent === "goals") {
    return json({ ok: await saveIntroGoals(session.shop, goals) });
  }
  if (intent === "complete") {
    const raw = String(form.get("path") ?? "");
    const path: IntroPath = raw === "ai" || raw === "expert" ? raw : "skip";
    if (goals.length > 0) await saveIntroGoals(session.shop, goals);
    const shop = await supabase.from("shops").select("id").eq("shop_domain", session.shop).maybeSingle();
    await completeIntro(session.shop, shop.data?.id ?? null, { path, step, goals });
    return json({ ok: true });
  }
  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};
