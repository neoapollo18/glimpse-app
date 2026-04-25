-- Allow 'gpt-image-2' as a valid value for products.ai_model
-- Recreates the CHECK constraint added in 016_add_ai_model.sql

ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_ai_model_check;

ALTER TABLE products
ADD CONSTRAINT products_ai_model_check
CHECK (ai_model IS NULL OR ai_model IN (
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gpt-image-1.5',
  'gpt-image-2'
));
