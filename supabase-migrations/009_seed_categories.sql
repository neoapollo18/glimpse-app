-- ============================================
-- SEED DATA: Funnel-Based Prompt System
-- Date: 2026-01-16
-- Description: Populate categories, parameters, and levels with prompt data
-- ============================================

-- NOTE: Run this AFTER 008_funnel_system.sql
-- This script uses fixed UUIDs for reproducible seeding

-- ============================================
-- STEP 1: Insert Categories (11 total)
-- ============================================

INSERT INTO categories (id, name, slug, description, base_prompt, sort_order) VALUES

-- Category 1: Skin Refinement
('00000000-0000-0000-0000-000000000001', 'Skin Refinement', 'skin-refinement', 'Overall skin health - cleanser/moisturizer/oil results',
E'Using the provided image, apply a subtle, realistic **Skin Refinement** effect that enhances the appearance of overall skin health while fully preserving the subject''s natural identity and skin integrity.

This transformation represents **healthy, well-cared-for skin**, not makeup, not retouching, and not a beauty filter.

### **NON-NEGOTIABLE CONSTRAINTS**

- Do **NOT** change facial structure, proportions, symmetry, or expression
- Do **NOT** alter eye shape, nose, lips, jawline, or any facial geometry
- Do **NOT** blur, smooth, airbrush, or soften the skin
- Do **NOT** remove or erase pores, freckles, moles, scars, fine lines, wrinkles, acne, or natural texture
- Do **NOT** alter underlying skin tone, ethnicity, or complexion identity
- Do **NOT** apply makeup effects, coverage, tinting, contouring, or cosmetic coloration
- Do **NOT** create a filtered, plastic, or artificially perfected appearance
- Do **NOT** change lighting direction, shadows, contrast, color grading, or background

If any of the above changes occur, the result is incorrect.

### **ALLOWED TRANSFORMATION SCOPE**

Skin Refinement may only:

- Improve the *overall impression* of skin health in a restrained, believable way
- Support a look of balanced, comfortable, resilient skin
- Gently enhance clarity and vitality without suppressing natural variation

All improvements must be **skin-integrated**, **non-destructive**, and **consistent with real human skin**.

### **REALISM & IDENTITY PRESERVATION**

- The subject must remain unmistakably the same person
- Skin texture, micro-detail, and natural imperfections must remain visible
- Individual characteristics and asymmetries must be preserved
- The result should resemble skin after consistent, healthy care — never edited or retouched

### **FINAL INTENT**

The final image should look like the original person in the same lighting and conditions, with skin that appears **naturally healthy and well-maintained**, not cosmetically altered.

If the result is noticeable as editing, retouching, or filtering, the Skin Refinement has exceeded its intended scope.', 1),

-- Category 2: Acne & Redness Refinement
('00000000-0000-0000-0000-000000000002', 'Acne & Redness Refinement', 'acne-redness', 'Specific problem areas feel calmer',
E'Using the provided photo, generate a realistic Acne + Redness Improvement preview that reflects results after consistent skincare use over time (not an instant filter).

This is a skincare result visualization, not makeup and not retouching.

IDENTITY & SCENE LOCK
Keep the person''s face shape and proportions, facial features (eyes, nose, lips, jawline, ears), expression, hair, background, camera angle, and lighting exactly the same.

GLOBAL INTENT
The skin should appear calmer, healthier, and less inflamed while remaining realistic and textured.
The result must show visible improvement. If acne and redness appear unchanged, the output is incorrect.', 2),

-- Category 3: Brightening & Tone Boost
('00000000-0000-0000-0000-000000000003', 'Brightening & Tone Boost', 'brightening-tone', 'Skin looks brighter and more luminous',
E'Using the provided photo, generate a realistic Brightening & Tone Boost preview that reflects results from consistent use of a brightening skincare serum over time.

This is a skincare result visualization, not makeup and not retouching.

IDENTITY & SCENE LOCK
Keep the person''s face shape, proportions, facial features (eyes, nose, lips, brows, jawline, ears), expression, hair, background, camera angle, lighting direction, and shadows exactly the same.

GLOBAL INTENT
The skin should appear brighter, more luminous, healthier, and more even-toned while remaining fully realistic and textured.
If no visible improvement in brightness, glow, or tone balance is present, the output is incorrect.', 3),

-- Category 4: Blush
('00000000-0000-0000-0000-000000000004', 'Blush', 'blush', 'Natural flush and color on cheeks',
E'Using the provided photo, apply a visible yet natural-looking cheek flush that reflects a high-quality blush product.

The result should look like a healthy, hydrated flush that comes from within the skin — not makeup sitting on top of the face.

IDENTITY & SCENE LOCK
Keep the person''s face shape, proportions, facial features (eyes, nose, lips, brows, jawline, ears), expression, hair, background, camera angle, lighting direction, and shadows exactly the same.

GLOBAL INTENT
The blush must be clearly visible yet skin-integrated, lifted, and natural.
If no visible cheek flush is present, the output is incorrect.', 4),

-- Category 5: Bronzer
('00000000-0000-0000-0000-000000000005', 'Bronzer', 'bronzer', 'Sun-kissed warmth and dimension',
E'Using the provided photo, simulate the visible effect of a bronzing product applied to the same person.

This is a skin-integrated bronzed radiance and reflective warmth effect —
NOT contour sculpting, NOT face reshaping, NOT complexion correction, and NOT a beauty filter.

The result should appear as realistic bronzed dimension created by light interaction with the skin,
as if the skin itself is reflecting warm bronze light over time.', 5),

-- Category 6: Highlighter
('00000000-0000-0000-0000-000000000006', 'Highlighter', 'highlighter', 'Light-catching glow and radiance',
E'Using the provided photo, simulate the visible effect of a light-reflective highlighter on the same person.

This is a localized light interaction effect only —
NOT blush, NOT bronzer, NOT contour, NOT makeup coverage,
and NOT complexion correction.

The result should appear as skin-integrated radiance created by natural light reflection,
as if the skin itself is catching and reflecting light.', 6),

-- Category 7: Lip Hydration
('00000000-0000-0000-0000-000000000007', 'Lip Hydration', 'lip-hydration', 'Healthier moisturized lips',
E'Using the provided photo, enhance ONLY the lips to simulate the visible results of a hydrating lip balm.

This is a hydration and nourishment effect only —
NOT lipstick, NOT gloss, NOT tint, NOT plumping, and NOT makeup.

No other part of the face should be altered.
The person''s identity, facial structure, lighting, and background must remain unchanged.', 7),

-- Category 8: Lip Gloss
('00000000-0000-0000-0000-000000000008', 'Lip Gloss', 'lip-gloss', 'Glossy shine and tint',
E'Using the provided photo, apply a high-impact glossy lip effect to the lips only.

This is a gloss and light-reflection effect —
NOT lipstick, NOT lip tint, NOT shimmer, and NOT plumping.

Only the lips may be modified.
All other parts of the image must remain unchanged.', 8),

-- Category 9: Mascara
('00000000-0000-0000-0000-000000000009', 'Mascara', 'mascara', 'Lash definition and fullness',
E'Apply a cosmetic mascara coating to the existing eyelashes only,
as if pigment is lightly deposited onto the visible lash hairs.

This is a coating and adhesion effect —
NOT lash creation, NOT lash reshaping, and NOT lash styling.

ONLY existing eyelashes may be modified.
All enhancement must follow the natural shape, spacing, and irregularity
of the lashes visible in the original photo.

The person''s eyes, face, skin, brows, lighting, and camera perspective
must remain completely unchanged.

This is a lash-definition effect —
NOT eyeliner, NOT eyeshadow, and NOT eye-shape enhancement.', 9),

-- Category 10: Eyebrow Enhancer
('00000000-0000-0000-0000-00000000000a', 'Eyebrow Enhancer', 'eyebrow-enhancer', 'Fuller natural-looking brows',
E'Apply a fine cosmetic pigment accent to the existing eyebrow hairs only.

This is a selective hair accent effect —
NOT brow drawing, NOT brow filling, and NOT makeup application.

Enhancement must be hair-based, uneven by design,
and derived strictly from visible eyebrow hairs.

The person''s face, skin, eyes, lashes, scalp hair, lighting,
and camera perspective must remain completely unchanged.

Do NOT apply pigment evenly across all eyebrow hairs.

Only a subset of visible eyebrow hairs should receive pigment accenting.
Some hairs must remain lighter to preserve natural variation.

Favor pigment application toward:
• Hair mid-lengths and tips
• Isolated or sparse hairs
• Naturally thicker or darker hairs

Avoid uniform root-to-tip coating.
If brows appear evenly dark, continuous, or stamped-on,
the result is incorrect.

All eyebrow enhancement must be strictly derived from the existing eyebrow hairs
visible in the original photo.

- Do NOT invent new eyebrow hairs
• Do NOT fill or tint skin between hairs
• Do NOT blur, smooth, or shade brow regions
• Do NOT create uniform density or symmetry

If a hair is not visible or implied by nearby hairs,
it must NOT appear in the result.

Keep COMPLETELY unchanged:
• Eyebrow position
• Overall brow shape and silhouette
• Arch height
• Tail length
• Brow width and thickness
• Natural asymmetry', 10),

-- Category 11: Hair Health
('00000000-0000-0000-0000-00000000000b', 'Hair Health', 'hair-health', 'Healthier hair appearance',
E'HAIR HEALTH & FINISH — CORE BEHAVIOR (LOCKED)

Using the provided photo, enhance ONLY the hair to reflect realistic results of a hair health product.

⚠️ ABSOLUTE RULE
ONLY hair pixels may be modified. Everything else must remain pixel-identical:
• Face, skin, expression, eyes, brows, lashes
• Clothing, background, lighting, shadows, camera perspective

If a pixel is not hair, it must remain untouched.

HAIRLINE + LENGTH + COUNT LOCK (NON-NEGOTIABLE)

- Do NOT move the hairline
• Do NOT add new hair strands or increase strand count
• Do NOT increase density or create "thicker hair" by hallucination
• Do NOT change hair length, part, or overall silhouette

Preserve the subject''s natural hair pattern exactly.
Do NOT create new curls or waves if they are not present.

TEXTURE + COLOR PRESERVATION (CRITICAL)

- Preserve individual strands, clumps, and microtexture
• No airbrushing, no heavy smoothing, no plastic hair effect
• Keep natural color and highlights exactly (no recolor, no toning)
• Improvements must look like changes in cleanliness, hydration, frizz control, and definition — not a new hairstyle

HARD FAIL CONDITIONS

❌ Face/skin changes of any kind

❌ Hairline/part/silhouette changes

❌ Added strands or density hallucination

❌ Curl pattern changes (tighten/loosen/straighten)

❌ Oily, wet, or glassy shine', 11)

ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 2: Insert Category Parameters
-- ============================================

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order) VALUES

-- Skin Refinement Parameters (Category 1)
('00000000-0000-0001-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'evenness', 'Skin Evenness', 'How even should the skin look?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'hydration_glow', 'Hydration Glow', 'How moisturized should the skin look?', false, NULL, 4, 2),
('00000000-0000-0001-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'redness_softening', 'Redness', 'How much natural redness should be visible?', false, NULL, 4, 3),
('00000000-0000-0001-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'brightness_shift', 'Brightness', 'Should the skin look brighter overall?', false, NULL, 4, 4),
('00000000-0000-0001-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'fine_line_softening', 'Fine Lines', 'How should fine lines appear?', false, NULL, 4, 5),
('00000000-0000-0001-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'guardrails', 'Guardrails', NULL, true,
E'The following constraints are ALWAYS enforced for Skin Refinement and must be obeyed without exception.

IDENTITY PRESERVATION

- The subject must remain unmistakably the same person.
- Do NOT alter facial structure, proportions, symmetry, or expression.
- Do NOT modify the shape or position of the eyes, nose, lips, jawline, cheeks, or forehead.

TEXTURE PRESERVATION

- Preserve all natural skin texture at all times.
- Do NOT blur, smooth, airbrush, soften, or flatten the skin surface.
- Do NOT remove or erase pores, freckles, moles, scars, fine lines, wrinkles, acne, or micro-detail.

SKIN TONE LOCK

- Maintain the original underlying skin tone, complexion depth, and ethnicity.
- Do NOT lighten, darken, recolor, or neutralize the skin in a way that alters identity.
- Do NOT introduce whitening, bleaching, gray-casting, or artificial color correction.

NO MAKEUP EFFECTS

- Do NOT apply makeup, coverage, foundation, tinting, contouring, blush, bronzer, highlight, or cosmetic coloration.
- Do NOT create a polished, painted, or cosmetically enhanced appearance.

NO FACIAL GEOMETRY CHANGES

- Do NOT reshape, lift, tighten, sculpt, or redefine any facial features.
- Do NOT simulate cosmetic procedures, filters, or retouching effects.

If any of these guardrails are violated, the Skin Refinement result is incorrect and invalid.', 1, 100),

-- Acne & Redness Parameters (Category 2)
('00000000-0000-0001-0000-000000000008', '00000000-0000-0000-0000-000000000002', 'redness_reduction', 'Redness', 'How much redness should be reduced?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000009', '00000000-0000-0000-0000-000000000002', 'blemish_softening', 'Blemish Softening', 'How noticeable should blemishes be?', false, NULL, 4, 2),
('00000000-0000-0001-0000-000000000010', '00000000-0000-0000-0000-000000000002', 'contrast_reduction', 'Contrast', 'How strong should the contrast between marks and skin be?', false, NULL, 4, 3),
('00000000-0000-0001-0000-000000000011', '00000000-0000-0000-0000-000000000002', 'acne_handling', 'Acne Handling', 'How should acne be handled in the preview?', false, NULL, 3, 4),
('00000000-0000-0001-0000-000000000012', '00000000-0000-0000-0000-000000000002', 'guardrails', 'Guardrails', NULL, true,
E'TEXTURE PRESERVATION
Preserve pores, freckles, scars, and fine skin texture.
Do not apply global smoothing or airbrushing.

NO MAKEUP
Do not apply foundation, concealer, or cosmetic coverage.

IDENTITY PRESERVATION
Do not alter facial structure, proportions, or expression.

SCENE PRESERVATION
Do not change lighting, background, or camera perspective.

NO ADDITIONS
Do not add new acne, blemishes, or marks.', 1, 100),

-- Brightening & Tone Boost Parameters (Category 3)
('00000000-0000-0001-0000-000000000013', '00000000-0000-0000-0000-000000000003', 'dark_spot_softening', 'Dark Spots', 'How much should dark spots be softened?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000014', '00000000-0000-0000-0000-000000000003', 'glow_boost', 'Glow', 'How radiant should the skin look?', false, NULL, 4, 2),
('00000000-0000-0001-0000-000000000015', '00000000-0000-0000-0000-000000000003', 'texture_refinement', 'Texture', 'How refined should the skin texture appear?', false, NULL, 4, 3),
('00000000-0000-0001-0000-000000000016', '00000000-0000-0000-0000-000000000003', 'redness_softening', 'Redness', 'How much redness should be reduced?', false, NULL, 4, 4),
('00000000-0000-0001-0000-000000000017', '00000000-0000-0000-0000-000000000003', 'brightness_shift', 'Brightness', 'How bright should the skin appear?', false, NULL, 4, 5),
('00000000-0000-0001-0000-000000000018', '00000000-0000-0000-0000-000000000003', 'fine_line_softening', 'Fine Lines', 'How should fine lines appear?', false, NULL, 3, 6),
('00000000-0000-0001-0000-000000000019', '00000000-0000-0000-0000-000000000003', 'acne_mode', 'Acne', 'How should acne appear?', false, NULL, 3, 7),
('00000000-0000-0001-0000-000000000020', '00000000-0000-0000-0000-000000000003', 'guardrails', 'Guardrails', NULL, true,
E'SKIN TONE LOCK
Do not lighten or recolor the person''s underlying skin tone.
Brightness must come from luminosity and clarity only.

TEXTURE PRESERVATION
Preserve pores, freckles, scars, fine lines, and natural skin texture.
Do not blur or airbrush.

NO MAKEUP
Do not apply foundation, concealer, color correction, or cosmetic coverage.

IDENTITY PRESERVATION
Do not alter facial structure, proportions, symmetry, or expression.

SCENE PRESERVATION
Do not change lighting direction, exposure, shadows, or background.

ACNE HANDLING
Do not remove acne, except for tiny red pinpoint blemishes which may be softened slightly.
Larger acne must remain intact.', 1, 100),

-- Blush Parameters (Category 4)
('00000000-0000-0001-0000-000000000022', '00000000-0000-0000-0000-000000000004', 'flush_visibility', 'Flush Intensity', 'How visible should the blush be?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000023', '00000000-0000-0000-0000-000000000004', 'finish_style', 'Finish', 'What finish should the blush have?', false, NULL, 3, 2),
('00000000-0000-0001-0000-000000000024', '00000000-0000-0000-0000-000000000004', 'placement_style', 'Placement', 'Where should the blush be focused?', false, NULL, 3, 3),
('00000000-0000-0001-0000-000000000025', '00000000-0000-0000-0000-000000000004', 'redness_avoidance', 'Redness Avoidance', 'Should the blush avoid red-prone areas?', false, NULL, 2, 4),
('00000000-0000-0001-0000-000000000026', '00000000-0000-0000-0000-000000000004', 'guardrails', 'Guardrails', NULL, true,
E'TEXTURE PRESERVATION
Preserve all pores, freckles, acne, scars, and microtexture.
Blush must tint texture, never blur it.

SKIN TONE LOCK
Do not lighten or recolor underlying skin tone.
Never force color visibility by altering complexion depth.

NO MAKEUP EFFECTS
No foundation, no contouring, no sculpting, no shimmer, no sparkle.

IDENTITY PRESERVATION
Do not alter facial structure, proportions, or expression.

SCENE PRESERVATION
Do not change lighting direction, shadows, contrast, or background.', 1, 100),

-- Bronzer Parameters (Category 5)
('00000000-0000-0001-0000-000000000028', '00000000-0000-0000-0000-000000000005', 'placement_zone', 'Placement', 'Where should the bronzer be applied?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000029', '00000000-0000-0000-0000-000000000005', 'warmth_level', 'Warmth', 'How warm should the bronzer feel?', false, NULL, 4, 2),
('00000000-0000-0001-0000-000000000030', '00000000-0000-0000-0000-000000000005', 'depth_intensity', 'Depth', 'How deep should the bronzer appear?', false, NULL, 4, 3),
('00000000-0000-0001-0000-000000000031', '00000000-0000-0000-0000-000000000005', 'reflectivity', 'Finish', 'What finish should the bronzer have?', false, NULL, 3, 4),
('00000000-0000-0001-0000-000000000032', '00000000-0000-0000-0000-000000000005', 'blend_softness', 'Blend', 'How softly should the bronzer blend?', false, NULL, 3, 5),
('00000000-0000-0001-0000-000000000033', '00000000-0000-0000-0000-000000000005', 'guardrails', 'Guardrails', NULL, true,
E'ABSOLUTE GUARDRAILS (DO NOT VIOLATE)

Do NOT change or generate anything outside the bronzed zones.

Do NOT modify:
• Face shape, proportions, or expression
• Jawline, chin, nose, lips
• Eyes, brows, lashes
• Skin texture, pores, freckles, acne, scars
• Hair or facial hair
• Lighting direction, shadows, contrast, or color grading
• Background or camera perspective

No contouring.
No sculpting.
No shadow carving.
No blush.
No face-wide color shifts.
No smoothing, blurring, or foundation-like effects.

If a pixel is not part of the bronzed glow, it must remain untouched.', 1, 100),

-- Highlighter Parameters (Category 6)
('00000000-0000-0001-0000-000000000034', '00000000-0000-0000-0000-000000000006', 'placement_zone', 'Placement', 'Where should the highlighter be placed?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000035', '00000000-0000-0000-0000-000000000006', 'shine_intensity', 'Shine Intensity', 'How intense should the shine be?', false, NULL, 4, 2),
('00000000-0000-0001-0000-000000000036', '00000000-0000-0000-0000-000000000006', 'reflective_grain', 'Grain', 'How fine should the reflection look?', false, NULL, 2, 3),
('00000000-0000-0001-0000-000000000037', '00000000-0000-0000-0000-000000000006', 'falloff_softness', 'Falloff', 'How softly should the highlight fade?', false, NULL, 3, 4),
('00000000-0000-0001-0000-000000000038', '00000000-0000-0000-0000-000000000006', 'color_temperature', 'Temperature', 'What tone should the highlight have?', false, NULL, 3, 5),
('00000000-0000-0001-0000-000000000039', '00000000-0000-0000-0000-000000000006', 'guardrails', 'Guardrails', NULL, true,
E'ABSOLUTE GUARDRAILS (DO NOT VIOLATE)

Do NOT modify anything outside highlight zones.

Do NOT change:
• Face shape, proportions, or expression
• Nose bridge or tip
• Jawline or chin
• Lips (except cupid''s bow if specified)
• Eyes, brows, lashes
• Skin texture, pores, freckles, acne, scars
• Hair or facial hair
• Lighting direction, shadows, contrast, or color grading
• Background or camera perspective

No blush.
No bronzer.
No contour.
No sculpting.
No shimmer bands or highlight stripes.
No glass-skin, oily, or wet shine.
No skin tone correction.

If a pixel is not part of the highlight, it must remain untouched.', 1, 100),

-- Lip Hydration Parameters (Category 7)
('00000000-0000-0001-0000-000000000040', '00000000-0000-0000-0000-000000000007', 'hydration_level', 'Hydration', 'How hydrated should the lips look?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000041', '00000000-0000-0000-0000-000000000007', 'sheen_finish', 'Sheen', 'What finish should the lips have?', false, NULL, 3, 2),
('00000000-0000-0001-0000-000000000042', '00000000-0000-0000-0000-000000000007', 'texture_preservation', 'Texture', 'How natural should the lip texture look?', false, NULL, 2, 3),
('00000000-0000-0001-0000-000000000043', '00000000-0000-0000-0000-000000000007', 'edge_precision', 'Edge Definition', 'How defined should the lip edges appear?', false, NULL, 2, 4),
('00000000-0000-0001-0000-000000000044', '00000000-0000-0000-0000-000000000007', 'guardrails', 'Guardrails', NULL, true,
E'ABSOLUTE GUARDRAILS (DO NOT VIOLATE)

Modify ONLY the lips.

Do NOT change:
• Lip shape, size, volume, or proportions
• Lip color or pigmentation
• Teeth or gums
• Skin surrounding the lips
• Nose, eyes, or facial structure
• Lighting direction, shadows, contrast, or color grading
• Background or camera perspective

No tint.
No pigment.
No shimmer.
No plumping.
No lipstick or gloss effects.
No smoothing, blurring, or airbrushing.

If a pixel is not part of the lips, it must remain untouched.', 1, 100),

-- Lip Gloss Parameters (Category 8)
('00000000-0000-0001-0000-000000000045', '00000000-0000-0000-0000-000000000008', 'gloss_intensity', 'Gloss Intensity', 'How glossy should the lips look?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000046', '00000000-0000-0000-0000-000000000008', 'tint_level', 'Tint Level', 'How much color should the gloss add?', false, NULL, 4, 2),
('00000000-0000-0001-0000-000000000047', '00000000-0000-0000-0000-000000000008', 'tint_temperature', 'Tint Tone', 'What color tone should the tint have?', false, NULL, 3, 3),
('00000000-0000-0001-0000-000000000048', '00000000-0000-0000-0000-000000000008', 'reflectivity_profile', 'Shine Type', 'What kind of shine should it have?', false, NULL, 2, 4),
('00000000-0000-0001-0000-000000000049', '00000000-0000-0000-0000-000000000008', 'coverage_uniformity', 'Coverage', 'Where should the gloss be strongest?', false, NULL, 2, 5),
('00000000-0000-0001-0000-000000000050', '00000000-0000-0000-0000-000000000008', 'edge_precision', 'Edge Definition', 'How defined should the lip edges be?', false, NULL, 2, 6),
('00000000-0000-0001-0000-000000000051', '00000000-0000-0000-0000-000000000008', 'guardrails', 'Guardrails', NULL, true,
E'ABSOLUTE GUARDRAILS (DO NOT VIOLATE)

Modify ONLY the lips.

Do NOT change:
• Lip shape, size, volume, or proportions
• Teeth, gums, or tongue
• Skin outside the lips (no smoothing, glow, or tone change)
• Nose, cheeks, chin, jawline, or facial structure
• Eyes, brows, hair
• Lighting, shadows, contrast, or color grading
• Background or camera perspective

Do NOT apply:
• Shimmer, glitter, or particles
• Lipstick-like opacity
• Plumping or volume changes
• Blur, smoothing, or airbrushing

If a pixel is not part of the lips, it must remain untouched.', 1, 100),

-- Mascara Parameters (Category 9)
('00000000-0000-0001-0000-000000000052', '00000000-0000-0000-0000-000000000009', 'lash_density', 'Density', 'How full should the lashes look?', false, NULL, 3, 1),
('00000000-0000-0001-0000-000000000053', '00000000-0000-0000-0000-000000000009', 'lash_length_bias', 'Length', 'What length should the lashes have?', false, NULL, 3, 2),
('00000000-0000-0001-0000-000000000054', '00000000-0000-0000-0000-000000000009', 'lash_darkness', 'Darkness', 'How dark should the lashes appear?', false, NULL, 3, 3),
('00000000-0000-0001-0000-000000000055', '00000000-0000-0000-0000-000000000009', 'lash_separation', 'Separation', 'How separated should the lashes be?', false, NULL, 3, 4),
('00000000-0000-0001-0000-000000000056', '00000000-0000-0000-0000-000000000009', 'lower_lash_strength', 'Lower Lashes', 'How noticeable should lower lashes be?', false, NULL, 2, 5),
('00000000-0000-0001-0000-000000000057', '00000000-0000-0000-0000-000000000009', 'guardrails', 'Guardrails', NULL, true,
E'SOURCE-ANCHORED LASH CONSTRAINT (CRITICAL)

All lash enhancement must be strictly derived from the existing lash hairs
visible in the original photo.

- Do NOT invent new lash strands
• Do NOT increase the number of visible lash roots
• Do NOT create uniform or symmetrical lash spacing
• Do NOT redraw lash curvature

Enhancement may only:
• Darken existing lashes
• Slightly thicken existing lash strands
• Extend existing lash tips by a small, natural amount

If a lash is not visible in the source image,
it must NOT appear in the result.

ABSOLUTE GUARDRAILS (DO NOT VIOLATE)

Do NOT change:
• Eye shape or size
• Eyelids or under-eye area
• Brows
• Skin texture or tone
• Facial makeup
• Lighting, shadows, contrast, or color grading

Do NOT add:
• Eyeliner
• Eyeshadow
• Lash extensions
• Smudging or shadowing on the eyelid
• New lashes or lash rows

Prevent clumping, spider lashes, or lash merging at all times.

If a pixel is not part of an existing eyelash,
it must remain untouched.', 1, 100),

-- Eyebrow Enhancer Parameters (Category 10)
('00000000-0000-0001-0000-000000000061', '00000000-0000-0000-0000-00000000000a', 'accent_coverage', 'Coverage', 'How much of the brow should be enhanced?', false, NULL, 2, 1),
('00000000-0000-0001-0000-000000000062', '00000000-0000-0000-0000-00000000000a', 'coverage_style', 'Style', 'What application style?', false, NULL, 2, 2),
('00000000-0000-0001-0000-000000000063', '00000000-0000-0000-0000-00000000000a', 'depth_limit', 'Depth', 'How dark should the enhancement be?', false, NULL, 2, 3),
('00000000-0000-0001-0000-000000000064', '00000000-0000-0000-0000-00000000000a', 'sparse_support', 'Sparse Brow Support', NULL, true,
E'These strokes must:
• Follow natural hair direction
• Match nearby hair thickness
• Appear irregular and subtle
• Remain secondary to real hairs

If eyebrow hairs are sparse or widely spaced,
allow a very small number of short, hair-like accent strokes
ONLY within the existing eyebrow silhouette.

Do NOT extend brow shape.
Do NOT increase brow width, length, or arch.', 1, 99),
('00000000-0000-0001-0000-000000000065', '00000000-0000-0000-0000-00000000000a', 'brow_color_profile', 'Shade', 'What shade should the enhancement match?', false, NULL, 1, 4),
('00000000-0000-0001-0000-000000000066', '00000000-0000-0000-0000-00000000000a', 'guardrails', 'Guardrails', NULL, true,
E'The same person, same face, same lighting —

with eyebrows that appear subtly touched up,
with improved definition on select hairs only,
never uniform, never fuzzy, never obviously "done."', 1, 100),

-- Hair Health Parameters (Category 11)
('00000000-0000-0001-0000-000000000069', '00000000-0000-0000-0000-00000000000b', 'frizz_reduction', 'Frizz Control', 'How much frizz should be reduced?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000070', '00000000-0000-0000-0000-00000000000b', 'definition_boost', 'Definition', 'How defined should the hair look?', false, NULL, 4, 2),
('00000000-0000-0001-0000-000000000071', '00000000-0000-0000-0000-00000000000b', 'lift_at_roots', 'Root Lift', 'How much lift at the roots?', false, NULL, 4, 3),
('00000000-0000-0001-0000-000000000072', '00000000-0000-0000-0000-00000000000b', 'surface_smoothness', 'Smoothness', 'How smooth should the hair surface be?', false, NULL, 4, 4),
('00000000-0000-0001-0000-000000000073', '00000000-0000-0000-0000-00000000000b', 'hydration_sheen', 'Sheen', 'What finish should the hair have?', false, NULL, 3, 5),
('00000000-0000-0001-0000-000000000074', '00000000-0000-0000-0000-00000000000b', 'guardrails', 'Guardrails', NULL, true,
E'PATTERN-AWARE INTERPRETATION (AUTO)

Apply all improvements ONLY within the existing hair pattern.

If hair is curly/wavy/coily:
• Definition = clearer curl grouping and reduced surface frizz
• Smoothness = reduced fuzz on curl surfaces (do NOT loosen, relax, or straighten curls)
• Lift = increased root bounce without elongating curls
• Preserve curl diameter, direction, and natural shrinkage

If hair is straight:
• Definition = clearer strand separation and alignment
• Smoothness = reduced flyaways and surface roughness (do NOT introduce waves)
• Lift = subtle root volume without changing direction or creating bends

FINAL RESULT SHOULD LOOK LIKE

The same person, same lighting, same hairstyle —
with hair that looks cleaner, healthier, more defined, and less frizzy,
as if freshly washed and conditioned, while remaining fully realistic.', 1, 100)

ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 3: Insert Parameter Levels
-- This is split into multiple parts due to size
-- ============================================

-- Part 1: Skin Refinement Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Evenness (param 1)
('00000000-0000-0002-0000-000000000001', '00000000-0000-0001-0000-000000000001', 1, 'No change',
E'Gently soften the appearance of minor uneven skin tone and faint blotchiness by approximately 5–10%, focusing only on subtle transitions between naturally occurring color variations. Preserve all natural skin characteristics, including pores, freckles, moles, fine lines, acne, and texture. The skin should retain its full individuality and lived-in realism, with unevenness still clearly present. Do not alter the underlying skin tone, ethnicity, or overall complexion, and do not blur, smooth, or homogenize the skin surface.', 1),
('00000000-0000-0002-0000-000000000002', '00000000-0000-0001-0000-000000000001', 2, 'Subtle',
E'Moderately reduce visible patchiness and uneven tone by approximately 15–25%, creating a more harmonious appearance while keeping natural variation intact. Areas of redness, shadowing, or mild discoloration may appear more visually balanced, but distinct tonal differences must remain observable. Skin texture, pores, freckles, scars, and fine lines must stay fully visible. Do not flatten the skin into a uniform color field, and do not apply any makeup-like coverage, tinting, or retouching effects.', 2),
('00000000-0000-0002-0000-000000000003', '00000000-0000-0001-0000-000000000001', 3, 'Moderate',
E'Noticeably soften uneven skin tone and blotchy transitions by approximately 30–40%, resulting in a clearer and more consistent overall look that still reads as real human skin. Natural variation, pigmentation, and texture must remain present, with imperfections reduced in contrast rather than removed. The skin should look healthier, not perfected. Do not erase freckles, moles, acne, or scars, and do not shift or lighten the underlying skin tone.', 3),
('00000000-0000-0002-0000-000000000004', '00000000-0000-0001-0000-000000000001', 4, 'Strong',
E'Apply the strongest safe reduction of uneven tone by approximately 45–55%, achieving a visibly more even and calm complexion while strictly preserving realism. Color transitions should appear smoother, but the skin must still show natural variation, texture, and imperfection at close inspection. This tier represents the upper limit of believable refinement. Do not create a uniform or airbrushed appearance, do not remove defining skin features, and do not alter skin tone, ethnicity, or identity.', 4),

-- Hydration Glow (param 2)
('00000000-0000-0002-0000-000000000005', '00000000-0000-0001-0000-000000000002', 1, 'No glow',
E'Introduce a very subtle increase in the appearance of skin hydration and comfort by approximately 5–10%, giving the skin a slightly fresher, more rested look without visible shine. The effect should appear as gentle light responsiveness within the skin, not on top of it. All natural texture, pores, freckles, fine lines, and imperfections must remain fully visible. Do not add gloss, oiliness, or reflective highlights, and do not create any makeup-like glow or surface shine.', 1),
('00000000-0000-0002-0000-000000000006', '00000000-0000-0001-0000-000000000002', 2, 'Subtle',
E'Enhance the appearance of well-hydrated, healthy skin by approximately 15–25%, introducing a soft, natural luminosity that suggests improved moisture balance. The skin may look more supple and comfortable, but it must still read as real skin with visible texture and variation. Any glow should be diffuse and skin-integrated. Do not blur texture, do not create wet or glossy areas, and do not alter underlying skin tone or coloration.', 2),
('00000000-0000-0002-0000-000000000007', '00000000-0000-0001-0000-000000000002', 3, 'Healthy glow',
E'Apply a clearly noticeable yet realistic hydration effect by approximately 30–40%, giving the skin a visibly dewy, resilient appearance associated with well-moisturized skin. Light should interact more evenly across the skin surface, while pores, fine lines, freckles, and natural irregularities remain intact. The glow must remain soft and balanced. Do not produce a glass-skin, oily, or reflective sheen, and do not obscure or smooth natural skin texture.', 3),
('00000000-0000-0002-0000-000000000008', '00000000-0000-0001-0000-000000000002', 4, 'Luminous',
E'Apply the strongest believable hydration enhancement by approximately 45–55%, creating a luminous, healthy-looking complexion that still maintains full realism. The skin should appear optimally hydrated and comfortable, with gentle, evenly distributed luminosity that never overpowers texture or detail. This tier represents the upper limit of natural glow. Do not introduce shine hotspots, makeup-like radiance, or artificial smoothness, and do not remove pores, fine lines, or natural variation.', 4),

-- Redness Softening (param 3)
('00000000-0000-0002-0000-000000000009', '00000000-0000-0001-0000-000000000003', 1, 'Natural',
E'Gently soften the appearance of mild surface redness by approximately 5–10%, focusing on reducing sharp contrast between red areas and surrounding skin without eliminating redness entirely. The skin should still show natural flush, variation, and circulation. All pores, freckles, acne, scars, fine lines, and texture must remain fully visible. Do not neutralize redness completely, do not gray or mute the skin, and do not alter the underlying skin tone or ethnicity.', 1),
('00000000-0000-0002-0000-000000000010', '00000000-0000-0001-0000-000000000003', 2, 'Subtle',
E'Moderately reduce the appearance of visible redness by approximately 15–25%, creating a calmer and more balanced look while preserving natural skin variation. Red areas may appear less intense, but they must remain present and believable. Texture, pigmentation, and micro-detail must stay intact at all times. Do not flatten the skin into a uniform color, do not remove healthy natural flush, and do not introduce makeup-like color correction.', 2),
('00000000-0000-0002-0000-000000000011', '00000000-0000-0001-0000-000000000003', 3, 'Moderate',
E'Noticeably soften redness and reactive-looking areas by approximately 30–40%, resulting in a visibly calmer complexion that still reads as real skin. Redness should be reduced in contrast rather than erased, and areas of natural coloration must remain distinguishable. All natural texture, pores, and imperfections must stay visible. Do not eliminate redness entirely, do not desaturate the skin unnaturally, and do not create a color-corrected or foundation-like appearance.', 3),
('00000000-0000-0002-0000-000000000012', '00000000-0000-0001-0000-000000000003', 4, 'Strong',
E'Apply the strongest safe reduction of visible redness by approximately 45–55%, reaching the upper limit of natural-looking calmness while preserving full realism. The skin should appear soothed and balanced, but still alive with natural color variation and texture. This tier represents refinement, not correction. Do not remove all redness, do not shift the skin toward gray or yellow tones, and do not compromise skin identity or natural complexion depth.', 4),

-- Brightness (param 4)
('00000000-0000-0002-0000-000000000013', '00000000-0000-0001-0000-000000000004', 1, 'No change',
E'**Preserve the skin''s original brightness exactly as captured in the photo.**

No lifting, lightening, or luminosity adjustment should be applied. Shadows, highlights, and natural contrast must remain unchanged. Skin tone, depth, and perceived lightness must stay identical to the original image. All texture, pores, freckles, pigmentation, and natural variation must remain fully visible.

This option should look like the same photo under the same lighting, with no brightness enhancement applied.', 1),
('00000000-0000-0002-0000-000000000014', '00000000-0000-0001-0000-000000000004', 2, 'Subtle',
E'Introduce a very subtle brightness lift of approximately 2–5%, gently improving clarity in dull areas without changing the underlying skin tone or depth. The effect should feel like slightly better lighting, not skin lightening. Brightness must be evenly distributed and must not flatten contrast or remove shadows. Texture, pores, freckles, fine lines, scars, and pigmentation must remain fully visible. Do not create a washed-out, pale, or whitened appearance.', 2),
('00000000-0000-0002-0000-000000000015', '00000000-0000-0001-0000-000000000004', 3, 'Moderate',
E'Apply a moderate brightness lift of approximately 6–10%, resulting in a visibly brighter and more refreshed appearance while preserving natural skin depth and variation. The skin may look more awake and energized, but must still read as real, dimensional skin. Brightness should not erase shadows, compress contrast, or reduce melanin-driven depth. Do not introduce any makeup-like brightening or whitening effects.', 3),
('00000000-0000-0002-0000-000000000016', '00000000-0000-0001-0000-000000000004', 4, 'Radiant',
E'Apply the strongest safe brightness adjustment (approximately 11–15%), reaching the upper limit of natural-looking luminosity while fully preserving realism and identity. The skin should appear brighter and more vibrant, similar to being photographed in more flattering light, not lighter in color. Texture, pigmentation, contrast, and depth must remain intact. Do not alter the underlying skin tone, ethnicity, or complexion identity. Do not produce a flat, pale, or overexposed look.', 4),

-- Fine Lines (param 5)
('00000000-0000-0002-0000-000000000017', '00000000-0000-0001-0000-000000000005', 1, 'Natural',
E'Do not alter the appearance of fine lines or wrinkles.
Preserve all natural line contrast exactly as-is.', 1),
('00000000-0000-0002-0000-000000000018', '00000000-0000-0001-0000-000000000005', 2, 'Subtle',
E'Gently soften the appearance of existing fine lines
by slightly reducing dryness and harsh shadowing within the lines only.

The change should be barely perceptible,
reading as healthier, more hydrated skin rather than smoothing.

No texture loss is allowed.', 2),
('00000000-0000-0002-0000-000000000019', '00000000-0000-0001-0000-000000000005', 3, 'Moderate',
E'Noticeably soften the appearance of existing fine lines
by reducing internal contrast and dryness within the creases.

Lines should appear less sharp and less dry,
while remaining clearly present and fully textured.

Do NOT blur surrounding skin or reduce pore visibility.', 3),
('00000000-0000-0002-0000-000000000020', '00000000-0000-0001-0000-000000000005', 4, 'Strong',
E'Create a clearly visible softening of existing fine lines
by smoothing harsh contrast and dryness within the creases.

The lines should look more hydrated and cushioned,
but must remain natural, textured, and unchanged in position.

No line removal, no skin flattening, no airbrushing.', 4)

ON CONFLICT (id) DO NOTHING;

-- Part 2: Acne & Redness Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Redness Reduction (param 8)
('00000000-0000-0002-0000-000000000021', '00000000-0000-0001-0000-000000000008', 1, 'Natural',
E'Slightly soften inflammation-related redness by approximately 15–20%.
Redness should appear marginally calmer but still clearly present.', 1),
('00000000-0000-0002-0000-000000000022', '00000000-0000-0001-0000-000000000008', 2, 'Subtle',
E'Reduce inflammation-related redness by approximately 30–40%.
Red halos around acne should appear visibly softer while remaining identifiable.', 2),
('00000000-0000-0002-0000-000000000023', '00000000-0000-0001-0000-000000000008', 3, 'Moderate',
E'Reduce inflammation-related redness by approximately 45–55%.
Affected areas should look noticeably calmer and less reactive.', 3),
('00000000-0000-0002-0000-000000000024', '00000000-0000-0001-0000-000000000008', 4, 'Strong',
E'Reduce inflammation-related redness by approximately 60–70%.
Redness should be clearly reduced while preserving natural undertones and variation.', 4),

-- Blemish Softening (param 9)
('00000000-0000-0002-0000-000000000025', '00000000-0000-0001-0000-000000000009', 1, 'Natural',
E'Slightly soften the visual harshness of acne lesions without changing their size.', 1),
('00000000-0000-0002-0000-000000000026', '00000000-0000-0001-0000-000000000009', 2, 'Subtle',
E'Moderately reduce the visual dominance of acne lesions, making them less distracting while still present.', 2),
('00000000-0000-0002-0000-000000000027', '00000000-0000-0001-0000-000000000009', 3, 'Moderate',
E'Reduce the size, redness, and visual prominence of acne lesions by approximately 40–50%.
Lesions may appear flatter and less inflamed.', 3),
('00000000-0000-0002-0000-000000000028', '00000000-0000-0001-0000-000000000009', 4, 'Strong',
E'Reduce the size and prominence of mild-to-moderate acne lesions by approximately 60–70%.
Severe acne must remain visible.', 4),

-- Contrast Reduction (param 10)
('00000000-0000-0002-0000-000000000029', '00000000-0000-0001-0000-000000000010', 1, 'Natural',
E'Slightly soften harsh contrast around acne-affected areas.', 1),
('00000000-0000-0002-0000-000000000030', '00000000-0000-0001-0000-000000000010', 2, 'Subtle',
E'Reduce sharp tonal contrast around blemishes to create smoother transitions.', 2),
('00000000-0000-0002-0000-000000000031', '00000000-0000-0001-0000-000000000010', 3, 'Moderate',
E'Reduce contrast and harsh edge definition around acne by approximately 30–40%.
Preserve depth and three-dimensional form.', 3),
('00000000-0000-0002-0000-000000000032', '00000000-0000-0001-0000-000000000010', 4, 'Strong',
E'Strongly soften contrast around acne-prone regions while maintaining realistic skin depth.', 4),

-- Acne Handling (param 11)
('00000000-0000-0002-0000-000000000033', '00000000-0000-0001-0000-000000000011', 1, 'As-is',
E'Do not remove acne lesions.
All acne must remain clearly visible.', 1),
('00000000-0000-0002-0000-000000000034', '00000000-0000-0001-0000-000000000011', 2, 'Slight improvement',
E'Permit partial fading of mild acne lesions in a way that appears gradual and time-based.
All moderate and severe acne must remain present.', 2),
('00000000-0000-0002-0000-000000000035', '00000000-0000-0001-0000-000000000011', 3, 'Strong results',
E'Permit visible reduction of mild-to-moderate acne lesions to reflect strong skincare efficacy.
Do not fully erase all acne.
Texture and pores must remain intact.', 3)

ON CONFLICT (id) DO NOTHING;

-- Part 3: Brightening & Tone Boost Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Dark Spot Softening (param 13)
('00000000-0000-0002-0000-000000000036', '00000000-0000-0001-0000-000000000013', 1, 'No change',
E'Slightly soften the appearance of individual dark spots and post-blemish marks.
Spots should remain clearly visible with minimal change.', 1),
('00000000-0000-0002-0000-000000000037', '00000000-0000-0001-0000-000000000013', 2, 'Subtle',
E'Lighten individual dark spots and post-blemish marks by approximately 25–35%.
Spots should appear visibly softer but still clearly present.', 2),
('00000000-0000-0002-0000-000000000038', '00000000-0000-0001-0000-000000000013', 3, 'Moderate',
E'Lighten individual dark spots, sun spots, and post-blemish marks by approximately 45–55%.
Keep all spots visible but noticeably softened. Do not erase any spot entirely.', 3),
('00000000-0000-0002-0000-000000000039', '00000000-0000-0001-0000-000000000013', 4, 'Strong',
E'Lighten individual dark spots, sun spots, and post-blemish marks by approximately 45–55%.
Keep all spots visible but noticeably softened. Do not erase any spot entirely.', 4),

-- Glow Boost (param 14)
('00000000-0000-0002-0000-000000000040', '00000000-0000-0001-0000-000000000014', 1, 'Natural',
E'Add a slight increase in natural skin luminosity with minimal surface glow.', 1),
('00000000-0000-0002-0000-000000000041', '00000000-0000-0001-0000-000000000014', 2, 'Light glow',
E'Increase natural luminosity and surface glow by approximately 25–30%, while keeping lighting direction unchanged.', 2),
('00000000-0000-0002-0000-000000000042', '00000000-0000-0001-0000-000000000014', 3, 'Radiant',
E'Increase natural luminosity and hydrated glow by approximately 35–45%.
Add a subtle hydrated sheen on high points (cheeks, forehead center, nose bridge) without altering facial structure.', 3),
('00000000-0000-0002-0000-000000000043', '00000000-0000-0001-0000-000000000014', 4, 'Very glowy',
E'Increase natural luminosity and glow by approximately 55–60%.
Glow must remain hydrated and skin-like, not glossy or makeup-like.', 4),

-- Texture Refinement (param 15)
('00000000-0000-0002-0000-000000000044', '00000000-0000-0001-0000-000000000015', 1, 'Natural',
E'Slightly refine rough or uneven skin patches while preserving full texture.', 1),
('00000000-0000-0002-0000-000000000045', '00000000-0000-0001-0000-000000000015', 2, 'Subtle',
E'Smooth rough or uneven skin patches by approximately 20–25%.
Preserve pores and microtexture.', 2),
('00000000-0000-0002-0000-000000000046', '00000000-0000-0001-0000-000000000015', 3, 'Moderate',
E'Refine rough or uneven patches by approximately 30–35%.
Reduce enlarged-pore visibility (especially nose and cheeks) by approximately 25%, without blurring pores.', 3),
('00000000-0000-0002-0000-000000000047', '00000000-0000-0001-0000-000000000015', 4, 'Refined',
E'Refine texture and reduce enlarged-pore visibility by approximately 40%.
Maintain skin detail and microtexture everywhere.', 4),

-- Redness Softening for Brightening (param 16)
('00000000-0000-0002-0000-000000000048', '00000000-0000-0001-0000-000000000016', 1, 'Natural',
E'Slightly soften redness and irritation while preserving undertones.', 1),
('00000000-0000-0002-0000-000000000049', '00000000-0000-0001-0000-000000000016', 2, 'Subtle',
E'Reduce redness, inflammation, and irritation by approximately 25–30%.', 2),
('00000000-0000-0002-0000-000000000050', '00000000-0000-0001-0000-000000000016', 3, 'Moderate',
E'Reduce redness and irritation by approximately 40–45%, keeping undertones intact.', 3),
('00000000-0000-0002-0000-000000000051', '00000000-0000-0001-0000-000000000016', 4, 'Strong',
E'Reduce redness and irritation by approximately 55–60%.
Skin should appear calmer while maintaining natural coloration.', 4),

-- Brightness Shift for Brightening (param 17)
('00000000-0000-0002-0000-000000000052', '00000000-0000-0001-0000-000000000017', 1, 'No change',
E'Apply a very slight perceptual brightness lift without altering skin tone.', 1),
('00000000-0000-0002-0000-000000000053', '00000000-0000-0001-0000-000000000017', 2, 'Subtle',
E'Apply a subtle brightness lift to improve clarity and freshness while preserving complexion depth.', 2),
('00000000-0000-0002-0000-000000000054', '00000000-0000-0001-0000-000000000017', 3, 'Moderate',
E'Apply a moderate perceptual brightness lift to enhance overall clarity and radiance.
Do not lighten skin color.', 3),
('00000000-0000-0002-0000-000000000055', '00000000-0000-0001-0000-000000000017', 4, 'Maximum',
E'Apply the maximum allowed perceptual brightness lift while fully preserving underlying skin tone and ethnicity.', 4),

-- Fine Line Softening for Brightening (param 18)
('00000000-0000-0002-0000-000000000056', '00000000-0000-0001-0000-000000000018', 1, 'Natural',
E'Do not alter the appearance of fine lines or wrinkles.
Preserve all natural line contrast exactly as-is.', 1),
('00000000-0000-0002-0000-000000000057', '00000000-0000-0001-0000-000000000018', 2, 'Subtle',
E'Gently soften the appearance of existing fine lines
by slightly reducing dryness and harsh shadowing within the lines only.

The change should be barely perceptible,
reading as healthier, more hydrated skin rather than smoothing.

No texture loss is allowed.', 2),
('00000000-0000-0002-0000-000000000058', '00000000-0000-0001-0000-000000000018', 3, 'Moderate',
E'Noticeably soften the appearance of existing fine lines
by reducing internal contrast and dryness within the creases.

Lines should appear less sharp and less dry,
while remaining clearly present and fully textured.

Do NOT blur surrounding skin or reduce pore visibility.', 3),

-- Acne Mode for Brightening (param 19)
('00000000-0000-0002-0000-000000000059', '00000000-0000-0001-0000-000000000019', 1, 'As-is',
E'Do not remove acne or pimples.
All active acne lesions must remain present and recognizable.
No size reduction of lesions is allowed in this mode.', 1),
('00000000-0000-0002-0000-000000000060', '00000000-0000-0001-0000-000000000019', 2, 'Slight improvement',
E'Do not remove acne overall.
Tiny surface-level red pinpoint blemishes may be softened slightly (≈10–20%) as a natural side effect of tone evening.
Moderate and severe acne bumps must remain fully intact.', 2),
('00000000-0000-0002-0000-000000000061', '00000000-0000-0001-0000-000000000019', 3, 'Mild reduction',
E'Permit mild acne improvement only.
Reduce the redness and visual prominence of mild acne lesions by ≈25–35%, while keeping them visible and textured.
Moderate and severe acne must remain clearly present with no full clearing.
No makeup-like coverage, no global smoothing.', 3)

ON CONFLICT (id) DO NOTHING;

-- Part 4: Blush Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Flush Visibility (param 22)
('00000000-0000-0002-0000-000000000062', '00000000-0000-0001-0000-000000000022', 1, 'Barely there',
E'Apply a very soft, low-visibility cheek flush.
Color should be subtle and lightly diffused, resembling a natural hint of warmth.', 1),
('00000000-0000-0002-0000-000000000063', '00000000-0000-0001-0000-000000000022', 2, 'Subtle',
E'Apply a natural-looking cheek flush with moderate visibility.
Color should be clearly present but softly diffused into the skin.', 2),
('00000000-0000-0002-0000-000000000064', '00000000-0000-0001-0000-000000000022', 3, 'Visible',
E'Apply a clearly visible cheek flush with strong skin integration.
Color should be apparent at a glance while remaining translucent and natural.', 3),
('00000000-0000-0002-0000-000000000065', '00000000-0000-0001-0000-000000000022', 4, 'Bold',
E'Apply a bold, statement cheek flush.
Color should be vibrant yet still translucent and skin-based, never opaque or painted.', 4),

-- Finish Style (param 23)
('00000000-0000-0002-0000-000000000066', '00000000-0000-0001-0000-000000000023', 1, 'Satin',
E'Finish should appear smooth and skin-like with no shine.
No shimmer, sparkle, or highlight effect.', 1),
('00000000-0000-0002-0000-000000000067', '00000000-0000-0001-0000-000000000023', 2, 'Dewy',
E'Add a hydrated, moisturized glow across the blush area.
Glow should feel soft and skin-based, not glossy or metallic.', 2),
('00000000-0000-0002-0000-000000000068', '00000000-0000-0001-0000-000000000023', 3, 'Juicy',
E'Add a hydrated, moisturized glow across the blush area.
Glow should feel soft and skin-based, not glossy or metallic.', 3),

-- Placement Style (param 24)
('00000000-0000-0002-0000-000000000069', '00000000-0000-0001-0000-000000000024', 1, 'Lifted',
E'Apply blush primarily along the upper outer cheekbone, lifted upward.
Avoid lower cheek, jawline, smile lines, or mid-face widening.', 1),
('00000000-0000-0002-0000-000000000070', '00000000-0000-0001-0000-000000000024', 2, 'Upper cheek',
E'Apply blush across the upper cheek and soft apple area.
Maintain lift while allowing a slightly fuller cheek presence.', 2),
('00000000-0000-0002-0000-000000000071', '00000000-0000-0001-0000-000000000024', 3, 'Diffused',
E'Apply blush across the upper cheek and soft apple area.
Maintain lift while allowing a slightly fuller cheek presence.', 3),

-- Redness Avoidance (param 25)
('00000000-0000-0002-0000-000000000072', '00000000-0000-0001-0000-000000000025', 1, 'Apply normally',
E'Apply blush normally across the defined cheek areas.', 1),
('00000000-0000-0002-0000-000000000073', '00000000-0000-0001-0000-000000000025', 2, 'Avoid red areas',
E'If redness or acne is present on the cheeks, shift blush placement slightly upward.
Allow glow to remain but avoid intensifying existing redness.', 2)

ON CONFLICT (id) DO NOTHING;

-- Part 5: Bronzer Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Placement Zone (param 28)
('00000000-0000-0002-0000-000000000074', '00000000-0000-0001-0000-000000000028', 1, 'Cheekbones',
E'Apply the bronzed effect ONLY along the upper cheekbone ridge,
following the natural light-catching band of the outer cheek.', 1),
('00000000-0000-0002-0000-000000000075', '00000000-0000-0001-0000-000000000028', 2, 'Temples',
E'Extend the bronzed effect subtly toward the outer eye and temple area,
keeping the application lifted and away from the center of the face.', 2),
('00000000-0000-0002-0000-000000000076', '00000000-0000-0001-0000-000000000028', 3, 'Jawline',
E'Apply a very soft, blended bronzed warmth along the outer jawline only,
without sculpting, shadow carving, or shape definition.', 3),
('00000000-0000-0002-0000-000000000077', '00000000-0000-0001-0000-000000000028', 4, 'Multiple areas',
E'Apply bronzed warmth across cheekbones with a soft extension toward temples
and a very subtle blend along the outer jawline, keeping all effects localized
and away from the center of the face.', 4),

-- Warmth Level (param 29)
('00000000-0000-0002-0000-000000000078', '00000000-0000-0001-0000-000000000029', 1, 'Neutral',
E'Maintain a neutral bronzed tone without additional warmth bias.', 1),
('00000000-0000-0002-0000-000000000079', '00000000-0000-0001-0000-000000000029', 2, 'Subtle warmth',
E'Introduce a gentle warmth to the bronzed tone while remaining neutral and skin-integrated.', 2),
('00000000-0000-0002-0000-000000000080', '00000000-0000-0001-0000-000000000029', 3, 'Moderate warmth',
E'Add a noticeable but balanced warm undertone to the bronzed effect,
without shifting toward red, pink, or orange.', 3),
('00000000-0000-0002-0000-000000000081', '00000000-0000-0001-0000-000000000029', 4, 'Warm',
E'Create a clearly warm bronzed tone that still appears natural and skin-integrated,
never orange, red, or artificial.', 4),

-- Depth Intensity (param 30)
('00000000-0000-0002-0000-000000000082', '00000000-0000-0001-0000-000000000030', 1, 'Subtle',
E'Keep pigment depth very light, with dimension coming primarily from reflectivity rather than color.', 1),
('00000000-0000-0002-0000-000000000083', '00000000-0000-0001-0000-000000000030', 2, 'Medium',
E'Apply a balanced bronzed depth that is clearly visible but still natural and translucent.', 2),
('00000000-0000-0002-0000-000000000084', '00000000-0000-0001-0000-000000000030', 3, 'Visible',
E'Create a clearly visible bronzed depth that adds strong dimension without appearing painted on.', 3),
('00000000-0000-0002-0000-000000000085', '00000000-0000-0001-0000-000000000030', 4, 'Bold',
E'Apply a strong bronzed depth that is unmistakable in before/after comparison,
while remaining localized and realistic.', 4),

-- Reflectivity (param 31)
('00000000-0000-0002-0000-000000000086', '00000000-0000-0001-0000-000000000031', 1, 'Matte',
E'Keep surface reflectivity minimal, with a soft, skin-like matte finish.', 1),
('00000000-0000-0002-0000-000000000087', '00000000-0000-0001-0000-000000000031', 2, 'Satin',
E'Introduce a gentle satin sheen that softly catches existing light.', 2),
('00000000-0000-0002-0000-000000000088', '00000000-0000-0001-0000-000000000031', 3, 'Luminous',
E'Create a luminous reflective sheen that visibly catches light without appearing oily or wet.', 3),

-- Blend Softness (param 32)
('00000000-0000-0002-0000-000000000089', '00000000-0000-0001-0000-000000000032', 1, 'Defined',
E'Maintain defined but still natural edges, avoiding harsh lines.', 1),
('00000000-0000-0002-0000-000000000090', '00000000-0000-0001-0000-000000000032', 2, 'Soft',
E'Blend edges smoothly so the bronzed effect transitions naturally into surrounding skin.', 2),
('00000000-0000-0002-0000-000000000091', '00000000-0000-0001-0000-000000000032', 3, 'Seamless',
E'Blend very softly so the bronzed effect diffuses seamlessly into the skin with no visible edges.', 3)

ON CONFLICT (id) DO NOTHING;

-- Part 6: Highlighter Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Placement Zone (param 34)
('00000000-0000-0002-0000-000000000092', '00000000-0000-0001-0000-000000000034', 1, 'Cheekbones',
E'Apply highlight ONLY to the upper cheekbone high points,
following the natural light-catching ridge of the outer cheek.', 1),
('00000000-0000-0002-0000-000000000093', '00000000-0000-0001-0000-000000000034', 2, 'Brow bone',
E'Apply a very light highlight to the brow bone ONLY where it naturally catches light,
keeping the effect subtle and lifted.', 2),
('00000000-0000-0002-0000-000000000094', '00000000-0000-0001-0000-000000000034', 3, 'Cupid''s bow',
E'Apply a minimal, precise highlight to the cupid''s bow only,
avoiding the lips themselves and surrounding skin.', 3),
('00000000-0000-0002-0000-000000000095', '00000000-0000-0001-0000-000000000034', 4, 'Multiple areas',
E'Apply highlight to cheekbone high points with optional, very subtle placement
on the brow bone and cupid''s bow, keeping all effects localized and balanced.', 4),

-- Shine Intensity (param 35)
('00000000-0000-0002-0000-000000000096', '00000000-0000-0001-0000-000000000035', 1, 'Subtle',
E'Create a soft, barely-there increase in radiance,
visible only through gentle light reflection.', 1),
('00000000-0000-0002-0000-000000000097', '00000000-0000-0001-0000-000000000035', 2, 'Medium',
E'Add a clearly visible but natural highlight,
enhancing radiance without drawing sharp attention.', 2),
('00000000-0000-0002-0000-000000000098', '00000000-0000-0001-0000-000000000035', 3, 'High',
E'Create a strong, luminous highlight that is clearly visible in before/after comparison,
while remaining translucent and skin-integrated.', 3),
('00000000-0000-0002-0000-000000000099', '00000000-0000-0001-0000-000000000035', 4, 'Intense',
E'Apply a very high level of reflectivity that produces a striking highlight effect,
without appearing metallic, stripe-like, or artificial.', 4),

-- Reflective Grain (param 36)
('00000000-0000-0002-0000-000000000100', '00000000-0000-0001-0000-000000000036', 1, 'Fine',
E'Use ultra-fine pearl reflectivity with no visible particles,
glitter, or shimmer texture.', 1),
('00000000-0000-0002-0000-000000000101', '00000000-0000-0001-0000-000000000036', 2, 'Medium',
E'Use slightly larger pearl reflectivity that remains smooth and refined,
never chunky, glittery, or metallic.', 2),

-- Falloff Softness (param 37)
('00000000-0000-0002-0000-000000000102', '00000000-0000-0001-0000-000000000037', 1, 'Concentrated',
E'Maintain a more concentrated highlight with controlled edges,
while still avoiding harsh lines.', 1),
('00000000-0000-0002-0000-000000000103', '00000000-0000-0001-0000-000000000037', 2, 'Smooth fade',
E'Blend the highlight smoothly so it transitions naturally into surrounding skin.', 2),
('00000000-0000-0002-0000-000000000104', '00000000-0000-0001-0000-000000000037', 3, 'Diffused',
E'Diffuse the highlight very softly,
creating a seamless falloff with no visible edges or bands.', 3),

-- Color Temperature (param 38)
('00000000-0000-0002-0000-000000000105', '00000000-0000-0001-0000-000000000038', 1, 'Neutral',
E'Keep the highlight color balanced and neutral,
without warmth or coolness bias.', 1),
('00000000-0000-0002-0000-000000000106', '00000000-0000-0001-0000-000000000038', 2, 'Warm',
E'Introduce a subtle warm bias to the reflected light,
without shifting toward gold, bronze, or blush tones.', 2),
('00000000-0000-0002-0000-000000000107', '00000000-0000-0001-0000-000000000038', 3, 'Cool',
E'Introduce a subtle cool bias to the reflected light,
without appearing white, gray, or icy.', 3)

ON CONFLICT (id) DO NOTHING;

-- Part 7: Lip Hydration Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Hydration Level (param 40)
('00000000-0000-0002-0000-000000000108', '00000000-0000-0001-0000-000000000040', 1, 'Slightly healthier',
E'Slightly increase the appearance of moisture and hydration,
with a gentle improvement in softness.', 1),
('00000000-0000-0002-0000-000000000109', '00000000-0000-0001-0000-000000000040', 2, 'Moisturized',
E'Create a clearly noticeable increase in lip hydration,
making the lips appear healthier and more nourished.', 2),
('00000000-0000-0002-0000-000000000110', '00000000-0000-0001-0000-000000000040', 3, 'Very hydrated',
E'Make the lips appear significantly more hydrated and conditioned,
with visible softness and moisture.', 3),
('00000000-0000-0002-0000-000000000111', '00000000-0000-0001-0000-000000000040', 4, 'Deeply conditioned',
E'Create a strong hydration effect,
making the lips look deeply nourished and freshly treated,
while remaining natural.', 4),

-- Sheen Finish (param 41)
('00000000-0000-0002-0000-000000000112', '00000000-0000-0001-0000-000000000041', 1, 'Natural',
E'Keep surface shine minimal,
with hydration visible through softness rather than gloss.', 1),
('00000000-0000-0002-0000-000000000113', '00000000-0000-0001-0000-000000000041', 2, 'Soft sheen',
E'Add a subtle, natural satin sheen that reflects healthy moisture,
not wet shine.', 2),
('00000000-0000-0002-0000-000000000114', '00000000-0000-0001-0000-000000000041', 3, 'Light gloss',
E'Introduce a gentle, balm-like gloss that appears smooth and conditioned,
never wet, glassy, or reflective like lip gloss.', 3),

-- Texture Preservation (param 42)
('00000000-0000-0002-0000-000000000115', '00000000-0000-0001-0000-000000000042', 1, 'Natural texture',
E'Preserve all natural lip texture, fine lines, creases, and highlights.
Do NOT smooth, blur, or soften texture in any way.', 1),
('00000000-0000-0002-0000-000000000116', '00000000-0000-0001-0000-000000000042', 2, 'Slightly smoother',
E'Preserve natural lip texture while allowing very mild visual softening
from hydration only.
Do NOT blur or airbrush.', 2),

-- Edge Precision (param 43)
('00000000-0000-0002-0000-000000000117', '00000000-0000-0001-0000-000000000043', 1, 'Soft edges',
E'Keep the natural lip edges soft and unchanged,
with no over-definition.', 1),
('00000000-0000-0002-0000-000000000118', '00000000-0000-0001-0000-000000000043', 2, 'Defined edges',
E'Maintain clean, well-defined lip edges
without altering lip shape or size.', 2)

ON CONFLICT (id) DO NOTHING;

-- Part 8: Lip Gloss Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Gloss Intensity (param 45)
('00000000-0000-0002-0000-000000000119', '00000000-0000-0001-0000-000000000045', 1, 'Glossy',
E'Create a clearly glossy finish with visible shine,
noticeable but not dramatic.', 1),
('00000000-0000-0002-0000-000000000120', '00000000-0000-0001-0000-000000000045', 2, 'Very glossy',
E'Apply a strong, wet-looking gloss that is immediately visible,
with clear light reflection.', 2),
('00000000-0000-0002-0000-000000000121', '00000000-0000-0001-0000-000000000045', 3, 'High-shine',
E'Create a bold, lacquered gloss with intense shine,
clearly reading as lip gloss in before/after comparison.', 3),
('00000000-0000-0002-0000-000000000122', '00000000-0000-0001-0000-000000000045', 4, 'Ultra-glossy',
E'Apply a maximum-impact, glassy lip oil effect,
with very strong specular highlights and wet shine.', 4),

-- Tint Level (param 46)
('00000000-0000-0002-0000-000000000123', '00000000-0000-0001-0000-000000000046', 1, 'Clear',
E'Preserve the original lip color exactly.
Gloss visibility must come from shine only.', 1),
('00000000-0000-0002-0000-000000000124', '00000000-0000-0001-0000-000000000046', 2, 'Sheer tint',
E'Add an extremely subtle tint that barely alters lip color,
remaining fully transparent.', 2),
('00000000-0000-0002-0000-000000000125', '00000000-0000-0001-0000-000000000046', 3, 'Light tint',
E'Introduce a light, translucent tint that enhances tone
without appearing lipstick-like.', 3),
('00000000-0000-0002-0000-000000000126', '00000000-0000-0001-0000-000000000046', 4, 'Visible tint',
E'Apply a clearly visible but still sheer tint,
never opaque and never overpowering natural lip color.', 4),

-- Tint Temperature (param 47)
('00000000-0000-0002-0000-000000000127', '00000000-0000-0001-0000-000000000047', 1, 'Neutral',
E'No warm or cool color bias.', 1),
('00000000-0000-0002-0000-000000000128', '00000000-0000-0001-0000-000000000047', 2, 'Warm',
E'Add a soft warm bias (pink-peach range),
avoiding red, coral, or orange tones.', 2),
('00000000-0000-0002-0000-000000000129', '00000000-0000-0001-0000-000000000047', 3, 'Cool',
E'Add a subtle cool bias (pink-rose range),
avoiding berry, purple, or blue tones.', 3),

-- Reflectivity Profile (param 48)
('00000000-0000-0002-0000-000000000130', '00000000-0000-0001-0000-000000000048', 1, 'Smooth shine',
E'Create even, fluid shine with soft specular highlights,
avoiding harsh glare.', 1),
('00000000-0000-0002-0000-000000000131', '00000000-0000-0001-0000-000000000048', 2, 'Glass-like',
E'Produce sharp, mirror-like specular highlights
with a wet, lacquered finish.', 2),

-- Coverage Uniformity (param 49)
('00000000-0000-0002-0000-000000000132', '00000000-0000-0001-0000-000000000049', 1, 'Center-focused',
E'Concentrate gloss slightly toward the center of the lips
while maintaining edge continuity.', 1),
('00000000-0000-0002-0000-000000000133', '00000000-0000-0001-0000-000000000049', 2, 'Even coverage',
E'Apply gloss evenly edge-to-edge across both lips,
with uniform shine distribution.', 2),

-- Edge Precision for Lip Gloss (param 50)
('00000000-0000-0002-0000-000000000134', '00000000-0000-0001-0000-000000000050', 1, 'Soft edges',
E'Maintain soft, natural lip edges
without over-definition.', 1),
('00000000-0000-0002-0000-000000000135', '00000000-0000-0001-0000-000000000050', 2, 'Crisp edges',
E'Preserve clean, well-defined lip edges
with no spill onto surrounding skin.', 2)

ON CONFLICT (id) DO NOTHING;

-- Part 9: Mascara Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Lash Density (param 52)
('00000000-0000-0002-0000-000000000136', '00000000-0000-0001-0000-000000000052', 1, 'Natural',
E'Slightly increase the appearance of lash fullness
while keeping lashes thin and airy.', 1),
('00000000-0000-0002-0000-000000000137', '00000000-0000-0001-0000-000000000052', 2, 'Fuller',
E'Create a noticeable increase in lash density
with clearly defined individual lashes.', 2),
('00000000-0000-0002-0000-000000000138', '00000000-0000-0001-0000-000000000052', 3, 'Bold',
E'Add strong fullness with many visible lashes,
while maintaining separation.', 3),

-- Lash Length Bias (param 53)
('00000000-0000-0002-0000-000000000139', '00000000-0000-0001-0000-000000000053', 1, 'Compact',
E'Keep lash length close to the natural baseline,
with minimal extension at the tips.
Emphasize thickness and definition rather than length.', 1),
('00000000-0000-0002-0000-000000000140', '00000000-0000-0001-0000-000000000053', 2, 'Balanced',
E'Add a modest, natural-looking increase in lash length,
paired evenly with fullness for a classic mascara appearance.', 2),
('00000000-0000-0002-0000-000000000141', '00000000-0000-0001-0000-000000000053', 3, 'Extended',
E'Create a visible length increase at the lash tips,
while staying within natural biological lash bounds.
Lashes should never appear exaggerated, artificial, or extension-like.', 3),

-- Lash Darkness (param 54)
('00000000-0000-0002-0000-000000000142', '00000000-0000-0001-0000-000000000054', 1, 'Soft',
E'Apply gentle darkening for a natural, everyday look.', 1),
('00000000-0000-0002-0000-000000000143', '00000000-0000-0001-0000-000000000054', 2, 'Defined',
E'Create rich black lashes with clear contrast
while remaining realistic.', 2),
('00000000-0000-0002-0000-000000000144', '00000000-0000-0001-0000-000000000054', 3, 'Dramatic',
E'Apply very dark, high-contrast pigment
without bleeding onto the eyelid or skin.', 3),

-- Lash Separation (param 55)
('00000000-0000-0002-0000-000000000145', '00000000-0000-0001-0000-000000000055', 1, 'Grouped',
E'Lashes may group slightly
while still remaining clean.', 1),
('00000000-0000-0002-0000-000000000146', '00000000-0000-0001-0000-000000000055', 2, 'Separated',
E'Keep lashes clearly separated
with visible spacing.', 2),
('00000000-0000-0002-0000-000000000147', '00000000-0000-0001-0000-000000000055', 3, 'Very separated',
E'Ensure lashes are highly defined,
combed-through, and individually distinct.', 3),

-- Lower Lash Strength (param 56)
('00000000-0000-0002-0000-000000000148', '00000000-0000-0001-0000-000000000056', 1, 'Subtle',
E'Enhance lower lashes very lightly,
keeping them delicate and minimal.', 1),
('00000000-0000-0002-0000-000000000149', '00000000-0000-0001-0000-000000000056', 2, 'Defined',
E'Add visible definition to lower lashes
while keeping them softer than upper lashes.', 2)

ON CONFLICT (id) DO NOTHING;

-- Part 10: Eyebrow Enhancer Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Accent Coverage (param 61)
('00000000-0000-0002-0000-000000000150', '00000000-0000-0001-0000-000000000061', 1, 'Subtle',
E'Apply minimal pigment accenting to a small subset of eyebrow hairs.
Enhancement should be barely noticeable and extremely natural.', 1),
('00000000-0000-0002-0000-000000000151', '00000000-0000-0001-0000-000000000061', 2, 'Medium',
E'Apply visible but controlled pigment accenting
to select eyebrow hairs while preserving contrast and variation.
Brows should look groomed, not filled or styled.', 2),

-- Coverage Style (param 62)
('00000000-0000-0002-0000-000000000152', '00000000-0000-0001-0000-000000000062', 1, 'Pen',
E'Apply pigment accenting to a small subset of existing eyebrow hairs only.
Preserve strong strand-to-strand variation.
Favor isolated hairs and mid-length/tip accenting.
Do NOT make the brow look more filled or continuous.
Best for: brow pens, micro-pens, fiber-tip markers.

No skin tinting, no shading between hairs, no solid fill.
• Do NOT extend brow shape or change brow thickness.', 1),
('00000000-0000-0002-0000-000000000153', '00000000-0000-0001-0000-000000000062', 2, 'Diffuse',
E'Apply light pigment accenting across a broader set of existing eyebrow hairs
to create gentle cohesion.
Preserve variation, but reduce the appearance of sparse gaps by touching more hairs.
The result should look softly blended, not sparse or stamped-on.
Best for: stencils, brow powders, tinted gels, soft pomades.

No skin tinting, no shading between hairs, no solid fill.
• Do NOT extend brow shape or change brow thickness.', 2),

-- Depth Limit (param 63)
('00000000-0000-0002-0000-000000000154', '00000000-0000-0001-0000-000000000063', 1, 'Low',
E'DEPTH LIMIT — LOW (CRITICAL)

Pigment depth must remain very close to the natural eyebrow hair color.

Rules:
• Do NOT significantly darken the eyebrows overall
• Pigment may only deepen select hairs by a very small margin
• The darkest accented hairs must not exceed the depth of the person''s naturally darkest brow hairs
• Overall brow brightness must remain nearly unchanged

The result should look like:
• Natural eyebrow hairs catching slightly more light and definition
• A subtle touch-up, not darker brows

If the eyebrows appear noticeably darker at a glance,
the result is incorrect.', 1),
('00000000-0000-0002-0000-000000000155', '00000000-0000-0001-0000-000000000063', 2, 'Medium',
E'DEPTH LIMIT — MEDIUM (CONTROLLED)

Pigment depth may deepen eyebrow hairs modestly while preserving realism.

Rules:
• Allow select hairs to appear visibly darker than the original
• Darkening must remain hair-specific and uneven
• Do NOT allow uniform darkening across the entire brow
• Do NOT exceed a natural, cosmetic brow depth

The darkest hairs may appear one natural shade deeper than the original,
but must still resemble real eyebrow hair — never ink or paint.

If the brows appear solid, stamped, or filled-in,
the result is incorrect.', 2),

-- Brow Color Profile (param 65)
('00000000-0000-0002-0000-000000000156', '00000000-0000-0001-0000-000000000065', 1, 'See variant profile',
E'Apply pigment in the shade: {shade_name}.

Target hair color: {target_hair_color}
Warmth bias: {warmth_bias}

Pigment must match natural hair coloration
and never appear flat, inky, or painted.

Preserve strand-to-strand variation.
Do NOT recolor skin or scalp hair.', 1)

ON CONFLICT (id) DO NOTHING;

-- Part 11: Hair Health Levels
INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Frizz Reduction (param 69)
('00000000-0000-0002-0000-000000000157', '00000000-0000-0001-0000-000000000069', 1, 'Low',
E'Reduce only the most obvious flyaways. Keep most natural frizz/texture.', 1),
('00000000-0000-0002-0000-000000000158', '00000000-0000-0001-0000-000000000069', 2, 'Medium',
E'Reduce visible frizz and flyaways noticeably while preserving strand texture.', 2),
('00000000-0000-0002-0000-000000000159', '00000000-0000-0001-0000-000000000069', 3, 'High',
E'Strong frizz control with visible smoothing of flyaways, but keep strands and texture distinct.', 3),
('00000000-0000-0002-0000-000000000160', '00000000-0000-0001-0000-000000000069', 4, 'Max',
E'Near-complete frizz reduction, but MUST still preserve strands and microtexture.
Never turn hair into a smooth sheet.', 4),

-- Definition Boost (param 70)
('00000000-0000-0002-0000-000000000161', '00000000-0000-0001-0000-000000000070', 1, 'Low',
E'Slightly clearer structure. Minimal change.', 1),
('00000000-0000-0002-0000-000000000162', '00000000-0000-0001-0000-000000000070', 2, 'Medium',
E'Noticeably clearer structure:
• curls group more cleanly OR straight strands align more neatly.', 2),
('00000000-0000-0002-0000-000000000163', '00000000-0000-0001-0000-000000000070', 3, 'High',
E'Strong definition:
• curls appear more organized (same pattern) OR straight hair looks tidier and more separated.', 3),
('00000000-0000-0002-0000-000000000164', '00000000-0000-0001-0000-000000000070', 4, 'Max',
E'Maximum structure clarity while preserving the original pattern, direction, and silhouette.
No "restyling" is allowed.', 4),

-- Lift at Roots (param 71)
('00000000-0000-0002-0000-000000000165', '00000000-0000-0001-0000-000000000071', 1, 'Low',
E'Barely perceptible root lift.', 1),
('00000000-0000-0002-0000-000000000166', '00000000-0000-0001-0000-000000000071', 2, 'Medium',
E'Subtle, believable root lift without changing the hairstyle.', 2),
('00000000-0000-0002-0000-000000000167', '00000000-0000-0001-0000-000000000071', 3, 'High',
E'Noticeable root lift and buoyancy, especially near the scalp,
but DO NOT change silhouette or inflate volume unrealistically.', 3),
('00000000-0000-0002-0000-000000000168', '00000000-0000-0001-0000-000000000071', 4, 'Max',
E'Strong root lift that still looks natural and consistent with the original hairstyle.
No head-shape changes, no "blowout" look.', 4),

-- Surface Smoothness (param 72)
('00000000-0000-0002-0000-000000000169', '00000000-0000-0001-0000-000000000072', 1, 'Low',
E'Minimal smoothing; preserve most texture.', 1),
('00000000-0000-0002-0000-000000000170', '00000000-0000-0001-0000-000000000072', 2, 'Medium',
E'Moderate smoothing of roughness while keeping strand detail visible.', 2),
('00000000-0000-0002-0000-000000000171', '00000000-0000-0001-0000-000000000072', 3, 'High',
E'Strong smoothing that still preserves strand separation and does NOT look airbrushed.', 3),
('00000000-0000-0002-0000-000000000172', '00000000-0000-0001-0000-000000000072', 4, 'Max',
E'Maximum smoothing allowed without plastic hair effect.
Never blur strands.
Never change curl pattern.', 4),

-- Hydration Sheen (param 73)
('00000000-0000-0002-0000-000000000173', '00000000-0000-0001-0000-000000000073', 1, 'Matte',
E'No added shine. Hair can look healthier via reduced frizz only.', 1),
('00000000-0000-0002-0000-000000000174', '00000000-0000-0001-0000-000000000073', 2, 'Satin',
E'Add a gentle natural sheen. No oily or wet highlights.', 2),
('00000000-0000-0002-0000-000000000175', '00000000-0000-0001-0000-000000000073', 3, 'Soft glow',
E'Add a soft hydrated glow that reads healthy and moisturized,
but never glossy, mirror-like, oily, or wet.', 3)

ON CONFLICT (id) DO NOTHING;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Check category count:
--   SELECT COUNT(*) FROM categories; -- Should be 11
--
-- Check parameter count:
--   SELECT COUNT(*) FROM category_parameters; -- Should be ~56
--
-- Check level count:
--   SELECT COUNT(*) FROM parameter_levels; -- Should be ~175
--
-- Check by category:
--   SELECT c.name, COUNT(cp.id) as params 
--   FROM categories c 
--   LEFT JOIN category_parameters cp ON c.id = cp.category_id 
--   GROUP BY c.name ORDER BY c.sort_order;

-- ============================================
-- SEED COMPLETE
-- ============================================
