import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { supabase } from "../lib/supabase.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Clean up shop data from Supabase when app is uninstalled
  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  if (shop) {
    try {
      // Delete the shop and all related data (cascading delete should handle products, etc.)
      const { error } = await supabase
        .from('shops')
        .delete()
        .eq('shop_domain', shop);

      if (error) {
        console.error('Error cleaning up shop data:', error);
      } else {
        console.log(`Successfully cleaned up data for shop: ${shop}`);
      }
    } catch (error) {
      console.error('Failed to clean up shop data:', error);
    }
  }

  return new Response();
};
