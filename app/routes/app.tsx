import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useEffect } from "react";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return { 
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    intercomAppId: process.env.INTERCOM_APP_ID || "",
  };
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
