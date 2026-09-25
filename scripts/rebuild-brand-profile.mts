// One-off: re-extract the brand profile (and thus template eligibility)
// after the brand library has been (re)built.
// Run: npx tsx scripts/rebuild-brand-profile.mts <shop-domain>

import { PrismaClient } from "@prisma/client";

const shopDomain = process.argv[2];
if (!shopDomain) {
  console.error("Usage: npx tsx scripts/rebuild-brand-profile.mts <shop-domain>");
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
    throw new Error(`brand-profile graphql: ${body.errors[0]?.message ?? "error"}`);
  }
  return body.data;
};

const { extractBrandProfile } = await import("../app/lib/brand-profile.server");
const profile = await extractBrandProfile(shopDomain, admin);
console.log("template:", profile.templateAssignment.template);
console.log("eligible:", JSON.stringify(profile.templateAssignment.eligible));
console.log("signals:", JSON.stringify(profile.templateAssignment.signals, null, 2));
