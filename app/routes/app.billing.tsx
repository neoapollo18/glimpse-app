import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Box,
  Banner,
  Spinner,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { 
  identifyAndGetCustomer, 
  subscribeCustomer,
  cancelSubscription,
} from "../lib/mantle.server";
import { getMonthlySessionsCount } from "../lib/shopify-analytics.server";
import { SESSION_TIERS } from "../lib/pricing-tiers";
import { 
  getPlanChangeInfo, 
  getMantlePlanForSessions,
  type MantlePlan,
} from "../lib/plan-matcher.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const accessToken = session.accessToken || "";

  try {
    // Identify customer and get their details with plans and subscription
    const { customer, apiToken } = await identifyAndGetCustomer(shopDomain, accessToken);
    
    const customerApiToken = apiToken;
    const plans = (customer.plans || []) as MantlePlan[];
    const subscription = customer.subscription || null;
    const currentPlanName = subscription?.plan?.name || null;

    // Fetch current sessions for traffic change detection
    let sessions: number | null = null;
    let planChangeInfo: ReturnType<typeof getPlanChangeInfo> = null;
    let suggestedPlanId: string | null = null;

    try {
      sessions = await getMonthlySessionsCount(admin);
      
      // Check if traffic has changed and plan needs updating
      if (sessions !== null && currentPlanName) {
        planChangeInfo = getPlanChangeInfo(currentPlanName, sessions);
        
        // Find the suggested Mantle plan ID if there's a change
        if (planChangeInfo) {
          const suggestedMantlePlan = getMantlePlanForSessions(plans, sessions);
          suggestedPlanId = suggestedMantlePlan?.id || null;
        }
      }
    } catch (sessionsError) {
      // Sessions fetch failed - that's OK, just don't show change notification
      console.error("Error fetching sessions for billing page:", sessionsError);
    }
    
    return json({
      shopDomain,
      customer,
      customerApiToken,
      plans,
      subscription,
      sessions,
      planChangeInfo,
      suggestedPlanId,
      error: null,
    });
  } catch (error) {
    console.error("Error loading billing:", error);
    return json({
      shopDomain,
      customer: null,
      customerApiToken: null,
      plans: [],
      subscription: null,
      sessions: null,
      planChangeInfo: null,
      suggestedPlanId: null,
      error: error instanceof Error ? error.message : "Failed to load billing information. Please try again.",
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  const formData = await request.formData();
  const planId = formData.get("planId") as string;
  const actionType = formData.get("action") as string;
  const customerApiToken = formData.get("customerApiToken") as string;

  if (!customerApiToken) {
    return json({ error: "Missing customer token" }, { status: 400 });
  }

  try {
    if (actionType === "subscribe") {
      // Subscribe to plan
      // For embedded apps, return URL must go through Shopify Admin to maintain session
      // Extract shop handle from domain (e.g., "myshop" from "myshop.myshopify.com")
      const shopHandle = shopDomain.replace('.myshopify.com', '');
      // App handle should match your Shopify app's URL slug (usually lowercase)
      const appHandle = process.env.SHOPIFY_APP_HANDLE || 'gleame';
      const returnUrl = `https://admin.shopify.com/store/${shopHandle}/apps/${appHandle}/app/billing`;
      
      const subscription = await subscribeCustomer(customerApiToken, planId, returnUrl);
      
      // Return confirmationUrl for client-side redirect
      // Client will use window.open(url, '_top') to break out of iframe
      if (subscription.confirmationUrl) {
        return json({ confirmationUrl: subscription.confirmationUrl.toString() });
      }
      
      return json({ success: true });
    }

    if (actionType === "cancel") {
      await cancelSubscription(customerApiToken);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Billing action error:", error);
    return json({ 
      error: error instanceof Error ? error.message : "Failed to process billing action" 
    }, { status: 500 });
  }
};

interface Subscription {
  id: string;
  active: boolean;
  plan: {
    name: string;
    amount: number;
    subtotal: number;
  };
  trialExpiresAt?: string;
  currentPeriodEnd?: string;
}

export default function BillingPage() {
  const { 
    customerApiToken, 
    subscription, 
    sessions,
    planChangeInfo,
    suggestedPlanId,
    error 
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ confirmationUrl?: string; success?: boolean; error?: string }>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  
  const isLoading = navigation.state === "submitting";

  // Show confirmation modal when we get a confirmation URL
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      setShowConfirmModal(true);
    }
  }, [actionData?.confirmationUrl]);

  const handlePlanChange = () => {
    if (!suggestedPlanId || !customerApiToken) return;
    
    const formData = new FormData();
    formData.append("action", "subscribe");
    formData.append("planId", suggestedPlanId);
    formData.append("customerApiToken", customerApiToken);
    submit(formData, { method: "POST" });
  };

  const handleCancel = () => {
    if (confirm("Are you sure you want to cancel your subscription?")) {
      const formData = new FormData();
      formData.append("action", "cancel");
      formData.append("customerApiToken", customerApiToken || "");
      submit(formData, { method: "POST" });
    }
  };

  const currentPlanName = (subscription as Subscription | null)?.plan?.name || "No Plan";
  const isActive = (subscription as Subscription | null)?.active === true;
  const typedSubscription = subscription as Subscription | null;

  return (
    <Page>
      <TitleBar title="Billing" />
      
      {/* Billing confirmation modal */}
      <Modal
        open={showConfirmModal && !!actionData?.confirmationUrl}
        onClose={() => setShowConfirmModal(false)}
        title="Complete Your Subscription"
        primaryAction={{
          content: "Continue to Shopify Billing",
          url: actionData?.confirmationUrl || "",
          target: "_top",
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowConfirmModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              You'll be redirected to Shopify's secure billing page to complete your subscription.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Your subscription includes a 14-day free trial. You won't be charged until the trial ends.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      <BlockStack gap="600">
        {error && (
          <Banner tone="critical">
            <Text as="p">{error}</Text>
          </Banner>
        )}

        {actionData?.error && (
          <Banner tone="critical">
            <Text as="p">{actionData.error}</Text>
          </Banner>
        )}

        {isLoading && (
          <Banner tone="info">
            <InlineStack align="center" gap="200">
              <Spinner size="small" />
              <Text as="p">Processing your request...</Text>
            </InlineStack>
          </Banner>
        )}

        {/* Traffic change notification */}
        {planChangeInfo && suggestedPlanId && (
          <Banner 
            tone={planChangeInfo.isUpgrade ? "warning" : "info"}
            title="Your traffic has changed"
          >
            <BlockStack gap="300">
              <Text as="p">
                Based on your current traffic ({sessions?.toLocaleString()} sessions/month), 
                your plan should be updated to <strong>{planChangeInfo.suggestedPlan.name}</strong> (
                {planChangeInfo.suggestedPlan.price !== null 
                  ? `$${planChangeInfo.suggestedPlan.price}/month` 
                  : 'Custom pricing'
                }).
              </Text>
              <Box>
                <Button onClick={handlePlanChange} disabled={isLoading}>
                  {planChangeInfo.isUpgrade ? "Upgrade plan" : "Update plan"}
                </Button>
              </Box>
            </BlockStack>
          </Banner>
        )}

        {/* Your Plan + Pricing Tiers - Read-only layout */}
        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">Your Plan</Text>
                
                {isActive && typedSubscription ? (
                  <BlockStack gap="300">
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      {currentPlanName}
                    </Text>
                    <Text as="p" variant="headingLg">
                      ${typedSubscription.plan?.subtotal || typedSubscription.plan?.amount || 0}/month
                    </Text>
                    {typedSubscription.currentPeriodEnd && (
                      <Text as="p" variant="bodyMd">
                        Next Billing Date: {new Date(typedSubscription.currentPeriodEnd).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </Text>
                    )}
                    
                    {typedSubscription.trialExpiresAt && (
                      <Text as="p" variant="bodyMd" tone="success">
                        Trial ends: {new Date(typedSubscription.trialExpiresAt).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </Text>
                    )}

                    {typedSubscription.plan && typedSubscription.plan.subtotal > 0 && (
                      <Box paddingBlockStart="200">
                        <Button variant="plain" tone="critical" onClick={handleCancel} disabled={isLoading}>
                          Cancel subscription
                        </Button>
                      </Box>
                    )}
                  </BlockStack>
                ) : (
                  <BlockStack gap="300">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No active plan
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Your plan will be assigned automatically based on your store's traffic.
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">Pricing Tiers</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Pricing is automatically determined based on your store's monthly session count.
                </Text>
                
                <BlockStack gap="300">
                  {SESSION_TIERS.map((tier) => {
                    const isCurrent = currentPlanName === tier.name;
                    
                    return (
                      <InlineStack key={tier.name} align="space-between" blockAlign="center">
                        <Text as="p" variant="bodyMd" fontWeight={isCurrent ? "bold" : "regular"}>
                          {tier.name}: {tier.visitors}/month
                        </Text>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="p" variant="bodyMd" fontWeight={isCurrent ? "bold" : "regular"}>
                            {tier.price !== null ? `$${tier.price}` : 'Custom'}
                          </Text>
                          {isCurrent && <Badge>Current</Badge>}
                        </InlineStack>
                      </InlineStack>
                    );
                  })}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Help Section */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">Questions about billing?</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              All plans are billed through Shopify and include a 14-day free trial. 
              Pricing is automatically determined based on your store's monthly session count. 
              If your traffic changes, we'll notify you to approve a plan update.
              Contact us at aaron@gleame.ai if you need help.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
