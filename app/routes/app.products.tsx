import { useState } from "react";
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
import { getConfiguredProducts, saveProductConfiguration } from "../lib/supabase.server";

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
            variants(first: 1) {
              edges {
                node {
                  id
                  price
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
  const configuredProducts = await getConfiguredProducts(session.shop);

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

  if (action === "test") {
    // TODO: Implement test transformation
    return { success: true, message: "Test transformation initiated!" };
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
        price: string;
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
  const [modalActive, setModalActive] = useState(false);
  const [transformationPrompt, setTransformationPrompt] = useState("");

  // Test modal state
  const [testModalActive, setTestModalActive] = useState(false);
  const [selectedTestProduct, setSelectedTestProduct] = useState<ConfiguredProduct | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [transformedImageUrl, setTransformedImageUrl] = useState<string | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const [transformError, setTransformError] = useState<string | null>(null);

  const isConfigured = (shopifyId: string) => {
    return configuredProducts.some((cp) => cp.shopify_id === shopifyId);
  };

  const handleConfigure = (product: ShopifyProduct) => {
    setSelectedProduct(product);
    setModalActive(true);
    
    // Set default prompt based on product type
    if (product.productType.toLowerCase().includes("hair") || 
        product.tags.some(tag => tag.toLowerCase().includes("hair"))) {
      setTransformationPrompt("Transform the person's hair color to match this product with natural blending and realistic texture.");
    } else if (product.productType.toLowerCase().includes("lipstick") ||
               product.tags.some(tag => tag.toLowerCase().includes("lipstick"))) {
      setTransformationPrompt("Apply this lipstick color to the person's lips with natural, smooth coverage.");
    } else {
      setTransformationPrompt("Apply this beauty product effect to enhance the person's appearance naturally.");
    }
  };

  const handleSave = () => {
    if (!selectedProduct) return;

    const formData = new FormData();
    formData.append("action", "configure");
    formData.append("shopifyProductId", selectedProduct.id);
    formData.append("productTitle", selectedProduct.title);
    formData.append("transformationPrompt", transformationPrompt);

    submit(formData, { method: "POST" });
    setModalActive(false);
    setSelectedProduct(null);
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

  // Configured Products Table
  const configuredProductsRows = configuredProducts.map((product) => [
    <InlineStack gap="300" key={product.id}>
      <BlockStack gap="100">
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {product.product_name}
        </Text>
      </BlockStack>
    </InlineStack>,
    <Text as="span" variant="bodySm">
      {product.transformation_prompt.length > 100 
        ? `${product.transformation_prompt.substring(0, 100)}...` 
        : product.transformation_prompt}
    </Text>,
    <InlineStack gap="200">
      <Button size="slim" onClick={() => handleTest(product)}>
        Test
      </Button>
      <Button variant="plain" size="slim">
        Edit
      </Button>
    </InlineStack>,
  ]);

  // All Shopify Products Table
  const allProductsRows = shopifyProducts.map((product: ShopifyProduct) => {
    const image = product.images.edges[0]?.node;
    const price = product.variants.edges[0]?.node?.price || "0";
    const configured = isConfigured(product.id);

    return [
      <InlineStack gap="300" key={product.id}>
        <Thumbnail
          source={image?.url || ""}
          alt={image?.altText || product.title}
          size="small"
        />
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {product.title}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            ${price} • {product.productType}
          </Text>
        </BlockStack>
      </InlineStack>,
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
                    Select products to enable for AI transformations
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
                      4. The widget automatically appears on product pages
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Best Practices</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      • Use specific, descriptive prompts
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Match the prompt to your product category
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
        title="Configure AI Transformation"
        primaryAction={{
          content: "Save Configuration",
          onAction: handleSave,
          loading: fetcher.state === "submitting",
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setModalActive(false),
          },
        ]}
      >
        <Modal.Section>
          {selectedProduct && (
            <FormLayout>
              <BlockStack gap="300">
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

                <TextField
                  label="AI Transformation Prompt"
                  value={transformationPrompt}
                  onChange={setTransformationPrompt}
                  multiline={4}
                  helpText="Describe how the AI should transform the customer's photo when using this product"
                  placeholder="e.g., Transform the person's hair color to a vibrant red shade with natural highlights..."
                  autoComplete="off"
                />
              </BlockStack>
            </FormLayout>
          )}
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
                    Supports JPG, PNG, and WebP files up to 10MB
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
    </Page>
  );
} 