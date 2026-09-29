# Gleame v3 — Templates as Decision Shapes, Image Slots, Onboarding Collapse
## Delta spec over v2 · for Charlie + coding agents · 2026-09-26

**What this is.** A delta pass on the 9/26 build (`9_26_Product.pdf`). v2 stays in force except where this doc overrides it. Two documents ship together: this spec and `gleame-v3-wireframes` (published link). **The wireframes are the acceptance criterion for every screen named here.** Where prose and wireframe disagree on layout, the wireframe wins.

---

## Part 0 — With this pass, you need to do this

Ordered. Each item names its section. Do not start a later item before the earlier one is merged.

1. **Fix the three correctness bugs first** (Part 8): template state off-by-one, banner claims that aren't true, blank-quiz arrival dressed as success. These are hours, not days, and every screenshot Aaron reviews after this is wrong until they're fixed.
2. **Run Z0 demolition** (Part 1). It did not run in v2. The 5-step wizard, Sync catalog button, Skip for now, and "Open Quiz Studio → Continue" all still exist. Nothing else in this spec can be verified while they do.
3. **Ship the image-slot widget** (Part 4). Every template screen that has an image position renders a visible placeholder in Studio when the image is unresolved. This is a hard requirement from Aaron and it's what makes templates readable before a store's images are indexed.
4. **Rebuild templates as decision shapes, one agent per template** (Parts 2–3), against the full screen inventory — intro, text question, visual question, email capture, loading, results. Not one screen. All of them.
5. **Rebuild the template gallery as a top-level rail item** (Part 7).
6. **Collapse onboarding to three screens** (Part 6).
7. **Resolve the live flag** (Part 6.4). Either templates reach the storefront or `View on my store` is hidden. Not both.

Every item's done-when includes: screenshot suite posted, conformance diff against the named wireframe screen approved by Aaron, delete-list grep green.

### 0.1 What the 9/26 build showed

Seven findings, so nobody re-litigates them:

1. Generation didn't run — arrival was "No quiz here yet," then a blank scaffold (Untitled question, Option 1/2). Every screen after that is placeholder content in five layouts.
2. The banner said "Built from your 75 products in your store's style · Serif headings · warm ivory palette" over a quiz built from zero products with every color reading "Blank = default."
3. Style panel showed the *previous* template. Banner: Studio; panel: Salon. Consistent off-by-one across all five.
4. All five intros were structurally identical. Templates differed only on the question screen — exactly the one screen the v2 wireframe drew.
5. No image slots anywhere. T2 rendered pale text rows where swatch tiles were specced. T2 and T3 had no reason to exist.
6. Onboarding was untouched. Still 5 steps, still a manual sync button.
7. Storefront rendered the classic quiz with intro and Q1 stacked on one page. Templates aren't reaching shoppers.

### 0.2 Why the wireframe only showed one screen — and the rule that fixes it

The v2 wireframe drew one question screen and one results screen per template. Agents differentiated exactly those two and nothing else. **New rule: a template is not specced until every screen in its inventory (Part 3.0) has a wireframe.** The v3 wireframes cover the full inventory for all five.

---

## Part 1 — DELETE list (Z0, re-issued)

CI grep fails the build if any of these exist after Z0:

- `OnboardingWizard`, `OnboardingStep`, "Welcome to Gleame · Step N of 5", the "What you can do with Gleame" marketing card, "Get Started" as a wizard CTA
- Manual `Sync catalog` button and `Skip for now`
- "Build your quiz → Open Quiz Studio" card and its `Continue`
- "Tell Gleame about your store" and any free-text business-description field pre-Reveal
- Logic tab, dropdown answer selectors, `Not filled in`
- Template radios; `templateVariant` radio group
- Preview card in fake browser chrome
- "No quiz here yet — Start with a blank question" as an arrival state (Part 6.3 replaces it with an explicit error state)
- Template selection nested under Style (`Style → Change template`) — the gallery becomes its own rail item (Part 7)
- Any intro screen shared across templates (Part 5 — intros are per-template components)

Strings banned pre-first-publish: `Finish setup`, `Not filled in`, `What do you want to achieve`, `How did you hear about us`, `Blank = default` (Part 8.2).

---

## Part 2 — The reframe: Template × Look

### 2.1 Why

v2 templates bundled two independent things: the *shape of the decision* the quiz makes, and the *aesthetic*. Aesthetic is already a token layer (`--gq-*`). So five aesthetic templates gave agents nothing structural to build, and they shipped one layout with swapped values. That's not an agent failure; it's what the spec asked for.

### 2.2 Templates (decision shape — five, structurally distinct root components)

| ID | Name | The shopper's question | Output shape | Reference |
| --- | --- | --- | --- | --- |
| T1 | **Match** | "Which one is right for me?" — one correct answer exists (shade, size, material, firmness) | Single hero match + answer echo + alternates | Jones Road |
| T2 | **Consult** | "Help me decide" — multi-factor, considered, higher AOV | Top pick with rationale + comparison of 2–3 | Polysleep, Wen |
| T3 | **Routine** | "What should I use together?" — the answer is a set | Sequenced regimen, bundle price, add-all | Geologie, NuStrips |
| T4 | **Discover** | "What's my type?" — low stakes, fun, gifts | Archetype reveal + kit | current Gleame look |
| T5 | **Clean** | any of the above with no imagery or weak signals | Simple grid | fallback |

Root components `TplMatch | TplConsult | TplRoutine | TplDiscover | TplClean`. CI asserts each renders a different DOM tree for the same quiz payload.

### 2.3 Looks (token presets — three, apply to any template)

| Look | Type | Layout tendencies | For |
| --- | --- | --- | --- |
| **Editorial** | serif headings, tracked kickers | split intro, hairline answers, generous whitespace | luxury, fragrance, interiors, salon |
| **Minimal** | sans, tight | centered column, bordered bars, 8–10 px radius | most DTC, skincare, wellness |
| **Bold** | heavy rounded sans | chunky cards ≥ 16 px radius, filled selection, emoji allowed | playful, dropship, Gen-Z |

A Look changes tokens and a small set of layout switches (intro variant, answer border style, radius cap). It never changes the root component. `Look` is a field on the quiz, defaulted from Brand Profile, overridable in Style.

### 2.4 Assignment

Template from **catalog structure**, Look from **Brand Profile**. Two independent scorers.

Template signals (in priority order): variant-option density (shade/size/finish options on ≥ 60% of products → T1) · price band + spec facets + low SKU count (→ T2) · products tagged/collected as steps, AM/PM, kits, "routine", "set" (→ T3) · playful copy + low AOV + gift collections (→ T4) · else T5. Ties → T5. T4 is never a fallback.

Look signals: serif heading font detected → Editorial · heavy/rounded fonts, saturated accent, emoji in copy → Bold · else Minimal.

Degradation: any template whose image gate fails (Part 4.3) → T5, keeping the Look. Logged as `degraded_from`.

### 2.5 Store-type coverage check

| Store | Template | Look |
| --- | --- | --- |
| Colour cosmetics with shade variants | Match | Minimal or Bold |
| Fragrance, 12 SKUs, serif theme | Consult | Editorial |
| Skincare with cleanser/serum/moisturiser collections | Routine | Minimal |
| Mattress / furniture, spec-heavy | Consult | Minimal |
| Tile / interiors, filters by color + material | Match | Editorial |
| Supplements | Routine | Minimal or Bold |
| Press-on nails, playful copy | Match | Bold |
| Generic 40-SKU apparel, no variant imagery | Clean | any |

If a plausible store doesn't fit the table, that's a spec bug — flag it, don't invent a sixth template.

---

## Part 3 — Template specs

### 3.0 Screen inventory (every template must wireframe and implement all rows)

| # | Screen | Notes |
| --- | --- | --- |
| S0 | Intro | per-template intro type (Part 5); never shared |
| S1 | Text question | answers are text; may carry a leading icon |
| S2 | Visual question | answers carry an image slot (Part 4); required in T1, T2; optional T3, T4; absent T5 |
| S3 | Multi-select variant | of S1 or S2; visible "Select all that apply" + Continue |
| S4 | Email capture | form state + post-submit state with discount code box (Charlie's 9/26 build, kept) |
| S5 | Loading / computing | required in T1; optional T2, T3; absent T4, T5 |
| S6 | Results | per-template, structurally distinct |
| S7 | Mobile of S0, S2, S6 | 390 px |

Structural distinctness tests (snapshot): T1 results contain the echo block; T2 contain a `<table>`; T3 contain a step sequence with ≥ 2 steps and a bundle total; T4 contain the archetype title + kit row; T5 contain a grid and no table. No two templates share an S0 component.

### T1 · Match

- **Questions:** 5–8, in **phases**. Generation groups questions into 2–3 named phases from facet families (e.g. *About you · Your shade · Preferences*). Phase header: full-width segmented bar, phase names 11 px tracked uppercase, active phase filled with `--gq-color-accent` at 20% and the current step filled at 100%. Top-right numeral `03 / 07`.
- **S1 text answers:** full-width rows, 1.5 px border, 14 px vertical padding, **bold tag + description** ("DRY — My skin needs a little more nourishment"). Tag in heading weight, 13 px, tracked; description body 15 px.
- **S2 visual answers:** 3–4 col grid (2 mobile), square tiles, image slot fills the tile, label below 14 px. Selected: 2 px accent ring, 1.02 scale. A tip line beneath is allowed when the facet is perceptual ("Hold a photo of yourself near these swatches").
- **S5 loading:** required. 2.5–4 s, thin ring, brand line, up to 3 rotating trust statements, verbatim-sourced or template-computed ("Matching across {N} shades"). Never invented.
- **S6 results:** `Here's what we think will look amazing` header · left: product gallery (main image slot + 4 thumb slots) · right: **About your match** — checklist of answer echoes (facet label: value) · size/variant selector if variants exist · **Your shade** card with shade swatch slot + one-line description · **Why this works** paragraph mapping 2 answers to 2 product attributes · Add to cart · 2 alternates row · VTO module where configured.
- **Intro type:** Hero photo (Part 5, type B).
- **Email default:** before results, skippable.

### T2 · Consult

- **Questions:** 6–8, labeled progress "Question 3 of 7" + 3 px bar.
- **S1 text answers:** lettered rows A/B/C in a 28 px accent circle, 16 px padding, 12 px radius (Minimal) / hairline rows (Editorial). Selected: accent border + check.
- **S2 visual answers:** 2×2 lifestyle cards, 3:2 image slot, label + one-line description, 1 px border, 12 px radius. Selected: accent border + check chip.
- **S5 loading:** optional, same rules as T1.
- **S6 results:** header · **Based on your answers** recap chips · top-pick card (280 px image slot left; kicker BEST FOR YOU; name; price; 3 `→` bullets each mapping one answer to one attribute) · **comparison table** top pick vs 2 alternates, 3–4 rows from variant options / price band only · secondary CTA per alternate. **String ban in T2:** countdown timers, `Only N left`, `Offer ends`. Polysleep's urgency is theirs, not ours.
- **Intro type:** Landing page with preview + hook (type C). Editorial Look swaps to Split (type A).
- **Email default:** hook at start (type C carries the discount promise) with capture before results; skippable.

### T3 · Routine

- **Questions:** 4–6. May open with an optional name capture ("To start, who is the routine for?" — Skip visible) and use the name in later headings ("Nice to meet you, Maya").
- **S1 text answers:** centered stacked bars, max-width 320 px, 14 px padding, 1 px border, 8 px radius. Selected: `--gq-color-surface` fill + 1.5 px border.
- **S2 visual answers:** optional 2–3 col icon/illustration tiles (image slot at 96 px, centered) — for lifestyle-signal questions ("Do you feel you lack energy?").
- **S5 loading:** optional.
- **S6 results:** `Your personalized routine` header · concern chip(s) from answers · **Why this regimen** block (2 sentences, generated, echoes answers) · **Regimen card**: step list with ☀ Morning / ☾ Night grouping, each step = product card (image slot 72 px, name, role in routine, price) · sticky footer bar `Today's total: $X` + single `Add routine to cart` · individual adds secondary. Bundle price shown only when a Shopify discount is configured; otherwise sum.
- **Intro type:** Founder / voice (type D) when Brand API has a founder image or name; else Minimal (type E).
- **Email default:** gate before results (Geologie pattern) — but always skippable; the skip is a text link under the submit, never hidden.

### T4 · Discover

- **Questions:** 4–5. Segmented pill progress.
- **S1/S2 answers:** 2-col chunky cards, ≥ 16 px radius, 17 px padding, optional 22 px emoji or a 64 px image slot leading, multi-select encouraged. Selected: accent fill, `--gq-color-accent-text`, 1.03 scale bounce ≤ 150 ms.
- **S6 results:** `YOUR {NOUN} TYPE` kicker · `You're a {archetype}` · one playful line · hero product card (4:3 image slot) · **Your {archetype} kit** row of 3 (1:1 image slots) · `Add all 3 — $X`.
- **Intro type:** Bold hero (type B with Bold Look defaults).
- **Email default:** before results, skippable.

### T5 · Clean

- **Questions:** 4–6. 2 px bar + `3/5` numeral.
- **S1 answers:** stacked full-width bars, 15 px padding, 1 px border, radius capped 10 px. No image slots anywhere.
- **S6 results:** header + 2-col grid (1-col mobile) of up to 4 cards — image slot 4:3 (renders as initial block when unresolved, Part 4.2), name, price, one-line why, `Add to cart`.
- **Intro type:** Minimal (type E).
- **Email default:** before results, skippable.

---

## Part 4 — Image slots and the placeholder widget (Aaron's requirement)

### 4.1 The rule

**Every image position in every template is a slot, and a slot always renders.** In Studio, an unresolved slot renders the placeholder widget so the merchant can see that an image belongs there and what kind. Templates are never allowed to silently drop an image position because the store's library hasn't been indexed.

### 4.2 The widget

Component `ImageSlot` with props `{kind, ratio, size, state}`.

- `kind`: `hero | lifestyle | product | variant | swatch | icon | logo | thumb`
- `state`: `resolved | unresolved`
- **Unresolved render (Studio only):** `--gq-color-surface` fill, 1.5 px dashed `--gq-color-border`, radius inherited from the container, centered 20 px image glyph, caption below the glyph in 11 px `--gq-color-text` at 55% opacity: `Image · {kind label}` (e.g. `Image · Variant photo`, `Image · Lifestyle`, `Image · Hero`). Caption hidden when the slot is < 56 px on its short side; the glyph alone remains. Hover: caption gains `Click to choose` and the slot becomes a button that opens the picker (Part 4.5).
- **Unresolved render (storefront):** never the dashed widget. Rule per kind: `hero` → the hero column collapses and the intro falls to its no-image variant · `lifestyle` → card renders text-only with a 4 px accent top rule · `variant | swatch` → tile renders a `--gq-color-surface` square with the answer's initial · `product | thumb` → surface block with product initial · `icon` → omitted, label centered · `logo` → store name in heading font. No layout shift between resolved and unresolved beyond the hero collapse.
- **Resolved render:** the image, `object-fit: cover`, no caption.

Wireframes show every slot in the unresolved state so its position and size are unambiguous. Studio screenshots in the QA suite are taken with the library empty AND with it populated.

### 4.3 Slots per template (the build must render exactly these)

| Template | Slots |
| --- | --- |
| Match | S0 hero (4:5 or 16:9 per Look) · S2 tile per answer (1:1, variant/swatch) · S6 main (1:1) + 4 thumbs + shade swatch + 2 alternate tiles |
| Consult | S0 preview card product (16:10) · S2 card per answer (3:2, lifestyle) · S6 top-pick (4:3) + 2 alternate thumbs |
| Routine | S0 founder portrait (1:1 circle, optional) · S2 icon per answer (96 px, optional) · S6 product per step (72 px, 1:1) |
| Discover | S0 hero (16:9, optional) · S1/S2 leading tile per answer (64 px, optional) · S6 hero product (4:3) + 3 kit tiles (1:1) |
| Clean | S6 card image (4:3) only |

Gates (unchanged from v2 in spirit): Match requires ≥ 80% of S2 answers resolvable; Consult requires ≥ 1 lifestyle/banner image ≥ 1600 px per visual question for ≥ 80% of visual questions. Failing → T5, Look kept.

### 4.4 Images rail

Left-rail item `Images` lists every slot the current template declares, grouped by screen (Intro · Q2 · Q4 · Results), each row = 52 px thumb (widget or image), slot name, source chip (`From your homepage` / `Product image · {title}` / `Not found yet`), `Change`. Unresolved rows sort first with an amber dot.

### 4.5 Picker

Unchanged from v2 Part 4.5 (theme-editor pattern: search, `All · Products · Lifestyle · Banners · Logos`, 4-col grid, Upload allowed post-Reveal only). Add: opening from an `ImageSlot` pre-filters to that slot's kind.

### 4.6 Library not built

The "Needs a brand hero image" lock in the 9/26 build meant *the library didn't index* — an infra state reported to the merchant as a content problem. **Rule:** library indexing runs at sync, automatically, and Studio never opens until it has either completed or failed. If it failed, the Images rail shows one banner: `We couldn't read your store's images yet — retrying` with a retry that re-runs indexing. No human-in-the-loop step. No domain texted to Charlie.

---

## Part 5 — Intro types and email placement

### 5.1 Intro types (five distinct components; templates default to one; Look may swap)

| Type | Layout | Default for |
| --- | --- | --- |
| **A · Split** | fixed 44/56; hero slot left, sticky; kicker + serif headline + 2-line prose + single CTA right | Consult + Editorial, any template + Editorial |
| **B · Hero photo** | centered column; hero slot 16:9 above (portrait product/model); headline; one line; CTA; phase header visible beneath (Match) | Match, Discover |
| **C · Landing + hook** | 2-col: left = rating chip (only if real), headline, one line, 3 benefit chips, primary CTA `{hook}` + support line; right = **quiz preview card** (live render of Q2 in miniature, non-interactive) with a discount badge when a code is configured | Consult |
| **D · Founder / voice** | founder portrait slot (1:1 circle 160 px), `Hi, I'm {name}`, one credentials line, CTA | Routine when founder data exists |
| **E · Minimal** | kicker, headline, one line, CTA, 3 trust items | Clean, Routine fallback |

Trust items are verbatim-sourced (shipping line, guarantee, count) or template-computed. `Rated 4.8/5` appears only when the store has a review app Gleame can read; never typed by default.

### 5.2 Email + discount placement (one setting, per quiz)

- `hook_start` — intro type C promises the discount; capture happens before results; the code renders on submit and is applied silently (Charlie's build). Default for Consult.
- `gate_results` — capture is the last step before results; skip link always visible. Default for Routine.
- `after_results` — results show first; capture is a card below the hero match. Default for Match, Discover, Clean.
- `off`.

Post-submit state (all placements): headline from `Discount reveal message`, code in a dashed box with `Copy`, and `Applied at checkout` confirmation. Reload never re-asks.

---

## Part 6 — Onboarding, generation, and arrival

### 6.1 Three screens, no wizard

1. **Confirm scope** (`/onboarding/scope`): one card. `We found {N} products in {M} collections.` Detected store type line (`Looks like a shade-based beauty store → Match template, Minimal look`) with `Change` inline. Single CTA `Build my quiz`. No Sync button — sync and library indexing already ran on install; this screen waits on them with a spinner if they haven't finished (typically < 60 s).
2. **Building** (`/onboarding/build`): progress with real, sequential steps as they complete: `Reading your catalog · Matching your theme · Writing questions · Checking every product has a path · Placing your images`. Each step shows a real number when done (`Writing questions — 6 questions across 2 phases`). No fake progress bars; the list only advances on completion.
3. **Studio, arrival state** (`/studio/:id/build`): the finished quiz on the themed canvas. Gallery does **not** open on first arrival (the assigned template is the reveal); the gallery is one click away in the rail (Part 7).

### 6.2 Generation is blocking

Studio is unreachable without a quiz that passed the validator (≥ 4 questions, every answer facet-mapped, every product on a path or in the wildcard slot, image gates evaluated). There is no "start with a blank question" arrival.

### 6.3 Failure state

If generation fails or times out (> 120 s): the Building screen becomes `We couldn't build your quiz` with the last completed step shown, `Try again` (re-runs from the failed step), and `Get help` (Intercom, prefilled with store + step). Logged as `generation_failed {step, reason}`. The Chat tab does not exist yet from the merchant's perspective; a blank Studio is not a fallback.

### 6.4 The live flag

`QUIZ_TEMPLATES_LIVE=false` and a visible `View on my store` cannot coexist. Until templates reach the storefront: hide `View on my store`, hide the Live tab's publish action behind the same flag, and show a small grey chip `Preview only` next to the quiz name. When the flag flips, both return. No merchant sees a Studio quiz that disagrees with their storefront.

### 6.5 Banner truth rules (Part 8.2 tests them)

The arrival banner is assembled from the generation report, never from copy. Each chip appears only if its value is real: `Built from your {N} products` requires N ≥ 4 questions grounded in ≥ N products · `{font} headings` requires a detected heading font with confidence ≥ threshold · `{palette word} palette` requires ≥ 2 extracted colors · `{Template} template` reads the assigned template. If nothing qualifies, the banner reads `Built from your catalog. Tap Style to match your brand.` — and never claims a style that wasn't applied.

---

## Part 7 — Template gallery

- Top-level left-rail item `Templates`, directly under `Style`. Not nested.
- Opens full-screen inside Studio. Header: `What should your quiz do?` + one line `Switching never loses your content.`
- Five cards, 2-col. Each card = **three-screen strip** (intro · a visual question · results) rendered live from this merchant's quiz at 0.4 scale, side by side, with the merchant's Look applied. Beneath: template name, the shopper question it answers (from Part 2.2), question range, results shape. Current card ringed + `Current`. Ineligible: 40% opacity, reason chip, `Fix images →`.
- **Look switcher** at the top of the gallery: three pills `Editorial · Minimal · Bold`; changing it re-renders every card. This is how a merchant sees that Look and Template are independent.
- `Use this template` → apply, close, re-render ≤ 1 s, Undo toast. Event `template_switched {from, to, look, source: gallery}`.

---

## Part 8 — Bugs and tests

### 8.1 Fix now

- **Off-by-one:** Style panel's Template field and the banner chip read the previous template. Single source of truth = `quiz.template`; both render from it. Test: switch T1→T2→T3 and assert banner, Style panel, and root component name agree after each.
- **Blank arrival:** "No quiz here yet" is a bug state, replaced by Part 6.3.
- **Identical intros:** five intro components exist; snapshot test asserts distinct DOM.

### 8.2 Truth tests

- Banner chips vs generation report (Part 6.5): a unit test per chip with a fixture where the value is absent.
- `Blank = default` string banned in Style; each color input shows the extracted value with a `From your theme` chip or the preset value with a `Preset` chip. Empty inputs are not a state.
- Storefront never renders the dashed placeholder: snapshot of every template with an empty library on the app-proxy preview route asserts zero `.image-slot--unresolved` nodes.
- Studio always renders it: same snapshot on the Studio route asserts ≥ 1 per declared slot.

### 8.3 Existing suites

All v2 acceptance boxes stand (WCAG AA, T4-never-default, deterministic selection, ≤ 1 s switch, 4-question floor, Luna regression once generation runs again).

---

## Part 9 — Task split and order

| Task | Spec | Must not exist after | Done when |
| --- | --- | --- | --- |
| B0 Bugs | Part 8.1 | off-by-one, blank arrival | 8.1 tests green |
| Z0 Demolition | Part 1 | everything in Part 1 | grep green; app boots scope→build→studio |
| I1 ImageSlot widget + slot registry | Part 4.1–4.3 | any image position not backed by a slot | 8.2 storefront/Studio snapshot tests |
| I2 Library indexing at sync + failure banner | Part 4.6 | "Needs a brand hero image" lock | indexing runs on 3 dev stores without manual action |
| L1 Looks as token presets | Part 2.3 | — | same quiz renders 3 Looks, root component unchanged |
| T-1…T-5 Templates (one agent each) | Part 3 | shared intro component | full inventory conformance diff per template |
| N1 Intro types A–E | Part 5.1 | — | 5 distinct components, snapshot-distinct |
| E1 Email placement setting | Part 5.2 | hardcoded capture position | 4 placements testable |
| O1 Onboarding collapse + blocking generation + failure state | Part 6.1–6.3 | wizard | fresh install reaches Studio with a validated quiz or the failure screen; no third outcome |
| O2 Live-flag gating | Part 6.4 | visible `View on my store` while flag false | flag false → chip shown, button hidden |
| G1 Gallery | Part 7 | `Style → Change template` | 3-screen strips render from merchant's quiz; Look switcher works |
| F3 Screenshot suite v3 | Part 8.2 | — | every template × Look × viewport × library empty/full, posted per build |

Order: B0 → Z0 → {I1, I2, L1} → {T-1…T-5, N1, E1} → {O1, O2, G1} → F3 throughout.

---

## Part 10 — Open questions

v1 Q1–8 and v2 Q9, Q11, Q12 remain open. **Q10 (does the runtime support per-template root components today?) is still unanswered and still sizes T-1…T-5.** Charlie: answer it in one sentence before the template agents start.

13. Founder data for intro type D: is founder name/portrait reachable via Brand API or homepage About page for enough stores to be worth building? Default: build D behind the same detector as Look; fall to E.
14. Bundle pricing for Routine results: sum of products, or require a Shopify automatic discount? Default: sum, with an `Add a bundle discount` link into Shopify Discounts.
