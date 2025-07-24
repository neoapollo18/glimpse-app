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
  Badge,
  ProgressBar,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // TODO: Fetch real analytics data from Supabase
  const analytics = {
    totalTransformations: 1247,
    thisWeekTransformations: 89,
    conversionRate: 12.4,
    totalRevenue: 4567.89,
    topProducts: [
      { id: "1", name: "Ruby Red Hair Dye", transformations: 156, conversions: 23, revenue: 345.67 },
      { id: "2", name: "Coral Pink Lipstick", transformations: 134, conversions: 19, revenue: 285.50 },
      { id: "3", name: "Midnight Black Mascara", transformations: 112, conversions: 16, revenue: 224.00 },
      { id: "4", name: "Golden Glow Foundation", transformations: 98, conversions: 14, revenue: 420.00 },
      { id: "5", name: "Ocean Blue Eyeshadow", transformations: 87, conversions: 11, revenue: 165.00 },
    ],
    recentTransformations: [
      { id: "1", timestamp: "2024-01-15 14:30", product: "Ruby Red Hair Dye", converted: true },
      { id: "2", timestamp: "2024-01-15 14:15", product: "Coral Pink Lipstick", converted: false },
      { id: "3", timestamp: "2024-01-15 14:00", product: "Golden Glow Foundation", converted: true },
      { id: "4", timestamp: "2024-01-15 13:45", product: "Midnight Black Mascara", converted: false },
      { id: "5", timestamp: "2024-01-15 13:30", product: "Ocean Blue Eyeshadow", converted: true },
    ],
    weeklyData: [
      { week: "Week 1", transformations: 287, conversions: 35 },
      { week: "Week 2", transformations: 312, conversions: 41 },
      { week: "Week 3", transformations: 298, conversions: 37 },
      { week: "Week 4", transformations: 350, conversions: 46 },
    ]
  };

  return { analytics };
};

export default function Analytics() {
  const { analytics } = useLoaderData<typeof loader>();
  const [timeRange, setTimeRange] = useState("last-30-days");

  const timeRangeOptions = [
    { label: "Last 7 days", value: "last-7-days" },
    { label: "Last 30 days", value: "last-30-days" },
    { label: "Last 90 days", value: "last-90-days" },
    { label: "This year", value: "this-year" },
  ];

  const topProductsRows = analytics.topProducts.map((product) => {
    const conversionRate = ((product.conversions / product.transformations) * 100).toFixed(1);
    
    return [
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {product.name}
      </Text>,
      <Text as="span" variant="bodyMd">
        {product.transformations}
      </Text>,
      <Text as="span" variant="bodyMd">
        {product.conversions}
      </Text>,
      <Text as="span" variant="bodyMd">
        {conversionRate}%
      </Text>,
      <Text as="span" variant="bodyMd">
        ${product.revenue.toFixed(2)}
      </Text>,
    ];
  });

  const recentTransformationsRows = analytics.recentTransformations.map((transformation) => [
    <Text as="span" variant="bodyMd">
      {transformation.timestamp}
    </Text>,
    <Text as="span" variant="bodyMd">
      {transformation.product}
    </Text>,
    <Badge tone={transformation.converted ? "success" : "attention"}>
      {transformation.converted ? "Converted" : "No Conversion"}
    </Badge>,
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
                  <Text as="h3" variant="headingMd">Total Transformations</Text>
                  <Text as="span" variant="heading2xl" fontWeight="bold">
                    {analytics.totalTransformations.toLocaleString()}
                  </Text>
                  <Text as="span" variant="bodyMd" tone="success">
                    +{analytics.thisWeekTransformations} this week
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">Conversion Rate</Text>
                  <Text as="span" variant="heading2xl" fontWeight="bold">
                    {analytics.conversionRate}%
                  </Text>
                  <ProgressBar 
                    progress={analytics.conversionRate} 
                    size="small" 
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">Revenue Generated</Text>
                  <Text as="span" variant="heading2xl" fontWeight="bold">
                    ${analytics.totalRevenue.toLocaleString()}
                  </Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    From AI transformations
                  </Text>
                </BlockStack>
              </Card>
            </InlineStack>
          </Layout.Section>
        </Layout>

        {/* Top Performing Products */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Top Performing Products
                </Text>
                
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["Product", "Transformations", "Conversions", "Conversion Rate", "Revenue"]}
                  rows={topProductsRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Weekly Trends</Text>
                  <BlockStack gap="200">
                    {analytics.weeklyData.map((week, index) => (
                      <BlockStack gap="100" key={index}>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodyMd">{week.week}</Text>
                          <Text as="span" variant="bodyMd">{week.transformations} / {week.conversions}</Text>
                        </InlineStack>
                        <ProgressBar 
                          progress={(week.conversions / week.transformations) * 100} 
                          size="small" 
                        />
                      </BlockStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Insights</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      • Hair color products have the highest conversion rate
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Transformations peak on weekends
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Mobile users convert 23% more than desktop
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Average session duration: 2.4 minutes
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Recent Activity */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Recent Transformations
                </Text>
                
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Timestamp", "Product", "Result"]}
                  rows={recentTransformationsRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Export & Reports */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Export & Reports
                </Text>
                
                <Text as="p" variant="bodyMd" tone="subdued">
                  Export your analytics data for further analysis or integrate with your business intelligence tools.
                </Text>

                <InlineStack gap="300">
                  <button className="Polaris-Button Polaris-Button--outline">
                    Export CSV
                  </button>
                  <button className="Polaris-Button Polaris-Button--outline">
                    Generate Report
                  </button>
                  <button className="Polaris-Button Polaris-Button--outline">
                    API Access
                  </button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
} 