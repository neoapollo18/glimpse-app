import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  DataTable,
  Badge,
  TextField,
  Modal,
  FormLayout,
  Thumbnail,
  Banner,
  DropZone,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { 
  getConfiguredProducts, 
  saveProductConfiguration, 
  updateProductConfiguration, 
  deleteProductConfiguration,
  getProductVariants,
  saveVariantConfiguration
} from "../lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Fetch products from Shopify
  const response = await admin.graphql(`
    query GetProducts($first: Int!) {
      products(first: $first) {
        edges {
          node {
            id
            title
            handle
            status
            vendor
            productType
            tags
            images(first: 1) {
              edges {
                node {
                  id
                  url
                  altText
                }
              }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  price
                  availableForSale
                }
              }
            }
          }
        }
      }
    }
  `, {
    variables: {
      first: 50
    }
  });

  const { data } = await response.json();
  const shopifyProducts = data.products.edges.map(({ node }: { node: any }) => node);

  // Fetch configured products from Supabase
  console.log('🔍 DEBUG: Fetching products for shop:', session.shop);
  const configuredProducts = session.shop 
    ? await getConfiguredProducts(session.shop)
    : [];
  console.log('🔍 DEBUG: Found', configuredProducts.length, 'configured products');

  return { shopifyProducts, configuredProducts, shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "configure") {
    try {
      const shopifyProductId = formData.get("shopifyProductId");
      const productTitle = formData.get("productTitle");
      const transformationPrompt = formData.get("transformationPrompt");

      // Save to Supabase
      await saveProductConfiguration(session.shop, shopifyProductId as string, productTitle as string, transformationPrompt as string);

      return { success: true, message: "Product configured successfully!" };
    } catch (error) {
      console.error("Error saving product configuration:", error);
      return { success: false, message: "Failed to save configuration. Please try again." };
    }
  }

  if (action === "update") {
    try {
      const configuredProductId = formData.get("configuredProductId");
      const transformationPrompt = formData.get("transformationPrompt");

      // Update in Supabase
      await updateProductConfiguration(configuredProductId as string, transformationPrompt as string);

      return { success: true, message: "Product configuration updated successfully!" };
    } catch (error) {
      console.error("Error updating product configuration:", error);
      return { success: false, message: "Failed to update configuration. Please try again." };
    }
  }

  if (action === "delete") {
    try {
      const configuredProductId = formData.get("configuredProductId");

      // Delete from Supabase
      await deleteProductConfiguration(configuredProductId as string);

      return { success: true, message: "Product configuration deleted successfully!" };
    } catch (error) {
      console.error("Error deleting product configuration:", error);
      return { success: false, message: "Failed to delete configuration. Please try again." };
    }
  }

  if (action === "test") {
    // TODO: Implement test transformation
    return { success: true, message: "Test transformation initiated!" };
  }

  if (action === "save-variant") {
    try {
      const productId = formData.get("productId") as string; // Internal UUID
      const shopifyVariantId = formData.get("shopifyVariantId") as string;
      const variantTitle = formData.get("variantTitle") as string;
      const transformationPrompt = formData.get("transformationPrompt") as string;

      // Save variant configuration
      await saveVariantConfiguration(productId, shopifyVariantId, variantTitle, transformationPrompt);

      return { success: true, message: "Variant configured successfully!" };
    } catch (error) {
      console.error("Error saving variant configuration:", error);
      return { success: false, message: "Failed to save variant configuration. Please try again." };
    }
  }

  if (action === "delete-variant") {
    try {
      const variantConfigId = formData.get("variantConfigId") as string;

      // Delete variant configuration
      const { supabase } = await import("../lib/supabase.server");
      await supabase
        .from('product_variants')
        .delete()
        .eq('id', variantConfigId);

      return { success: true, message: "Variant configuration deleted successfully!" };
    } catch (error) {
      console.error("Error deleting variant configuration:", error);
      return { success: false, message: "Failed to delete variant configuration. Please try again." };
    }
  }

  return { success: false, message: "Unknown action" };
};

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  tags: string[];
  images: {
    edges: Array<{
      node: {
        id: string;
        url: string;
        altText: string;
      };
    }>;
  };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        availableForSale: boolean;
      };
    }>;
  };
}

interface ConfiguredProduct {
  id: string;
  shopify_id: string;
  product_name: string;
  transformation_prompt: string;
  created_at: string;
}

export default function Products() {
  const { shopifyProducts, configuredProducts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const submit = useSubmit();
  const [selectedProduct, setSelectedProduct] = useState<ShopifyProduct | null>(null);
  const [selectedConfiguredProduct, setSelectedConfiguredProduct] = useState<ConfiguredProduct | null>(null);
  const [modalActive, setModalActive] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [transformationPrompt, setTransformationPrompt] = useState("");

  // Test modal state
  const [testModalActive, setTestModalActive] = useState(false);
  const [selectedTestProduct, setSelectedTestProduct] = useState<ConfiguredProduct | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [transformedImageUrl, setTransformedImageUrl] = useState<string | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const [transformError, setTransformError] = useState<string | null>(null);

  // Variant configuration state (Phase 3)
  const [showVariants, setShowVariants] = useState(false);
  const [configuredVariants, setConfiguredVariants] = useState<any[]>([]);
  const [selectedVariantForConfig, setSelectedVariantForConfig] = useState<any | null>(null);
  const [variantPrompt, setVariantPrompt] = useState("");
  const [variantModalActive, setVariantModalActive] = useState(false);

  // Load configured variants when editing a product
  useEffect(() => {
    async function loadVariants() {
      if (selectedConfiguredProduct && modalActive) {
        try {
          // Fetch from Supabase using the product's internal ID
          const response = await fetch(`/api/get-variants?productId=${selectedConfiguredProduct.id}`);
          if (response.ok) {
            const data = await response.json();
            setConfiguredVariants(data.variants || []);
          }
        } catch (error) {
          console.error('Error loading variants:', error);
        }
      }
    }
    loadVariants();
  }, [selectedConfiguredProduct, modalActive]);

  const isConfigured = (shopifyId: string) => {
    return configuredProducts.some((cp) => cp.shopify_id === shopifyId);
  };

  const handleConfigure = (product: ShopifyProduct) => {
    setSelectedProduct(product);
    setSelectedConfiguredProduct(null);
    setIsEditMode(false);
    setModalActive(true);
  };

  const handleEdit = (configuredProduct: ConfiguredProduct) => {
    // Find the corresponding Shopify product for context
    const shopifyProduct = shopifyProducts.find((p: ShopifyProduct) => p.id === configuredProduct.shopify_id);
    
    setSelectedProduct(shopifyProduct || null);
    setSelectedConfiguredProduct(configuredProduct);
    setIsEditMode(true);
    setTransformationPrompt(configuredProduct.transformation_prompt);
    setShowVariants(false); // Reset variant view
    setConfiguredVariants([]); // Will load when user expands variants
    setModalActive(true);
  };

  const handleSave = () => {
    if (!selectedProduct && !selectedConfiguredProduct) return;

    const formData = new FormData();
    if (isEditMode && selectedConfiguredProduct) {
      formData.append("action", "update");
      formData.append("configuredProductId", selectedConfiguredProduct.id);
      formData.append("transformationPrompt", transformationPrompt);
    } else if (selectedProduct) {
      formData.append("action", "configure");
      formData.append("shopifyProductId", selectedProduct.id);
      formData.append("productTitle", selectedProduct.title);
      formData.append("transformationPrompt", transformationPrompt);
    }

    submit(formData, { method: "POST" });
    setModalActive(false);
    setSelectedProduct(null);
    setSelectedConfiguredProduct(null);
    setIsEditMode(false);
    setTransformationPrompt("");
  };

  const handleDelete = () => {
    if (!selectedConfiguredProduct) return;

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("configuredProductId", selectedConfiguredProduct.id);

    submit(formData, { method: "POST" });
    setModalActive(false);
    setSelectedProduct(null);
    setSelectedConfiguredProduct(null);
    setIsEditMode(false);
    setTransformationPrompt("");
  };

  const handleTest = (configuredProduct: ConfiguredProduct) => {
    setSelectedTestProduct(configuredProduct);
    setTestModalActive(true);
    // Reset modal state
    setUploadedFile(null);
    setUploadedImageUrl(null);
    setTransformedImageUrl(null);
    setTransformError(null);
  };

  const handleImageUpload = (files: File[]) => {
    if (files.length > 0) {
      const file = files[0];
      setUploadedFile(file);
      
      // Create preview URL
      const previewUrl = URL.createObjectURL(file);
      setUploadedImageUrl(previewUrl);
      setTransformedImageUrl(null);
      setTransformError(null);
    }
  };

  const handleTransformImage = async () => {
    if (!uploadedFile || !selectedTestProduct) return;

    setIsTransforming(true);
    setTransformError(null);

    try {
      const formData = new FormData();
      formData.append('image', uploadedFile);
      formData.append('transformationPrompt', selectedTestProduct.transformation_prompt);

      const response = await fetch('/api/transform-image', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Transformation failed');
      }

      // Convert base64 to blob URL for display
      const base64Image = result.generatedImage;
      const binaryString = atob(base64Image);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const transformedUrl = URL.createObjectURL(blob);
      
      setTransformedImageUrl(transformedUrl);
    } catch (error) {
      console.error('Transform error:', error);
      setTransformError(error instanceof Error ? error.message : 'Transformation failed');
    } finally {
      setIsTransforming(false);
    }
  };

  const handleCloseTestModal = () => {
    setTestModalActive(false);
    setSelectedTestProduct(null);
    setUploadedFile(null);
    if (uploadedImageUrl) {
      URL.revokeObjectURL(uploadedImageUrl);
      setUploadedImageUrl(null);
    }
    if (transformedImageUrl) {
      URL.revokeObjectURL(transformedImageUrl);
      setTransformedImageUrl(null);
    }
    setTransformError(null);
  };

  // Variant configuration handlers (Phase 3)
  const handleConfigureVariant = (variant: any) => {
    // Check if variant already configured
    const existingConfig = configuredVariants.find(v => v.shopify_variant_id === variant.id);
    
    setSelectedVariantForConfig(variant);
    setVariantPrompt(existingConfig?.transformation_prompt || "");
    setVariantModalActive(true);
  };

  const handleSaveVariant = async () => {
    if (!selectedConfiguredProduct || !selectedVariantForConfig) return;

    const formData = new FormData();
    formData.append("action", "save-variant");
    formData.append("productId", selectedConfiguredProduct.id);
    formData.append("shopifyVariantId", selectedVariantForConfig.id);
    formData.append("variantTitle", selectedVariantForConfig.title);
    formData.append("transformationPrompt", variantPrompt);

    submit(formData, { method: "POST" });
    setVariantModalActive(false);
    setSelectedVariantForConfig(null);
    setVariantPrompt("");
    
    // Reload configured variants to show updated status
    setTimeout(async () => {
      try {
        const response = await fetch(`/api/get-variants?productId=${selectedConfiguredProduct.id}`);
        if (response.ok) {
          const data = await response.json();
          setConfiguredVariants(data.variants || []);
        }
      } catch (error) {
        console.error('Error reloading variants:', error);
      }
    }, 500); // Small delay to let the save complete
  };

  const handleDeleteVariant = async (variantConfigId: string) => {
    const formData = new FormData();
    formData.append("action", "delete-variant");
    formData.append("variantConfigId", variantConfigId);

    submit(formData, { method: "POST" });
    
    // Reload configured variants to show updated status
    if (selectedConfiguredProduct) {
      setTimeout(async () => {
        try {
          const response = await fetch(`/api/get-variants?productId=${selectedConfiguredProduct.id}`);
          if (response.ok) {
            const data = await response.json();
            setConfiguredVariants(data.variants || []);
          }
        } catch (error) {
          console.error('Error reloading variants:', error);
        }
      }, 500);
    }
  };

  // Configured Products Table - sorted alphabetically with product images
  const sortedConfiguredProducts = [...configuredProducts].sort((a, b) => 
    a.product_name.localeCompare(b.product_name)
  );
  
  const configuredProductsRows = sortedConfiguredProducts.map((product) => {
    // Find the corresponding Shopify product to get the image
    const shopifyProduct = shopifyProducts.find((sp: ShopifyProduct) => sp.id === product.shopify_id);
    const imageUrl = shopifyProduct?.images?.edges?.[0]?.node?.url || "";
    
    return [
      <div style={{ width: '280px', minWidth: '280px' }} key={product.id}>
        <InlineStack gap="300" wrap={false} blockAlign="center">
          <div style={{ width: '40px', height: '40px', flexShrink: 0 }}>
            <Thumbnail
              source={imageUrl || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
              alt={product.product_name}
              size="small"
            />
          </div>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {product.product_name.length > 35 
              ? `${product.product_name.substring(0, 35)}...` 
              : product.product_name}
          </Text>
        </InlineStack>
      </div>,
      <div style={{ paddingLeft: '8px' }}>
        <Text as="span" variant="bodySm">
          {product.transformation_prompt.length > 100 
            ? `${product.transformation_prompt.substring(0, 100)}...` 
            : product.transformation_prompt}
        </Text>
      </div>,
      <InlineStack gap="200">
        <Button size="slim" onClick={() => handleTest(product)}>
          Test
        </Button>
        <Button variant="plain" size="slim" onClick={() => handleEdit(product)}>
          Edit
        </Button>
      </InlineStack>,
    ];
  });

  // All Shopify Products Table - sorted alphabetically
  const sortedShopifyProducts = [...shopifyProducts].sort((a: ShopifyProduct, b: ShopifyProduct) => 
    a.title.localeCompare(b.title)
  );
  
  const allProductsRows = sortedShopifyProducts.map((product: ShopifyProduct) => {
    const image = product.images.edges[0]?.node;
    const price = product.variants.edges[0]?.node?.price || "0";
    const configured = isConfigured(product.id);

    return [
      <div style={{ width: '300px', minWidth: '300px' }} key={product.id}>
        <InlineStack gap="300" wrap={false} blockAlign="center">
          <div style={{ width: '40px', height: '40px', flexShrink: 0 }}>
            <Thumbnail
              source={image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
              alt={image?.altText || product.title}
              size="small"
            />
          </div>
          <BlockStack gap="100">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {product.title.length > 35 
                ? `${product.title.substring(0, 35)}...` 
                : product.title}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              ${price} • {product.productType}
            </Text>
          </BlockStack>
        </InlineStack>
      </div>,
      <Button
        variant={configured ? "plain" : "primary"}
        onClick={() => handleConfigure(product)}
        size="slim"
        disabled={configured}
      >
        {configured ? "Configured" : "Configure"}
      </Button>,
    ];
  });

  return (
    <Page>
      <TitleBar title="Product Configuration" />
      
      <BlockStack gap="500">
        {fetcher.data?.success && (
          <Banner
            title={fetcher.data.message}
            tone="success"
            onDismiss={() => {}}
          />
        )}

        {fetcher.data?.success === false && (
          <Banner
            title={fetcher.data.message}
            tone="critical"
            onDismiss={() => {}}
          />
        )}

        {/* Configured Products Panel */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Configured Products
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Products that are enabled for AI transformations
                  </Text>
                </BlockStack>

                {configuredProducts.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Product", "Transformation Prompt", "Actions"]}
                    rows={configuredProductsRows}
                  />
                ) : (
                  <Card>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                        No products configured yet. Configure your first product below to enable AI transformations.
                      </Text>
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* All Products Panel */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    All Products
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Select products to enable for AI virtual try-on
                  </Text>
                </BlockStack>

                <DataTable
                  columnContentTypes={["text", "text"]}
                  headings={["Product", "Action"]}
                  rows={allProductsRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">How it Works</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      1. Select products to enable for AI transformations
                    </Text>
                    <Text as="p" variant="bodyMd">
                      2. Write a transformation prompt describing the effect
                    </Text>
                    <Text as="p" variant="bodyMd">
                      3. Test the transformation with sample images
                    </Text>
                    <Text as="p" variant="bodyMd">
                      4. Add the widget to your product pages
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Best Practices</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      • Use specific, simple prompts
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Match the prompt to your product
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Test transformations before going live
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Configuration Modal */}
      <Modal
        open={modalActive}
        onClose={() => setModalActive(false)}
        title={isEditMode ? "Edit AI Transformation" : "Configure AI Transformation"}
      >
        <Modal.Section>
          {(selectedProduct || selectedConfiguredProduct) && (
            <FormLayout>
              <BlockStack gap="300">
                {selectedProduct && (
                  <InlineStack gap="300">
                    <Thumbnail
                      source={selectedProduct.images.edges[0]?.node?.url || ""}
                      alt={selectedProduct.title}
                      size="large"
                    />
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingMd">
                        {selectedProduct.title}
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {selectedProduct.productType}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                )}
                
                {!selectedProduct && selectedConfiguredProduct && (
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingMd">
                      {selectedConfiguredProduct.product_name}
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Edit transformation settings
                    </Text>
                  </BlockStack>
                )}

                <TextField
                  label="Product-Level Transformation Prompt (Default)"
                  value={transformationPrompt}
                  onChange={setTransformationPrompt}
                  multiline={4}
                  helpText="This prompt is used when no variant-specific prompt is configured"
                  placeholder="e.g., Darken and thicken the person's eyelashes..."
                  autoComplete="off"
                />

                {/* Variant Configuration Section (Phase 3) */}
                {isEditMode && selectedProduct && selectedProduct.variants.edges.length > 1 && (
                  <BlockStack gap="400">
                    <div style={{ borderTop: '1px solid #e1e3e5', paddingTop: '20px' }}>
                      <BlockStack gap="300">
                        <Text as="h4" variant="headingMd">
                          Variant-Specific Prompts (Optional)
                        </Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Configure different prompts for each variant. Falls back to product-level prompt if not configured.
                        </Text>
                        
                        {selectedProduct.variants.edges.map(({ node: variant }) => {
                          const variantConfig = configuredVariants.find(v => v.shopify_variant_id === variant.id);
                          const isConfigured = !!variantConfig;
                          
                          return (
                            <Card key={variant.id}>
                              <BlockStack gap="200">
                                <InlineStack align="space-between">
                                  <BlockStack gap="100">
                                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                                      {variant.title}
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      ${variant.price} • {variant.availableForSale ? 'Available' : 'Not available'}
                                    </Text>
                                  </BlockStack>
                                  <Badge tone={isConfigured ? "success" : "info"}>
                                    {isConfigured ? "Configured" : "Using default"}
                                  </Badge>
                                </InlineStack>
                                
                                {isConfigured && (
                                  <BlockStack gap="200">
                                    <Text as="p" variant="bodySm">
                                      <strong>Prompt:</strong> {variantConfig.transformation_prompt.substring(0, 100)}
                                      {variantConfig.transformation_prompt.length > 100 && '...'}
                                    </Text>
                                    <InlineStack gap="200">
                                      <Button
                                        size="slim"
                                        onClick={() => handleConfigureVariant(variant)}
                                      >
                                        Edit
                                      </Button>
                                      <Button
                                        size="slim"
                                        variant="plain"
                                        tone="critical"
                                        onClick={() => handleDeleteVariant(variantConfig.id)}
                                      >
                                        Delete
                                      </Button>
                                    </InlineStack>
                                  </BlockStack>
                                )}
                                
                                {!isConfigured && (
                                  <Button
                                    size="slim"
                                    onClick={() => handleConfigureVariant(variant)}
                                  >
                                    Configure Variant
                                  </Button>
                                )}
                              </BlockStack>
                            </Card>
                          );
                        })}
                      </BlockStack>
                    </div>
                  </BlockStack>
                )}
              </BlockStack>
            </FormLayout>
          )}
        </Modal.Section>
        
        {/* Custom footer with delete on left, other actions on right */}
        <Modal.Section>
          <InlineStack align="space-between">
            <div>
              {isEditMode && (
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={handleDelete}
                  loading={fetcher.state === "submitting"}
                >
                  Delete Configuration
                </Button>
              )}
            </div>
            <InlineStack gap="200">
              <Button
                onClick={() => setModalActive(false)}
                loading={fetcher.state === "submitting"}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                loading={fetcher.state === "submitting"}
              >
                {isEditMode ? "Update Configuration" : "Save Configuration"}
              </Button>
            </InlineStack>
          </InlineStack>
        </Modal.Section>
      </Modal>

      {/* Test Transformation Modal */}
      <Modal
        open={testModalActive}
        onClose={handleCloseTestModal}
        title="Test AI Transformation"
        primaryAction={{
          content: "Transform Image",
          onAction: handleTransformImage,
          loading: isTransforming,
          disabled: !uploadedFile || isTransforming,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseTestModal,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {transformError && (
              <Banner title={transformError} tone="critical" />
            )}
            
            <Text as="h3" variant="headingMd">
              {selectedTestProduct?.product_name}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {selectedTestProduct?.transformation_prompt}
            </Text>

            {!uploadedImageUrl ? (
              <DropZone
                allowMultiple={false}
                onDrop={handleImageUpload}
                accept="image/*"
              >
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" alignment="center">
                    Drop image here or click to upload
                  </Text>
                  <Text as="p" variant="bodySm" alignment="center" tone="subdued">
                    Supports all image formats up to 10MB
                  </Text>
                </BlockStack>
              </DropZone>
            ) : (
              <BlockStack gap="300">
                {/* Single image view (before transformation) */}
                {!transformedImageUrl ? (
                  <BlockStack gap="300" align="center">
                    <Text as="p" variant="headingMd" fontWeight="semibold">Before</Text>
                    <div style={{ 
                      width: '100%', 
                      maxWidth: '400px', 
                      height: '300px',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: '1px solid #e1e3e5'
                    }}>
                      <img
                        src={uploadedImageUrl}
                        alt="Before transformation"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                      />
                    </div>
                  </BlockStack>
                ) : (
                  /* Side by side view (before and after) */
                  <InlineStack gap="400" align="center">
                    <BlockStack gap="200" align="center">
                      <Text as="p" variant="headingMd" fontWeight="semibold">Before</Text>
                      <div style={{ 
                        width: '200px', 
                        height: '200px',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: '1px solid #e1e3e5'
                      }}>
                        <img
                          src={uploadedImageUrl}
                          alt="Before transformation"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                      </div>
                    </BlockStack>
                    
                    <BlockStack gap="200" align="center">
                      <Text as="p" variant="headingMd" fontWeight="semibold">After</Text>
                      <div style={{ 
                        width: '200px', 
                        height: '200px',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: '1px solid #e1e3e5'
                      }}>
                        <img
                          src={transformedImageUrl}
                          alt="After transformation"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                      </div>
                    </BlockStack>
                  </InlineStack>
                )}
                
                <Button
                  variant="plain"
                  onClick={() => {
                    setUploadedFile(null);
                    if (uploadedImageUrl) {
                      URL.revokeObjectURL(uploadedImageUrl);
                      setUploadedImageUrl(null);
                    }
                    if (transformedImageUrl) {
                      URL.revokeObjectURL(transformedImageUrl);
                      setTransformedImageUrl(null);
                    }
                  }}
                >
                  Upload Different Image
                </Button>
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Variant Configuration Modal (Phase 3) */}
      <Modal
        open={variantModalActive}
        onClose={() => setVariantModalActive(false)}
        title="Configure Variant Prompt"
        primaryAction={{
          content: "Save Variant",
          onAction: handleSaveVariant,
          loading: fetcher.state === "submitting"
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setVariantModalActive(false)
          }
        ]}
      >
        <Modal.Section>
          {selectedVariantForConfig && (
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">
                  {selectedVariantForConfig.title}
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Configure a specific transformation prompt for this variant
                </Text>
              </BlockStack>

              <TextField
                label="Variant Transformation Prompt"
                value={variantPrompt}
                onChange={setVariantPrompt}
                multiline={4}
                helpText="This prompt will be used specifically when customers select this variant"
                placeholder="e.g., Apply vibrant red eyeliner to the person's eyes..."
                autoComplete="off"
              />

              <Banner tone="info">
                <Text as="p" variant="bodyMd">
                  If this variant doesn't have a specific prompt, the product-level prompt will be used as a fallback.
                </Text>
              </Banner>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
} 