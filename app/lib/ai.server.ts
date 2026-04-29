import { GoogleGenAI } from "@google/genai";
import https from "https";
import NodeFormData from "form-data";
import sharp from "sharp";
import heicConvert from "heic-convert";

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Model constants
export const GEMINI_MODEL_PRO = "gemini-3-pro-image-preview";           // Variant configs (makeup)
export const GEMINI_MODEL_FLASH = "gemini-2.5-flash-image";             // Standard (skincare etc)
export const GEMINI_MODEL_FLASH_31 = "gemini-3.1-flash-image-preview";  // New: higher quality, uses 2K input
export const MODEL_OPENAI = "gpt-image-1.5";                            // OpenAI gpt-image-1.5
export const MODEL_OPENAI_2 = "gpt-image-2";                            // OpenAI gpt-image-2 (medium quality)

export const OPENAI_MODELS = new Set<string>([MODEL_OPENAI, MODEL_OPENAI_2]);
export function isOpenAIModel(model: string | null | undefined): boolean {
  return !!model && OPENAI_MODELS.has(model);
}

type OpenAIQuality = 'low' | 'medium' | 'high' | 'auto';
type OpenAISize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto';

const OPENAI_QUALITY_BY_MODEL: Record<string, OpenAIQuality> = {
  [MODEL_OPENAI]: 'high',
  [MODEL_OPENAI_2]: 'medium',
};

interface OpenAIImageEditResponse {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string; type?: string; code?: string };
}

// Max resolution per model (px on longest side)
// OpenAI not listed here — it uses its own compression path in transformImageWithOpenAI
const MODEL_MAX_PX: Record<string, number> = {
  [GEMINI_MODEL_FLASH_31]: 2048,  // 2K for Gemini 3.1
  [GEMINI_MODEL_PRO]: 720,
  [GEMINI_MODEL_FLASH]: 720,
};

export interface ReferenceImagePart {
  data: string; // base64
  mimeType: string;
}

interface ImageTransformationRequest {
  inputImage: string; // base64 encoded image
  transformationPrompt: string;
  mimeType: string;
  model?: string; // Optional: defaults to FLASH model
  /** One or more reference product images (preferred). */
  referenceImages?: ReferenceImagePart[];
  /** @deprecated use referenceImages */
  referenceImage?: string;
  referenceImageMimeType?: string;
}

function resolveReferenceParts(request: ImageTransformationRequest): ReferenceImagePart[] {
  if (request.referenceImages?.length) {
    return request.referenceImages;
  }
  if (request.referenceImage && request.referenceImageMimeType) {
    return [{ data: request.referenceImage, mimeType: request.referenceImageMimeType }];
  }
  return [];
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
async function compressImage(base64Image: string, mimeType: string, maxPx: number = 720): Promise<{
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
    
    // Use Sharp to resize image to maxPx on the larger dimension
    const compressedBuffer = await sharp(inputBuffer)
      .rotate() // Auto-rotate based on EXIF orientation data
      .resize({
        width: maxPx,
        height: maxPx,
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
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))); // Exponential backoff: 1s, 2s, 4s
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

// Gemini-based transformation (default for most products)
export async function transformImage(
  request: ImageTransformationRequest
): Promise<ImageTransformationResponse> {
  try {
    const modelToUse = request.model || GEMINI_MODEL_FLASH;
    const maxPx = MODEL_MAX_PX[modelToUse] ?? 720;
    const {
      compressedBase64,
      compressedMimeType,
    } = await compressImage(request.inputImage, request.mimeType, maxPx);
    console.log(`Image compressed to max ${maxPx}px for model ${modelToUse}`);
    
    const prompt: any[] = [];

    const refParts = resolveReferenceParts(request);
    for (let i = 0; i < refParts.length; i++) {
      const label =
        refParts.length > 1
          ? `Reference product image ${i + 1} of ${refParts.length} (use all for accuracy):`
          : 'Reference product image to apply onto the person:';
      prompt.push({ text: label });
      prompt.push({
        inlineData: {
          mimeType: refParts[i].mimeType,
          data: refParts[i].data,
        },
      });
    }

    prompt.push({ 
      text: request.transformationPrompt
    });
    prompt.push({
      inlineData: {
        mimeType: compressedMimeType,
        data: compressedBase64
      }
    });

    const generatedImageData = await callGeminiWithRetry(prompt, modelToUse);

    return {
      success: true,
      generatedImage: generatedImageData,
      processedInputImage: compressedBase64
    };

  } catch (error) {
    console.error('Error in transformImage:', error);
    
    let userMessage = 'AI transformation failed. Please try again.';
    
    if (error instanceof Error) {
      console.error('Gemini API Error:', {
        message: error.message,
        stack: error.stack
      });
      
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

// Structured OpenAI error so retry/classification logic can inspect status
// code and error type instead of substring-matching the message.
class OpenAIError extends Error {
  statusCode?: number;
  errorType?: string;
  constructor(message: string, opts?: { statusCode?: number; errorType?: string }) {
    super(message);
    this.name = 'OpenAIError';
    this.statusCode = opts?.statusCode;
    this.errorType = opts?.errorType;
  }
}

// Permanent errors — retrying won't change the outcome, so abort the loop.
function isOpenAIPermanentError(err: Error): boolean {
  if (err instanceof OpenAIError) {
    // Any 4xx is a client-side problem; retrying with the same payload won't help.
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) return true;
    if (err.errorType === 'invalid_request_error') return true;
  }
  const m = err.message.toLowerCase();
  // Caught by error.message even when we don't have a status code (network-level failures).
  if (m.includes('must be verified')) return true;
  if (m.includes('content_policy') || m.includes('moderation_blocked')) return true;
  // Timeouts already burned ~120s of the budget; retrying just delays the eventual failure.
  if (m.includes('timed out')) return true;
  // Configuration error — fail fast.
  if (m.includes('not configured')) return true;
  return false;
}

// Direct HTTP call to OpenAI image edit API (bypasses SDK FormData issues in Remix)
function callOpenAIImageEdit(
  images: { buffer: Buffer; filename: string }[],
  prompt: string,
  model: string,
  quality: OpenAIQuality,
  size: OpenAISize,
): Promise<OpenAIImageEditResponse> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      reject(new OpenAIError('OPENAI_API_KEY not configured'));
      return;
    }

    const form = new NodeFormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);

    for (const img of images) {
      form.append('image[]', img.buffer, {
        filename: img.filename,
        contentType: 'image/jpeg',
      });
    }

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/edits',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode;
        try {
          const parsed = JSON.parse(data) as OpenAIImageEditResponse;
          if (status && status >= 400) {
            const msg = parsed.error?.message || `OpenAI API error: ${status}`;
            reject(new OpenAIError(`${msg} (status ${status})`, {
              statusCode: status,
              errorType: parsed.error?.type,
            }));
          } else {
            resolve(parsed);
          }
        } catch {
          // Non-JSON body (HTML error page, partial response, etc.)
          reject(new OpenAIError(
            `Failed to parse OpenAI response: ${data.substring(0, 200)}`,
            { statusCode: status },
          ));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new OpenAIError('OpenAI API request timed out (120s)'));
    });

    form.pipe(req);
  });
}

async function callOpenAIImageEditWithRetry(
  images: { buffer: Buffer; filename: string }[],
  prompt: string,
  model: string,
  quality: OpenAIQuality,
  size: OpenAISize,
  // 1 retry caps worst-case at ~2 × per-request timeout. Combined with the
  // gpt-image-2 → gpt-image-1.5 fallback in the caller, customer-facing
  // ceiling stays under ~4 min on a hung connection.
  maxRetries: number = 1,
): Promise<OpenAIImageEditResponse> {
  let lastError: Error | null = null;
  console.log(`Using OpenAI ${model} (quality=${quality}, size=${size}) with ${images.length} image(s)`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`OpenAI retry ${attempt}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
      return await callOpenAIImageEdit(images, prompt, model, quality, size);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`OpenAI attempt ${attempt + 1} failed:`, lastError.message);
      if (isOpenAIPermanentError(lastError)) break;
    }
  }
  throw lastError || new Error('OpenAI API failed after retries');
}

// OpenAI GPT Image-based transformation (for products with reference images, e.g. wigs)
export async function transformImageWithOpenAI(
  request: ImageTransformationRequest
): Promise<ImageTransformationResponse> {
  try {
    const {
      compressedBase64,
    } = await compressImage(request.inputImage, request.mimeType);

    const images: { buffer: Buffer; filename: string }[] = [
      { buffer: Buffer.from(compressedBase64, 'base64'), filename: 'selfie.jpg' },
    ];

    const refParts = resolveReferenceParts(request);
    for (let i = 0; i < refParts.length; i++) {
      const refCompressed = await compressImage(refParts[i].data, refParts[i].mimeType);
      console.log(
        `Reference image ${i + 1} compressed: ${refCompressed.originalSize} -> ${refCompressed.compressedSize} bytes`
      );
      images.push({
        buffer: Buffer.from(refCompressed.compressedBase64, 'base64'),
        filename: refParts.length > 1 ? `reference${i + 1}.jpg` : 'reference.jpg',
      });
    }

    const openaiModel = isOpenAIModel(request.model) ? (request.model as string) : MODEL_OPENAI;
    const quality = OPENAI_QUALITY_BY_MODEL[openaiModel] ?? 'auto';

    // Wrap the prompt with safety context for OpenAI's content filter.
    // Kept category-agnostic — gpt-image-1.5 / gpt-image-2 are used for wigs,
    // makeup, skincare, and hair products alike.
    const safetyFramedPrompt =
      `[CONTEXT: This is a professional e-commerce virtual try-on tool for beauty, ` +
      `cosmetics, and hair products. The customer has uploaded a headshot to preview how ` +
      `the product would look on them. This is a standard retail product visualization, ` +
      `similar to virtual makeup, eyeglasses, or hair try-on tools.]\n\n` +
      request.transformationPrompt;

    const result = await callOpenAIImageEditWithRetry(
      images,
      safetyFramedPrompt,
      openaiModel,
      quality,
      'auto',
    );

    const imageData = result.data?.[0]?.b64_json;
    if (!imageData) {
      throw new Error('No image data returned from OpenAI');
    }

    return {
      success: true,
      generatedImage: imageData,
      processedInputImage: compressedBase64,
    };

  } catch (error) {
    console.error('Error in transformImageWithOpenAI:', error);

    let userMessage = 'AI transformation failed. Please try again.';

    if (error instanceof Error) {
      console.error('OpenAI API Error:', {
        message: error.message,
        stack: error.stack,
      });

      const msg = error.message.toLowerCase();
      if (msg.includes('must be verified')) {
        userMessage = 'This AI model requires OpenAI organization verification.';
      } else if (msg.includes('rate_limit') || msg.includes('429')) {
        userMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (msg.includes('billing') || msg.includes('quota')) {
        userMessage = 'Service quota exceeded. Please try again later.';
      } else if (msg.includes('invalid_api_key') || msg.includes('401')) {
        userMessage = 'Authentication failed. Please check your API configuration.';
      } else if (msg.includes('content_policy') || msg.includes('moderation_blocked')) {
        userMessage = 'Image was rejected by content moderation. Try a different photo.';
      } else if (msg.includes('timed out')) {
        userMessage = 'AI service timed out. Please try again.';
      }
    }

    return {
      success: false,
      error: userMessage,
    };
  }
}
