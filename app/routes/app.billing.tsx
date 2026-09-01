import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { BlockStack, Card, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// MANTLE SHUTDOWN: the previous page managed Mantle subscriptions (plan,
// grace period, cancel) and errored on every load once Mantle's API died.
// Billing enforcement is off while the Shopify-native replacement is
// built (billing-gate.server.ts); this holds the route so nav links and
// old redirects keep working. Pre-Mantle version is in git history.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ ok: true });
};

export default function BillingPage() {
  return (
    <Page>
      <TitleBar title="Billing" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Gleame is currently free to use
            </Text>
            <Text as="p" variant="bodyMd">
              We're moving our billing to Shopify's native subscription
              system. While that migration is underway, every feature is
              available at no charge and nothing is billed to your store.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              When plans return, they'll appear here and you'll approve any
              charge through Shopify before it starts. No action is needed
              from you.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
