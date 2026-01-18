-- ============================================
-- VARIANT COLOR PROFILES
-- Date: 2026-01-17
-- Description: Add variant-specific color profile parameters
-- ============================================

-- Step 1: Add columns to category_parameters for variant-specific handling
ALTER TABLE category_parameters 
ADD COLUMN IF NOT EXISTS is_variant_specific BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS input_type TEXT DEFAULT 'radio' CHECK (input_type IN ('radio', 'text', 'textarea'));

-- ============================================
-- BLUSH VARIANT COLOR PROFILE PARAMETERS
-- ============================================

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order, is_variant_specific, input_type) VALUES

-- Shade Name (free text)
('00000000-0000-0001-0000-000000000100', '00000000-0000-0000-0000-000000000004', 
 'shade_name', 'Shade Name', 'What is the name of this shade?', 
 false, NULL, 1, 10, true, 'text'),

-- Base Color Description (free text)
('00000000-0000-0001-0000-000000000101', '00000000-0000-0000-0000-000000000004', 
 'base_color_description', 'Color Description', 'How would you describe this shade''s color? (e.g. "warm terracotta", "dusty rose", "soft coral pink")', 
 false, NULL, 1, 11, true, 'text'),

-- Hue Family (select)
('00000000-0000-0001-0000-000000000102', '00000000-0000-0000-0000-000000000004', 
 'hue_family', 'Color Family', 'What color family does this shade belong to?', 
 false, NULL, 8, 12, true, 'radio'),

-- Undertone (select)
('00000000-0000-0001-0000-000000000103', '00000000-0000-0000-0000-000000000004', 
 'undertone', 'Undertone', 'What is the shade''s undertone?', 
 false, NULL, 3, 13, true, 'radio'),

-- Deep Skin Visibility Strategy (select)
('00000000-0000-0001-0000-000000000104', '00000000-0000-0000-0000-000000000004', 
 'deep_skin_visibility', 'Deep Skin Visibility', 'How should this shade stay visible on deeper skin tones?', 
 false, NULL, 3, 14, true, 'radio')

ON CONFLICT (id) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  is_variant_specific = EXCLUDED.is_variant_specific,
  input_type = EXCLUDED.input_type;

-- Blush Hue Family options
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000300', '00000000-0000-0001-0000-000000000102', 1, 'Pink',
 E'Apply a pink-toned blush pigment that reads as classic, fresh, and youthful.', 1),
('00000000-0000-0002-0000-000000000301', '00000000-0000-0001-0000-000000000102', 2, 'Rose',
 E'Apply a rose-toned blush pigment with soft, romantic depth.', 2),
('00000000-0000-0002-0000-000000000302', '00000000-0000-0001-0000-000000000102', 3, 'Coral',
 E'Apply a coral-toned blush pigment with bright, warm energy.', 3),
('00000000-0000-0002-0000-000000000303', '00000000-0000-0001-0000-000000000102', 4, 'Berry',
 E'Apply a berry-toned blush pigment with rich, cool-leaning depth.', 4),
('00000000-0000-0002-0000-000000000304', '00000000-0000-0001-0000-000000000102', 5, 'Terracotta',
 E'Apply a terracotta-toned blush pigment with earthy, sun-warmed warmth.', 5),
('00000000-0000-0002-0000-000000000305', '00000000-0000-0001-0000-000000000102', 6, 'Brown',
 E'Apply a brown-toned blush pigment with natural, neutral warmth.', 6),
('00000000-0000-0002-0000-000000000306', '00000000-0000-0001-0000-000000000102', 7, 'Mauve',
 E'Apply a mauve-toned blush pigment with muted, sophisticated depth.', 7),
('00000000-0000-0002-0000-000000000307', '00000000-0000-0001-0000-000000000102', 8, 'Neutral',
 E'Apply a neutral-toned blush pigment that adds warmth without strong color bias.', 8)
ON CONFLICT (id) DO NOTHING;

-- Blush Undertone options
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000310', '00000000-0000-0001-0000-000000000103', 1, 'Cool',
 E'The blush has cool undertones. Apply with a slightly blue or pink base that complements cool skin tones.', 1),
('00000000-0000-0002-0000-000000000311', '00000000-0000-0001-0000-000000000103', 2, 'Neutral',
 E'The blush has neutral undertones. Apply with balanced warmth that works across skin tones.', 2),
('00000000-0000-0002-0000-000000000312', '00000000-0000-0001-0000-000000000103', 3, 'Warm',
 E'The blush has warm undertones. Apply with golden, peach, or coral base that complements warm skin tones.', 3)
ON CONFLICT (id) DO NOTHING;

-- Blush Deep Skin Visibility options
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000320', '00000000-0000-0001-0000-000000000104', 1, 'Increase saturation',
 E'On deeper skin tones, increase the saturation of the blush pigment slightly to ensure visibility while maintaining natural appearance.', 1),
('00000000-0000-0002-0000-000000000321', '00000000-0000-0001-0000-000000000104', 2, 'Shift toward berry',
 E'On deeper skin tones, shift the blush subtly toward a deeper berry tone to ensure the color reads clearly against rich complexions.', 2),
('00000000-0000-0002-0000-000000000322', '00000000-0000-0001-0000-000000000104', 3, 'Increase brightness',
 E'On deeper skin tones, increase the brightness of the blush pigment only (not the surrounding skin) to ensure visibility.', 3)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- BRONZER VARIANT COLOR PROFILE PARAMETERS
-- ============================================

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order, is_variant_specific, input_type) VALUES

-- Shade Name (free text)
('00000000-0000-0001-0000-000000000110', '00000000-0000-0000-0000-000000000005', 
 'shade_name', 'Shade Name', 'What is the name of this shade?', 
 false, NULL, 1, 10, true, 'text'),

-- Base Color Description (free text)
('00000000-0000-0001-0000-000000000111', '00000000-0000-0000-0000-000000000005', 
 'base_color_description', 'Color Description', 'How would you describe this shade''s color? (e.g. "cool beige", "caramel tan", "rich brown")', 
 false, NULL, 1, 11, true, 'text'),

-- Hue Family (select) - beige / tan / bronze / brown
('00000000-0000-0001-0000-000000000112', '00000000-0000-0000-0000-000000000005', 
 'hue_family', 'Color Family', 'What color family does this shade belong to?', 
 false, NULL, 4, 12, true, 'radio'),

-- Undertone (select)
('00000000-0000-0001-0000-000000000113', '00000000-0000-0000-0000-000000000005', 
 'undertone', 'Undertone', 'What is the shade''s undertone?', 
 false, NULL, 3, 13, true, 'radio')

ON CONFLICT (id) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  is_variant_specific = EXCLUDED.is_variant_specific,
  input_type = EXCLUDED.input_type;

-- Bronzer Hue Family options: beige / tan / bronze / brown
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000330', '00000000-0000-0001-0000-000000000112', 1, 'Beige',
 E'Apply a beige-toned bronzer with soft, light warmth suitable for fair to light skin tones.', 1),
('00000000-0000-0002-0000-000000000331', '00000000-0000-0001-0000-000000000112', 2, 'Tan',
 E'Apply a tan-toned bronzer with natural, sun-kissed warmth for light to medium skin tones.', 2),
('00000000-0000-0002-0000-000000000332', '00000000-0000-0001-0000-000000000112', 3, 'Bronze',
 E'Apply a bronze-toned bronzer with rich, golden warmth for medium to tan skin tones.', 3),
('00000000-0000-0002-0000-000000000333', '00000000-0000-0001-0000-000000000112', 4, 'Brown',
 E'Apply a brown-toned bronzer with deep, rich warmth for medium-deep to deep skin tones.', 4)
ON CONFLICT (id) DO NOTHING;

-- Bronzer Undertone options
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000340', '00000000-0000-0001-0000-000000000113', 1, 'Cool',
 E'The bronzer has cool undertones. Apply with a subtle taupe or rose-brown base.', 1),
('00000000-0000-0002-0000-000000000341', '00000000-0000-0001-0000-000000000113', 2, 'Neutral',
 E'The bronzer has neutral undertones. Apply with balanced warmth that works across skin tones.', 2),
('00000000-0000-0002-0000-000000000342', '00000000-0000-0001-0000-000000000113', 3, 'Warm',
 E'The bronzer has warm undertones. Apply with golden, amber, or caramel warmth.', 3)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- HIGHLIGHTER VARIANT COLOR PROFILE PARAMETERS
-- ============================================

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order, is_variant_specific, input_type) VALUES

-- Shade Name (free text)
('00000000-0000-0001-0000-000000000140', '00000000-0000-0000-0000-000000000006', 
 'shade_name', 'Shade Name', 'What is the name of this shade?', 
 false, NULL, 1, 10, true, 'text'),

-- Base Color Description (free text)
('00000000-0000-0001-0000-000000000141', '00000000-0000-0000-0000-000000000006', 
 'base_color_description', 'Color Description', 'How would you describe this shade''s color? (e.g. "champagne pearl", "soft gold", "icy rose")', 
 false, NULL, 1, 11, true, 'text'),

-- Hue Family (select) - pearl / champagne / gold / rose
('00000000-0000-0001-0000-000000000142', '00000000-0000-0000-0000-000000000006', 
 'hue_family', 'Color Family', 'What color family does this shade belong to?', 
 false, NULL, 4, 12, true, 'radio'),

-- Undertone (select)
('00000000-0000-0001-0000-000000000143', '00000000-0000-0000-0000-000000000006', 
 'undertone', 'Undertone', 'What is the shade''s undertone?', 
 false, NULL, 3, 13, true, 'radio')

ON CONFLICT (id) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  is_variant_specific = EXCLUDED.is_variant_specific,
  input_type = EXCLUDED.input_type;

-- Highlighter Hue Family options: pearl / champagne / gold / rose
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000350', '00000000-0000-0001-0000-000000000142', 1, 'Pearl',
 E'Apply a pearl-toned highlighter with soft, white-silver luminosity.', 1),
('00000000-0000-0002-0000-000000000351', '00000000-0000-0001-0000-000000000142', 2, 'Champagne',
 E'Apply a champagne-toned highlighter with soft, warm golden-beige luminosity.', 2),
('00000000-0000-0002-0000-000000000352', '00000000-0000-0001-0000-000000000142', 3, 'Gold',
 E'Apply a gold-toned highlighter with rich, warm golden luminosity.', 3),
('00000000-0000-0002-0000-000000000353', '00000000-0000-0001-0000-000000000142', 4, 'Rose',
 E'Apply a rose-toned highlighter with soft, pink-gold luminosity.', 4)
ON CONFLICT (id) DO NOTHING;

-- Highlighter Undertone options
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000360', '00000000-0000-0001-0000-000000000143', 1, 'Cool',
 E'The highlighter has cool undertones. Apply with silver, icy, or pink-based luminosity.', 1),
('00000000-0000-0002-0000-000000000361', '00000000-0000-0001-0000-000000000143', 2, 'Neutral',
 E'The highlighter has neutral undertones. Apply with balanced luminosity that works across skin tones.', 2),
('00000000-0000-0002-0000-000000000362', '00000000-0000-0001-0000-000000000143', 3, 'Warm',
 E'The highlighter has warm undertones. Apply with golden, champagne, or peachy luminosity.', 3)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- LIP HYDRATION VARIANT COLOR PROFILE PARAMETERS
-- ============================================

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order, is_variant_specific, input_type) VALUES

-- Shade Name (free text) - for tinted lip balms
('00000000-0000-0001-0000-000000000150', '00000000-0000-0000-0000-000000000007', 
 'shade_name', 'Shade Name', 'What is the name of this shade? (Leave blank for untinted)', 
 false, NULL, 1, 10, true, 'text'),

-- Base Color Description (free text)
('00000000-0000-0001-0000-000000000151', '00000000-0000-0000-0000-000000000007', 
 'base_color_description', 'Color Description', 'How would you describe this shade''s tint? (e.g. "sheer pink", "berry tint", "nude rose") Leave blank for untinted.', 
 false, NULL, 1, 11, true, 'text')

ON CONFLICT (id) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  is_variant_specific = EXCLUDED.is_variant_specific,
  input_type = EXCLUDED.input_type;

-- ============================================
-- LIP GLOSS VARIANT COLOR PROFILE PARAMETERS
-- ============================================

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order, is_variant_specific, input_type) VALUES

-- Shade Name (free text)
('00000000-0000-0001-0000-000000000160', '00000000-0000-0000-0000-000000000008', 
 'shade_name', 'Shade Name', 'What is the name of this shade?', 
 false, NULL, 1, 10, true, 'text'),

-- Base Color Description (free text)
('00000000-0000-0001-0000-000000000161', '00000000-0000-0000-0000-000000000008', 
 'base_color_description', 'Color Description', 'How would you describe this shade''s color? (e.g. "clear shine", "sheer pink", "nude peach")', 
 false, NULL, 1, 11, true, 'text')

ON CONFLICT (id) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  is_variant_specific = EXCLUDED.is_variant_specific,
  input_type = EXCLUDED.input_type;

-- ============================================
-- MASCARA VARIANT COLOR PROFILE PARAMETERS
-- ============================================

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order, is_variant_specific, input_type) VALUES

-- Shade Name (free text)
('00000000-0000-0001-0000-000000000170', '00000000-0000-0000-0000-000000000009', 
 'shade_name', 'Shade Name', 'What is the name of this shade?', 
 false, NULL, 1, 10, true, 'text'),

-- Color (select)
('00000000-0000-0001-0000-000000000171', '00000000-0000-0000-0000-000000000009', 
 'mascara_color', 'Mascara Color', 'What color is this mascara?', 
 false, NULL, 4, 11, true, 'radio')

ON CONFLICT (id) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  is_variant_specific = EXCLUDED.is_variant_specific,
  input_type = EXCLUDED.input_type;

-- Mascara Color options
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000370', '00000000-0000-0001-0000-000000000171', 1, 'Blackest Black',
 E'Apply an ultra-black mascara pigment with maximum intensity and depth.', 1),
('00000000-0000-0002-0000-000000000371', '00000000-0000-0001-0000-000000000171', 2, 'Black',
 E'Apply a classic black mascara pigment with rich, natural depth.', 2),
('00000000-0000-0002-0000-000000000372', '00000000-0000-0001-0000-000000000171', 3, 'Dark Brown',
 E'Apply a dark brown mascara pigment for a softer, more natural look.', 3),
('00000000-0000-0002-0000-000000000373', '00000000-0000-0001-0000-000000000171', 4, 'Brown',
 E'Apply a brown mascara pigment for the most natural, subtle enhancement.', 4)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- EYEBROW ENHANCER VARIANT COLOR PROFILE PARAMETERS
-- ============================================

-- First, delete the old "See variant profile" placeholder level and the old broken parameter
DELETE FROM parameter_levels WHERE id = '00000000-0000-0002-0000-000000000156';
DELETE FROM category_parameters WHERE id = '00000000-0000-0001-0000-000000000065';

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order, is_variant_specific, input_type) VALUES

-- Shade Name (free text)
('00000000-0000-0001-0000-000000000180', '00000000-0000-0000-0000-00000000000a', 
 'shade_name', 'Shade Name', 'What is the name of this shade?', 
 false, NULL, 1, 10, true, 'text'),

-- Base Color Description (free text)
('00000000-0000-0001-0000-000000000181', '00000000-0000-0000-0000-00000000000a', 
 'base_color_description', 'Color Description', 'How would you describe this shade''s color? (e.g. "soft taupe", "warm brunette", "cool ash")', 
 false, NULL, 1, 11, true, 'text'),

-- Shade Depth (select)
('00000000-0000-0001-0000-000000000182', '00000000-0000-0000-0000-00000000000a', 
 'shade_depth', 'Shade Depth', 'What depth level is this shade?', 
 false, NULL, 5, 12, true, 'radio'),

-- Warmth (select)
('00000000-0000-0001-0000-000000000183', '00000000-0000-0000-0000-00000000000a', 
 'warmth', 'Warmth', 'What is the shade''s warmth level?', 
 false, NULL, 3, 13, true, 'radio')

ON CONFLICT (id) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  is_variant_specific = EXCLUDED.is_variant_specific,
  input_type = EXCLUDED.input_type;

-- Eyebrow Shade Depth options
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000380', '00000000-0000-0001-0000-000000000182', 1, 'Blonde / Taupe',
 E'Apply pigment in a soft blonde or taupe shade, suitable for fair hair. Pigment must match natural light hair coloration and never appear flat, inky, or painted.', 1),
('00000000-0000-0002-0000-000000000381', '00000000-0000-0001-0000-000000000182', 2, 'Light Brown',
 E'Apply pigment in a light brown shade, suitable for light to medium brown hair. Pigment must match natural hair coloration and never appear flat, inky, or painted.', 2),
('00000000-0000-0002-0000-000000000382', '00000000-0000-0001-0000-000000000182', 3, 'Medium Brown',
 E'Apply pigment in a medium brown shade, suitable for medium to dark brown hair. Pigment must match natural hair coloration and never appear flat, inky, or painted.', 3),
('00000000-0000-0002-0000-000000000383', '00000000-0000-0001-0000-000000000182', 4, 'Dark Brown',
 E'Apply pigment in a dark brown shade, suitable for dark brown to brunette hair. Pigment must match natural hair coloration and never appear flat, inky, or painted.', 4),
('00000000-0000-0002-0000-000000000384', '00000000-0000-0001-0000-000000000182', 5, 'Black / Soft Black',
 E'Apply pigment in a soft black shade, suitable for black hair. Pigment must match natural hair coloration and never appear flat, inky, or painted.', 5)
ON CONFLICT (id) DO NOTHING;

-- Eyebrow Warmth options
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES
('00000000-0000-0002-0000-000000000390', '00000000-0000-0001-0000-000000000183', 1, 'Cool',
 E'The brow shade has cool undertones. Apply with ashy, taupe, or gray-brown tones.', 1),
('00000000-0000-0002-0000-000000000391', '00000000-0000-0001-0000-000000000183', 2, 'Neutral',
 E'The brow shade has neutral undertones. Apply with balanced tones that work across hair colors.', 2),
('00000000-0000-0002-0000-000000000392', '00000000-0000-0001-0000-000000000183', 3, 'Warm',
 E'The brow shade has warm undertones. Apply with golden, auburn, or caramel tones.', 3)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- VERIFICATION
-- ============================================
-- Check variant-specific parameters:
--   SELECT c.name as category, cp.display_name, cp.is_variant_specific, cp.input_type
--   FROM category_parameters cp
--   JOIN categories c ON c.id = cp.category_id
--   WHERE cp.is_variant_specific = true
--   ORDER BY c.sort_order, cp.sort_order;
