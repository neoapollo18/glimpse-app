-- ============================================
-- SEED DATA: Anti-Aging category
-- Date: 2026-04-29
-- Description: Adds the "Anti-Aging" beauty category (#12) with 7 merchant-
--              facing parameters (evenness, hydration_glow, brightness_shift,
--              redness_softening, fine_line_softening, texture_smoothing,
--              hyperpigmentation) plus a locked guardrails block.
-- ============================================

-- NOTE: Run this AFTER 009_seed_categories.sql.
-- ID allocations:
--   category : 00000000-0000-0000-0000-00000000000c (12)
--   params   : 00000000-0000-0001-0000-0000000000(75-82)
--   levels   : 00000000-0000-0002-0000-0000000000(176-201)

-- ============================================
-- STEP 1: Insert Category
-- ============================================

INSERT INTO categories (id, name, slug, description, base_prompt, sort_order) VALUES

('00000000-0000-0000-0000-00000000000c', 'Anti-Aging', 'anti-aging', 'Red light therapy / anti-aging skincare results',
E'Using the provided photo, enhance only the skin to reflect realistic results from consistent use of a professional red light therapy device over several weeks.

Keep the person''s face shape, proportions, features, expression, hair, background, and lighting exactly the same.

Focus on delivering visible, device-realistic skin improvements.', 12)

ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 2: Insert Category Parameters
-- ============================================

INSERT INTO category_parameters (id, category_id, name, display_name, question_text, is_locked, locked_prompt, max_levels, sort_order) VALUES

-- Anti-Aging Parameters (Category 12)
('00000000-0000-0001-0000-000000000075', '00000000-0000-0000-0000-00000000000c', 'evenness', 'Skin Evenness', 'How even should the skin look?', false, NULL, 4, 1),
('00000000-0000-0001-0000-000000000076', '00000000-0000-0000-0000-00000000000c', 'hydration_glow', 'Hydration Glow', 'How moisturized should the skin look?', false, NULL, 4, 2),
('00000000-0000-0001-0000-000000000077', '00000000-0000-0000-0000-00000000000c', 'brightness_shift', 'Brightness', 'Should the skin look brighter overall?', false, NULL, 4, 3),
('00000000-0000-0001-0000-000000000078', '00000000-0000-0000-0000-00000000000c', 'redness_softening', 'Redness', 'How much natural redness should be visible?', false, NULL, 4, 4),
('00000000-0000-0001-0000-000000000079', '00000000-0000-0000-0000-00000000000c', 'fine_line_softening', 'Fine Lines', 'How should fine lines and wrinkles appear?', false, NULL, 4, 5),
('00000000-0000-0001-0000-000000000080', '00000000-0000-0000-0000-00000000000c', 'texture_smoothing', 'Skin Texture', 'How refined should the skin texture appear?', false, NULL, 3, 6),
('00000000-0000-0001-0000-000000000081', '00000000-0000-0000-0000-00000000000c', 'hyperpigmentation', 'Hyperpigmentation & Dark Spots', 'How much should dark spots and hyperpigmentation be faded?', false, NULL, 3, 7),
('00000000-0000-0001-0000-000000000082', '00000000-0000-0000-0000-00000000000c', 'guardrails', 'Guardrails', NULL, true,
E'The following constraints are ALWAYS enforced for Anti-Aging and must be obeyed without exception.

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

If any of these guardrails are violated, the Anti-Aging result is incorrect and invalid.', 1, 100)

ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 3: Insert Parameter Levels
-- ============================================

INSERT INTO parameter_levels (id, parameter_id, level, label, prompt_text, sort_order) VALUES

-- Evenness (param 75)
('00000000-0000-0002-0000-000000000176', '00000000-0000-0001-0000-000000000075', 1, 'No change',
E'Gently soften the appearance of minor uneven skin tone and faint blotchiness by approximately 5–10%, focusing only on subtle transitions between naturally occurring color variations. Preserve all natural skin characteristics, including pores, freckles, moles, fine lines, acne, and texture. The skin should retain its full individuality and lived-in realism, with unevenness still clearly present. Do not alter the underlying skin tone, ethnicity, or overall complexion, and do not blur, smooth, or homogenize the skin surface.', 1),
('00000000-0000-0002-0000-000000000177', '00000000-0000-0001-0000-000000000075', 2, 'Subtle',
E'Moderately reduce visible patchiness and uneven tone by approximately 15–25%, creating a more harmonious appearance while keeping natural variation intact. Areas of redness, shadowing, or mild discoloration may appear more visually balanced, but distinct tonal differences must remain observable. Skin texture, pores, freckles, scars, and fine lines must stay fully visible. Do not flatten the skin into a uniform color field, and do not apply any makeup-like coverage, tinting, or retouching effects.', 2),
('00000000-0000-0002-0000-000000000178', '00000000-0000-0001-0000-000000000075', 3, 'Moderate',
E'Noticeably soften uneven skin tone and blotchy transitions by approximately 30–40%, resulting in a clearer and more consistent overall look that still reads as real human skin. Natural variation, pigmentation, and texture must remain present, with imperfections reduced in contrast rather than removed. The skin should look healthier, not perfected. Do not erase freckles, moles, acne, or scars, and do not shift or lighten the underlying skin tone.', 3),
('00000000-0000-0002-0000-000000000179', '00000000-0000-0001-0000-000000000075', 4, 'Strong',
E'Apply the strongest safe reduction of uneven tone by approximately 45–55%, achieving a visibly more even and calm complexion while strictly preserving realism. Color transitions should appear smoother, but the skin must still show natural variation, texture, and imperfection at close inspection. This tier represents the upper limit of believable refinement. Do not create a uniform or airbrushed appearance, do not remove defining skin features, and do not alter skin tone, ethnicity, or identity.', 4),

-- Hydration Glow (param 76)
('00000000-0000-0002-0000-000000000180', '00000000-0000-0001-0000-000000000076', 1, 'No glow',
E'Introduce a very subtle increase in the appearance of skin hydration and comfort by approximately 5–10%, giving the skin a slightly fresher, more rested look without visible shine. The effect should appear as gentle light responsiveness within the skin, not on top of it. All natural texture, pores, freckles, fine lines, and imperfections must remain fully visible. Do not add gloss, oiliness, or reflective highlights, and do not create any makeup-like glow or surface shine.', 1),
('00000000-0000-0002-0000-000000000181', '00000000-0000-0001-0000-000000000076', 2, 'Subtle',
E'Enhance the appearance of well-hydrated, healthy skin by approximately 15–25%, introducing a soft, natural luminosity that suggests improved moisture balance. The skin may look more supple and comfortable, but it must still read as real skin with visible texture and variation. Any glow should be diffuse and skin-integrated. Do not blur texture, do not create wet or glossy areas, and do not alter underlying skin tone or coloration.', 2),
('00000000-0000-0002-0000-000000000182', '00000000-0000-0001-0000-000000000076', 3, 'Healthy glow',
E'Apply a clearly noticeable yet realistic hydration effect by approximately 30–40%, giving the skin a visibly dewy, resilient appearance associated with well-moisturized skin. Light should interact more evenly across the skin surface, while pores, fine lines, freckles, and natural irregularities remain intact. The glow must remain soft and balanced. Do not produce a glass-skin, oily, or reflective sheen, and do not obscure or smooth natural skin texture.', 3),
('00000000-0000-0002-0000-000000000183', '00000000-0000-0001-0000-000000000076', 4, 'Luminous',
E'Apply the strongest believable hydration enhancement by approximately 45–55%, creating a luminous, healthy-looking complexion that still maintains full realism. The skin should appear optimally hydrated and comfortable, with gentle, evenly distributed luminosity that never overpowers texture or detail. This tier represents the upper limit of natural glow. Do not introduce shine hotspots, makeup-like radiance, or artificial smoothness, and do not remove pores, fine lines, or natural variation.', 4),

-- Brightness Shift (param 77)
('00000000-0000-0002-0000-000000000184', '00000000-0000-0001-0000-000000000077', 1, 'No change',
E'**Preserve the skin''s original brightness exactly as captured in the photo.**

No lifting, lightening, or luminosity adjustment should be applied. Shadows, highlights, and natural contrast must remain unchanged. Skin tone, depth, and perceived lightness must stay identical to the original image. All texture, pores, freckles, pigmentation, and natural variation must remain fully visible.

This option should look like the same photo under the same lighting, with no brightness enhancement applied.', 1),
('00000000-0000-0002-0000-000000000185', '00000000-0000-0001-0000-000000000077', 2, 'Subtle',
E'Introduce a very subtle brightness lift of approximately 2–5%, gently improving clarity in dull areas without changing the underlying skin tone or depth. The effect should feel like slightly better lighting, not skin lightening. Brightness must be evenly distributed and must not flatten contrast or remove shadows. Texture, pores, freckles, fine lines, scars, and pigmentation must remain fully visible. Do not create a washed-out, pale, or whitened appearance.', 2),
('00000000-0000-0002-0000-000000000186', '00000000-0000-0001-0000-000000000077', 3, 'Moderate',
E'Apply a moderate brightness lift of approximately 6–10%, resulting in a visibly brighter and more refreshed appearance while preserving natural skin depth and variation. The skin may look more awake and energized, but must still read as real, dimensional skin. Brightness should not erase shadows, compress contrast, or reduce melanin-driven depth. Do not introduce any makeup-like brightening or whitening effects.', 3),
('00000000-0000-0002-0000-000000000187', '00000000-0000-0001-0000-000000000077', 4, 'Radiant',
E'Apply the strongest safe brightness adjustment (approximately 11–15%), reaching the upper limit of natural-looking luminosity while fully preserving realism and identity. The skin should appear brighter and more vibrant, similar to being photographed in more flattering light, not lighter in color. Texture, pigmentation, contrast, and depth must remain intact. Do not alter the underlying skin tone, ethnicity, or complexion identity. Do not produce a flat, pale, or overexposed look.', 4),

-- Redness Softening (param 78)
('00000000-0000-0002-0000-000000000188', '00000000-0000-0001-0000-000000000078', 1, 'Natural',
E'Gently soften the appearance of mild surface redness by approximately 5–10%, focusing on reducing sharp contrast between red areas and surrounding skin without eliminating redness entirely. The skin should still show natural flush, variation, and circulation. All pores, freckles, acne, scars, fine lines, and texture must remain fully visible. Do not neutralize redness completely, do not gray or mute the skin, and do not alter the underlying skin tone or ethnicity.', 1),
('00000000-0000-0002-0000-000000000189', '00000000-0000-0001-0000-000000000078', 2, 'Subtle',
E'Moderately reduce the appearance of visible redness by approximately 15–25%, creating a calmer and more balanced look while preserving natural skin variation. Red areas may appear less intense, but they must remain present and believable. Texture, pigmentation, and micro-detail must stay intact at all times. Do not flatten the skin into a uniform color, do not remove healthy natural flush, and do not introduce makeup-like color correction.', 2),
('00000000-0000-0002-0000-000000000190', '00000000-0000-0001-0000-000000000078', 3, 'Moderate',
E'Noticeably soften redness and reactive-looking areas by approximately 30–40%, resulting in a visibly calmer complexion that still reads as real skin. Redness should be reduced in contrast rather than erased, and areas of natural coloration must remain distinguishable. All natural texture, pores, and imperfections must stay visible. Do not eliminate redness entirely, do not desaturate the skin unnaturally, and do not create a color-corrected or foundation-like appearance.', 3),
('00000000-0000-0002-0000-000000000191', '00000000-0000-0001-0000-000000000078', 4, 'Strong',
E'Apply the strongest safe reduction of visible redness by approximately 45–55%, reaching the upper limit of natural-looking calmness while preserving full realism. The skin should appear soothed and balanced, but still alive with natural color variation and texture. This tier represents refinement, not correction. Do not remove all redness, do not shift the skin toward gray or yellow tones, and do not compromise skin identity or natural complexion depth.', 4),

-- Fine Line Softening (param 79)
('00000000-0000-0002-0000-000000000192', '00000000-0000-0001-0000-000000000079', 1, 'None',
E'Do not alter the appearance of fine lines or wrinkles.
Preserve all natural line contrast exactly as-is.', 1),
('00000000-0000-0002-0000-000000000193', '00000000-0000-0001-0000-000000000079', 2, 'Subtle',
E'Fine line handling rule:
Affect ONLY existing fine lines and natural creases by gently reducing harsh contrast and dryness within those lines.
Do NOT blur, smooth, flatten, or remove skin texture.
Do NOT alter pores, freckles, or microtexture.
Do NOT change face shape, expression, or geometry.
The effect must look like improved hydration and skin condition — not retouching or beauty filtering.

Gently soften the appearance of existing fine lines by slightly reducing dryness and harsh shadowing within the lines only.

The change should be barely perceptible, reading as healthier, more hydrated skin rather than smoothing.

No texture loss is allowed.', 2),
('00000000-0000-0002-0000-000000000194', '00000000-0000-0001-0000-000000000079', 3, 'Medium',
E'Fine line handling rule:
Affect ONLY existing fine lines and natural creases by gently reducing harsh contrast and dryness within those lines.
Do NOT blur, smooth, flatten, or remove skin texture.
Do NOT alter pores, freckles, or microtexture.
Do NOT change face shape, expression, or geometry.
The effect must look like improved hydration and skin condition — not retouching or beauty filtering.

Noticeably soften the appearance of existing fine lines by reducing internal contrast and dryness within the creases.

Lines should appear less sharp and less dry, while remaining clearly present and fully textured.

Do NOT blur surrounding skin or reduce pore visibility.', 3),
('00000000-0000-0002-0000-000000000195', '00000000-0000-0001-0000-000000000079', 4, 'Visible',
E'Fine line handling rule:
Affect ONLY existing fine lines and natural creases by gently reducing harsh contrast and dryness within those lines.
Do NOT blur, smooth, flatten, or remove skin texture.
Do NOT alter pores, freckles, or microtexture.
Do NOT change face shape, expression, or geometry.
The effect must look like improved hydration and skin condition — not retouching or beauty filtering.

Create a clearly visible softening of existing fine lines by smoothing harsh contrast and dryness within the creases.

The lines should look more hydrated and cushioned, but must remain natural, textured, and unchanged in position.

No line removal, no skin flattening, no airbrushing.', 4),

-- Skin Texture Smoothing (param 80, max 3)
('00000000-0000-0002-0000-000000000196', '00000000-0000-0001-0000-000000000080', 1, 'Subtle',
E'Improve overall skin texture by 10–15%, making the skin appear marginally more refined. Pores must remain fully visible. No airbrushing. No glass skin.', 1),
('00000000-0000-0002-0000-000000000197', '00000000-0000-0001-0000-000000000080', 2, 'Moderate',
E'Improve overall skin texture by 30–35%, making the skin appear noticeably more refined and healthy. Pores must remain visible. No airbrushing. No glass skin.', 2),
('00000000-0000-0002-0000-000000000198', '00000000-0000-0001-0000-000000000080', 3, 'Strong',
E'Improve overall skin texture by 50–60%, making the skin appear dramatically more refined, smooth, and healthy. This should be the most refined the skin can look while still appearing completely real. Pores must remain visible. No airbrushing. No glass skin.', 3),

-- Hyperpigmentation & Dark Spots (param 81, max 3)
('00000000-0000-0002-0000-000000000199', '00000000-0000-0001-0000-000000000081', 1, 'Subtle',
E'Fade dark spots and hyperpigmentation by 15–20%, very slightly evening tone while keeping freckles, moles, and natural undertones completely unchanged.', 1),
('00000000-0000-0002-0000-000000000200', '00000000-0000-0001-0000-000000000081', 2, 'Moderate',
E'Fade dark spots and hyperpigmentation by 35–40%, evening tone while keeping freckles, moles, and natural undertones completely unchanged.', 2),
('00000000-0000-0002-0000-000000000201', '00000000-0000-0001-0000-000000000081', 3, 'Strong',
E'Fade dark spots and hyperpigmentation by 55–65%, creating a dramatically more even skin tone. Spots should appear significantly lighter and less prominent. Keep freckles, moles, and natural undertones completely unchanged.', 3)

ON CONFLICT (id) DO NOTHING;
