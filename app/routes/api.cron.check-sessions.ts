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
import { updateShopMonthlySessions } from "../lib/supabase.server";

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

    const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
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
    sent: 0,    // Unused since the Mantle shutdown (kept for response shape)
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
            const debugRes = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
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

        // Save session count to Supabase (admin dashboard + future
        // Shopify-billing tier matching).
        await updateShopMonthlySessions(shop, sessionCount);
        results.cached++;
        console.log(`💾 ${shop}: Saved ${sessionCount.toLocaleString()} sessions to Supabase`);

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
