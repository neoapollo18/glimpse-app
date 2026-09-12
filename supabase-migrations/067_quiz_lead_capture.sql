-- Migration 067: quiz email/SMS lead capture
--
-- Optional "leave your email" step in the quiz flow (between the last
-- question and the photo gate). Shoppers can submit an email and/or phone
-- number, or skip — the step never blocks results. Leads are stored per
-- shop with a snapshot of the shopper's quiz answers and surfaced in the
-- admin Analytics page.
--
-- Two groups of changes:
--   1. quiz_leads — the captured leads themselves.
--   2. chat_assistant_config — merchant toggle + copy for the lead step.
--      Copy defaults live in code (getChatAssistantConfig), matching the
--      convention for every other quiz copy field.

-- ==========================================================================
-- quiz_leads
-- ==========================================================================
CREATE TABLE IF NOT EXISTS quiz_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  email text,
  phone text,
  -- [{question, answer}] snapshot of the shopper's answers at submit time
  -- (label text, not axis keys — readable without joining the flow tables,
  -- and stable across later quiz edits).
  quiz_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Same attribution token the funnel events carry, so a lead can later be
  -- joined to a purchase via widget_orders.
  cart_token text,
  device_type text,
  source text NOT NULL DEFAULT 'quiz',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_leads_contact_check CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- One lead per email per shop (case-normalized in the API before insert);
-- resubmits update the existing row (freshest answers win). Phone-only
-- leads dedupe on phone instead.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_leads_shop_email_key
  ON quiz_leads (shop_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quiz_leads_shop_phone_key
  ON quiz_leads (shop_id, phone) WHERE email IS NULL AND phone IS NOT NULL;

-- Analytics reads: newest leads per shop, windowed by capture date.
CREATE INDEX IF NOT EXISTS quiz_leads_shop_created_idx
  ON quiz_leads (shop_id, created_at DESC);

COMMENT ON TABLE quiz_leads IS
  'Email/SMS leads captured by the quiz lead step, with a snapshot of the shopper''s answers.';

-- ==========================================================================
-- chat_assistant_config: lead step toggle + copy
-- ==========================================================================
-- Off by default: existing quizzes are unchanged until a merchant opts in.
ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS quiz_lead_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiz_lead_collect_phone boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiz_lead_headline text,
  ADD COLUMN IF NOT EXISTS quiz_lead_body text,
  ADD COLUMN IF NOT EXISTS quiz_lead_button_label text,
  ADD COLUMN IF NOT EXISTS quiz_lead_skip_label text,
  ADD COLUMN IF NOT EXISTS quiz_lead_consent_text text;

COMMENT ON COLUMN chat_assistant_config.quiz_lead_enabled IS
  'When true, the quiz shows an optional email/SMS capture step between the last question and the photo gate.';
COMMENT ON COLUMN chat_assistant_config.quiz_lead_collect_phone IS
  'When true, the lead step also shows an optional phone field (SMS leads).';
