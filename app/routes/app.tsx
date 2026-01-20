import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useNavigate, useLocation } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useEffect } from "react";

import { authenticate } from "../shopify.server";
import { identifyAndGetCustomer } from "../lib/mantle.server";
import { isShopGrandfathered } from "../lib/supabase.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // First, authenticate - this MUST complete before anything else
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const accessToken = session.accessToken || "";

  // Check if we're already on the billing page
  const url = new URL(request.url);
  const isOnBillingPage = url.pathname.includes('/app/billing');

  let needsBilling = false;

  // Only check subscription status if NOT on billing page
  if (!isOnBillingPage) {
    try {
      // First check if shop is grandfathered (existing user with data)
      const grandfathered = await isShopGrandfathered(shopDomain);
      
      if (grandfathered) {
        // Grandfathered users get free access
        console.log('✅ Shop is grandfathered, allowing access:', shopDomain);
      } else {
        // Not grandfathered - check if they have an active subscription
        try {
          const { customer } = await identifyAndGetCustomer(shopDomain, accessToken);
          const hasActiveSubscription = customer?.subscription?.active === true;
          
          if (!hasActiveSubscription) {
            // Not grandfathered AND no active subscription → need billing
            console.log('🚫 Billing gate: User needs billing:', shopDomain);
            needsBilling = true;
          }
        } catch (mantleError) {
          // If Mantle fails, let users through (don't block if billing service is down)
          console.error('Mantle error (allowing access):', mantleError);
        }
      }
    } catch (error) {
      // If grandfathered check fails, let users through
      console.error('Grandfathered check error (allowing access):', error);
    }
  }

  return json({ 
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    intercomAppId: process.env.INTERCOM_APP_ID || "",
    needsBilling,
  });
};

export default function App() {
  const { apiKey, shop, intercomAppId, needsBilling } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();

  // Client-side redirect to billing if needed
  useEffect(() => {
    if (needsBilling && !location.pathname.includes('/app/billing')) {
      console.log('🚫 Client-side redirect to billing');
      navigate('/app/billing');
    }
  }, [needsBilling, location.pathname, navigate]);

  // Initialize Intercom on client-side
  useEffect(() => {
    if (intercomAppId && typeof window !== 'undefined') {
      import('@intercom/messenger-js-sdk').then(({ default: Intercom }) => {
        Intercom({
          app_id: intercomAppId,
          user_id: shop,           // Use shop domain as unique ID
          name: shop,              // Shop name
          email: undefined,        // We don't have merchant email
          created_at: undefined,   // We don't track this
        });
      });
    }
  }, [intercomAppId, shop]);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/widgets">Widgets</Link>
        <Link to="/app/products">Products</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/billing">Billing</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
