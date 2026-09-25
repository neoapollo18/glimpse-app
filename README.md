# Gleame

**AI-Powered Virtual Try-On for Shopify Stores**

Gleame is a Shopify app that enables customers to visualize beauty products on themselves using AI-powered image transformation. Upload a selfie, see how products look on you, and boost conversion rates.

## Features

- **AI Virtual Try-On**: Customers upload selfies and see products applied to their photos
- **Multiple Widget Styles**: Banner, button, embedded, and horizontal layouts
- **Category-Specific AI**: Optimized prompts for different beauty categories (lipstick, eyeshadow, foundation, etc.)
- **Variant Support**: Different AI prompts for different product variants (e.g., "Red" vs "Pink" lipstick)
- **Session-Based Billing**: Automatic pricing based on store traffic
- **Analytics Dashboard**: Track transformations, widget views, and conversion metrics
- **Grandfathering**: Existing users maintain free access

## How It Works

```
Customer Journey:
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Customer sees  │ ──▶ │ Uploads selfie  │ ──▶ │  AI transforms  │
│  Gleame widget  │     │   via widget    │     │   their photo   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │ Customer sees   │
                                               │ product on them │
                                               └─────────────────┘
```

## Tech Stack

- **Framework**: [Remix](https://remix.run) (React-based full-stack framework)
- **UI**: [Shopify Polaris](https://polaris.shopify.com/) design system
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL)
- **AI**: Google Gemini API for image transformations
- **Billing**: [Hey Mantle](https://heymantle.com/) for Shopify subscription management
- **Hosting**: [Render](https://render.com/)
- **Shopify Integration**: Shopify App Remix, App Bridge, Theme Extensions

## Project Structure

```
app/
├── lib/                    # Server-side utilities
│   ├── ai.server.ts        # Gemini AI integration
│   ├── mantle.server.ts    # Billing/subscription management
│   ├── supabase.server.ts  # Database operations
│   ├── pricing-tiers.ts    # Pricing configuration
│   └── plan-matcher.server.ts # Session-to-plan matching
├── routes/
│   ├── app.tsx             # Main app layout + billing gate
│   ├── app.welcome.tsx     # Onboarding/subscription page
│   ├── app.billing.tsx     # Billing management
│   ├── app.products.tsx    # Product configuration
│   ├── app.analytics.tsx   # Analytics dashboard
│   ├── app.widgets.tsx     # Widget customization
│   ├── app.settings.tsx    # App settings
│   └── api.*.ts            # API endpoints
extensions/
└── glimpse-widget/         # Shopify theme extension
    ├── blocks/             # Liquid templates
    └── assets/             # JS/CSS for widgets
```

## Environment Variables

```bash
# Shopify
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_APP_HANDLE=gleame

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_API_KEY=your_service_role_key

# AI
GEMINI_API_KEY=your_gemini_api_key

# Billing
MANTLE_APP_ID=your_mantle_app_id
MANTLE_API_KEY=your_mantle_api_key

# Optional
INTERCOM_APP_ID=your_intercom_id
```

## Pricing Tiers

**Gleame is currently free at every tier** (2026-09: all tier prices are $0 in
`app/lib/pricing-tiers.ts`, the single source of truth — the billing gate,
usage-charge cron, billing page, and Shopify approval terms all derive from
it). The session-tier structure remains in place for when paid pricing
returns:

| Tier | Sessions/Month | Price |
|------|----------------|-------|
| Free | 0 - 2,500 | $0 |
| Starter | 2,501 - 5,000 | $0 (was $30/mo) |
| Launch | 5,001 - 25,000 | $0 (was $149/mo) |
| Growth | 25,001+ | $0 (was $399/mo) |

## Local Development

### Prerequisites

- Node.js 20+
- Shopify Partner Account
- Shopify Development Store

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Press `P` to open the app in your development store.

### Database Setup

Run Supabase migrations in order:
```bash
# See supabase-migrations/ folder for migration files
```

## Deployment

### Render (Recommended)

1. Connect your GitHub repo to Render
2. Set environment variables
3. Deploy

### Build

```bash
npm run build
```

## Billing Flow

```
New User Install
       │
       ▼
┌──────────────────┐
│ Fetch Sessions   │──▶ Match to pricing tier
│ from Shopify     │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Welcome Page     │──▶ Auto-select plan based on sessions
│ (14-day trial)   │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Shopify Billing  │──▶ Merchant approves subscription
│ Approval         │
└──────────────────┘
       │
       ▼
    App Access
```

## Widget Integration

Merchants add widgets to their theme via Shopify's Theme Editor:

1. Go to Online Store → Themes → Customize
2. Add Gleame block to product pages
3. Configure style and placement

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/transform-image` | Transform image (internal) |
| `POST /api/storefront/transform-image` | Transform image (widget) |
| `POST /api/storefront/track-event` | Track analytics events |
| `GET /api/get-variants` | Get product variants |
| `GET /api/get-category-data` | Get category configuration |

## Support

- Email: charles@gleame.ai
- Website: [gleame.ai](https://gleame.ai)

## License

Proprietary - All rights reserved
