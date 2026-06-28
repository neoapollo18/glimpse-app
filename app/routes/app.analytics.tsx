import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
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
import { getAnalytics, getConversionStats, getTopTrafficSources, getAssistantEngagement, type TrafficSourceStat, type AssistantEngagement, type AssistantFunnelCounts } from "../lib/supabase.server";
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

interface AttributionStats {
  totalOrders: number;
  totalRevenue: number;
  widgetAttributedRevenue: number;
  widgetSessions: number;             // distinct widget-engaged carts in window
  widgetSessionsConverted: number;    // of those, how many bought
  widgetPurchaseRate: number;         // % of widget users who bought
  trafficSources: TrafficSourceStat[];
}

const EMPTY_ATTRIBUTION: AttributionStats = {
  totalOrders: 0,
  totalRevenue: 0,
  widgetAttributedRevenue: 0,
  widgetSessions: 0,
  widgetSessionsConverted: 0,
  widgetPurchaseRate: 0,
  trafficSources: [],
};

const EMPTY_FUNNEL_COUNTS = {
  opens: 0,
  starts: 0,
  photoUploads: 0,
  recommendationsShown: 0,
  productClicks: 0,
  addToBag: 0,
  heroViews: 0,
  heroCtaClicks: 0,
};

const EMPTY_ASSISTANT: AssistantEngagement = {
  ...EMPTY_FUNNEL_COUNTS,
  byDevice: {
    mobile: { ...EMPTY_FUNNEL_COUNTS },
    desktop: { ...EMPTY_FUNNEL_COUNTS },
  },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [
    analytics7Days,
    analytics30Days,
    conversion7Days,
    conversion30Days,
    sources7Days,
    sources30Days,
    assistant7Days,
    assistant30Days,
  ] = await Promise.all([
    getAnalytics(session.shop, 7),
    getAnalytics(session.shop, 30),
    getConversionStats(session.shop, 7),
    getConversionStats(session.shop, 30),
    getTopTrafficSources(session.shop, 7),
    getTopTrafficSources(session.shop, 30),
    getAssistantEngagement(session.shop, 7),
    getAssistantEngagement(session.shop, 30),
  ]);

  // Fetch product images from Shopify
  const response = await admin.graphql(`
    query GetProducts($first: Int!) {
      products(first: $first) {
        edges {
          node {
            id
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
          }
        }
      }
    }
  `, {
    variables: { first: 100 }
  });

  const { data } = await response.json();
  
  // Create a map of shopify_id to image URL
  const productImages: Record<string, string> = {};
  data.products.edges.forEach(({ node }: { node: any }) => {
    const imageUrl = node.images?.edges?.[0]?.node?.url || "";
    productImages[node.id] = imageUrl;
  });

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

  const buildAttribution = (
    conv: Awaited<ReturnType<typeof getConversionStats>>,
    sources: TrafficSourceStat[],
  ): AttributionStats => ({
    totalOrders: conv?.totalOrders ?? 0,
    totalRevenue: conv?.totalRevenue ?? 0,
    widgetAttributedRevenue: conv?.widgetAttributedRevenue ?? 0,
    widgetSessions: conv?.widgetSessions ?? 0,
    widgetSessionsConverted: conv?.widgetSessionsConverted ?? 0,
    widgetPurchaseRate: conv?.widgetPurchaseRate ?? 0,
    trafficSources: sources ?? [],
  });

  const attribution7 = buildAttribution(conversion7Days, sources7Days);
  const attribution30 = buildAttribution(conversion30Days, sources30Days);

  return json({
    analytics7: safeAnalytics7,
    analytics30: safeAnalytics30,
    attribution7,
    attribution30,
    assistant7: assistant7Days ?? EMPTY_ASSISTANT,
    assistant30: assistant30Days ?? EMPTY_ASSISTANT,
    productImages,
  });
};

export default function Analytics() {
  const { analytics7, analytics30, attribution7, attribution30, assistant7, assistant30, productImages } = useLoaderData<typeof loader>();
  const [timeRange, setTimeRange] = useState("30");
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  const timeRangeOptions = [
    { label: "Last 7 days", value: "7" },
    { label: "Last 30 days", value: "30" },
  ];

  const currentData = timeRange === "7" ? analytics7 : analytics30;
  const currentAttribution: AttributionStats =
    (timeRange === "7" ? attribution7 : attribution30) ?? EMPTY_ATTRIBUTION;
  const hasAttributionData =
    currentAttribution.totalOrders > 0 || currentAttribution.widgetSessions > 0;

  const assistant: AssistantEngagement = timeRange === "7" ? assistant7 : assistant30;
  const hasAssistantData =
    assistant.opens > 0 ||
    assistant.heroViews > 0 ||
    assistant.photoUploads > 0 ||
    assistant.recommendationsShown > 0;

  // Clamp display percentages to [0, 100]. Counts are event volume, not unique
  // sessions, so a downstream stage can legitimately exceed its predecessor
  // (e.g. several product clicks per recommendation set) — a raw >100% step
  // rate would read as nonsense, so we cap it for the badge/bar.
  const pct = (num: number, denom: number) =>
    denom > 0 ? Math.min((num / denom) * 100, 100) : 0;

  // Funnel stages, in order. Each stage's step-conversion is measured against
  // the immediately prior stage so the "from the prior stage" caption holds.
  const buildFunnel = (counts: AssistantFunnelCounts) =>
    [
      { label: "Assistant opened", count: counts.opens },
      { label: "Consultation started", count: counts.starts },
      { label: "Photo uploaded", count: counts.photoUploads },
      { label: "Recommendations shown", count: counts.recommendationsShown },
      { label: "Product clicked", count: counts.productClicks },
    ].map((stage, i, arr) => ({
      ...stage,
      of: i === 0 ? stage.count : arr[i - 1].count,
    }));

  const assistantFunnel = buildFunnel(assistant);
  const mobileFunnel = buildFunnel(assistant.byDevice.mobile);
  const desktopFunnel = buildFunnel(assistant.byDevice.desktop);
  const mobileOpens = assistant.byDevice.mobile.opens;
  const desktopOpens = assistant.byDevice.desktop.opens;
  // Share of entrances that are classified (mobile + desktop). Legacy/unclassed
  // events have a null device_type and aren't in either bucket.
  const classifiedOpens = mobileOpens + desktopOpens;

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

        {/* Attribution — widget-driven conversion + revenue */}
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">Attribution</Text>
            <Badge tone="success">From Shopify</Badge>
          </InlineStack>

          {!hasAttributionData ? (
            <Card padding="400">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  No orders tracked yet
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Once shoppers complete a purchase, you'll see widget-attributed revenue and top traffic sources here.
                </Text>
              </BlockStack>
            </Card>
          ) : (
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <Card padding="400">
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">Widget → Purchase rate</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {currentAttribution.widgetPurchaseRate.toFixed(1)}%
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {currentAttribution.widgetSessionsConverted.toLocaleString()} of {currentAttribution.widgetSessions.toLocaleString()} widget sessions converted
                    </Text>
                  </BlockStack>
                </Card>

                <Card padding="400">
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">Widget-attributed revenue</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      ${currentAttribution.widgetAttributedRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      of ${currentAttribution.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} total
                    </Text>
                  </BlockStack>
                </Card>
              </InlineGrid>

              {currentAttribution.trafficSources.length > 0 && (
                <Card padding="0">
                  <Box padding="400" paddingBlockEnd="300">
                    <Text as="h3" variant="headingSm">Top traffic sources for widget-attributed orders</Text>
                  </Box>
                  <Divider />
                  <Box padding="400" paddingBlockStart="300">
                    <BlockStack gap="200">
                      {currentAttribution.trafficSources.map((src) => (
                        <InlineStack key={src.source} align="space-between" blockAlign="center">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {src.source}
                          </Text>
                          <InlineStack gap="400" blockAlign="center">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {src.orders.toLocaleString()} {src.orders === 1 ? "order" : "orders"}
                            </Text>
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              ${src.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </Text>
                          </InlineStack>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </Box>
                </Card>
              )}
            </BlockStack>
          )}
        </BlockStack>

        <Divider />

        {/* Assistant engagement funnel */}
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">Assistant engagement</Text>
            <Badge tone="info">Chat assistant</Badge>
          </InlineStack>

          {!hasAssistantData ? (
            <Card padding="400">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  No assistant activity yet
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Once shoppers open the chat assistant and upload a photo, you'll see the engagement funnel here.
                </Text>
              </BlockStack>
            </Card>
          ) : (
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                <Card padding="400">
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">Assistant opens</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {assistant.opens.toLocaleString()}
                    </Text>
                    {assistant.heroViews > 0 && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {pct(assistant.heroCtaClicks, assistant.heroViews).toFixed(0)}% hero click-through ({assistant.heroCtaClicks.toLocaleString()} of {assistant.heroViews.toLocaleString()})
                      </Text>
                    )}
                  </BlockStack>
                </Card>

                <Card padding="400">
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">Completion rate</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {pct(assistant.recommendationsShown, assistant.opens).toFixed(1)}%
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {assistant.recommendationsShown.toLocaleString()} of {assistant.opens.toLocaleString()} opens reached recommendations
                    </Text>
                  </BlockStack>
                </Card>

                <Card padding="400">
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">Recommendation → product</Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {pct(assistant.productClicks, assistant.recommendationsShown).toFixed(1)}%
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {assistant.productClicks.toLocaleString()} viewed a product after seeing recommendations
                    </Text>
                  </BlockStack>
                </Card>
              </InlineGrid>

              <Card padding="0">
                <Box padding="400" paddingBlockEnd="300">
                  <Text as="h3" variant="headingSm">Funnel — from opening the assistant to viewing a product</Text>
                </Box>
                <Divider />
                <Box padding="400" paddingBlockStart="300">
                  <BlockStack gap="300">
                    {assistantFunnel.map((stage, i) => {
                      const shareOfOpens = pct(stage.count, assistant.opens);
                      const stepConversion = i === 0 ? 100 : pct(stage.count, stage.of);
                      return (
                        <BlockStack gap="150" key={stage.label}>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {stage.label}
                            </Text>
                            <InlineStack gap="300" blockAlign="center">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {stage.count.toLocaleString()}
                              </Text>
                              {i > 0 && (
                                <Box minWidth="52px">
                                  <Badge tone={stepConversion >= 50 ? "success" : stepConversion >= 20 ? "attention" : "critical"}>
                                    {`${stepConversion.toFixed(0)}%`}
                                  </Badge>
                                </Box>
                              )}
                            </InlineStack>
                          </InlineStack>
                          <div
                            style={{
                              height: "8px",
                              borderRadius: "4px",
                              background: "var(--p-color-bg-surface-secondary)",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${Math.max(shareOfOpens, stage.count > 0 ? 2 : 0)}%`,
                                background: "var(--p-color-bg-fill-info)",
                              }}
                            />
                          </div>
                        </BlockStack>
                      );
                    })}
                  </BlockStack>
                </Box>
                <Box padding="400" paddingBlockStart="300">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Percentages show step-over-step conversion from the prior stage. Counts are event volume, not unique shoppers.
                  </Text>
                </Box>
              </Card>

              {/* Mobile vs desktop split of the same funnel */}
              <Card padding="0">
                <Box padding="400" paddingBlockEnd="300">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">Mobile vs desktop</Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      How shoppers entered and moved through the assistant, split by device.
                    </Text>
                  </BlockStack>
                </Box>
                <Divider />
                {classifiedOpens === 0 ? (
                  <Box padding="400" paddingBlockStart="300">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Device data is collecting. New assistant activity will appear here split by mobile and desktop.
                    </Text>
                  </Box>
                ) : (
                  <Box padding="400" paddingBlockStart="300">
                    <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                      {[
                        { label: "Mobile", opens: mobileOpens, funnel: mobileFunnel },
                        { label: "Desktop", opens: desktopOpens, funnel: desktopFunnel },
                      ].map((device) => (
                        <Box
                          key={device.label}
                          padding="400"
                          background="bg-surface-secondary"
                          borderRadius="200"
                        >
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <Badge tone={device.label === "Mobile" ? "info" : "success"}>
                                {device.label}
                              </Badge>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {pct(device.opens, classifiedOpens).toFixed(0)}% of entrances
                              </Text>
                            </InlineStack>
                            <BlockStack gap="050">
                              <Text as="p" variant="headingLg" fontWeight="bold">
                                {device.opens.toLocaleString()}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                assistant opens
                              </Text>
                            </BlockStack>
                            <Divider />
                            <BlockStack gap="200">
                              {device.funnel.map((stage, i) => {
                                const shareOfOpens = pct(stage.count, device.opens);
                                const stepConversion = i === 0 ? 100 : pct(stage.count, stage.of);
                                return (
                                  <BlockStack gap="100" key={stage.label}>
                                    <InlineStack align="space-between" blockAlign="center">
                                      <Text as="span" variant="bodySm">
                                        {stage.label}
                                      </Text>
                                      <InlineStack gap="200" blockAlign="center">
                                        <Text as="span" variant="bodySm" fontWeight="semibold">
                                          {stage.count.toLocaleString()}
                                        </Text>
                                        {i > 0 && (
                                          <Text as="span" variant="bodySm" tone="subdued">
                                            {`${stepConversion.toFixed(0)}%`}
                                          </Text>
                                        )}
                                      </InlineStack>
                                    </InlineStack>
                                    <div
                                      style={{
                                        height: "6px",
                                        borderRadius: "3px",
                                        background: "var(--p-color-bg-surface)",
                                        overflow: "hidden",
                                      }}
                                    >
                                      <div
                                        style={{
                                          height: "100%",
                                          width: `${Math.max(shareOfOpens, stage.count > 0 ? 2 : 0)}%`,
                                          background: "var(--p-color-bg-fill-info)",
                                        }}
                                      />
                                    </div>
                                  </BlockStack>
                                );
                              })}
                            </BlockStack>
                          </BlockStack>
                        </Box>
                      ))}
                    </InlineGrid>
                  </Box>
                )}
              </Card>
            </BlockStack>
          )}
        </BlockStack>

        <Divider />

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
                const imageUrl = productImages[product.shopify_id] || "";
                const truncatedName = product.product_name.length > 35 
                  ? product.product_name.slice(0, 35) + '...' 
                  : product.product_name;
                
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
                            source={imageUrl || ImageIcon}
                            alt={product.product_name}
                            size="small"
                          />
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {truncatedName}
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
                            {(() => {
                              // Merge widget types that map to the same display name
                              const widgetNames: Record<string, string> = {
                                embedded: "Gleame Embedded",
                                horizontal: "Gleame Horizontal", 
                                button: "Gleame Button",
                                legacy: "Gleame Legacy",
                                unknown: "Gleame Legacy"
                              };
                              
                              // Combine counts by display name
                              const mergedWidgets: Record<string, number> = {};
                              Object.entries(product.widgets || {}).forEach(([widgetType, count]) => {
                                const displayName = widgetNames[widgetType] || "Gleame Legacy";
                                mergedWidgets[displayName] = (mergedWidgets[displayName] || 0) + count;
                              });
                              
                              return Object.entries(mergedWidgets).map(([displayName, count]) => {
                                const widgetSharePercent = product.transformations > 0 
                                  ? ((count / product.transformations) * 100).toFixed(0)
                                  : "0";
                                
                                return (
                                  <Box 
                                    key={displayName}
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
                              });
                            })()}
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
