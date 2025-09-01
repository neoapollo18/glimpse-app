import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  DataTable,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getAnalytics } from "../lib/supabase.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Fetch real analytics data from Supabase
  const analytics7Days = await getAnalytics(session.shop, 7);
  const analytics30Days = await getAnalytics(session.shop, 30);

  // Default to empty data if no analytics found
  const safeAnalytics = {
    totalTransformations: analytics7Days?.totalTransformations || 0,
    totalTransformations30Days: analytics30Days?.totalTransformations || 0,
    productBreakdown: analytics7Days?.productBreakdown || [],
    productBreakdown30Days: analytics30Days?.productBreakdown || [],
  };

  return { analytics: safeAnalytics };
};

export default function Analytics() {
  const { analytics } = useLoaderData<typeof loader>();
  const [timeRange, setTimeRange] = useState("last-7-days");

  const timeRangeOptions = [
    { label: "Last 7 days", value: "last-7-days" },
    { label: "Last 30 days", value: "last-30-days" },
  ];

  // Choose data based on selected time range
  const currentData = timeRange === "last-7-days" 
    ? {
        total: analytics.totalTransformations,
        breakdown: analytics.productBreakdown
      }
    : {
        total: analytics.totalTransformations30Days,
        breakdown: analytics.productBreakdown30Days
      };

  const topProductsRows = currentData.breakdown.map((product: any) => [
    <Text as="span" variant="bodyMd" fontWeight="semibold" key={product.product_id}>
      {product.product_name}
    </Text>,
    <Text as="span" variant="bodyMd" key={`${product.product_id}-trans`}>
      {product.transformations}
    </Text>,
  ]);

  return (
    <Page>
      <TitleBar title="Analytics" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <InlineStack align="space-between">
              <Text as="h2" variant="headingLg">
                Transformation Analytics
              </Text>
              <Select
                label="Time Range"
                labelHidden
                options={timeRangeOptions}
                value={timeRange}
                onChange={setTimeRange}
              />
            </InlineStack>
          </Layout.Section>
        </Layout>

        {/* Key Metrics */}
        <Layout>
          <Layout.Section>
            <InlineStack gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Total Transformations ({timeRange === "last-7-days" ? "7 days" : "30 days"})
                  </Text>
                  <Text as="span" variant="heading2xl" fontWeight="bold">
                    {currentData.total.toLocaleString()}
                  </Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    Widget usage by customers
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">Products with Transformations</Text>
                  <Text as="span" variant="heading2xl" fontWeight="bold">
                    {currentData.breakdown.length}
                  </Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    Active products being transformed
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">Most Popular Product</Text>
                  <Text as="span" variant="headingLg" fontWeight="bold">
                    {currentData.breakdown.length > 0 
                      ? (currentData.breakdown as any).sort((a: any, b: any) => b.transformations - a.transformations)[0].product_name
                      : "No data"
                    }
                  </Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {currentData.breakdown.length > 0 
                      ? `${(currentData.breakdown as any).sort((a: any, b: any) => b.transformations - a.transformations)[0].transformations} transformations`
                      : "Add product configurations to see data"
                    }
                  </Text>
                </BlockStack>
              </Card>
            </InlineStack>
          </Layout.Section>
        </Layout>

        {/* Product Performance */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Product Performance ({timeRange === "last-7-days" ? "Last 7 days" : "Last 30 days"})
                </Text>
                
                {currentData.breakdown.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "numeric"]}
                    headings={["Product Name", "Transformations"]}
                    rows={topProductsRows}
                  />
                ) : (
                  <BlockStack gap="300">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No transformation data available for the selected time period.
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Make sure you have:
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      • Configured products with transformation prompts
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      • Customers are using the widget on your storefront
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Quick Stats</Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">7-day total:</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {analytics.totalTransformations}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">30-day total:</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {analytics.totalTransformations30Days}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Daily average:</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {timeRange === "last-7-days" 
                          ? Math.round(analytics.totalTransformations / 7)
                          : Math.round(analytics.totalTransformations30Days / 30)
                        }
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Getting Started</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      • Configure products in the Products tab
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Add the widget to your product pages
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Analytics will appear as customers use transformations
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Data refreshes in real-time
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Usage Insights */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Usage Overview
                </Text>
                
                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd">
                    This analytics dashboard tracks customer usage of your AI transformation widget. 
                    Each time a customer uploads a photo and gets a transformation, it's recorded here.
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>


      </BlockStack>
    </Page>
  );
} 