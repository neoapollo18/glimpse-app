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

// Helper functions for product configurations
export async function getConfiguredProducts(shopDomain: string) {
  const { data: shop } = await supabase
    .from('shops')
    .select('id')
    .eq('shop_domain', shopDomain)
    .single();

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
  
  const { data: shop } = await supabase
    .from('shops')
    .select('id')
    .eq('shop_domain', shopDomain)
    .single();

  if (!shop) {
    console.log('Shop not found for domain:', shopDomain);
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
  eventType: string = 'transformation'
) {
  try {
    // Get shop
    const { data: shop } = await supabase
      .from('shops')
      .select('id')
      .eq('shop_domain', shopDomain)
      .single();

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
              event_type: eventType
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
        event_type: eventType
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
    // Get shop
    const { data: shop } = await supabase
      .from('shops')
      .select('id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!shop) {
      console.log('Shop not found for analytics:', shopDomain);
      return null;
    }

    // Calculate date threshold
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysBack);

    // Get total transformations in the last N days
    const { data: totalEvents, error: totalError } = await supabase
      .from('analytics_events')
      .select('id')
      .eq('shop_id', shop.id)
      .eq('event_type', 'transformation')
      .gte('created_at', dateThreshold.toISOString());

    if (totalError) {
      console.error('Error fetching total analytics:', totalError);
      return null;
    }

    // Get per-product analytics in the last N days
    const { data: productEvents, error: productError } = await supabase
      .from('analytics_events')
      .select(`
        product_id,
        products (
          id,
          product_name,
          shopify_id
        )
      `)
      .eq('shop_id', shop.id)
      .eq('event_type', 'transformation')
      .gte('created_at', dateThreshold.toISOString());

    if (productError) {
      console.error('Error fetching product analytics:', productError);
      return null;
    }

    // Group by product
    const productStats = productEvents.reduce((acc: any, event: any) => {
      const productId = event.product_id;
      if (!acc[productId]) {
        acc[productId] = {
          product_id: productId,
          product_name: event.products?.product_name || 'Unknown Product',
          shopify_id: event.products?.shopify_id || '',
          transformations: 0
        };
      }
      acc[productId].transformations++;
      return acc;
    }, {});

    return {
      totalTransformations: totalEvents?.length || 0,
      productBreakdown: Object.values(productStats)
    };
  } catch (error) {
    console.error('Error in getAnalytics:', error);
    return null;
  }
} 