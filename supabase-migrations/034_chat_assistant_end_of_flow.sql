-- Migration 034: end-of-flow chat assistant copy
--
-- After the recommendation cards render, the chat goes into a final state
-- that wraps up the conversation: a personalized intro line above the
-- cards, then "Save these" + "Try another look" buttons below them, then
-- a curated-by footer line.
--
-- All four copy fields are configurable per shop with token replacement:
--   {count}          — number of recommendations returned
--   {assistant_name} — name of the assistant (token replaced server-side)
--
-- Bundle CTA + price aggregation were planned here originally but
-- deferred — they need Shopify Admin price fetching infra we don't have
-- yet and the bundle UX needs more thought (custom bundle discount? raw
-- sum? compare-at?).

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS recommendations_intro text NOT NULL DEFAULT
    'Here are your {count} perfect picks:',
  ADD COLUMN IF NOT EXISTS end_save_label text NOT NULL DEFAULT 'Save these',
  ADD COLUMN IF NOT EXISTS end_restart_label text NOT NULL DEFAULT 'Try another look',
  ADD COLUMN IF NOT EXISTS end_footer text NOT NULL DEFAULT
    '— Curated by {assistant_name}, your AI shade advisor —';

COMMENT ON COLUMN chat_assistant_config.recommendations_intro IS 'Bot message shown immediately above the product cards. Supports {count} token for the number of results.';
COMMENT ON COLUMN chat_assistant_config.end_save_label IS 'Label for the save-recommendations button at the end of the flow. Saves to the shopper''s localStorage.';
COMMENT ON COLUMN chat_assistant_config.end_restart_label IS 'Label for the restart-conversation button at the end of the flow.';
COMMENT ON COLUMN chat_assistant_config.end_footer IS 'Italic-style footer line shown below the end-of-flow actions. {assistant_name} is replaced server-side.';
