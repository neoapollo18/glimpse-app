// Capture + patch + validate ONLY (no save) — does the studio save path
// REFUSE this shop's live config?
import { supabase } from "../app/lib/supabase.server";
import { captureLiveConfig } from "../app/lib/quiz-draft.server";
import { applyUpdateCopy } from "../app/lib/quiz-copilot-tools.server";

const DOMAIN = process.argv[2]!;
const shop = await supabase.from("shops").select("id").eq("shop_domain", DOMAIN).single();
if (shop.error) throw new Error(shop.error.message);
const live = await captureLiveConfig(shop.data.id);
console.log(DOMAIN, "questions", live.flow.questions.length, "rules", live.flow.rules.length);
const applied = applyUpdateCopy(live as any, { fields: { quiz_eyebrow: (live.settings as any).quiz_eyebrow ?? "Find my fit" } }, []);
console.log("validate-via-apply:", applied.ok ? "OK — saves would succeed" : `REFUSED: ${applied.error}`);
