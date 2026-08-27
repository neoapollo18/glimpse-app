// End-to-end dry run of the AI quiz generator against a real shop's synced
// catalog (Phase 5 acceptance). Writes DRAFTS ONLY — never publishes, never
// touches live quiz tables.
//
//   1. Loads the shop's catalog from Supabase (real generator code path)
//   2. Calls Claude with a canned brand brief
//   3. Prints the validated draft summary + warnings + token/cost report
//   4. Optionally runs again (--twice) and asserts the prompt cache was hit
//
// USAGE: npx tsx scripts/quiz-builder-dry-run.mts <shop-domain> [--twice]
// Requires ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_API_KEY in .env.
// SAFETY: refuses to run against the live merchants.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const shopDomain = process.argv[2];
const twice = process.argv.includes("--twice");
if (!shopDomain) {
  console.error("USAGE: npx tsx scripts/quiz-builder-dry-run.mts <shop-domain> [--twice]");
  process.exit(1);
}
if (["orlybeauty.myshopify.com", "locks-mane.myshopify.com"].includes(shopDomain)) {
  console.error("Refusing to run against a live merchant. Use the dev store.");
  process.exit(1);
}

const { findShopByDomain } = await import("../app/lib/supabase.server.ts");
const { generateQuizConfig } = await import("../app/lib/quiz-generator.server.ts");
const { getQuizDraft } = await import("../app/lib/quiz-draft.server.ts");
const { estimateCostUsd } = await import("../app/lib/claude.server.ts");

const shop = await findShopByDomain(shopDomain);
if (!shop) {
  console.error(`No shops row for ${shopDomain}`);
  process.exit(1);
}

async function run(label: string) {
  console.log(`\n=== ${label} ===`);
  const t0 = Date.now();
  const result = await generateQuizConfig({
    shopId: shop!.id,
    shopDomain,
    brief: {
      category: "beauty products",
      brandVoice: "warm, confident, a little playful",
      quizLength: "short",
      modePreference: "auto",
    },
    onProgress: (phase) => console.log(`  … ${phase}`),
  });
  console.log(`  ok=${result.ok} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!result.ok) {
    console.error(`  ERROR: ${result.error}`);
    process.exit(1);
  }
  console.log(`  summary:`, result.summary);
  for (const w of result.warnings) console.log(`  warning: ${w}`);
  let cost = 0;
  for (const u of result.usage) cost += estimateCostUsd(u);
  console.log(`  usage: ${JSON.stringify(result.usage)}`);
  console.log(`  est cost: $${cost.toFixed(3)}`);
  return result;
}

await run("generation 1");

const draft = await getQuizDraft(shop.id);
if (!draft || !draft.flow.questions.length) {
  console.error("Draft was not persisted!");
  process.exit(1);
}
console.log(`\nDraft persisted: ${draft.flow.questions.length} questions, first prompt: "${draft.flow.questions[0].prompt}"`);

if (twice) {
  const second = await run("generation 2 (cache check)");
  const cacheRead = second.usage.reduce((s, u) => s + (u.cache_read_input_tokens ?? 0), 0);
  if (cacheRead > 0) {
    console.log(`\nPROMPT CACHE HIT: ${cacheRead} tokens read from cache`);
  } else {
    console.error("\nPROMPT CACHE MISS on second run — check serializeCatalog determinism / system block stability");
    process.exit(1);
  }
}

console.log("\nDry run passed");
process.exit(0);
