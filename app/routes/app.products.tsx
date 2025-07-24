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
  DataTable,
  Badge,
  TextField,
  Select,
  Modal,
  FormLayout,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

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
  const products = data.products.edges.map(({ node }) => node);

  // TODO: Fetch configured products from Supabase
  const configuredProducts = [];

  return { products, configuredProducts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "configure") {
    const productId = formData.get("productId");
    const transformationPrompt = formData.get("transformationPrompt");
    const category = formData.get("category");

    // TODO: Save to Supabase
    console.log("Configuring product:", {
      productId,
      transformationPrompt,
      category
    });

    return { success: true, message: "Product configured successfully!" };
  }

  return { success: false, message: "Unknown action" };
};

interface Product {
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

export default function Products() {
  const { products, configuredProducts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [modalActive, setModalActive] = useState(false);
  const [transformationPrompt, setTransformationPrompt] = useState("");
  const [category, setCategory] = useState("hair-color");

  const categoryOptions = [
    { label: "Hair Color", value: "hair-color" },
    { label: "Makeup - Lipstick", value: "makeup-lipstick" },
    { label: "Makeup - Eyeshadow", value: "makeup-eyeshadow" },
    { label: "Makeup - Foundation", value: "makeup-foundation" },
    { label: "Skincare - Glow", value: "skincare-glow" },
    { label: "Skincare - Anti-aging", value: "skincare-antiaging" },
  ];

  const isConfigured = (productId: string) => {
    return configuredProducts.some((cp: any) => cp.productId === productId);
  };

  const handleConfigure = (product: Product) => {
    setSelectedProduct(product);
    setModalActive(true);
    
    // Set default prompt based on product type or tags
    if (product.productType.toLowerCase().includes("hair") || 
        product.tags.some(tag => tag.toLowerCase().includes("hair"))) {
      setCategory("hair-color");
      setTransformationPrompt("Transform the person's hair color to match this product. Ensure natural blending and realistic hair texture.");
    } else if (product.productType.toLowerCase().includes("lipstick") ||
               product.tags.some(tag => tag.toLowerCase().includes("lipstick"))) {
      setCategory("makeup-lipstick");
      setTransformationPrompt("Apply this lipstick color to the person's lips with natural, smooth coverage.");
    } else {
      setTransformationPrompt("Apply this beauty product effect to enhance the person's appearance naturally.");
    }
  };

  const handleSave = () => {
    if (!selectedProduct) return;

    const formData = new FormData();
    formData.append("action", "configure");
    formData.append("productId", selectedProduct.id);
    formData.append("transformationPrompt", transformationPrompt);
    formData.append("category", category);

    fetcher.submit(formData, { method: "POST" });
    setModalActive(false);
    setSelectedProduct(null);
  };

  const tableRows = products.map((product: Product) => {
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
      <Badge tone={configured ? "success" : "attention"}>
        {configured ? "Configured" : "Not Configured"}
      </Badge>,
      <Button
        variant={configured ? "plain" : "primary"}
        onClick={() => handleConfigure(product)}
        size="slim"
      >
        {configured ? "Edit" : "Configure"}
      </Button>,
    ];
  });

  return (
    <Page>
      <TitleBar title="Product Configuration" />
      
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Configure Products for AI Transformations
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Connect your beauty products to AI transformation prompts. 
                    Each product will show a "Try it on" widget on your storefront.
                  </Text>
                </BlockStack>

                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Product", "Status", "Action"]}
                  rows={tableRows}
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
                      2. Customize the transformation prompt for each product
                    </Text>
                    <Text as="p" variant="bodyMd">
                      3. The widget automatically appears on product pages
                    </Text>
                    <Text as="p" variant="bodyMd">
                      4. Customers upload photos and see instant results
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

                <Select
                  label="Transformation Category"
                  options={categoryOptions}
                  value={category}
                  onChange={setCategory}
                  helpText="Choose the type of beauty transformation this product provides"
                />

                <TextField
                  label="AI Transformation Prompt"
                  value={transformationPrompt}
                  onChange={setTransformationPrompt}
                  multiline={4}
                  helpText="Describe how the AI should transform the customer's photo when using this product"
                  placeholder="e.g., Transform the person's hair color to a vibrant red shade with natural highlights..."
                />
              </BlockStack>
            </FormLayout>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
} 