import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function Dashboard() {

  return (
    <Page>
      <TitleBar title="Gleame Dashboard" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Welcome to Gleame
                </Text>
                <Text variant="bodyMd" as="p">
                  Let customers see how they'll look with your products using AI-powered transformations. 
                  Increase conversions by letting customers try before they buy!
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued">
                  Getting started is simple: configure your products, then add the widget to your product pages.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          

        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">How It Works</Text>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">1. Configure Products</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Connect your products to AI transformation prompts in the Product Configuration tab
                    </Text>
                  </BlockStack>
                   
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">2. Add Widget to Store</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      In your theme editor, add the "Gleame" block to your product pages
                    </Text>
                  </BlockStack>
                   
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">3. Customers Transform & Buy</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Customers upload photos, see the transformation, and convert at higher rates
                    </Text>
                  </BlockStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
