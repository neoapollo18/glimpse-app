-- Migration 022: add photo_upload_message column to chat_assistant_config
--
-- Merchants can customize the message shown to shoppers after they pick a
-- preference, prompting them to upload a selfie. Previously hard-coded in the
-- widget JS.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS photo_upload_message text NOT NULL
  DEFAULT 'Take a photo or upload one and I''ll show you what looks best on you!';

COMMENT ON COLUMN chat_assistant_config.photo_upload_message IS 'Prompt shown before the photo upload widget in the chat flow';
