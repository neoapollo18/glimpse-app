import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { uploadReferenceImage, saveProductReferenceImage, deleteReferenceImage } from "../lib/supabase.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const action = formData.get("action") as string;
  const productId = formData.get("productId") as string;

  if (!productId) {
    return json({ error: "Missing productId" }, { status: 400 });
  }

  if (action === "remove") {
    const currentUrl = formData.get("currentUrl") as string;
    if (currentUrl) {
      await deleteReferenceImage(currentUrl);
    }
    await saveProductReferenceImage(productId, null);
    return json({ success: true, referenceImageUrl: null });
  }

  const imageFile = formData.get("image") as File;
  if (!imageFile) {
    return json({ error: "Missing image file" }, { status: 400 });
  }

  const maxSize = 10 * 1024 * 1024; // 10MB
  if (imageFile.size > maxSize) {
    return json({ error: "File too large. Max 10MB." }, { status: 400 });
  }

  if (!imageFile.type.startsWith("image/")) {
    return json({ error: "Please upload an image file." }, { status: 400 });
  }

  try {
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const publicUrl = await uploadReferenceImage(
      session.shop,
      productId,
      buffer,
      imageFile.name,
      imageFile.type
    );

    await saveProductReferenceImage(productId, publicUrl);

    return json({ success: true, referenceImageUrl: publicUrl });
  } catch (error) {
    console.error("Error uploading reference image:", error);
    return json({ error: "Failed to upload image" }, { status: 500 });
  }
};
