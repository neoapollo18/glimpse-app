import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Select,
  Box,
  InlineGrid,
  Divider,
  Button,
  Collapsible,
  Icon,
  Thumbnail,
  Badge,
} from "@shopify/polaris";
import {
  ChevronRightIcon,
  ChevronDownIcon,
  ImageIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getAnalytics } from "../lib/supabase.server";
import { useState, useCallback } from "react";

interface WidgetBreakdown {
  [widgetType: string]: number;
}

interface ProductBreakdown {
  product_id: string;
  product_name: string;
  shopify_id: string;
  transformations: number;
  widgets: WidgetBreakdown;
}

interface AnalyticsData {
  totalTransformations: number;
  widgetViews: number;
  addToCarts: number;
  uploadToATCRate: number;
  productBreakdown: ProductBreakdown[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const analytics7Days = await getAnalytics(session.shop, 7);
  const analytics30Days = await getAnalytics(session.shop, 30);

  const safeAnalytics7: AnalyticsData = {
    totalTransformations: analytics7Days?.totalTransformations || 0,
    widgetViews: analytics7Days?.widgetViews || 0,
    addToCarts: analytics7Days?.addToCarts || 0,
    uploadToATCRate: analytics7Days?.uploadToATCRate || 0,
    productBreakdown: (analytics7Days?.productBreakdown || []) as ProductBreakdown[],
  };

  const safeAnalytics30: AnalyticsData = {
    totalTransformations: analytics30Days?.totalTransformations || 0,
    widgetViews: analytics30Days?.widgetViews || 0,
    addToCarts: analytics30Days?.addToCarts || 0,
    uploadToATCRate: analytics30Days?.uploadToATCRate || 0,
    productBreakdown: (analytics30Days?.productBreakdown || []) as ProductBreakdown[],
  };

  return json({ analytics7: safeAnalytics7, analytics30: safeAnalytics30 });
};

export default function Analytics() {
  const { analytics7, analytics30 } = useLoaderData<typeof loader>();
  const [timeRange, setTimeRange] = useState("30");
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  const timeRangeOptions = [
    { label: "Last 7 days", value: "7" },
    { label: "Last 30 days", value: "30" },
  ];

  const currentData = timeRange === "7" ? analytics7 : analytics30;

  const toggleProduct = useCallback((productId: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);

  // Sort products by transformations descending
  const sortedProducts = [...currentData.productBreakdown].sort(
    (a, b) => b.transformations - a.transformations
  );

  return (
    <Page>
      <TitleBar title="Analytics" />
      
      <BlockStack gap="600">
        {/* Header with time selector */}
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h1" variant="headingXl">Analytics</Text>
          <InlineStack gap="300">
            <Select
              label="Time range"
              labelHidden
              options={timeRangeOptions}
              value={timeRange}
              onChange={setTimeRange}
            />
          </InlineStack>
        </InlineStack>

        {/* Stats Cards */}
        <InlineGrid columns={{ xs: 1, sm: 3, md: 3 }} gap="400">
          <Card padding="400">
            <BlockStack gap="200">
              <Text as="span" variant="bodySm" tone="subdued">
                Selfie Uploads
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {currentData.totalTransformations.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="200">
              <Text as="span" variant="bodySm" tone="subdued">
                Active Products
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {currentData.productBreakdown.length}
              </Text>
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="200">
              <Text as="span" variant="bodySm" tone="subdued">
                Widget Views
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {currentData.widgetViews.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Product Breakdown */}
        <Card padding="0">
          <Box padding="400" paddingBlockEnd="300">
            <Text as="h2" variant="headingMd">
              See how shoppers are engaging with Gleame across products
            </Text>
          </Box>
          
          <Divider />

          {/* Table Header */}
          <Box padding="400" paddingBlockStart="300" paddingBlockEnd="300" background="bg-surface-secondary">
            <InlineGrid columns={{ xs: "1fr 1fr 1fr", md: "2fr 1fr 1fr 1fr" }} gap="400" alignItems="center">
              <Text as="span" variant="bodySm" fontWeight="semibold">Product</Text>
              <Box>
                <Text as="span" variant="bodySm" fontWeight="semibold">Uploads</Text>
              </Box>
              <Box>
                <Text as="span" variant="bodySm" fontWeight="semibold">Widgets</Text>
              </Box>
              <Box>
                <Text as="span" variant="bodySm" fontWeight="semibold">Share</Text>
              </Box>
            </InlineGrid>
          </Box>

          {/* Product Rows */}
          {sortedProducts.length > 0 ? (
            <BlockStack>
              {sortedProducts.map((product, index) => {
                const isExpanded = expandedProducts.has(product.product_id);
                const sharePercent = currentData.totalTransformations > 0 
                  ? ((product.transformations / currentData.totalTransformations) * 100).toFixed(1)
                  : "0";
                
                return (
                  <div key={product.product_id}>
                    {index > 0 && <Divider />}
                    <Box padding="400">
                      <InlineGrid columns={{ xs: "1fr 1fr 1fr", md: "2fr 1fr 1fr 1fr" }} gap="400" alignItems="center">
                        {/* Product Info */}
                        <InlineStack gap="300" blockAlign="center" wrap={false}>
                          <Button
                            variant="plain"
                            onClick={() => toggleProduct(product.product_id)}
                            icon={isExpanded ? ChevronDownIcon : ChevronRightIcon}
                            accessibilityLabel={isExpanded ? "Collapse" : "Expand"}
                          />
                          <Thumbnail
                            source={ImageIcon}
                            alt={product.product_name}
                            size="small"
                          />
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {product.product_name}
                            </Text>
                          </BlockStack>
                        </InlineStack>

                        {/* Uploads */}
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {product.transformations.toLocaleString()}
                        </Text>

                        {/* Widgets count */}
                        <Text as="span" variant="bodyMd">
                          {Object.keys(product.widgets || {}).length || 1}
                        </Text>

                        {/* Share */}
                        <Box>
                          <Badge tone="info">{`${sharePercent}%`}</Badge>
                        </Box>
                      </InlineGrid>

                      {/* Expanded Widget Details */}
                      <Collapsible
                        open={isExpanded}
                        id={`widget-details-${product.product_id}`}
                        transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                      >
                        <Box paddingBlockStart="400" paddingInlineStart="1200">
                          <BlockStack gap="200">
                            {Object.entries(product.widgets || {}).map(([widgetType, count]) => {
                              const widgetNames: Record<string, string> = {
                                embedded: "Gleame Embedded",
                                horizontal: "Gleame Horizontal", 
                                button: "Gleame Button",
                                legacy: "Gleame Legacy",
                                unknown: "Uncategorized Widget"
                              };
                              const displayName = widgetNames[widgetType] || widgetType;
                              const widgetSharePercent = product.transformations > 0 
                                ? ((count / product.transformations) * 100).toFixed(0)
                                : "0";
                              
                              return (
                                <Box 
                                  key={widgetType}
                                  padding="300" 
                                  background="bg-surface-secondary" 
                                  borderRadius="200"
                                >
                                  <InlineGrid columns={{ xs: "1fr 1fr 1fr", md: "2fr 1fr 1fr 1fr" }} gap="400" alignItems="center">
                                    <Text as="span" variant="bodySm">{displayName}</Text>
                                    <Text as="span" variant="bodySm">{count}</Text>
                                    <Text as="span" variant="bodySm">—</Text>
                                    <Box>
                                      <Text as="span" variant="bodySm">{widgetSharePercent}%</Text>
                                    </Box>
                                  </InlineGrid>
                                </Box>
                              );
                            })}
                            {(!product.widgets || Object.keys(product.widgets).length === 0) && (
                              <Box 
                                padding="300" 
                                background="bg-surface-secondary" 
                                borderRadius="200"
                              >
                                <InlineGrid columns={{ xs: "1fr 1fr 1fr", md: "2fr 1fr 1fr 1fr" }} gap="400" alignItems="center">
                                  <Text as="span" variant="bodySm">Gleame Widget</Text>
                                  <Text as="span" variant="bodySm">{product.transformations}</Text>
                                  <Text as="span" variant="bodySm">—</Text>
                                  <Box>
                                    <Text as="span" variant="bodySm">100%</Text>
                                  </Box>
                                </InlineGrid>
                              </Box>
                            )}
                          </BlockStack>
                        </Box>
                      </Collapsible>
                    </Box>
                  </div>
                );
              })}
            </BlockStack>
          ) : (
            <Box padding="800">
              <BlockStack gap="300" inlineAlign="center">
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  No data yet for the selected time period.
                </Text>
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  Analytics will appear as customers use the transformation widget on your store.
                </Text>
              </BlockStack>
            </Box>
          )}
        </Card>

        {/* Help Section */}
        {currentData.productBreakdown.length === 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Getting Started</Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  • Configure products in the Products tab with transformation prompts
                </Text>
                <Text as="p" variant="bodyMd">
                  • Add a Gleame widget block to your product pages in the theme editor
                </Text>
                <Text as="p" variant="bodyMd">
                  • Analytics will populate as customers upload selfies
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
