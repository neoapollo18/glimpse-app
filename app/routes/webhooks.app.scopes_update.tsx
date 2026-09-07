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
        // authenticate.webhook throws a Response (401) on HMAC verification
        // failure; it MUST propagate so Shopify sees the 401.
        if (error instanceof Response) throw error;
        console.error("Webhook processing error:", error);

        // Return 500 for other errors
        return new Response("Internal Server Error", { status: 500 });
    }
};