/**
 * Cron Job: Check Sessions for Plan Changes
 * 
 * This endpoint should be called by an external cron service (e.g., cron-job.org, Render cron)
 * every 2 weeks to check if any store's traffic has changed and needs a plan update.
 * 
 * Security: Protected by CRON_SECRET environment variable
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { supabase } from "../lib/supabase.server";
import { identifyAndGetCustomer } from "../lib/mantle.server";
import { getPlanChangeInfo, getMantlePlanForSessions, type MantlePlan } from "../lib/plan-matcher.server";

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

    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      console.error(`Shopify API error for ${shop}: ${response.status}`);
      return null;
    }

    const result = await response.json();

    if (result.errors?.length > 0) {
      console.error(`GraphQL errors for ${shop}:`, result.errors);
      return null;
    }

    const shopifyqlData = result.data?.shopifyqlQuery;
    if (shopifyqlData?.parseErrors?.length > 0) {
      console.error(`ShopifyQL parse errors for ${shop}:`, shopifyqlData.parseErrors);
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
  
  if (secret !== process.env.CRON_SECRET) {
    console.error('Cron job called with invalid secret');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('🕐 Starting bi-weekly session check...');

  const results = {
    checked: 0,
    needsUpdate: 0,
    errors: 0,
    notifications: [] as string[],
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
        // Get current subscription from Mantle
        const { customer } = await identifyAndGetCustomer(shop, accessToken);
        const subscription = customer.subscription;
        
        // Skip if no active subscription
        if (!subscription?.active) {
          console.log(`⏭️ ${shop}: No active subscription, skipping`);
          continue;
        }

        const currentPlanName = subscription.plan?.name;
        if (!currentPlanName) continue;

        // Fetch current sessions
        const sessionCount = await fetchSessionsDirectly(shop, accessToken);
        if (sessionCount === null) {
          console.error(`❌ ${shop}: Failed to fetch sessions`);
          results.errors++;
          continue;
        }

        // Check if plan needs to change
        const planChangeInfo = getPlanChangeInfo(currentPlanName, sessionCount);
        
        if (planChangeInfo) {
          results.needsUpdate++;
          const notification = `${shop}: ${currentPlanName} → ${planChangeInfo.suggestedPlan.name} (${sessionCount.toLocaleString()} sessions/mo)`;
          results.notifications.push(notification);
          console.log(`⚠️ ${notification}`);

          // Store notification in Supabase for when user logs in
          const plans = (customer.plans || []) as MantlePlan[];
          const suggestedPlan = getMantlePlanForSessions(plans, sessionCount);
          
          await supabase
            .from('shops')
            .update({
              pending_plan_change: {
                currentPlan: currentPlanName,
                suggestedPlan: planChangeInfo.suggestedPlan.name,
                suggestedPlanId: suggestedPlan?.id || null,
                suggestedPrice: planChangeInfo.suggestedPlan.price,
                sessions: sessionCount,
                isUpgrade: planChangeInfo.isUpgrade,
                detectedAt: new Date().toISOString(),
              },
            })
            .eq('shop_domain', shop);
        } else {
          console.log(`✅ ${shop}: Plan matches traffic (${currentPlanName}, ${sessionCount.toLocaleString()} sessions)`);
        }

      } catch (error) {
        console.error(`❌ Error processing ${shop}:`, error);
        results.errors++;
      }
    }

    console.log(`🏁 Session check complete: ${results.checked} checked, ${results.needsUpdate} need updates, ${results.errors} errors`);

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
