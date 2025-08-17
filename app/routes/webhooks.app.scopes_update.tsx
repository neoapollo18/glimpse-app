import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    // Since we're using Supabase instead of Prisma for our main data,
    // and session management is handled by Shopify's session storage,
    // we don't need to update anything here for our use case.
    // The session scope updates are handled automatically by Shopify.
    
    return new Response();
};
