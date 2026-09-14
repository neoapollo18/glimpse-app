// Photo-axis classification for the recommendation matrix.
//
// Matrix rules store criteria across ALL axes — including ones sourced from
// the shopper's photo (e.g. skintone) that the chat questions never collect.
// pickVariantsByCriteria matches by strict JSONB equality, so a missing
// photo axis means NO rule can ever match. This module fills that gap:
// given the selfie and the shop's photo axes (with their allowed values),
// one Gemini vision call classifies each axis into exactly one value.
//
// Failure-tolerant by design: any error returns {} and chat-recommend
// degrades to the AI-pick fallback, same as before this existed.

import { compressImage } from './ai.server';
import { geminiClient, extractGeminiText, stripJsonFences } from './gemini.server';
import { shadeBoardConfigForShop, type ShadeBoardConfig } from './shade-board-config.server';

export interface PhotoAxisSpec {
  key: string;
  label: string;
  values: Array<{ value: string; label: string; swatch?: string | null }>;
}

// Text-capable vision model — NOT the image-generation models used for
// try-ons. Fine-grained shade discrimination (jet_black vs soft_black vs
// darkest_brown) was beyond 2.5-flash-with-thinking-off; gemini-3.7-flash
// (Aug 2026, strongest Flash, "vision as active investigation") is the
// current best fit that still sits acceptably on the critical path.
// Env-overridable for fast rollback without a deploy.
const PHOTO_AXIS_MODEL = process.env.GEMINI_PHOTO_AXIS_MODEL || 'gemini-3.7-flash';
const PHOTO_AXIS_TIMEOUT_MS = 15_000;
// Enough detail to separate adjacent hair/skin shades; still small enough
// to keep the call fast.
const PHOTO_AXIS_MAX_PX = 1024;

export interface ShopPhotoClassification {
  values: Record<string, string>;
  /** True only when the shade-board model explicitly answered NO_MATCH. */
  shadeNoMatch: boolean;
  /** Merchant copy to surface to the shopper on NO_MATCH. */
  noMatchMessage?: string;
}

/**
 * Shop-aware entry point: shops with a shade-board config (see
 * shade-board-config.server.ts) get the colorist board-comparison prompt for
 * their shade axis; everything else — other axes, other shops — runs the
 * generic classifier. Same failure contract as classifyPhotoAxes: partial
 * values on partial success, empty values on total failure.
 */
export async function classifyPhotoAxesForShopDetailed(
  shopDomain: string,
  inputImage: string,
  mimeType: string,
  axes: PhotoAxisSpec[],
): Promise<ShopPhotoClassification> {
  const board = shadeBoardConfigForShop(shopDomain);
  if (!board) {
    return {
      values: await classifyPhotoAxes(inputImage, mimeType, axes),
      shadeNoMatch: false,
    };
  }

  const shadeAxis = axes.find((a) => a.key === board.axisKey);
  const rest = axes.filter((a) => a.key !== board.axisKey);
  const [shadeResult, restValues] = await Promise.all([
    shadeAxis
      ? classifyShadeBoard(inputImage, mimeType, board, shadeAxis)
      : Promise.resolve({ values: {} as Record<string, string>, noMatch: false }),
    rest.length > 0
      ? classifyPhotoAxes(inputImage, mimeType, rest)
      : Promise.resolve({} as Record<string, string>),
  ]);
  return {
    values: { ...restValues, ...shadeResult.values },
    shadeNoMatch: shadeResult.noMatch,
    noMatchMessage: shadeResult.noMatch ? board.noMatchMessage : undefined,
  };
}

/** Values-only variant for callers that don't surface NO_MATCH copy. */
export async function classifyPhotoAxesForShop(
  shopDomain: string,
  inputImage: string,
  mimeType: string,
  axes: PhotoAxisSpec[],
): Promise<Record<string, string>> {
  return (await classifyPhotoAxesForShopDetailed(shopDomain, inputImage, mimeType, axes)).values;
}

// The board image rarely changes and every classify call needs it — fetch
// once per process, keyed by URL so a config change busts the cache.
const boardImageCache = new Map<string, Promise<{ data: string; mimeType: string }>>();

function fetchBoardImage(url: string): Promise<{ data: string; mimeType: string }> {
  let cached = boardImageCache.get(url);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`shade board fetch failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        data: buf.toString('base64'),
        mimeType: res.headers.get('content-type') || 'image/png',
      };
    })();
    // A failed fetch must not poison the cache for the process lifetime.
    cached.catch(() => boardImageCache.delete(url));
    boardImageCache.set(url, cached);
  }
  return cached;
}

// Swatch names arrive as display labels ("Butter Pecan"); axis values are
// their squashed forms ("butterpecan"). Normalize both sides to compare.
function normalizeSwatchName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The pro model works through the prompt's six steps before answering —
// meaningfully slower than the flash classifier, so it gets a longer leash.
const SHADE_BOARD_TIMEOUT_MS = 30_000;

/**
 * Colorist-style shade match: sends the shopper selfie (IMAGE 1) and the
 * shop's official swatch board (IMAGE 2) through the merchant's colorist
 * prompt, then maps the returned swatch name onto the axis value. Empty
 * values on NO_MATCH or any failure (same manual-picker fallback as the
 * generic classifier); noMatch is true only for an explicit NO_MATCH verdict.
 */
export async function classifyShadeBoard(
  inputImage: string,
  mimeType: string,
  board: ShadeBoardConfig,
  axis: PhotoAxisSpec,
): Promise<{ values: Record<string, string>; noMatch: boolean }> {
  try {
    const [selfie, boardImage] = await Promise.all([
      compressImage(inputImage, mimeType, PHOTO_AXIS_MAX_PX),
      fetchBoardImage(board.boardImageUrl),
    ]);

    const responsePromise = geminiClient().models.generateContent({
      model: board.model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: "IMAGE 1 — the customer's selfie:" },
            { inlineData: { mimeType: selfie.compressedMimeType, data: selfie.compressedBase64 } },
            { text: 'IMAGE 2 — the official shade board:' },
            { inlineData: { mimeType: boardImage.mimeType, data: boardImage.data } },
          ],
        },
      ],
      config: {
        systemInstruction: board.prompt,
        responseMimeType: 'application/json',
        temperature: 0,
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`shade-board classification timed out after ${SHADE_BOARD_TIMEOUT_MS}ms`)),
        SHADE_BOARD_TIMEOUT_MS,
      ),
    );

    const raw = extractGeminiText(await Promise.race([responsePromise, timeoutPromise]));
    const parsed = JSON.parse(stripJsonFences(raw)) as {
      match?: unknown;
      second_match?: unknown;
      confidence?: unknown;
      darkness_level?: unknown;
      tone_family?: unknown;
      reason?: unknown;
    };

    // Full verdict in the logs: when a merchant disputes a match, this is
    // the only record of what the model saw (the photo is never stored).
    console.log('[shade-board] verdict:', JSON.stringify(parsed));

    const match = typeof parsed.match === 'string' ? parsed.match.trim() : '';
    if (match.toUpperCase() === 'NO_MATCH') return { values: {}, noMatch: true };
    if (!match) return { values: {}, noMatch: false };

    const normalized = normalizeSwatchName(match);
    const value = axis.values.find(
      (v) => v.value === normalized || normalizeSwatchName(v.label) === normalized,
    );
    if (!value) {
      console.warn(`[shade-board] unmapped swatch name "${match}" for axis ${axis.key}`);
      return { values: {}, noMatch: false };
    }
    return { values: { [axis.key]: value.value }, noMatch: false };
  } catch (err) {
    console.error(
      '[shade-board] classification failed:',
      err instanceof Error ? err.message : err,
    );
    return { values: {}, noMatch: false };
  }
}

/**
 * Classify each photo axis into one of its defined values by looking at the
 * shopper's selfie. Returns { axisKey: axisValue } containing only axes that
 * classified to a valid value — callers merge this into the criteria they
 * collected from chat questions. Returns {} on any failure.
 */
export async function classifyPhotoAxes(
  inputImage: string,
  mimeType: string,
  axes: PhotoAxisSpec[],
): Promise<Record<string, string>> {
  const usable = axes.filter((a) => a.values.length > 0);
  if (usable.length === 0) return {};

  try {
    const { compressedBase64, compressedMimeType } = await compressImage(
      inputImage,
      mimeType,
      PHOTO_AXIS_MAX_PX,
    );

    // One enum property per axis, all required — the schema does the heavy
    // lifting of keeping answers inside the allowed value set.
    const properties: Record<string, unknown> = {};
    for (const axis of usable) {
      properties[axis.key] = {
        type: 'string',
        enum: axis.values.map((v) => v.value),
        description: axis.label,
      };
    }
    const responseSchema = {
      type: 'object',
      properties,
      required: usable.map((a) => a.key),
    };

    const axisDescriptions = usable
      .map((axis) => {
        // Include each value's swatch hex when available: names like
        // "Vanilla" or "Mocha" are meaningless without the color they
        // denote, and the hexes let the model compare against actual pixels.
        const opts = axis.values
          .map((v) => `"${v.value}" (${v.label}${v.swatch ? `, approx color ${v.swatch}` : ''})`)
          .join(', ');
        return `- ${axis.key} (${axis.label}): one of ${opts}`;
      })
      .join('\n');

    const systemPrompt =
      'You classify a customer selfie for beauty product matching. ' +
      'Look at the person in the photo and pick exactly one value per attribute. ' +
      'Compare what you see against each option\'s approximate color when given. ' +
      'Account for lighting: indoor/warm lighting shifts apparent shade — judge the underlying color. ' +
      'If the photo is ambiguous, pick the closest match — never refuse. ' +
      'Attributes:\n' + axisDescriptions;

    const responsePromise = geminiClient().models.generateContent({
      model: PHOTO_AXIS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Classify this photo.' },
            { inlineData: { mimeType: compressedMimeType, data: compressedBase64 } },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: responseSchema as unknown as Record<string, unknown>,
        temperature: 0,
        // Gemini 3 models use thinkingLevel (thinkingBudget is the 2.5-era
        // knob). 'low' keeps latency in check while letting the model
        // actually look — full thinking-off was part of why 2.5-flash
        // misjudged adjacent shades. Cast: @google/genai 1.15 typings
        // predate the field; the API accepts it, and if a proxy strips it
        // the model just uses its default (dynamic) thinking.
        thinkingConfig: { thinkingLevel: 'low' } as unknown as { thinkingBudget?: number },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`photo-axis classification timed out after ${PHOTO_AXIS_TIMEOUT_MS}ms`)),
        PHOTO_AXIS_TIMEOUT_MS,
      ),
    );

    const raw = extractGeminiText(await Promise.race([responsePromise, timeoutPromise]));
    const parsed = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;

    // Schema enforcement is best-effort — re-validate against the allowed
    // sets so a stray value can't poison the strict-equality rule lookup.
    const result: Record<string, string> = {};
    for (const axis of usable) {
      const v = parsed[axis.key];
      if (typeof v === 'string' && axis.values.some((av) => av.value === v)) {
        result[axis.key] = v;
      }
    }
    return result;
  } catch (err) {
    console.error(
      '[photo-axis] classification failed:',
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}
