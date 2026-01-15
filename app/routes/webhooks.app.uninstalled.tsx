import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../lib/supabase.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, session, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    
    // Step 1: Delete Prisma sessions (Shopify auth tokens)
    if (session) {
      await db.session.deleteMany({ where: { shop } });
      console.log(`[Uninstall] Deleted Prisma sessions for ${shop}`);
    }

    // Step 2: Delete all Supabase data (products, variants, analytics, shop)
    // This is idempotent - safe to call multiple times
    const cleanupResult = await deleteShopData(shop);
    
    if (cleanupResult.success) {
      console.log(`[Uninstall] Supabase cleanup completed for ${shop}:`, cleanupResult.deleted);
    } else {
      // Log error but don't fail the webhook - we've done what we can
      console.error(`[Uninstall] Supabase cleanup had issues for ${shop}:`, cleanupResult.error);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook processing error:", error);
    
    // Return 401 for HMAC verification failures as required by Shopify
    if (error instanceof Error && error.message.includes("HMAC")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    // Return 500 for other errors
    return new Response("Internal Server Error", { status: 500 });
  }
};