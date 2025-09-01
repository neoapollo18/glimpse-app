import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, session, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    // Handle different compliance webhook topics
    switch (topic) {
      case "customers/data_request":
        console.log("Processing customer data request for shop:", shop);
        break;

      case "customers/redact":
        console.log("Processing customer data redaction for shop:", shop);
        break;

      case "shop/redact":
        console.log("Processing shop data redaction for shop:", shop);
        break;

      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }

    // Respond with 200 status to acknowledge receipt
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
