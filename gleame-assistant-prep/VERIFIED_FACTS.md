# VERIFIED FACTS — Gleame AI Assistant (interview cheat-sheet)

> Every number below was extracted from the live codebase and **adversarially re-verified** (57 facts, 57 confirmed, 0 corrections). Cite these with confidence. The cost section is the one place you must NOT improvise — read §3.

---

## 1. Numbers you can state cold

| Item | Value | Source |
|---|---|---|
| **Recommendations shown (default)** | **3** | `supabase.server.ts:2324` |
| Runtime fallback count (clamped 1–5) | 3 | `chat-recommend.ts:234` |
| Merchant-configurable range | 1–5 (slider, default 3) | `app.assistant.tsx:851` |
| **Model IDs** | | |
| Gemini PRO (variant configs, precise makeup) | `gemini-3-pro-image-preview` | `ai.server.ts:12` |
| Gemini FLASH (standard, fast/cheap) | `gemini-2.5-flash-image` | `ai.server.ts:13` |
| Gemini FLASH 3.1 (high-quality, 2K input) | `gemini-3.1-flash-image-preview` | `ai.server.ts:14` |
| OpenAI **fallback** (secondary) | `gpt-image-1.5` | `ai.server.ts:15` |
| OpenAI alt | `gpt-image-2` | `ai.server.ts:16` |
| Photo-axis classifier (vision) | `gemini-2.5-flash` | `photo-axis-classifier.server.ts:25` |
| **Pixel limits (MODEL_MAX_PX)** | | |
| FLASH 3.1 | 2048 | `ai.server.ts:39` |
| PRO / FLASH / default | 720 | `ai.server.ts:40–41, 229` |
| Classifier input | 768 | `photo-axis-classifier.server.ts:28` |
| **Timeouts** | | |
| Photo-axis classifier | 12 s | `photo-axis-classifier.server.ts:26` |
| Shopify handle lookup | 6 s | `chat-recommend.ts:28` |
| OpenAI per request | 120 s | `ai.server.ts:408` |
| Reference-image fetch | 10 s | `safe-fetch.server.ts:70` |
| **Retries / backoff** | | |
| Gemini retries | 2 (backoff 1s/2s/4s) | `ai.server.ts:171,180` |
| OpenAI retries | 1 (exp backoff) | `ai.server.ts:426,435` |
| **Image / classifier config** | | |
| Classifier temperature | 0 (deterministic) | `photo-axis-classifier.server.ts:117` |
| JPEG quality (Sharp) | 85, progressive | `ai.server.ts:143` |
| HEIC convert quality | 0.92 | `ai.server.ts:92` |
| MAX_REFERENCE_IMAGES | 5 | `reference-images.ts:6` |
| Upload size cap | 5 MB | `transform-image.ts:240` |
| **Rate limits** | | |
| transform · per-IP/min | 20 / 60 s | `rate-limiter.server.ts:142` |
| transform · per-IP/hr | 100 / 3600 s | `rate-limiter.server.ts:146` |
| transform · per-shop/hr | **1000** / 3600 s *(stale code comment says 500 — say 1000)* | `rate-limiter.server.ts:150` |
| **chat-recommend · per-IP** | **10 / 60 s** | `chat-recommend.ts:195` |
| track-event · per-IP | 100 / 60 s | `rate-limiter.server.ts:155` |
| **Analytics windows (default daysBack)** | | |
| getAssistantEngagement | 7 | `supabase.server.ts:801` |
| getConversionStats | 30 | `supabase.server.ts:538` |
| Backfill multiplier on failed picks | needed × 2 (pool-capped) | `chat-recommend.ts:543` |

---

## 2. Mechanics worth stating precisely

- **Matrix lookup:** `recommendation_rules`, filtered by `shop_id` + **strict JSONB equality** `.eq('criteria', JSON.stringify(criteria))`, `ORDER BY rank ASC`. `JSON.stringify` is mandatory — a raw object serializes to `[object Object]` and silently misses. (`supabase.server.ts:2710`)
- **Shop verification:** exact `shop_domain` match, fallback `alternate_domains` whitelist; runs **before** rate limiting; the per-shop limit is keyed on the *verified canonical domain* (anti-spoof). (`transform-image.ts:93,182`)
- **Counts are event-volume, not unique sessions** — widget emits no session id, so a double-upload double-counts (both rate limiter and analytics). State this as a known limitation.
- **Event allowlist (9):** `chat_open, chat_recommend_start, chat_photo_upload, chat_recommendation_shown, chat_view_product, chat_add_bundle_to_bag, hero_view, hero_dismiss, hero_cta_click`. **getAssistantEngagement counts 8 of 9** — `hero_dismiss` is accepted/emitted but not counted.

---

## 3. Cost-per-session — say the FORMULA, never a dollar figure

```
cost_per_session = N × per_image_gen_cost  +  1 × classification_cost
                   (N = 3 verified default; 1–5 configurable)
```

- N = **3** image generations (verified). Worst case ×5 if merchant maxes the slider.
- **1** classification call (`gemini-2.5-flash` vision, single-shot, no retry loop).
- Worst-case latency adds up to ×3 Gemini attempts per image (retries).

> **HARD RULE:** per-image / per-token AI pricing is **NOT in the codebase** (exhaustively confirmed — no USD constant, no per-session cost, no token budget for image gen). **Do not state a $/image or $/session number live — that would be fabrication.** Fill `per_image_gen_cost` and `classification_cost` from the **provider's current rate card** before the interview, then just multiply.

**Plug-in table (you fill the right column from the rate card):**

| Term | Verified count | Unit cost (external) |
|---|---|---|
| Image generation | N = 3 (1–5) | $/image — Gemini image-gen rate |
| Photo-axis classification | 1 | $/call — Gemini flash vision rate |

---

## 4. Business model (context an e-commerce founder WILL ask)

Subscription tiers (session-based, via Hey Mantle) — *these are merchant billing tiers, unrelated to AI unit cost*:

| Tier | Price |
|---|---|
| Free | $0 |
| Starter | $30 |
| Launch | $149 |
| Growth | $399 |

Source: `pricing-tiers.ts:20`. **Note the margin tension:** flat subscription revenue vs. per-session variable AI cost → this is *why* model tiering, "only render what you show," and rate limits are margin decisions, not just performance ones. Strong point to volunteer.

---

## 5. Do-NOT-claim list

- ❌ Any $/image, $/token, or $/session AI cost — not in code; pull live.
- ❌ A per-session token budget for image gen — none exists.
- ❌ Per-shop transform limit of 500/hr — stale comment; it's **1000/hr**.
- ❌ OpenAI as "primary" — it's the **fallback**; Gemini is primary.
- ❌ Analytics/rate-limit counts as unique-session or deduped — raw event volume.
- ❌ `hero_dismiss` as a counted engagement metric — accepted but uncounted (8 of 9).
- ❌ Subscription tier $ figures as AI/usage costs — they're merchant billing.

---

## 6. Still to measure yourself (not in code)

- Real end-to-end latency, mobile vs desktop (instrument it).
- Current A/B sample size + statistical significance at interview time.
- Per-image AI cost from the provider rate card (then compute §3).
