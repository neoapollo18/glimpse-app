// One-off: build the brand library for a shop whose catalog sync completed
// BEFORE the v2 deploy (so the post-sync library build never ran).
// Run: npx tsx scripts/build-brand-library.mts <shop-domain>
//
// Uses the shop's offline session token from the Prisma Session table and
// calls buildBrandLibrary exactly like app.api.catalog-sync.ts does.
// Additive/upsert per brand-library.server.ts; safe to re-run.

import { PrismaClient } from "@prisma/client";

const shopDomain = process.argv[2];
if (!shopDomain) {
  console.error("Usage: npx tsx scripts/build-brand-library.mts <shop-domain>");
  process.exit(1);
}

const prisma = new PrismaClient();
const session = await prisma.session.findFirst({
  where: { shop: shopDomain, isOnline: false },
});
await prisma.$disconnect();
if (!session?.accessToken) {
  console.error(`No offline session token for ${shopDomain}`);
  process.exit(1);
}

const API_VERSION = "2025-01";
const admin = async (query: string, variables?: Record<string, unknown>) => {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken!,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  if (!res.ok) throw new Error(`Admin API ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data?: unknown; errors?: Array<{ message?: string }> };
  if (body.errors?.length) {
    throw new Error(`brand-library graphql: ${body.errors[0]?.message ?? "error"}`);
  }
  return body.data;
};

const { buildBrandLibrary, libraryStats } = await import("../app/lib/brand-library.server");
const result = await buildBrandLibrary(shopDomain, { admin, timeBoxMs: 60_000 });
console.log("build result:", result);
const stats = await libraryStats(shopDomain);
console.log("library stats:", JSON.stringify(stats, null, 2));
