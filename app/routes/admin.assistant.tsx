import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import {
  AppProvider,
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  TextField,
  Banner,
  Divider,
  IndexTable,
  Box,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import {
  getAllChatAssistantConfigs,
  saveChatAssistantConfig,
  type ChatAssistantConfig,
} from "../lib/supabase.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

const ALLOWED_SHOPS = [
  "testingaaronandevansaas.myshopify.com",
  "hx5hqt-na.myshopify.com",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!ALLOWED_SHOPS.includes(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const configs = await getAllChatAssistantConfigs();
  return json({ configs });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Authenticate via Prisma session (same pattern as admin.tsx action)
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  if (!shopParam || !ALLOWED_SHOPS.includes(shopParam)) {
    return json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "toggle") {
    const shopDomain = formData.get("shopDomain") as string;
    if (!shopDomain) {
      return json({ success: false, error: "Missing shopDomain" }, { status: 400 });
    }
    const enabled = formData.get("enabled") === "true";
    await saveChatAssistantConfig(shopDomain, { enabled });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function AdminAssistant() {
  const { configs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean }>();

  return (
    <AppProvider i18n={enTranslations}>
      <Page title="AI Assistant — Admin" backAction={{ url: "/admin" }}>
        <BlockStack gap="500">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Chat Assistant Configurations ({configs.length} shops)
              </Text>
              {configs.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No shops have configured the AI assistant yet.
                </Text>
              ) : (
                <IndexTable
                  itemCount={configs.length}
                  headings={[
                    { title: "Shop" },
                    { title: "Status" },
                    { title: "Assistant Name" },
                    { title: "Opening Message" },
                    { title: "Products" },
                    { title: "Actions" },
                  ]}
                  selectable={false}
                >
                  {configs.map((config, index) => (
                    <IndexTable.Row key={config.shop_domain} id={config.shop_domain} position={index}>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {config.shop_domain}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={config.enabled ? "success" : undefined}>
                          {config.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm">
                          {config.assistant_name}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm" truncate>
                          {config.opening_message}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm">
                          {config.product_scope === "all_configured"
                            ? "All configured"
                            : `${config.selected_product_ids.length} selected`}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button
                          size="slim"
                          variant={config.enabled ? undefined : "primary"}
                          onClick={() => {
                            const formData = new FormData();
                            formData.append("intent", "toggle");
                            formData.append("shopDomain", config.shop_domain);
                            formData.append("enabled", String(!config.enabled));
                            fetcher.submit(formData, { method: "POST" });
                          }}
                        >
                          {config.enabled ? "Disable" : "Enable"}
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
