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
import { useState, useEffect } from "react";

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
  const [showVideoBanner, setShowVideoBanner] = useState(true);

  useEffect(() => {
    const dismissed = localStorage.getItem('glimpse-placeholders-video-banner-dismissed') === 'true';
    if (dismissed) setShowVideoBanner(false);
  }, []);

  const dismissVideoBanner = () => {
    setShowVideoBanner(false);
    localStorage.setItem('glimpse-placeholders-video-banner-dismissed', 'true');
  };

  return (
    <Page>
      <TitleBar title="Placeholder Images" />
      <BlockStack gap="600">

        


        {/* Video Tutorial Banner */}
        {showVideoBanner && (
          <Card>
            <div style={{ position: 'relative' }}>
              <button
                onClick={dismissVideoBanner}
                style={{
                  position: 'absolute',
                  top: '-8px',
                  right: '-8px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  color: '#6b7280',
                }}
                aria-label="Dismiss"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
              <InlineStack gap="400" align="center" blockAlign="center">
                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <rect width="24" height="24" rx="6" fill="#FF0000"/>
                    <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="white"/>
                  </svg>
                </Box>
                <BlockStack gap="100">
                  <Text as="span" variant="headingMd" fontWeight="semibold">
                    Want to make your own placeholder image?
                  </Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    Watch our quick guide on how to make your own placeholder image to use in your widget
                  </Text>
                </BlockStack>
                <div style={{ marginLeft: "auto" }}>
                  <Button url="https://www.cnn.com/" target="_blank">
                    Watch Video
                  </Button>
                </div>
              </InlineStack>
            </div>
          </Card>
        )}

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
                          borderRadius: "8px",
                          overflow: "hidden",
                          background: category.color,
                        }}>
                          <img
                            src={url}
                            alt={img}
                            style={{
                              width: "100%",
                              height: "auto",
                              display: "block",
                            }}
                          />
                        </div>

                        {/* Filename */}
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {img}.png
                        </Text>

                        {/* Download */}
                        <Button
                          size="slim"
                          url={url}
                          target="_blank"
                          download
                        >
                          Download
                        </Button>
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
