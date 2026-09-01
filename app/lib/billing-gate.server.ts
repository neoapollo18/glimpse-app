// Shared billing gate (Shopify-native billing; Mantle died Aug 2026).
//
// Enforcement is OFF until BILLING_ENFORCED=true is set — flip it only
// after the paying-merchant migration (audit → approvals) is done.
//
// Policy when armed: grandfathered shops pass; under-2.5k-session shops
// pass (free tier); shops with an ACTIVE Shopify subscription pass;
// everyone else is sent to /app/billing to approve the flex subscription.
// Verification errors FAIL OPEN: a Shopify API blip must never lock
// merchants out of the app (that's the exact failure mode Mantle's death
// exposed when this gate failed closed).
//
// app.tsx enforces this for every nested admin page; the studio (a
// standalone route) and the AI/sync resource routes check it directly.

import { directGraphql, getActiveSubscription, tierForSessions } from "./shopify-billing.server";
import { getShopBillingState } from "./supabase.server";

export const BILLING_ENFORCED = process.env.BILLING_ENFORCED === "true";

const cache = new Map<string, { at: number; needsBilling: boolean }>();
const TTL_MS = 5 * 60_000;

export async function shopNeedsBilling(shopDomain: string, accessToken: string): Promise<boolean> {
  if (!BILLING_ENFORCED) return false;
  const hit = cache.get(shopDomain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.needsBilling;
  const needsBilling = await computeNeedsBilling(shopDomain, accessToken);
  cache.set(shopDomain, { at: Date.now(), needsBilling });
  return needsBilling;
}

/** Approving a subscription must reflect immediately, not after the TTL. */
export function invalidateBillingCache(shopDomain: string): void {
  cache.delete(shopDomain);
}

async function computeNeedsBilling(shopDomain: string, accessToken: string): Promise<boolean> {
  try {
    const state = await getShopBillingState(shopDomain);
    if (state?.subscription_status === "grandfathered") return false;
    // Free tier: no subscription required under 2.5k monthly sessions.
    if (tierForSessions(state?.monthly_sessions ?? 0).fee === 0) return false;
    if (!accessToken) return false; // can't verify — fail open
    const sub = await getActiveSubscription(directGraphql(shopDomain, accessToken));
    return !(sub && sub.status === "ACTIVE");
  } catch (e) {
    console.error(`Billing gate error for ${shopDomain} (failing open):`, e);
    return false;
  }
}
