// One-off: re-extract the brand profile (and thus template eligibility)
// after the brand library has been (re)built.
// Run: npx tsx scripts/rebuild-brand-profile.mts <shop-domain>
//
// CAUTION (2026-09-25 incident): this UPSERTS brand_profiles, which feeds
// the storefront's template tokens and completed the serving pipeline for
// a shop with a stale quiz_template — flipping its live quiz rendering.
// Check chat_assistant_config.quiz_template and the QUIZ_TEMPLATES_LIVE
// flag before running against a live merchant.

import { offlineAdminGraphql } from "./offline-admin.mts";

const shopDomain = process.argv[2];
if (!shopDomain) {
  console.error("Usage: npx tsx scripts/rebuild-brand-profile.mts <shop-domain>");
  process.exit(1);
}

const admin = await offlineAdminGraphql(shopDomain);
const { extractBrandProfile } = await import("../app/lib/brand-profile.server");
const profile = await extractBrandProfile(shopDomain, admin);
console.log("template:", profile.templateAssignment.template);
console.log("eligible:", JSON.stringify(profile.templateAssignment.eligible));
console.log("signals:", JSON.stringify(profile.templateAssignment.signals, null, 2));
