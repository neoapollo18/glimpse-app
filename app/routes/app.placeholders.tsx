import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Page,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Box,
  InlineGrid,
  Button,
  Badge,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

const APP_URL = "https://glimpse-app-charles.onrender.com";

const PLACEHOLDER_CATEGORIES = [
  {
    name: "Acne",
    description: "Before/after placeholders for acne treatment products",
    images: ["acne1", "acne2", "acne3", "acne4", "acne5"],
    color: "#fef2f2",
    badge: "Skincare",
  },
  {
    name: "Blush",
    description: "Before/after placeholders for blush and cheek color products",
    images: ["blush1", "blush2", "blush3"],
    color: "#fdf2f8",
    badge: "Makeup",
  },
  {
    name: "Brightening",
    description: "Before/after placeholders for skin brightening products",
    images: ["brightening1", "brightening2", "brightening3"],
    color: "#fffbeb",
    badge: "Skincare",
  },
  {
    name: "Hair Health",
    description: "Before/after placeholders for hair health and treatment products",
    images: ["hairhealth1", "hairhealth2", "hairhealth3", "hairhealth4", "hairhealth5"],
    color: "#f0fdf4",
    badge: "Hair",
  },
  {
    name: "Lip Gloss",
    description: "Before/after placeholders for lip gloss and lip color products",
    images: ["lipgloss1", "lipgloss2", "lipgloss3"],
    color: "#fdf4ff",
    badge: "Makeup",
  },
  {
    name: "Skin Refinement",
    description: "Before/after placeholders for pore and skin texture products",
    images: ["skinrefinement1", "skinrefinement2", "skinrefinement3", "skinrefinement4"],
    color: "#f0f9ff",
    badge: "Skincare",
  },
];

const badgeTone: Record<string, "info" | "success" | "attention"> = {
  Skincare: "info",
  Makeup: "attention",
  Hair: "success",
};

export default function PlaceholdersPage() {
  return (
    <Page>
      <TitleBar title="Placeholder Images" />
      <BlockStack gap="600">

        {/* Intro */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingLg">Widget Placeholder Images</Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Use these images as <code>data-placeholder-before</code> and <code>data-placeholder-after</code> in your widget embed code.
              They show customers what kind of transformation to expect before they upload a selfie.
            </Text>
            <Box paddingBlockStart="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Copy a URL and paste it directly into your widget div attribute. Example:
              </Text>
              <Box paddingBlockStart="200">
                <div style={{
                  background: "#f6f6f7",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  color: "#303030",
                  wordBreak: "break-all",
                }}>
                  {`data-placeholder-before="${APP_URL}/placeholders/acne1.png"`}
                </div>
              </Box>
            </Box>
          </BlockStack>
        </Card>

        {/* Categories */}
        {PLACEHOLDER_CATEGORIES.map((category) => (
          <Card key={category.name}>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Text as="h3" variant="headingMd">{category.name}</Text>
                  <Badge tone={badgeTone[category.badge]}>{category.badge}</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {category.images.length} image{category.images.length !== 1 ? "s" : ""}
                </Text>
              </InlineStack>

              <Text as="p" variant="bodySm" tone="subdued">{category.description}</Text>

              <Divider />

              <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                {category.images.map((img) => {
                  const url = `${APP_URL}/placeholders/${img}.png`;
                  return (
                    <Box
                      key={img}
                      borderWidth="025"
                      borderColor="border"
                      borderRadius="200"
                      padding="300"
                      background="bg-surface-secondary"
                    >
                      <BlockStack gap="300">
                        {/* Preview */}
                        <div style={{
                          width: "100%",
                          aspectRatio: "1",
                          borderRadius: "8px",
                          overflow: "hidden",
                          background: category.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}>
                          <img
                            src={url}
                            alt={img}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                        </div>

                        {/* Filename */}
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {img}.png
                        </Text>

                        {/* URL box */}
                        <div style={{
                          background: "#f6f6f7",
                          borderRadius: "6px",
                          padding: "6px 10px",
                          fontFamily: "monospace",
                          fontSize: "11px",
                          color: "#6d7175",
                          wordBreak: "break-all",
                          lineHeight: "1.4",
                        }}>
                          {url}
                        </div>

                        {/* Copy + Download */}
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            onClick={() => navigator.clipboard.writeText(url)}
                          >
                            Copy URL
                          </Button>
                          <Button
                            size="slim"
                            variant="plain"
                            url={url}
                            target="_blank"
                          >
                            Download
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  );
                })}
              </InlineGrid>
            </BlockStack>
          </Card>
        ))}

      </BlockStack>
    </Page>
  );
}
