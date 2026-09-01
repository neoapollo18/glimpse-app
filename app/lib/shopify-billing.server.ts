// Shopify-native billing (Mantle replacement, Sept 2026).
//
// Model — a rebuild of Mantle "Flex" on the raw Billing API:
//   One AppSubscription per paying shop:
//     line 1: $0 recurring (EVERY_30_DAYS)  — keeps the sub alive at $0
//     line 2: usage line, cappedAmount $399 — the top session tier
//   The merchant approves ONCE (terms show the tier table). Every billing
//   cycle, a cron posts ONE usage record equal to the shop's session-tier
//   fee. Tier moves need no re-approval; the cap makes overcharging
//   structurally impossible (records past the cap are rejected by Shopify).
//
// Free tier (<2.5k sessions) posts nothing. Grandfathered shops never
// subscribe. Tier table lives in pricing-tiers.ts (shared with the UI).

import { SESSION_TIERS, type SessionTier } from "./pricing-tiers";

export const USAGE_CAP_USD = 399;

export interface TierMatch {
  tier: SessionTier;
  fee: number; // USD for this cycle; 0 = post nothing
}

export function tierForSessions(sessions: number): TierMatch {
  const tier =
    SESSION_TIERS.find((t) => sessions >= t.min && sessions <= t.max) ?? SESSION_TIERS[0];
  return { tier, fee: tier.price ?? 0 };
}

export function billingTermsText(): string {
  // Shown to the merchant on Shopify's approval page. Keep it exact and
  // short — this is the contract for what the usage line may charge.
  const paid = SESSION_TIERS.filter((t) => (t.price ?? 0) > 0)
    .map((t) => `$${t.price}/mo for ${t.visitors}`)
    .join("; ");
  return `Charged monthly by store traffic: free under 2,500 sessions; ${paid}. Never more than $${USAGE_CAP_USD}/mo.`;
}

// ---------------------------------------------------------------------
// GraphQL plumbing. Request contexts pass admin.graphql; the cron (no
// authenticate.admin) uses directGraphql with the offline token.
// ---------------------------------------------------------------------

export type GraphqlFn = (query: string, variables?: Record<string, unknown>) => Promise<any>;

export function directGraphql(shopDomain: string, accessToken: string): GraphqlFn {
  return async (query, variables) => {
    const res = await fetch(`https://${shopDomain}/admin/api/2025-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Shopify GraphQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = await res.json();
    if (body.errors?.length) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors).slice(0, 300)}`);
    }
    return body.data;
  };
}

/** Wrap the authenticate.admin(request) client into the same shape. */
export function adminGraphql(admin: { graphql: (q: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> }): GraphqlFn {
  return async (query, variables) => {
    const res = await admin.graphql(query, { variables });
    const body = await res.json();
    if (body.errors?.length) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors).slice(0, 300)}`);
    }
    return body.data;
  };
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  createdAt: string | null;
  currentPeriodEnd: string | null;
  recurringPriceUsd: number | null;
  usageLineItemId: string | null;
  usageCappedUsd: number | null;
  usageBalanceUsd: number | null;
  usageTerms: string | null;
}

const ACTIVE_SUBSCRIPTIONS_QUERY = `
  query GleameActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id name status test trialDays createdAt currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricingDetails { price { amount currencyCode } interval }
              ... on AppUsagePricingDetails { terms cappedAmount { amount } balanceUsed { amount } }
            }
          }
        }
      }
    }
  }
`;

export async function getActiveSubscription(graphql: GraphqlFn): Promise<ActiveSubscription | null> {
  const data = await graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const subs = data?.currentAppInstallation?.activeSubscriptions ?? [];
  if (subs.length === 0) return null;
  // At most one active subscription per app per shop in practice; take the
  // first and normalize.
  const sub = subs[0];
  const out: ActiveSubscription = {
    id: sub.id,
    name: sub.name ?? "",
    status: sub.status ?? "",
    test: Boolean(sub.test),
    trialDays: Number(sub.trialDays ?? 0),
    createdAt: sub.createdAt ?? null,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    recurringPriceUsd: null,
    usageLineItemId: null,
    usageCappedUsd: null,
    usageBalanceUsd: null,
    usageTerms: null,
  };
  for (const li of sub.lineItems ?? []) {
    const pd = li?.plan?.pricingDetails;
    if (!pd) continue;
    if (pd.__typename === "AppRecurringPricingDetails") {
      out.recurringPriceUsd = Number(pd.price?.amount ?? 0);
    } else if (pd.__typename === "AppUsagePricingDetails") {
      out.usageLineItemId = li.id;
      out.usageCappedUsd = Number(pd.cappedAmount?.amount ?? 0);
      out.usageBalanceUsd = Number(pd.balanceUsed?.amount ?? 0);
      out.usageTerms = pd.terms ?? null;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------

const SUBSCRIPTION_CREATE_MUTATION = `
  mutation GleameFlexSubscribe($name: String!, $returnUrl: URL!, $trialDays: Int!, $test: Boolean!, $terms: String!, $cap: Decimal!) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      replacementBehavior: STANDARD
      lineItems: [
        { plan: { appRecurringPricingDetails: { price: { amount: 0.00, currencyCode: USD }, interval: EVERY_30_DAYS } } }
        { plan: { appUsagePricingDetails: { terms: $terms, cappedAmount: { amount: $cap, currencyCode: USD } } } }
      ]
    ) {
      confirmationUrl
      appSubscription { id }
      userErrors { field message }
    }
  }
`;

export async function createFlexSubscription(
  graphql: GraphqlFn,
  opts: { returnUrl: string; trialDays: number; test: boolean },
): Promise<{ ok: true; confirmationUrl: string; subscriptionId: string } | { ok: false; error: string }> {
  const data = await graphql(SUBSCRIPTION_CREATE_MUTATION, {
    name: "Gleame",
    returnUrl: opts.returnUrl,
    trialDays: opts.trialDays,
    test: opts.test,
    terms: billingTermsText(),
    cap: USAGE_CAP_USD,
  });
  const result = data?.appSubscriptionCreate;
  const userError = result?.userErrors?.[0];
  if (userError) return { ok: false, error: `${userError.field ?? ""} ${userError.message}`.trim() };
  if (!result?.confirmationUrl || !result?.appSubscription?.id) {
    return { ok: false, error: "Shopify returned no confirmation URL" };
  }
  return { ok: true, confirmationUrl: result.confirmationUrl, subscriptionId: result.appSubscription.id };
}

const USAGE_RECORD_MUTATION = `
  mutation GleameTierUsage($lineItemId: ID!, $price: MoneyInput!, $description: String!, $idempotencyKey: String!) {
    appUsageRecordCreate(
      subscriptionLineItemId: $lineItemId
      price: $price
      description: $description
      idempotencyKey: $idempotencyKey
    ) {
      appUsageRecord { id }
      userErrors { field message }
    }
  }
`;

export async function postTierUsage(
  graphql: GraphqlFn,
  opts: { usageLineItemId: string; feeUsd: number; description: string; idempotencyKey: string },
): Promise<{ ok: boolean; error?: string }> {
  const data = await graphql(USAGE_RECORD_MUTATION, {
    lineItemId: opts.usageLineItemId,
    price: { amount: opts.feeUsd, currencyCode: "USD" },
    description: opts.description,
    // Shopify's idempotencyKey is capped at 255 chars.
    idempotencyKey: opts.idempotencyKey.slice(0, 255),
  });
  const result = data?.appUsageRecordCreate;
  const userError = result?.userErrors?.[0];
  if (userError) return { ok: false, error: `${userError.field ?? ""} ${userError.message}`.trim() };
  if (!result?.appUsageRecord?.id) return { ok: false, error: "No usage record returned" };
  return { ok: true };
}
