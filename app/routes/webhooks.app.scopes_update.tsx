import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    try {
        const { payload, session, topic, shop } = await authenticate.webhook(request);
        console.log(`Received ${topic} webhook for ${shop}`);

        const current = payload.current as string[];
        if (session) {
            await db.session.update({   
                where: {
                    id: session.id
                },
                data: {
                    scope: current.toString(),
                },
            });
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