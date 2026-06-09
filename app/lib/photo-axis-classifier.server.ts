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

import { GoogleGenAI } from '@google/genai';
import { compressImage } from './ai.server';

export interface PhotoAxisSpec {
  key: string;
  label: string;
  values: Array<{ value: string; label: string }>;
}

// Text-capable vision model — NOT the image-generation models used for
// try-ons. Flash over pro: this is a small closed-set classification and
// it sits on the consultation's critical path ahead of every transform.
const PHOTO_AXIS_MODEL = 'gemini-2.5-flash';
const PHOTO_AXIS_TIMEOUT_MS = 12_000;
// Classification doesn't need detail — small input keeps the call fast.
const PHOTO_AXIS_MAX_PX = 768;

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

function extractText(response: unknown): string {
  const r = response as {
    text?: string;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (typeof r?.text === 'string' && r.text) return r.text;
  const parts = r?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  }
  return '';
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
        const opts = axis.values.map((v) => `"${v.value}" (${v.label})`).join(', ');
        return `- ${axis.key} (${axis.label}): one of ${opts}`;
      })
      .join('\n');

    const systemPrompt =
      'You classify a customer selfie for beauty product matching. ' +
      'Look at the person in the photo and pick exactly one value per attribute. ' +
      'If the photo is ambiguous, pick the closest match — never refuse. ' +
      'Attributes:\n' + axisDescriptions;

    const responsePromise = client().models.generateContent({
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
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`photo-axis classification timed out after ${PHOTO_AXIS_TIMEOUT_MS}ms`)),
        PHOTO_AXIS_TIMEOUT_MS,
      ),
    );

    const raw = extractText(await Promise.race([responsePromise, timeoutPromise]));
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

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
