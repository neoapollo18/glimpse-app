// One-off: move every store off Gleame's Shopify subscriptions so the
// App Store listing can honestly say "Free" (Oct 2026).
//
// Gleame charges nothing (pricing-tiers.ts, ALL_TIERS_FREE), but stores
// still hold subscriptions from before: Mantle-era flat plans that keep
// billing on their own, and flex subs ($0 recurring + usage line capped
// at $399) that never post a charge but still carry a usage contract.
// Shopify reads both as "this app charges", which is what keeps the
// listing on "Free to install".
//
//   Dry run (read-only audit, the default):
//     set -a && source .env && set +a && npx tsx scripts/cancel-paid-subscriptions.mts
//   Cancel every active subscription found:
//     ... npx tsx scripts/cancel-paid-subscriptions.mts --apply
//   Limit to some shops:
//     ... --shop=foo.myshopify.com --shop=bar.myshopify.com
//
// Cancelling needs no merchant approval and stops billing immediately.
// prorate=false (Shopify's default): no credit for the unused part of the
// current cycle. Pass --prorate to refund it (deducted from Partner payouts).
// Cancellation fires app_subscriptions/update → the webhook marks the shop
// "cancelled", which only matters once BILLING_ENFORCED is on; grandfathered
// shops are never downgraded by it.

import { PrismaClient } from "@prisma/client";

const API_VERSION = "2026-07"; // matches shopify-billing.server.ts

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PRORATE = args.includes("--prorate");
const ONLY = args.filter((a) => a.startsWith("--shop=")).map((a) => a.slice("--shop=".length));

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<any>;

function gqlFor(shop: string, token: string): Gql {
  return async (query, variables) => {
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(JSON.stringify(body.errors).slice(0, 200));
    return body.data;
  };
}

const SUBS_QUERY = `
  query {
    currentAppInstallation {
      activeSubscriptions {
        id name status test createdAt currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing { price { amount } }
              ... on AppUsagePricing { cappedAmount { amount } balanceUsed { amount } }
            }
          }
        }
      }
    }
  }
`;

const CANCEL_MUTATION = `
  mutation GleameCancel($id: ID!, $prorate: Boolean) {
    appSubscriptionCancel(id: $id, prorate: $prorate) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

function describe(sub: any): { recurring: number; usageCap: number | null; usageUsed: number | null } {
  let recurring = 0;
  let usageCap: number | null = null;
  let usageUsed: number | null = null;
  for (const li of sub.lineItems ?? []) {
    const pd = li?.plan?.pricingDetails;
    if (pd?.__typename === "AppRecurringPricing") recurring += Number(pd.price?.amount ?? 0);
    if (pd?.__typename === "AppUsagePricing") {
      usageCap = Number(pd.cappedAmount?.amount ?? 0);
      usageUsed = Number(pd.balanceUsed?.amount ?? 0);
    }
  }
  return { recurring, usageCap, usageUsed };
}

async function main() {
  const prisma = new PrismaClient();
  const sessions = await prisma.session.findMany({
    where: { isOnline: false, accessToken: { not: "" }, ...(ONLY.length ? { shop: { in: ONLY } } : {}) },
    select: { shop: true, accessToken: true },
    distinct: ["shop"],
  });
  await prisma.$disconnect();

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${sessions.length} shop(s) with offline tokens${PRORATE ? ", prorate=true" : ""}\n`);

  const totals = { shopsWithSubs: 0, subs: 0, paidRecurringUsd: 0, cancelled: 0, failed: 0, unreachable: 0 };

  for (const { shop, accessToken } of sessions) {
    const gql = gqlFor(shop, accessToken);
    let subs: any[];
    try {
      subs = (await gql(SUBS_QUERY))?.currentAppInstallation?.activeSubscriptions ?? [];
    } catch (e) {
      // Usually an uninstalled shop with a stale token: nothing to bill.
      totals.unreachable++;
      console.log(`  ?  ${shop}: unreachable (${e instanceof Error ? e.message.slice(0, 80) : e})`);
      continue;
    }
    if (subs.length === 0) continue;
    totals.shopsWithSubs++;

    for (const sub of subs) {
      totals.subs++;
      const d = describe(sub);
      totals.paidRecurringUsd += sub.test ? 0 : d.recurring;
      const shape = d.recurring > 0 ? `FLAT $${d.recurring}/mo` : d.usageCap != null ? `flex $0 + usage cap $${d.usageCap} (used $${d.usageUsed})` : "$0";
      console.log(
        `  •  ${shop}: "${sub.name}" ${sub.status}${sub.test ? " [test]" : ""} — ${shape}, since ${sub.createdAt?.slice(0, 10)}, period ends ${sub.currentPeriodEnd?.slice(0, 10) ?? "-"}`,
      );
      if (!APPLY) continue;
      try {
        const res = (await gql(CANCEL_MUTATION, { id: sub.id, prorate: PRORATE }))?.appSubscriptionCancel;
        const err = res?.userErrors?.[0];
        if (err) throw new Error(err.message);
        totals.cancelled++;
        console.log(`       → cancelled (${res?.appSubscription?.status})`);
      } catch (e) {
        totals.failed++;
        console.log(`       → FAILED: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  console.log(`\nShops with subscriptions: ${totals.shopsWithSubs}, subscriptions: ${totals.subs}`);
  console.log(`Live (non-test) fixed recurring revenue: $${totals.paidRecurringUsd}/mo`);
  console.log(`Unreachable shops: ${totals.unreachable}`);
  if (APPLY) console.log(`Cancelled: ${totals.cancelled}, failed: ${totals.failed}`);
  else if (totals.subs > 0) console.log(`Re-run with --apply to cancel all of the above.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
