// Glamnetic "Find My Match UI v2" flow change (2026-10-12, Charles):
//   1. Drop the "Glue or no glue?" (application) question. Its axis goes
//      too; the show-only-when conditions on Coffin / Squoval that pointed
//      at it are cleared (pruneRules), so every shopper sees all shapes.
//      The AI guidance's "otherwise: glue sets only" rule then applies to
//      everyone, so Quick Press sets stop being recommended, as Lisa asked.
//   2. Ask Length of everyone (it was gated to vibe = Soft & Sweet).
//
// Runs the SAME path as a Studio edit (appliers + saveLiveQuizConfig under
// the per-shop save lock) and forces a labeled version snapshot first, so
// the change is one click to restore from Studio → Live → version history.
//
//   npx tsx --env-file=.env scripts/glamnetic-drop-application.mts          # dry run
//   npx tsx --env-file=.env scripts/glamnetic-drop-application.mts --apply
import { supabase } from "../app/lib/supabase.server";
import { captureLiveConfig, saveLiveQuizConfig, type QuizDraft } from "../app/lib/quiz-draft.server";
import { APPLIERS, type DraftShape } from "../app/lib/quiz-copilot-tools.server";
import { loadCatalogForShop } from "../app/lib/quiz-generator.server";
import { withShopSaveLock } from "../app/lib/shop-save-lock.server";

const DOMAIN = "glamrco.myshopify.com";
const apply = process.argv.includes("--apply");

const shop = await supabase.from("shops").select("id").eq("shop_domain", DOMAIN).single();
if (shop.error || !shop.data) throw new Error(`shop lookup: ${shop.error?.message}`);
const shopId = shop.data.id as string;

const result = await withShopSaveLock(shopId, async () => {
  const live = await captureLiveConfig(shopId);
  const catalog = await loadCatalogForShop(shopId);
  const order = live.flow.questions.map((q) => q.axisKey);
  console.log(`live: ${order.join(" → ")} (${live.flow.rules.length} rules)`);
  if (!order.includes("application")) return { ok: true as const, note: "application question already gone" };

  const removed = APPLIERS.remove_question(live as DraftShape, { axisKey: "application", removeAxis: true, pruneRules: true }, catalog);
  if (!removed.ok) return { ok: false as const, error: removed.error };
  console.log(removed.summary?.description);
  let draft = removed.draft as QuizDraft;

  const length = draft.flow.questions.find((q) => q.axisKey === "length");
  if (length?.showIf) {
    const opened = APPLIERS.update_question(draft as DraftShape, { axisKey: "length", patch: { showIf: null } }, catalog);
    if (!opened.ok) return { ok: false as const, error: opened.error };
    console.log(`Length: removed "only when ${length.showIf.axis_key} = ${length.showIf.axis_value}"`);
    draft = opened.draft as QuizDraft;
  }

  const shape = draft.flow.questions.find((q) => q.axisKey === "shape");
  console.log(`shape options now always shown: ${(shape?.options ?? []).filter((o) => !o.showIf).map((o) => o.label).join(", ")}`);
  console.log(`after: ${draft.flow.questions.map((q) => q.axisKey).join(" → ")}`);
  if (!apply) return { ok: true as const, note: "DRY RUN: nothing written (pass --apply)" };

  const saved = await saveLiveQuizConfig(shopId, draft, {
    preWriteConfig: live,
    snapshotLabel: "before dropping Glue or no glue",
    forceSnapshot: true,
  });
  if (!saved.ok) return { ok: false as const, error: saved.error ?? "save failed" };
  return { ok: true as const, note: "saved; snapshot 'before dropping Glue or no glue' is in version history" };
});

console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
