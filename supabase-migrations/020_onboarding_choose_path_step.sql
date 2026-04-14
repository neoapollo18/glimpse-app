-- Migration 020: shift onboarding steps for the new "Choose path" screen
--
-- A new step 4 ("self-serve vs. book a call") was inserted between the
-- attribution survey (step 3) and product setup (previously step 4).
-- Total steps went from 6 to 7. Merchants mid-flow need their stored
-- onboarding_step bumped by 1 so they land on the same screen they left.
-- Completed merchants are untouched.

UPDATE shops
SET onboarding_step = onboarding_step + 1
WHERE onboarding_completed = false
  AND onboarding_step >= 4;

COMMENT ON COLUMN shops.onboarding_step IS 'Current onboarding wizard step (0=not started, 1-7=in progress)';
