import { MantleClient } from "@heymantle/client";

// Initialize Mantle client with API key (server-side)
export function getMantleClient() {
  return new MantleClient({
    appId: process.env.MANTLE_APP_ID!,
    apiKey: process.env.MANTLE_API_KEY!,
  });
}

// Initialize Mantle client with customer token (for customer-specific operations)
export function getCustomerClient(customerApiToken: string) {
  return new MantleClient({
    appId: process.env.MANTLE_APP_ID!,
    customerApiToken: customerApiToken,
  });
}

/**
 * Identify a customer in Mantle and get their API token
 * Then fetch the customer details with plans and subscription
 */
export async function identifyAndGetCustomer(shopDomain: string, accessToken: string) {
  const appId = process.env.MANTLE_APP_ID;
  const apiKey = process.env.MANTLE_API_KEY;
  
  if (!appId || !apiKey) {
    throw new Error("Missing MANTLE_APP_ID or MANTLE_API_KEY environment variables");
  }
  
  const client = getMantleClient();

  // Identify the customer to get their API token. Mantle occasionally
  // returns a non-JSON 500 (the client library then throws a JSON parse
  // SyntaxError like `Unexpected token 'I', "Internal S"...`); a bad or
  // stale accessToken can also trip their Shopify-details fetch. So:
  // attempt WITH the token, then retry WITHOUT it (identify doesn't
  // strictly need it), and translate parse garbage into a readable error.
  const identify = async (withToken: boolean) => {
    const identifyParams: {
      platform: "shopify";
      myshopifyDomain: string;
      accessToken?: string;
    } = {
      platform: "shopify",
      myshopifyDomain: shopDomain,
    };
    if (withToken && accessToken) identifyParams.accessToken = accessToken;
    const result = await client.identify(identifyParams);
    if ("error" in result) {
      const errorResult = result as { error: string; details?: string };
      throw new Error(`${errorResult.error}${errorResult.details ? `: ${errorResult.details}` : ''}`);
    }
    return result.apiToken;
  };

  let apiToken: string;
  try {
    apiToken = await identify(Boolean(accessToken));
  } catch (first) {
    console.error(`Mantle identify failed for ${shopDomain} (retrying without accessToken):`, first);
    try {
      apiToken = await identify(false);
    } catch (second) {
      const msg = second instanceof Error ? second.message : String(second);
      // JSON-parse garbage means Mantle's API itself errored — say that
      // instead of leaking "Unexpected token 'I'..." to the merchant.
      throw new Error(
        /unexpected token|not valid json/i.test(msg)
          ? "Our billing provider is having a moment. Wait a few seconds and hit Try again."
          : msg,
      );
    }
  }
  
  // Now get the customer details using the API token
  const customerClient = getCustomerClient(apiToken);
  let customerResult;
  try {
    customerResult = await customerClient.getCustomer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      /unexpected token|not valid json/i.test(msg)
        ? "Our billing provider is having a moment. Wait a few seconds and hit Try again."
        : msg,
    );
  }

  if ("error" in customerResult) {
    throw new Error(customerResult.error);
  }
  
  return {
    customer: customerResult,
    apiToken: apiToken,
  };
}

/**
 * Subscribe a customer to a plan
 */
export async function subscribeCustomer(
  customerApiToken: string, 
  planId: string, 
  returnUrl: string
) {
  const client = getCustomerClient(customerApiToken);
  
  const result = await client.subscribe({
    planId: planId,
    returnUrl: returnUrl,
  });
  
  if ("error" in result) {
    throw new Error(result.error);
  }
  
  return result;
}

/**
 * Cancel a customer's subscription
 */
export async function cancelSubscription(customerApiToken: string) {
  const client = getCustomerClient(customerApiToken);
  
  const result = await client.cancelSubscription();
  
  if ("error" in result) {
    throw new Error(result.error);
  }
  
  return result;
}

/**
 * Send a usage event to Mantle for flex billing
 * This is used to report session counts for automatic tier upgrades
 */
export async function sendUsageEvent(
  customerApiToken: string,
  eventName: string,
  properties: Record<string, number | string>
) {
  const client = getCustomerClient(customerApiToken);
  
  const result = await client.sendUsageEvent({
    eventName,
    properties,
  });
  
  if (result && "error" in result) {
    throw new Error(result.error);
  }
  
  return result;
}

/**
 * Check if a customer has an active paid subscription
 */
export function hasActiveSubscription(customer: { subscription?: { active: boolean } }): boolean {
  return customer.subscription?.active === true;
}

/**
 * Check if a customer is on a specific plan
 */
export function isOnPlan(customer: { subscription?: { plan?: { name: string } } }, planName: string): boolean {
  return customer.subscription?.plan?.name?.toLowerCase() === planName.toLowerCase();
}

