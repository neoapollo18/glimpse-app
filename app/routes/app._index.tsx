import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Badge,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // TODO: Replace with real data from Supabase
  const mockStats = {
    totalTransformations: 1247,
    thisWeekTransformations: 89,
    conversionRate: 12.4,
    enabledProducts: 0,
    totalProducts: 0
  };

  return { stats: mockStats };
};

export default function Dashboard() {
  // const { stats } = useLoaderData<typeof loader>();
  
  // Mock data for now
  const stats = {
    totalTransformations: 1247,
    thisWeekTransformations: 89,
    conversionRate: 12.4,
    enabledProducts: 0,
    totalProducts: 0
  };

  return (
    <Page>
      <TitleBar title="Beauty Transformation Dashboard" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Welcome to AI Beauty Transformations
                </Text>
                <Text variant="bodyMd" as="p">
                  Help your customers visualize how they'll look with your beauty products using AI-powered transformations. 
                  Increase conversions by letting customers see the results before they buy!
                </Text>
                {stats.enabledProducts === 0 && (
                  <InlineStack gap="200" align="start">
                    <Badge tone="attention">Setup Required</Badge>
                    <Text variant="bodyMd" as="p">
                      Get started by configuring your first product for AI transformations.
                    </Text>
                  </InlineStack>
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
                      <Text as="span" variant="bodyMd">Total Transformations</Text>
                      <Text as="span" variant="headingMd">{stats.totalTransformations.toLocaleString()}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">This Week</Text>
                      <Text as="span" variant="headingMd" tone="success">+{stats.thisWeekTransformations}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Conversion Rate</Text>
                      <Text as="span" variant="headingMd">{stats.conversionRate}%</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
              
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Setup Progress</Text>
                  <BlockStack gap="200">
                                         <InlineStack align="space-between">
                       <Text as="span" variant="bodyMd">Products Configured</Text>
                       <Text as="span" variant="bodyMd">{stats.enabledProducts} of {stats.totalProducts}</Text>
                     </InlineStack>
                    <ProgressBar 
                      progress={stats.totalProducts > 0 ? (stats.enabledProducts / stats.totalProducts) * 100 : 0} 
                      size="small" 
                    />
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Next Steps</Text>
                <BlockStack gap="300">
                  <InlineStack gap="300">
                    <Badge tone={stats.enabledProducts > 0 ? "success" : "attention"}>
                      {stats.enabledProducts > 0 ? "✓" : "1"}
                    </Badge>
                                         <BlockStack gap="100">
                       <Text as="span" variant="bodyMd" fontWeight="semibold">Configure Products</Text>
                       <Text as="p" variant="bodyMd" tone="subdued">
                         Connect your beauty products to AI transformation prompts
                       </Text>
                     </BlockStack>
                   </InlineStack>
                   
                   <InlineStack gap="300">
                     <Badge tone="attention">2</Badge>
                     <BlockStack gap="100">
                       <Text as="span" variant="bodyMd" fontWeight="semibold">Set Up API Keys</Text>
                       <Text as="p" variant="bodyMd" tone="subdued">
                         Configure Google Gemini API for AI transformations
                       </Text>
                     </BlockStack>
                   </InlineStack>
                   
                   <InlineStack gap="300">
                     <Badge tone="attention">3</Badge>
                     <BlockStack gap="100">
                       <Text as="span" variant="bodyMd" fontWeight="semibold">Deploy Widget</Text>
                       <Text as="p" variant="bodyMd" tone="subdued">
                         Add the transformation widget to your product pages
                       </Text>
                     </BlockStack>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
