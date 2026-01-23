/**
 * Plan Matcher Server Utilities
 * 
 * Maps monthly session counts to pricing tiers and helps find corresponding Mantle plans.
 */

export interface SessionTier {
  name: string;
  min: number;
  max: number;
  price: number | null; // null for Enterprise (custom pricing)
  visitors: string; // Display string for UI
}

/**
 * Session-based pricing tiers
 * Pricing is based on monthly session count
 */
export const SESSION_TIERS: SessionTier[] = [
  { name: 'Starter', min: 0, max: 5000, price: 30, visitors: '0-5k sessions' },
  { name: 'Launch', min: 5001, max: 25000, price: 149, visitors: '5k-25k sessions' },
  { name: 'Growth', min: 25001, max: 75000, price: 299, visitors: '25k-75k sessions' },
  { name: 'Scale', min: 75001, max: 150000, price: 499, visitors: '75k-150k sessions' },
  { name: 'Premium', min: 150001, max: 300000, price: 999, visitors: '150k-300k sessions' },
  { name: 'Enterprise', min: 300001, max: Infinity, price: null, visitors: '300k+ sessions' },
];

/**
 * Gets the appropriate plan tier based on session count
 * 
 * @param sessions - The monthly session count
 * @returns The matching tier, defaults to Starter if sessions is 0 or negative
 */
export function getTierForSessions(sessions: number): SessionTier {
  // Default to Starter for invalid or zero sessions
  if (sessions <= 0) {
    return SESSION_TIERS[0];
  }

  for (const tier of SESSION_TIERS) {
    if (sessions >= tier.min && sessions <= tier.max) {
      return tier;
    }
  }

  // If somehow we exceed all tiers, return Enterprise
  return SESSION_TIERS[SESSION_TIERS.length - 1];
}

/**
 * Gets the plan name for a given session count
 * 
 * @param sessions - The monthly session count
 * @returns The plan name (e.g., "Starter", "Launch", etc.)
 */
export function getPlanNameForSessions(sessions: number): string {
  return getTierForSessions(sessions).name;
}

/**
 * Gets the price for a given session count
 * 
 * @param sessions - The monthly session count
 * @returns The monthly price in dollars, or null for Enterprise
 */
export function getPriceForSessions(sessions: number): number | null {
  return getTierForSessions(sessions).price;
}

/**
 * Mantle Plan interface (subset of what Mantle returns)
 */
export interface MantlePlan {
  id: string;
  name: string;
  amount?: number;
  subtotal?: number;
  total?: number;
  currencyCode?: string;
  interval?: string;
  trialDays?: number;
}

/**
 * Finds a Mantle plan by name (case-insensitive)
 * 
 * @param plans - Array of Mantle plans
 * @param name - The plan name to find
 * @returns The matching plan, or undefined if not found
 */
export function findMantlePlanByName(
  plans: MantlePlan[],
  name: string
): MantlePlan | undefined {
  const lowerName = name.toLowerCase();
  return plans.find((plan) => plan.name.toLowerCase() === lowerName);
}

/**
 * Finds a Mantle plan by price (for matching when names don't align)
 * 
 * @param plans - Array of Mantle plans
 * @param price - The price to match
 * @returns The matching plan, or undefined if not found
 */
export function findMantlePlanByPrice(
  plans: MantlePlan[],
  price: number
): MantlePlan | undefined {
  return plans.find((plan) => {
    const planPrice = plan.subtotal ?? plan.amount ?? 0;
    return planPrice === price;
  });
}

/**
 * Gets the best matching Mantle plan for a session count
 * First tries to match by name, then by price
 * 
 * @param plans - Array of Mantle plans
 * @param sessions - The monthly session count
 * @returns The matching Mantle plan, or undefined if not found
 */
export function getMantlePlanForSessions(
  plans: MantlePlan[],
  sessions: number
): MantlePlan | undefined {
  const tier = getTierForSessions(sessions);
  
  // First try to match by name
  let matchedPlan = findMantlePlanByName(plans, tier.name);
  
  // If no match by name and we have a price, try matching by price
  if (!matchedPlan && tier.price !== null) {
    matchedPlan = findMantlePlanByPrice(plans, tier.price);
  }
  
  return matchedPlan;
}

/**
 * Checks if a user's current plan matches their session tier
 * 
 * @param currentPlanName - The name of the user's current plan
 * @param sessions - The user's monthly session count
 * @returns true if the plan matches the tier, false if they need to change
 */
export function isPlanMatchingTier(currentPlanName: string, sessions: number): boolean {
  const expectedTier = getTierForSessions(sessions);
  return currentPlanName.toLowerCase() === expectedTier.name.toLowerCase();
}

/**
 * Gets the suggested plan change info if user's traffic has changed
 * 
 * @param currentPlanName - The name of the user's current plan
 * @param sessions - The user's monthly session count
 * @returns Object with change info, or null if no change needed
 */
export function getPlanChangeInfo(
  currentPlanName: string,
  sessions: number
): { currentPlan: string; suggestedPlan: SessionTier; isUpgrade: boolean } | null {
  const suggestedTier = getTierForSessions(sessions);
  
  if (currentPlanName.toLowerCase() === suggestedTier.name.toLowerCase()) {
    return null; // No change needed
  }
  
  // Determine if this is an upgrade or downgrade
  const currentTierIndex = SESSION_TIERS.findIndex(
    (t) => t.name.toLowerCase() === currentPlanName.toLowerCase()
  );
  const suggestedTierIndex = SESSION_TIERS.findIndex(
    (t) => t.name.toLowerCase() === suggestedTier.name.toLowerCase()
  );
  
  const isUpgrade = suggestedTierIndex > currentTierIndex;
  
  return {
    currentPlan: currentPlanName,
    suggestedPlan: suggestedTier,
    isUpgrade,
  };
}
