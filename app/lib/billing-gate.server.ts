// Shared billing gate.
//
// MANTLE SHUT DOWN (late Aug 2026). Until Shopify-native billing ships,
// enforcement is OFF: every shop gets full access and nothing in the app
// may call Mantle on a request path. BILLING_ENFORCED=true re-arms the
// gate once the Shopify Billing implementation replaces computeNeedsBilling.
//
// app.tsx enforces this for every nested admin page; the studio (a
// standalone route) and the AI/sync resource routes check it directly.

export const BILLING_ENFORCED = process.env.BILLING_ENFORCED === "true";

const cache = new Map<string, { at: number; needsBilling: boolean }>();
const TTL_MS = 60_000;

export async function shopNeedsBilling(shopDomain: string, _accessToken: string): Promise<boolean> {
  if (!BILLING_ENFORCED) return false;
  const hit = cache.get(shopDomain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.needsBilling;
  // Placeholder until Shopify-native billing lands: fail OPEN. The old
  // Mantle-backed check failed closed, which locked every merchant out
  // the moment Mantle's API died.
  const needsBilling = false;
  cache.set(shopDomain, { at: Date.now(), needsBilling });
  return needsBilling;
}
