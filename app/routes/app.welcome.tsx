import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Box,
  Banner,
  Spinner,
  Collapsible,
  Modal,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import { identifyAndGetCustomer, subscribeCustomer } from "../lib/mantle.server";
import { getMonthlySessionsCount } from "../lib/shopify-analytics.server";
import { SESSION_TIERS } from "../lib/pricing-tiers";
import { 
  getMantlePlanForSessions, 
  getPlanNameForSessions,
  type MantlePlan,
} from "../lib/plan-matcher.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const accessToken = session.accessToken || "";

  try {
    // Identify customer and get their details with plans
    const { customer, apiToken } = await identifyAndGetCustomer(shopDomain, accessToken);
    const plans = (customer.plans || []) as MantlePlan[];
    const subscription = customer.subscription || null;
    
    // Check if user already has an active subscription - redirect to billing
    const hasActiveSubscription = subscription?.active === true;
    
    // Check for grace period (cancelled but still in billing period)
    let isInGracePeriod = false;
    if (!hasActiveSubscription && subscription?.currentPeriodEnd) {
      const periodEnd = new Date(subscription.currentPeriodEnd);
      isInGracePeriod = periodEnd > new Date();
    }
    
    // Fetch monthly sessions from Shopify Analytics
    const sessions = await getMonthlySessionsCount(admin);
    console.log(`📊 Welcome page - Sessions for ${shopDomain}: ${sessions}`);

    // Match sessions to the appropriate plan
    // Default to 0 sessions (Starter plan) if we couldn't fetch
    const effectiveSessions = sessions ?? 0;
    const matchedPlan = getMantlePlanForSessions(plans, effectiveSessions);
    const matchedPlanName = getPlanNameForSessions(effectiveSessions);

    if (!matchedPlan) {
      console.error('Could not find matching Mantle plan for sessions:', effectiveSessions);
    }

    return json({
      shopDomain,
      sessions: effectiveSessions,
      sessionsFetched: sessions !== null,
      matchedPlanId: matchedPlan?.id || null,
      matchedPlanName,
      matchedPlanPrice: matchedPlan?.subtotal ?? matchedPlan?.amount ?? null,
      customerApiToken: apiToken,
      hasActiveSubscription,
      isInGracePeriod,
      currentPlanName: subscription?.plan?.name || null,
      error: null,
    });
  } catch (error) {
    console.error("Error loading welcome page:", error);
    return json({
      shopDomain,
      sessions: 0,
      sessionsFetched: false,
      matchedPlanId: null,
      matchedPlanName: "Starter",
      matchedPlanPrice: 30,
      customerApiToken: null,
      hasActiveSubscription: false,
      isInGracePeriod: false,
      currentPlanName: null,
      error: error instanceof Error ? error.message : "Failed to load. Please try again.",
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const formData = await request.formData();
  const planId = formData.get("planId") as string;
  const customerApiToken = formData.get("customerApiToken") as string;

  if (!customerApiToken) {
    return json({ error: "Missing customer token" }, { status: 400 });
  }

  if (!planId) {
    return json({ error: "No plan selected" }, { status: 400 });
  }

  try {
    // Build return URL for after billing approval
    const shopHandle = shopDomain.replace('.myshopify.com', '');
    const appHandle = process.env.SHOPIFY_APP_HANDLE || 'gleame';
    const returnUrl = `https://admin.shopify.com/store/${shopHandle}/apps/${appHandle}/app/billing`;

    const subscription = await subscribeCustomer(customerApiToken, planId, returnUrl);

    if (subscription.confirmationUrl) {
      return json({ confirmationUrl: subscription.confirmationUrl.toString() });
    }

    return json({ success: true });
  } catch (error) {
    console.error("Welcome action error:", error);
    return json({
      error: error instanceof Error ? error.message : "Failed to start subscription",
    }, { status: 500 });
  }
};

export default function WelcomePage() {
  const { 
    matchedPlanId, 
    matchedPlanName,
    customerApiToken, 
    hasActiveSubscription,
    isInGracePeriod,
    currentPlanName,
    error 
  } = useLoaderData<typeof loader>();
  
  // Check if this is an Enterprise case (no plan but we have token)
  const isEnterprise = !matchedPlanId && customerApiToken && matchedPlanName === 'Enterprise';
  
  // Check if user is re-subscribing (either has active subscription or in grace period)
  const isResubscribing = isInGracePeriod;
  const shouldRedirectToBilling = hasActiveSubscription && !isInGracePeriod;
  
  const actionData = useActionData<{ confirmationUrl?: string; success?: boolean; error?: string }>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  
  const [pricingOpen, setPricingOpen] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  
  const isLoading = navigation.state === "submitting";

  // Redirect to billing if user already has an active subscription
  useEffect(() => {
    if (shouldRedirectToBilling) {
      navigate('/app/billing', { replace: true });
    }
  }, [shouldRedirectToBilling, navigate]);

  // Show confirmation modal when we get a confirmation URL
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      setShowConfirmModal(true);
    }
  }, [actionData?.confirmationUrl]);

  const handleContinue = () => {
    if (!matchedPlanId || !customerApiToken) {
      return;
    }
    
    const formData = new FormData();
    formData.append("planId", matchedPlanId);
    formData.append("customerApiToken", customerApiToken);
    submit(formData, { method: "POST" });
  };

  return (
    <Page>
      {/* Billing confirmation modal */}
      <Modal
        open={showConfirmModal && !!actionData?.confirmationUrl}
        onClose={() => setShowConfirmModal(false)}
        title={isResubscribing ? "Re-activate Your Subscription" : "Complete Your Subscription"}
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
              You'll be redirected to Shopify's secure billing page to {isResubscribing ? "re-activate" : "complete"} your subscription.
            </Text>
            {!isResubscribing && (
              <Text as="p" variant="bodySm" tone="subdued">
                Your subscription includes a 14-day free trial. You won't be charged until the trial ends.
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Box paddingBlockStart="1000" paddingBlockEnd="1000">
        <BlockStack gap="600" inlineAlign="center">
          {/* Main welcome card */}
          <div style={{ maxWidth: '600px', width: '100%' }}>
            <Card>
              <BlockStack gap="500">
                {/* Heading - different for re-subscribers */}
                <Text as="h1" variant="headingXl">
                  {isResubscribing 
                    ? "Welcome back! Ready to continue?" 
                    : "Ready to transform your store? Let's get started!"}
                </Text>

                {/* Trial info - different for re-subscribers */}
                {isResubscribing ? (
                  <Banner tone="info">
                    <Text as="p">
                      You previously had the <strong>{currentPlanName}</strong> plan. 
                      Click below to re-activate your subscription based on your current traffic.
                    </Text>
                  </Banner>
                ) : (
                  <Text as="p" variant="bodyLg">
                    Your subscription starts with a <Text as="span" fontWeight="bold">14-day free trial</Text> :)
                  </Text>
                )}

                {/* Pricing explanation */}
                <Text as="p" variant="bodyMd" tone="subdued">
                  {isResubscribing 
                    ? "Your plan will be automatically selected based on your store's current monthly session count."
                    : "After the 14-day free trial, pricing plans start from $30/month (0-5k sessions) and increase incrementally based on your store's monthly session count (up to $1,499/month for stores with 500k sessions/month)."
                  }
                </Text>

                {/* Expandable pricing table */}
                <Box>
                  <Button
                    variant="plain"
                    onClick={() => setPricingOpen(!pricingOpen)}
                    icon={pricingOpen ? ChevronUpIcon : ChevronDownIcon}
                    textAlign="left"
                  >
                    See pricing table
                  </Button>
                  
                  <Collapsible
                    open={pricingOpen}
                    id="pricing-table-collapsible"
                    transition={{ duration: '200ms', timingFunction: 'ease-in-out' }}
                  >
                    <Box paddingBlockStart="400">
                      <BlockStack gap="200">
                        {SESSION_TIERS.map((tier) => (
                          <InlineStack key={tier.name} align="space-between">
                            <Text as="p" variant="bodyMd">
                              {tier.name}: {tier.visitors}/month
                            </Text>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {tier.price !== null ? `$${tier.price}` : 'Custom'}
                            </Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </Box>
                  </Collapsible>
                </Box>

                {/* Error banner */}
                {(error || actionData?.error) && (
                  <Banner tone="critical">
                    <BlockStack gap="200">
                      <Text as="p">{error || actionData?.error}</Text>
                      <Box>
                        <Button onClick={() => window.location.reload()}>
                          Try again
                        </Button>
                      </Box>
                    </BlockStack>
                  </Banner>
                )}

                {/* Enterprise tier message */}
                {isEnterprise && (
                  <Banner tone="info">
                    <BlockStack gap="200">
                      <Text as="p">
                        Your store's traffic qualifies for our Enterprise plan with custom pricing.
                        Please contact us to set up your account.
                      </Text>
                      <Box>
                        <Button url="mailto:aaron@gleame.ai">
                          Contact sales
                        </Button>
                      </Box>
                    </BlockStack>
                  </Banner>
                )}

                {/* CTA Button */}
                <Box paddingBlockStart="200">
                  <Button
                    variant="primary"
                    size="large"
                    fullWidth
                    onClick={handleContinue}
                    disabled={isLoading || !matchedPlanId || shouldRedirectToBilling}
                    loading={isLoading}
                  >
                    {isResubscribing ? "Re-subscribe to Gleame" : "Continue to Gleame"}
                  </Button>
                </Box>

                {/* Social proof / trust indicators */}
                <Box paddingBlockStart="200">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      {isResubscribing 
                        ? "Pick up right where you left off"
                        : "Join thousands of stores using AI-powered product visualization"
                      }
                    </Text>
                    <InlineStack gap="400" align="center">
                      {!isResubscribing && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          14-day free trial
                        </Text>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">
                        Cancel anytime
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </div>

          {/* Loading indicator if still loading (no token yet) */}
          {!customerApiToken && !error && (
            <InlineStack align="center" gap="200">
              <Spinner size="small" />
              <Text as="p" tone="subdued">Loading your plan...</Text>
            </InlineStack>
          )}
        </BlockStack>
      </Box>
    </Page>
  );
}
