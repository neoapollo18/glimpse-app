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
  Divider,
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const accessToken = session.accessToken || "";

  try {
    // Identify customer and get their details with plans and subscription
    const { customer, apiToken } = await identifyAndGetCustomer(shopDomain, accessToken);
    
    const customerApiToken = apiToken;
    
    return json({
      shopDomain,
      customer,
      customerApiToken,
      plans: customer.plans || [],
      subscription: customer.subscription || null,
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

interface Plan {
  id: string;
  name: string;
  amount: number;
  subtotal: number;
  total: number;
  currencyCode: string;
  interval: string;
  trialDays: number;
  description?: string;
  features?: Record<string, { name: string; value: string | number | boolean }>;
  featuresOrder?: string[];
}

interface Subscription {
  id: string;
  active: boolean;
  plan: Plan;
  trialExpiresAt?: string;
  currentPeriodEnd?: string;
}

// Visitor-based pricing tiers (matching your Shopify app store pricing)
const PRICING_TIERS: { name: string; visitors: string; price: string }[] = [
  { name: 'Starter', visitors: '0-5k visitors', price: '$30' },
  { name: 'Launch', visitors: '5k-25k visitors', price: '$149' },
  { name: 'Growth', visitors: '25k-75k visitors', price: '$299' },
  { name: 'Scale', visitors: '75k-150k visitors', price: '$499' },
  { name: 'Premium', visitors: '150k-300k visitors', price: '$999' },
  { name: 'Enterprise', visitors: '300k+ visitors', price: 'Custom' },
];

export default function BillingPage() {
  const { customer, customerApiToken, plans, subscription, error } = useLoaderData<typeof loader>();
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

  const handleSubscribe = (planId: string) => {
    const formData = new FormData();
    formData.append("action", "subscribe");
    formData.append("planId", planId);
    formData.append("customerApiToken", customerApiToken || "");
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
  const typedPlans = plans as Plan[];

  // Sort plans by price
  const sortedPlans = [...typedPlans].sort((a, b) => (a.subtotal || a.amount || 0) - (b.subtotal || b.amount || 0));

  // Get visitor range for current plan
  const getVisitorRange = (planName: string): string => {
    const tier = PRICING_TIERS.find(t => t.name === planName);
    return tier?.visitors || '';
  };

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

        {/* Your Plan + Pricing Tiers - Aftersell style layout */}
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
                      Select a plan below to get started with Gleame.
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
                  Pricing is based on your store's monthly visitor count. Choose the tier that matches your traffic.
                </Text>
                
                <BlockStack gap="300">
                  {PRICING_TIERS.map((tier) => {
                    const isCurrent = currentPlanName === tier.name;
                    
                    return (
                      <InlineStack key={tier.name} align="space-between" blockAlign="center">
                        <Text as="p" variant="bodyMd" fontWeight={isCurrent ? "bold" : "regular"}>
                          {tier.name}: {tier.visitors}/month → {tier.price}
                        </Text>
                        {isCurrent && <Badge>Current</Badge>}
                      </InlineStack>
                    );
                  })}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Plan Selection Cards */}
        <Text as="h2" variant="headingLg">
          {isActive ? "Switch Plans" : "Select a Plan to Get Started"}
        </Text>
        
        <Layout>
          {sortedPlans.map((plan: Plan) => {
            const isCurrent = currentPlanName === plan.name;
            const priceAmount = plan.subtotal || plan.amount || 0;
            const visitorRange = getVisitorRange(plan.name);
            
            return (
              <Layout.Section key={plan.id} variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingMd">{plan.name}</Text>
                        {isCurrent && <Badge tone="info">Current</Badge>}
                      </InlineStack>
                      
                      {visitorRange && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {visitorRange}
                        </Text>
                      )}
                    </BlockStack>
                    
                    <BlockStack gap="100">
                      <InlineStack gap="100" blockAlign="end">
                        <Text as="p" variant="heading2xl">
                          ${priceAmount}
                        </Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          /month
                        </Text>
                      </InlineStack>
                      
                      {plan.trialDays > 0 && !isActive && (
                        <Text as="p" variant="bodySm" tone="success">
                          {plan.trialDays}-day free trial
                        </Text>
                      )}
                    </BlockStack>

                    <Box>
                      {isCurrent ? (
                        <Button disabled fullWidth size="large">
                          Current plan
                        </Button>
                      ) : (
                        <Button 
                          variant="primary"
                          fullWidth
                          size="large"
                          onClick={() => handleSubscribe(plan.id)}
                          disabled={isLoading}
                        >
                          {plan.trialDays > 0 && !isActive ? "Start free trial" : isActive ? "Switch plan" : "Select plan"}
                        </Button>
                      )}
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        {typedPlans.length === 0 && !error && (
          <Card>
            <BlockStack gap="300" inlineAlign="center">
              <Text as="p" variant="bodyLg" tone="subdued">
                Loading available plans...
              </Text>
              <Spinner size="small" />
            </BlockStack>
          </Card>
        )}

        {/* Help Section */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">Questions about billing?</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              All plans are billed through Shopify and include a 14-day free trial. 
              Pricing is based on your store's monthly visitor count. 
              Contact us at support@gleameapp.com if you need help.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
