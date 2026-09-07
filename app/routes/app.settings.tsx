import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Box,
  Icon,
  Divider,
} from "@shopify/polaris";
import {
  LanguageTranslateIcon,
  AffiliateIcon,
  BillIcon,
  SettingsIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  return json({ 
    shopDomain: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect: appRedirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "reconnect") {
    // Reload the app top-level from the admin apps deep link. A plain
    // redirect to /auth dead-ended: fetcher redirects stay inside the
    // embedded iframe, and /auth is a no-op under the token-exchange auth
    // strategy (blank pane, no re-auth). App Bridge's redirect helper
    // breaks out of the iframe (same pattern as the billing confirmation),
    // and re-entering the app mints a fresh session via token exchange.
    const appHandle = process.env.SHOPIFY_APP_HANDLE || "gleame";
    return appRedirect(`shopify://admin/apps/${appHandle}`, { target: "_top" });
  }

  if (actionType === "open-theme-editor") {
    // Return the theme editor URL for the client to open
    return json({ 
      success: true, 
      themeEditorUrl: `https://${session.shop}/admin/themes/current/editor`
    });
  }

  return json({ success: false });
};

export default function Settings() {
  const { shopDomain } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const handleOpenTranslations = () => {
    // Open Shopify's app translations page
    window.open(`https://${shopDomain}/admin/settings/translations`, '_blank');
  };

  const handleOpenBilling = () => {
    // Open Shopify's billing page for apps
    window.open(`https://${shopDomain}/admin/settings/billing`, '_blank');
  };

  const handleOpenAffiliateProgram = () => {
    // Open affiliate program page (placeholder - update with actual URL)
    window.open('https://gleame.com/affiliates', '_blank');
  };

  const handleTroubleshoot = () => {
    // Open theme editor to check widget installation
    window.open(`https://${shopDomain}/admin/themes/current/editor?context=apps`, '_blank');
  };

  const handleReconnect = () => {
    fetcher.submit({ action: "reconnect" }, { method: "POST" });
  };

  const settingsItems = [
    {
      icon: LanguageTranslateIcon,
      title: "Translations",
      description: "Language and phrasing shown to customers",
      onClick: handleOpenTranslations,
    },
    {
      icon: AffiliateIcon,
      title: "Affiliate program",
      description: "Refer and earn! Get 15% lifetime commission on each referral",
      onClick: handleOpenAffiliateProgram,
    },
    {
      icon: BillIcon,
      title: "Billing",
      description: "View and update billing information",
      onClick: handleOpenBilling,
    },
  ];

  return (
    <Page>
      <TitleBar title="Settings" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {/* Settings List */}
              <Card padding="0">
                <BlockStack>
                  {settingsItems.map((item, index) => (
                    <div key={item.title}>
                      <Box
                        padding="400"
                        paddingInlineStart="500"
                        paddingInlineEnd="500"
                      >
                        <InlineStack 
                          gap="400" 
                          align="start" 
                          blockAlign="center"
                          wrap={false}
                        >
                          <Box
                            background="bg-surface-secondary"
                            padding="300"
                            borderRadius="200"
                          >
                            <Icon source={item.icon} tone="base" />
                          </Box>
                          <Box minWidth="0" width="100%">
                            <BlockStack gap="050">
                              <Button
                                variant="plain"
                                textAlign="start"
                                onClick={item.onClick}
                              >
                                {item.title}
                              </Button>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {item.description}
                              </Text>
                            </BlockStack>
                          </Box>
                        </InlineStack>
                      </Box>
                      {index < settingsItems.length - 1 && <Divider />}
                    </div>
                  ))}
                </BlockStack>
              </Card>

              {/* Troubleshooting Section */}
              <Card background="bg-surface-secondary">
                <BlockStack gap="400">
                  <Text as="p" variant="bodyMd">
                    If the quiz or chat isn't appearing on your storefront, use the troubleshooting tools below.
                  </Text>
                  
                  <InlineStack gap="300" wrap={true}>
                    <Button
                      size="large"
                      icon={SettingsIcon}
                      onClick={handleTroubleshoot}
                    >
                      Troubleshoot Installation
                    </Button>
                    <Button
                      size="large"
                      icon={RefreshIcon}
                      onClick={handleReconnect}
                      loading={fetcher.state === "submitting"}
                    >
                      Reconnect Store
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Try-on entry point. The nav hides Products/AI Assistant for
                  shops with no configured try-on prompts (quiz-first pivot),
                  which would otherwise make try-on impossible to bootstrap. */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    AI try-on
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Let shoppers see products on their own photo. Configure a
                    transformation prompt on your first product to enable the
                    try-on pages in the navigation.
                  </Text>
                  <InlineStack>
                    <Button url="/app/products">Set up product try-on</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Privacy & Security</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      • Images are never stored permanently
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • All processing happens server-side
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Anonymous customer interactions
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • GDPR compliant by design
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Need Help?</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Check out our website or contact Intercom support for assistance.
                  </Text>
                  <Button 
                    variant="plain"
                    onClick={() => window.open('https://gleame.ai', '_blank')}
                  >
                    View Website →
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
