// Smoke test for the Anthropic API integration (quiz-first overhaul Phase 0).
// Verifies: key works, claude-opus-4-8 reachable, adaptive thinking accepted,
// structured output (json_schema) round-trips, usage/cost fields present.
//
// USAGE: node scripts/claude-smoke.cjs
'use strict';
const fs = require('fs');
const path = require('path');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const Anthropic = require('@anthropic-ai/sdk');

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (.env / Render). Create one at https://console.anthropic.com');
    process.exit(1);
  }
  const client = new Anthropic({ maxRetries: 0 });
  const t0 = Date.now();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
          },
          required: ['question', 'options'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content: 'Write one quiz question with 3 options for a nail polish finder quiz.' }],
  });

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text);
  console.log('model      :', response.model);
  console.log('stop_reason:', response.stop_reason);
  console.log('parsed     :', JSON.stringify(parsed));
  console.log('usage      :', JSON.stringify(response.usage));
  console.log('latency    :', Date.now() - t0, 'ms');
  if (!parsed.question || !Array.isArray(parsed.options)) throw new Error('structured output shape mismatch');
  console.log('\nClaude smoke test passed');
})().catch((e) => {
  console.error('Claude smoke test FAILED:', e.status || '', e.message);
  process.exit(1);
});
