import { useState, useEffect, useCallback } from "react";
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
  Select,
  Spinner,
  RadioButton,
  Divider,
  Pagination,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { 
  getConfiguredProductsWithCategory,
  getCategories,
  saveProductConfiguration,
  updateProductConfiguration,
  deleteProductConfiguration,
  saveVariantConfiguration,
  saveFunnelConfiguration,
  uploadReferenceImage,
  saveProductReferenceImage,
  deleteReferenceImage,
} from "../lib/supabase.server";
import { generatePromptFromFunnel, validateFunnelResponses } from "../lib/prompt-generator.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Fetch all products from Shopify using cursor-based pagination
  const allProducts: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  try {
    while (hasNextPage) {
      const response: Response = await admin.graphql(`
        query GetProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
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
                      featuredImage {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `, {
        variables: {
          first: 250,
          after: cursor
        }
      });

      const json: any = await response.json();

      if (json.errors) {
        console.error('Shopify GraphQL errors:', JSON.stringify(json.errors));
        break;
      }

      if (!json.data?.products?.edges) {
        console.error('Unexpected Shopify GraphQL response:', JSON.stringify(json));
        break;
      }

      const products = json.data.products.edges.map(({ node }: { node: any }) => node);
      allProducts.push(...products);

      hasNextPage = json.data.products.pageInfo.hasNextPage;
      cursor = json.data.products.pageInfo.endCursor;
    }
  } catch (error) {
    console.error('Error fetching Shopify products:', error);
  }

  const shopifyProducts = allProducts;

  // Fetch configured products from Supabase (with category data joined)
  const configuredProducts = session.shop
    ? await getConfiguredProductsWithCategory(session.shop)
    : [];

  // Fetch all categories for the funnel UI dropdown
  const categories = await getCategories();

  return { shopifyProducts, configuredProducts, categories, shop: session.shop };
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

  if (action === "save-variant") {
    try {
      const productId = formData.get("productId") as string; // Internal UUID
      const shopifyVariantId = formData.get("shopifyVariantId") as string;
      const variantTitle = formData.get("variantTitle") as string;
      const transformationPrompt = formData.get("transformationPrompt") as string;
      const displayColor = (formData.get("displayColor") as string) || null;

      // Save variant configuration
      await saveVariantConfiguration(productId, shopifyVariantId, variantTitle, transformationPrompt, displayColor);

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

  if (action === "upload-reference-image") {
    try {
      const productId = formData.get("productId") as string;
      const imageFile = formData.get("image") as File;

      if (!productId || !imageFile) {
        return { success: false, message: "Missing product ID or image file." };
      }

      if (imageFile.size > 10 * 1024 * 1024) {
        return { success: false, message: "File too large. Max 10MB." };
      }

      const arrayBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const publicUrl = await uploadReferenceImage(
        session.shop,
        productId,
        buffer,
        imageFile.name,
        imageFile.type
      );

      await saveProductReferenceImage(productId, publicUrl);

      return { success: true, message: "Reference image uploaded!", referenceImageUrl: publicUrl };
    } catch (error) {
      console.error("Error uploading reference image:", error);
      return { success: false, message: "Failed to upload reference image. Please try again." };
    }
  }

  if (action === "remove-reference-image") {
    try {
      const productId = formData.get("productId") as string;
      const currentUrl = formData.get("currentUrl") as string;

      if (currentUrl) {
        await deleteReferenceImage(currentUrl);
      }
      await saveProductReferenceImage(productId, null);

      return { success: true, message: "Reference image removed.", referenceImageUrl: null };
    } catch (error) {
      console.error("Error removing reference image:", error);
      return { success: false, message: "Failed to remove reference image." };
    }
  }

  // NEW: Funnel-based configuration (prompt hidden from user!)
  if (action === "configure-funnel") {
    try {
      const shopifyProductId = formData.get("shopifyProductId") as string;
      const productTitle = formData.get("productTitle") as string;
      const categoryId = formData.get("categoryId") as string;
      const funnelResponsesJson = formData.get("funnelResponses") as string;
      const isNewProduct = formData.get("isNewProduct") === "true";
      const configuredProductId = formData.get("configuredProductId") as string | null;
      const shadeConfigsJson = formData.get("shadeConfigs") as string | null;

      // Parse JSON with validation
      let funnelResponses;
      try {
        funnelResponses = JSON.parse(funnelResponsesJson);
      } catch {
        return { success: false, message: "Invalid funnel responses format" };
      }

      // Validate all required params are answered
      const validation = await validateFunnelResponses(categoryId, funnelResponses);
      if (!validation.isValid) {
        return { 
          success: false, 
          message: `Please answer all questions: ${validation.missingParameters.join(", ")}` 
        };
      }

      // Generate prompt SERVER-SIDE (user never sees this!)
      const generatedPrompt = await generatePromptFromFunnel(categoryId, funnelResponses);
      console.log('🔧 Generated prompt length:', generatedPrompt.length, '(hidden from user)');

      let productId: string;

      if (isNewProduct) {
        // Create product first, then save funnel config
        const newProduct = await saveProductConfiguration(
          session.shop, 
          shopifyProductId, 
          productTitle, 
          generatedPrompt
        );
        await saveFunnelConfiguration(
          newProduct.id, 
          categoryId, 
          funnelResponses, 
          generatedPrompt
        );
        productId = newProduct.id;
      } else if (configuredProductId) {
        // Update existing product with funnel config
        await saveFunnelConfiguration(
          configuredProductId, 
          categoryId, 
          funnelResponses, 
          generatedPrompt
        );
        productId = configuredProductId;
      } else {
        return { success: false, message: "Missing product ID" };
      }

      // Save shade configurations (variant-specific prompts)
      if (shadeConfigsJson && productId) {
        let shadeConfigs: Record<string, { title: string; responses: Record<string, any>; displayColor?: string }>;
        try {
          shadeConfigs = JSON.parse(shadeConfigsJson);
        } catch {
          return { success: false, message: "Invalid shade configuration format" };
        }
        
        // Get category data to resolve level labels
        const { getCategoryWithFullData } = await import("../lib/supabase.server");
        const categoryData = await getCategoryWithFullData(categoryId);
        
        for (const [variantId, config] of Object.entries(shadeConfigs)) {
          // Build shade prompt snippet from responses
          let shadeSnippet = "\n\n--- SHADE/VARIANT SPECIFIC ---\n";
          
          for (const [paramName, value] of Object.entries(config.responses)) {
            // Find the parameter
            const param = categoryData?.parameters?.find((p: any) => p.name === paramName);
            if (!param) continue;
            
            if (param.input_type === 'text' || param.input_type === 'textarea') {
              // Text input - use value directly
              if (value && String(value).trim()) {
                shadeSnippet += `${param.display_name}: ${value}\n`;
              }
            } else {
              // Radio input - find the level label and prompt text
              const level = param.levels?.find((l: any) => l.level === value);
              if (level) {
                shadeSnippet += `${param.display_name}: ${level.label}\n`;
                if (level.prompt_text) {
                  shadeSnippet += `${level.prompt_text}\n`;
                }
              }
            }
          }
          
          // Combine base prompt + shade snippet
          const variantPrompt = generatedPrompt + shadeSnippet;
          
          // Save variant configuration
          await saveVariantConfiguration(
            productId,
            variantId,
            config.title,
            variantPrompt,
            config.displayColor ?? null
          );
          
          console.log(`✅ Saved shade config for variant: ${config.title}`);
        }
      }

      return { success: true, message: "Product configured successfully!" };
    } catch (error) {
      console.error("Error saving funnel configuration:", error);
      return { success: false, message: "Failed to save configuration. Please try again." };
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
        featuredImage?: {
          url: string;
        } | null;
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
  reference_image_url: string | null;
  // Funnel system fields
  category_id: string | null;
  funnel_responses: Record<string, number> | null;
  is_funnel_generated: boolean;
  categories: { id: string; name: string; slug: string } | null;
}

// Category from loader
interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  base_prompt: string;
  sort_order: number;
}

// Full category data with parameters and levels (from API)
interface CategoryWithParams {
  id: string;
  name: string;
  base_prompt: string;
  parameters: Array<{
    id: string;
    name: string;
    display_name: string;
    question_text: string | null;
    is_locked: boolean;
    is_variant_specific?: boolean;
    input_type?: 'radio' | 'text' | 'textarea';
    max_levels: number;
    levels: Array<{
      level: number;
      label: string;
      prompt_text: string;
    }>;
  }>;
}

// Classification suggestion from API
interface ClassificationSuggestion {
  categoryId: string;
  categoryName: string;
  confidence: 'high' | 'medium' | 'low';
}

export default function Products() {
  const { shopifyProducts, configuredProducts, categories } = useLoaderData<typeof loader>();
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
  // Note: showVariants state reserved for future UI expansion
  const [, setShowVariants] = useState(false);
  const [configuredVariants, setConfiguredVariants] = useState<any[]>([]);
  const [selectedVariantForConfig, setSelectedVariantForConfig] = useState<any | null>(null);
  const [variantPrompt, setVariantPrompt] = useState("");
  const [variantDisplayColor, setVariantDisplayColor] = useState("");
  const [variantModalActive, setVariantModalActive] = useState(false);

  // Pagination state
  const ITEMS_PER_PAGE = 25;
  const [configuredPage, setConfiguredPage] = useState(1);
  const [allProductsPage, setAllProductsPage] = useState(1);
  
  // Video banner dismiss state (persists in localStorage)
  const [showVideoBanner, setShowVideoBanner] = useState(true);
  
  // Check localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const dismissed = localStorage.getItem('glimpse-video-banner-dismissed') === 'true';
    if (dismissed) {
      setShowVideoBanner(false);
    }
  }, []);
  
  const dismissVideoBanner = () => {
    setShowVideoBanner(false);
    localStorage.setItem('glimpse-video-banner-dismissed', 'true');
  };

  // Funnel configuration state
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [funnelResponses, setFunnelResponses] = useState<Record<string, number | string>>({});
  const [categoryData, setCategoryData] = useState<CategoryWithParams | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isLoadingCategory, setIsLoadingCategory] = useState(false);
  const [classificationSuggestion, setClassificationSuggestion] = useState<ClassificationSuggestion | null>(null);
  const [classificationAttempted, setClassificationAttempted] = useState(false);
  
  // Reference image state
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);

  // Variant color profiles state - maps variantId -> { shade_name, hue_family, undertone, etc. }
  const [variantColorProfiles, setVariantColorProfiles] = useState<Record<string, Record<string, string | number>>>({});
  const [variantDisplayColors, setVariantDisplayColors] = useState<Record<string, string>>({});
  const [expandedShadeVariants, setExpandedShadeVariants] = useState<Set<string>>(new Set());

  // Mode detection: funnel mode for new products OR editing funnel products
  // Legacy mode: editing a product that was configured with the old manual prompt system
  const isLegacyMode = isEditMode && selectedConfiguredProduct && !selectedConfiguredProduct.is_funnel_generated;

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

  // Helper to load category data with parameters and levels
  const loadCategoryData = useCallback(async (categoryId: string) => {
    setIsLoadingCategory(true);
    try {
      const response = await fetch(`/api/get-category-data?categoryId=${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        setCategoryData(data.category);
      }
    } catch (error) {
      console.error('Error loading category data:', error);
    } finally {
      setIsLoadingCategory(false);
    }
  }, []);

  // Auto-classify when configuring a NEW product
  useEffect(() => {
    async function classifyNewProduct() {
      if (modalActive && selectedProduct && !isEditMode) {
        console.log('🏷️ Starting classification for:', selectedProduct.title);
        setIsClassifying(true);
        setClassificationSuggestion(null);
        setClassificationAttempted(false);
        
        try {
          const formData = new FormData();
          formData.append("productName", selectedProduct.title);
          formData.append("productType", selectedProduct.productType || "");
          
          const response = await fetch("/api/classify-product", {
            method: "POST",
            body: formData,
          });
          
          const result = await response.json();
          console.log('🏷️ Classification result:', result);
          
          if (result.success && result.suggestion) {
            setClassificationSuggestion(result.suggestion);
            setSelectedCategory(result.suggestion.categoryId);
            // Immediately load category data for the suggested category
            loadCategoryData(result.suggestion.categoryId);
          } else {
            console.log('🏷️ No suggestion returned:', result.error || 'Low confidence or failed');
          }
        } catch (error) {
          console.error("Classification error:", error);
        } finally {
          setIsClassifying(false);
          setClassificationAttempted(true);
        }
      }
    }
    
    classifyNewProduct();
  }, [modalActive, selectedProduct, isEditMode, loadCategoryData]);

  // Load funnel responses when editing a funnel product
  useEffect(() => {
    if (modalActive && isEditMode && selectedConfiguredProduct?.is_funnel_generated) {
      setSelectedCategory(selectedConfiguredProduct.category_id);
      setFunnelResponses(selectedConfiguredProduct.funnel_responses || {});
      if (selectedConfiguredProduct.category_id) {
        loadCategoryData(selectedConfiguredProduct.category_id);
      }
    }
  }, [modalActive, isEditMode, selectedConfiguredProduct, loadCategoryData]);

  const isConfigured = (shopifyId: string) => {
    return configuredProducts.some((cp) => cp.shopify_id === shopifyId);
  };

  const handleConfigure = (product: ShopifyProduct) => {
    setSelectedProduct(product);
    setSelectedConfiguredProduct(null);
    setIsEditMode(false);
    setTransformationPrompt("");
    // Reset funnel state for new product
    setSelectedCategory(null);
    setFunnelResponses({});
    setCategoryData(null);
    setClassificationSuggestion(null);
    setClassificationAttempted(false);
    // Reset variant color profiles
    setVariantColorProfiles({});
    setVariantDisplayColors({});
    setExpandedShadeVariants(new Set());
    setReferenceImageUrl(null);
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
    
    // Reset funnel state - will be loaded by useEffect if it's a funnel product
    setSelectedCategory(null);
    setFunnelResponses({});
    setCategoryData(null);
    setClassificationSuggestion(null);
    // Reset variant color profiles
    setVariantColorProfiles({});
    setVariantDisplayColors({});
    setExpandedShadeVariants(new Set());
    // Load existing reference image
    setReferenceImageUrl(configuredProduct.reference_image_url || null);
    
    setModalActive(true);
  };

  const handleCloseModal = () => {
    setModalActive(false);
    setSelectedProduct(null);
    setSelectedConfiguredProduct(null);
    setIsEditMode(false);
    setTransformationPrompt("");
    // Reset funnel state
    setSelectedCategory(null);
    setFunnelResponses({});
    setCategoryData(null);
    setClassificationSuggestion(null);
    setClassificationAttempted(false);
    // Reset variant color profiles
    setVariantColorProfiles({});
    setVariantDisplayColors({});
    setExpandedShadeVariants(new Set());
    setReferenceImageUrl(null);
  };
  
  // Reference image upload/remove via Remix fetcher (uses authenticated session)
  const refFetcher = useFetcher<typeof action>();
  const isUploadingRef = refFetcher.state !== "idle";

  // Update local state when refFetcher completes
  useEffect(() => {
    if (refFetcher.data && refFetcher.state === "idle") {
      const data = refFetcher.data as any;
      if (data.referenceImageUrl !== undefined) {
        setReferenceImageUrl(data.referenceImageUrl ?? null);
      }
    }
  }, [refFetcher.data, refFetcher.state]);

  const handleReferenceImageUpload = (file: File) => {
    const productId = selectedConfiguredProduct?.id;
    if (!productId) return;

    const formData = new FormData();
    formData.append("action", "upload-reference-image");
    formData.append("productId", productId);
    formData.append("image", file);
    refFetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
  };

  const handleRemoveReferenceImage = () => {
    const productId = selectedConfiguredProduct?.id;
    if (!productId) return;

    const formData = new FormData();
    formData.append("action", "remove-reference-image");
    formData.append("productId", productId);
    if (referenceImageUrl) {
      formData.append("currentUrl", referenceImageUrl);
    }
    refFetcher.submit(formData, { method: "POST" });
  };

  // Check if category has variant-specific parameters
  const hasVariantParams = categoryData?.parameters?.some(p => p.is_variant_specific && !p.is_locked) || false;
  const variantParams = categoryData?.parameters?.filter(p => p.is_variant_specific && !p.is_locked) || [];

  const handleSave = () => {
    if (!selectedProduct && !selectedConfiguredProduct) return;

    const formData = new FormData();
    
    // LEGACY MODE: Use existing update behavior
    if (isLegacyMode && selectedConfiguredProduct) {
      formData.append("action", "update");
      formData.append("configuredProductId", selectedConfiguredProduct.id);
      formData.append("transformationPrompt", transformationPrompt);
    }
    // FUNNEL MODE: Use new configure-funnel action
    else if (selectedCategory && Object.keys(funnelResponses).length > 0) {
      formData.append("action", "configure-funnel");
      formData.append("categoryId", selectedCategory);
      formData.append("funnelResponses", JSON.stringify(funnelResponses));
      
      // Include shade configurations if any exist
      if ((Object.keys(variantColorProfiles).length > 0 || Object.keys(variantDisplayColors).length > 0) && selectedProduct) {
        // Build variant configs with titles
        const variantConfigs: Record<string, { title: string; responses: Record<string, string | number>; displayColor?: string }> = {};
        selectedProduct.variants.edges.forEach(({ node: variant }) => {
          const hasProfile = variantColorProfiles[variant.id] && Object.keys(variantColorProfiles[variant.id]).length > 0;
          const hasColor = variantDisplayColors[variant.id]?.trim();
          if (hasProfile || hasColor) {
            variantConfigs[variant.id] = {
              title: variant.title,
              responses: variantColorProfiles[variant.id] || {},
              ...(hasColor ? { displayColor: variantDisplayColors[variant.id].trim() } : {}),
            };
          }
        });
        if (Object.keys(variantConfigs).length > 0) {
          formData.append("shadeConfigs", JSON.stringify(variantConfigs));
        }
      }
      
      if (isEditMode && selectedConfiguredProduct) {
        // Editing existing funnel product
        formData.append("configuredProductId", selectedConfiguredProduct.id);
        formData.append("isNewProduct", "false");
      } else if (selectedProduct) {
        // New product
        formData.append("shopifyProductId", selectedProduct.id);
        formData.append("productTitle", selectedProduct.title);
        formData.append("isNewProduct", "true");
      }
    } else {
      // No valid configuration
      return;
    }

    submit(formData, { method: "POST" });
    handleCloseModal();
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
    setVariantDisplayColor(existingConfig?.display_color || "");
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
    if (variantDisplayColor.trim()) formData.append("displayColor", variantDisplayColor.trim());

    submit(formData, { method: "POST" });
    setVariantModalActive(false);
    setSelectedVariantForConfig(null);
    setVariantPrompt("");
    setVariantDisplayColor("");
    
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

  // Helper to format funnel responses as a readable summary (NO PROMPT VISIBLE!)
  // Shows parameter labels instead of the generated prompt text
  const formatFunnelSummary = (
    product: ConfiguredProduct
  ): string => {
    if (!product.funnel_responses || !product.categories) return "";
    
    // We don't have full category data here, so just show the number of settings
    const responseCount = Object.keys(product.funnel_responses).length;
    return `${responseCount} setting${responseCount !== 1 ? 's' : ''} configured`;
  };

  // Configured Products Table - sorted alphabetically with product images
  const sortedConfiguredProducts = [...configuredProducts].sort((a, b) => 
    a.product_name.localeCompare(b.product_name)
  );
  
  const configuredProductsRows = sortedConfiguredProducts.map((product) => {
    // Find the corresponding Shopify product to get the image
    const shopifyProduct = shopifyProducts.find((sp: ShopifyProduct) => sp.id === product.shopify_id);
    const imageUrl = shopifyProduct?.images?.edges?.[0]?.node?.url || "";
    
    // Configuration display: funnel products show category badge, legacy shows truncated prompt
    const configurationDisplay = product.is_funnel_generated && product.categories ? (
      // FUNNEL PRODUCT: Show category badge + summary (NO PROMPT!)
      <div key={`${product.id}-config`} style={{ paddingLeft: '4px'}}>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Badge tone="info">{product.categories.name}</Badge>
          <Text as="span" variant="bodySm" tone="subdued">
            {formatFunnelSummary(product)}
          </Text>
        </InlineStack>
      </div>
    ) : (
      // LEGACY PRODUCT: Show "Legacy" badge + truncated prompt (they wrote it)
      <div key={`${product.id}-config`} style={{ paddingLeft: '4px'}}>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Badge>Legacy</Badge>
          <Text as="span" variant="bodySm">
            {product.transformation_prompt.length > 60
              ? `${product.transformation_prompt.substring(0, 60)}...` 
              : product.transformation_prompt}
          </Text>
        </InlineStack>
      </div>
    );

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
            {product.product_name.length > 50 
              ? `${product.product_name.substring(0, 50)}...` 
              : product.product_name}
          </Text>
        </InlineStack>
      </div>,
      configurationDisplay,
      <InlineStack key={`${product.id}-actions`} gap="200" wrap={false}>
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
              {product.title.length > 50 
                ? `${product.title.substring(0, 50)}...` 
                : product.title}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              ${price} • {product.productType}
            </Text>
          </BlockStack>
        </InlineStack>
      </div>,
      <Button
        key={`${product.id}-action`}
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
                    New to product configuration?
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Watch our quick guide on setting up AI transformations for your products
                  </Text>
                </BlockStack>
                <div style={{ marginLeft: "auto" }}>
                  <Button url="https://www.loom.com/share/17ba1224959f48669415782f132535b3" target="_blank">
                    Watch Video
                  </Button>
                </div>
              </InlineStack>
            </div>
          </Card>
        )}

        {/* Actions */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Actions
            </Text>
            <InlineStack gap="300">
              <Button
                onClick={async () => {
                  const selected = await (window as any).shopify.resourcePicker({
                    type: "product",
                    multiple: false,
                    filter: {
                      hidden: false,
                    },
                  });
                  if (selected && selected.length > 0) {
                    const pickedProduct = selected[0];
                    const match = shopifyProducts.find(
                      (p: ShopifyProduct) => p.id === pickedProduct.id
                    );
                    if (match && !isConfigured(match.id)) {
                      handleConfigure(match);
                    }
                  }
                }}
              >
                Add product
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

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
                  <BlockStack gap="300">
                    <DataTable
                      columnContentTypes={["text", "text", "text"]}
                      headings={["Product", "Configuration", "Actions"]}
                      rows={configuredProductsRows.slice(
                        (configuredPage - 1) * ITEMS_PER_PAGE,
                        configuredPage * ITEMS_PER_PAGE
                      )}
                    />
                    {configuredProductsRows.length > ITEMS_PER_PAGE && (
                      <InlineStack align="end">
                        <Pagination
                          hasPrevious={configuredPage > 1}
                          hasNext={configuredPage * ITEMS_PER_PAGE < configuredProductsRows.length}
                          onPrevious={() => setConfiguredPage(configuredPage - 1)}
                          onNext={() => setConfiguredPage(configuredPage + 1)}
                          label={`${configuredPage} of ${Math.ceil(configuredProductsRows.length / ITEMS_PER_PAGE)}`}
                        />
                      </InlineStack>
                    )}
                  </BlockStack>
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

                <BlockStack gap="300">
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Product", "Action"]}
                    rows={allProductsRows.slice(
                      (allProductsPage - 1) * ITEMS_PER_PAGE,
                      allProductsPage * ITEMS_PER_PAGE
                    )}
                  />
                  {allProductsRows.length > ITEMS_PER_PAGE && (
                    <InlineStack align="end">
                      <Pagination
                        hasPrevious={allProductsPage > 1}
                        hasNext={allProductsPage * ITEMS_PER_PAGE < allProductsRows.length}
                        onPrevious={() => setAllProductsPage(allProductsPage - 1)}
                        onNext={() => setAllProductsPage(allProductsPage + 1)}
                        label={`${allProductsPage} of ${Math.ceil(allProductsRows.length / ITEMS_PER_PAGE)}`}
                      />
                    </InlineStack>
                  )}
                </BlockStack>
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
                      1. Click "Configure" on a product
                    </Text>
                    <Text as="p" variant="bodyMd">
                      2. Select the product category
                    </Text>
                    <Text as="p" variant="bodyMd">
                      3. Answer a few questions about the effect
                    </Text>
                    <Text as="p" variant="bodyMd">
                      4. Test the transformation with sample images
                    </Text>
                  </BlockStack>
                  <Button url="https://www.youtube.com/watch?v=example" external variant="plain">
                    Watch demo video
                  </Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Tips</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      • Our AI auto-suggests the best category
                    </Text>
                    <Text as="p" variant="bodyMd">
                      • Adjust intensity levels for each effect
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
        onClose={handleCloseModal}
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

                {/* ============================================ */}
                {/* LEGACY MODE: Show TextField (existing behavior) */}
                {/* ============================================ */}
                {isLegacyMode && (
                  <BlockStack gap="400">
                    {/* Product-Level Transformation Prompt */}
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingMd">Product-Level Transformation Prompt (Default)</Text>
                      <TextField
                        label=""
                        labelHidden
                        value={transformationPrompt}
                        onChange={setTransformationPrompt}
                        multiline={4}
                        placeholder="e.g., Darken and thicken the person's eyelashes..."
                        autoComplete="off"
                      />
                      <Text as="p" variant="bodySm" tone="subdued">
                        This prompt is used when no variant-specific prompt is configured
                      </Text>
                    </BlockStack>
                    
                    {/* Variant-Specific Prompts - only show if product has REAL variants (not just "Default Title") */}
                    {selectedProduct && (
                      selectedProduct.variants.edges.length > 1 || 
                      (selectedProduct.variants.edges.length === 1 && selectedProduct.variants.edges[0].node.title !== "Default Title")
                    ) && (
                      <div style={{ borderTop: '1px solid #e1e3e5', marginTop: '8px', paddingTop: '16px' }}>
                        <BlockStack gap="300">
                          <BlockStack gap="100">
                            <Text as="h4" variant="headingMd">Variant-Specific Prompts (Optional)</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Configure different prompts for each variant. Falls back to product-level prompt if not configured.
                            </Text>
                          </BlockStack>
                          
                          <BlockStack gap="300">
                            {selectedProduct.variants.edges.map(({ node: variant }) => {
                              const existingConfig = configuredVariants.find(v => v.shopify_variant_id === variant.id);
                              return (
                                <Card key={variant.id}>
                                  <BlockStack gap="200">
                                    <InlineStack align="space-between" blockAlign="start">
                                      <InlineStack gap="300" blockAlign="center">
                                        {variant.featuredImage?.url && (
                                          <Thumbnail
                                            source={variant.featuredImage.url}
                                            alt={variant.title}
                                            size="small"
                                          />
                                        )}
                                        <BlockStack gap="100">
                                          <Text as="h5" variant="headingSm">{variant.title}</Text>
                                          {variant.price && parseFloat(variant.price) > 0 && (
                                            <Text as="p" variant="bodySm" tone="subdued">
                                              ${variant.price} • {variant.availableForSale !== false ? 'Available' : 'Unavailable'}
                                            </Text>
                                          )}
                                        </BlockStack>
                                      </InlineStack>
                                      {existingConfig && (
                                        <Badge tone="success">Configured</Badge>
                                      )}
                                    </InlineStack>
                                    
                                    {existingConfig && (
                                      <Text as="p" variant="bodySm">
                                        <Text as="span" fontWeight="semibold">Prompt: </Text>
                                        {existingConfig.transformation_prompt.length > 80 
                                          ? existingConfig.transformation_prompt.substring(0, 80) + '...'
                                          : existingConfig.transformation_prompt}
                                      </Text>
                                    )}
                                    
                                    <InlineStack gap="200">
                                      <Button 
                                        size="slim" 
                                        onClick={() => handleConfigureVariant(variant)}
                                      >
                                        {existingConfig ? "Edit" : "Configure"}
                                      </Button>
                                      {existingConfig && (
                                        <Button 
                                          size="slim" 
                                          tone="critical"
                                          variant="plain"
                                          onClick={() => handleDeleteVariant(existingConfig.id)}
                                        >
                                          Delete
                                        </Button>
                                      )}
                                    </InlineStack>
                                  </BlockStack>
                                </Card>
                              );
                            })}
                          </BlockStack>
                        </BlockStack>
                      </div>
                    )}
                  </BlockStack>
                )}

                {/* ============================================ */}
                {/* FUNNEL MODE: Category + Questions UI */}
                {/* For new products OR editing funnel products */}
                {/* ============================================ */}
                {!isLegacyMode && (
                  <BlockStack gap="400">
                    {/* Step 1: Category Selection */}
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingMd">Product Category</Text>
                      
                      {isClassifying && (
                        <InlineStack gap="200" blockAlign="center">
                          <Spinner size="small" />
                          <Text as="span" variant="bodySm">Analyzing product...</Text>
                        </InlineStack>
                      )}
                      
                      {classificationSuggestion && !isClassifying && (
                        <Banner tone="success">
                          <Text as="p" variant="bodySm">
                            Suggested: <strong>{classificationSuggestion.categoryName}</strong> ({classificationSuggestion.confidence} confidence)
                          </Text>
                        </Banner>
                      )}
                      
                      {!isClassifying && classificationAttempted && !classificationSuggestion && !isEditMode && (
                        <Banner tone="info">
                          <Text as="p" variant="bodySm">
                            Could not auto-detect category. Please select one below.
                          </Text>
                        </Banner>
                      )}
                      
                      <Select
                        label="Category"
                        labelHidden
                        options={[
                          { label: "Select a category...", value: "" },
                          ...(categories as Category[]).map((c: Category) => ({ label: c.name, value: c.id })),
                          { label: "OTHER - Contact Sales", value: "contact-sales" }
                        ]}
                        value={selectedCategory || ""}
                        onChange={(value) => {
                          if (value === "contact-sales") {
                            window.open('https://www.gleame.ai/contact', '_blank');
                            return;
                          }
                          setSelectedCategory(value || null);
                          setFunnelResponses({});
                          setCategoryData(null);
                          if (value) {
                            loadCategoryData(value);
                          }
                        }}
                      />
                    </BlockStack>

                    {/* Step 2: Funnel Questions */}
                    {selectedCategory && (
                      <BlockStack gap="400">
                        <Text as="h4" variant="headingMd">Configure Transformation</Text>
                        
                        {isLoadingCategory ? (
                          <InlineStack gap="200" blockAlign="center">
                            <Spinner size="small" />
                            <Text as="span" variant="bodySm">Loading questions...</Text>
                          </InlineStack>
                        ) : categoryData ? (
                          <BlockStack gap="400">
                            {/* Product-level parameters (non-variant-specific) */}
                            {categoryData.parameters
                              .filter(param => !param.is_locked && !param.is_variant_specific)
                              .map(param => (
                                <BlockStack key={param.id} gap="200">
                                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                                    {param.question_text || param.display_name}
                                  </Text>
                                  {param.input_type === 'text' ? (
                                    <TextField
                                      label=""
                                      labelHidden
                                      value={String(funnelResponses[param.id] || '')}
                                      onChange={(value) => setFunnelResponses(prev => ({
                                        ...prev,
                                        [param.id]: value
                                      }))}
                                      placeholder={`Enter ${param.display_name.toLowerCase()}...`}
                                      autoComplete="off"
                                    />
                                  ) : (
                                    <InlineStack gap="400" wrap>
                                      {param.levels.map(level => (
                                        <div key={level.level} style={{ minWidth: '120px' }}>
                                          <RadioButton
                                            label={level.label}
                                            checked={funnelResponses[param.id] === level.level}
                                            id={`${param.id}-${level.level}`}
                                            name={param.id}
                                            onChange={() => setFunnelResponses(prev => ({
                                              ...prev,
                                              [param.id]: level.level
                                            }))}
                                          />
                                        </div>
                                      ))}
                                    </InlineStack>
                                  )}
                                </BlockStack>
                              ))}
                            
                            {/* Variant-specific parameters (Shade Configuration) */}
                            {/* Only show if product has REAL variants (not just "Default Title") */}
                            {hasVariantParams && selectedProduct && (
                              selectedProduct.variants.edges.length > 1 || 
                              (selectedProduct.variants.edges.length === 1 && selectedProduct.variants.edges[0].node.title !== "Default Title")
                            ) && (
                              <div style={{ borderTop: '1px solid #e1e3e5', marginTop: '16px', paddingTop: '16px' }}>
                                <BlockStack gap="300">
                                  <BlockStack gap="100">
                                    <Text as="h4" variant="headingMd">Shade/Variant Configuration (Optional)</Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      Configure color details for each shade/variant. Falls back to product-level settings if not configured.
                                    </Text>
                                  </BlockStack>
                                  
                                  <BlockStack gap="300">
                                    {selectedProduct.variants.edges.map(({ node: variant }) => {
                                      const existingShadeConfig = configuredVariants.find(v => v.shopify_variant_id === variant.id);
                                      const currentInput = variantColorProfiles[variant.id];
                                      const hasCurrentInput = (currentInput && Object.keys(currentInput).length > 0) || !!variantDisplayColors[variant.id]?.trim();
                                      const isExpanded = expandedShadeVariants.has(variant.id);
                                      
                                      return (
                                        <Card key={variant.id}>
                                          <BlockStack gap="200">
                                            {/* Variant Header */}
                                            <InlineStack align="space-between" blockAlign="start">
                                              <InlineStack gap="300" blockAlign="center">
                                                {variant.featuredImage?.url && (
                                                  <Thumbnail
                                                    source={variant.featuredImage.url}
                                                    alt={variant.title}
                                                    size="small"
                                                  />
                                                )}
                                                <Text as="h5" variant="headingSm">{variant.title}</Text>
                                              </InlineStack>
                                              {(existingShadeConfig || hasCurrentInput) && (
                                                <Badge tone="success">{existingShadeConfig ? "Configured" : "Modified"}</Badge>
                                              )}
                                            </InlineStack>
                                            
                                            
                                            {/* Expanded Edit Form */}
                                            {isExpanded && (
                                              <BlockStack gap="300">
                                                <Divider />
                                                {variantParams.map(param => (
                                                  <BlockStack key={param.id} gap="200">
                                                    <Text as="p" variant="bodySm" fontWeight="semibold">
                                                      {param.question_text || param.display_name}
                                                    </Text>
                                                    {param.input_type === 'text' ? (
                                                      <TextField
                                                        label=""
                                                        labelHidden
                                                        value={String(variantColorProfiles[variant.id]?.[param.name] || '')}
                                                        onChange={(value) => setVariantColorProfiles(prev => ({
                                                          ...prev,
                                                          [variant.id]: {
                                                            ...prev[variant.id],
                                                            [param.name]: value
                                                          }
                                                        }))}
                                                        placeholder={`Enter ${param.display_name.toLowerCase()}...`}
                                                        autoComplete="off"
                                                      />
                                                    ) : (
                                                      <InlineStack gap="300" wrap>
                                                        {param.levels.map(level => (
                                                          <div key={level.level} style={{ minWidth: '100px' }}>
                                                            <RadioButton
                                                              label={level.label}
                                                              checked={variantColorProfiles[variant.id]?.[param.name] === level.level}
                                                              id={`${variant.id}-${param.id}-${level.level}`}
                                                              name={`${variant.id}-${param.name}`}
                                                              onChange={() => setVariantColorProfiles(prev => ({
                                                                ...prev,
                                                                [variant.id]: {
                                                                  ...prev[variant.id],
                                                                  [param.name]: level.level
                                                                }
                                                              }))}
                                                            />
                                                          </div>
                                                        ))}
                                                      </InlineStack>
                                                    )}
                                                  </BlockStack>
                                                ))}

                                                {/* Swatch Color */}
                                                <BlockStack gap="200">
                                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                                    Swatch Color (Optional)
                                                  </Text>
                                                  <Text as="p" variant="bodySm" tone="subdued">
                                                    Displayed as a color dot in the widget's variant selector.
                                                  </Text>
                                                  <InlineStack gap="200" blockAlign="center">
                                                    <input
                                                      type="color"
                                                      value={variantDisplayColors[variant.id] || (existingShadeConfig?.display_color ?? '#c4506a')}
                                                      onChange={(e) => setVariantDisplayColors(prev => ({ ...prev, [variant.id]: e.target.value }))}
                                                      style={{
                                                        width: '36px',
                                                        height: '36px',
                                                        padding: '2px',
                                                        border: '1px solid #c9cccf',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        opacity: (variantDisplayColors[variant.id] || existingShadeConfig?.display_color) ? 1 : 0.4,
                                                      }}
                                                    />
                                                    <div style={{ flex: 1 }}>
                                                      <TextField
                                                        label=""
                                                        labelHidden
                                                        value={variantDisplayColors[variant.id] ?? (existingShadeConfig?.display_color || '')}
                                                        onChange={(v) => setVariantDisplayColors(prev => ({ ...prev, [variant.id]: v }))}
                                                        placeholder="#c4506a"
                                                        autoComplete="off"
                                                      />
                                                    </div>
                                                    {(variantDisplayColors[variant.id] || existingShadeConfig?.display_color) && (
                                                      <Button
                                                        size="slim"
                                                        variant="plain"
                                                        onClick={() => setVariantDisplayColors(prev => ({ ...prev, [variant.id]: '' }))}
                                                      >
                                                        Clear
                                                      </Button>
                                                    )}
                                                  </InlineStack>
                                                </BlockStack>
                                              </BlockStack>
                                            )}
                                            
                                            {/* Action Buttons */}
                                            <InlineStack gap="200">
                                              <Button 
                                                size="slim" 
                                                onClick={() => {
                                                  setExpandedShadeVariants(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(variant.id)) {
                                                      next.delete(variant.id);
                                                    } else {
                                                      next.add(variant.id);
                                                    }
                                                    return next;
                                                  });
                                                }}
                                              >
                                                {isExpanded ? "Done" : (existingShadeConfig || hasCurrentInput) ? "Edit" : "Configure"}
                                              </Button>
                                              {(existingShadeConfig || hasCurrentInput) && (
                                                <Button 
                                                  size="slim" 
                                                  tone="critical"
                                                  variant="plain"
                                                  onClick={() => {
                                                    // Clear local state
                                                    setVariantColorProfiles(prev => {
                                                      const next = { ...prev };
                                                      delete next[variant.id];
                                                      return next;
                                                    });
                                                    setVariantDisplayColors(prev => {
                                                      const next = { ...prev };
                                                      delete next[variant.id];
                                                      return next;
                                                    });
                                                    // Delete from DB if exists
                                                    if (existingShadeConfig) {
                                                      handleDeleteVariant(existingShadeConfig.id);
                                                    }
                                                  }}
                                                >
                                                  Delete
                                                </Button>
                                              )}
                                            </InlineStack>
                                          </BlockStack>
                                        </Card>
                                      );
                                    })}
                                  </BlockStack>
                                </BlockStack>
                              </div>
                            )}
                          </BlockStack>
                        ) : null}
                      </BlockStack>
                    )}
                  </BlockStack>
                )}

                              </BlockStack>
            </FormLayout>
          )}
        </Modal.Section>

        {/* Reference Image Section - only for existing products */}
        {isEditMode && selectedConfiguredProduct && (
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="h4" variant="headingMd">Reference Image (Optional)</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Attach a product photo that Gemini will use as a reference during transformations. 
                Useful for wig try-ons, specific product placement, etc.
              </Text>
              
              {referenceImageUrl ? (
                <InlineStack gap="400" blockAlign="center">
                  <div style={{ border: '1px solid #e1e3e5', borderRadius: '8px', overflow: 'hidden' }}>
                    <img 
                      src={referenceImageUrl} 
                      alt="Reference" 
                      style={{ width: '120px', height: '120px', objectFit: 'cover', display: 'block' }} 
                    />
                  </div>
                  <BlockStack gap="200">
                    <Badge tone="success">Reference image attached</Badge>
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={handleRemoveReferenceImage}
                      loading={isUploadingRef}
                    >
                      Remove
                    </Button>
                  </BlockStack>
                </InlineStack>
              ) : (
                <DropZone
                  accept="image/*"
                  type="image"
                  allowMultiple={false}
                  onDrop={(_dropFiles, acceptedFiles) => {
                    if (acceptedFiles.length > 0) {
                      handleReferenceImageUpload(acceptedFiles[0]);
                    }
                  }}
                >
                  {isUploadingRef ? (
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                      <Spinner size="small" />
                      <Text as="p" variant="bodySm">Uploading...</Text>
                    </div>
                  ) : (
                    <DropZone.FileUpload actionHint="Accepts .jpg, .png, .webp" />
                  )}
                </DropZone>
              )}
            </BlockStack>
          </Modal.Section>
        )}
        
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
                onClick={handleCloseModal}
                loading={fetcher.state === "submitting"}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                loading={fetcher.state === "submitting"}
                disabled={!isLegacyMode && (!selectedCategory || Object.keys(funnelResponses).length === 0)}
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
            
            {/* HIDE PROMPT for funnel products - show category badge instead */}
            {selectedTestProduct?.is_funnel_generated ? (
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">{selectedTestProduct.categories?.name || "Configured"}</Badge>
                <Text as="span" variant="bodySm" tone="subdued">
                  AI transformation ready
                </Text>
              </InlineStack>
            ) : (
              /* Legacy products: show prompt (they wrote it themselves) */
              <Text as="p" variant="bodyMd" tone="subdued">
                {selectedTestProduct?.transformation_prompt}
              </Text>
            )}

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
              <InlineStack gap="300" blockAlign="center">
                {selectedVariantForConfig.featuredImage?.url && (
                  <Thumbnail
                    source={selectedVariantForConfig.featuredImage.url}
                    alt={selectedVariantForConfig.title}
                    size="medium"
                  />
                )}
                <BlockStack gap="100">
                  <Text as="h3" variant="headingMd">
                    {selectedVariantForConfig.title}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Configure a specific transformation prompt for this variant
                  </Text>
                </BlockStack>
              </InlineStack>

              <TextField
                label="Variant Transformation Prompt"
                value={variantPrompt}
                onChange={setVariantPrompt}
                multiline={4}
                helpText="This prompt will be used specifically when customers select this variant"
                placeholder="e.g., Apply vibrant red eyeliner to the person's eyes..."
                autoComplete="off"
              />

              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="medium">Swatch Color (Optional)</Text>
                <InlineStack gap="300" blockAlign="center">
                  <input
                    type="color"
                    value={variantDisplayColor || "#c4506a"}
                    onChange={(e) => setVariantDisplayColor(e.target.value)}
                    style={{ width: '40px', height: '40px', padding: '2px', border: '1px solid #c9cccf', borderRadius: '8px', cursor: 'pointer', opacity: variantDisplayColor ? 1 : 0.4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <TextField
                      label=""
                      labelHidden
                      value={variantDisplayColor}
                      onChange={(v) => setVariantDisplayColor(v)}
                      placeholder="#c4506a"
                      autoComplete="off"
                      helpText="Hex color shown as a swatch in the widget shade picker"
                    />
                  </div>
                  {variantDisplayColor && (
                    <Button variant="plain" tone="critical" onClick={() => setVariantDisplayColor("")}>
                      Clear
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>

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