import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "reconnect") {
    // Force re-authentication by redirecting to auth
    return redirect(`/auth?shop=${session.shop}`);
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
                    If widgets aren't appearing, use the troubleshooting tools below.
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
                    Check out our documentation or contact support for assistance.
                  </Text>
                  <Button 
                    variant="plain"
                    onClick={() => window.open('https://gleame.com/docs', '_blank')}
                  >
                    View Documentation →
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
