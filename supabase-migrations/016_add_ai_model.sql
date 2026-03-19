-- Add ai_model column to products table
-- Allows per-product AI model selection
-- Values: 'gemini-2.5-flash-image' | 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview' | 'gpt-image-1.5'
-- NULL = auto (legacy behavior: use variant config detection)

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT NULL;

-- Add a check constraint for valid values
ALTER TABLE products
ADD CONSTRAINT products_ai_model_check 
CHECK (ai_model IS NULL OR ai_model IN (
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview', 
  'gemini-3-pro-image-preview',
  'gpt-image-1.5'
));
