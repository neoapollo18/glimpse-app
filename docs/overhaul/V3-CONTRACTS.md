# Gleame v3 — Frozen Contracts (Template × Look, Image Slots, Onboarding)

Source: `docs/overhaul/V3-SPEC.md` (delta over V2-SPEC) and `docs/overhaul/wireframes-v3.html`
(the v3 wireframes, layout of record). This file freezes the interfaces every v3 work package
consumes. Change these only deliberately; every package assumes them.

Design direction from Charlie (2026-09-28): **do not copy the wireframes' visual styling.** The
wireframes define structure, content, hierarchy, sizes and copy. The visual finish (type,
spacing rhythm, states, motion, polish) is ours to do well. Admin surfaces stay Polaris-native
with a refined custom feel; storefront templates are token-driven and should look like a
premium DTC brand made them.

## 0. Safety rails (non-negotiable)

- `quiz_template = NULL` = legacy rendering. The legacy widget path stays byte-identical.
  Nothing in v3 may touch a shop whose template is null (ORLY, L&M, Glamnetic and every
  other live merchant).
- `QUIZ_TEMPLATES_LIVE` (env, default off) keeps gating the storefront. v3 does NOT flip it.
  Spec 6.4: while it is off, Studio hides `View on my store`, hides the publish action for
  template quizzes, and shows a `Preview only` chip.
- Migrations are written to `supabase-migrations/` and run by Charlie BEFORE deploy. Code must
  tolerate missing columns (read defensively) but may write the new columns.
- No deploys, no pushes, no scripts that wipe or rewrite live rows.

## 1. Template IDs and names (storage keys unchanged, semantics are v3)

`chat_assistant_config.quiz_template` stays `t1..t5`. v3 semantics:

| id | Name | Root component | Root class | Shopper question | Output shape |
|---|---|---|---|---|---|
| t1 | Match | `TplMatch` | `gq-t1` | "Which one is right for me?" | hero match + answer echo + alternates |
| t2 | Consult | `TplConsult` | `gq-t2` | "Help me decide." | top pick with rationale + comparison table |
| t3 | Routine | `TplRoutine` | `gq-t3` | "What should I use together?" | sequenced regimen + bundle total + add-all |
| t4 | Discover | `TplDiscover` | `gq-t4` | "What's my type?" | archetype reveal + kit of 3 |
| t5 | Clean | `TplClean` | `gq-t5` | any, no imagery | simple grid |

v2 ids meant different things (t1 Salon, t2 Studio, t3 Guide, t4 Pop). Migration 080 remaps any
non-null pre-v3 value: `t2→t1`, `t3→t2`, `t1→t5`, `t4→t4`, `t5→t5`. Presets (`quiz_preset`) are
retired: the column stays, nothing reads it.

## 2. Looks: RETIRED 2026-10-01, templates own their design

Charlie (2026-10-01): the Look switcher (Editorial / Minimal / Bold toggle in the gallery and the
Style panel) is removed. Every template has its OWN style so the gallery shows five genuinely
different designs and a merchant picks the one that looks like their store:

| id | Template | Style | Character |
|---|---|---|---|
| t1 | Match | Counter | soft modern beauty counter: pill buttons, elevated cards, blush neutrals |
| t2 | Consult | Editorial | magazine feature: serif display, ivory paper, hairline rules, square corners |
| t3 | Routine | Ritual | calm apothecary: stone and sage, capsule answers, numbered steps |
| t4 | Discover | Pop | heavy rounded type, ink outlines, hard offset shadows |
| t5 | Clean | Swiss | monochrome grotesk, mono numerals, inverted selection |

`TEMPLATE_STYLES` in `app/lib/quiz-templates.ts` holds each style's tokens + radius range;
`resolveQuizTokens(template, brandTokens)` overlays ONLY the brand accent pair and body font. The
heading face belongs to the style (on-store too); Style-panel overrides still win. Root class is
`gq-t{n}` only (no `gq-look-*`). `quiz_look` is no longer read or written (column kept). The
original Look contract below is historical.

### 2a. (historical) Looks

`chat_assistant_config.quiz_look`: `editorial | minimal | bold`, NULL = derive from Brand
Profile (`selectLook`), which falls to `minimal`. Root class `gq-look-{look}` on the widget root
next to `gq-t{n}`.

```ts
export type LookId = "editorial" | "minimal" | "bold";
export interface LookDef {
  id: LookId;
  name: string;              // "Editorial" | "Minimal" | "Bold"
  tagline: string;           // gallery pill hover / Style help text
  tokens: BrandTokens;       // full 12-token preset (used when brand tokens are absent)
  switches: {
    introVariant: "split" | "centered" | "hero";  // Look-level intro tendency
    answerBorder: "hairline" | "bordered" | "filled";
    radiusCap: number;       // px cap for buttons/cards (editorial 4, minimal 10)
    radiusMin: number;       // px floor (bold 16)
    headingTracking: string; // CSS letter-spacing for headings
    kickerTracking: string;
    emojiAllowed: boolean;
  };
}
export const LOOKS: Record<LookId, LookDef>;
export const LOOK_IDS: LookId[];
```

Token resolution (`resolveQuizTokens(template, look, brandTokens)`): start from
`LOOKS[look].tokens`, overlay every non-empty Brand Profile token, then clamp
`radiusButton`/`radiusCard` into `[radiusMin, radiusCap]`. Returns null when template is null
(legacy).

## 3. Registry (`app/lib/quiz-templates.ts`) — exact exports

```ts
export type TemplateId = "t1" | "t2" | "t3" | "t4" | "t5";
export type IntroType = "split" | "hero" | "landing" | "founder" | "minimal"; // spec 5.1 A..E
export type EmailPlacement = "hook_start" | "gate_results" | "after_results" | "off";
export type SlotKind = "hero" | "lifestyle" | "product" | "variant" | "swatch" | "icon" | "logo" | "thumb";

export interface SlotDecl {
  key: string;            // stable slot key, see §5
  kind: SlotKind;
  ratio: string;          // "1:1" | "16:9" | "4:5" | "3:2" | "4:3" | "16:10"
  screen: "intro" | "question" | "results";
  screenLabel: string;    // rail group header: "Intro" | "Q2 · Undertone" | "Results"
  label: string;          // row label: "Hero photo" | "Answer · Neutral" | "Match cards"
  optional: boolean;      // optional slots never gate eligibility
  sizePx?: number;        // fixed-size slots (icon 96, tile 64, thumb 72)
  autoSource?: string;    // "Product images (auto)" when the widget resolves it itself
}

export interface TemplateDef {
  id: TemplateId;
  name: string;
  componentName: "TplMatch" | "TplConsult" | "TplRoutine" | "TplDiscover" | "TplClean";
  rootClass: string;
  shopperQuestion: string;       // spec 2.2 column
  outputShape: string;           // spec 2.2 column
  questionRange: [number, number];
  questionRangeLabel: string;    // "5–8 questions in phases"
  resultsShapeLabel: string;     // gallery card line
  introType: IntroType;          // default (spec 5.1)
  introTypeByLook?: Partial<Record<LookId, IntroType>>; // Consult+Editorial → split
  emailPlacementDefault: EmailPlacement;
  loading: "required" | "optional" | "absent";
  visualQuestions: "required" | "optional" | "absent";
  resultsMarker: string;         // CSS class the results root always carries, for tests
  gates: string;                 // human-readable eligibility rule
  ineligibleReason: string;      // chip text; "" for t5
}
export const TEMPLATES: Record<TemplateId, TemplateDef>;
export const TEMPLATE_IDS: TemplateId[];

/** Every image position the template declares for THIS quiz (spec 4.3). */
export function declareSlots(
  template: TemplateId,
  flow: { questions: Array<{ axisKey: string; prompt: string; options: Array<{ label: string; axisValueValue: string; imageUrl?: string | null }> }> },
  opts?: { hasFounder?: boolean }
): SlotDecl[];

export function defaultIntroType(template: TemplateId, look: LookId): IntroType;
export function defaultEmailPlacement(template: TemplateId): EmailPlacement;
export function isLookId(v: unknown): v is LookId;
export function isTemplateId(v: unknown): v is TemplateId;

export interface TemplateSignals {   // v3 (spec 2.4): catalog structure, not aesthetics
  variantOptionDensity: number | null;   // share of products with shade/size/finish options
  avgPriceCents: number | null;
  avgOptionCount: number | null;         // spec facets per product
  productCount: number;
  routineSignals: number;                // products tagged/collected steps, AM/PM, kits, routine, set
  giftSignals: number;                   // gift collections / playful copy hits
  playfulCopy: boolean;
  lowAov: boolean;
  category: string | null;
  // image gates (store-level approximations; the validator re-checks post-generation)
  imagePerAnswerCoverage: number | null; // Match gate ≥ 0.8
  lifestyleImageCount: number;           // Consult gate ≥ 1 per visual question
  bannerCoverage: number | null;
}
export interface LookSignals { serifHeading: boolean; roundedHeading: boolean; heavyHeading: boolean; avgSaturation: number | null; emojiInCopy: boolean; }
export interface TemplateAssignment { template: TemplateId; scores: Record<TemplateId, number>; signals: string[]; eligible: TemplateId[]; degradedFrom?: TemplateId; }
export function selectTemplate(s: TemplateSignals): TemplateAssignment;  // ties → t5; t4 never fallback
export function selectLook(s: LookSignals): LookId;                      // serif → editorial; heavy/rounded/saturated/emoji → bold; else minimal
export function isTemplateEligible(id: TemplateId, s: TemplateSignals): boolean;
export function resolveQuizTokens(template: string | null, look: LookId | null, brandTokens: BrandTokens | null): BrandTokens | null;
```

Store-type coverage table (spec 2.5) is a unit test fixture: each row's signals must select the
named template and look.

## 4. Storage (migration `080_v3_templates.sql`)

`chat_assistant_config`:
- `quiz_look text` (editorial|minimal|bold, NULL = derived)
- `quiz_email_placement text` (hook_start|gate_results|after_results|off, NULL = template default)
- `quiz_phases jsonb` — `[{ "label": "Skin profile", "axisKeys": ["skin_type", "concern"] }]`, Match only
- `quiz_founder jsonb` — `{ "name": "Nadia", "credentials": "Founder, Aria", "portraitUrl": "https://…" | null }` or NULL
- `quiz_generation_report jsonb` — §8

`shops`:
- `library_index_status text` (`pending|building|ready|failed`, NULL = never attempted)
- `library_index_error text`
- `library_indexed_at timestamptz`

Plus the v2→v3 template id remap (§1). Typed mapper (`ChatAssistantConfig`, `CHAT_ASSISTANT_DEFAULTS`,
`mapChatAssistantRow`) carries every new column; `quiz-config-schema` GENERATED keys register
`quiz_look`, `quiz_email_placement`, `quiz_phases`, `quiz_founder` as copy keys (`quiz_generation_report`
is generator-only, never merchant-editable, never copilot-writable).

## 5. Slot keys (Images rail ⇄ widget ⇄ storage)

`quiz_image_slots` is `{ [slotKey]: "https://…" }`. Keys:

| key | kind | who declares |
|---|---|---|
| `hero` | hero | Match S0, Discover S0 (optional) |
| `founder` | logo→portrait (kind `hero`, ratio 1:1, circle) | Routine S0 (optional) |
| `preview` | product 16:10 | Consult S0 preview card |
| `answer:{axisKey}:{axisValue}` | variant/swatch (Match), lifestyle (Consult), icon (Routine, optional), thumb 64 (Discover, optional) | S2 answers |
| `results` | product (auto) | every template; "Match cards · Product images (auto)" |

Resolution order for a slot at render time: `quiz_image_slots[key]` → the answer's own
`imageUrl` (answer slots) → brand-library auto pick (hero: homepage hero > Brand API cover > widest
lifestyle) → unresolved.

## 6. Widget contract (`gleame-quiz.js` / `gleame-quiz.css`)

Config payload additions (storefront `quiz-config` AND preview `buildPreviewQuizConfig`; all absent
when template is null):

```jsonc
{
  "template": "t1",
  "look": "minimal",
  "brandTokens": { /* resolved 12 tokens */ },
  "emailPlacement": "after_results",
  "phases": [{ "label": "Skin profile", "axisKeys": ["skin_type"] }],   // may be []
  "imageSlots": { "hero": "https://…" },                               // may be {}
  "landing": { "...existing", "founder": { "name": "", "credentials": "", "portraitUrl": null } | null, "rating": null, "benefitChips": ["60 seconds", "No commitment"] },
  "lead": { "...existing", "hasDiscount": true },
  "results": { "...existing", "trustLines": ["…"] }
}
```

`landing.rating` is ALWAYS null in v3 (no review-app reader exists); the widget renders the
rating chip only when it is an object `{ value, count, source }`.

Preview mode (`window.GLEAME_QUIZ_PREVIEW`): the preview route adds `studio: true`. The widget
renders unresolved slots as the dashed placeholder ONLY when `PREVIEW && PREVIEW.studio`. The
app-proxy on-store preview never sets it. Preview URL params (handled by the preview route,
passed through as `PREVIEW.overrides`): `template=t1..t5`, `look=editorial|minimal|bold`,
`step=intro|q1..qN|results` (boots the widget directly on that screen, non-interactive when the
host sets `pointer-events: none`).

Root classes: `gq-t{n}` + `gq-look-{look}`; results root carries the template's `resultsMarker`
class. Every template's intro root carries `gq-intro-{introType}`; no two templates share an
intro DOM (snapshot test).

ImageSlot: `imageSlot({ key, kind, ratio, url, sizePx, alt })` → element with class
`gq-slot gq-slot--{kind} gq-slot--{resolved|unresolved}`; unresolved in Studio adds
`gq-slot--placeholder` (dashed widget, glyph, caption `Image · {kind label}`, caption hidden under
56 px short side, hover caption `Click to choose`, click posts
`{ type: "gleame:pick-slot", slotKey, kind }` to the parent). Unresolved on the storefront renders
the per-kind collapse from spec 4.2 and never `gq-slot--placeholder`.

Studio → widget messages (existing): `gleame-preview-goto {step}`, `gleame-preview-update
{config, flow, sampleRecommend, productJson}`. Widget → Studio (existing + new):
`gleame-preview-at {step}`, `gleame:path {criteria}`, `gleame:screen {screen}`,
`gleame:pick-slot {slotKey, kind}`.

Email placement routing (`routeAfterQuestions` + intro CTA): `hook_start` = intro promises the
discount, capture before results; `gate_results` = capture is the last step before results with a
visible skip link; `after_results` = results first, capture card below the hero; `off` = no
capture. Post-submit state everywhere: discount headline, code in a dashed box with Copy,
"Applied at checkout". Reload never re-asks (`state.leadDone`).

## 7. Studio contract

Loader `studio` object gains:

```ts
{
  template: TemplateId | null;
  look: LookId;                       // resolved (column or derived)
  lookSource: "merchant" | "brand" | "default";
  emailPlacement: EmailPlacement;     // resolved
  templatesLive: boolean;             // process.env.QUIZ_TEMPLATES_LIVE === "true"
  report: GenerationReport | null;
  slots: Array<SlotDecl & { url: string | null; source: "merchant" | "answer" | "library" | "auto" | null; sourceLabel: string }>;
  library: { status: "pending" | "building" | "ready" | "failed" | null; error: string | null; imageCount: number; indexedAt: string | null };
  colorSources: Record<"quiz_accent_color" | "quiz_ink_color" | "quiz_card_bg_color" | "quiz_line_color" | "quiz_cta_color", { value: string; source: "theme" | "preset" | "merchant" }>;
}
```

Single source of truth for the template is `studio.template` (loader, fresh read). The Style
panel and the banner render from it; nothing caches it in component state across revalidations.

`POST /app/api/quiz-template` `intent=set` accepts `template?`, `look?`, `source =
gallery|style_panel|chat`; at least one of template/look required; emits `template_switched
{from, to, look, source}` and/or `look_switched {from, to, source}`.

Arrival banner: pure `arrivalBannerChips(report, template, look): { lead: string; chips: string[]; fallback: boolean }`
in `app/lib/arrival-banner.ts` (spec 6.5 rules; unit-tested per chip with the value absent).

Rail order: `Design` header → `Style`, `Templates`, `Images` (amber dot when any required slot is
unresolved) → `Screens` header → Intro, Q1…QN, Email capture, Results, + Add question. `Templates`
opens the gallery (`?overlay=templates`). Gallery cards = three live iframes
(`step=intro`, `step=q{firstVisual}`, `step=results`) with `&template=&look=`.

## 8. Generation report (`quiz_generation_report`)

```ts
export interface GenerationReport {
  version: 3;
  generatedAt: string;
  productCount: number;        // in-scope products
  collectionCount: number;
  questions: number;
  groundedQuestions: number;   // questions whose every answer maps to ≥ floor products
  phases: number;              // 0 unless Match
  headingFont: { name: string | null; confidence: "high" | "medium" | "low" | null };
  colors: string[];            // extracted hex colors (theme/homepage), [] when none
  paletteWord: string | null;  // derived only when colors.length ≥ 2
  template: TemplateId;
  look: LookId;
  degradedFrom: TemplateId | null;
  imagesPlaced: number;
  imagesTotal: number;         // declared non-optional slots
  storeType: string | null;    // "shade-based beauty store"
  steps: Array<{ key: "catalog" | "theme" | "questions" | "paths" | "images"; detail: string; ms: number }>;
}
```

Written by the generator on success. The onboarding Build screen shows each step's `detail`
as it completes; the Studio banner is assembled ONLY from this object.

## 9. Library status (I2)

`app/lib/brand-library.server.ts` exports
`getLibraryStatus(shopDomain): Promise<{ status, error, imageCount, indexedAt }>` and
`buildBrandLibrary` writes `shops.library_index_status` (`building` → `ready|failed`) around its
run. `POST /app/api/brand-library intent=reindex` re-runs it (admin auth). Images rail banner when
`failed`: `We couldn't read your store's images yet — retrying` with a Retry action.

## 10. Onboarding (O1)

Routes: `/app/onboarding/scope` and `/app/onboarding/build` (Remix files
`app.onboarding.scope.tsx`, `app.onboarding.build.tsx`); `/app/onboard` becomes a redirect to
scope. Dashboard (`app._index.tsx`) sends every shop that has no quiz and would previously have
seen the wizard to `/app/onboarding/scope`. The wizard, sync button, Skip for now, Open Quiz
Studio card, and the OVERHAUL_ONBOARDING gate are deleted (Z0). `shops.overhaul_enabled` stays as
a column, unread.

Build steps (real, sequential): `catalog` (Reading your catalog — N products · M collections),
`theme` (Matching your theme — {font} · {k} colors), `questions` (Writing questions — N questions
across P phases), `paths` (Checking every product has a path — reached / total), `images`
(Placing your images — placed / total). Timeout 120 s → failure state with the last completed
step, `Try again` (resumes from the failed step), `Get help` (Intercom prefilled), event
`generation_failed {step, reason}`.

## 11. Events (additions)

`generation_failed {step, reason}`, `look_switched {from, to, source}`, `template_switched`
gains `look`. `library_built` gains `status`.

## 12. Banned strings (CI, `scripts/check-v2-banned.sh` → v3 list)

Existing list plus: `OnboardingStep`, `Step {n} of 5` (regex `Step \d of 5`), `What you can do
with Gleame`, `Sync catalog`, `Skip for now`, `Open Quiz Studio`, `Tell Gleame about your
store`, `No quiz here yet`, `Start with a blank question`, `Change template`, `Blank = default`,
`templateVariant`, `TplSalon`, `TplStudio`, `TplGuide`, `TplPop`, `Only \d+ left`,
`Offer ends`, `countdown`. Comment lines stay exempt.

## 13. Build notes and deliberate deviations (2026-09-28)

- **Legacy shops cannot adopt a template from the Studio.** The Templates/Images rail items and
  the gallery are hidden when `quiz_template` is null, and `POST /app/api/quiz-template` refuses a
  first template for a shop that already has questions unless `source=onboarding`. Adopting a
  template for a live classic quiz is a deliberate, separate step (script or SQL), never a click.
- `studio.emailPlacement` is `null` for legacy shops; `colorSources[key]` carries an extra
  `fallback` so the per-field reset can render before revalidation.
- The banner's `{Look} look` chip requires a template (legacy shops have no Look applied).
- `GenerationReport.look` is the resolved look (persisted `quiz_look` else `profile.look`) so the
  banner never contradicts a scope-screen choice. `imagesPlaced` counts the auto-resolved hero
  (`quiz_hero_image` / brand cover) as placed, matching the Images rail.
- `quiz_founder` is never written (Q13 default): Routine intros fall to type E until a founder
  detector exists. `landing.rating` is always null.
- Match phases: the generator asks the model for 2–3 phases and validates them as a contiguous,
  exhaustive partition, else chunks deterministically. `saveLiveQuizConfig` clears `quiz_phases`
  when a structural edit breaks the partition; the widget also falls back to the plain segmented
  header when phases don't map.
- Generation writes `quiz_template` for every generated quiz (assigned / merchant-chosen /
  degraded); the storefront still serves legacy until `QUIZ_TEMPLATES_LIVE=true`.
- The widget's `gate_results` ordering stays questions → lead → photo gate → results (gate is off
  for these shops in practice).
- Discover's `YOUR {NOUN} TYPE` kicker uses `results.archetypeKicker` when present, else
  `Your type` (no invented noun). Look radius precedence wins over per-template caps.
- Onboarding Build `Try again` first asks `GET /app/api/quiz-generate?intent=status` and waits
  for a still-running server-side generation (≤ 90 s) before starting a new paid run.
- Brand-library reindex: an in-process lock; a DB `building` with no in-process run is treated as
  an orphan and re-indexed.
- `library=empty` preview override exists for the screenshot suite (`scripts/screenshot-suite.mts`,
  needs Playwright installed manually).
