import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useNavigate, useLocation } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Frame, Loading } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useEffect, useState } from "react";
import jwt from "jsonwebtoken";

import { authenticate } from "../shopify.server";
import { identifyAndGetCustomer } from "../lib/mantle.server";
import { isShopGrandfathered, markShopAsGrandfathered } from "../lib/supabase.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // First, authenticate - this MUST complete before anything else
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const accessToken = session.accessToken || "";

  // Get current path to know if we're on billing or welcome page
  const url = new URL(request.url);
  const isOnBillingPage = url.pathname.includes('/app/billing') || url.pathname.includes('/app/welcome');

  let needsBilling = false;

  // Always check subscription status
  try {
    // First check if shop is grandfathered (existing user with data)
    const grandfathered = await isShopGrandfathered(shopDomain);
    
    if (grandfathered) {
      // Grandfathered users get free access
      console.log('✅ Shop is grandfathered, allowing access:', shopDomain);
      // Ensure subscription_status is marked as grandfathered for transform API
      await markShopAsGrandfathered(shopDomain);
    } else {
      // Not grandfathered - check if they have an active subscription or are in grace period
      try {
        const { customer } = await identifyAndGetCustomer(shopDomain, accessToken);
        const subscription = customer?.subscription;
        const hasActiveSubscription = subscription?.active === true;
        
        // Check for grace period: subscription was cancelled but still within billing period
        let isInGracePeriod = false;
        if (!hasActiveSubscription && subscription?.currentPeriodEnd) {
          const periodEnd = new Date(subscription.currentPeriodEnd);
          isInGracePeriod = periodEnd > new Date();
          if (isInGracePeriod) {
            console.log('⏳ Shop in grace period until:', periodEnd.toISOString(), shopDomain);
          }
        }
        
        if (!hasActiveSubscription && !isInGracePeriod) {
          // Not grandfathered AND no active subscription AND not in grace period → need billing
          console.log('🚫 Billing gate: User needs billing:', shopDomain);
          needsBilling = true;
        }
      } catch (mantleError) {
        // Fail closed: if we can't verify subscription, require billing.
        // This prevents free access during Mantle outages.
        // Merchants can still reach /app/welcome and /app/billing to fix their state.
        console.error('Mantle error (requiring billing):', mantleError);
        needsBilling = true;
      }
    }
  } catch (error) {
    // If grandfathered check fails, fail closed — require billing
    console.error('Grandfathered check error (requiring billing):', error);
    needsBilling = true;
  }

  // Generate Intercom JWT for Identity Verification
  const intercomSecretKey = process.env.INTERCOM_SECRET_KEY || "";
  let intercomUserJwt = "";
  if (intercomSecretKey && session.shop) {
    intercomUserJwt = jwt.sign(
      { user_id: session.shop },
      intercomSecretKey,
      { expiresIn: '1h' }
    );
  }

  return json({ 
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    intercomAppId: process.env.INTERCOM_APP_ID || "",
    intercomUserJwt,
    needsBilling,
    isOnBillingPage,
  });
};

export default function App() {
  const { apiKey, shop, intercomAppId, intercomUserJwt, needsBilling } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Determine if we should block content and redirect
  const currentlyOnBillingOrWelcome = location.pathname.includes('/app/billing') || location.pathname.includes('/app/welcome');
  const shouldBlockContent = needsBilling && !currentlyOnBillingOrWelcome;

  // Client-side redirect to welcome page if needed (and not already there)
  useEffect(() => {
    if (shouldBlockContent) {
      setIsRedirecting(true);
      // Small delay to ensure loading state shows
      const timer = setTimeout(() => {
        navigate('/app/welcome', { replace: true });
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setIsRedirecting(false);
    }
  }, [shouldBlockContent, navigate]);

  // Initialize Intercom on client-side with JWT Identity Verification
  useEffect(() => {
    if (intercomAppId && typeof window !== 'undefined') {
      import('@intercom/messenger-js-sdk').then(({ default: Intercom }) => {
        Intercom({
          app_id: intercomAppId,
          intercom_user_jwt: intercomUserJwt || undefined, // JWT for Identity Verification
          name: shop,              // Shop name (non-sensitive, outside JWT)
        });
      });
    }
  }, [intercomAppId, intercomUserJwt, shop]);

  // If user needs billing and is NOT on billing page, show loading instead of content
  // This prevents the "flash" of other pages before redirect
  if (shouldBlockContent || isRedirecting) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <Frame>
          <Loading />
        </Frame>
      </AppProvider>
    );
  }

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {/* Only show navigation menu if user has access (not blocked by billing) */}
      {!needsBilling && (
        <NavMenu>
          <Link to="/app" rel="home">
            Dashboard
          </Link>
          <Link to="/app/widgets">Widgets</Link>
          <Link to="/app/products">Products</Link>
          <Link to="/app/assistant">AI Assistant</Link>
          <Link to="/app/analytics">Analytics</Link>
          <Link to="/app/placeholders">Placeholders</Link>
          <Link to="/app/billing">Billing</Link>
        </NavMenu>
      )}
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
