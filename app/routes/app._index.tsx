import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Box,
  Icon,
  Badge,
  Button,
  Divider,
  Banner,
  ProgressBar,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ClockIcon,
  ProductIcon,
  ChartVerticalFilledIcon,
  SettingsIcon,
  ViewIcon,
  PlusCircleIcon,
  EditIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConfiguredProducts, getAnalytics } from "../lib/supabase.server";

interface ConfiguredProduct {
  id: string;
  product_name: string;
  shopify_id: string;
  transformation_prompt: string;
  created_at: string;
}

interface ProductStat {
  product_id: string;
  product_name: string;
  shopify_id: string;
  transformations: number;
}

interface LoaderData {
  shopDomain: string;
  configuredProducts: ConfiguredProduct[];
  configuredProductsCount: number;
  activeProducts: number;
  productStats: ProductStat[];
  allStepsComplete: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get configured products (full data)
  const configuredProducts = await getConfiguredProducts(shopDomain);
  const configuredProductsCount = configuredProducts.length;

  // Get analytics (all time)
  const analytics = await getAnalytics(shopDomain, 365);

  const activeProducts = analytics?.productBreakdown?.length || 0;
  const productStats = (analytics?.productBreakdown || []) as ProductStat[];

  // All steps complete = has products AND has transformations
  const allStepsComplete = configuredProductsCount > 0 && activeProducts > 0;

  return json<LoaderData>({
    shopDomain,
    configuredProducts,
    configuredProductsCount,
    activeProducts,
    productStats,
    allStepsComplete,
  });
};

export default function Dashboard() {
  const {
    shopDomain,
    configuredProducts,
    configuredProductsCount,
    activeProducts,
    productStats,
    allStepsComplete,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  
  // State to track if user has "continued" past setup (persisted in localStorage)
  const [showDashboardView, setShowDashboardView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load persisted state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('gleame_setup_completed');
    if (saved === 'true') {
      setShowDashboardView(true);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage when user continues to dashboard
  const handleContinueToDashboard = () => {
    localStorage.setItem('gleame_setup_completed', 'true');
    setShowDashboardView(true);
  };

  // Go back to setup guide (without clearing the saved state)
  const handleViewSetupGuide = () => {
    setShowDashboardView(false);
  };

  // Get store name from domain
  const storeName = shopDomain.replace('.myshopify.com', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Setup steps
  const setupSteps = [
    {
      id: "enable",
      title: "Enable Gleame for your store",
      description: "Review your settings and customize the experience",
      completed: true,
      action: () => navigate("/app/settings"),
      actionLabel: "Go to Settings",
    },
    {
      id: "configure",
      title: "Set up your first product",
      description: "Add AI transformation prompts to your products",
      completed: configuredProductsCount > 0,
      action: () => navigate("/app/products"),
      actionLabel: "Add Product",
    },
    {
      id: "widget",
      title: "Add a widget to your theme",
      description: "Place a Gleame block on your product pages",
      completed: activeProducts > 0,
      action: () => navigate("/app/products"),
      actionLabel: "View Products",
    },
  ];

  const completedSteps = setupSteps.filter((s) => s.completed).length;
  const progressPercentage = Math.round((completedSteps / setupSteps.length) * 100);

  // Merge configured products with their stats
  const productsWithStats = configuredProducts.map((product) => {
    const stats = productStats.find((s) => s.product_id === product.id);
    return {
      ...product,
      transformations: stats?.transformations || 0,
      isActive: (stats?.transformations || 0) > 0,
    };
  });

  // Determine if we should show setup or dashboard view
  // Wait for localStorage to load before deciding
  const shouldShowSetup = !isLoaded || !allStepsComplete || !showDashboardView;

  return (
    <Page>
      <TitleBar title="Dashboard" />
      <BlockStack gap="600">
        {/* Greeting Header */}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl">
              {allStepsComplete && showDashboardView 
                ? `Welcome back, ${storeName}!` 
                : allStepsComplete 
                  ? `You're all set, ${storeName}! 🎉`
                  : `Welcome to Gleame, ${storeName}! 👋`
              }
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {allStepsComplete && showDashboardView
                ? "Here's how your AI transformations are performing."
                : allStepsComplete
                  ? "Your setup is complete. Ready to view your dashboard?"
                  : "Let's get your store set up with AI-powered product transformations."
              }
            </Text>
          </BlockStack>
          {allStepsComplete && showDashboardView && (
            <Button onClick={() => navigate("/app/analytics")}>
              View Reports
            </Button>
          )}
        </InlineStack>

        {/* Welcome Banner for new users */}
        {!allStepsComplete && (
          <Banner title="Getting Started" tone="info">
            <p>
              Let customers see how they'll look with your products using AI-powered
              transformations. Follow the setup guide below to get started.
            </p>
          </Banner>
        )}

        {/* Stats Cards Row */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd" tone="subdued">
                    Products Configured
                  </Text>
                  <Box background="bg-fill-info" padding="100" borderRadius="full">
                    <Icon source={ProductIcon} tone="info" />
                  </Box>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {configuredProductsCount}
                </Text>
                <Button variant="plain" onClick={() => navigate("/app/products")}>
                  Manage products →
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd" tone="subdued">
                    Widgets Active
                  </Text>
                  <Box background="bg-fill-success" padding="100" borderRadius="full">
                    <Icon source={ViewIcon} tone="success" />
                  </Box>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {activeProducts}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  products with transformations
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd" tone="subdued">
                    Status
                  </Text>
                  <Box background="bg-fill-success" padding="100" borderRadius="full">
                    <Icon source={CheckCircleIcon} tone="success" />
                  </Box>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  Active
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  App connected and running
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* SETUP VIEW - Show when setup incomplete or user hasn't continued */}
        {shouldShowSetup && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        Setup Guide
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {completedSteps} of {setupSteps.length} steps completed
                      </Text>
                    </BlockStack>
                    {progressPercentage === 100 && (
                      <Badge tone="success">Complete</Badge>
                    )}
                  </InlineStack>

                  <ProgressBar progress={progressPercentage} size="small" tone="primary" />

                  <Divider />

                  <BlockStack gap="400">
                    {setupSteps.map((step) => (
                      <InlineStack
                        key={step.id}
                        gap="400"
                        align="space-between"
                        blockAlign="start"
                        wrap={false}
                      >
                        <InlineStack gap="300" blockAlign="start">
                          <Box paddingBlockStart="050">
                            <Icon
                              source={step.completed ? CheckCircleIcon : ClockIcon}
                              tone={step.completed ? "success" : "subdued"}
                            />
                          </Box>
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text
                                as="span"
                                variant="bodyMd"
                                fontWeight="semibold"
                                tone={step.completed ? "subdued" : undefined}
                              >
                                {step.title}
                              </Text>
                              {step.completed && (
                                <Badge tone="success" size="small">Done</Badge>
                              )}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {step.description}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        {!step.completed && step.action && (
                          <Button size="slim" onClick={step.action}>
                            {step.actionLabel}
                          </Button>
                        )}
                      </InlineStack>
                    ))}
                  </BlockStack>

                  {/* Continue Button when complete */}
                  {allStepsComplete && (
                    <>
                      <Divider />
                      <InlineStack align="end">
                        <Button variant="primary" onClick={handleContinueToDashboard}>
                          Continue to Dashboard →
                        </Button>
                      </InlineStack>
                    </>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Sidebar for Setup View */}
            <Layout.Section variant="oneThird">
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Quick Actions</Text>
                    <BlockStack gap="200">
                      <Button icon={PlusCircleIcon} onClick={() => navigate("/app/products")} fullWidth textAlign="start">
                        Add Product
                      </Button>
                      <Button icon={ChartVerticalFilledIcon} onClick={() => navigate("/app/analytics")} fullWidth textAlign="start">
                        View Analytics
                      </Button>
                      <Button icon={SettingsIcon} onClick={() => navigate("/app/settings")} fullWidth textAlign="start">
                        Settings
                      </Button>
                    </BlockStack>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Available Widgets</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Add these blocks in your theme editor:
                    </Text>
                    <BlockStack gap="200">
                      {[
                        { name: "Gleame Embedded", desc: "Full widget with side-by-side preview" },
                        { name: "Gleame Horizontal", desc: "Horizontal layout for wider spaces" },
                        { name: "Gleame Button", desc: "Compact button that opens modal" },
                      ].map((widget) => (
                        <Box key={widget.name} background="bg-surface-secondary" padding="300" borderRadius="200">
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold">{widget.name}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">{widget.desc}</Text>
                          </BlockStack>
                        </Box>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>
          </Layout>
        )}

        {/* DASHBOARD VIEW - Show when setup complete and user has continued */}
        {!shouldShowSetup && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Configured Products
                    </Text>
                    <Button icon={PlusCircleIcon} onClick={() => navigate("/app/products")}>
                      Add Product
                    </Button>
                  </InlineStack>

                  {productsWithStats.length === 0 ? (
                    <EmptyState
                      heading="No products configured yet"
                      action={{ content: "Add Product", onAction: () => navigate("/app/products") }}
                      image=""
                    >
                      <p>Configure your first product to start using Gleame.</p>
                    </EmptyState>
                  ) : (
                    <IndexTable
                      resourceName={{ singular: "product", plural: "products" }}
                      itemCount={productsWithStats.length}
                      headings={[
                        { title: "Product" },
                        { title: "Status" },
                        { title: "Transformations" },
                        { title: "Actions" },
                      ]}
                      selectable={false}
                    >
                      {productsWithStats.map((product, index) => (
                        <IndexTable.Row id={product.id} key={product.id} position={index}>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {product.product_name}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={product.isActive ? "success" : "attention"}>
                              {product.isActive ? "Active" : "Pending"}
                            </Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd">
                              {product.transformations}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Button
                              icon={EditIcon}
                              size="slim"
                              variant="plain"
                              onClick={() => navigate("/app/products")}
                            >
                              Edit
                            </Button>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Sidebar for Dashboard View */}
            <Layout.Section variant="oneThird">
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Quick Actions</Text>
                    <BlockStack gap="200">
                      <Button icon={PlusCircleIcon} onClick={() => navigate("/app/products")} fullWidth textAlign="start">
                        Add Product
                      </Button>
                      <Button icon={ChartVerticalFilledIcon} onClick={() => navigate("/app/analytics")} fullWidth textAlign="start">
                        View Analytics
                      </Button>
                      <Button icon={SettingsIcon} onClick={() => navigate("/app/settings")} fullWidth textAlign="start">
                        Settings
                      </Button>
                    </BlockStack>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">Need Help?</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Check out our documentation or contact support for assistance.
                    </Text>
                    <Button variant="plain">View Documentation →</Button>
                  </BlockStack>
                </Card>

                {/* Show setup button to go back */}
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">Setup Guide</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Completed all steps
                    </Text>
                    <Button variant="plain" onClick={handleViewSetupGuide}>
                      View Setup Guide →
                    </Button>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>
          </Layout>
        )}
      </BlockStack>
    </Page>
  );
}
