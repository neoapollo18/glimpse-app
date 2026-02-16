import { useState, useEffect } from "react";
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
  Badge,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

interface Widget {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  image?: string;
  demoUrl?: string;
}

const widgets: Widget[] = [
  {
    id: "integrated-horizontal",
    name: "Gleame Horizontal",
    description: "Side-by-side before/after layout that fits naturally within your product page.",
    image: "/widget-previews/horizontal.png",
    demoUrl: "https://www.loom.com/share/b61131d2bbc149e3bffafeadad73b376", 
  },
  {
    id: "integrated",
    name: "Gleame Embedded",
    description: "Vertical layout with stacked before/after images. Clean and focused design.",
    image: "/widget-previews/embedded.png",
    demoUrl: "https://www.loom.com/share/a4d9417da05e4e969f1a9738c90170dd", 
  },
  {
    id: "button",
    name: "Gleame Button",
    description: "A simple button that opens the transformation experience in a modal.",
    image: "/widget-previews/button.png",
    demoUrl: "https://www.loom.com/share/d2043db0206643ee9c471409549491a0", 
  },
  {
    id: "banner",
    name: "Gleame Banner",
    description: "Eye-catching promotional banner to drive discovery on any page.",
    image: "/widget-previews/banner-preview.png",
    demoUrl: "https://www.loom.com/share/8f64b108299744c98f7a9c28ac7210d5", 
  },
  {
    id: "og",
    name: "Gleame Legacy",
    description: "The original Gleame widget design with full transformation functionality.",
    image: "/widget-previews/legacy.png",
    demoUrl: "https://www.loom.com/share/3ed7ae1272ec45bea8014a30e2ff26df", 
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export default function Widgets() {
  // Video banner dismiss state (persists in localStorage)
  const [showVideoBanner, setShowVideoBanner] = useState(true);
  
  // Check localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const dismissed = localStorage.getItem('glimpse-widgets-video-banner-dismissed') === 'true';
    if (dismissed) {
      setShowVideoBanner(false);
    }
  }, []);
  
  const dismissVideoBanner = () => {
    setShowVideoBanner(false);
    localStorage.setItem('glimpse-widgets-video-banner-dismissed', 'true');
  };

  const handleCustomize = (widgetId: string) => {
    // Open theme editor with widget selected
    window.open(
      `https://admin.shopify.com/themes/current/editor?context=apps`,
      "_blank"
    );
  };

  const handleDemo = (widget: Widget) => {
    // Open demo page/video for the widget
    const url = widget.demoUrl;
    window.open(url, "_blank");
  };

  return (
    <Page>
      <TitleBar title="Widgets" />
      
      <BlockStack gap="600">
        {/* Header */}
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl">Widgets</Text>
        </BlockStack>

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
                <Box
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <rect width="24" height="24" rx="6" fill="#FF0000"/>
                    <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="white"/>
                  </svg>
                </Box>
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    Want to add more widgets?
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Watch our quick guide on adding and customizing Gleame widgets on your store
                  </Text>
                </BlockStack>
                <div style={{ marginLeft: "auto" }}>
                  <Button url="https://www.loom.com/share/f9049be91b344462980e623eaf232f81" target="_blank">
                    Watch Video
                  </Button>
                </div>
              </InlineStack>
            </div>
          </Card>
        )}

        {/* Widgets Grid */}
        <InlineGrid columns={{ xs:1, sm: 2, lg: 3 }} gap="400">
          {widgets.map((widget) => (
            <Card key={widget.id} padding="0">
              <BlockStack gap="0">
                {/* Widget Preview Image */}
                <Box
                  background="bg-surface-secondary"
                >
                  {widget.image ? (
                    <div
                      style={{
                        width: "100%",
                        height: "200px",
                        backgroundImage: `url(${widget.image})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        borderTopLeftRadius: "12px",
                        borderTopRightRadius: "12px",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "200px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)",
                        borderTopLeftRadius: "12px",
                        borderTopRightRadius: "12px",
                      }}
                    >
                      <BlockStack gap="200" inlineAlign="center">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <path d="M21 15l-5-5L5 21" />
                        </svg>
                        <Text as="span" variant="bodySm" tone="subdued">
                          Widget Preview
                        </Text>
                      </BlockStack>
                    </div>
                  )}
                </Box>

                {/* Widget Info */}
                <Box padding="400">
                  <BlockStack gap="300">
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        {widget.name}
                      </Text>
                      {widget.recommended && (
                        <Badge tone="success">Recommended</Badge>
                      )}
                    </InlineStack>

                    <Text as="p" variant="bodySm" tone="subdued">
                      {widget.description}
                    </Text>

                    <InlineStack gap="200">
                      <Button
                        onClick={() => handleCustomize(widget.id)}
                      >
                        Add to Theme
                      </Button>
                      <Button
                        variant="plain"
                        onClick={() => handleDemo(widget)}
                      >
                        See Demo
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        {/* Help Section */}
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">How to Add a Widget</Text>
            <BlockStack gap="300">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: "#91d5ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "14px", color: "#1f2937" }}>1</span>
                </div>
                <Text as="p" variant="bodyMd">
                  Click "Add to Theme" on your preferred widget
                </Text>
              </InlineStack>
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: "#91d5ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "14px", color: "#1f2937" }}>2</span>
                </div>
                <Text as="p" variant="bodyMd">
                  In the theme editor, navigate to a product page template
                </Text>
              </InlineStack>
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: "#91d5ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "14px", color: "#1f2937" }}>3</span>
                </div>
                <Text as="p" variant="bodyMd">
                  Click "Add block" and select your Gleame widget from the Apps section
                </Text>
              </InlineStack>
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: "#91d5ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "14px", color: "#1f2937" }}>4</span>
                </div>
                <Text as="p" variant="bodyMd">
                  Customize colors and settings, then save your theme
                </Text>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
