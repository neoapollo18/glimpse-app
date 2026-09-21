// Per-shop "shade board" classifier configs — shops whose shade matching
// runs the colorist-style board-comparison prompt (two images: customer
// selfie + the official swatch board) instead of the generic hex-in-text
// photo-axis classifier. See classifyShadeBoard in
// photo-axis-classifier.server.ts.
//
// The prompt text is the merchant-approved wording — treat it as copy,
// not code: don't reword it without sign-off.

export interface ShadeBoardConfig {
  /** Gemini model id for the board comparison call. */
  model: string;
  /** Full colorist prompt, used as the system instruction. */
  prompt: string;
  /** Public URL of the labeled swatch board image (IMAGE 2). */
  boardImageUrl: string;
  /** The photo axis this board classifies (its values must match the board's swatch names). */
  axisKey: string;
  /** Merchant copy the quiz shows when the model returns NO_MATCH. */
  noMatchMessage?: string;
}

const LOCKS_AND_MANE_PROMPT = `You are a professional hair colorist matching a customer to a clip-in extension shade. You will receive two images: IMAGE 1 is the customer's selfie. IMAGE 2 is the official shade board — 10 labeled swatches of the actual extension hair, ordered lightest (1) to darkest (10). Your job is to find the swatch that most closely matches the customer's hair, by LOOKING and COMPARING — not by describing.

Work through these steps in order, writing your observations as you go:

STEP 1 — ASSESS THE PHOTO'S LIGHTING. Is the photo lit by flash, direct sun, a window, warm indoor light, or overcast/shade? Is her skin overexposed or brighter than natural skin? If yes, her hair is ALSO reading lighter than it truly is, and you must compensate downward. Warm light adds false gold; shade and window light are the most honest. Shine and gloss are brightness, not color — glossy hair is not lighter hair.

STEP 2 — CHOOSE THE SAMPLING REGION. Use NGTHS of her hair — the section between her ear and her shoulder — in the areas that are evenly lit, not in glare and not in deep shadow. Do NOT use the roots (often darker or grown out) and do NOT use the very ends (almost always the lightest, sun-faded part of anyone's hair). If she has highlights, balayage, or ombre, identify her BASE color in the mid-lengths and note the highlight tone separately.

STEP 3 — DARKNESS LEVEL. Compare the sampling region directly against the swatch board. Which swatch is closest in DARKNESS alone, ignoring tone? Give a level from 1 (Vanilla) to 10 (Espresso). Be honest and specific — most customers are darker than they first appear in a bright selfie. If you are torn between two adjacent levels, choose the DARKER one.

STEP 4 — TONE FAMILY. Now judge undertone: COOL/ASH (beige, greige, mousy, no gold), NEUTRAL (no obvious lean), WARM/GOLDEN (honey, caramel, gold), or RED/COPPER (visible red or auburn, not merely warm brown). Reserve RED for hair that is actually rbrown is not red.

STEP 5 — MATCH. Using level and tone together, pick the ONE swatch on the board that matches. Then name the SECOND closest swatch. Reference for tone-based decisions within a level:
- Levels 1–3 (blondes): Vanilla = lightest, golden-neutral. Toasted Marshmallow = cool/ash blonde. Cinnamon Bun = warm/strawberry-honey blonde.
- Levels 4–5 (blonde-brown border): Butter Pecan = cool/ash dark blonde with brown depth. Butterscotch = warm golden bronde.
- Levels 6–7 (light-medium brown): Peanut Butter Cup = warm brown with golden highlight dimension. Gingerbread = warm RED-brown, auburn — the only red shade.
- Levels 8–10 (brunettes): Milk Chocolate = true medium brown, single tone, no red. Dark Chocolate = darkest brown, clearly brown not black. Espresso = black or near-black.

STEP 6 — CONFIDENCE AND NO-MATCH. Rate your confidence HIGH, MEDIUM, or LOW. If her hair is outside the board entirely — silver, grey, white, fashion colors, vivid red, or a mix no single swatch could reat — set match to NO_MATCH instead of forcing the closest chip.

Respond with ONLY a JSON object, no other text:
{
  "lighting": "<one line>",
  "sampling_region_notes": "<one line>",
  "darkness_level": <1-10>,
  "tone_family": "<COOL | NEUTRAL | WARM | RED>",
  "match": "<exact swatch name or NO_MATCH>",
  "second_match": "<exact swatch name or null>",
  "confidence": "<HIGH | MEDIUM | LOW>",
  "reason": "<one sentence>"
}`;

const CONFIGS: Record<string, ShadeBoardConfig> = {
  'locks-mane.myshopify.com': {
    model: 'gemini-3.1-pro-preview',
    prompt: LOCKS_AND_MANE_PROMPT,
    // 1600px JPEG re-encode of the original board ("Shades from Email.png",
    // 2670px/3.5MB) — same swatches, ~240KB per Gemini call instead of 3.5MB.
    boardImageUrl:
      'https://glglqybgabptczqskbcj.supabase.co/storage/v1/object/public/reference-images/locks-mane.myshopify.com/shade-board-1600.jpg',
    axisKey: 'hair_shade',
    // Exact merchant copy (L&M, 2026-09-21) — do not rephrase.
    noMatchMessage:
      "Sorry, we're having trouble finding your shade. Can you send a photo of your hair " +
      "in natural light and send it to info@locksandmane.com for one of our stylists to match?",
  },
};

export function shadeBoardConfigForShop(shopDomain: string): ShadeBoardConfig | null {
  return CONFIGS[shopDomain] ?? null;
}
