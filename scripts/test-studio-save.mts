// One-shot studio-save-path reproduction (2026-09-21 publish-bug hunt).
// Runs the EXACT server flow a studio autosave flush runs, against the
// TEST shop (glimpsetesting), and prints the failure if any.
import { supabase } from "../app/lib/supabase.server";
import { captureLiveConfig, saveLiveQuizConfig, setQuizSurfaceEnabled } from "../app/lib/quiz-draft.server";
import { applyUpdateCopy } from "../app/lib/quiz-copilot-tools.server";

const DOMAIN = process.argv[2] ?? "glimpsetesting.myshopify.com";

const shop = await supabase.from("shops").select("id").eq("shop_domain", DOMAIN).single();
if (shop.error) throw new Error(shop.error.message);
console.log("shop:", DOMAIN, shop.data.id);

const live = await captureLiveConfig(shop.data.id);
console.log("captured: questions", live.flow.questions.length, "rules", live.flow.rules.length, "axes", live.flow.axes.length);

const applied = applyUpdateCopy(live as any, { fields: { quiz_eyebrow: "Find my fit" } }, []);
console.log("applyUpdateCopy:", applied.ok ? "ok" : `FAIL: ${applied.error}`);
if (!applied.ok) process.exit(1);

const saved = await saveLiveQuizConfig(shop.data.id, applied.draft as any, {
  snapshotLabel: "publish-bug repro",
  preWriteConfig: live,
});
console.log("saveLiveQuizConfig:", JSON.stringify(saved));

const toggled = await setQuizSurfaceEnabled(shop.data.id, true);
console.log("setQuizSurfaceEnabled(true):", JSON.stringify(toggled));
