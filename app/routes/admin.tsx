import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, type ShouldRevalidateFunction } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  TextField,
  Select,
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
import { MAX_REFERENCE_IMAGES, parseReferenceImageUrls } from "../lib/reference-images";
import {
  supabase,
  updateShopMonthlySessions,
  uploadReferenceImage,
  appendProductReferenceImage,
  removeProductReferenceImageByUrl,
  appendVariantReferenceImage,
  removeVariantReferenceImageByUrl,
  updateProductAiModel,
} from "../lib/supabase.server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ============================================
// GLEAME FOUNDERS ADMIN PAGE
// ============================================
// Only accessible from specific Shopify stores
// Add your store domains to ALLOWED_SHOPS

const ALLOWED_SHOPS = [
  "testingaaronandevansaas.myshopify.com", // Add your store domains here
  "hx5hqt-na.myshopify.com",
];

// Fetch monthly sessions directly from Shopify API.
// Formula matches the cron job (api.cron.check-sessions.ts): 90-day sum / 3.
// Any change here MUST be mirrored in the cron — the cron's value is what's
// sent to Mantle flex billing on renewal, and the two must stay in sync.
async function fetchMonthlySessionsForShop(shop: string, accessToken: string): Promise<number | null> {
  try {
    const query = `
      query GetQuarterlySessions {
        shopifyqlQuery(query: "FROM sessions SHOW sessions SINCE -90d") {
          tableData {
            columns { name dataType }
            rows
          }
          parseErrors { message }
        }
      }
    `;

    const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[sessions] ${shop}: HTTP ${response.status} ${body.substring(0, 300)}`);
      return null;
    }

    const result = await response.json();
    if (result.errors?.length > 0) {
      console.error(`[sessions] ${shop}: GraphQL errors`, JSON.stringify(result.errors));
      return null;
    }

    const shopifyqlData = result.data?.shopifyqlQuery;
    if (shopifyqlData?.parseErrors?.length > 0) {
      console.error(`[sessions] ${shop}: ShopifyQL parseErrors`, JSON.stringify(shopifyqlData.parseErrors));
      return null;
    }

    const tableData = shopifyqlData?.tableData;
    if (!tableData?.rows?.length) return 0;

    const sessionsColumnIndex = tableData.columns.findIndex(
      (col: { name: string }) => col.name.toLowerCase() === 'sessions'
    );
    if (sessionsColumnIndex === -1) {
      console.error(`[sessions] ${shop}: no 'sessions' column in response`, JSON.stringify(tableData.columns));
      return null;
    }

    let totalSessions = 0;
    for (const row of tableData.rows) {
      const parsed = parseInt(row[sessionsColumnIndex], 10);
      if (!isNaN(parsed)) totalSessions += parsed;
    }

    return Math.round(totalSessions / 3); // Average monthly (90 days / 3)
  } catch (err) {
    console.error(`[sessions] ${shop}: fetch threw`, err);
    return null;
  }
}

// Bump only sessions_updated_at without touching monthly_sessions. Used when a
// fetch fails so the 7-day staleness check doesn't retry the same broken shop
// on every admin load.
async function markSessionFetchAttempted(shopDomain: string): Promise<void> {
  const { error } = await supabase
    .from('shops')
    .update({ sessions_updated_at: new Date().toISOString() })
    .eq('shop_domain', shopDomain);
  if (error) {
    console.error(`[sessions] ${shopDomain}: failed to mark attempt`, error);
  }
}

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

interface VariantConfig {
  id: string;
  shopify_variant_id: string;
  variant_title: string;
  transformation_prompt: string;
  reference_image_url?: string | null;
  reference_image_urls?: unknown;
  /** Normalized in loader */
  reference_urls: string[];
}

interface Product {
  id: string;
  shopify_id: string;
  product_name: string;
  product_image_url: string | null;
  transformation_prompt: string;
  reference_image_url: string | null;
  reference_image_urls?: unknown;
  /** Normalized in loader */
  reference_urls: string[];
  ai_model: string | null;
  is_funnel_generated: boolean;
  category_id: string | null;
  funnel_responses: Record<string, number | string> | null;
  created_at: string;
  categories?: { name: string; slug: string } | null;
  transformation_count: number;
  variant_configs?: VariantConfig[];
}

interface ConversionStats {
  totalOrders: number;
  ordersWithWidgetUsage: number;
  conversionRate: number;
  totalRevenue: number;
  widgetAttributedRevenue: number;
}

interface Shop {
  id: string;
  shop_domain: string;
  shopify_id: string;
  shop_name: string | null;
  products: Product[];
  conversionStats?: ConversionStats | null;
  monthlySessions?: number | null;
  sessions_updated_at?: string | null;
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
        const productsWithVariants = (products || []).map((product: { id: string; reference_image_url?: string | null; reference_image_urls?: unknown }) => ({
          ...product,
          reference_urls: parseReferenceImageUrls({
            reference_image_url: product.reference_image_url,
            reference_image_urls: product.reference_image_urls,
          }),
          variant_configs: (variantConfigs || [])
            .filter((vc: { product_id: string }) => vc.product_id === product.id)
            .map((vc: { id: string; product_id: string; reference_image_url?: string | null; reference_image_urls?: unknown }) => ({
              ...vc,
              reference_urls: parseReferenceImageUrls({
                reference_image_url: vc.reference_image_url,
                reference_image_urls: vc.reference_image_urls,
              }),
            })),
        }));

        // Fetch conversion stats for this shop (last 30 days)
        let conversionStats = null;
        try {
          const { data: statsData, error: statsError } = await supabase
            .rpc('get_conversion_stats', {
              p_shop_id: shop.id,
              p_days_back: 30
            });
          
          if (!statsError && statsData) {
            const stats = Array.isArray(statsData) ? statsData[0] : statsData;
            if (stats) {
              conversionStats = {
                totalOrders: Number(stats.total_orders || 0),
                ordersWithWidgetUsage: Number(stats.orders_with_widget_usage || 0),
                conversionRate: Number(stats.conversion_rate || 0),
                totalRevenue: Number(stats.total_revenue || 0),
                widgetAttributedRevenue: Number(stats.widget_attributed_revenue || 0)
              };
            }
          }
        } catch (e) {
          // Conversion stats table may not exist yet (migration not run)
          console.log('Conversion stats not available for', shop.shop_domain);
        }

        return { 
          ...shop, 
          products: productsWithVariants, 
          conversionStats,
          monthlySessions: shop.monthly_sessions ?? null,
          sessions_updated_at: shop.sessions_updated_at ?? null,
        };
      })
    );

    // Fetch fresh sessions ONLY for shops with stale data (not updated in last 7 days)
    // This prevents overwhelming Shopify API when there are many shops
    const STALE_THRESHOLD_DAYS = 7;
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    
    // Find shops that need session updates
    const staleShops = shopsWithProducts.filter(shop => {
      if (!shop.sessions_updated_at) return true; // Never updated
      return new Date(shop.sessions_updated_at) < staleThreshold;
    });

    if (staleShops.length > 0) {
      try {
        // Match the cron's token-selection logic: one per shop, newest first.
        // Without distinct + orderBy, Prisma may return a stale/revoked token
        // from a prior install and every admin load silently 401s.
        const prismaShops = await prisma.session.findMany({
          where: { isOnline: false, accessToken: { not: '' } },
          select: { shop: true, accessToken: true },
          distinct: ['shop'],
          orderBy: { id: 'desc' },
        });

        const shopTokenMap = new Map<string, string>();
        for (const ps of prismaShops) {
          if (ps.accessToken) shopTokenMap.set(ps.shop, ps.accessToken);
        }

        // Limit to 20 per page load so we don't fan out 50+ parallel Shopify
        // calls on admin open; cron handles the long tail weekly.
        const shopsToUpdate = staleShops
          .filter(s => shopTokenMap.has(s.shop_domain))
          .slice(0, 20);

        console.log(`📊 Admin: refreshing sessions for ${shopsToUpdate.length}/${staleShops.length} stale shops`);

        const sessionUpdates = shopsToUpdate.map(async (shop) => {
          const token = shopTokenMap.get(shop.shop_domain)!;
          const sessions = await fetchMonthlySessionsForShop(shop.shop_domain, token);
          if (sessions !== null) {
            await updateShopMonthlySessions(shop.shop_domain, sessions);
            shop.monthlySessions = sessions;
            shop.sessions_updated_at = new Date().toISOString();
          } else {
            // Failed fetch: bump updated_at so we don't hammer this shop on
            // every load. The N/A badge + stale badge will make this visible.
            await markSessionFetchAttempted(shop.shop_domain);
            shop.sessions_updated_at = new Date().toISOString();
          }
          return { shopDomain: shop.shop_domain, sessions };
        });

        const results = await Promise.all(sessionUpdates);
        const successCount = results.filter(r => r.sessions !== null).length;
        console.log(`📊 Admin: updated sessions for ${successCount}/${results.length} shops`);
      } catch (sessionError) {
        console.error('[sessions] batch refresh failed:', sessionError);
      }
    }

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

// Disable automatic loader revalidation after fetcher actions.
// The loader calls authenticate.admin(request), but this page uses Polaris's
// AppProvider (not @shopify/shopify-app-remix/react), so fetcher requests don't
// carry a Shopify session token. Revalidation after a save can hit the 204
// session-token bounce and render a blank/static page over the UI.
// The action handlers skip authenticate.admin for the same reason; we handle
// UI updates optimistically via local state (prompt overrides, ref image maps,
// AI model overrides). Full page reload re-seeds the loader via the iframe.
export const shouldRevalidate: ShouldRevalidateFunction = ({ formMethod }) => {
  // Only revalidate on GET navigations (e.g. initial load, route changes).
  return !formMethod || formMethod.toUpperCase() === "GET";
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

// Relative time string for "checked X ago" labels. Used in the shop header
// session badge so it's obvious when a count is stale without digging into DB.
function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

// Validate UUID format
function isValidUUID(id: string | null): boolean {
  if (!id) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

const VALID_AI_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gpt-image-1.5',
] as const;

export const action = async ({ request }: ActionFunctionArgs) => {
  // Skip authenticate.admin for the action — it triggers Shopify's session
  // token bounce (204 → /auth/session-token → page reload) which destroys
  // the page when called from a useFetcher POST.
  // Instead, read the shop from the most recent Prisma session. The loader
  // already verified Shopify auth, and this page is allowlist-gated.
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  let shopDomain: string | null = null;

  if (shopParam) {
    // Verify this shop has a valid session in Prisma
    const sessionRecord = await prisma.session.findFirst({
      where: { shop: shopParam },
      orderBy: { id: "desc" },
    });
    if (sessionRecord) shopDomain = sessionRecord.shop;
  }

  if (!shopDomain || !ALLOWED_SHOPS.includes(shopDomain)) {
    return json({ success: false, error: "Forbidden" }, { status: 403 });
  }

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

  if (actionType === "upload-reference-image") {
    const productId = formData.get("productId") as string;
    const imageFile = formData.get("image") as File;
    const shopDomain = formData.get("shopDomain") as string;

    if (!productId || !imageFile || !shopDomain) {
      return json({ success: false, error: "Missing required fields" });
    }
    if (!isValidUUID(productId)) {
      return json({ success: false, error: "Invalid product ID" });
    }

    try {
      const arrayBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const publicUrl = await uploadReferenceImage(
        shopDomain,
        productId,
        buffer,
        imageFile.name,
        imageFile.type
      );

      await appendProductReferenceImage(productId, publicUrl);
      const { data: row } = await supabase
        .from("products")
        .select("reference_image_url, reference_image_urls")
        .eq("id", productId)
        .single();
      return json({
        success: true,
        referenceImageUrls: parseReferenceImageUrls(row ?? undefined),
      });
    } catch (error) {
      console.error("Error uploading reference image:", error);
      const message = error instanceof Error ? error.message : "Upload failed";
      return json({ success: false, error: message });
    }
  }

  if (actionType === "remove-reference-image") {
    const productId = formData.get("productId") as string;
    const currentUrl = formData.get("currentUrl") as string;

    if (!isValidUUID(productId)) {
      return json({ success: false, error: "Invalid product ID" });
    }

    try {
      await removeProductReferenceImageByUrl(productId, currentUrl);
      const { data: row } = await supabase
        .from("products")
        .select("reference_image_url, reference_image_urls")
        .eq("id", productId)
        .single();
      return json({
        success: true,
        referenceImageUrls: parseReferenceImageUrls(row ?? undefined),
      });
    } catch (error) {
      console.error("Error removing reference image:", error);
      return json({ success: false, error: "Remove failed" });
    }
  }

  if (actionType === "upload-variant-reference-image") {
    const productId = formData.get("productId") as string;
    const variantId = formData.get("variantId") as string;
    const imageFile = formData.get("image") as File;
    const shopDomain = formData.get("shopDomain") as string;

    if (!productId || !variantId || !imageFile || !shopDomain) {
      return json({ success: false, error: "Missing required fields" });
    }
    if (!isValidUUID(productId) || !isValidUUID(variantId)) {
      return json({ success: false, error: "Invalid product or variant ID" });
    }

    try {
      const arrayBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const storageKey = `${productId}-v-${variantId}`;

      const publicUrl = await uploadReferenceImage(
        shopDomain,
        storageKey,
        buffer,
        imageFile.name,
        imageFile.type
      );

      await appendVariantReferenceImage(variantId, publicUrl);
      const { data: row } = await supabase
        .from("product_variants")
        .select("reference_image_url, reference_image_urls")
        .eq("id", variantId)
        .single();
      return json({
        success: true,
        referenceImageUrls: parseReferenceImageUrls(row ?? undefined),
        targetVariantId: variantId,
      });
    } catch (error) {
      console.error("Error uploading variant reference image:", error);
      const message = error instanceof Error ? error.message : "Upload failed";
      return json({ success: false, error: message });
    }
  }

  if (actionType === "remove-variant-reference-image") {
    const variantId = formData.get("variantId") as string;
    const currentUrl = formData.get("currentUrl") as string;

    if (!isValidUUID(variantId)) {
      return json({ success: false, error: "Invalid variant ID" });
    }

    try {
      await removeVariantReferenceImageByUrl(variantId, currentUrl);
      const { data: row } = await supabase
        .from("product_variants")
        .select("reference_image_url, reference_image_urls")
        .eq("id", variantId)
        .single();
      return json({
        success: true,
        referenceImageUrls: parseReferenceImageUrls(row ?? undefined),
        targetVariantId: variantId,
      });
    } catch (error) {
      console.error("Error removing variant reference image:", error);
      return json({ success: false, error: "Remove failed" });
    }
  }

  if (actionType === "update-ai-model") {
    const productId = formData.get("productId") as string;
    const aiModel = formData.get("aiModel") as string;

    if (!isValidUUID(productId)) {
      return json({ success: false, error: "Invalid product ID" });
    }

    if (aiModel !== "auto" && !VALID_AI_MODELS.includes(aiModel as typeof VALID_AI_MODELS[number])) {
      return json({ success: false, error: `Invalid model: ${aiModel}` });
    }

    const modelValue = aiModel === "auto" ? null : aiModel;
    await updateProductAiModel(productId, modelValue);
    console.log(`✅ AI model updated for ${productId}: ${modelValue ?? "auto"}`);
    return json({ success: true });
  }

  if (actionType === "refresh-sessions") {
    // Per-shop manual refresh. Writes monthly_sessions/sessions_updated_at in
    // Supabase exactly like the cron; does NOT call Mantle — flex billing
    // remains driven exclusively by the cron's renewal-window logic.
    const targetShopDomain = formData.get("targetShopDomain") as string;
    if (!targetShopDomain || typeof targetShopDomain !== "string") {
      return json({ success: false, error: "Missing targetShopDomain" });
    }

    const targetSession = await prisma.session.findFirst({
      where: { shop: targetShopDomain, isOnline: false, accessToken: { not: "" } },
      orderBy: { id: "desc" },
    });
    if (!targetSession?.accessToken) {
      return json({ success: false, error: "No access token for target shop" });
    }

    const sessions = await fetchMonthlySessionsForShop(targetShopDomain, targetSession.accessToken);
    const updatedAt = new Date().toISOString();
    if (sessions !== null) {
      await updateShopMonthlySessions(targetShopDomain, sessions);
      return json({ success: true, monthlySessions: sessions, sessionsUpdatedAt: updatedAt });
    } else {
      await markSessionFetchAttempted(targetShopDomain);
      return json({ success: false, error: "Shopify fetch failed (see server logs)", sessionsUpdatedAt: updatedAt });
    }
  }

  return json({ success: false, error: "Unknown action" });
};

export default function FoundersAdmin() {
  const { shops, stats, error } = useLoaderData<typeof loader>();

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
  const promptFetcher = useFetcher<any>();
  const variantPromptFetcher = useFetcher<any>();
  const modelFetcher = useFetcher<any>();
  const refFetcher = useFetcher<any>();
  const sessionsFetcher = useFetcher<any>();
  const [refImageUrls, setRefImageUrls] = useState<Record<string, string[]>>({});
  const [variantRefImageUrls, setVariantRefImageUrls] = useState<Record<string, string[]>>({});
  const [aiModelOverrides, setAiModelOverrides] = useState<Record<string, string>>({});
  // Optimistic overrides: loader revalidation is disabled, so we mirror saved
  // prompts here and render them below if present.
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});
  const [variantPromptOverrides, setVariantPromptOverrides] = useState<Record<string, string>>({});
  // Per-shop session count overrides from manual refresh. `count` is null when
  // the refresh failed (still updates timestamp so we can show "checked Xm ago").
  const [sessionOverrides, setSessionOverrides] = useState<
    Record<string, { count: number | null; updatedAt: string }>
  >({});
  const [refreshingShop, setRefreshingShop] = useState<string | null>(null);

  // Apply session refresh results to local state when the fetcher settles.
  useEffect(() => {
    if (sessionsFetcher.state !== "idle" || !refreshingShop) return;
    const data = sessionsFetcher.data;
    if (data) {
      setSessionOverrides((prev) => ({
        ...prev,
        [refreshingShop]: {
          count: typeof data.monthlySessions === "number" ? data.monthlySessions : null,
          updatedAt: data.sessionsUpdatedAt ?? new Date().toISOString(),
        },
      }));
    }
    setRefreshingShop(null);
  }, [sessionsFetcher.data, sessionsFetcher.state, refreshingShop]);

  const [refFetcherTarget, setRefFetcherTarget] = useState<
    { type: "product" | "variant"; id: string } | null
  >(null);
  const isUploadingRefKey =
    refFetcher.state !== "idle" && refFetcherTarget
      ? `${refFetcherTarget.type}:${refFetcherTarget.id}`
      : null;

  // Clear target whenever the fetcher settles so loading never sticks on errors / empty responses.
  useEffect(() => {
    if (refFetcher.state !== "idle" || !refFetcherTarget) return;
    if (refFetcher.data?.referenceImageUrls !== undefined) {
      const urls = refFetcher.data.referenceImageUrls as string[];
      if (refFetcherTarget.type === "variant") {
        setVariantRefImageUrls((prev) => ({ ...prev, [refFetcherTarget.id]: urls }));
      } else {
        setRefImageUrls((prev) => ({ ...prev, [refFetcherTarget.id]: urls }));
      }
    }
    setRefFetcherTarget(null);
  }, [refFetcher.data, refFetcher.state, refFetcherTarget]);

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
    setEditPromptValue(promptOverrides[product.id] ?? product.transformation_prompt);
    setEditingVariant(null); // Cancel any variant editing
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditPromptValue("");
  };

  const startEditVariantPrompt = (variant: VariantConfig) => {
    setEditingVariant(variant.id);
    setEditVariantPromptValue(variantPromptOverrides[variant.id] ?? variant.transformation_prompt);
    setEditingProduct(null); // Cancel any product editing
  };

  const cancelVariantEdit = () => {
    setEditingVariant(null);
    setEditVariantPromptValue("");
  };

  const saveVariantPrompt = (variantId: string) => {
    const submittedPrompt = editVariantPromptValue;
    const formData = new FormData();
    formData.append("action", "update-variant-prompt");
    formData.append("variantId", variantId);
    formData.append("prompt", submittedPrompt);
    variantPromptFetcher.submit(formData, { method: "POST" });
    setVariantPromptOverrides((prev) => ({ ...prev, [variantId]: submittedPrompt }));
    setEditingVariant(null);
    setEditVariantPromptValue("");
  };

  const savePrompt = (productId: string) => {
    const submittedPrompt = editPromptValue;
    const formData = new FormData();
    formData.append("action", "update-prompt");
    formData.append("productId", productId);
    formData.append("prompt", submittedPrompt);
    promptFetcher.submit(formData, { method: "POST" });
    setPromptOverrides((prev) => ({ ...prev, [productId]: submittedPrompt }));
    setEditingProduct(null);
    setEditPromptValue("");
  };

  const getProductPrompt = (product: Product) =>
    promptOverrides[product.id] ?? product.transformation_prompt;

  const getVariantPrompt = (vc: VariantConfig) =>
    variantPromptOverrides[vc.id] ?? vc.transformation_prompt;

  const getSessionInfo = (shop: Shop) => {
    const override = sessionOverrides[shop.shop_domain];
    if (override) return { count: override.count, updatedAt: override.updatedAt };
    return {
      count: shop.monthlySessions ?? null,
      updatedAt: shop.sessions_updated_at ?? null,
    };
  };

  const refreshShopSessions = (shopDomain: string) => {
    setRefreshingShop(shopDomain);
    const formData = new FormData();
    formData.append("action", "refresh-sessions");
    formData.append("targetShopDomain", shopDomain);
    sessionsFetcher.submit(formData, { method: "POST" });
  };

  const getAiModel = (product: Product) => {
    if (aiModelOverrides[product.id] !== undefined) return aiModelOverrides[product.id];
    return product.ai_model ?? "auto";
  };

  const saveAiModel = (productId: string, model: string) => {
    setAiModelOverrides(prev => ({ ...prev, [productId]: model }));
    const formData = new FormData();
    formData.append("action", "update-ai-model");
    formData.append("productId", productId);
    formData.append("aiModel", model);
    modelFetcher.submit(formData, { method: "POST" });
  };

  const getRefImageUrls = (product: Product) => {
    if (refImageUrls[product.id] !== undefined) return refImageUrls[product.id];
    return product.reference_urls ?? [];
  };

  const getVariantRefUrls = (vc: VariantConfig) => {
    if (variantRefImageUrls[vc.id] !== undefined) return variantRefImageUrls[vc.id];
    return vc.reference_urls ?? [];
  };

  const handleRefImageUpload = (productId: string, shopDomain: string, file: File) => {
    setRefFetcherTarget({ type: "product", id: productId });
    const formData = new FormData();
    formData.append("action", "upload-reference-image");
    formData.append("productId", productId);
    formData.append("shopDomain", shopDomain);
    formData.append("image", file);
    refFetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
  };

  const handleRefImageRemove = (productId: string, currentUrl: string) => {
    setRefFetcherTarget({ type: "product", id: productId });
    const formData = new FormData();
    formData.append("action", "remove-reference-image");
    formData.append("productId", productId);
    formData.append("currentUrl", currentUrl);
    refFetcher.submit(formData, { method: "POST" });
  };

  const handleVariantRefImageUpload = (
    productId: string,
    variantId: string,
    shopDomain: string,
    file: File
  ) => {
    setRefFetcherTarget({ type: "variant", id: variantId });
    const formData = new FormData();
    formData.append("action", "upload-variant-reference-image");
    formData.append("productId", productId);
    formData.append("variantId", variantId);
    formData.append("shopDomain", shopDomain);
    formData.append("image", file);
    refFetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
  };

  const handleVariantRefImageRemove = (variantId: string, currentUrl: string) => {
    setRefFetcherTarget({ type: "variant", id: variantId });
    const formData = new FormData();
    formData.append("action", "remove-variant-reference-image");
    formData.append("variantId", variantId);
    formData.append("currentUrl", currentUrl);
    refFetcher.submit(formData, { method: "POST" });
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
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingMd">{shop.shop_domain}</Text>
                      {(() => {
                        const info = getSessionInfo(shop);
                        return info.count !== null && info.count !== undefined ? (
                          <Badge tone="info">{`${info.count.toLocaleString()} sessions/mo`}</Badge>
                        ) : (
                          <Badge tone="attention">Sessions: N/A</Badge>
                        );
                      })()}
                      {(() => {
                        const info = getSessionInfo(shop);
                        if (!info.updatedAt) return null;
                        return (
                          <Text as="span" variant="bodySm" tone="subdued">
                            checked {formatRelativeTime(info.updatedAt)}
                          </Text>
                        );
                      })()}
                      <Button
                        size="micro"
                        onClick={() => refreshShopSessions(shop.shop_domain)}
                        loading={refreshingShop === shop.shop_domain}
                      >
                        Refresh
                      </Button>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {shop.products.length} product{shop.products.length !== 1 ? "s" : ""} configured
                    </Text>
                  </BlockStack>
                  <Button onClick={() => toggleShop(shop.id)}>
                    {expandedShop === shop.id ? "Collapse" : "View Products"}
                  </Button>
                </InlineStack>

                {/* Conversion Stats - Always visible */}
                {shop.conversionStats && shop.conversionStats.totalOrders > 0 && (
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <InlineStack gap="600" wrap={false}>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Orders (30d)</Text>
                        <Text as="p" variant="headingSm">{shop.conversionStats.totalOrders}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Widget-Influenced</Text>
                        <Text as="p" variant="headingSm">{shop.conversionStats.ordersWithWidgetUsage}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Conversion Rate</Text>
                        <Text as="p" variant="headingSm" tone="success">{shop.conversionStats.conversionRate}%</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Attributed Revenue</Text>
                        <Text as="p" variant="headingSm" tone="success">
                          ${shop.conversionStats.widgetAttributedRevenue.toLocaleString()}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </Box>
                )}

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
                                  {(getRefImageUrls(product).length > 0 ||
                                    product.variant_configs?.some((vc) => getVariantRefUrls(vc).length > 0)) && (
                                    <Badge tone="warning">Ref image(s)</Badge>
                                  )}
                                  {product.ai_model && (
                                    <Badge tone="attention">{product.ai_model}</Badge>
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
                                        {getProductPrompt(product)}
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
                                                ID: {vc.shopify_variant_id}
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
                                              {getVariantPrompt(vc)}
                                            </pre>
                                          )}

                                          <Divider />
                                          <Text as="p" variant="bodySm" fontWeight="semibold">
                                            Variant reference images (override product refs when any are set):
                                          </Text>
                                          <Text as="p" variant="bodySm" tone="subdued">
                                            Up to {MAX_REFERENCE_IMAGES} images. Shown to the AI instead of product-level refs for this variant.
                                          </Text>
                                          <InlineStack gap="200" wrap>
                                            {getVariantRefUrls(vc).map((url) => (
                                              <InlineStack key={url} gap="200" blockAlign="center">
                                                <div
                                                  style={{
                                                    border: "1px solid #e1e3e5",
                                                    borderRadius: "8px",
                                                    overflow: "hidden",
                                                  }}
                                                >
                                                  <img
                                                    src={url}
                                                    alt="Variant ref"
                                                    style={{
                                                      width: "64px",
                                                      height: "64px",
                                                      objectFit: "cover",
                                                      display: "block",
                                                    }}
                                                  />
                                                </div>
                                                <Button
                                                  size="slim"
                                                  variant="plain"
                                                  tone="critical"
                                                  onClick={() => handleVariantRefImageRemove(vc.id, url)}
                                                  loading={isUploadingRefKey === `variant:${vc.id}`}
                                                >
                                                  Remove
                                                </Button>
                                              </InlineStack>
                                            ))}
                                          </InlineStack>
                                          {getVariantRefUrls(vc).length < MAX_REFERENCE_IMAGES ? (
                                            <InlineStack gap="200" blockAlign="center">
                                              {isUploadingRefKey === `variant:${vc.id}` ? (
                                                <Spinner size="small" />
                                              ) : (
                                                <>
                                                  <input
                                                    id={`variant-ref-upload-${vc.id}`}
                                                    type="file"
                                                    accept="image/*"
                                                    style={{ display: "none" }}
                                                    onChange={(e) => {
                                                      const file = e.target.files?.[0];
                                                      if (file)
                                                        handleVariantRefImageUpload(
                                                          product.id,
                                                          vc.id,
                                                          shop.shop_domain,
                                                          file
                                                        );
                                                      e.target.value = "";
                                                    }}
                                                  />
                                                  <Button
                                                    size="slim"
                                                    onClick={() =>
                                                      document
                                                        .getElementById(`variant-ref-upload-${vc.id}`)
                                                        ?.click()
                                                    }
                                                  >
                                                    Add variant reference
                                                  </Button>
                                                </>
                                              )}
                                            </InlineStack>
                                          ) : null}
                                        </BlockStack>
                                      </Box>
                                    ))}
                                  </BlockStack>
                                )}

                                {/* Reference images (product-level; variants can override) */}
                                <BlockStack gap="200">
                                  <Divider />
                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                    Product reference images:
                                  </Text>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Up to {MAX_REFERENCE_IMAGES} images sent to the AI with the shopper selfie. If a variant has its own refs, those replace these for that variant.
                                  </Text>
                                  <InlineStack gap="300" wrap blockAlign="center">
                                    {getRefImageUrls(product).map((refUrl) => (
                                      <InlineStack key={refUrl} gap="200" blockAlign="center">
                                        <div
                                          style={{
                                            border: "1px solid #e1e3e5",
                                            borderRadius: "8px",
                                            overflow: "hidden",
                                          }}
                                        >
                                          <img
                                            src={refUrl}
                                            alt="Reference"
                                            style={{
                                              width: "80px",
                                              height: "80px",
                                              objectFit: "cover",
                                              display: "block",
                                            }}
                                          />
                                        </div>
                                        <Button
                                          size="slim"
                                          variant="plain"
                                          tone="critical"
                                          onClick={() => handleRefImageRemove(product.id, refUrl)}
                                          loading={isUploadingRefKey === `product:${product.id}`}
                                        >
                                          Remove
                                        </Button>
                                      </InlineStack>
                                    ))}
                                  </InlineStack>
                                  {getRefImageUrls(product).length === 0 && (
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      None
                                    </Text>
                                  )}
                                  {getRefImageUrls(product).length < MAX_REFERENCE_IMAGES ? (
                                    <InlineStack gap="200" blockAlign="center">
                                      {isUploadingRefKey === `product:${product.id}` ? (
                                        <Spinner size="small" />
                                      ) : (
                                        <>
                                          <input
                                            id={`ref-upload-${product.id}`}
                                            type="file"
                                            accept="image/*"
                                            style={{ display: "none" }}
                                            onChange={(e) => {
                                              const file = e.target.files?.[0];
                                              if (file)
                                                handleRefImageUpload(product.id, shop.shop_domain, file);
                                              e.target.value = "";
                                            }}
                                          />
                                          <Button
                                            size="slim"
                                            onClick={() =>
                                              document.getElementById(`ref-upload-${product.id}`)?.click()
                                            }
                                          >
                                            Add reference image
                                          </Button>
                                        </>
                                      )}
                                    </InlineStack>
                                  ) : null}
                                </BlockStack>

                                {/* AI Model Selector */}
                                <BlockStack gap="200">
                                  <Divider />
                                  <InlineStack gap="300" blockAlign="center">
                                    <Text as="p" variant="bodySm" fontWeight="semibold">
                                      AI Model:
                                    </Text>
                                    <div style={{ minWidth: '260px' }}>
                                      <Select
                                        label=""
                                        labelHidden
                                        options={[
                                          { label: "Auto (based on variant configs)", value: "auto" },
                                          { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash-image" },
                                          { label: "Gemini 3.1 Flash (2K)", value: "gemini-3.1-flash-image-preview" },
                                          { label: "Gemini 3 Pro", value: "gemini-3-pro-image-preview" },
                                          { label: "OpenAI gpt-image-1.5", value: "gpt-image-1.5" },
                                        ]}
                                        value={getAiModel(product)}
                                        onChange={(value) => saveAiModel(product.id, value)}
                                      />
                                    </div>
                                    {getAiModel(product) !== "auto" && (
                                      <Badge tone="warning">Override</Badge>
                                    )}
                                  </InlineStack>
                                </BlockStack>

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
