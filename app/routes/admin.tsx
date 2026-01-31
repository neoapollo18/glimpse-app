import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { useState } from "react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Modal,
  Thumbnail,
  Spinner,
  Divider,
  Box,
  Icon,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import enTranslations from "@shopify/polaris/locales/en.json";
import { supabase } from "../lib/supabase.server";
import { authenticate } from "../shopify.server";

// ============================================
// GLEAME FOUNDERS ADMIN PAGE
// ============================================
// Only accessible from specific Shopify stores
// Add your store domains to ALLOWED_SHOPS

const ALLOWED_SHOPS = [
  "testingaaronandevansaas.myshopify.com", // Add your store domains here
  "hx5hqt-na.myshopify.com",
];

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

interface VariantConfig {
  id: string;
  variant_id: string;
  variant_title: string;
  transformation_prompt: string;
}

interface Product {
  id: string;
  shopify_id: string;
  product_name: string;
  product_image_url: string | null;
  transformation_prompt: string;
  is_funnel_generated: boolean;
  category_id: string | null;
  funnel_responses: Record<string, number | string> | null;
  created_at: string;
  categories?: { name: string; slug: string } | null;
  transformation_count: number;
  variant_configs?: VariantConfig[];
}

interface Shop {
  id: string;
  shop_domain: string;
  shopify_id: string;
  shop_name: string | null;
  products: Product[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("🔐 Founders admin page accessed");

  // Require Shopify admin authentication
  const { session } = await authenticate.admin(request);
  
  // Check if shop is in allowlist
  if (!ALLOWED_SHOPS.includes(session.shop)) {
    console.log(`❌ Access denied for shop: ${session.shop}`);
    throw new Response("Forbidden - Your store is not authorized to access this page", { 
      status: 403 
    });
  }
  
  console.log(`✅ Access granted for shop: ${session.shop}`);

  try {
    // Fetch ALL shops
    const { data: shops, error: shopsError } = await supabase
      .from("shops")
      .select("*")
      .order("shop_domain");

    if (shopsError) {
      console.error("Error fetching shops:", shopsError);
      return json({ 
        shops: [], 
        stats: { totalShops: 0, totalProducts: 0, totalTransformations: 0 },
        error: shopsError.message 
      });
    }

    // For each shop, fetch products with category info and variant configs
    const shopsWithProducts = await Promise.all(
      (shops || []).map(async (shop) => {
        const { data: products, error: productsError } = await supabase
          .from("products")
          .select(`
            *,
            categories (name, slug)
          `)
          .eq("shop_id", shop.id)
          .order("product_name");

        if (productsError) {
          console.error(`Error fetching products for ${shop.shop_domain}:`, productsError);
          return { ...shop, products: [] };
        }

        // Fetch variant configs for all products in this shop
        const productIds = (products || []).map((p: { id: string }) => p.id);
        const { data: variantConfigs } = await supabase
          .from("product_variants")
          .select("*")
          .in("product_id", productIds.length > 0 ? productIds : ["none"]);

        // Attach variant configs to each product
        const productsWithVariants = (products || []).map((product: { id: string }) => ({
          ...product,
          variant_configs: (variantConfigs || []).filter(
            (vc: { product_id: string }) => vc.product_id === product.id
          ),
        }));

        return { ...shop, products: productsWithVariants };
      })
    );

    // Calculate totals
    const totalProducts = shopsWithProducts.reduce((acc, s) => acc + s.products.length, 0);

    // Get total transformations across all stores
    const { count: totalTransformations, error: transformationsError } = await supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "transformation");

    if (transformationsError) {
      console.error("Error fetching transformations count:", transformationsError);
    }

    return json({
      shops: shopsWithProducts,
      stats: {
        totalShops: shopsWithProducts.length,
        totalProducts,
        totalTransformations: totalTransformations || 0,
      },
      error: null,
    });
  } catch (error) {
    console.error("Admin loader error:", error);
    return json({ 
      shops: [], 
      stats: { totalShops: 0, totalProducts: 0, totalTransformations: 0 },
      error: String(error) 
    });
  }
};

// Sanitize and validate prompt input
function sanitizePrompt(prompt: string | null): { valid: boolean; sanitized: string; error?: string } {
  if (!prompt || typeof prompt !== 'string') {
    return { valid: false, sanitized: '', error: 'Prompt is required' };
  }
  
  // Trim and limit length (max 10KB to prevent abuse)
  let sanitized = prompt.trim();
  const MAX_LENGTH = 10000;
  
  if (sanitized.length > MAX_LENGTH) {
    return { valid: false, sanitized: '', error: `Prompt too long (max ${MAX_LENGTH} characters)` };
  }
  
  // Remove potential script tags and other dangerous HTML (prompts should be plain text)
  sanitized = sanitized
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, ''); // Remove any HTML tags
  
  return { valid: true, sanitized };
}

// Validate UUID format
function isValidUUID(id: string | null): boolean {
  if (!id) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "update-prompt") {
    const productId = formData.get("productId") as string;
    const newPrompt = formData.get("prompt") as string;

    // Validate productId
    if (!isValidUUID(productId)) {
      return json({ success: false, error: "Invalid product ID" });
    }

    // Sanitize prompt
    const { valid, sanitized, error } = sanitizePrompt(newPrompt);
    if (!valid) {
      return json({ success: false, error });
    }

    console.log("📝 Updating prompt for product:", productId);

    const { error: dbError } = await supabase
      .from("products")
      .update({ transformation_prompt: sanitized })
      .eq("id", productId);

    if (dbError) {
      console.error("Error updating prompt:", dbError);
      return json({ success: false, error: dbError.message });
    }

    console.log("✅ Prompt updated successfully");
    return json({ success: true });
  }

  if (actionType === "update-variant-prompt") {
    const variantId = formData.get("variantId") as string;
    const newPrompt = formData.get("prompt") as string;

    // Validate variantId
    if (!isValidUUID(variantId)) {
      return json({ success: false, error: "Invalid variant ID" });
    }

    // Sanitize prompt
    const { valid, sanitized, error } = sanitizePrompt(newPrompt);
    if (!valid) {
      return json({ success: false, error });
    }

    console.log("📝 Updating prompt for variant: ", variantId);

    const { error: dbError } = await supabase
      .from("product_variants")
      .update({ transformation_prompt: sanitized })
      .eq("id", variantId);

    if (dbError) {
      console.error("Error updating variant prompt:", dbError);
      return json({ success: false, error: dbError.message });
    }

    console.log("✅ Variant prompt updated successfully");
    return json({ success: true });
  }

  return json({ success: false, error: "Unknown action" });
};

export default function FoundersAdmin() {
  const { shops, stats, error } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedShop, setExpandedShop] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editPromptValue, setEditPromptValue] = useState("");
  const [editingVariant, setEditingVariant] = useState<string | null>(null);
  const [editVariantPromptValue, setEditVariantPromptValue] = useState("");
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testProduct, setTestProduct] = useState<Product | null>(null);
  const [testShopDomain, setTestShopDomain] = useState<string | null>(null);
  const [testImageUrl, setTestImageUrl] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Filter shops by search query
  const filteredShops = (shops || []).filter((shop: Shop) =>
    shop.shop_domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
    shop.shop_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleShop = (shopId: string) => {
    setExpandedShop(expandedShop === shopId ? null : shopId);
    setExpandedProduct(null); // Collapse any expanded product when switching shops
  };

  const toggleProduct = (productId: string) => {
    setExpandedProduct(expandedProduct === productId ? null : productId);
    setEditingProduct(null); // Cancel any editing when toggling
  };

  const startEditPrompt = (product: Product) => {
    setEditingProduct(product.id);
    setEditPromptValue(product.transformation_prompt);
    setEditingVariant(null); // Cancel any variant editing
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditPromptValue("");
  };

  const startEditVariantPrompt = (variant: VariantConfig) => {
    setEditingVariant(variant.id);
    setEditVariantPromptValue(variant.transformation_prompt);
    setEditingProduct(null); // Cancel any product editing
  };

  const cancelVariantEdit = () => {
    setEditingVariant(null);
    setEditVariantPromptValue("");
  };

  const saveVariantPrompt = (variantId: string) => {
    const formData = new FormData();
    formData.append("action", "update-variant-prompt");
    formData.append("variantId", variantId);
    formData.append("prompt", editVariantPromptValue);
    submit(formData, { method: "POST" });
    setEditingVariant(null);
    setEditVariantPromptValue("");
  };

  const savePrompt = (productId: string) => {
    const formData = new FormData();
    formData.append("action", "update-prompt");
    formData.append("productId", productId);
    formData.append("prompt", editPromptValue);
    submit(formData, { method: "POST" });
    setEditingProduct(null);
    setEditPromptValue("");
  };

  const openTestModal = (product: Product, shopDomain: string) => {
    setTestProduct(product);
    setTestShopDomain(shopDomain);
    setTestImageUrl("");
    setTestResult(null);
    setTestModalOpen(true);
  };

  const runTest = async () => {
    if (!testProduct || !testImageUrl || !testShopDomain) return;

    setTestLoading(true);
    setTestResult(null);

    try {
      // Fetch the image from URL and convert to File
      const imageResponse = await fetch(testImageUrl);
      if (!imageResponse.ok) {
        throw new Error("Failed to fetch image from URL");
      }
      const imageBlob = await imageResponse.blob();
      const imageFile = new File([imageBlob], "test-image.jpg", { 
        type: imageBlob.type || "image/jpeg" 
      });

      // Create FormData with proper fields for storefront API
      const formData = new FormData();
      formData.append("image", imageFile);
      formData.append("productId", testProduct.shopify_id);
      formData.append("shopDomain", testShopDomain);

      const response = await fetch("/api/storefront/transform-image", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.success && data.generatedImage) {
        // Convert base64 to data URL for display
        setTestResult(`data:image/jpeg;base64,${data.generatedImage}`);
      } else {
        setTestResult("Error: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      setTestResult("Error: " + String(err));
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <AppProvider i18n={enTranslations}>
      <Page title="Gleame Founders Admin">
        <BlockStack gap="500">
          {error && (
            <Banner tone="critical">
              <Text as="p" variant="bodyMd">Error: {error}</Text>
            </Banner>
          )}

          {/* Platform Stats */}
          <Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">Total Shops</Text>
                  <Text as="p" variant="headingXl">{stats?.totalShops || 0}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">Total Products</Text>
                  <Text as="p" variant="headingXl">{stats?.totalProducts || 0}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">Total Transformations</Text>
                  <Text as="p" variant="headingXl">{stats?.totalTransformations?.toLocaleString() || 0}</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          {/* Search */}
          <Card>
            <TextField
              label=""
              labelHidden
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search shops by domain..."
              prefix={<Icon source={SearchIcon} />}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setSearchQuery("")}
            />
          </Card>

          {/* Shops List */}
          <Text as="h2" variant="headingLg">
            Shops ({filteredShops.length})
          </Text>

          {filteredShops.length === 0 && (
            <Card>
              <Text as="p" tone="subdued">
                {searchQuery ? "No shops match your search." : "No shops found."}
              </Text>
            </Card>
          )}

          {filteredShops.map((shop: Shop) => (
            <Card key={shop.id}>
              <BlockStack gap="400">
                {/* Shop Header - Click to expand */}
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingMd">{shop.shop_domain}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {shop.products.length} product{shop.products.length !== 1 ? "s" : ""} configured
                    </Text>
                  </BlockStack>
                  <Button onClick={() => toggleShop(shop.id)}>
                    {expandedShop === shop.id ? "Collapse" : "View Products"}
                  </Button>
                </InlineStack>

                {/* Expanded: Products */}
                {expandedShop === shop.id && (
                  <BlockStack gap="400">
                    <Divider />
                    
                    {shop.products.length === 0 ? (
                      <Text as="p" tone="subdued">No products configured for this shop.</Text>
                    ) : (
                      shop.products.map((product: Product) => (
                        <Card key={product.id}>
                          <BlockStack gap="300">
                            {/* Product Header - Click to expand */}
                            <InlineStack gap="400" blockAlign="center">
                              {product.product_image_url && (
                                <Thumbnail
                                  source={product.product_image_url}
                                  alt={product.product_name}
                                  size="small"
                                />
                              )}
                              <BlockStack gap="100">
                                <Text as="h4" variant="headingSm">
                                  {product.product_name.length > 60 
                                    ? product.product_name.substring(0, 60) + "..." 
                                    : product.product_name}
                                </Text>
                                <InlineStack gap="200">
                                  {product.is_funnel_generated && product.categories?.name && (
                                    <Badge tone="success">{product.categories.name}</Badge>
                                  )}
                                  {product.variant_configs && product.variant_configs.length > 0 && (
                                    <Badge tone="info">{`${product.variant_configs.length} variant${product.variant_configs.length > 1 ? 's' : ''}`}</Badge>
                                  )}
                                </InlineStack>
                              </BlockStack>
                              <div style={{ marginLeft: "auto" }}>
                                <InlineStack gap="200">
                                  <Button size="slim" onClick={() => toggleProduct(product.id)}>
                                    {expandedProduct === product.id ? "Hide" : "View Prompt"}
                                  </Button>
                                  <Button size="slim" variant="primary" onClick={() => openTestModal(product, shop.shop_domain)}>
                                    Test
                                  </Button>
                                </InlineStack>
                              </div>
                            </InlineStack>

                            {/* Expanded: Transformation Prompt */}
                            {expandedProduct === product.id && (
                              <BlockStack gap="300">
                                <Divider />
                                <BlockStack gap="200">
                                  <InlineStack align="space-between">
                                    <Text as="p" variant="bodySm" fontWeight="semibold">
                                      Transformation Prompt:
                                    </Text>
                                    {editingProduct === product.id ? (
                                      <InlineStack gap="200">
                                        <Button size="slim" onClick={cancelEdit}>Cancel</Button>
                                        <Button size="slim" variant="primary" onClick={() => savePrompt(product.id)}>
                                          Save
                                        </Button>
                                      </InlineStack>
                                    ) : (
                                      <Button size="slim" onClick={() => startEditPrompt(product)}>
                                        Edit
                                      </Button>
                                    )}
                                  </InlineStack>

                                  {editingProduct === product.id ? (
                                    <TextField
                                      label=""
                                      labelHidden
                                      value={editPromptValue}
                                      onChange={setEditPromptValue}
                                      multiline={10}
                                      autoComplete="off"
                                    />
                                  ) : (
                                    <Box
                                      padding="300"
                                      background="bg-surface-secondary"
                                      borderRadius="200"
                                    >
                                      <pre style={{ 
                                        whiteSpace: "pre-wrap", 
                                        wordBreak: "break-word",
                                        margin: 0,
                                        fontFamily: "monospace",
                                        fontSize: "12px"
                                      }}>
                                        {product.transformation_prompt}
                                      </pre>
                                    </Box>
                                  )}
                                </BlockStack>

                                {/* Variant Configs */}
                                {product.variant_configs && product.variant_configs.length > 0 && (
                                  <BlockStack gap="300">
                                    <Divider />
                                    <Text as="p" variant="bodySm" fontWeight="semibold">
                                      Variant Configurations ({product.variant_configs.length}):
                                    </Text>
                                    {product.variant_configs.map((vc: VariantConfig) => (
                                      <Box
                                        key={vc.id}
                                        padding="300"
                                        background="bg-surface-secondary"
                                        borderRadius="200"
                                      >
                                        <BlockStack gap="200">
                                          <InlineStack align="space-between" blockAlign="center">
                                            <InlineStack gap="200" blockAlign="center">
                                              <Badge>{vc.variant_title}</Badge>
                                              <Text as="span" variant="bodySm" tone="subdued">
                                                ID: {vc.variant_id}
                                              </Text>
                                            </InlineStack>
                                            {editingVariant === vc.id ? (
                                              <InlineStack gap="200">
                                                <Button size="slim" onClick={cancelVariantEdit}>Cancel</Button>
                                                <Button size="slim" variant="primary" onClick={() => saveVariantPrompt(vc.id)}>
                                                  Save
                                                </Button>
                                              </InlineStack>
                                            ) : (
                                              <Button size="slim" onClick={() => startEditVariantPrompt(vc)}>
                                                Edit
                                              </Button>
                                            )}
                                          </InlineStack>
                                          
                                          {editingVariant === vc.id ? (
                                            <TextField
                                              label=""
                                              labelHidden
                                              value={editVariantPromptValue}
                                              onChange={setEditVariantPromptValue}
                                              multiline={8}
                                              autoComplete="off"
                                            />
                                          ) : (
                                            <pre style={{ 
                                              whiteSpace: "pre-wrap", 
                                              wordBreak: "break-word",
                                              margin: 0,
                                              fontFamily: "monospace",
                                              fontSize: "11px",
                                              maxHeight: "150px",
                                              overflow: "auto"
                                            }}>
                                              {vc.transformation_prompt}
                                            </pre>
                                          )}
                                        </BlockStack>
                                      </Box>
                                    ))}
                                  </BlockStack>
                                )}

                                {/* Shopify ID */}
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Shopify ID: {product.shopify_id}
                                </Text>
                              </BlockStack>
                            )}
                          </BlockStack>
                        </Card>
                      ))
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          ))}
        </BlockStack>

        {/* Test Modal */}
        <Modal
          open={testModalOpen}
          onClose={() => setTestModalOpen(false)}
          title={`Test: ${testProduct?.product_name}`}
          primaryAction={{
            content: testLoading ? "Testing..." : "Run Test",
            onAction: runTest,
            disabled: !testImageUrl || testLoading,
          }}
          secondaryActions={[{ content: "Close", onAction: () => setTestModalOpen(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Image URL"
                value={testImageUrl}
                onChange={setTestImageUrl}
                placeholder="https://example.com/selfie.jpg"
                helpText="Enter a public image URL to test"
                autoComplete="off"
              />

              {testLoading && (
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="p">Running transformation...</Text>
                </InlineStack>
              )}

              {testResult && (
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">Result:</Text>
                  {testResult.startsWith("Error") ? (
                    <Banner tone="critical">
                      <Text as="p">{testResult}</Text>
                    </Banner>
                  ) : (
                    <img
                      src={testResult}
                      alt="Transformed"
                      style={{ maxWidth: "100%", borderRadius: "8px" }}
                    />
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      </Page>
    </AppProvider>
  );
}
