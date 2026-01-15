import { createClient } from '@supabase/supabase-js';

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

// Helper function to auto-register alternate domain (fire-and-forget)
async function autoRegisterAlternateDomain(shopId: string, alternateDomain: string) {
  try {
    // Use raw SQL to append to array only if not already present
    const { error } = await supabase.rpc('add_alternate_domain', {
      p_shop_id: shopId,
      p_domain: alternateDomain
    });
    
    if (error) {
      // Fallback: try direct update if RPC doesn't exist yet
      const { data: currentShop } = await supabase
        .from('shops')
        .select('alternate_domains')
        .eq('id', shopId)
        .single();
      
      const currentDomains = currentShop?.alternate_domains || [];
      if (!currentDomains.includes(alternateDomain)) {
        await supabase
          .from('shops')
          .update({ alternate_domains: [...currentDomains, alternateDomain] })
          .eq('id', shopId);
        console.log('✅ Auto-registered alternate domain:', alternateDomain);
      }
    } else {
      console.log('✅ Auto-registered alternate domain via RPC:', alternateDomain);
    }
  } catch (err) {
    // Non-critical, log but don't throw
    console.error('Failed to auto-register alternate domain:', err);
  }
}

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
    .single();

  if (error) {
    console.error('Error fetching product configuration:', error);
    
    // Also try searching with just the numeric part in case it's stored differently
    if (shopifyId.includes('/')) {
      const numericId = shopifyId.split('/').pop();
      console.log('Trying with numeric ID:', numericId);
      
      const { data: altProduct, error: altError } = await supabase
        .from('products')
        .select('*')
        .eq('shop_id', shop.id)
        .eq('shopify_id', numericId)
        .single();
        
      if (!altError && altProduct) {
        console.log('Found product with numeric ID');
        return altProduct;
      }

    }
    
    return null;
  }

  console.log('Found product:', product);
  return product;
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

// Analytics functions
export async function trackTransformationEvent(
  shopDomain: string,
  shopifyProductId: string,
  eventType: string = 'transformation',
  widgetType: string = 'unknown'
) {
  try {
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
              widget_type: widgetType
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
        widget_type: widgetType
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

    // Get total transformations (selfie uploads) in the last N days
    const { data: transformationEvents, error: transformationError } = await supabase
      .from('analytics_events')
      .select('id')
      .eq('shop_id', shop.id)
      .eq('event_type', 'transformation')
      .gte('created_at', dateThreshold.toISOString());

    if (transformationError) {
      console.error('Error fetching transformation analytics:', transformationError);
      return null;
    }

    // Get widget views in the last N days
    const { data: widgetViewEvents, error: viewError } = await supabase
      .from('analytics_events')
      .select('id')
      .eq('shop_id', shop.id)
      .eq('event_type', 'widget_view')
      .gte('created_at', dateThreshold.toISOString());

    if (viewError) {
      console.error('Error fetching widget view analytics:', viewError);
      // Don't fail entirely, just set to 0
    }

    // Get add-to-cart events in the last N days
    const { data: atcEvents, error: atcError } = await supabase
      .from('analytics_events')
      .select('id')
      .eq('shop_id', shop.id)
      .eq('event_type', 'add_to_cart')
      .gte('created_at', dateThreshold.toISOString());

    if (atcError) {
      console.error('Error fetching ATC analytics:', atcError);
      // Don't fail entirely, just set to 0
    }

    // Get per-product analytics in the last N days (including widget_type)
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
      .gte('created_at', dateThreshold.toISOString());

    if (productError) {
      console.error('Error fetching product analytics:', productError);
      return null;
    }

    // Group by product and widget_type (only count transformations for the main number)
    const productStats = productEvents
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
    productEvents
      .filter((e: any) => e.event_type === 'widget_view')
      .forEach((event: any) => {
        const productId = event.product_id;
        if (productStats[productId]) {
          productStats[productId].views++;
        }
      });

    // Add ATC counts per product
    productEvents
      .filter((e: any) => e.event_type === 'add_to_cart')
      .forEach((event: any) => {
        const productId = event.product_id;
        if (productStats[productId]) {
          productStats[productId].addToCarts++;
        }
      });

    const totalUploads = transformationEvents?.length || 0;
    const totalViews = widgetViewEvents?.length || 0;
    const totalATC = atcEvents?.length || 0;
    
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
  transformationPrompt: string
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
      // Update existing variant configuration
      const { data, error } = await supabase
        .from('product_variants')
        .update({
          variant_title: variantTitle,
          transformation_prompt: transformationPrompt,
          updated_at: new Date().toISOString()
        })
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
        transformation_prompt: transformationPrompt
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
