-- Rollback for migration 092. Deploy app code without these settings first.
ALTER TABLE chat_assistant_config
  DROP COLUMN IF EXISTS quiz_ui_text,
  DROP COLUMN IF EXISTS quiz_body_weight,
  DROP COLUMN IF EXISTS quiz_body_color,
  DROP COLUMN IF EXISTS quiz_results_primary_cta,
  DROP COLUMN IF EXISTS quiz_results_secondary_link,
  DROP COLUMN IF EXISTS quiz_product_why;
