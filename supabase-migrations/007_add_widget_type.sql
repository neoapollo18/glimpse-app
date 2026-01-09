-- Migration: Add widget_type column to analytics_events
-- Purpose: Track which widget type was used for each transformation
-- Date: 2026-01-09

-- Add widget_type column to analytics_events table
ALTER TABLE public.analytics_events
ADD COLUMN IF NOT EXISTS widget_type TEXT DEFAULT 'unknown';

-- Add comment for documentation
COMMENT ON COLUMN public.analytics_events.widget_type IS 'Type of widget used: embedded, horizontal, button, legacy, or unknown';

-- Create index for faster widget_type queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_widget_type 
ON public.analytics_events(widget_type);

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'analytics_events' AND column_name = 'widget_type';
