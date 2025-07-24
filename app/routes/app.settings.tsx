import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Checkbox,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // TODO: Fetch settings from Supabase
  const settings = {
    widgetEnabled: true,
    widgetPosition: "after-description",
    transformationTimeout: 10,
    maxImageSize: 5,
    enableAnalytics: true,
    testMode: false,
  };

  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "save-settings") {
    const settings = {
      widgetEnabled: formData.get("widgetEnabled") === "true",
      widgetPosition: formData.get("widgetPosition"),
      transformationTimeout: parseInt(formData.get("transformationTimeout") as string),
      maxImageSize: parseInt(formData.get("maxImageSize") as string),
      enableAnalytics: formData.get("enableAnalytics") === "true",
      testMode: formData.get("testMode") === "true",
    };

    // TODO: Save to Supabase
    console.log("Saving settings:", settings);

    return { 
      success: true, 
      message: "Settings saved successfully!",
      settings 
    };
  }

  return { success: false, message: "Unknown action" };
};

export default function Settings() {
  const { settings: initialSettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  
  const [settings, setSettings] = useState(initialSettings);

  const widgetPositionOptions = [
    { label: "After product description", value: "after-description" },
    { label: "Before add to cart button", value: "before-cart" },
    { label: "In product gallery", value: "in-gallery" },
    { label: "Custom position", value: "custom" },
  ];

  const timeoutOptions = [
    { label: "5 seconds", value: "5" },
    { label: "10 seconds", value: "10" },
    { label: "15 seconds", value: "15" },
    { label: "30 seconds", value: "30" },
  ];

  const imageSizeOptions = [
    { label: "2 MB", value: "2" },
    { label: "5 MB", value: "5" },
    { label: "10 MB", value: "10" },
  ];

  const handleSave = () => {
    const formData = new FormData();
    formData.append("action", "save-settings");
    
    Object.entries(settings).forEach(([key, value]) => {
      formData.append(key, value.toString());
    });

    fetcher.submit(formData, { method: "POST" });
  };

  const isLoading = fetcher.state === "submitting";

  return (
    <Page>
      <TitleBar title="Settings" />
      
      <BlockStack gap="500">
        {fetcher.data?.success && (
          <Banner
            title={fetcher.data.message}
            tone="success"
            onDismiss={() => {}}
          />
        )}

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {/* Widget Configuration */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Widget Configuration
                  </Text>
                  
                  <FormLayout>
                    <Checkbox
                      label="Enable transformation widget"
                      checked={settings.widgetEnabled}
                      onChange={(checked) => setSettings({...settings, widgetEnabled: checked})}
                      helpText="Show the AI transformation widget on product pages"
                    />

                    <Select
                      label="Widget position"
                      options={widgetPositionOptions}
                      value={settings.widgetPosition}
                      onChange={(value) => setSettings({...settings, widgetPosition: value})}
                      helpText="Where to display the widget on product pages"
                      disabled={!settings.widgetEnabled}
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Performance Settings */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Performance Settings
                  </Text>
                  
                  <FormLayout>
                    <Select
                      label="Transformation timeout"
                      options={timeoutOptions}
                      value={settings.transformationTimeout.toString()}
                      onChange={(value) => setSettings({...settings, transformationTimeout: parseInt(value)})}
                      helpText="Maximum time to wait for AI transformation"
                    />

                    <Select
                      label="Maximum image size"
                      options={imageSizeOptions}
                      value={settings.maxImageSize.toString()}
                      onChange={(value) => setSettings({...settings, maxImageSize: parseInt(value)})}
                      helpText="Maximum file size for uploaded images"
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Analytics & Testing */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Analytics & Testing
                  </Text>
                  
                  <FormLayout>
                    <Checkbox
                      label="Enable analytics tracking"
                      checked={settings.enableAnalytics}
                      onChange={(checked) => setSettings({...settings, enableAnalytics: checked})}
                      helpText="Track usage statistics and conversion data"
                    />

                    <Checkbox
                      label="Test mode"
                      checked={settings.testMode}
                      onChange={(checked) => setSettings({...settings, testMode: checked})}
                      helpText="Enable test mode for development (no real API calls)"
                    />
                  </FormLayout>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Service Information</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      <strong>AI Processing</strong>
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      All AI transformations are powered by our premium service. No API keys required from your end.
                    </Text>
                    
                    <Text as="p" variant="bodyMd">
                      <strong>Usage Tracking</strong>
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Monitor your transformation usage and conversion metrics
                    </Text>
                    
                    <Text as="p" variant="bodyMd">
                      <strong>Widget Integration</strong>
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Configure how the transformation widget appears on your product pages
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>

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
                  <Button
                    variant="primary"
                    onClick={handleSave}
                    loading={isLoading}
                    size="large"
                  >
                    Save Settings
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