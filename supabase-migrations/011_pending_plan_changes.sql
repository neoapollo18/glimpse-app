-- Add pending_plan_change column to shops table
-- This stores plan change notifications detected by the bi-weekly cron job

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS pending_plan_change JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN shops.pending_plan_change IS 'Stores pending plan change notification from cron job. Schema: {currentPlan, suggestedPlan, suggestedPlanId, suggestedPrice, sessions, isUpgrade, detectedAt}';

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_shops_pending_plan_change 
ON shops ((pending_plan_change IS NOT NULL)) 
WHERE pending_plan_change IS NOT NULL;
