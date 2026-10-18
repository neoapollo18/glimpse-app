// Glamnetic "Find My Match" v3 sync (2026-10-17, Lisa's Oct 17 changes).
// Brings the live quiz to the approved UI v2 mockups (canvas build spec
// v3.0), writes the columnar engine spec (recommendation_tuning.columnar)
// and the results offers (brief §8). The plan, the apply and the safety
// rules live in glamnetic-v3-sync-plan.ts.
//
// Default is a dry run that prints the diff (live vs target, per question,
// option and field). --apply writes, after (1) a JSON backup of every row
// it will touch in scripts/backups/ (ignored by git) and (2) a forced
// version-history snapshot "Before v3 mockup sync". It then re-reads and
// re-plans: anything left to write, or any field skipped that the dry run
// did not skip, fails the run.
//
//   npx tsx --env-file=.env scripts/glamnetic-v3-sync.mts           # dry run
//   npx tsx --env-file=.env scripts/glamnetic-v3-sync.mts --apply
//
//   --enable-columnar          write the spec with enabled: true (only after
//                              the engine and widget deploy). Without it a
//                              new spec is written disabled, and an enabled
//                              one is never switched off.
//   --force-field=<key>[,...]  overwrite a field edited since Oct 17 (each
//                              SKIPPED line prints its key)
//   --prep-kit=<handle>        put a real prep kit in the "Prep Kit"
//                              cross-sell slot (default: the live Press-On
//                              Nail Remover stays there)
//   --bundle-code=<CODE>       the Shopify code Glamnetic created for the
//                              bundle (this script creates no discount)
//   --csv=<path>               read the pool handles from a CSV export
//                              instead of the Oct 17 snapshot
//                              (scripts/brand-configs/glamnetic-pool-v3-handles.json)
//
// Run steps, in order:
//   1. Deploy the engine package (mapRecommendationTuning keeps columnar,
//      quiz-recommend serves it) and the widget package (the glossy,
//      glazed, velvet and matte Finish nails in OPTION_TEXTURES and the
//      widget, branching), and verify both on the dev store.
//   2. Dry run. Read every SKIPPED line and the Notes, decide each
//      --force-field, and confirm with Lisa: the Prep Kit slot, the bundle
//      code, and the helper copy (the mockups' em dashes are swapped for
//      plain punctuation).
//   3. --apply --enable-columnar in one run (or --apply, then
//      --enable-columnar right after). --apply alone puts the new answers
//      (White, Metallic, Oranges, multi-select Finish) in front of shoppers
//      while the old ai_guidance, which has no rules for them, still ranks.
//   4. Run it while nobody is saving in the Studio. A Studio save mid-run
//      makes the next write miss its row and the run stops; re-run to
//      finish. The re-plan picks up from wherever it stopped, and its
//      snapshot is labeled "Before v3 mockup sync (re-run)".
//
// Rollback, all three steps:
//   1. Studio > Matching > Columnar matching: switch it off FIRST. A
//      version restore keeps a live columnar spec when the snapshot has
//      none (keepLiveColumnar in quiz-draft.server.ts), so restoring alone
//      leaves the engine and branching running against the old questions.
//   2. Studio > Live > version history, the first "Before v3 mockup sync":
//      restores the quiz rows and the other snapshotted settings.
//   3. quiz_offers is a table of its own, outside version history: put
//      cross_sell_max, cross_sell_items and the bundle_discount_* columns
//      back from rows.quiz_offers in the backup JSON.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../app/lib/supabase.server";
import { snapshotLabeled } from "../app/lib/quiz-draft.server";
import { withShopSaveLock } from "../app/lib/shop-save-lock.server";
import {
  CROSS_SELL_HANDLES,
  RERUN_SNAPSHOT_LABEL,
  SHOP_ID,
  SNAPSHOT_LABEL,
  applyPlan,
  formatPlan,
  loadLiveState,
  newSkips,
  parsePoolHandles,
  parsePoolSnapshot,
  planSync,
  type PlanOptions,
} from "./glamnetic-v3-sync-plan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const KNOWN = new Set(["--apply", "--enable-columnar", "--force-field", "--prep-kit", "--bundle-code", "--csv"]);

/** All values of --name=value / --name value. */
function flagValues(name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === name && args[i + 1] && !args[i + 1].startsWith("--")) out.push(args[i + 1]);
    else if (a.startsWith(`${name}=`)) out.push(a.slice(name.length + 1));
  });
  return out;
}
for (const a of args) {
  if (a.startsWith("--") && !KNOWN.has(a.split("=")[0])) {
    console.error(`unknown flag ${a}`);
    process.exit(2);
  }
}

const apply = args.includes("--apply");
const csvPath = flagValues("--csv")[0] ?? null;
const poolPath = csvPath ?? path.join(HERE, "brand-configs", "glamnetic-pool-v3-handles.json");
const poolText = fs.readFileSync(poolPath, "utf8");
const prepKit = flagValues("--prep-kit")[0] ?? null;
// The widget this checkout would deploy, to flag finishes it cannot draw yet.
const widgetCss = fs.readFileSync(path.join(HERE, "..", "extensions", "glimpse-widget", "assets", "gleame-quiz.css"), "utf8");
const opts: PlanOptions = {
  handles: csvPath ? parsePoolHandles(poolText) : parsePoolSnapshot(poolText),
  enableColumnar: args.includes("--enable-columnar"),
  forceFields: flagValues("--force-field")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean),
  prepKitHandle: prepKit,
  bundleCode: flagValues("--bundle-code")[0] ?? null,
  widgetCss,
};
const productHandles = [...Object.values(CROSS_SELL_HANDLES), ...(prepKit ? [prepKit] : [])];
console.log(`pool: ${opts.handles.length} handles from ${path.relative(process.cwd(), poolPath)}`);

// The lock is per process, so it does not guard against a Studio save on the
// server; every write's updated_at compare-and-set does.
const result = await withShopSaveLock(SHOP_ID, async () => {
  const state = await loadLiveState(supabase, productHandles);
  const plan = planSync(state, opts);
  console.log(formatPlan(plan, { apply }));
  if (!apply || plan.writes.length === 0) {
    return { ok: true as const, note: apply ? "nothing to write" : "DRY RUN: nothing written (pass --apply)" };
  }

  // An earlier run's restore point means this one finishes a partial apply.
  const { data: prior, error: priorError } = await supabase
    .from("quiz_config_versions")
    .select("created_at")
    .eq("shop_id", SHOP_ID)
    .eq("label", SNAPSHOT_LABEL)
    .order("created_at", { ascending: true })
    .limit(1);
  if (priorError) return { ok: false as const, error: `quiz_config_versions: ${priorError.message}` };
  if (prior?.length) console.log(`re-run: the full-sync restore point is "${SNAPSHOT_LABEL}" from ${prior[0].created_at}`);

  const applied = await applyPlan(plan, {
    db: supabase,
    label: prior?.length ? RERUN_SNAPSHOT_LABEL : SNAPSHOT_LABEL,
    snapshot: (label) => snapshotLabeled(SHOP_ID, label),
    writeBackup: (data) => {
      const dir = path.join(HERE, "backups");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `glamnetic-v3-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      // Absolute: the only rollback for quiz_offers, so print where it lives.
      return file;
    },
    log: (line) => console.log(`  ${line}`),
  });
  if (!applied.ok) {
    const landed = `${applied.written} writes landed; backup ${applied.backupPath ?? "none"}`;
    return { ok: false as const, error: `${applied.error} (${landed}). Dry-run again, then re-run --apply to finish` };
  }

  // Verify: a fresh read plans zero writes, and skips nothing the dry run
  // did not (a new skip means something changed mid-run).
  const after = planSync(await loadLiveState(supabase, productHandles), opts);
  const skips = newSkips(plan, after);
  if (after.writes.length > 0 || skips.length > 0) {
    console.log(formatPlan(after, { apply: false }));
    const what = [
      after.writes.length ? `${after.writes.length} writes still planned` : "",
      skips.length ? `newly skipped: ${skips.map((d) => d.key).join(", ")}` : "",
    ].filter(Boolean);
    return { ok: false as const, error: `after apply, ${what.join("; ")}` };
  }
  return { ok: true as const, note: `applied ${applied.written} writes; backup ${applied.backupPath}; verified: nothing left to sync` };
});

console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
