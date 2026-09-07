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
    
    if (!cleanupResult.success) {
      // deleteShopData returns success:false specifically so the webhook can
      // retry (it's idempotent, and the "shop never existed" case reports
      // success). Return 500 so Shopify redelivers instead of leaking the
      // partially-deleted shop data behind a 200.
      console.error(`[Uninstall] Supabase cleanup failed for ${shop}:`, cleanupResult.error);
      return new Response("Cleanup failed", { status: 500 });
    }

    console.log(`[Uninstall] Supabase cleanup completed for ${shop}:`, cleanupResult.deleted);
    return new Response("OK", { status: 200 });
  } catch (error) {
    // authenticate.webhook throws a Response (401) on HMAC verification
    // failure; it MUST propagate so Shopify sees the 401.
    if (error instanceof Response) throw error;
    console.error("Webhook processing error:", error);
    
    // Return 401 for HMAC verification failures as required by Shopify
    if (error instanceof Error && error.message.includes("HMAC")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    // Return 500 for other errors
    return new Response("Internal Server Error", { status: 500 });
  }
};