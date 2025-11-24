// ============================================
// VARIANT SUPPORT FUNCTIONS (Phase 2)
// Add these to the END of supabase.server.ts after line 402
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

