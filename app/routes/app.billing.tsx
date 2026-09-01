import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { SESSION_TIERS } from "../lib/pricing-tiers";
import {
  adminGraphql,
  billingTermsText,
  createFlexSubscription,
  getActiveSubscription,
  tierForSessions,
  type ActiveSubscription,
} from "../lib/shopify-billing.server";
import { invalidateBillingCache } from "../lib/billing-gate.server";
import { getShopBillingState, updateShopBillingState } from "../lib/supabase.server";

// Shopify-native billing (Mantle replacement). One flex subscription:
// $0 recurring + usage line capped at the top tier; the merchant approves
// once and the monthly cron posts their session-tier fee. See
// shopify-billing.server.ts for the model.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const state = await getShopBillingState(shopDomain);
  let subscription: ActiveSubscription | null = null;
  let subError: string | null = null;
  try {
    subscription = await getActiveSubscription(adminGraphql(admin));
  } catch (e) {
    subError = e instanceof Error ? e.message : "Could not load subscription state";
  }

  // Persist fresh subscription facts — the cron and gate read these.
  if (subscription?.usageLineItemId) {
    await updateShopBillingState(shopDomain, {
      shopify_subscription_id: subscription.id,
      usage_line_item_id: subscription.usageLineItemId,
      current_period_end: subscription.currentPeriodEnd,
    });
  }
  // A just-approved subscription must unlock the app immediately, not
  // after the gate cache's TTL.
  if (subscription?.status === "ACTIVE") invalidateBillingCache(shopDomain);

  const sessions = state?.monthly_sessions ?? 0;
  const match = tierForSessions(sessions);
  return json({
    shopDomain,
    grandfathered: state?.subscription_status === "grandfathered",
    sessions,
    tierName: match.tier.name,
    tierFee: match.fee,
    subscription,
    subError,
    terms: billingTermsText(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  if (formData.get("intent") !== "subscribe") {
    return json({ error: "Unknown intent" }, { status: 400 });
  }

  const state = await getShopBillingState(shopDomain);
  // One trial per shop: anyone who ever held a subscription (incl. via
  // Mantle) starts billing immediately on approval.
  const hadSubscription = Boolean(
    state?.shopify_subscription_id ||
      (state?.subscription_status && !["none", "pending"].includes(state.subscription_status)),
  );
  const shopHandle = shopDomain.replace(".myshopify.com", "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "gleame";
  const returnUrl = `https://admin.shopify.com/store/${shopHandle}/apps/${appHandle}/app/billing`;

  const result = await createFlexSubscription(adminGraphql(admin), {
    returnUrl,
    trialDays: hadSubscription ? 0 : 14,
    test: process.env.BILLING_TEST_CHARGES === "true",
  });
  if (!result.ok) return json({ error: result.error }, { status: 500 });

  // Merchant must approve on Shopify's page — leave the iframe.
  return redirect(result.confirmationUrl, { target: "_top" });
};

export default function BillingPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const sub = data.subscription;
  const subscribed = sub?.status === "ACTIVE";

  return (
    <Page>
      <TitleBar title="Billing" />
      <BlockStack gap="500">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Couldn't start the subscription">
            {actionData.error}
          </Banner>
        )}
        {data.subError && (
          <Banner tone="warning">
            Couldn't refresh your subscription state from Shopify ({data.subError}). Showing the last known info.
          </Banner>
        )}

        {data.grandfathered ? (
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Your plan</Text>
                <Badge tone="success">Free forever</Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd">
                Your store is grandfathered — every Gleame feature is included
                at no charge, permanently. Nothing to do here.
              </Text>
            </BlockStack>
          </Card>
        ) : subscribed ? (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Your plan</Text>
                <Badge tone="success">Active</Badge>
                {sub?.test && <Badge tone="info">Test mode</Badge>}
              </InlineStack>
              <Text as="p" variant="bodyMd">
                You're on Gleame's usage-based plan: your monthly charge
                follows your store's traffic automatically, and you never pay
                more than $399/month.
              </Text>
              <InlineStack gap="600">
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">Current tier</Text>
                  <Text as="p" variant="headingMd">
                    {data.tierName} {data.tierFee > 0 ? `($${data.tierFee}/mo)` : "(free)"}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">Monthly sessions</Text>
                  <Text as="p" variant="headingMd">{data.sessions.toLocaleString()}</Text>
                </BlockStack>
                {sub?.currentPeriodEnd && (
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" tone="subdued">Current period ends</Text>
                    <Text as="p" variant="headingMd">
                      {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                    </Text>
                  </BlockStack>
                )}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Tier changes apply automatically — no approvals needed. Cancel
                any time by uninstalling the app.
              </Text>
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Simple, traffic-based pricing</Text>
                <Text as="p" variant="bodyMd">
                  One approval covers every tier. Your monthly charge follows
                  your store's traffic — up when you grow, down when you slow,
                  free under 2,500 sessions. Capped at $399/month, always.
                </Text>
              </BlockStack>

              <Box borderColor="border" borderWidth="025" borderRadius="200" padding="0">
                {SESSION_TIERS.map((tier, i) => (
                  <div key={tier.name}>
                    {i > 0 && <Divider />}
                    <Box padding="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">{tier.name}</Text>
                          {tier.name === data.tierName && <Badge tone="info">Your store today</Badge>}
                        </InlineStack>
                        <InlineStack gap="400">
                          <Text as="span" variant="bodySm" tone="subdued">{tier.visitors}</Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {tier.price === 0 ? "Free" : `$${tier.price}/mo`}
                          </Text>
                        </InlineStack>
                      </InlineStack>
                    </Box>
                  </div>
                ))}
              </Box>

              <Text as="p" variant="bodySm" tone="subdued">
                Your store's last 90 days average {data.sessions.toLocaleString()} monthly
                sessions, so you'd start on <b>{data.tierName}</b>
                {data.tierFee > 0 ? ` at $${data.tierFee}/mo` : " for free"}. New
                subscriptions start with a 14-day free trial.
              </Text>

              <InlineStack gap="300" blockAlign="center">
                <Button
                  variant="primary"
                  size="large"
                  loading={submitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "subscribe");
                    submit(fd, { method: "POST" });
                  }}
                >
                  Approve billing on Shopify
                </Button>
                <Text as="span" variant="bodySm" tone="subdued">
                  You'll review and approve on Shopify's page before anything is charged.
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
