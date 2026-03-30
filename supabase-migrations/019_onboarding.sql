-- Migration: Add onboarding wizard columns to shops table
-- Tracks merchant onboarding progress, goals, and attribution

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS onboarding_goals TEXT[] DEFAULT '{}';

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS onboarding_attribution TEXT[] DEFAULT '{}';

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN shops.onboarding_step IS 'Current onboarding wizard step (0=not started, 1-6=in progress)';
COMMENT ON COLUMN shops.onboarding_completed IS 'Whether merchant has completed the onboarding flow';
COMMENT ON COLUMN shops.onboarding_goals IS 'Selected goal identifiers from onboarding step 2';
COMMENT ON COLUMN shops.onboarding_attribution IS 'Selected attribution sources from onboarding step 3';
COMMENT ON COLUMN shops.onboarding_completed_at IS 'Timestamp when onboarding was completed';
