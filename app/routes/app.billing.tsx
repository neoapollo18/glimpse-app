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

  const currentPlanName = (subscription as Subscription | null)?.plan?.name || "Free";
  const isActive = (subscription as Subscription | null)?.active === true;
  const isFree = !subscription || currentPlanName === "Free";
  const typedSubscription = subscription as Subscription | null;
  const typedPlans = plans as Plan[];

  return (
    <Page>
      <TitleBar title="Billing & Plans" />
      
      {/* Billing confirmation modal - user must click to navigate to Shopify billing */}
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
          <Text as="p">
            Click the button below to complete your subscription on Shopify's secure billing page.
          </Text>
        </Modal.Section>
      </Modal>
      
      <BlockStack gap="500">
        {error && (
          <Banner tone="critical">
            <Text as="p">{error}</Text>
          </Banner>
        )}

        {isLoading && (
          <InlineStack align="center" gap="200">
            <Spinner size="small" />
            <Text as="p">Processing...</Text>
          </InlineStack>
        )}

        {/* Current Plan */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Current Plan</Text>
                
                <InlineStack gap="300" align="start" blockAlign="center">
                  <Text as="p" variant="headingLg">{currentPlanName}</Text>
                  {isFree ? (
                    <Badge tone="info">Free tier</Badge>
                  ) : isActive ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="warning">Inactive</Badge>
                  )}
                </InlineStack>

                {typedSubscription && (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      ${typedSubscription.plan?.subtotal || typedSubscription.plan?.amount || 0}/{typedSubscription.plan?.interval === "ANNUAL" ? "year" : "month"}
                    </Text>
                    {typedSubscription.trialExpiresAt && (
                      <Text as="p" variant="bodySm" tone="success">
                        Trial ends: {new Date(typedSubscription.trialExpiresAt).toLocaleDateString()}
                      </Text>
                    )}
                    {typedSubscription.currentPeriodEnd && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Next billing: {new Date(typedSubscription.currentPeriodEnd).toLocaleDateString()}
                      </Text>
                    )}
                  </BlockStack>
                )}

                {isActive && typedSubscription?.plan && typedSubscription.plan.subtotal > 0 && (
                  <Button variant="plain" tone="critical" onClick={handleCancel} disabled={isLoading}>
                    Cancel subscription
                  </Button>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Divider />

        {/* Available Plans */}
        <Text as="h2" variant="headingLg">Available Plans</Text>
        
        <Layout>
          {typedPlans.map((plan: Plan) => {
            const isCurrent = currentPlanName === plan.name;
            const priceAmount = plan.subtotal || plan.amount || 0;
            
            return (
              <Layout.Section key={plan.id} variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingMd">{plan.name}</Text>
                        {isCurrent && (
                          <Badge tone="info">Current</Badge>
                        )}
                      </InlineStack>
                      
                      <Text as="p" variant="headingXl">
                        ${priceAmount}
                        <Text as="span" variant="bodySm" tone="subdued">
                          /{plan.interval === "ANNUAL" ? "year" : "month"}
                        </Text>
                      </Text>
                      
                      {plan.trialDays > 0 && !isActive && (
                        <Text as="p" variant="bodySm" tone="success">
                          {plan.trialDays}-day free trial
                        </Text>
                      )}
                    </BlockStack>

                    {plan.description && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {plan.description}
                      </Text>
                    )}

                    {/* Features list */}
                    {plan.features && plan.featuresOrder && plan.featuresOrder.length > 0 && (
                      <BlockStack gap="100">
                        {plan.featuresOrder.map((featureKey: string) => {
                          const feature = plan.features?.[featureKey];
                          if (!feature) return null;
                          return (
                            <InlineStack key={featureKey} gap="200" blockAlign="center">
                              <Text as="span" variant="bodySm">✓</Text>
                              <Text as="span" variant="bodySm">
                                {feature.name}: {String(feature.value)}
                              </Text>
                            </InlineStack>
                          );
                        })}
                      </BlockStack>
                    )}
                    
                    <Box paddingBlockStart="200">
                      {isCurrent ? (
                        <Button disabled fullWidth>
                          Current plan
                        </Button>
                      ) : (
                        <Button 
                          variant="primary" 
                          fullWidth
                          onClick={() => handleSubscribe(plan.id)}
                          disabled={isLoading}
                        >
                          {priceAmount === 0 ? "Select" : isActive ? "Switch plan" : "Subscribe"}
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
            <Text as="p" tone="subdued" alignment="center">
              No plans available at this time.
            </Text>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
