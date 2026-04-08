import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { uploadAvatarImage } from "../lib/supabase.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const imageFile = formData.get("image") as File;

  if (!imageFile) {
    return json({ error: "Missing image file" }, { status: 400 });
  }

  if (imageFile.size > 2 * 1024 * 1024) {
    return json({ error: "File too large. Max 2MB." }, { status: 400 });
  }

  if (!imageFile.type.startsWith("image/")) {
    return json({ error: "Please upload an image file." }, { status: 400 });
  }

  try {
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const publicUrl = await uploadAvatarImage(
      session.shop,
      buffer,
      imageFile.name,
      imageFile.type
    );

    return json({ success: true, avatarUrl: publicUrl });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    return json({ error: "Upload failed" }, { status: 500 });
  }
};
