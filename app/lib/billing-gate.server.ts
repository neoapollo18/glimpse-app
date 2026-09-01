// Shared billing gate. app.tsx enforces this for every nested admin page,
// but the studio (a standalone route) and the AI/sync resource routes
// (resource routes never run parent loaders) were reachable without it —
// letting an unsubscribed shop drive paid Claude calls.
//
// Same policy as app.tsx: grandfathered → allowed; else active Mantle
// subscription or grace period; FAIL CLOSED on errors. Cached briefly so
// autosave-frequency actions don't hammer Mantle.

import { identifyAndGetCustomer } from "./mantle.server";
import { isShopGrandfathered, markShopAsGrandfathered } from "./supabase.server";

const cache = new Map<string, { at: number; needsBilling: boolean }>();
const TTL_MS = 60_000;

export async function shopNeedsBilling(shopDomain: string, accessToken: string): Promise<boolean> {
  const hit = cache.get(shopDomain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.needsBilling;
  const needsBilling = await computeNeedsBilling(shopDomain, accessToken);
  cache.set(shopDomain, { at: Date.now(), needsBilling });
  return needsBilling;
}

async function computeNeedsBilling(shopDomain: string, accessToken: string): Promise<boolean> {
  try {
    const grandfathered = await isShopGrandfathered(shopDomain);
    if (grandfathered) {
      await markShopAsGrandfathered(shopDomain);
      return false;
    }
    try {
      const { customer } = await identifyAndGetCustomer(shopDomain, accessToken);
      const subscription = customer?.subscription;
      if (subscription?.active === true) return false;
      if (subscription?.currentPeriodEnd) {
        // Grace period: cancelled but still inside the paid billing period.
        if (new Date(subscription.currentPeriodEnd) > new Date()) return false;
      }
      return true;
    } catch (mantleError) {
      console.error("Billing gate: Mantle error (failing closed):", mantleError);
      return true;
    }
  } catch (error) {
    console.error("Billing gate: grandfathered check error (failing closed):", error);
    return true;
  }
}
