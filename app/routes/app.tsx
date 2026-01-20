import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
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
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const accessToken = session.accessToken || "";

  // Check if we're already on the billing page to avoid redirect loops
  const url = new URL(request.url);
  const isOnBillingPage = url.pathname.includes('/app/billing');

  // Only check subscription/grandfathered status if NOT on billing page
  if (!isOnBillingPage) {
    try {
      // Check if shop is grandfathered (existing user with data)
      const grandfathered = await isShopGrandfathered(shopDomain);
      
      if (!grandfathered) {
        // Not grandfathered, check if they have an active subscription
        const { customer } = await identifyAndGetCustomer(shopDomain, accessToken);
        const hasActiveSubscription = customer?.subscription?.active === true;
        
        if (!hasActiveSubscription) {
          // Not grandfathered AND no active subscription → redirect to billing
          console.log('🚫 Billing gate: Redirecting to billing (not grandfathered, no subscription)');
          return redirect('/app/billing');
        }
      }
    } catch (error) {
      // If Mantle fails, check grandfathered status only
      // Don't block users if billing service is down
      console.error('Error checking subscription status:', error);
      const grandfathered = await isShopGrandfathered(shopDomain);
      if (!grandfathered) {
        return redirect('/app/billing');
      }
    }
  }

  return json({ 
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    intercomAppId: process.env.INTERCOM_APP_ID || "",
  });
};

export default function App() {
  const { apiKey, shop, intercomAppId } = useLoaderData<typeof loader>();

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
