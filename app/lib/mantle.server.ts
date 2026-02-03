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
  
  // First identify the customer to get their API token
  // Try without accessToken first - Mantle may not need it for basic identify
  const identifyParams: {
    platform: "shopify";
    myshopifyDomain: string;
    accessToken?: string;
  } = {
    platform: "shopify",
    myshopifyDomain: shopDomain,
  };
  
  // Include accessToken if provided (allows Mantle to fetch shop details)
  if (accessToken) {
    identifyParams.accessToken = accessToken;
  }
  
  const identifyResult = await client.identify(identifyParams);
  
  // Check if it's an error
  if ("error" in identifyResult) {
    const errorResult = identifyResult as { error: string; details?: string };
    throw new Error(`${errorResult.error}${errorResult.details ? `: ${errorResult.details}` : ''}`);
  }
  
  const apiToken = identifyResult.apiToken;
  
  // Now get the customer details using the API token
  const customerClient = getCustomerClient(apiToken);
  const customerResult = await customerClient.getCustomer();
  
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

