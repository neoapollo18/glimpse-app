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
 *
 * 2026-09-24: the app is FREE at every tier. All prices set to 0, which
 * flows everywhere fee logic lives: shopNeedsBilling() sees fee 0 and never
 * gates, the check-sessions cron sees fee 0 and never posts a usage charge,
 * and the billing page renders $0 rows. To restore paid pricing, put the
 * old prices back here (previously: Starter 30, Launch 149, Growth 399).
 */
export const SESSION_TIERS: SessionTier[] = [
  { name: 'Free', min: 0, max: 2500, price: 0, visitors: '0-2.5k sessions' },
  { name: 'Starter', min: 2501, max: 5000, price: 0, visitors: '2.5k-5k sessions' },
  { name: 'Launch', min: 5001, max: 25000, price: 0, visitors: '5k-25k sessions' },
  { name: 'Growth', min: 25001, max: Infinity, price: 0, visitors: '25k+ sessions' },
];
