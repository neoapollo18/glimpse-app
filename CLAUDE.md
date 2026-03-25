# Glimpse App (Gleame) — CLAUDE.md

## What This Is

Gleame is a Shopify app for AI-powered virtual beauty try-on. Customers upload selfies and see makeup/skincare products applied to their face via AI. Targets beauty/cosmetics Shopify merchants to boost conversion and reduce returns.

## Tech Stack

- **Framework:** Remix v2 + React 18 + TypeScript
- **UI:** Shopify Polaris v12 + App Bridge React
- **Database:** Supabase (PostgreSQL) for app data + Prisma ORM (session table only)
- **AI:** Google Gemini API (primary) + OpenAI gpt-image-1 (secondary/fallback)
- **Image processing:** Sharp (resize) + heic-convert (Apple HEIC support)
- **Billing:** Hey Mantle (Shopify subscription management)
- **Build:** Vite v6

## Project Structure

```
app/
  routes/          # Remix file-based routes (flat routes via @remix-run/fs-routes)
  lib/             # Server-side utilities (prompt-generator.server.ts, etc.)
  shopify.server.ts # Shopify app auth + session setup
  db.server.ts     # Prisma client
extensions/
  glimpse-widget/  # Shopify Theme App Extension (Liquid + vanilla JS, no iframe)
prisma/
  migrations/      # Only manages Session table (Shopify OAuth)
data/              # CSVs: categories, category_parameters, parameter_levels
```

## Key Routes

| Route | Purpose |
|---|---|
| `/app` | Dashboard |
| `/app/welcome` | Onboarding / trial |
| `/app/products` | Product config + AI prompt builder |
| `/app/analytics` | Analytics dashboard |
| `/app/billing` | Subscription management |
| `/app/widgets` | Widget showcase |
| `/api/storefront/transform-image` | Public widget API (rate limited) |
| `/api/storefront/track-event` | Analytics tracking |
| `/widget-embed.js` | Dynamic JS loader for storefronts |

## Architecture Patterns

### Funnel-Based Prompt Generation
Merchants select options per beauty parameter → system concatenates into final AI instruction. See `data/categories.csv`, `data/category_parameters.csv`, `data/parameter_levels.csv`, and `app/lib/prompt-generator.server.ts`.

### Variant Support
Products → Variants (colors/shades). Each variant has its own transform prompt + color profile (RGB, hue family). Tables: `product_variants`, `variant_color_profiles`.

### Billing Gate
Every admin page checks: grandfathered? → active Mantle subscription? → grace period? → else redirect to `/app/welcome`. Lives in `app/routes/app.tsx`.

### Session-Based Pricing Tiers
Monthly Shopify sessions determine billing tier (Free/Starter/Launch/Growth). Auto-matched on onboarding via ShopifyQL analytics.

### Conversion Tracking
Cart token passed with widget transform → `orders/create` webhook links purchases to transformations.

### Security (Storefront API)
Shop domain verification: exact match on `shop_domain` OR fallback to `alternate_domains` whitelist. Prevents cross-shop data access.

## Database

- **Supabase (PostgreSQL):** All app data — `shops`, `products`, `product_variants`, `categories`, `category_parameters`, `parameter_levels`, `variant_color_profiles`, `analytics_events`, `conversions`, `reference_images`
- **Prisma:** Only manages the `Session` table for Shopify OAuth sessions

## AI Models

| Model | Use |
|---|---|
| `gemini-3-pro-image-preview` | Variant configs (highest quality) |
| `gemini-2.5-flash-image` | Standard transforms (fast/cheap) |
| `gemini-3.1-flash-image-preview` | High-quality transforms (2K input) |
| `gpt-image-1.5` (OpenAI) | Secondary/experimental |

## Theme Extension

`extensions/glimpse-widget/` is a Shopify Theme App Extension with multiple widget styles (banner, button, embedded horizontal, integrated). Pure Liquid + vanilla JS — no iframe, stays on-domain.

## Environment Variables

Key vars needed: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`, `SHOP_CUSTOM_DOMAIN` (optional).
