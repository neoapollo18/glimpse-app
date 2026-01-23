/**
 * Pricing Tiers Configuration
 * 
 * Shared between client and server code.
 * Session-based pricing tiers for the billing system.
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
