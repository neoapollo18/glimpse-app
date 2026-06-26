-- Migration 041: merchant-configurable camera framing hint
--
-- photo_frame_hint — the small instructional line shown inside the desktop
-- camera modal (gleame-camera) that tells the shopper how to frame their
-- photo. It was hardcoded to "Position your face in the frame", which is
-- wrong for non-face try-ons (e.g. nail shops want "Position your nails in
-- the frame"). Making it part of the chat assistant config lets each merchant
-- word it for their category. NULL/empty = widget falls back to the built-in
-- "Position your face in the frame" default.

ALTER TABLE chat_assistant_config
  ADD COLUMN IF NOT EXISTS photo_frame_hint text;

COMMENT ON COLUMN chat_assistant_config.photo_frame_hint IS 'Instructional line shown in the desktop camera modal (e.g. "Position your nails in the frame"). NULL/empty falls back to the built-in face-framing default.';
