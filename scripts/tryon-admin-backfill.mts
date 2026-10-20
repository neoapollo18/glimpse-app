// Quiz try-on becomes Gleame-admin only (migration 094, 2026-10-20).
//
// quiz_tryon_enabled defaulted to true (migration 069), so most stores
// carry "on" without a single product set up for try-on. Shoppers there
// already see no try-on (quiz-config checks readiness), but the stale "on"
// would let try-on appear the moment someone adds a prompt, without the
// Gleame team turning it on. This turns it off ONLY for those stores.
// Stores where try-on works today (on + a product set up) are untouched.
//
//   npx tsx --env-file=.env scripts/tryon-admin-backfill.mts           # dry run
//   npx tsx --env-file=.env scripts/tryon-admin-backfill.mts --apply
//
// --apply writes a JSON backup of every row it changes first
// (scripts/backups/, git-ignored), then updates one row at a time, guarded
// on quiz_tryon_enabled still being true, and checks each update hit its
// row. A store whose readiness can't be read is kept as it is.
// Undo: set quiz_tryon_enabled back to true for the shops in the backup.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../app/lib/supabase.server";
import { shopHasTryonProducts } from "../app/lib/tryon-availability.server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");

type ConfigRow = {
  shop_domain: string;
  quiz_tryon_enabled: boolean;
  enabled: boolean | null;
  product_scope: string | null;
  selected_product_ids: string[] | null;
  quiz_multi_set_prompt: string | null;
};

const { data: configs, error } = await supabase
  .from("chat_assistant_config")
  .select("shop_domain, quiz_tryon_enabled, enabled, product_scope, selected_product_ids, quiz_multi_set_prompt")
  .eq("quiz_tryon_enabled", true)
  .order("shop_domain");
if (error) throw new Error(`chat_assistant_config read failed: ${error.message}`);

const domains = (configs ?? []).map((c) => (c as ConfigRow).shop_domain);
const { data: shops, error: shopsError } = await supabase
  .from("shops")
  .select("id, shop_domain")
  .in("shop_domain", domains.length ? domains : ["none"]);
if (shopsError) throw new Error(`shops read failed: ${shopsError.message}`);
const shopIdFor = new Map((shops ?? []).map((s) => [s.shop_domain as string, s.id as string]));

const keep: string[] = [];
const turnOff: ConfigRow[] = [];
const unknown: string[] = [];
for (const row of (configs ?? []) as ConfigRow[]) {
  const shopId = shopIdFor.get(row.shop_domain);
  if (!shopId) {
    unknown.push(`${row.shop_domain} (no shops row)`);
    continue;
  }
  try {
    const ready = await shopHasTryonProducts(shopId, row as never);
    if (ready) keep.push(row.shop_domain);
    else turnOff.push(row);
  } catch (e) {
    unknown.push(`${row.shop_domain} (${e instanceof Error ? e.message : String(e)})`);
  }
}

console.log(`Stores with try-on on: ${(configs ?? []).length}`);
console.log(`\nKeep on (a product is set up for try-on), ${keep.length}:`);
keep.forEach((d) => console.log(`  ${d}`));
console.log(`\nTurn off (nothing set up, shoppers see no try-on today), ${turnOff.length}:`);
turnOff.forEach((r) => console.log(`  ${r.shop_domain}${r.enabled ? "" : "  (quiz off)"}`));
if (unknown.length) {
  console.log(`\nKept as is (readiness unreadable), ${unknown.length}:`);
  unknown.forEach((d) => console.log(`  ${d}`));
}

if (!apply) {
  console.log("\nDRY RUN: nothing written. Pass --apply to turn try-on off for the stores listed above.");
  process.exit(0);
}
if (turnOff.length === 0) {
  console.log("\nNothing to change.");
  process.exit(0);
}

const dir = path.join(HERE, "backups");
fs.mkdirSync(dir, { recursive: true });
const backup = path.join(dir, `tryon-admin-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(
  backup,
  JSON.stringify(turnOff.map((r) => ({ shop_domain: r.shop_domain, quiz_tryon_enabled: r.quiz_tryon_enabled })), null, 2),
);
console.log(`\nBackup: ${backup}`);

let changed = 0;
for (const row of turnOff) {
  const { data, error: updateError } = await supabase
    .from("chat_assistant_config")
    .update({ quiz_tryon_enabled: false })
    .eq("shop_domain", row.shop_domain)
    .eq("quiz_tryon_enabled", true)
    .select("shop_domain");
  if (updateError) {
    console.error(`  FAILED ${row.shop_domain}: ${updateError.message}`);
    continue;
  }
  // An UPDATE matching no row "succeeds": say so instead of counting it.
  if (!data || data.length !== 1) {
    console.error(`  SKIPPED ${row.shop_domain}: changed since the read (${data?.length ?? 0} rows)`);
    continue;
  }
  changed++;
  console.log(`  off: ${row.shop_domain}`);
}
console.log(`\nDone: ${changed} of ${turnOff.length} stores turned off.`);
