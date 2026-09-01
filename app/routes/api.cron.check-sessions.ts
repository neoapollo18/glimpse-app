/**
 * Cron Job: refresh monthly session counts per shop.
 *
 * Called by an external cron service (e.g. Render cron). Counts feed the
 * founders admin dashboard and the upcoming Shopify-native billing's
 * session-tier matching. (The Mantle usage sync that used to live here
 * died with Mantle, late Aug 2026.)
 *
 * Security: Protected by CRON_SECRET environment variable
 */

import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import {
  claimUsageCycle,
  getShopBillingState,
  releaseUsageCycle,
  updateShopBillingState,
  updateShopMonthlySessions,
  updateShopSubscriptionStatus,
} from "../lib/supabase.server";
import {
  ADMIN_API_VERSION,
  directGraphql,
  getActiveSubscription,
  postTierUsage,
  tierForSessions,
} from "../lib/shopify-billing.server";

/**
 * Shopify-native flex billing: post ONE usage record per billing cycle
 * equal to the shop's session-tier fee.
 *
 * Money-path discipline (each guard exists because its absence was a
 * confirmed wrong-charge path):
 * - The cycle is CLAIMED in the DB before posting (claimUsageCycle is a
 *   compare-and-swap); a crash after posting can't re-post next run, and
 *   a failed post releases the claim for retry.
 * - usageBalanceUsd > 0 means this cycle already carries charges (e.g. a
 *   just-adopted Mantle flex line, or a lost claim record): claim, don't
 *   post.
 * - First sight of a subscription the app didn't create (stored id
 *   mismatch) claims the current cycle WITHOUT posting — Mantle may have
 *   already billed the in-flight period.
 * - Trials: +3 day buffer over createdAt because the 14-day clock starts
 *   at merchant APPROVAL, which can lag creation by ~2 days.
 * - Fees above the line's remaining approved cap are skipped (flagged in
 *   logs), never error-looped.
 * - Flat-price subscriptions (Mantle-created) are left alone entirely.
 * Also reconciles shops.subscription_status with reality — the webhook
 * is best-effort and the storefront gate reads this column.
 */
async function maybePostTierUsage(
  shop: string,
  accessToken: string,
  sessions: number,
): Promise<string> {
  const state = await getShopBillingState(shop);
  if (!state) throw new Error("billing state unavailable (shops row missing or DB error)");
  if (state.subscription_status === "grandfathered") return "grandfathered (never charged)";

  const graphql = directGraphql(shop, accessToken);
  const sub = await getActiveSubscription(graphql);
  if (!sub || sub.status !== "ACTIVE") {
    // Reconcile: webhook may have missed a cancellation.
    if (state.subscription_status === "active") {
      await updateShopSubscriptionStatus(shop, "cancelled", null);
      return "no active subscription (status reconciled to cancelled)";
    }
    return "no active subscription";
  }
  // Reconcile the other direction: paying shop whose ACTIVE webhook was lost.
  if (state.subscription_status !== "active") {
    await updateShopSubscriptionStatus(shop, "active", null);
  }

  if (!sub.usageLineItemId) return "flat-price subscription (left alone)";
  if ((sub.recurringPriceUsd ?? 0) > 0) {
    return `flat+usage subscription at $${sub.recurringPriceUsd} (left alone)`;
  }

  // Trial guard: the 14-day clock starts when the merchant APPROVES, up to
  // ~2 days after createdAt — the buffer keeps us out of the advertised
  // trial window without needing the approval timestamp.
  if (sub.trialDays > 0 && sub.createdAt) {
    const trialEnd = new Date(sub.createdAt).getTime() + (sub.trialDays + 3) * 86_400_000;
    if (Date.now() < trialEnd) return "in trial";
  }

  const { tier, fee } = tierForSessions(sessions);
  const cycleKey = `${sub.id}:${sub.currentPeriodEnd ?? "unknown"}`;
  if (state.last_usage_cycle_key === cycleKey) return "already posted this cycle";

  const persistMeta = () =>
    updateShopBillingState(shop, {
      shopify_subscription_id: sub.id,
      usage_line_item_id: sub.usageLineItemId,
      current_tier: tier.name,
      current_period_end: sub.currentPeriodEnd,
    });

  // Adoption: a subscription the app didn't create (Mantle flex). The
  // in-flight period may already be billed — start posting NEXT cycle.
  if (state.shopify_subscription_id !== sub.id) {
    await claimUsageCycle(shop, state.last_usage_cycle_key, cycleKey);
    await persistMeta();
    return "adopted existing flex subscription; posting starts next cycle";
  }

  // Cycle already carries charges (partial claim loss, or someone else
  // posted): never stack our fee on top.
  if ((sub.usageBalanceUsd ?? 0) > 0) {
    await claimUsageCycle(shop, state.last_usage_cycle_key, cycleKey);
    return `cycle already billed ($${sub.usageBalanceUsd} used) — skipped`;
  }

  if (fee === 0) {
    await claimUsageCycle(shop, state.last_usage_cycle_key, cycleKey);
    return `free tier (${sessions.toLocaleString()} sessions)`;
  }

  // Approved-cap guard: a lower-capped adopted line can't take the fee;
  // flag for a re-approval migration instead of error-looping.
  const remainingCap = (sub.usageCappedUsd ?? 0) - (sub.usageBalanceUsd ?? 0);
  if (fee > remainingCap) {
    return `NEEDS MIGRATION: fee $${fee} exceeds remaining approved cap $${remainingCap}`;
  }

  // Claim BEFORE posting (double-charge window otherwise).
  const claim = await claimUsageCycle(shop, state.last_usage_cycle_key, cycleKey);
  if (claim.error) throw new Error(`cycle claim failed: ${claim.error}`);
  if (!claim.claimed) return "cycle claimed by a concurrent run";

  const posted = await postTierUsage(graphql, {
    usageLineItemId: sub.usageLineItemId,
    feeUsd: fee,
    description: `Gleame ${tier.name} plan — ${sessions.toLocaleString()} monthly sessions`,
    idempotencyKey: cycleKey,
  });
  if (!posted.ok) {
    await releaseUsageCycle(shop, cycleKey, state.last_usage_cycle_key);
    throw new Error(`usage record failed: ${posted.error}`);
  }
  await persistMeta();
  return `posted $${fee} (${tier.name})`;
}

// Shopify Admin API helper for direct calls (without authenticate middleware)
async function fetchSessionsDirectly(shop: string, accessToken: string): Promise<number | null> {
  try {
    const query = `
      query GetQuarterlySessions {
        shopifyqlQuery(query: "FROM sessions SHOW sessions SINCE -90d") {
          tableData {
            columns { name dataType }
            rows
          }
          parseErrors { message }
        }
      }
    `;

    const response = await fetch(`https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`Shopify API error for ${shop}: ${response.status} - ${body}`);
      return null;
    }

    const result = await response.json();

    if (result.errors?.length > 0) {
      console.error(`GraphQL errors for ${shop}:`, JSON.stringify(result.errors));
      return null;
    }

    const shopifyqlData = result.data?.shopifyqlQuery;
    if (shopifyqlData?.parseErrors?.length > 0) {
      console.error(`ShopifyQL parse errors for ${shop}:`, JSON.stringify(shopifyqlData.parseErrors));
      return null;
    }

    const tableData = shopifyqlData?.tableData;
    if (!tableData?.rows?.length) {
      return 0;
    }

    const sessionsColumnIndex = tableData.columns.findIndex(
      (col: { name: string }) => col.name.toLowerCase() === 'sessions'
    );

    if (sessionsColumnIndex === -1) return null;

    let totalSessions = 0;
    for (const row of tableData.rows) {
      const parsed = parseInt(row[sessionsColumnIndex], 10);
      if (!isNaN(parsed)) totalSessions += parsed;
    }

    // Average monthly (90 days / 3)
    return Math.round(totalSessions / 3);
  } catch (error) {
    console.error(`Error fetching sessions for ${shop}:`, error);
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Verify cron secret for security
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');

  // Constant-time comparison — a plain !== leaks how many leading bytes
  // matched via timing. timingSafeEqual requires equal-length buffers, so a
  // length mismatch (which !== leaks anyway) is an immediate 401.
  const expected = process.env.CRON_SECRET;
  const secretBuf = Buffer.from(secret ?? '');
  const expectedBuf = Buffer.from(expected ?? '');
  const valid =
    Boolean(secret && expected) &&
    secretBuf.length === expectedBuf.length &&
    timingSafeEqual(secretBuf, expectedBuf);
  if (!valid) {
    console.error('Cron job called with invalid secret');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('🕐 Starting session count refresh…');

  const results: {
    checked: number;
    cached: number;
    sent: number;
    skipped: number;
    errors: number;
    errorDetails: string[];
  } = {
    checked: 0,
    cached: 0,  // Sessions saved to Supabase
    sent: 0,    // Usage records posted to Shopify this run
    skipped: 0, // No active subscription
    errors: 0,
    errorDetails: [],
  };

  try {
    // Get all offline sessions (persistent tokens) from Prisma
    const sessions = await prisma.session.findMany({
      where: {
        isOnline: false, // Offline tokens are persistent
        accessToken: { not: '' },
      },
      select: {
        shop: true,
        accessToken: true,
      },
      distinct: ['shop'], // One per shop
    });

    console.log(`📊 Found ${sessions.length} shops to check`);

    for (const session of sessions) {
      const { shop, accessToken } = session;
      results.checked++;

      try {
        // MANTLE SHUTDOWN: no subscription lookup and no usage sends —
        // Mantle's API is gone. Session counts still get collected: the
        // admin dashboard shows them and the upcoming Shopify-native
        // billing needs them for tier matching.

        // Fetch current sessions from Shopify
        const sessionCount = await fetchSessionsDirectly(shop, accessToken);
        if (sessionCount === null) {
          // Re-run to capture the specific error for the response
          let debugInfo = 'unknown';
          try {
            const debugRes = await fetch(`https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
              body: JSON.stringify({ query: `query { shopifyqlQuery(query: "FROM sessions SHOW sessions SINCE -90d") { tableData { columns { name } rows } parseErrors { message } } }` }),
            });
            const debugBody = await debugRes.text();
            debugInfo = `status=${debugRes.status} body=${debugBody.substring(0, 300)}`;
          } catch (e) { debugInfo = String(e); }

          results.errors++;
          results.errorDetails.push(`${shop}: ${debugInfo}`);
          continue;
        }

        // Save session count to Supabase (admin dashboard + tier matching).
        await updateShopMonthlySessions(shop, sessionCount);
        results.cached++;
        console.log(`💾 ${shop}: Saved ${sessionCount.toLocaleString()} sessions to Supabase`);

        // Shopify-native billing: post this cycle's tier fee if due.
        try {
          const billing = await maybePostTierUsage(shop, accessToken, sessionCount);
          if (billing.startsWith("posted")) results.sent++;
          console.log(`💳 ${shop}: ${billing}`);
        } catch (billingError) {
          const msg = billingError instanceof Error ? billingError.message : String(billingError);
          console.error(`❌ ${shop}: billing usage post failed:`, msg);
          results.errors++;
          results.errorDetails.push(`${shop} (billing): ${msg}`);
        }

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error processing ${shop}:`, msg);
        results.errors++;
        results.errorDetails.push(`${shop}: ${msg}`);
      }
    }

    console.log(`🏁 Usage sync complete: ${results.checked} checked, ${results.cached} cached, ${results.skipped} skipped, ${results.errors} errors`);

    return json({
      success: true,
      ...results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Cron job failed:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
};
