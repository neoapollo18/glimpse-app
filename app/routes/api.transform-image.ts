import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { transformImage } from "../lib/ai.server";
import { trackTransformationEvent } from "../lib/supabase.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { checkRateLimits, RATE_LIMITS } from "../lib/rate-limiter.server";

// The longest stored product prompt in production is ~5.7k chars; anything
// far past that is not a product prompt.
const MAX_PROMPT_CHARS = 20_000;

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Authenticate the request
    const { session } = await authenticate.admin(request);

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    // Resource routes never run app.tsx's loader, so its billing gate does
    // not cover them; without this an unsubscribed shop can drive paid work.
    if (await shopNeedsBilling(session.shop, session.accessToken ?? "")) {
      return json({
        error: "Your Gleame subscription isn't active. Visit Billing to continue."
      }, { status: 402 });
    }

    // Each call is a paid image generation. Checked before the body is read
    // so a blocked loop costs nothing; atomic across both windows (see
    // checkRateLimits).
    const limit = checkRateLimits([
      {
        key: `admin-transform:shop:${session.shop}:hour`,
        limit: RATE_LIMITS.ADMIN_TRANSFORM_PER_SHOP_HOUR.limit,
        windowMs: RATE_LIMITS.ADMIN_TRANSFORM_PER_SHOP_HOUR.windowMs,
      },
      {
        key: `admin-transform:shop:${session.shop}:day`,
        limit: RATE_LIMITS.ADMIN_TRANSFORM_PER_SHOP_DAY.limit,
        windowMs: RATE_LIMITS.ADMIN_TRANSFORM_PER_SHOP_DAY.windowMs,
      },
    ]);
    if (!limit.allowed) {
      return json({
        error: "Too many test transformations. Please try again later."
      }, { status: 429, headers: { "Retry-After": limit.retryAfterSeconds.toString() } });
    }

    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    // A file part under this name is not a prompt (and has no length to cap).
    const rawPrompt = formData.get("transformationPrompt");
    const transformationPrompt = typeof rawPrompt === "string" ? rawPrompt : "";
    const productId = formData.get("productId") as string; // Optional for admin testing

    if (!imageFile || !transformationPrompt) {
      return json({ 
        error: "Missing required fields: image and transformationPrompt" 
      }, { status: 400 });
    }

    if (transformationPrompt.length > MAX_PROMPT_CHARS) {
      return json({
        error: "Transformation prompt is too long."
      }, { status: 400 });
    }

    // Validate image file
    const maxSize = 10 * 1024 * 1024; // 10MB

    // Helper function to check if file is a valid image (including HEIC/HEIF)
    const isValidImageFile = (file: File): boolean => {
      // Standard image MIME type check
      if (file.type.startsWith('image/')) {
        return true;
      }
      // HEIC/HEIF specific MIME types
      const heicMimeTypes = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
      if (heicMimeTypes.includes(file.type.toLowerCase())) {
        return true;
      }
      // Fallback: check by file extension for unrecognized MIME types (common with HEIC on some browsers)
      if (!file.type || file.type === '' || file.type === 'application/octet-stream') {
        const ext = file.name?.toLowerCase().split('.').pop();
        const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif'];
        return validExtensions.includes(ext || '');
      }
      return false;
    };

    // Check if it's actually an image (with HEIC/HEIF support)
    if (!isValidImageFile(imageFile)) {
      return json({ 
        error: "Please upload an image file (JPG, PNG, HEIC, etc.)." 
      }, { status: 400 });
    }

    if (imageFile.size > maxSize) {
      return json({ 
        error: "File too large. Please upload an image smaller than 10MB." 
      }, { status: 400 });
    }

    // Convert image to base64
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    // Call Gemini API (admin uses default FLASH model)
    const result = await transformImage({
      inputImage: base64Image,
      transformationPrompt: transformationPrompt,
      mimeType: imageFile.type,
    });

    if (!result.success) {
      return json({ 
        error: result.error || "Image transformation failed" 
      }, { status: 500 });
    }

    // Track analytics event for admin transformations if productId is provided
    if (productId && session?.shop) {
      trackTransformationEvent(session.shop, productId, 'admin_transformation').catch(error => {
        console.error('Failed to track admin analytics event:', error);
      });
    }

    return json({
      success: true,
      generatedImage: result.generatedImage,
    });

  } catch (error) {
    console.error("Error in transform-image API:", error);
    return json({ 
      error: "Internal server error" 
    }, { status: 500 });
  }
}; 