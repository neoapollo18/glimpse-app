// One-off: build the brand library for a shop whose catalog sync completed
// BEFORE the v2 deploy (so the post-sync library build never ran).
// Run: npx tsx scripts/build-brand-library.mts <shop-domain>
//
// Calls buildBrandLibrary exactly like app.api.catalog-sync.ts does.
// Additive/upsert per brand-library.server.ts; safe to re-run.
//
// CAUTION (2026-09-25 incident): building brand data can change what the
// live storefront serves for shops with quiz_template set. Check the
// shop's chat_assistant_config.quiz_template and the QUIZ_TEMPLATES_LIVE
// flag before running against a live merchant.

import { offlineAdminGraphql } from "./offline-admin.mts";

const shopDomain = process.argv[2];
if (!shopDomain) {
  console.error("Usage: npx tsx scripts/build-brand-library.mts <shop-domain>");
  process.exit(1);
}

const admin = await offlineAdminGraphql(shopDomain);
const { buildBrandLibrary, libraryStats } = await import("../app/lib/brand-library.server");
const result = await buildBrandLibrary(shopDomain, { admin, timeBoxMs: 60_000 });
console.log("build result:", result);
const stats = await libraryStats(shopDomain);
console.log("library stats:", JSON.stringify(stats, null, 2));
