import { GoogleGenAI, Modality } from "@google/genai";
import sharp from "sharp";

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
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

// Compress image for faster processing and lower costs
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

    const response = await client.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
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
    let generatedImageData = null;
    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        generatedImageData = part.inlineData.data;
        break;
      }
    }

    if (!generatedImageData) {
      throw new Error('No image data found in Gemini API response');
    }

    return {
      success: true,
      generatedImage: generatedImageData
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
