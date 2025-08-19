import OpenAI from "openai";
import sharp from "sharp";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ImageTransformationRequest {
  inputImage: string; // base64 encoded image
  transformationPrompt: string;
  mimeType: string;
}

interface ImageTransformationResponse {
  success: boolean;
  generatedImage?: string; // base64 encoded image
  error?: string;
}

// Compress image to ~320p for faster processing and lower costs
async function compressImage(base64Image: string, mimeType: string): Promise<{
  compressedBase64: string;
  compressedMimeType: string;
  originalSize: number;
  compressedSize: number;
}> {
  try {
    // Convert base64 to buffer
    const inputBuffer = Buffer.from(base64Image, 'base64');
    const originalSize = inputBuffer.length;
    
    // Use Sharp to resize image to max 320px on the larger dimension
    const compressedBuffer = await sharp(inputBuffer)
      .resize({
        width: 320,
        height: 320,
        fit: 'inside', // Maintain aspect ratio, fit within 320x320
        withoutEnlargement: true // Don't upscale small images
      })
      .jpeg({ 
        quality: 85, // High quality JPEG compression
        progressive: true 
      })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;
    
    return {
      compressedBase64: compressedBuffer.toString('base64'),
      compressedMimeType: 'image/jpeg', // Always output as JPEG for consistency
      originalSize,
      compressedSize
    };
  } catch (error) {
    console.error('Image compression failed:', error);
    // If compression fails, return original image
    return {
      compressedBase64: base64Image,
      compressedMimeType: mimeType,
      originalSize: Buffer.from(base64Image, 'base64').length,
      compressedSize: Buffer.from(base64Image, 'base64').length
    };
  }
}

// AI image transformation function
export async function transformImage(
  request: ImageTransformationRequest
): Promise<ImageTransformationResponse> {
  try {
    const {
      compressedBase64,
      compressedMimeType,
    } = await compressImage(request.inputImage, request.mimeType);
    
    // Convert compressed base64 to Buffer for OpenAI API
    const imageBuffer = Buffer.from(compressedBase64, 'base64');
    
    // Create a File-like object from the compressed buffer
    const imageFile = new File([imageBuffer], 'image', { 
      type: compressedMimeType 
    });
    
    const prompt = `Product transformation description: "${request.transformationPrompt}". Edit this person's photo based on the product description so that it looks natural and realistic. Keep their facial features, hair, skin color, eye color, identity, and background the same. Apply subtle changes based EXACTLY on the product transformation description. Make the effect accurate but not exaggerated. AVOID anything that looks artificial, over-smoothed, cartoonish, or fake. Output ONLY the edited image based on ONLY the product description.`;

    const response = await client.images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt: prompt,
      background: "opaque",
      input_fidelity: "high",
      quality: "low",
      size: "1024x1024",
    });

    // Check if response exists and has data
    if (!response || !response.data || response.data.length === 0) {
      throw new Error('No response generated from OpenAI API');
    }

    const result = response.data[0];
    if (!result || !result.b64_json) {
      throw new Error('Invalid response structure from OpenAI API');
    }

    return {
      success: true,
      generatedImage: result.b64_json
    };

  } catch (error) {
    console.error('Error in transformImage:', error);
    
    // Handle specific OpenAI errors
    if (error instanceof OpenAI.APIError) {
      console.error('OpenAI API Error:', {
        status: error.status,
        message: error.message,
        code: error.code,
        type: error.type
      });
      
      // Provide more user-friendly error messages
      let userMessage = 'AI transformation failed. Please try again.';
      
      if (error.status === 400) {
        if (error.message?.includes('image')) {
          userMessage = 'The uploaded image could not be processed. Please try a different image.';
        } else if (error.message?.includes('prompt')) {
          userMessage = 'The transformation prompt is invalid. Please contact support.';
        }
      } else if (error.status === 429) {
        userMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (error.status >= 500) {
        userMessage = 'AI service is temporarily unavailable. Please try again later.';
      }
      
      return {
        success: false,
        error: userMessage
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}
