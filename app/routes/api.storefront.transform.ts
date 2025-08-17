import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { transformImage } from "../lib/gemini.server";
import { supabase } from "../lib/supabase.server";

// CORS headers for cross-origin requests from Shopify stores
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Allow all origins for now
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { 
        status: 405,
        headers: corsHeaders 
      });
    }

    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const productId = formData.get("productId") as string;

    console.log('Storefront API called with productId:', productId);

    if (!imageFile || !productId) {
      return json({ 
        error: "Missing required fields: image and productId" 
      }, { 
        status: 400,
        headers: corsHeaders 
      });
    }

    // Extract shop domain from request - try multiple methods
    const referer = request.headers.get("referer");
    const host = request.headers.get("host");
    const origin = request.headers.get("origin");
    
    let shopDomain = "";
    
    if (referer) {
      const url = new URL(referer);
      shopDomain = url.hostname;
    } else if (origin) {
      const url = new URL(origin);
      shopDomain = url.hostname;
    } else if (host) {
      shopDomain = host;
    }

    console.log('Detected shop domain:', shopDomain);

    if (!shopDomain) {
      return json({ 
        error: "Unable to determine shop domain" 
      }, { 
        status: 400,
        headers: corsHeaders 
      });
    }

    // Find the shop in Supabase
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id')
      .eq('shop_domain', shopDomain)
      .single();

    console.log('Shop lookup result:', { shop, shopError });

    if (!shop) {
      return json({ 
        error: "Shop configuration not found. Please configure products in the app admin first." 
      }, { 
        status: 404,
        headers: corsHeaders 
      });
    }

    // Find the product configuration - try exact match first
    let { data: product, error: productError } = await supabase
      .from('products')
      .select('transformation_prompt')
      .eq('shop_id', shop.id)
      .eq('shopify_id', productId)
      .single();

    console.log('Product lookup (exact match):', { product, productError });

    // If exact match fails, try with just the numeric ID
    if (!product && productId.includes('gid://shopify/Product/')) {
      const numericId = productId.split('/').pop();
      console.log('Trying numeric ID:', numericId);
      
      const { data: productAlt, error: productAltError } = await supabase
        .from('products')
        .select('transformation_prompt, shopify_id')
        .eq('shop_id', shop.id)
        .like('shopify_id', `%${numericId}%`)
        .single();
        
      console.log('Product lookup (numeric match):', { productAlt, productAltError });
      product = productAlt;
    }

    if (!product || !product.transformation_prompt) {
      // List all products for this shop for debugging
      const { data: allProducts } = await supabase
        .from('products')
        .select('shopify_id, product_name')
        .eq('shop_id', shop.id);
      
      console.log('All products for shop:', allProducts);
      console.log('Looking for product ID:', productId);
      
      return json({ 
        error: "Product not configured for transformations. Please configure this product in the app admin first." 
      }, { 
        status: 404,
        headers: corsHeaders 
      });
    }

    console.log('Found product with prompt:', product.transformation_prompt);

    // Validate image file
    const maxSize = 5 * 1024 * 1024; // 5MB for customer uploads
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(imageFile.type)) {
      return json({ 
        error: "Invalid file type. Please upload a JPG, PNG, or WebP image." 
      }, { 
        status: 400,
        headers: corsHeaders 
      });
    }

    if (imageFile.size > maxSize) {
      return json({ 
        error: "Image too large. Please upload an image smaller than 5MB." 
      }, { 
        status: 400,
        headers: corsHeaders 
      });
    }

    console.log('Image validation passed, starting transformation...');

    // Convert image to base64
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // Call Gemini API with the product's transformation prompt
    const result = await transformImage({
      inputImage: base64Image,
      transformationPrompt: product.transformation_prompt,
      mimeType: imageFile.type,
    });

    console.log('Gemini API result:', { success: result.success, error: result.error });

    if (!result.success) {
      return json({ 
        error: result.error || "Image transformation failed" 
      }, { 
        status: 500,
        headers: corsHeaders 
      });
    }

    // Track analytics (optional - for future implementation)
    try {
      await supabase
        .from('analytics')
        .insert([{
          shop_id: shop.id,
          product_id: productId,
          event_type: 'transformation',
          created_at: new Date().toISOString()
        }]);
    } catch (analyticsError) {
      // Don't fail the request if analytics fails
      console.warn('Analytics tracking failed:', analyticsError);
    }

    console.log('Transformation successful!');

    return json({
      success: true,
      generatedImage: result.generatedImage,
    }, {
      headers: corsHeaders
    });

  } catch (error) {
    console.error("Error in storefront transform API:", error);
    return json({ 
      error: "Internal server error" 
    }, { 
      status: 500,
      headers: corsHeaders 
    });
  }
}; 