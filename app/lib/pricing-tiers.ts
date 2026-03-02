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
  { name: 'Free', min: 0, max: 2500, price: 0, visitors: '0-2.5k sessions' },
  { name: 'Starter', min: 2501, max: 5000, price: 30, visitors: '2.5k-5k sessions' },
  { name: 'Launch', min: 5001, max: 25000, price: 149, visitors: '5k-25k sessions' },
  { name: 'Growth', min: 25001, max: Infinity, price: 399, visitors: '25k+ sessions' },
];
