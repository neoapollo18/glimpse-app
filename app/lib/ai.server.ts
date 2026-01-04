import { GoogleGenAI, Modality } from "@google/genai";
import sharp from "sharp";
import heicConvert from "heic-convert";

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Model constants
export const GEMINI_MODEL_PRO = "gemini-3-pro-image-preview"; // For products with variant configs (makeup)
export const GEMINI_MODEL_FLASH = "gemini-2.5-flash-image";   // For products without variant configs (skincare)

interface ImageTransformationRequest {
  inputImage: string; // base64 encoded image
  transformationPrompt: string;
  mimeType: string;
  model?: string; // Optional: defaults to FLASH model
}

interface ImageTransformationResponse {
  success: boolean;
  generatedImage?: string; // base64 encoded image
  processedInputImage?: string; // base64 encoded converted input (for HEIC display)
  error?: string;
}

// Convert HEIC to JPEG using heic-convert (Sharp doesn't support HEIC on all platforms)
async function convertHeicToJpeg(inputBuffer: Buffer): Promise<Buffer> {
  try {
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.92
    });
    console.log('HEIC converted to JPEG successfully');
    return Buffer.from(new Uint8Array(outputBuffer));
  } catch (error) {
    console.error('HEIC conversion failed:', error);
    throw error;
  }
}

// Check if buffer is HEIC format (check magic bytes)
function isHeicBuffer(buffer: Buffer): boolean {
  // HEIC files have 'ftyp' at offset 4 and 'heic' or 'mif1' shortly after
  if (buffer.length < 12) return false;
  const ftypOffset = buffer.indexOf('ftyp');
  if (ftypOffset === -1) return false;
  const brandArea = buffer.slice(ftypOffset, ftypOffset + 12).toString();
  return brandArea.includes('heic') || brandArea.includes('mif1') || brandArea.includes('heif');
}

// Compress image for faster processing and lower costs
async function compressImage(base64Image: string, mimeType: string): Promise<{
  compressedBase64: string;
  compressedMimeType: string;
  originalSize: number;
  compressedSize: number;
}> {
  try {
    // Convert base64 to buffer
    let inputBuffer: Buffer = Buffer.from(base64Image, 'base64');
    const originalSize = inputBuffer.length;
    
    // Check if it's HEIC and convert first (Sharp doesn't support HEIC on all platforms)
    const isHeic = mimeType?.toLowerCase().includes('heic') || 
                   mimeType?.toLowerCase().includes('heif') ||
                   isHeicBuffer(inputBuffer);
    
    if (isHeic) {
      console.log('Detected HEIC image, converting to JPEG first...');
      inputBuffer = await convertHeicToJpeg(inputBuffer);
    }
    
    // Use Sharp to resize image to max 720px on the larger dimension
    const compressedBuffer = await sharp(inputBuffer)
      .rotate() // Auto-rotate based on EXIF orientation data
      .resize({
        width: 720,
        height: 720,
        fit: 'inside', // Maintain aspect ratio
        withoutEnlargement: true // Don't upscale small images
      })
      .jpeg({ 
        quality: 85, // High quality JPEG compression
        progressive: true 
      })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;
    console.log(`Image compressed: ${originalSize} -> ${compressedSize} bytes`);
    
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

// Call Gemini API with retry logic
async function callGeminiWithRetry(prompt: any[], model: string = GEMINI_MODEL_FLASH, maxRetries: number = 2): Promise<string> {
  let lastError: Error | null = null;
  
  console.log(`Using Gemini model: ${model}`);
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retry attempt ${attempt}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
      }
      
      const response = await client.models.generateContent({
        model: model,
        contents: prompt,
      });

      // Check if response exists and has candidates
      if (!response || !response.candidates || response.candidates.length === 0) {
        throw new Error('No response generated from Gemini API');
      }

      const candidate = response.candidates[0];
      if (!candidate || !candidate.content || !candidate.content.parts) {
        throw new Error('Invalid response structure from Gemini API');
      }

      // Find the image part in the response
      for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return part.inlineData.data;
        }
      }

      throw new Error('No image data found in Gemini API response');
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Gemini API attempt ${attempt + 1} failed:`, lastError.message);
      
      // Don't retry on certain errors
      if (lastError.message.includes('PERMISSION_DENIED') || 
          lastError.message.includes('401') ||
          lastError.message.includes('INVALID_ARGUMENT')) {
        break;
      }
    }
  }
  
  throw lastError || new Error('Gemini API failed after retries');
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
    
    const prompt = [
      { 
        text: request.transformationPrompt
      },
      {
        inlineData: {
          mimeType: compressedMimeType,
          data: compressedBase64
        }
      }
    ]

    // Use specified model or default to FLASH
    const modelToUse = request.model || GEMINI_MODEL_FLASH;
    const generatedImageData = await callGeminiWithRetry(prompt, modelToUse);

    return {
      success: true,
      generatedImage: generatedImageData,
      processedInputImage: compressedBase64 // Return converted input for HEIC display
    };

  } catch (error) {
    console.error('Error in transformImage:', error);
    
    // Handle Gemini API errors
    let userMessage = 'AI transformation failed. Please try again.';
    
    if (error instanceof Error) {
      console.error('Gemini API Error:', {
        message: error.message,
        stack: error.stack
      });
      
      // Provide more user-friendly error messages based on common error patterns
      if (error.message?.includes('RATE_LIMIT') || error.message?.includes('429')) {
        userMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (error.message?.includes('INVALID_ARGUMENT') || error.message?.includes('400')) {
        if (error.message?.includes('image')) {
          userMessage = 'The uploaded image could not be processed. Please try a different image.';
        } else {
          userMessage = 'Invalid request. Please check your input and try again.';
        }
      } else if (error.message?.includes('PERMISSION_DENIED') || error.message?.includes('401')) {
        userMessage = 'Authentication failed. Please check your API configuration.';
      } else if (error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('quota')) {
        userMessage = 'Service quota exceeded. Please try again later.';
      } else if (error.message?.includes('UNAVAILABLE') || error.message?.includes('500')) {
        userMessage = 'AI service is temporarily unavailable. Please try again later.';
      }
    }
    
    return {
      success: false,
      error: userMessage
    };
  }
}
