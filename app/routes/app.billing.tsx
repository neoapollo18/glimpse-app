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

    // Check for grace period (cancelled but still within billing period)
    let isInGracePeriod = false;
    let gracePeriodEndsAt: string | null = null;
    if (!subscription?.active && subscription?.currentPeriodEnd) {
      const periodEnd = new Date(subscription.currentPeriodEnd);
      isInGracePeriod = periodEnd > new Date();
      if (isInGracePeriod) {
        gracePeriodEndsAt = subscription.currentPeriodEnd;
      }
    }

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
      isInGracePeriod,
      gracePeriodEndsAt,
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
      isInGracePeriod: false,
      gracePeriodEndsAt: null,
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
      if (!planId) {
        return json({ error: "No plan specified" }, { status: 400 });
      }
      
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
    isInGracePeriod,
    gracePeriodEndsAt,
    error 
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ confirmationUrl?: string; success?: boolean; error?: string }>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCancelSuccess, setShowCancelSuccess] = useState(false);
  
  const isLoading = navigation.state === "submitting";
  const actionIntent = navigation.formData?.get("action") as string | null;

  // Show confirmation modal when we get a confirmation URL
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      setShowConfirmModal(true);
    }
  }, [actionData?.confirmationUrl]);
  
  // Show success message after cancel and reload to get fresh state
  useEffect(() => {
    if (actionData?.success && !actionData?.confirmationUrl) {
      setShowCancelSuccess(true);
      // Reload after a moment to show fresh subscription state
      const timer = setTimeout(() => {
        window.location.reload();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [actionData?.success, actionData?.confirmationUrl]);

  const handlePlanChange = () => {
    if (!suggestedPlanId || !customerApiToken || isLoading) return;
    
    // Confirm before plan change
    const confirmMsg = planChangeInfo?.isUpgrade 
      ? `This will upgrade your plan to ${planChangeInfo.suggestedPlan.name} at $${planChangeInfo.suggestedPlan.price}/month. Continue?`
      : `This will update your plan to ${planChangeInfo?.suggestedPlan.name} at $${planChangeInfo?.suggestedPlan.price}/month. Continue?`;
    
    if (!confirm(confirmMsg)) return;
    
    const formData = new FormData();
    formData.append("action", "subscribe");
    formData.append("planId", suggestedPlanId);
    formData.append("customerApiToken", customerApiToken);
    submit(formData, { method: "POST" });
  };

  const currentPlanName = (subscription as Subscription | null)?.plan?.name || "No Plan";
  const isActive = (subscription as Subscription | null)?.active === true;
  const typedSubscription = subscription as Subscription | null;
  
  // Check if user is currently in trial
  const isInTrial = isActive && 
    typedSubscription?.trialExpiresAt && 
    new Date(typedSubscription.trialExpiresAt) > new Date();

  const handleCancel = () => {
    // Prevent double-clicks
    if (isLoading || showCancelSuccess) return;
    
    // Different warning for trial vs paid users
    const confirmMessage = isInTrial
      ? "You're currently in your free trial. Canceling now will end your access immediately. Are you sure you want to cancel?"
      : "Are you sure you want to cancel your subscription? You'll retain access until the end of your current billing period.";
    
    if (confirm(confirmMessage)) {
      const formData = new FormData();
      formData.append("action", "cancel");
      formData.append("customerApiToken", customerApiToken || "");
      submit(formData, { method: "POST" });
    }
  };
  
  // Show plan details if active OR in grace period (still have access)
  const showPlanDetails = isActive || isInGracePeriod;

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
              <Text as="p">
                {actionIntent === "cancel" ? "Cancelling your subscription..." : "Processing your request..."}
              </Text>
            </InlineStack>
          </Banner>
        )}

        {/* Cancel success message */}
        {showCancelSuccess && (
          <Banner tone="success" title="Subscription cancelled">
            <Text as="p">
              Your subscription has been cancelled. The page will refresh momentarily.
            </Text>
          </Banner>
        )}

        {/* Grace period notification */}
        {isInGracePeriod && gracePeriodEndsAt && (
          <Banner tone="warning" title="Subscription cancelled">
            <BlockStack gap="300">
              <Text as="p">
                Your subscription has been cancelled. You still have access until{' '}
                <strong>
                  {new Date(gracePeriodEndsAt).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </strong>
                .
              </Text>
              <Box>
                <Button url="/app/welcome">
                  Re-subscribe now
                </Button>
              </Box>
            </BlockStack>
          </Banner>
        )}

        {/* Traffic change notification - only show if NOT in grace period */}
        {!isInGracePeriod && planChangeInfo && suggestedPlanId && (
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
                
                {showPlanDetails && typedSubscription ? (
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="headingMd" fontWeight="bold">
                        {currentPlanName}
                      </Text>
                      {isInGracePeriod && (
                        <Badge tone="warning">Cancelled</Badge>
                      )}
                      {isInTrial && (
                        <Badge tone="success">Trial</Badge>
                      )}
                    </InlineStack>
                    <Text as="p" variant="headingLg">
                      ${typedSubscription.plan?.subtotal || typedSubscription.plan?.amount || 0}/month
                    </Text>
                    
                    {/* Show different info based on state */}
                    {isInGracePeriod && gracePeriodEndsAt ? (
                      <Text as="p" variant="bodyMd" tone="caution">
                        Access ends: {new Date(gracePeriodEndsAt).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </Text>
                    ) : typedSubscription.currentPeriodEnd ? (
                      <Text as="p" variant="bodyMd">
                        Next Billing Date: {new Date(typedSubscription.currentPeriodEnd).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </Text>
                    ) : null}
                    
                    {/* Show trial info only if in trial */}
                    {isInTrial && typedSubscription.trialExpiresAt && (
                      <Text as="p" variant="bodyMd" tone="success">
                        Trial ends: {new Date(typedSubscription.trialExpiresAt).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </Text>
                    )}

                    {/* Only show cancel button if active (not in grace period) */}
                    {/* Show cancel for any paid plan (subtotal > 0) OR during trial */}
                    {isActive && typedSubscription.plan && (
                      typedSubscription.plan.subtotal > 0 || 
                      typedSubscription.plan.amount > 0 || 
                      isInTrial
                    ) && (
                      <Box paddingBlockStart="200">
                        <Button 
                          variant="plain" 
                          tone="critical" 
                          onClick={handleCancel} 
                          disabled={isLoading || showCancelSuccess}
                        >
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
                    // Case-insensitive comparison to match plan-matcher logic
                    const isCurrent = currentPlanName.toLowerCase() === tier.name.toLowerCase();
                    
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
