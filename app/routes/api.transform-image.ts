import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { transformImage } from "../lib/gemini.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Authenticate the request
    await authenticate.admin(request);

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const transformationPrompt = formData.get("transformationPrompt") as string;

    if (!imageFile || !transformationPrompt) {
      return json({ 
        error: "Missing required fields: image and transformationPrompt" 
      }, { status: 400 });
    }

    // Validate image file
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(imageFile.type)) {
      return json({ 
        error: "Invalid file type. Please upload a JPEG, PNG, or WebP image." 
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

    // Call Gemini API
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