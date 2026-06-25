import { createClient } from '@supabase/supabase-js';
import { MAX_REFERENCE_IMAGES, parseReferenceImageUrls } from './reference-images';

if (!process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_URL environment variable is required');
}

if (!process.env.SUPABASE_API_KEY) {
  throw new Error('SUPABASE_API_KEY environment variable is required');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_API_KEY
);

// Helper function to find shop - SECURE VERSION
// Only uses exact match and explicit alternate_domains whitelist
// No fuzzy matching or guessing to prevent impersonation attacks
// Exported for use in API validation
export async function findShopByDomain(shopDomain: string) {
  console.log('🔍 Finding shop for domain:', shopDomain);
  
  // Method 1: Exact match on shop_domain
  const { data: exactMatch } = await supabase
    .from('shops')
    .select('id, shop_domain')
    .eq('shop_domain', shopDomain)
    .single();

  if (exactMatch) {
    console.log('✅ Found shop by exact domain match');
    return exactMatch;
  }

  // Method 2: Check alternate_domains whitelist (merchant-configured)
  const { data: altDomainMatch } = await supabase
    .from('shops')
    .select('id, shop_domain')
    .contains('alternate_domains', [shopDomain])
    .single();
  
  if (altDomainMatch) {
    console.log('✅ Found shop via alternate_domains:', altDomainMatch.shop_domain);
    return altDomainMatch;
  }

  // No match found - provide helpful guidance
  console.log('❌ No shop found for domain:', shopDomain);
  console.log('💡 To fix: Either use manual_shop_domain in widget settings, or add this domain to alternate_domains in Supabase');
  
  return null;
}

// Helper functions for product configurations
export async function getConfiguredProducts(shopDomain: string) {
  const shop = await findShopByDomain(shopDomain);

  if (!shop) return [];

  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .eq('shop_id', shop.id);

  if (error) {
    console.error('Error fetching configured products:', error);
    return [];
  }

  return products || [];
}

export async function getProductConfiguration(shopDomain: string, shopifyId: string) {
  console.log('Looking for product config:', { shopDomain, shopifyId });
  
  // SECURITY: Shop must exist and be verified first
  // No cross-shop lookups to prevent impersonation attacks
  const shop = await findShopByDomain(shopDomain);

  if (!shop) {
    console.log('❌ Shop not found for domain:', shopDomain);
    return null;
  }

  console.log('Found shop:', shop.id);

  // Handle both formats: numeric ID and full GID
  // If we get just a number, convert it to GID format
  let searchShopifyId = shopifyId;
  if (!shopifyId.startsWith('gid://')) {
    searchShopifyId = `gid://shopify/Product/${shopifyId}`;
  }
  
  console.log('Searching for shopify_id:', searchShopifyId);

  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('shop_id', shop.id)
    .eq('shopify_id', searchShopifyId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching product configuration:', error);
    return null;
  }

  if (product) {
    console.log('Found product:', product);
    return product;
  }

  // Fallback: legacy rows may store the numeric ID instead of the GID format.
  if (shopifyId.includes('/')) {
    const numericId = shopifyId.split('/').pop();
    console.log('Trying with numeric ID:', numericId);

    const { data: altProduct, error: altError } = await supabase
      .from('products')
      .select('*')
      .eq('shop_id', shop.id)
      .eq('shopify_id', numericId)
      .maybeSingle();

    if (altError) {
      console.error('Error fetching product configuration (numeric fallback):', altError);
      return null;
    }
    if (altProduct) {
      console.log('Found product with numeric ID');
      return altProduct;
    }
  }

  return null;
}

export async function saveProductConfiguration(
  shopDomain: string,
  shopifyId: string,
  productName: string,
  transformationPrompt: string
) {
  try {
    // First, get or create the shop
    let { data: shop } = await supabase
      .from('shops')
      .select('id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!shop) {
      const { data: newShop, error: shopError } = await supabase
        .from('shops')
        .insert([{
          shop_domain: shopDomain,
          shopify_id: shopDomain.replace('.myshopify.com', ''),
          shop_name: shopDomain.replace('.myshopify.com', '')
        }])
        .select()
        .single();

      if (shopError) {
        console.error("Shop creation error:", shopError);
        throw new Error(`Failed to create shop: ${shopError.message}`);
      }
      shop = newShop;
    }

    console.log('Saving product with ID:', shopifyId);

    // Check if product already exists for this shop
    const { data: existingProduct } = await supabase
      .from('products')
      .select('id')
      .eq('shop_id', shop?.id)
      .eq('shopify_id', shopifyId)
      .single();

    if (existingProduct) {
      // Update existing product instead of throwing error
      const { data, error } = await supabase
        .from('products')
        .update({
          product_name: productName,
          transformation_prompt: transformationPrompt
        })
        .eq('id', existingProduct.id)
        .select()
        .single();

      if (error) {
        console.error("Product update error:", error);
        throw new Error(`Failed to update product configuration: ${error.message}`);
      }

      return data;
    }

    // Save the product configuration
    const { data, error } = await supabase
      .from('products')
      .insert([{
        shop_id: shop?.id,
        shopify_id: shopifyId,
        product_name: productName,
        transformation_prompt: transformationPrompt
      }])
      .select()
      .single();

    if (error) {
      console.error("Product save error:", error);
      throw new Error(`Failed to save product configuration: ${error.message}`);
    }

    console.log('Product saved successfully:', data);

    return data;
  } catch (error) {
    console.error("Error in saveProductConfiguration:", error);
    throw error;
  }
}

export async function updateProductConfiguration(
  configuredProductId: string,
  transformationPrompt: string
) {
  try {
    const { data, error } = await supabase
      .from('products')
      .update({
        transformation_prompt: transformationPrompt
      })
      .eq('id', configuredProductId)
      .select()
      .single();

    if (error) {
      console.error("Product update error:", error);
      throw new Error(`Failed to update product configuration: ${error.message}`);
    }

    console.log('Product updated successfully:', data);
    return data;
  } catch (error) {
    console.error("Error in updateProductConfiguration:", error);
    throw error;
  }
}

export async function updateProductAiModel(
  configuredProductId: string,
  aiModel: string | null
) {
  try {
    const { data, error } = await supabase
      .from('products')
      .update({ ai_model: aiModel })
      .eq('id', configuredProductId)
      .select()
      .single();

    if (error) {
      console.error("Product ai_model update error:", error);
      throw new Error(`Failed to update AI model: ${error.message}`);
    }

    console.log('Product ai_model updated:', configuredProductId, '->', aiModel);
    return data;
  } catch (error) {
    console.error("Error in updateProductAiModel:", error);
    throw error;
  }
}

export async function deleteProductConfiguration(configuredProductId: string) {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', configuredProductId);

    if (error) {
      console.error("Product delete error:", error);
      throw new Error(`Failed to delete product configuration: ${error.message}`);
    }

    console.log('Product deleted successfully');
    return true;
  } catch (error) {
    console.error("Error in deleteProductConfiguration:", error);
    throw error;
  }
}

// Strip the `?key=…` suffix Shopify's Storefront Cart API attaches to cart
// tokens. The orders/create webhook delivers the bare cart id (e.g.
// `hWNBepxLNsgcAYGhzHwyh8Ww`) while `/cart.js` and Liquid `cart.token` return
// the keyed form (`hWNBepxLNsgcAYGhzHwyh8Ww?key=…`). Without this,
// analytics_events.cart_token never joins widget_orders.cart_token.
function normalizeCartToken(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const id = trimmed.split('?')[0];
  return id || null;
}

// Analytics functions
export async function trackTransformationEvent(
  shopDomain: string,
  shopifyProductId: string,
  eventType: string = 'transformation',
  widgetType: string = 'unknown',
  cartToken?: string
) {
  try {
    const normalizedCartToken = normalizeCartToken(cartToken);

    // Get shop with fallback logic
    const shop = await findShopByDomain(shopDomain);

    if (!shop) {
      console.log('Shop not found for analytics tracking:', shopDomain);
      return null;
    }

    // Get product - need to handle both formats
    let searchShopifyId = shopifyProductId;
    if (!shopifyProductId.startsWith('gid://')) {
      searchShopifyId = `gid://shopify/Product/${shopifyProductId}`;
    }

    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('shop_id', shop.id)
      .eq('shopify_id', searchShopifyId)
      .single();

    if (!product) {
      // Try with numeric ID if GID format failed
      if (shopifyProductId.includes('/')) {
        const numericId = shopifyProductId.split('/').pop();
        const { data: altProduct } = await supabase
          .from('products')
          .select('id')
          .eq('shop_id', shop.id)
          .eq('shopify_id', numericId)
          .single();
        
        if (altProduct) {
          // Track with found product
          const { data, error } = await supabase
            .from('analytics_events')
            .insert([{
              shop_id: shop.id,
              product_id: altProduct.id,
              event_type: eventType,
              widget_type: widgetType,
              cart_token: normalizedCartToken
            }])
            .select()
            .single();

          if (error) {
            console.error('Error tracking analytics event:', error);
            return null;
          }

          console.log('Analytics event tracked successfully:', data);
          return data;
        }
      }
      
      console.log('Product not found for analytics tracking:', shopifyProductId);
      return null;
    }

    // Insert analytics event
    const { data, error } = await supabase
      .from('analytics_events')
      .insert([{
        shop_id: shop.id,
        product_id: product.id,
        event_type: eventType,
        widget_type: widgetType,
        cart_token: normalizedCartToken
      }])
      .select()
      .single();

    if (error) {
      console.error('Error tracking analytics event:', error);
      return null;
    }

    console.log('Analytics event tracked successfully:', data);
    return data;
  } catch (error) {
    console.error('Error in trackTransformationEvent:', error);
    return null;
  }
}

// The chat assistant funnel events are shop-level, not tied to a product, so
// they're inserted directly with a null product_id (unlike trackTransformationEvent,
// which requires a matching product row). See migration 040.
export async function trackAssistantEvent(
  shopDomain: string,
  eventType: string,
  widgetType: string = 'chat',
  cartToken?: string
) {
  try {
    const normalizedCartToken = normalizeCartToken(cartToken);

    const shop = await findShopByDomain(shopDomain);
    if (!shop) {
      console.log('Shop not found for assistant analytics tracking:', shopDomain);
      return null;
    }

    const { data, error } = await supabase
      .from('analytics_events')
      .insert([{
        shop_id: shop.id,
        product_id: null,
        event_type: eventType,
        widget_type: widgetType,
        cart_token: normalizedCartToken,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error tracking assistant event:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in trackAssistantEvent:', error);
    return null;
  }
}

/**
 * Record an order from the orders/create webhook
 * Used for conversion attribution tracking
 */
export interface OrderJourneyData {
  firstTouchSource?: string | null;
  firstTouchSourceType?: string | null;
  firstTouchLandingPage?: string | null;
  firstTouchUtm?: Record<string, string | null> | null;
  firstTouchAt?: string | null;
  lastTouchSource?: string | null;
  lastTouchSourceType?: string | null;
  lastTouchLandingPage?: string | null;
  lastTouchUtm?: Record<string, string | null> | null;
  lastTouchAt?: string | null;
  customerOrderIndex?: number | null;
  daysToConversion?: number | null;
}

export async function recordOrder(
  shopDomain: string,
  orderData: {
    shopifyOrderId: string;
    cartToken?: string;
    orderNumber?: string;
    totalPrice?: number;
    currency?: string;
    customerId?: string;
    createdAt?: string;
    journey?: OrderJourneyData;
  }
) {
  try {
    const shop = await findShopByDomain(shopDomain);
    if (!shop) {
      console.log('Shop not found for order tracking:', shopDomain);
      return null;
    }

    const j = orderData.journey;
    const { data, error } = await supabase
      .from('widget_orders')
      .upsert([{
        shop_id: shop.id,
        shopify_order_id: orderData.shopifyOrderId,
        cart_token: normalizeCartToken(orderData.cartToken),
        order_number: orderData.orderNumber || null,
        total_price: orderData.totalPrice || null,
        currency: orderData.currency || 'USD',
        customer_id: orderData.customerId || null,
        shopify_created_at: orderData.createdAt || new Date().toISOString(),
        first_touch_source: j?.firstTouchSource ?? null,
        first_touch_source_type: j?.firstTouchSourceType ?? null,
        first_touch_landing_page: j?.firstTouchLandingPage ?? null,
        first_touch_utm: j?.firstTouchUtm ?? null,
        first_touch_at: j?.firstTouchAt ?? null,
        last_touch_source: j?.lastTouchSource ?? null,
        last_touch_source_type: j?.lastTouchSourceType ?? null,
        last_touch_landing_page: j?.lastTouchLandingPage ?? null,
        last_touch_utm: j?.lastTouchUtm ?? null,
        last_touch_at: j?.lastTouchAt ?? null,
        customer_order_index: j?.customerOrderIndex ?? null,
        days_to_conversion: j?.daysToConversion ?? null,
        // is_repeat_customer is a Postgres-generated column (customer_order_index >= 2)
      }], {
        onConflict: 'shop_id,shopify_order_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error recording order:', error);
      return null;
    }

    console.log('Order recorded for conversion tracking:', data?.id);
    return data;
  } catch (error) {
    console.error('Error in recordOrder:', error);
    return null;
  }
}

/**
 * Get conversion attribution stats for a shop
 * Shows what % of orders had widget usage before purchase
 */
export async function getConversionStats(shopDomain: string, daysBack: number = 30) {
  try {
    const shop = await findShopByDomain(shopDomain);
    if (!shop) {
      console.log('Shop not found for conversion stats:', shopDomain);
      return null;
    }

    // Call the database function
    const { data, error } = await supabase
      .rpc('get_conversion_stats', {
        p_shop_id: shop.id,
        p_days_back: daysBack
      });

    if (error) {
      console.error('Error getting conversion stats:', error);
      return null;
    }

    // RPC returns array, get first row
    const stats = Array.isArray(data) ? data[0] : data;

    return {
      totalOrders: Number(stats?.total_orders || 0),
      ordersWithWidgetUsage: Number(stats?.orders_with_widget_usage || 0),
      // % of buyers who used widget (order coverage)
      conversionRate: Number(stats?.conversion_rate || 0),
      totalRevenue: Number(stats?.total_revenue || 0),
      widgetAttributedRevenue: Number(stats?.widget_attributed_revenue || 0),
      repeatOrders: Number(stats?.repeat_orders || 0),
      repeatOrdersWithWidget: Number(stats?.repeat_orders_with_widget || 0),
      // Distinct widget-engaged carts in window, and how many converted
      widgetSessions: Number(stats?.widget_sessions || 0),
      widgetSessionsConverted: Number(stats?.widget_sessions_converted || 0),
      // % of widget users who bought (the headline ROI metric)
      widgetPurchaseRate: Number(stats?.widget_purchase_rate || 0),
    };
  } catch (error) {
    console.error('Error in getConversionStats:', error);
    return null;
  }
}

export interface TrafficSourceStat {
  source: string;
  orders: number;
  revenue: number;
}

export async function getTopTrafficSources(
  shopDomain: string,
  daysBack: number = 30,
  limit: number = 5,
): Promise<TrafficSourceStat[]> {
  try {
    const shop = await findShopByDomain(shopDomain);
    if (!shop) return [];

    const { data, error } = await supabase
      .rpc('get_top_traffic_sources', {
        p_shop_id: shop.id,
        p_days_back: daysBack,
        p_limit: limit,
      });

    if (error) {
      console.error('Error getting top traffic sources:', error);
      return [];
    }

    return (Array.isArray(data) ? data : []).map((row: { source: string; orders: number | string; revenue: number | string }) => ({
      source: row.source,
      orders: Number(row.orders || 0),
      revenue: Number(row.revenue || 0),
    }));
  } catch (error) {
    console.error('Error in getTopTrafficSources:', error);
    return [];
  }
}

export async function getAnalytics(shopDomain: string, daysBack: number = 7) {
  try {
    // Get shop with fallback logic
    const shop = await findShopByDomain(shopDomain);

    if (!shop) {
      console.log('Shop not found for analytics:', shopDomain);
      return null;
    }

    // Calculate date threshold
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysBack);

    // Get total transformations count (selfie uploads) in the last N days (use count to avoid 1000 row limit)
    const { count: transformationCount, error: transformationError } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
      .eq('event_type', 'transformation')
      .gte('created_at', dateThreshold.toISOString());

    if (transformationError) {
      console.error('Error fetching transformation analytics:', transformationError);
      return null;
    }

    // Get widget views count in the last N days (use count to avoid 1000 row limit)
    const { count: widgetViewCount, error: viewError } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
      .eq('event_type', 'widget_view')
      .gte('created_at', dateThreshold.toISOString());

    if (viewError) {
      console.error('Error fetching widget view analytics:', viewError);
      // Don't fail entirely, just set to 0
    }

    // Get add-to-cart events count in the last N days (use count to avoid 1000 row limit)
    const { count: atcCount, error: atcError } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
      .eq('event_type', 'add_to_cart')
      .gte('created_at', dateThreshold.toISOString());

    if (atcError) {
      console.error('Error fetching ATC analytics:', atcError);
      // Don't fail entirely, just set to 0
    }

    // Get per-product analytics in the last N days (including widget_type)
    // Use pagination to get ALL events, not just first 1000
    let allProductEvents: any[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data: productEvents, error: productError } = await supabase
        .from('analytics_events')
        .select(`
          product_id,
          widget_type,
          event_type,
          products (
            id,
            product_name,
            shopify_id
          )
        `)
        .eq('shop_id', shop.id)
        .in('event_type', ['transformation', 'widget_view', 'add_to_cart'])
        .gte('created_at', dateThreshold.toISOString())
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (productError) {
        console.error('Error fetching product analytics:', productError);
        return null;
      }
      
      if (productEvents && productEvents.length > 0) {
        allProductEvents = allProductEvents.concat(productEvents);
        hasMore = productEvents.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
      
      // Safety limit: max 10 pages (10,000 events)
      if (page >= 10) {
        console.log('Analytics pagination limit reached (10,000 events)');
        hasMore = false;
      }
    }

    // Group by product and widget_type (only count transformations for the main number)
    const productStats = allProductEvents
      .filter((e: any) => e.event_type === 'transformation')
      .reduce((acc: any, event: any) => {
        const productId = event.product_id;
        const widgetType = event.widget_type || 'unknown';
        
        if (!acc[productId]) {
          acc[productId] = {
            product_id: productId,
            product_name: event.products?.product_name || 'Unknown Product',
            shopify_id: event.products?.shopify_id || '',
            transformations: 0,
            views: 0,
            addToCarts: 0,
            widgets: {} // Track per-widget stats
          };
        }
        acc[productId].transformations++;
        
        // Track per-widget breakdown
        if (!acc[productId].widgets[widgetType]) {
          acc[productId].widgets[widgetType] = 0;
        }
        acc[productId].widgets[widgetType]++;
        
        return acc;
      }, {});

    // Add view counts per product
    allProductEvents
      .filter((e: any) => e.event_type === 'widget_view')
      .forEach((event: any) => {
        const productId = event.product_id;
        if (productStats[productId]) {
          productStats[productId].views++;
        }
      });

    // Add ATC counts per product
    allProductEvents
      .filter((e: any) => e.event_type === 'add_to_cart')
      .forEach((event: any) => {
        const productId = event.product_id;
        if (productStats[productId]) {
          productStats[productId].addToCarts++;
        }
      });

    const totalUploads = transformationCount || 0;
    const totalViews = widgetViewCount || 0;
    const totalATC = atcCount || 0;
    
    // Calculate upload to ATC rate
    const uploadToATCRate = totalUploads > 0 ? (totalATC / totalUploads) * 100 : 0;

    return {
      totalTransformations: totalUploads,
      widgetViews: totalViews,
      addToCarts: totalATC,
      uploadToATCRate: uploadToATCRate,
      productBreakdown: Object.values(productStats)
    };
  } catch (error) {
    console.error('Error in getAnalytics:', error);
    return null;
  }
}

export interface AssistantEngagement {
  opens: number;                 // chat_open
  starts: number;                // chat_recommend_start
  photoUploads: number;          // chat_photo_upload
  recommendationsShown: number;  // chat_recommendation_shown
  productClicks: number;         // chat_view_product
  addToBag: number;              // chat_add_bundle_to_bag
  heroViews: number;             // hero_view
  heroCtaClicks: number;         // hero_cta_click
}

// Engagement funnel for the chat assistant. Counts are event volume (not unique
// sessions) — the widget doesn't emit a session id today, so a shopper who
// uploads twice counts twice. Good enough for tracking relative funnel health.
export async function getAssistantEngagement(
  shopDomain: string,
  daysBack: number = 7,
): Promise<AssistantEngagement | null> {
  try {
    const shop = await findShopByDomain(shopDomain);
    if (!shop) {
      console.log('Shop not found for assistant engagement:', shopDomain);
      return null;
    }

    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysBack);
    const iso = dateThreshold.toISOString();

    const countFor = async (eventType: string): Promise<number> => {
      const { count, error } = await supabase
        .from('analytics_events')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shop.id)
        .eq('event_type', eventType)
        .gte('created_at', iso);
      if (error) {
        console.error(`Error counting assistant event ${eventType}:`, error);
        return 0;
      }
      return count || 0;
    };

    const [
      opens,
      starts,
      photoUploads,
      recommendationsShown,
      productClicks,
      addToBag,
      heroViews,
      heroCtaClicks,
    ] = await Promise.all([
      countFor('chat_open'),
      countFor('chat_recommend_start'),
      countFor('chat_photo_upload'),
      countFor('chat_recommendation_shown'),
      countFor('chat_view_product'),
      countFor('chat_add_bundle_to_bag'),
      countFor('hero_view'),
      countFor('hero_cta_click'),
    ]);

    return {
      opens,
      starts,
      photoUploads,
      recommendationsShown,
      productClicks,
      addToBag,
      heroViews,
      heroCtaClicks,
    };
  } catch (error) {
    console.error('Error in getAssistantEngagement:', error);
    return null;
  }
}

// ============================================
// VARIANT SUPPORT FUNCTIONS (Phase 2)
// ============================================

/**
 * Get variant-specific transformation prompt
 * @param shopDomain - Shop domain (e.g., "myshop.myshopify.com")
 * @param productId - Shopify product ID (GID format or numeric)
 * @param variantId - Shopify variant ID (GID format or numeric)
 * @returns Variant configuration object or null if not found
 */
export async function getVariantConfiguration(
  shopDomain: string,
  productId: string,
  variantId: string
) {
  console.log('Looking for variant config:', { shopDomain, productId, variantId });
  
  // First, get the product from our database
  const productConfig = await getProductConfiguration(shopDomain, productId);
  
  if (!productConfig) {
    console.log('Product not found, cannot lookup variant');
    return null;
  }
  
  // Handle both GID and numeric formats for variant
  let searchVariantId = variantId;
  if (!variantId.startsWith('gid://')) {
    searchVariantId = `gid://shopify/ProductVariant/${variantId}`;
  }
  
  console.log('Searching for variant_id:', searchVariantId);
  
  // Query product_variants table
  const { data: variant, error } = await supabase
    .from('product_variants')
    .select('*')
    .eq('product_id', productConfig.id)
    .eq('shopify_variant_id', searchVariantId)
    .single();
  
  if (error) {
    console.log('Variant config not found:', error.message);
    
    // Try with numeric ID if GID format failed
    if (variantId.includes('/')) {
      const numericId = variantId.split('/').pop();
      console.log('Trying with numeric variant ID:', numericId);
      
      const { data: altVariant, error: altError } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', productConfig.id)
        .eq('shopify_variant_id', numericId)
        .single();
      
      if (!altError && altVariant) {
        console.log('Found variant with numeric ID');
        return altVariant;
      }
    }
    
    return null;
  }
  
  console.log('Found variant config:', variant);
  return variant;
}

/**
 * Get transformation prompt - tries variant first, falls back to product
 * This is the main function that should be used by the API
 * @param shopDomain - Shop domain
 * @param productId - Shopify product ID
 * @param variantId - Optional: Shopify variant ID
 * @returns Configuration with transformation_prompt, or null
 */
export async function getProductOrVariantConfiguration(
  shopDomain: string,
  productId: string,
  variantId?: string
) {
  console.log('Getting config with variant support:', { shopDomain, productId, variantId });
  
  // If variant ID provided, try to get variant-specific config first
  if (variantId) {
    const variantConfig = await getVariantConfiguration(shopDomain, productId, variantId);
    
    if (variantConfig) {
      console.log('✅ Using variant-specific prompt');
      return variantConfig;
    }
    
    console.log('⚠️  No variant config found, falling back to product-level');
  }
  
  // Fall back to product-level configuration
  const productConfig = await getProductConfiguration(shopDomain, productId);
  
  if (productConfig) {
    console.log('✅ Using product-level prompt');
    return productConfig;
  }
  
  console.log('❌ No configuration found at all');
  return null;
}

/**
 * Save or update variant-specific transformation prompt
 * @param productId - Internal product ID from products table (UUID)
 * @param shopifyVariantId - Shopify variant GID
 * @param variantTitle - Human-readable variant name (e.g., "Red Eyeliner")
 * @param transformationPrompt - Variant-specific AI prompt
 * @returns Saved variant configuration
 */
export async function saveVariantConfiguration(
  productId: string,
  shopifyVariantId: string,
  variantTitle: string,
  transformationPrompt: string,
  displayColor?: string | null
) {
  console.log('Saving variant configuration:', { productId, shopifyVariantId, variantTitle });

  try {
    // Check if variant config already exists
    const { data: existingVariant } = await supabase
      .from('product_variants')
      .select('id')
      .eq('product_id', productId)
      .eq('shopify_variant_id', shopifyVariantId)
      .single();

    if (existingVariant) {
      // Only include display_color in the update when explicitly passed —
      // omitting it preserves any existing color set via the variant modal.
      const updatePayload: Record<string, unknown> = {
        variant_title: variantTitle,
        transformation_prompt: transformationPrompt,
        updated_at: new Date().toISOString(),
      };
      if (displayColor !== undefined) updatePayload.display_color = displayColor || null;

      // Update existing variant configuration
      const { data, error } = await supabase
        .from('product_variants')
        .update(updatePayload)
        .eq('id', existingVariant.id)
        .select()
        .single();

      if (error) {
        console.error('Variant update error:', error);
        throw new Error(`Failed to update variant configuration: ${error.message}`);
      }

      console.log('✅ Variant configuration updated');
      return data;
    }

    // Create new variant configuration
    const { data, error } = await supabase
      .from('product_variants')
      .insert([{
        product_id: productId,
        shopify_variant_id: shopifyVariantId,
        variant_title: variantTitle,
        transformation_prompt: transformationPrompt,
        display_color: displayColor || null,
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Variant save error:', error);
      throw new Error(`Failed to save variant configuration: ${error.message}`);
    }
    
    console.log('✅ Variant configuration created');
    return data;
  } catch (error) {
    console.error('Error in saveVariantConfiguration:', error);
    throw error;
  }
}

/**
 * Get all configured variants for a product
 * @param productId - Internal product ID from products table (UUID)
 * @returns Array of variant configurations
 */
export async function getProductVariants(productId: string) {
  console.log('Fetching all variants for product:', productId);
  
  try {
    const { data: variants, error } = await supabase
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error fetching product variants:', error);
      return [];
    }
    
    console.log(`Found ${variants?.length || 0} configured variants`);
    return variants || [];
  } catch (error) {
    console.error('Error in getProductVariants:', error);
    return [];
  }
}

/**
 * Bulk-fetch configured variants for many products in a single query.
 * Used by chat-recommend to flatten product+variant pairs into a candidate pool
 * without N+1 queries.
 * @param productIds - Internal product IDs (UUIDs) from the products table
 * @returns Array of variant rows across all requested products
 */
export async function getVariantsForProducts(productIds: string[]) {
  if (productIds.length === 0) return [];

  const { data: variants, error } = await supabase
    .from('product_variants')
    .select('*')
    .in('product_id', productIds);

  if (error) {
    console.error('Error bulk-fetching product variants:', error);
    return [];
  }

  return variants || [];
}

/**
 * Check if a product has any configured variants in the database
 * Used to determine which AI model to use (Pro for products with variant configs, Flash otherwise)
 * @param productId - Internal product ID from products table (UUID)
 * @returns true if product has at least one variant configuration
 */
export async function productHasVariantConfigs(productId: string): Promise<boolean> {
  console.log('Checking if product has variant configs:', productId);
  
  try {
    const { count, error } = await supabase
      .from('product_variants')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId);
    
    if (error) {
      console.error('Error checking variant configs:', error);
      return false;
    }
    
    const hasVariants = (count || 0) > 0;
    console.log(`Product ${productId} has variant configs: ${hasVariants}`);
    return hasVariants;
  } catch (error) {
    console.error('Error in productHasVariantConfigs:', error);
    return false;
  }
}

/**
 * Get configured variants for the storefront widget variant selector.
 * Storefront-safe: verifies shop + product ownership before returning data.
 * Only returns variants that have explicit configurations (not all Shopify variants).
 *
 * @param shopDomain - Shop domain (e.g., "myshop.myshopify.com")
 * @param productId  - Shopify product ID (GID or numeric)
 * @returns Array of { variantId, variantTitle, displayColor } — empty if none configured
 */
export async function getConfiguredVariantsForStorefront(
  shopDomain: string,
  productId: string
): Promise<Array<{ variantId: string; variantTitle: string; displayColor: string | null }>> {
  // Security: verify shop owns this product before exposing variant list
  const productConfig = await getProductConfiguration(shopDomain, productId);
  if (!productConfig) return [];

  const { data: variants, error } = await supabase
    .from('product_variants')
    .select('shopify_variant_id, variant_title, display_color')
    .eq('product_id', productConfig.id)
    .order('created_at', { ascending: true });

  if (error || !variants) {
    console.error('Error fetching variants for storefront:', error);
    return [];
  }

  return variants.map(v => ({
    variantId: v.shopify_variant_id as string,
    variantTitle: v.variant_title as string,
    displayColor: (v.display_color as string | null) ?? null,
  }));
}

// ============================================
// SHOP DATA CLEANUP (for uninstall)
// ============================================

/**
 * Delete all data for a shop when they uninstall the app
 * Called from the APP_UNINSTALLED webhook
 * 
 * Deletion order (to respect foreign keys):
 * 1. analytics_events (references shop_id)
 * 2. product_variants (references product_id)
 * 3. products (references shop_id)
 * 4. shops
 * 
 * @param shopDomain - The shop's myshopify.com domain
 * @returns Object with success status and counts of deleted records
 */
export async function deleteShopData(shopDomain: string): Promise<{
  success: boolean;
  deleted: {
    analyticsEvents: number;
    productVariants: number;
    products: number;
    shop: boolean;
  };
  error?: string;
}> {
  console.log(`[Uninstall Cleanup] Starting data deletion for shop: ${shopDomain}`);
  
  const result = {
    success: false,
    deleted: {
      analyticsEvents: 0,
      productVariants: 0,
      products: 0,
      shop: false,
    },
  };

  try {
    // Step 1: Find the shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id')
      .eq('shop_domain', shopDomain)
      .single();

    if (shopError || !shop) {
      // Shop not found - might have been deleted already or never existed
      // This is OK - webhook can fire multiple times
      console.log(`[Uninstall Cleanup] Shop not found in Supabase: ${shopDomain}`);
      result.success = true; // Not an error, just nothing to delete
      return result;
    }

    const shopId = shop.id;
    console.log(`[Uninstall Cleanup] Found shop with ID: ${shopId}`);

    // Step 2: Get all product IDs for this shop (needed for variant deletion)
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id')
      .eq('shop_id', shopId);

    if (productsError) {
      console.error('[Uninstall Cleanup] Error fetching products:', productsError);
      // Continue anyway - we'll try to delete what we can
    }

    const productIds = products?.map(p => p.id) || [];
    console.log(`[Uninstall Cleanup] Found ${productIds.length} products to clean up`);

    // Step 3: Delete analytics_events
    const { error: analyticsError, count: analyticsCount } = await supabase
      .from('analytics_events')
      .delete({ count: 'exact' })
      .eq('shop_id', shopId);

    if (analyticsError) {
      console.error('[Uninstall Cleanup] Error deleting analytics:', analyticsError);
    } else {
      result.deleted.analyticsEvents = analyticsCount || 0;
      console.log(`[Uninstall Cleanup] Deleted ${result.deleted.analyticsEvents} analytics events`);
    }

    // Step 4: Delete product_variants (if there are products)
    if (productIds.length > 0) {
      const { error: variantsError, count: variantsCount } = await supabase
        .from('product_variants')
        .delete({ count: 'exact' })
        .in('product_id', productIds);

      if (variantsError) {
        console.error('[Uninstall Cleanup] Error deleting variants:', variantsError);
      } else {
        result.deleted.productVariants = variantsCount || 0;
        console.log(`[Uninstall Cleanup] Deleted ${result.deleted.productVariants} product variants`);
      }
    }

    // Step 5: Delete products
    const { error: deleteProductsError, count: productsCount } = await supabase
      .from('products')
      .delete({ count: 'exact' })
      .eq('shop_id', shopId);

    if (deleteProductsError) {
      console.error('[Uninstall Cleanup] Error deleting products:', deleteProductsError);
    } else {
      result.deleted.products = productsCount || 0;
      console.log(`[Uninstall Cleanup] Deleted ${result.deleted.products} products`);
    }

    // Step 6: Delete the shop
    const { error: deleteShopError } = await supabase
      .from('shops')
      .delete()
      .eq('id', shopId);

    if (deleteShopError) {
      console.error('[Uninstall Cleanup] Error deleting shop:', deleteShopError);
    } else {
      result.deleted.shop = true;
      console.log(`[Uninstall Cleanup] Deleted shop record`);
    }

    result.success = true;
    console.log('[Uninstall Cleanup] Cleanup completed successfully:', result.deleted);
    
    return result;

  } catch (error) {
    console.error('[Uninstall Cleanup] Unexpected error:', error);
    return {
      ...result,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// FUNNEL SYSTEM FUNCTIONS
// ============================================

/**
 * Get all categories (11 beauty categories)
 * Used by the funnel UI to display category options
 */
export async function getCategories() {
  console.log('📂 Fetching all categories');
  
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order');
    
    if (error) {
      console.error('Error fetching categories:', error);
      return [];
    }
    
    console.log(`Found ${data?.length || 0} categories`);
    return data || [];
  } catch (error) {
    console.error('Error in getCategories:', error);
    return [];
  }
}

/**
 * Get a single category by ID (includes base_prompt)
 * @param categoryId - UUID of the category
 */
export async function getCategory(categoryId: string) {
  console.log('📂 Fetching category:', categoryId);
  
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('id', categoryId)
      .single();
    
    if (error) {
      console.error('Error fetching category:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Error in getCategory:', error);
    return null;
  }
}

/**
 * Get all parameters for a category (including locked guardrails)
 * @param categoryId - UUID of the category
 */
export async function getCategoryParameters(categoryId: string) {
  console.log('📋 Fetching parameters for category:', categoryId);
  
  try {
    const { data, error } = await supabase
      .from('category_parameters')
      .select('*')
      .eq('category_id', categoryId)
      .order('sort_order');
    
    if (error) {
      console.error('Error fetching category parameters:', error);
      return [];
    }
    
    console.log(`Found ${data?.length || 0} parameters`);
    return data || [];
  } catch (error) {
    console.error('Error in getCategoryParameters:', error);
    return [];
  }
}

/**
 * Get all levels for a parameter
 * @param parameterId - UUID of the parameter
 */
export async function getParameterLevels(parameterId: string) {
  console.log('📊 Fetching levels for parameter:', parameterId);
  
  try {
    const { data, error } = await supabase
      .from('parameter_levels')
      .select('*')
      .eq('parameter_id', parameterId)
      .order('level');
    
    if (error) {
      console.error('Error fetching parameter levels:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Error in getParameterLevels:', error);
    return [];
  }
}

/**
 * Get a specific level for a parameter
 * @param parameterId - UUID of the parameter
 * @param level - Level number (1, 2, 3, or 4)
 */
export async function getParameterLevel(parameterId: string, level: number) {
  console.log('📊 Fetching level', level, 'for parameter:', parameterId);
  
  try {
    const { data, error } = await supabase
      .from('parameter_levels')
      .select('*')
      .eq('parameter_id', parameterId)
      .eq('level', level)
      .single();
    
    if (error) {
      console.error('Error fetching parameter level:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Error in getParameterLevel:', error);
    return null;
  }
}

/**
 * Get category with all parameters and their levels in one call
 * Used by the funnel UI to load everything needed for configuration
 * @param categoryId - UUID of the category
 */
export async function getCategoryWithFullData(categoryId: string) {
  console.log('📦 Fetching full category data:', categoryId);
  
  try {
    // Get category
    const category = await getCategory(categoryId);
    if (!category) {
      console.error('Category not found');
      return null;
    }
    
    // Get all parameters for this category
    const parameters = await getCategoryParameters(categoryId);
    
    // Get levels for each parameter
    const parametersWithLevels = await Promise.all(
      parameters.map(async (param) => {
        const levels = await getParameterLevels(param.id);
        return {
          ...param,
          levels
        };
      })
    );
    
    return {
      ...category,
      parameters: parametersWithLevels
    };
  } catch (error) {
    console.error('Error in getCategoryWithFullData:', error);
    return null;
  }
}

/**
 * Save funnel configuration for a product
 * Updates the product with category, funnel responses, and generated prompt
 * @param productId - Internal product ID (UUID)
 * @param categoryId - Category UUID
 * @param funnelResponses - Object mapping parameter_id to level number
 * @param generatedPrompt - The full concatenated prompt
 */
export async function saveFunnelConfiguration(
  productId: string,
  categoryId: string,
  funnelResponses: Record<string, number>,
  generatedPrompt: string
) {
  console.log('💾 Saving funnel configuration for product:', productId);
  
  try {
    const { data, error } = await supabase
      .from('products')
      .update({
        category_id: categoryId,
        funnel_responses: funnelResponses,
        transformation_prompt: generatedPrompt,
        is_funnel_generated: true
      })
      .eq('id', productId)
      .select()
      .single();
    
    if (error) {
      console.error('Error saving funnel configuration:', error);
      throw new Error(`Failed to save funnel configuration: ${error.message}`);
    }
    
    console.log('✅ Funnel configuration saved successfully');
    return data;
  } catch (error) {
    console.error('Error in saveFunnelConfiguration:', error);
    throw error;
  }
}

/**
 * Get configured products with category info (for products table display)
 * Joins with categories table to get category name
 * @param shopDomain - Shop domain
 */
export async function getConfiguredProductsWithCategory(shopDomain: string) {
  const shop = await findShopByDomain(shopDomain);
  
  if (!shop) return [];
  
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        *,
        categories (
          id,
          name,
          slug
        )
      `)
      .eq('shop_id', shop.id);
    
    if (error) {
      console.error('Error fetching configured products with category:', error);
      return [];
    }
    
    return products || [];
  } catch (error) {
    console.error('Error in getConfiguredProductsWithCategory:', error);
    return [];
  }
}

/**
 * Get all shops with their products (for Gleame Admin)
 * Includes category info and transformation counts
 */
export async function getAllShopsWithProducts() {
  console.log('🏪 Fetching all shops with products (admin view)');
  
  try {
    // Get all shops
    const { data: shops, error: shopsError } = await supabase
      .from('shops')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (shopsError) {
      console.error('Error fetching shops:', shopsError);
      return [];
    }
    
    // Get products with categories for each shop
    const shopsWithProducts = await Promise.all(
      (shops || []).map(async (shop) => {
        const { data: products } = await supabase
          .from('products')
          .select(`
            *,
            categories (
              id,
              name,
              slug
            )
          `)
          .eq('shop_id', shop.id);
        
        // Get transformation counts per product
        const productsWithStats = await Promise.all(
          (products || []).map(async (product) => {
            const { count } = await supabase
              .from('analytics_events')
              .select('id', { count: 'exact', head: true })
              .eq('product_id', product.id)
              .eq('event_type', 'transformation');
            
            return {
              ...product,
              transformation_count: count || 0
            };
          })
        );
        
        return {
          ...shop,
          products: productsWithStats
        };
      })
    );
    
    console.log(`Found ${shopsWithProducts.length} shops`);
    return shopsWithProducts;
  } catch (error) {
    console.error('Error in getAllShopsWithProducts:', error);
    return [];
  }
}

/**
 * Update transformation prompt directly (for Gleame Admin)
 * Allows founders to edit prompts directly
 * @param productId - Internal product ID (UUID)
 * @param transformationPrompt - New prompt text
 */
export async function updateProductPromptDirect(
  productId: string,
  transformationPrompt: string
) {
  console.log('✏️ Direct prompt update for product:', productId);
  
  try {
    const { data, error } = await supabase
      .from('products')
      .update({
        transformation_prompt: transformationPrompt
      })
      .eq('id', productId)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating prompt:', error);
      throw new Error(`Failed to update prompt: ${error.message}`);
    }
    
    console.log('✅ Prompt updated successfully');
    return data;
  } catch (error) {
    console.error('Error in updateProductPromptDirect:', error);
    throw error;
  }
}

/**
 * Check if a shop is grandfathered (existing user before billing gate)
 * A shop is grandfathered if they have:
 * - Any configured products, OR
 * - Any analytics events (widget views, transformations)
 * 
 * This allows existing users to continue using the app on a free plan
 * while new users must select a paid plan.
 */
export async function isShopGrandfathered(shopDomain: string): Promise<boolean> {
  console.log('🔍 Checking if shop is grandfathered:', shopDomain);
  
  const shop = await findShopByDomain(shopDomain);
  
  if (!shop) {
    // New shop, not grandfathered
    console.log('❌ Shop not found, not grandfathered');
    return false;
  }
  
  // Check if shop has any products configured
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id')
    .eq('shop_id', shop.id)
    .limit(1);
  
  if (!productsError && products && products.length > 0) {
    console.log('✅ Shop is grandfathered (has products)');
    return true;
  }
  
  // Check if shop has any analytics events
  const { data: events, error: eventsError } = await supabase
    .from('analytics_events')
    .select('id')
    .eq('shop_id', shop.id)
    .limit(1);
  
  if (!eventsError && events && events.length > 0) {
    console.log('✅ Shop is grandfathered (has analytics)');
    return true;
  }
  
  console.log('❌ Shop not grandfathered (no existing data)');
  return false;
}

/**
 * Subscription Status Types
 */
export type SubscriptionStatus = 'active' | 'trial' | 'grace_period' | 'cancelled' | 'grandfathered' | 'none';

/**
 * Update a shop's subscription status in Supabase
 * Called when billing status changes (subscribe, cancel, etc.)
 */
export async function updateShopSubscriptionStatus(
  shopDomain: string,
  status: SubscriptionStatus,
  expiresAt?: Date | null
): Promise<void> {
  const { error } = await supabase
    .from('shops')
    .update({
      subscription_status: status,
      subscription_expires_at: expiresAt?.toISOString() || null,
    })
    .eq('shop_domain', shopDomain);
  
  if (error) {
    console.error('Error updating subscription status:', error);
  } else {
    console.log(`📝 Updated subscription status for ${shopDomain}: ${status}`);
  }
}

/**
 * Check if a shop has valid access (for transform API)
 * Returns true if shop can use transformations
 */
export async function shopHasValidAccess(shopDomain: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('shops')
    .select('subscription_status, subscription_expires_at')
    .eq('shop_domain', shopDomain)
    .single();
  
  if (error || !data) {
    // Shop not found - no access
    return false;
  }
  
  const { subscription_status, subscription_expires_at } = data;
  
  // Grandfathered users always have access
  if (subscription_status === 'grandfathered') {
    return true;
  }
  
  // Active or trial subscriptions have access
  if (subscription_status === 'active' || subscription_status === 'trial') {
    return true;
  }
  
  // Grace period - check if still within the grace window
  if (subscription_status === 'grace_period' && subscription_expires_at) {
    const expiresAt = new Date(subscription_expires_at);
    if (expiresAt > new Date()) {
      return true;
    }
  }
  
  // No access for 'cancelled', 'none', or expired grace period
  return false;
}

/**
 * Mark a shop as grandfathered (has permanent free access)
 */
export async function markShopAsGrandfathered(shopDomain: string): Promise<void> {
  await updateShopSubscriptionStatus(shopDomain, 'grandfathered', null);
}

/**
 * Pending Plan Change Interface
 */
export interface PendingPlanChange {
  currentPlan: string;
  suggestedPlan: string;
  suggestedPlanId: string | null;
  suggestedPrice: number | null;
  sessions: number;
  isUpgrade: boolean;
  detectedAt: string;
}

/**
 * Get pending plan change notification for a shop (set by cron job)
 */
export async function getPendingPlanChange(shopDomain: string): Promise<PendingPlanChange | null> {
  const { data, error } = await supabase
    .from('shops')
    .select('pending_plan_change')
    .eq('shop_domain', shopDomain)
    .single();
  
  if (error || !data?.pending_plan_change) {
    return null;
  }
  
  return data.pending_plan_change as PendingPlanChange;
}

/**
 * Clear pending plan change notification (after user acknowledges or updates plan)
 */
export async function clearPendingPlanChange(shopDomain: string): Promise<void> {
  await supabase
    .from('shops')
    .update({ pending_plan_change: null })
    .eq('shop_domain', shopDomain);
}

/**
 * Update monthly sessions count for a shop (called by cron job)
 */
export async function updateShopMonthlySessions(shopDomain: string, sessionCount: number): Promise<void> {
  const { error } = await supabase
    .from('shops')
    .update({ 
      monthly_sessions: sessionCount,
      sessions_updated_at: new Date().toISOString()
    })
    .eq('shop_domain', shopDomain);
  
  if (error) {
    console.error(`Error updating sessions for ${shopDomain}:`, error);
  }
}

/**
 * Get all shops with their monthly session counts (for admin page)
 */
export async function getAllShopsWithSessions(): Promise<Array<{
  id: string;
  shop_domain: string;
  monthly_sessions: number | null;
  sessions_updated_at: string | null;
}>> {
  const { data, error } = await supabase
    .from('shops')
    .select('id, shop_domain, monthly_sessions, sessions_updated_at')
    .order('shop_domain');
  
  if (error) {
    console.error('Error fetching shops with sessions:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Upload a reference image to Supabase Storage and return its public URL
 */
export async function uploadReferenceImage(
  shopDomain: string,
  productId: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  const sanitizedShop = shopDomain.replace(/[^a-zA-Z0-9.-]/g, '_');
  const ext = fileName.split('.').pop() || 'jpg';
  const storagePath = `${sanitizedShop}/${productId}-${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from('reference-images')
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error('Error uploading reference image:', error);
    throw new Error(`Failed to upload reference image: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from('reference-images')
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

export async function uploadAvatarImage(
  shopDomain: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  const sanitizedShop = shopDomain.replace(/[^a-zA-Z0-9.-]/g, '_');
  const ext = fileName.split('.').pop() || 'jpg';
  const storagePath = `${sanitizedShop}/avatar-${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from('reference-images')
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload avatar: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from('reference-images')
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

/**
 * Persist a skincare-analysis selfie to the PRIVATE `skin-analysis-photos`
 * bucket and record it in `skin_analysis_uploads`.
 *
 * Best-effort by contract: callers must not fail the customer-facing
 * analysis request if this throws. Unlike `reference-images`, this bucket is
 * private — there is no public URL; retrieve photos via a signed URL or the
 * Supabase dashboard. Returns the storage path on success.
 */
export async function saveSkinAnalysisPhoto(
  shopId: string,
  shopDomain: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  visitorName?: string | null
): Promise<string> {
  const sanitizedShop = shopDomain.replace(/[^a-zA-Z0-9.-]/g, '_');
  const ext = (fileName.split('.').pop() || 'jpg').toLowerCase();
  const rand = Math.random().toString(36).slice(2, 10);
  const storagePath = `${sanitizedShop}/${Date.now()}-${rand}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('skin-analysis-photos')
    .upload(storagePath, fileBuffer, { contentType, upsert: false });

  if (uploadError) {
    throw new Error(`Failed to upload skin-analysis photo: ${uploadError.message}`);
  }

  const { error: insertError } = await supabase
    .from('skin_analysis_uploads')
    .insert({
      shop_id: shopId,
      storage_path: storagePath,
      // Conference name↔face pairing. Requires the visitor_name column
      // (migration: ALTER TABLE skin_analysis_uploads ADD COLUMN visitor_name text).
      // Best-effort like the rest of this insert — a missing column logs
      // below but never breaks the customer-facing analysis.
      visitor_name: visitorName?.trim() || null,
    });

  if (insertError) {
    // The image bytes are already in storage — log the index-row failure
    // but still return the path so the caller can log it.
    console.error('[saveSkinAnalysisPhoto] uploads row insert failed:', insertError);
  }

  return storagePath;
}

// Re-export for server routes that already import from supabase.server
export { MAX_REFERENCE_IMAGES, parseReferenceImageUrls };

/**
 * Replace all reference image URLs for a product (keeps legacy first URL in sync).
 */
export async function setProductReferenceImages(productId: string, urls: string[]) {
  const cleaned = urls.filter(Boolean).slice(0, MAX_REFERENCE_IMAGES);
  const { error } = await supabase
    .from('products')
    .update({
      reference_image_urls: cleaned,
      reference_image_url: cleaned[0] ?? null,
    })
    .eq('id', productId);

  if (error) {
    console.error('Error saving reference image URLs:', error);
    throw new Error(`Failed to save reference images: ${error.message}`);
  }
}

/**
 * Append one reference URL (merchant/admin upload).
 */
export async function appendProductReferenceImage(productId: string, newUrl: string) {
  const { data, error: fetchError } = await supabase
    .from('products')
    .select('reference_image_url, reference_image_urls')
    .eq('id', productId)
    .single();

  if (fetchError || !data) {
    throw new Error(`Failed to load product for reference append: ${fetchError?.message}`);
  }

  const current = parseReferenceImageUrls(data);
  if (current.length >= MAX_REFERENCE_IMAGES) {
    throw new Error(`Maximum ${MAX_REFERENCE_IMAGES} reference images allowed`);
  }
  await setProductReferenceImages(productId, [...current, newUrl]);
}

/**
 * Remove one reference URL by value (deletes file from storage when possible).
 */
export async function removeProductReferenceImageByUrl(productId: string, urlToRemove: string) {
  const { data, error: fetchError } = await supabase
    .from('products')
    .select('reference_image_url, reference_image_urls')
    .eq('id', productId)
    .single();

  if (fetchError || !data) {
    throw new Error(`Failed to load product for reference remove: ${fetchError?.message}`);
  }

  const next = parseReferenceImageUrls(data).filter((u) => u !== urlToRemove);
  if (urlToRemove) {
    await deleteReferenceImage(urlToRemove);
  }
  await setProductReferenceImages(productId, next);
}

/**
 * Save reference image URL to a product (merchant UI: single image replaces all).
 */
export async function saveProductReferenceImage(productId: string, referenceImageUrl: string | null) {
  await setProductReferenceImages(productId, referenceImageUrl ? [referenceImageUrl] : []);
}

// --- Variant reference images (same pattern) ---

export async function setVariantReferenceImages(variantId: string, urls: string[]) {
  const cleaned = urls.filter(Boolean).slice(0, MAX_REFERENCE_IMAGES);
  const { error } = await supabase
    .from('product_variants')
    .update({
      reference_image_urls: cleaned,
      reference_image_url: cleaned[0] ?? null,
    })
    .eq('id', variantId);

  if (error) {
    console.error('Error saving variant reference image URLs:', error);
    throw new Error(`Failed to save variant reference images: ${error.message}`);
  }
}

export async function appendVariantReferenceImage(variantId: string, newUrl: string) {
  const { data, error: fetchError } = await supabase
    .from('product_variants')
    .select('reference_image_url, reference_image_urls')
    .eq('id', variantId)
    .single();

  if (fetchError || !data) {
    throw new Error(`Failed to load variant for reference append: ${fetchError?.message}`);
  }

  const current = parseReferenceImageUrls(data);
  if (current.length >= MAX_REFERENCE_IMAGES) {
    throw new Error(`Maximum ${MAX_REFERENCE_IMAGES} reference images allowed`);
  }
  await setVariantReferenceImages(variantId, [...current, newUrl]);
}

export async function removeVariantReferenceImageByUrl(variantId: string, urlToRemove: string) {
  const { data, error: fetchError } = await supabase
    .from('product_variants')
    .select('reference_image_url, reference_image_urls')
    .eq('id', variantId)
    .single();

  if (fetchError || !data) {
    throw new Error(`Failed to load variant for reference remove: ${fetchError?.message}`);
  }

  const next = parseReferenceImageUrls(data).filter((u) => u !== urlToRemove);
  if (urlToRemove) {
    await deleteReferenceImage(urlToRemove);
  }
  await setVariantReferenceImages(variantId, next);
}

/**
 * Save reference image URL to a product variant (single image replaces all).
 */
export async function saveVariantReferenceImage(variantId: string, referenceImageUrl: string | null) {
  await setVariantReferenceImages(variantId, referenceImageUrl ? [referenceImageUrl] : []);
}

// ============================================================
// Onboarding Wizard
// ============================================================

export interface OnboardingState {
  step: number;
  completed: boolean;
  goals: string[];
  attribution: string[];
}

/**
 * Get the current onboarding state for a shop
 */
export async function getOnboardingState(shopDomain: string): Promise<OnboardingState> {
  const { data, error } = await supabase
    .from('shops')
    .select('onboarding_step, onboarding_completed, onboarding_goals, onboarding_attribution')
    .eq('shop_domain', shopDomain)
    .single();

  if (error || !data) {
    return { step: 0, completed: false, goals: [], attribution: [] };
  }

  return {
    step: data.onboarding_step ?? 0,
    completed: data.onboarding_completed ?? false,
    goals: data.onboarding_goals ?? [],
    attribution: data.onboarding_attribution ?? [],
  };
}

/**
 * Ensure a shop row exists in the database.
 * New merchants hit onboarding before configuring products, so the row
 * created by getOrCreateShop (product flow) may not exist yet.
 */
async function ensureShopExists(shopDomain: string): Promise<void> {
  const { data } = await supabase
    .from('shops')
    .select('id')
    .eq('shop_domain', shopDomain)
    .single();

  if (!data) {
    const { error } = await supabase
      .from('shops')
      .insert([{
        shop_domain: shopDomain,
        shopify_id: shopDomain.replace('.myshopify.com', ''),
        shop_name: shopDomain.replace('.myshopify.com', ''),
      }]);

    if (error && error.code !== '23505') { // ignore unique violation (race condition)
      console.error(`Error creating shop row for ${shopDomain}:`, error);
    }
  }
}

/**
 * Update the current onboarding step for a shop
 */
export async function updateOnboardingStep(shopDomain: string, step: number): Promise<void> {
  // Ensure the shop row exists — new merchants go through onboarding
  // before configuring any products, so the row may not exist yet.
  await ensureShopExists(shopDomain);

  const { error } = await supabase
    .from('shops')
    .update({ onboarding_step: step })
    .eq('shop_domain', shopDomain);

  if (error) {
    console.error(`Error updating onboarding step for ${shopDomain}:`, error);
  }
}

/**
 * Save onboarding survey responses (goals and/or attribution)
 */
export async function saveOnboardingSurvey(
  shopDomain: string,
  goals?: string[],
  attribution?: string[]
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (goals !== undefined) updates.onboarding_goals = goals;
  if (attribution !== undefined) updates.onboarding_attribution = attribution;

  if (Object.keys(updates).length === 0) return;

  await ensureShopExists(shopDomain);

  const { error } = await supabase
    .from('shops')
    .update(updates)
    .eq('shop_domain', shopDomain);

  if (error) {
    console.error(`Error saving onboarding survey for ${shopDomain}:`, error);
  }
}

/**
 * Mark onboarding as completed
 */
export async function completeOnboarding(shopDomain: string): Promise<void> {
  await ensureShopExists(shopDomain);

  const { error } = await supabase
    .from('shops')
    .update({
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('shop_domain', shopDomain);

  if (error) {
    console.error(`Error completing onboarding for ${shopDomain}:`, error);
  }
}

// ============================================================
// Chat Assistant Config
// ============================================================

export type HeroPosition = 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left';

export interface ChatAssistantConfig {
  enabled: boolean;
  assistant_name: string;
  avatar_url: string | null;
  bubble_color: string;
  bubble_text: string;
  accent_color: string;
  greeting_message: string;
  greeting_delay_seconds: number;
  recommend_button_text: string;
  preference_question: string;
  preference_options: string[];
  photo_upload_message: string;
  num_recommendations: number;
  product_scope: string;
  selected_product_ids: string[];
  // Hero popup — see migration 031.
  hero_enabled: boolean;
  hero_eyebrow: string;
  hero_headline: string;
  hero_body: string;
  hero_cta_label: string;
  hero_footer: string;
  hero_sample_label: string;
  hero_position_desktop: HeroPosition;
  hero_trust_items: string[];
  hero_show_delay_seconds: number;
  hero_sample_count: number;
  // Hero color override (migration 037). NULL/empty → fall back to accent_color.
  hero_accent_color: string | null;
  // Hero panel colors (migration 038). background NULL → tint of the accent;
  // text NULL → default dark headline.
  hero_background_color: string | null;
  hero_text_color: string | null;
  // Bot message sent right after the hero CTA opens the chat, before the
  // first recommendation question (migration 038). Empty → skipped.
  opening_message: string;
  // Merchant-supplied hero sample images (migration 037). When non-empty, the
  // hero shows these instead of the auto color swatches.
  hero_sample_images: string[];
  // Header status state-machine copy (migration 033). header_done_status
  // supports the {count} token, replaced at render time with the number
  // of recommendations returned.
  header_idle_status: string;
  header_working_status: string;
  header_done_status: string;
  // Loading-hero copy (migration 033). loading_steps must be an array of
  // 3 short strings; the widget ticks through them on a 2.5s timer.
  loading_caption: string;
  loading_steps: string[];
  // End-of-flow copy (migration 034). intro is the bot message above the
  // cards; save/restart are the two footer buttons; footer is the small
  // "Curated by …" line. All support {count} + {assistant_name} tokens.
  recommendations_intro: string;
  end_save_label: string;
  end_restart_label: string;
  end_footer: string;
  // Bundle card (migration 036). bundle_title supports {count}; bundle_button
  // supports {count} + {total}. title_font: 'serif' | 'sans' for the product
  // and bundle card headings.
  bundle_enabled: boolean;
  bundle_title: string;
  bundle_subtext: string;
  bundle_button: string;
  title_font: string;
}

const CHAT_ASSISTANT_DEFAULTS: ChatAssistantConfig = {
  enabled: false,
  assistant_name: 'Laura',
  avatar_url: null,
  bubble_color: '#1f2937',
  bubble_text: 'Try on a shade',
  accent_color: '#8b5cf6',
  greeting_message: "Hey I'm Laura, your shopping assistant ✨",
  greeting_delay_seconds: 2,
  recommend_button_text: 'Find my perfect shade',
  preference_question: 'What kind of look are you going for?',
  preference_options: ['Natural', 'Bold', 'Glossy', 'Surprise me'],
  photo_upload_message: "Take a photo or upload one and I'll show you what looks best on you!",
  num_recommendations: 3,
  product_scope: 'all_configured',
  selected_product_ids: [],
  hero_enabled: false,
  hero_eyebrow: 'Personal consultation',
  hero_headline: 'Three shades, made for you.',
  hero_body: "Take a photo and I'll match shades to your skin tone — and show you exactly how each looks.",
  hero_cta_label: 'Start your consultation',
  hero_footer: '— {assistant_name}, your AI shade advisor —',
  hero_sample_label: 'Sample result preview',
  hero_position_desktop: 'top_right',
  hero_trust_items: ['60 sec', 'Processed instantly', 'Never stored'],
  hero_show_delay_seconds: 1,
  hero_sample_count: 3,
  hero_accent_color: null,
  hero_background_color: null,
  hero_text_color: null,
  opening_message: "Let's find your perfect match! Just a few quick questions first.",
  hero_sample_images: [],
  header_idle_status: 'Your AI assistant',
  header_working_status: 'Working on it…',
  header_done_status: 'Your {count} perfect picks',
  loading_caption: 'Working on your recommendations…',
  loading_steps: ['Analyzing your photo', 'Personalizing results', 'Visualizing your picks'],
  recommendations_intro: 'Here are your {count} perfect picks:',
  end_save_label: 'Save these',
  end_restart_label: 'Try another look',
  end_footer: '— Curated by {assistant_name}, your AI shade advisor —',
  bundle_enabled: true,
  bundle_title: 'Love all {count}?',
  bundle_subtext: 'Add your full match set in one tap.',
  bundle_button: 'Add all {count} to bag · {total}',
  title_font: 'serif',
};

export async function getChatAssistantConfig(shopDomain: string): Promise<ChatAssistantConfig> {
  const { data, error } = await supabase
    .from('chat_assistant_config')
    .select('*')
    .eq('shop_domain', shopDomain)
    .single();

  if (error || !data) {
    return { ...CHAT_ASSISTANT_DEFAULTS };
  }

  return {
    enabled: data.enabled ?? CHAT_ASSISTANT_DEFAULTS.enabled,
    assistant_name: data.assistant_name ?? CHAT_ASSISTANT_DEFAULTS.assistant_name,
    avatar_url: data.avatar_url ?? CHAT_ASSISTANT_DEFAULTS.avatar_url,
    bubble_color: data.bubble_color ?? CHAT_ASSISTANT_DEFAULTS.bubble_color,
    bubble_text: data.bubble_text ?? CHAT_ASSISTANT_DEFAULTS.bubble_text,
    accent_color: data.accent_color ?? CHAT_ASSISTANT_DEFAULTS.accent_color,
    greeting_message: data.greeting_message ?? CHAT_ASSISTANT_DEFAULTS.greeting_message,
    greeting_delay_seconds: data.greeting_delay_seconds ?? CHAT_ASSISTANT_DEFAULTS.greeting_delay_seconds,
    recommend_button_text: data.recommend_button_text ?? CHAT_ASSISTANT_DEFAULTS.recommend_button_text,
    preference_question: data.preference_question ?? CHAT_ASSISTANT_DEFAULTS.preference_question,
    preference_options: data.preference_options ?? CHAT_ASSISTANT_DEFAULTS.preference_options,
    photo_upload_message: data.photo_upload_message ?? CHAT_ASSISTANT_DEFAULTS.photo_upload_message,
    num_recommendations: data.num_recommendations ?? CHAT_ASSISTANT_DEFAULTS.num_recommendations,
    product_scope: data.product_scope ?? CHAT_ASSISTANT_DEFAULTS.product_scope,
    selected_product_ids: data.selected_product_ids ?? CHAT_ASSISTANT_DEFAULTS.selected_product_ids,
    hero_enabled: data.hero_enabled ?? CHAT_ASSISTANT_DEFAULTS.hero_enabled,
    hero_eyebrow: data.hero_eyebrow ?? CHAT_ASSISTANT_DEFAULTS.hero_eyebrow,
    hero_headline: data.hero_headline ?? CHAT_ASSISTANT_DEFAULTS.hero_headline,
    hero_body: data.hero_body ?? CHAT_ASSISTANT_DEFAULTS.hero_body,
    hero_cta_label: data.hero_cta_label ?? CHAT_ASSISTANT_DEFAULTS.hero_cta_label,
    hero_footer: data.hero_footer ?? CHAT_ASSISTANT_DEFAULTS.hero_footer,
    hero_sample_label: data.hero_sample_label ?? CHAT_ASSISTANT_DEFAULTS.hero_sample_label,
    hero_position_desktop:
      (data.hero_position_desktop as HeroPosition | undefined) ?? CHAT_ASSISTANT_DEFAULTS.hero_position_desktop,
    hero_trust_items: data.hero_trust_items ?? CHAT_ASSISTANT_DEFAULTS.hero_trust_items,
    hero_show_delay_seconds: data.hero_show_delay_seconds ?? CHAT_ASSISTANT_DEFAULTS.hero_show_delay_seconds,
    hero_sample_count: data.hero_sample_count ?? CHAT_ASSISTANT_DEFAULTS.hero_sample_count,
    hero_accent_color: data.hero_accent_color ?? CHAT_ASSISTANT_DEFAULTS.hero_accent_color,
    hero_background_color: data.hero_background_color ?? CHAT_ASSISTANT_DEFAULTS.hero_background_color,
    hero_text_color: data.hero_text_color ?? CHAT_ASSISTANT_DEFAULTS.hero_text_color,
    opening_message: data.opening_message ?? CHAT_ASSISTANT_DEFAULTS.opening_message,
    hero_sample_images: Array.isArray(data.hero_sample_images) ? data.hero_sample_images : CHAT_ASSISTANT_DEFAULTS.hero_sample_images,
    header_idle_status: data.header_idle_status ?? CHAT_ASSISTANT_DEFAULTS.header_idle_status,
    header_working_status: data.header_working_status ?? CHAT_ASSISTANT_DEFAULTS.header_working_status,
    header_done_status: data.header_done_status ?? CHAT_ASSISTANT_DEFAULTS.header_done_status,
    loading_caption: data.loading_caption ?? CHAT_ASSISTANT_DEFAULTS.loading_caption,
    loading_steps: Array.isArray(data.loading_steps) ? data.loading_steps : CHAT_ASSISTANT_DEFAULTS.loading_steps,
    recommendations_intro: data.recommendations_intro ?? CHAT_ASSISTANT_DEFAULTS.recommendations_intro,
    end_save_label: data.end_save_label ?? CHAT_ASSISTANT_DEFAULTS.end_save_label,
    end_restart_label: data.end_restart_label ?? CHAT_ASSISTANT_DEFAULTS.end_restart_label,
    end_footer: data.end_footer ?? CHAT_ASSISTANT_DEFAULTS.end_footer,
    bundle_enabled: data.bundle_enabled ?? CHAT_ASSISTANT_DEFAULTS.bundle_enabled,
    bundle_title: data.bundle_title ?? CHAT_ASSISTANT_DEFAULTS.bundle_title,
    bundle_subtext: data.bundle_subtext ?? CHAT_ASSISTANT_DEFAULTS.bundle_subtext,
    bundle_button: data.bundle_button ?? CHAT_ASSISTANT_DEFAULTS.bundle_button,
    title_font: data.title_font ?? CHAT_ASSISTANT_DEFAULTS.title_font,
  };
}

export async function saveChatAssistantConfig(
  shopDomain: string,
  config: Partial<ChatAssistantConfig>
): Promise<void> {
  const { error } = await supabase
    .from('chat_assistant_config')
    .upsert(
      {
        shop_domain: shopDomain,
        ...config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_domain' }
    );

  if (error) {
    console.error(`Error saving chat assistant config for ${shopDomain}:`, error);
  }
}

export async function getAllChatAssistantConfigs(): Promise<
  Array<{ shop_domain: string } & ChatAssistantConfig>
> {
  const { data, error } = await supabase
    .from('chat_assistant_config')
    .select('*')
    .order('shop_domain');

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    shop_domain: row.shop_domain,
    enabled: row.enabled ?? false,
    assistant_name: row.assistant_name ?? CHAT_ASSISTANT_DEFAULTS.assistant_name,
    avatar_url: row.avatar_url,
    bubble_color: row.bubble_color ?? CHAT_ASSISTANT_DEFAULTS.bubble_color,
    bubble_text: row.bubble_text ?? CHAT_ASSISTANT_DEFAULTS.bubble_text,
    accent_color: row.accent_color ?? CHAT_ASSISTANT_DEFAULTS.accent_color,
    greeting_message: row.greeting_message ?? CHAT_ASSISTANT_DEFAULTS.greeting_message,
    greeting_delay_seconds: row.greeting_delay_seconds ?? CHAT_ASSISTANT_DEFAULTS.greeting_delay_seconds,
    recommend_button_text: row.recommend_button_text ?? CHAT_ASSISTANT_DEFAULTS.recommend_button_text,
    preference_question: row.preference_question ?? CHAT_ASSISTANT_DEFAULTS.preference_question,
    preference_options: row.preference_options ?? CHAT_ASSISTANT_DEFAULTS.preference_options,
    photo_upload_message: row.photo_upload_message ?? CHAT_ASSISTANT_DEFAULTS.photo_upload_message,
    num_recommendations: row.num_recommendations ?? CHAT_ASSISTANT_DEFAULTS.num_recommendations,
    product_scope: row.product_scope ?? CHAT_ASSISTANT_DEFAULTS.product_scope,
    selected_product_ids: row.selected_product_ids ?? [],
    hero_enabled: row.hero_enabled ?? CHAT_ASSISTANT_DEFAULTS.hero_enabled,
    hero_eyebrow: row.hero_eyebrow ?? CHAT_ASSISTANT_DEFAULTS.hero_eyebrow,
    hero_headline: row.hero_headline ?? CHAT_ASSISTANT_DEFAULTS.hero_headline,
    hero_body: row.hero_body ?? CHAT_ASSISTANT_DEFAULTS.hero_body,
    hero_cta_label: row.hero_cta_label ?? CHAT_ASSISTANT_DEFAULTS.hero_cta_label,
    hero_footer: row.hero_footer ?? CHAT_ASSISTANT_DEFAULTS.hero_footer,
    hero_sample_label: row.hero_sample_label ?? CHAT_ASSISTANT_DEFAULTS.hero_sample_label,
    hero_position_desktop:
      (row.hero_position_desktop as HeroPosition | undefined) ?? CHAT_ASSISTANT_DEFAULTS.hero_position_desktop,
    hero_trust_items: row.hero_trust_items ?? CHAT_ASSISTANT_DEFAULTS.hero_trust_items,
    hero_show_delay_seconds: row.hero_show_delay_seconds ?? CHAT_ASSISTANT_DEFAULTS.hero_show_delay_seconds,
    hero_sample_count: row.hero_sample_count ?? CHAT_ASSISTANT_DEFAULTS.hero_sample_count,
    hero_accent_color: row.hero_accent_color ?? CHAT_ASSISTANT_DEFAULTS.hero_accent_color,
    hero_background_color: row.hero_background_color ?? CHAT_ASSISTANT_DEFAULTS.hero_background_color,
    hero_text_color: row.hero_text_color ?? CHAT_ASSISTANT_DEFAULTS.hero_text_color,
    opening_message: row.opening_message ?? CHAT_ASSISTANT_DEFAULTS.opening_message,
    hero_sample_images: Array.isArray(row.hero_sample_images) ? row.hero_sample_images : CHAT_ASSISTANT_DEFAULTS.hero_sample_images,
    header_idle_status: row.header_idle_status ?? CHAT_ASSISTANT_DEFAULTS.header_idle_status,
    header_working_status: row.header_working_status ?? CHAT_ASSISTANT_DEFAULTS.header_working_status,
    header_done_status: row.header_done_status ?? CHAT_ASSISTANT_DEFAULTS.header_done_status,
    loading_caption: row.loading_caption ?? CHAT_ASSISTANT_DEFAULTS.loading_caption,
    loading_steps: Array.isArray(row.loading_steps) ? row.loading_steps : CHAT_ASSISTANT_DEFAULTS.loading_steps,
    recommendations_intro: row.recommendations_intro ?? CHAT_ASSISTANT_DEFAULTS.recommendations_intro,
    end_save_label: row.end_save_label ?? CHAT_ASSISTANT_DEFAULTS.end_save_label,
    end_restart_label: row.end_restart_label ?? CHAT_ASSISTANT_DEFAULTS.end_restart_label,
    end_footer: row.end_footer ?? CHAT_ASSISTANT_DEFAULTS.end_footer,
    bundle_enabled: row.bundle_enabled ?? CHAT_ASSISTANT_DEFAULTS.bundle_enabled,
    bundle_title: row.bundle_title ?? CHAT_ASSISTANT_DEFAULTS.bundle_title,
    bundle_subtext: row.bundle_subtext ?? CHAT_ASSISTANT_DEFAULTS.bundle_subtext,
    bundle_button: row.bundle_button ?? CHAT_ASSISTANT_DEFAULTS.bundle_button,
    title_font: row.title_font ?? CHAT_ASSISTANT_DEFAULTS.title_font,
  }));
}

/**
 * Returns a small, deterministic-per-day sample of variants to render as
 * "look at what you'd get" swatches in the hero popup. Sources from the
 * shop's configured product_variants — limited to ones that have a
 * display_color set (those render cleanly as solid color tiles).
 *
 * If the shop's chat config restricts recommendations to a specific product
 * set (product_scope='selected'), we honor that here so the hero preview
 * doesn't tease a swatch that would never actually appear in the
 * recommendation flow.
 *
 * Why deterministic per day: stable swatches across page loads feel more
 * intentional than a different random trio every navigation, but rotating
 * daily keeps the hero from looking stale and lets merchants implicitly
 * showcase more of their catalog over time.
 *
 * Pass `shopId` directly (the resolved internal id from findShopByDomain)
 * to avoid a second domain-lookup round-trip when the caller already did
 * the auth check.
 */
export async function getHeroSwatches(
  shopId: string,
  limit: number,
  options?: {
    productScope?: string;
    selectedProductIds?: string[];
    // Raises the clamp ceiling above the hero's 4-tile default — the chat
    // loading ribbon reuses this fetch and wants a fuller set.
    max?: number;
  },
): Promise<Array<{ label: string; color: string | null; productHandle: string | null }>> {
  const maxLimit = Math.max(4, Math.min(12, options?.max ?? 4));
  const safeLimit = Math.max(2, Math.min(maxLimit, Math.floor(limit) || 3));

  let query = supabase
    .from('product_variants')
    .select(`
      variant_title,
      display_color,
      products!inner ( shop_id, product_name )
    `)
    .eq('products.shop_id', shopId)
    .not('display_color', 'is', null)
    .order('created_at', { ascending: true })
    .limit(40);

  if (options?.productScope === 'selected' && Array.isArray(options.selectedProductIds)) {
    if (options.selectedProductIds.length === 0) {
      // No selected products → recommendations would return nothing, so the
      // hero shouldn't tease swatches that can't be delivered.
      return [];
    }
    query = query.in('product_id', options.selectedProductIds);
  }

  const { data, error } = await query;

  if (error || !data || data.length === 0) {
    return [];
  }

  // Daily rotation: shift the window by absolute day-index so a single shop
  // with >limit variants shows different ones across days but the same ones
  // to any visitor on a given day. Using UTC day-index (not "day of year")
  // so the rotation flips at the same moment globally instead of drifting
  // by the server's local timezone.
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const offset = data.length > safeLimit ? dayIndex % data.length : 0;
  const rotated = data.slice(offset).concat(data.slice(0, offset));

  return rotated.slice(0, safeLimit).map((v: any) => ({
    label: (v.variant_title as string) || (v.products?.product_name as string) || '',
    color: (v.display_color as string | null) ?? null,
    productHandle: null,
  }));
}

// =====================================================================
// RECOMMENDATION MATRIX (migration 032)
// =====================================================================

/**
 * Shape returned to the chat widget so it can drive the multi-question flow.
 * Only includes axes the shopper interacts with directly (user_question);
 * photo-sourced axes are filled in server-side during recommendation lookup.
 */
export interface RecommendationFlow {
  questions: Array<{
    axisKey: string;
    prompt: string;
    options: Array<{
      label: string;
      axisValue: string;
      botResponse: string | null;
    }>;
  }>;
  photoAxes: string[];
  configured: boolean;
}

export async function getRecommendationFlow(shopId: string): Promise<RecommendationFlow> {
  // Single query fetches axes + their values + (for user_question axes)
  // the question prompt + its options. Postgres handles the joins; we
  // shape the response in code.
  const { data: axes, error } = await supabase
    .from('recommendation_axes')
    .select(`
      id,
      key,
      label,
      source,
      position,
      created_at,
      recommendation_axis_values ( id, value, label, position ),
      recommendation_questions (
        id,
        prompt,
        position,
        recommendation_question_options (
          id,
          label,
          axis_value_id,
          bot_response,
          position
        )
      )
    `)
    .eq('shop_id', shopId)
    // created_at as a secondary tiebreaker keeps ordering deterministic
    // even when two axes share the same `position` value (which the
    // schema doesn't prevent).
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error || !axes) {
    return { questions: [], photoAxes: [], configured: false };
  }

  // Build a value-id → axis-key.value map so options can echo back the
  // axis value the widget should record.
  const valueIdToKey = new Map<string, string>();
  for (const axis of axes) {
    for (const v of (axis.recommendation_axis_values || [])) {
      valueIdToKey.set(v.id as string, v.value as string);
    }
  }

  const questions = axes
    .filter((a: any) => a.source === 'user_question' && a.recommendation_questions)
    .flatMap((a: any) => {
      const q = Array.isArray(a.recommendation_questions)
        ? a.recommendation_questions[0]
        : a.recommendation_questions;
      if (!q) return [];
      const options = (q.recommendation_question_options || [])
        .slice()
        .sort((x: any, y: any) => (x.position ?? 0) - (y.position ?? 0))
        .map((opt: any) => ({
          label: opt.label as string,
          axisValue: valueIdToKey.get(opt.axis_value_id as string) ?? '',
          botResponse: (opt.bot_response as string | null) ?? null,
        }))
        .filter((opt: any) => opt.axisValue);
      // Drop questions whose options were all invalidated by deleted axis
      // values — the widget would otherwise render the prompt with no
      // buttons and the shopper would be stranded.
      if (options.length === 0) return [];
      return [{
        axisKey: a.key as string,
        prompt: q.prompt as string,
        options,
      }];
    });

  const photoAxes = axes
    .filter((a: any) => a.source === 'photo')
    .map((a: any) => a.key as string);

  return {
    questions,
    photoAxes,
    configured: axes.length > 0 && (questions.length > 0 || photoAxes.length > 0),
  };
}

/**
 * Strict matrix lookup. Returns the variants assigned to a criteria
 * combination in rank order, or null when the matrix is sparse (no rule
 * for this combination). Callers fall back to AI-pick on null.
 *
 * `criteria` should already be normalized (axis_key → axis_value), e.g.
 * { depth: 'fair', undertone: 'warm' }. JSONB equality matches the
 * stored criteria column.
 */
export async function pickVariantsByCriteria(
  shopId: string,
  criteria: Record<string, string>,
): Promise<Array<{ variantInternalId: string | null; productInternalId: string | null; rank: number }> | null> {
  if (Object.keys(criteria).length === 0) return null;

  // The filter value must be a JSON STRING: supabase-js stringifies a raw
  // object as "[object Object]", which Postgres rejects with "invalid input
  // syntax for type json" — making every lookup silently miss. JSONB
  // equality itself is key-order independent, so no client-side key sort
  // is needed.
  const { data, error } = await supabase
    .from('recommendation_rules')
    .select('variant_id, product_id, rank')
    .eq('shop_id', shopId)
    .eq('criteria', JSON.stringify(criteria))
    .order('rank', { ascending: true });

  if (error) {
    console.error('pickVariantsByCriteria error:', error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  // Each hit targets either a variant or a whole product (DB XOR check). The
  // caller resolves whichever is set against the in-scope candidate pool.
  return data.map((r: any) => ({
    variantInternalId: (r.variant_id as string | null) ?? null,
    productInternalId: (r.product_id as string | null) ?? null,
    rank: r.rank as number,
  }));
}

/**
 * Photo-sourced axes with their allowed values, for server-side selfie
 * classification in chat-recommend. Rules store criteria across ALL axes,
 * so any photo axis missing from the runtime criteria makes the strict
 * equality lookup unmatchable — chat-recommend uses this list to fill
 * those axes from the photo before the lookup.
 */
export async function getPhotoAxes(
  shopId: string,
): Promise<Array<{ key: string; label: string; values: Array<{ value: string; label: string }> }>> {
  const { data, error } = await supabase
    .from('recommendation_axes')
    .select('key, label, recommendation_axis_values ( value, label, position )')
    .eq('shop_id', shopId)
    .eq('source', 'photo')
    .order('position', { ascending: true });

  if (error || !data) {
    if (error) console.error('getPhotoAxes error', error);
    return [];
  }

  return data.map((a: any) => ({
    key: a.key as string,
    label: a.label as string,
    values: ((a.recommendation_axis_values || []) as any[])
      .slice()
      .sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
      .map((v) => ({ value: v.value as string, label: v.label as string })),
  }));
}

// =====================================================================
// RECOMMENDATION MATRIX — ADMIN
// =====================================================================
// Helpers used by the merchant-facing matrix editor. Separate from
// getRecommendationFlow (which is the storefront-facing view that strips
// IDs and only returns user-facing copy).

export interface AdminAxisValue {
  id: string;
  value: string;
  label: string;
  position: number;
}

export interface AdminAxis {
  id: string;
  key: string;
  label: string;
  source: 'photo' | 'user_question';
  position: number;
  values: AdminAxisValue[];
}

export interface AdminQuestionOption {
  id: string;
  label: string;
  axisValueId: string;
  botResponse: string | null;
  position: number;
}

export interface AdminQuestion {
  id: string;
  axisId: string;
  prompt: string;
  options: AdminQuestionOption[];
}

export interface AdminRule {
  id: string;
  criteria: Record<string, string>;
  // Exactly one of variantId / productId is set (DB XOR check). variantId =
  // a specific shade; productId = a whole product with no variant.
  variantId: string | null;
  productId: string | null;
  rank: number;
}

export interface AdminRecommendationConfig {
  axes: AdminAxis[];
  questions: AdminQuestion[];
  rules: AdminRule[];
}

/**
 * Single fetch of every matrix-related row for a shop, shaped for the
 * admin editor. The editor expects positions sorted ascending; rules are
 * ordered by criteria-json then rank so the UI can group them into cells.
 */
export async function getRecommendationAdminConfig(
  shopId: string,
): Promise<AdminRecommendationConfig> {
  // Axes come first: their ids scope the questions query, and an empty
  // .in() list is a PostgREST error on some versions — skip the query
  // entirely when the shop has no axes.
  const [axesRes, rulesRes] = await Promise.all([
    supabase
      .from('recommendation_axes')
      .select('id, key, label, source, position, recommendation_axis_values ( id, value, label, position )')
      .eq('shop_id', shopId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('recommendation_rules')
      .select('id, criteria, variant_id, product_id, rank')
      .eq('shop_id', shopId)
      .order('rank', { ascending: true }),
  ]);

  const axisIds = (axesRes.data || []).map((a: any) => a.id as string);
  const questionsRes = axisIds.length > 0
    ? await supabase
        .from('recommendation_questions')
        .select('id, axis_id, prompt, recommendation_question_options ( id, label, axis_value_id, bot_response, position )')
        .in('axis_id', axisIds)
    : { data: [], error: null };

  if (axesRes.error) console.error('admin axes fetch error', axesRes.error);
  if (questionsRes.error) console.error('admin questions fetch error', questionsRes.error);
  if (rulesRes.error) console.error('admin rules fetch error', rulesRes.error);

  const axes: AdminAxis[] = (axesRes.data || []).map((a: any) => ({
    id: a.id,
    key: a.key,
    label: a.label,
    source: a.source,
    position: a.position ?? 0,
    values: ((a.recommendation_axis_values || []) as any[])
      .slice()
      .sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
      .map((v) => ({
        id: v.id,
        value: v.value,
        label: v.label,
        position: v.position ?? 0,
      })),
  }));

  const questions: AdminQuestion[] = (questionsRes.data || []).map((q: any) => ({
    id: q.id,
    axisId: q.axis_id,
    prompt: q.prompt,
    options: ((q.recommendation_question_options || []) as any[])
      .slice()
      .sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
      .map((opt) => ({
        id: opt.id,
        label: opt.label,
        axisValueId: opt.axis_value_id,
        botResponse: opt.bot_response,
        position: opt.position ?? 0,
      })),
  }));

  const rules: AdminRule[] = (rulesRes.data || []).map((r: any) => ({
    id: r.id,
    criteria: r.criteria as Record<string, string>,
    variantId: (r.variant_id as string | null) ?? null,
    productId: (r.product_id as string | null) ?? null,
    rank: r.rank,
  }));

  return { axes, questions, rules };
}

/**
 * Flat target list for the matrix editor's cell pickers. Returns a
 * whole-product entry for EVERY configured product, PLUS one entry per
 * configured variant (shade) for products that have them — so a merchant can
 * assign either the whole product or a specific shade. Each entry carries an
 * encoded `value`:
 *   - "v:<product_variants.id>"  → a specific shade
 *   - "p:<products.id>"          → the whole product
 * The editor stores this `value` as the rule target and the save path
 * decodes it back into variant_id / product_id. Labels read like
 * "Coral Crush — Orly Nail Lacquer" (variant) or "Orly Nail Lacquer
 * (whole product)".
 */
export async function getShopVariantsFlat(
  shopId: string,
): Promise<Array<{
  value: string;
  id: string;
  kind: 'variant' | 'product';
  label: string;
  productName: string;
  variantTitle: string;
  displayColor: string | null;
}>> {
  const [variantsRes, productsRes] = await Promise.all([
    supabase
      .from('product_variants')
      .select('id, product_id, variant_title, display_color, products!inner ( id, shop_id, product_name )')
      .eq('products.shop_id', shopId)
      .order('created_at', { ascending: true }),
    // NOTE: do NOT .order('created_at') here — the products table may not have
    // that column, and a bad ORDER BY makes the whole query error out, which
    // silently drops every product from the picker (you'd see only variants).
    // Final ordering is done in JS below by product_name.
    supabase
      .from('products')
      .select('id, product_name')
      .eq('shop_id', shopId),
  ]);

  if (variantsRes.error) console.error('getShopVariantsFlat variants error', variantsRes.error);
  if (productsRes.error) console.error('getShopVariantsFlat products error', productsRes.error);

  const productsWithVariants = new Set<string>();
  const variantEntries = (variantsRes.data || []).map((v: any) => {
    productsWithVariants.add(v.product_id as string);
    const productName = (v.products?.product_name as string) || '';
    const variantTitle = (v.variant_title as string) || '';
    const label = variantTitle ? `${productName} — ${variantTitle}` : productName;
    return {
      value: `v:${v.id}`,
      id: v.id as string,
      kind: 'variant' as const,
      label,
      productName,
      variantTitle,
      displayColor: (v.display_color as string | null) ?? null,
    };
  });

  // Every configured product is selectable as a whole-product target — not
  // just variant-less ones. Products that also have configured shades show
  // both: the whole product AND each shade (the editor groups them together).
  const productEntries = (productsRes.data || []).map((p: any) => {
    const productName = (p.product_name as string) || '';
    const hasVariants = productsWithVariants.has(p.id as string);
    return {
      value: `p:${p.id}`,
      id: p.id as string,
      kind: 'product' as const,
      // Only tag "(whole product)" when there are shades to contrast against;
      // for a product with no shades, the bare name is clearer.
      label: productName
        ? (hasVariants ? `${productName} (whole product)` : productName)
        : '(whole product)',
      productName,
      variantTitle: '',
      displayColor: null as string | null,
    };
  });

  // Group by product name so a product and its shades sit together; the
  // whole-product entry sorts before any of its variants (rare to have both).
  const all = [...variantEntries, ...productEntries];
  all.sort((a, b) => {
    if (a.productName !== b.productName) return a.productName.localeCompare(b.productName);
    if (a.kind !== b.kind) return a.kind === 'product' ? -1 : 1;
    return a.variantTitle.localeCompare(b.variantTitle);
  });
  return all;
}

/**
 * Wipe-and-rewrite save for the entire recommendation config, executed
 * atomically by the save_recommendation_config Postgres function
 * (migration 039). A constraint failure mid-rewrite rolls the whole
 * transaction back, so the previous config survives a bad save — unlike
 * the old row-by-row PostgREST version, which destroyed it.
 *
 * Validation here mirrors the DB constraints so merchants get a friendly
 * message instead of a raw constraint error. Concurrent edits from two
 * admin tabs still race — last write wins.
 */
export async function saveRecommendationConfig(
  shopId: string,
  input: {
    axes: Array<{
      key: string;
      label: string;
      source: 'photo' | 'user_question';
      position: number;
      values: Array<{ value: string; label: string; position: number }>;
    }>;
    questions: Array<{
      axisKey: string;
      prompt: string;
      options: Array<{ label: string; axisValueValue: string; botResponse: string | null; position: number }>;
    }>;
    rules: Array<{
      criteria: Record<string, string>;
      // Exactly one of variantId / productId is set per rule.
      variantId?: string | null;
      productId?: string | null;
      rank: number;
    }>;
  },
): Promise<{ ok: boolean; error?: string }> {
  // Pre-validate against the DB constraints so a bad payload gets a
  // friendly message and never reaches the rewrite at all.
  const ID_RE = /^[a-z_][a-z0-9_]*$/;
  const seenKeys = new Set<string>();
  for (const axis of input.axes || []) {
    if (!ID_RE.test(axis.key)) {
      return { ok: false, error: `Axis key "${axis.key}" must be lower snake_case` };
    }
    if (seenKeys.has(axis.key)) {
      return { ok: false, error: `Duplicate axis key "${axis.key}" — axis keys must be unique` };
    }
    seenKeys.add(axis.key);
    if (axis.source !== 'photo' && axis.source !== 'user_question') {
      return { ok: false, error: `Axis "${axis.key}" has an invalid source` };
    }
    const seenValues = new Set<string>();
    for (const v of axis.values || []) {
      if (!ID_RE.test(v.value)) {
        return { ok: false, error: `Value "${v.value}" in axis "${axis.key}" must be lower snake_case` };
      }
      if (seenValues.has(v.value)) {
        return { ok: false, error: `Duplicate value "${v.value}" in axis "${axis.key}"` };
      }
      seenValues.add(v.value);
    }
  }
  for (const rule of input.rules || []) {
    if (!(Number(rule.rank) > 0)) {
      return { ok: false, error: 'Rule rank must be a positive number' };
    }
  }

  // Single atomic rewrite — see migration 039. On any constraint failure
  // the transaction rolls back and the previous config is untouched.
  const { error } = await supabase.rpc('save_recommendation_config', {
    p_shop_id: shopId,
    p_payload: input,
  });

  if (error) {
    console.error(`saveRecommendationConfig RPC error for shop ${shopId}:`, error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Delete a reference image from Supabase Storage given its URL
 */
export async function deleteReferenceImage(imageUrl: string) {
  try {
    const url = new URL(imageUrl);
    const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/reference-images\/(.+)/);
    if (!pathMatch) return;

    const storagePath = decodeURIComponent(pathMatch[1]);
    await supabase.storage.from('reference-images').remove([storagePath]);
  } catch (error) {
    console.error('Error deleting reference image:', error);
  }
}
