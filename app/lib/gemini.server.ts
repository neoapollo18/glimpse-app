import { GoogleGenAI, Modality } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

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

export async function transformImage(
  request: ImageTransformationRequest
): Promise<ImageTransformationResponse> {
  try {
    // Prepare the content parts
    const contents = [
        { 
            text: `${request.transformationPrompt}\n\nPlease transform the uploaded image according to this description. Maintain the person's facial features and overall appearance while applying the specified transformation naturally and realistically.`,
        },
        {
            inlineData: {
                mimeType: request.mimeType,
                data: request.inputImage,
            },
        },
    ];

    // Generate content with image output
    const response = await ai.models.generateContent({
        model: "gemini-2.0-flash-preview-image-generation",
        contents: contents,
        config: {
            responseModalities: [Modality.TEXT, Modality.IMAGE],
        },
    });

    // Check if response exists and has candidates
    if (!response || !response.candidates || response.candidates.length === 0) {
      throw new Error('No response generated from Gemini API');
    }

    const candidate = response.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts) {
      throw new Error('Invalid response structure from Gemini API');
    }

    // Look for image data in the response
    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        return {
          success: true,
          generatedImage: part.inlineData.data
        };
      }
    }

    // If no image found, check if there's text explaining why
    const textParts = candidate.content.parts.filter((part: any) => part.text);
    if (textParts.length > 0) {
      console.log('Gemini response text:', textParts.map((p: any) => p.text).join(' '));
    }

    throw new Error('No image generated in response');

  } catch (error) {
    console.error('Error in transformImage:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// Helper function to convert File to base64
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper function to validate image file
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload a JPEG, PNG, or WebP image.'
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'File too large. Please upload an image smaller than 10MB.'
    };
  }

  return { valid: true };
} 