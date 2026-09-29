// One-off: build the brand library for a shop whose catalog sync completed
// BEFORE the v2 deploy (so the post-sync library build never ran), or to
// re-run indexing offline for a shop whose status is `failed`.
// Run: npx tsx scripts/build-brand-library.mts <shop-domain>
//
// Calls buildBrandLibrary exactly like app.api.catalog-sync.ts does, and
// writes the same shops.library_index_status transitions (V3-CONTRACTS §9):
// pending (set here, like a sync start) -> building -> ready | failed.
// Additive/upsert per brand-library.server.ts; safe to re-run. Exits
// non-zero when the build lands `failed` so ops runs notice.
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
const { buildBrandLibrary, getLibraryStatus, libraryStats, setLibraryIndexStatus } = await import(
  "../app/lib/brand-library.server"
);

const before = await getLibraryStatus(shopDomain);
console.log("status before:", JSON.stringify(before));
if (before.status === "building") {
  console.warn(
    "status is `building` (an in-app build may be running, or a crashed one left it behind); continuing — this run overwrites it"
  );
}

await setLibraryIndexStatus(shopDomain, "pending");
const result = await buildBrandLibrary(shopDomain, { admin, timeBoxMs: 60_000 });
console.log("build result:", result);
const stats = await libraryStats(shopDomain);
console.log("library stats:", JSON.stringify(stats, null, 2));
const after = await getLibraryStatus(shopDomain);
console.log("status after:", JSON.stringify(after));
if (result.status !== "ready") {
  console.error(`library index FAILED for ${shopDomain}: ${result.error}`);
  process.exit(2);
}
