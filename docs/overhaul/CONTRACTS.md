# Gleame Overhaul — Frozen Contracts & Decisions

Source spec: "Gleame Overhaul Master Spec" + "Screen-by-screen flow" (Aaron Tang, 2026-09-18).
This file freezes the two interfaces every work package consumes (Brand Profile schema,
template registry) and records answers to the spec's VERIFY/open questions against THIS
codebase. Change these only deliberately; downstream packages assume them.

## Answers to the spec's consolidated open questions

1. **Theme asset write / deep-link params** — Theme asset writes need `write_themes`; we are
   NOT taking it in v1 (publish = pageCreate + theme-editor deep link, the spec's fallback =
   2 clicks). The deep link is already proven in production here:
   `admin.shopify.com/store/{handle}/themes/current/editor?template={t}&addAppBlockId={extUuid}/gleame-quiz&target=newAppsSection`
   (see app/routes/app._index.tsx, THEME_EXT_UUID). For publish we pass `template=page.gleame-quiz`.
2. **Admin iframing the proxy preview** — assume blocked (storefronts send frame-ancestors for
   their own domain only). Reveal uses the header-strip fallback frame; "Preview on my store"
   opens the proxy URL in a new tab. If a dev-store test shows framing works, swap the Reveal
   iframe src to the proxy URL — the fallback stays for the rest.
3. **Homepage fetch on password-protected stores** — static fetch of `https://{domain}/`;
   on 401/302-to-/password, retry via the theme preview URL with the offline token where
   possible, else skip homepage analysis (sources degrade to theme settings + Brand API).
4. **Is the runtime one hardcoded layout?** — NO. It is already CSS-token driven
   (`--gq-*` custom properties, `applyStyleConfig`, `detectThemeTypography` inherits theme
   fonts on-store) with per-question option variants (visual/rich/vibe/dotchip/boxed/chip/list),
   two intro layouts, three progress styles. A2 is an extension; template swap = root class +
   per-template CSS + config field.
5. **Sync speed** — current sync is paged GraphQL (8 products/page, resumable cursor), NOT
   bulk operations. Fine ≤ ~200 products; keep paged for v1 (spec's shell-first mode covers
   big catalogs), bulk-ops migration is a later optimization. Collections are NOT synced today —
   C1 adds a lightweight collections fetch for scope chips.
6. **VTO-supported categories** — gate P6 on the shop having VTO configured
   (`shopHasTryOnConfig`) AND `quiz_tryon_enabled`; category list unnecessary in v1 because
   VTO config is per-shop already.
7. **Chat rail** — already tool-based (11 appliers). E5 adds verbs: switch_template,
   apply_preset, match_brand_colors, retone_copy, regenerate_question, rebuild_with_scope.
8. **Theme name logging** — brand_profiles stores theme name/version on every extraction;
   `install_completed` event carries it.

**Scopes** (single re-auth batch, add together): `read_themes` (Part 1),
`write_online_store_pages` + `write_online_store_navigation` (Part 4). Current:
`write_products,read_reports,read_analytics,read_orders`.

**Feature flag**: `OVERHAUL_ONBOARDING` env var + `shops.overhaul_enabled` boolean (per-shop
override). Release one (Parts 1+2+4) ships dark for existing installs; ORLY
(orlybeauty.myshopify.com), L&M (locks-mane.myshopify.com), Glamnetic (glamrco.myshopify.com)
are NEVER auto-enrolled.

## Contract 1 — Brand Profile (frozen)

Table `brand_profiles` (migration 072): one row per shop, `profile` jsonb validating against:

```jsonc
{
  "version": 1,
  "tokens": {                    // the 12-token contract, resolved values
    "fontHeading": "string — CSS stack incl. weight hint",
    "fontBody": "string",
    "colorBg": "#rrggbb",
    "colorText": "#rrggbb",
    "colorAccent": "#rrggbb",
    "colorAccentText": "#rrggbb", // computed for contrast
    "colorSurface": "#rrggbb",    // derived: bg shifted 3-6% lightness
    "colorBorder": "rgba(...)",   // derived: text at 15-25% alpha
    "radiusButton": 12,           // px
    "radiusCard": 18,             // px
    "spaceUnit": 4,               // px, scales the --gq-space-* ladder
    "maxWidth": 1080              // px
  },
  "sources": { "<tokenKey>": { "source": "theme|brand_api|homepage|preset", "confidence": "high|medium|low" } },
  "confidence": "high|medium|low",   // lowest of fontHeading, fontBody, colorBg, colorAccent
  "contrastAdjusted": false,
  "theme": { "name": "Dawn", "version": "15.2.0", "family": "dawn|unknown" },
  "brand": { "slogan": null, "logoUrl": null, "coverImageUrl": null, "primaryColor": null, "secondaryColor": null },
  "homepage": {
    "headingFont": null, "bodyFont": null, "buttonRadius": null,
    "palette": ["#..."], "avgSaturation": 0.0, "avgLightness": 0.0,
    "imageryDensity": 0.0,          // area share of images above the fold, 0-1
    "lifestyleImageCount": 0,       // images ≥1600px wide
    "copySample": "string ≤ 2000 chars"
  },
  "catalog": { "productCount": 0, "types": [], "collections": [], "imageCoverage": 0.0 },
  "category": "string|null",       // P1 guess, e.g. "color-cosmetics"
  "tone": "playful|neutral|refined|null",
  "templateAssignment": { "template": "t2", "scores": {"t1":0}, "signals": ["serif-heading"], "eligible": ["t1","t2","t4","t5"] }
}
```

Merge precedence: theme settings > Brand API > homepage > preset — EXCEPT accent, where
Brand API primary wins if it passes contrast. Confidence: high = theme settings resolved
directly; medium = homepage supplied it; low = preset default. Guardrails: every text/bg
pair passes WCAG AA (4.5:1 body, 3:1 large); accent lightness is stepped until passing,
else preset accent + `contrastAdjusted: true`. The playful house style is NEVER the fallback.

## Contract 2 — Token physical layer (existing CSS vars, do not rename)

The runtime already ships these; the contract maps onto them. Spec name → physical var:

| Contract token   | Physical CSS var        | Notes |
|---|---|---|
| fontHeading      | `--gq-font-heading`     | exists |
| fontBody         | `--gq-font-body`        | exists |
| colorBg          | `--gq-bg`               | exists |
| colorText        | `--gq-ink`              | soft/faint shades derived via color-mix |
| colorAccent      | `--gq-accent`           | exists |
| colorAccentText  | `--gq-accent-text`      | NEW var; buttons/CTA text |
| colorSurface     | `--gq-card-bg`          | exists |
| colorBorder      | `--gq-line`             | exists |
| radiusButton     | `--gq-radius-btn`       | exists |
| radiusCard       | `--gq-radius-card`      | exists |
| spaceUnit        | `--gq-space-unit`       | NEW var; --gq-space-N = unit × {1,2,3,4,6,8,12,16} |
| maxWidth         | `--gq-max-width`        | exists |

Precedence at render: merchant Studio overrides (quiz_accent_color, …) > brand tokens >
template preset defaults > widget CSS defaults. Brand tokens are serialized on quiz-config
as `brandTokens` (camelCase keys above); the widget applies them BEFORE the existing
`applyStyleConfig` merchant overrides.

## Contract 3 — Template registry (frozen)

`quiz_template`: `t1|t2|t3|t4|t5` on chat_assistant_config (null = legacy look, current
behavior, so existing shops render unchanged until assigned). `quiz_preset`: preset id or null.

| id | Name | Root class | Eligibility | AI-settable | Locked |
|---|---|---|---|---|---|
| t1 | Editorial Split | `gq-t1` | always | kicker, visual slot, pill/card | 55/45 ratio, type scale, rhythm |
| t2 | Centered Minimal | `gq-t2` | always (DEFAULT) | icons on/off, bar/grid | everything else |
| t3 | Full-Bleed Immersive | `gq-t3` | landscape lifestyle image per question (≥1600px) | image/question, scrim direction | overlay geometry, scale, bars |
| t4 | Gallery | `gq-t4` | image per answer for most questions | tile images, grid cols | tile geometry, label type, progress |
| t5 | Playful Cards | `gq-t5` | ≥5 pts of playful signals, never default | emoji on/off, card/pill | scale, spacing, motion ≤150ms |

Presets (two per template, complete token bundles): t1 Gallery/Ink, t2 Ivory/Ink, t3 Noir/Dawn,
t4 Air/Studio, t5 Sorbet/Pop. Registry lives in `app/lib/quiz-templates.ts` (shared constants,
importable server + used to serialize config) — single source of truth.

Selection scoring (deterministic; ties → t2; T5 needs ≥5 own points; ineligible = 0):
serif heading → t1+3/t2+2 · muted palette (sat<25%) → t2+3/t1+2 · imagery density + lifestyle
→ t3+3/t1+1 · image-per-answer → t4+3 · bright (sat>55%) or radius≥16 → t5+3/t4+1 ·
rounded-sans heading → t5+2 · beauty-color category → t4+2/t1+1 · nothing above threshold → t2.
Persist `{template, scores, signals, eligible}` on the profile + `template_assigned` event.

## Release plan

R1 (flagged): Parts 1+2+4 — brand profile, tokens, templates, proxy preview, publish.
R2: Part 3 for new installs (scope → build → Reveal replaces wizard).
R3: Part 5 Studio changes. Instrumentation lands with each package (Part 6 event names).
