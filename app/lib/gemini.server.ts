// Shared Gemini plumbing for the text-model callers (photo-axis
// classification, LLM recommendation ranking). One client, one response
// text extractor, one JSON fence stripper — an SDK response-shape fix made
// here reaches every caller instead of silently fixing one classifier
// while the other degrades to its fallback.

import { GoogleGenAI } from '@google/genai';

let _client: GoogleGenAI | null = null;

export function geminiClient(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

/** Pull the text out of a generateContent response, tolerating both the
 * .text convenience getter and the raw candidates/parts shape. */
export function extractGeminiText(response: unknown): string {
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

/** Strip the ```json fences some structured-output responses still wrap
 * their JSON in, despite responseMimeType. */
export function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}
