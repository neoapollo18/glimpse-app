# Gleame v2 — Studio Reveal, Store-Type Templates & Image System
## Master Spec for Charlie + Coding Agents · 2026-09-22

**Supersedes:** the screen specs M3 (Reveal), M8 (Studio), M9 (Check matches), and Part 2 (Template system) of the v1 master spec. **Still binding from v1:** the design-token contract (`--gq-*`, 12 tokens), Brand Profile extraction (Part 1), app-proxy preview & publish (Part 4), the grounding validator, the event schema (extended in Part 8 below), and all v1 glossary terms. Where this doc conflicts with v1, this doc wins.

---

## Part 0 — Why the last spec failed to translate, and how this one is written

Read this before implementing anything. The v1 spec was correct and the build still came out wrong. The failure was not effort — it was five specific translation mechanics. Each one has a countermeasure that is now a rule in this spec.

### 0.1 The five failures and their fixes

**Failure 1: The spec described changes to screens; agents patch what exists.** v1 said "the Logic tab is inverted → Check the matches." The agent kept the Logic tab's dropdowns and badges and added a panel next to them. Editing language invites minimal diffs.
→ **Fix: this spec defines NEW routes with new component names and an explicit DELETE list (Part 1). An agent cannot "patch" a file it has been ordered to delete.** Every task in Part 9 names the files/routes that must not exist when the task is done, and the acceptance test greps for them.

**Failure 2: Old containers absorbed new features.** The Reveal was built as content inside the 7-step onboarding wizard because the wizard was the existing container for "post-install screens."
→ **Fix: the kill list is now a build gate, not a bullet.** Task Z0 (Part 9) deletes the onboarding wizard shell *first*, before any new screen is built. Nothing new can be nested in a container that no longer compiles.

**Failure 3: Quality was specified as adjectives; agents ship the letter, Charlie approves the letter.** "Elegant split-screen" became a 50/50 flex div with default fonts. Charlie tested function, saw it worked, believed it looked good.
→ **Fix: every template screen in this spec has (a) numbers — exact type scale, spacing, ratios, radii — and (b) a reference wireframe file (`wireframes.html`, shipped with this spec) that IS the acceptance criterion.** Review = open the wireframe next to the build and diff visually. Charlie checks conformance-to-reference, not judgment. Aaron owns the reference.

**Failure 4: Generation quality depended on optional merchant input.** "Tell Gleame about your store" — five blank optional fields — reintroduced the banned pattern; when empty, generation produced 2 ungrounded questions.
→ **Fix: generation consumes ONLY machine-derived inputs** (catalog facets, Brand Profile, homepage signals). There is no free-text "about your store" surface anywhere pre-Reveal. Minimums are enforced in the validator (Part 5): ≥ 4 questions, every answer grounded, every answer's imagery resolved by construction.

**Failure 5: No screenshot loop.** Aaron saw builds days later, in production.
→ **Fix: every task's Done-when includes an automated screenshot suite** (routes × 2 viewports × the 4 synthetic Brand Profiles from v1). Screenshots post to the shared channel per build. Aaron approves in ≤ 2 min or files change notes against the reference wireframe by element name.

### 0.2 Rules for agents (additions to v1's five rules)

6. **Delete before you build.** If your task lists routes/components under "Must not exist," remove them in your first commit. CI greps for the banned identifiers and strings.
7. **The wireframes are the spec of record for layout.** Where prose and `wireframes.html` disagree on visual detail, the wireframe wins. Where the wireframe is silent (behavior, data, states), prose wins.
8. **Numbers are not suggestions.** "clamp(34px, 4.5vw, 52px)" means that expression, verbatim. If a number is impossible, stop and flag — do not substitute.
9. **Never invent a fallback style.** Every degradation path in this doc names its destination (usually T5 Clean). If you hit an unspecified gap, fall to T5 Clean and flag it — never to the playful house style.

---

## Part 1 — New routes and the DELETE list

### 1.1 New route map (embedded app)

| Route | Screen | Replaces |
| --- | --- | --- |
| `/onboarding/scope` | M1 Scope (unchanged from v1) | old wizard steps 1–3 |
| `/onboarding/build` | M2 Build progress (v1, plus Part 5.6 trust content) | old wizard steps 4–7 |
| `/studio/:quizId/build` | **Studio · Build tab — the arrival/Reveal state (Part 2)** | v1's separate M3 Reveal route AND the current builder landing |
| `/studio/:quizId/build?overlay=templates` | Full-screen template overlay (Part 2.4) | style-bar thumbnails |
| `/studio/:quizId/build?rail=images` | Images rail open + brand library picker (Part 4.5) | — (new) |
| `/studio/:quizId/matches` | Check matches (Part 6) | Logic tab route |
| `/studio/:quizId/live` | Live tab, slimmed (Part 7) | current 3-panel Live tab |

New installs land on `/studio/:quizId/build` directly after M2 completes. There is **no** standalone Reveal route in v2 — the Reveal is the Build tab's first-run state.

### 1.2 DELETE list (remove the code, not the nav link)

CI check: repo-wide grep for these identifiers/strings fails the build if found after task Z0.

- Onboarding wizard shell + steps 1–3 and 5–7 (components matching `OnboardingWizard`, `OnboardingStep`, routes `/onboarding/welcome|goals|attribution|sync|book`)
- "Tell Gleame about your store" screen and its five fields (any component/string matching `about your store`, `store description`, `brand keywords` in onboarding scope)
- Manual "Sync my catalog" button
- "Prefer we set it up? Book a call" inside any onboarding/Studio surface
- Logic tab route and components: dropdown answer-selectors, `Not filled in` badge (string ban: `Not filled in`), "Generate my recommendation logic" button
- The five radio-button "templates" (Editorial Split / Centered Minimal / Full-Bleed / Gallery / Playful Cards as token-swap radios) and any `templateVariant` radio group in Studio settings
- The white-card-in-fake-browser-chrome preview frame component
- "Finish setup" CTA (string ban pre-first-publish: `Finish setup`)

Strings that must appear nowhere before first publish (existing v1 bans, restated): `What do you want to achieve`, `How did you hear about us`.

---

## Part 2 — Studio-based arrival: the Reveal lives in the Build tab

**Purpose.** The first thing a merchant sees after M2 is Quiz Studio's Build tab showing a *finished quiz on a themed canvas* — their fonts, their colors, their products — not a builder. Editing tools are present but quiet. The "that's my site" moment happens inside the tool they'll keep using, so there is no cliff between reveal and editing.

### 2.1 Layout (desktop, ≥ 1024 px)

- **Top bar (56 px):** quiz name (editable inline) left; center segmented tabs `Build · Check matches · Live`; right: secondary button `View on my store` + primary button `Publish`.
- **Left rail (240 px):** items in order — `Style`, `Images`, divider, `Intro`, `Q1…QN`, `Email capture`, `Results`, `+ Add question`. First-run: `Intro` selected.
- **Center canvas:** the quiz rendered full-bleed on the **themed canvas** — background is `--gq-color-bg`, fonts are the store's, the assigned template's layout. NO white card, NO fake browser chrome, NO drop shadow frame. Canvas top edge carries a slim store-context strip (32 px): the store's logo (from Brand API) at left on `--gq-color-bg` — enough context to read as "my store," not a fake browser. Device toggle (Desktop/Mobile) floats bottom-center of canvas.
- **Right rail (320 px):** Edit panel for the selected screen + Chat (existing shell, unchanged architecture).

Mobile admin (< 768): rails collapse to sheets; canvas is full-width; tabs remain.

### 2.2 First-run banner (dismissible, shown once per quiz)

A single row banner between top bar and canvas, background `--gq-color-surface`, 1 px `--gq-color-border` bottom:

> **Built from your {N} products in your store's style.** Serif headings · cream palette · Salon template. Play it through, then publish — nothing is live yet. `[Play the quiz]` `[×]`

- `Play the quiz` scrolls canvas to Intro and enters preview-play mode.
- Chip text uses the real detected values (font family name, palette word, template name) — same source as v1's "Matched to your theme" chip. Low confidence variant: "Styled with {preset} — tap Style to match your brand."
- Dismiss = never shown again for this quiz. **Events:** `reveal_viewed` fires on first render of this state; `reveal_quiz_played` when preview-play reaches results.

### 2.3 `View on my store`

Top-bar secondary button, always present (not first-run only). Opens the v1 Part 4 app-proxy preview URL in a new tab. First-run only: a one-time tooltip on it — "See it inside your real theme." **Event:** `store_preview_opened`.

### 2.4 Template overlay (full-screen, Shopify theme-library pattern)

Trigger: `Style` rail item → "Change template" OR left-rail long-press on Style. Opens as a **full-screen overlay inside Studio** (not a modal card): header "Choose a template · built for your kind of store" with `[×]`, then a 2-col (desktop) grid of five large template cards, each **a live render of THIS merchant's actual Q1 + results page** in that template with their tokens — never stock screenshots.

Card anatomy: 16:10 live render (interactive scroll within card), template name + one-line who-it's-for ("Salon — for elegant, editorial brands"), eligibility state. Current template ringed with `--gq-color-accent` + "Current" chip. Ineligible cards render at 40% opacity with reason chip ("Needs an image for most answers" / "Needs lifestyle photos") and a `Fix images` link that deep-links to the Images rail. CTA per card: `Use this template`.

Switching: applies template, closes overlay, canvas re-renders ≤ 1 s, Undo toast ("Switched to Studio — Undo"). No content loss ever. **Events:** `template_switched {from, to, source: 'overlay'}`.

### 2.5 Acceptance criteria (Part 2)

- [ ] Fresh install lands on `/studio/:id/build`; the first paint is the themed canvas with the finished quiz; the strings "Finish setup", "Not filled in" appear nowhere (CI grep).
- [ ] Canvas background equals `--gq-color-bg` (pixel test at 4 canvas corners), not `#fff`, on the elegant-serif synthetic profile.
- [ ] Banner shows real detected values; dismiss persists across reloads.
- [ ] Overlay renders 5 cards as live renders of the merchant's own Q1 (verify a product title from the dev store appears inside ≥ 3 cards).
- [ ] Template switch round-trips in ≤ 1 s with Undo.
- [ ] Conformance: side-by-side diff against `wireframes.html → Studio Reveal` and `→ Template overlay` approved by Aaron.

---

## Part 3 — Five templates as store types (T1–T5)

A template in v2 is a **store type**, not a token swap. Templates differ structurally: question count range, answer rendering, imagery model, intro style, progress treatment, and — critically — the **results page layout**. All consume the v1 `--gq-*` tokens; each ships two presets (v1 rule). Breakpoints 768/1024; mobile single column. The wireframes render each template with a demo brand; those renders are the visual contract.

**Mapping (replaces v1's selection table inputs → outputs; scoring mechanics from v1 stay):** elegant/luxury/fragrance signals → **T1 Salon**; visual-attribute beauty (shade/color/shape catalogs) → **T2 Studio**; considered purchases (furniture, mattresses, high-AOV, spec-heavy) → **T3 Guide**; playful/dropshipper signals → **T4 Pop**; everything else and every degradation → **T5 Clean**. T5 is the universal default; T4 is never a fallback (v1 rule holds). Ties break toward T5.

**Eligibility gates (hard, checked before scoring):** T2 requires ≥ 80% of generated answers to have a resolvable image (Part 4); T3 requires ≥ 1 qualifying lifestyle/landscape image per question (≥ 1600 px wide) OR collection-banner substitutes for ≥ 80% of questions; T1 requires ≥ 1 brand hero image (portrait or landscape ≥ 1200 px). Failing a gate → template disabled in the overlay with the reason chip.

### T1 · Salon — the consultation
*Reference pattern: Wen (fixed split, editorial serif, prose results). Steal: the fixed left image + right scroll, PDP-depth results prose. Leave: full-PDP results layout.*

- **Layout:** fixed split. Left 44% — a single brand hero image, `position: sticky`, full height, no per-question image swapping (one image for the whole quiz; merchant can change it in Images rail). Right 56% — scrolling column, max-width 560 px centered in its half, `--gq-space-unit` 12 px, vertical padding 96 px.
- **Type:** question in heading font, `clamp(30px, 3.2vw, 44px)`, weight per token stack, line-height 1.15, letter-spacing −0.01em. Kicker above question: body font 12 px, letter-spacing 0.14em, uppercase only if the theme's own buttons are uppercase (else sentence case) — never default to caps.
- **Answers:** full-width text rows, 20 px vertical padding, separated by 1 px hairline (`--gq-color-border`), no boxes, no radius. Hover: text indents 8 px (150 ms ease). Selected: 2 px left rule in `--gq-color-accent` + text in accent.
- **Progress:** 2 px unlabeled bar at the very top of the right column, fill `--gq-color-accent`. No "1 of 5" numerals.
- **Questions:** 4–5. Intro (own screen, Part 5.3): kicker + one serif line + single CTA `Begin`.
- **Results:** *consultation prose.* Header line ("Your ritual, composed."), then a 2-sentence written recommendation in body serif referencing the shopper's answers by name, then 2–3 product cards stacked full-width — image left 120 px square, name/price/why-this right, hairline separators, `Add to bag` text-link style. No grid.
- **Imagery model:** 1 brand hero (Part 4 source priority: homepage hero > Brand API cover > best lifestyle product image).

### T2 · Studio — the shade finder
*Reference pattern: Jones Road / INH (answers ARE the visuals; results loading with trust content; answer echo). Steal: swatch-grid answers, loading-screen methodology content, "About your match" echo. Leave: nothing structural.*

- **Layout:** single centered column, max-width 880 px. Question centered, `clamp(26px, 2.6vw, 36px)`.
- **Answers:** the core — a 3–4 col grid (2 on mobile) of **image tiles**: square, `--gq-radius-card` capped at 12 px, image fills tile (product cutout, variant swatch, or texture per Part 4), label beneath in body font 14 px. Selected: 2 px `--gq-color-accent` ring + 1.02 scale (120 ms). A question whose answers lack images may NOT render text-only here — it renders T5-style bars inside T2 only if ≤ 1 question is affected; more than that fails the eligibility gate.
- **Progress:** slim full-width bar under the header, 3 px.
- **Questions:** 4–6, multi-select allowed on attribute questions.
- **Results computation screen (required in T2):** before results, a 2.5–4 s staged screen — brand line + 3 rotating trust statements sourced from P5 tone extraction (founder line if Brand API slogan exists, guarantee, methodology "Matching across {N} shades") with a thin progress ring. Never fake-infinite; caps at 4 s.
- **Results:** shade reveal. Top: "About your match" block echoing answers back as chips ("Undertone: warm · Coverage: sheer"), then the hero match card — large swatch/product image, shade name, price, why-this — then 2 alternates in a row, then the VTO before/after module when VTO is configured (upgrade framing per v1 P6).
- **Imagery model:** image per answer, by construction (Part 4.3).

### T3 · Guide — the considered purchase
*Reference pattern: Polysleep (diagnostic depth, answer recap, comparison). Steal: lifestyle answer cards, answer-recap on results, comparison table. Leave: countdown timers, urgency banners — string ban in T3: any countdown/`Only.*left` pattern.*

- **Layout:** centered column max-width 960 px; question `clamp(26px, 2.8vw, 38px)`.
- **Answers:** 2×2 (desktop) lifestyle cards, 3:2 ratio image top, label + one-line description below, `--gq-radius-card`, 1 px border; selected = accent border + check chip top-right. Text-only fallback per question: bordered cards without image (allowed for ≤ 20% of questions before the gate fails).
- **Progress:** labeled steps ("Question 3 of 7") right-aligned above the question — diagnostic length is a feature; show it honestly.
- **Questions:** 6–8. This is the only template allowed > 6.
- **Results:** rationale + comparison. Header, then "Based on your answers" recap row (chips), then the top match card with a 3-bullet *why* mapped to specific answers, then a **comparison table** of top match vs 2 alternates (rows: 3–4 spec facets from variant options/price band; generated from catalog facets only — no invented specs).
- **Imagery model:** lifestyle per question (Part 4 sources 1–3), product images in results.

### T4 · Pop — the personality quiz
*Today's Gleame look, earned not defaulted.*

- **Layout:** centered, max-width 720 px; question `clamp(28px, 3vw, 40px)` in a rounded/bold stack.
- **Answers:** chunky cards, radius ≥ 16 px (or theme token if larger), 2-col grid, optional emoji 22 px leading each label, multi-select encouraged; selected = accent fill with `--gq-color-accent-text`, 1.03 scale bounce ≤ 150 ms.
- **Progress:** chunky segmented pill bar, one segment per question.
- **Questions:** 4–5.
- **Results:** "You're a ___" personality reveal — big archetype title + one playful line, hero product card, then a **bundle row** ("Your {archetype} kit") of 3 products with a single `Add all` CTA alongside individual adds.
- **Imagery model:** product cutouts; emoji fills gaps; never blocks.

### T5 · Clean — the universal default
*Works with zero imagery. The fallback for every degradation. Restraint is the design — never "playful-as-fallback."*

- **Layout:** single centered column, max-width 640 px, generous whitespace (`--gq-space-unit` 10 px, section gaps 5 units).
- **Answers:** stacked full-width bars, 16 px vertical padding, 1 px border, `--gq-radius-button` capped at 10 px; selected = 1.5 px accent border + `--gq-color-surface` fill. Optional 20 px line icon leading (on only if the archetype provides one).
- **Progress:** thin bar, 2 px, plus "3/5" numeral right-aligned, 12 px.
- **Questions:** 4–6.
- **Results:** header + up to 4 product cards in a 2-col grid (1-col mobile) — image (or `--gq-color-surface` placeholder block with product initial when no image exists), name, price, one-line why, `Add to cart`.
- **Imagery model:** none required anywhere.

### 3.6 Acceptance criteria (Part 3)

- [ ] Visual QA matrix: 5 templates × 4 synthetic profiles × 2 viewports, screenshot-diffed against `wireframes.html` per template; Aaron signs the baseline once.
- [ ] Structural distinctness test: rendering the same quiz in T1 vs T2 vs T3 changes the DOM structure (distinct root layout components `TplSalon|TplStudio|TplGuide|TplPop|TplClean`), not only CSS variables. CI asserts the component names.
- [ ] T3 renders 7 questions where the archetype supplies them; T1/T4 never exceed 5.
- [ ] Results pages differ per template per the specs above (snapshot tests: T1 has no grid; T3 contains a table; T4 contains the bundle row; T2 contains the echo block).
- [ ] Eligibility gates enforced before scoring; overlay shows reasons.
- [ ] All v1 guardrails hold (WCAG AA, no house-style fallback, deterministic selection, T4-never-default regression test — v1's T5-never-default test is retargeted to T4).

---

## Part 4 — Image sourcing & the brand library

**Principle: image sourcing is a grounding rule.** Answers are generated FROM catalog facets, so each answer arrives with its image attached *by construction* — the facet's own imagery — never matched after the fact. Never ask for uploads during first run. Never AI-generate imagery. Never stock photos.

### 4.1 The brand library (per-store image index, built at sync)

At catalog sync, build `brand_library`: every image the store already owns, indexed and tagged.

| Source (priority) | What | Feeds |
| --- | --- | --- |
| 1. Product media beyond image 1 | lifestyle shots, swatches, texture/detail | T3 question imagery, T1 hero candidates, T2 tiles |
| 2. Collection banner images | curated category imagery | T3 per-question, scope-chip art |
| 3. Homepage + Brand API assets | hero, cover, logo, slideshow images | T1 hero, T2 loading screen, header strip |
| 4. Variant-level images | shade/size swatches | T2 answer tiles (core), T4 cutouts |

Tags per image (stored on the record): `role` (packshot / on-model / lifestyle / swatch / texture / banner / logo), `ratio`, `width`, `dominant_colors`, `has_face` (cheap face detection), `source`, `product_ids`. **Open question 9 (Charlie):** classification cost at sync — default is heuristic-first (ratio + filename + position + palette), lazy ML classification only for stores that hit a T2/T3 gate decision, cached forever.

### 4.2 Attachment by construction

- T2: answer = variant/facet value → its image IS the variant image (source 4), else the facet's representative product cutout. An answer with no image at generation time is regenerated against a facet that has one, or the question is swapped from the bank — the validator (Part 5) enforces this exactly like product-grounding.
- T3: question ← its facet's collection banner (source 2) else best lifestyle image (source 1, `role: lifestyle`, width ≥ 1600) else the gate fails toward T5.
- T1: hero = homepage hero (3) else Brand API cover (3) else widest `lifestyle` image (1).
- T4/T5: product image 1 / none.

### 4.3 Degradation ladder (per template, deterministic)

`T2 → (answers lose images) → T5` · `T3 → (lifestyle gate fails) → T5` · `T1 → (no hero) → T5` · `T4 → (playful signals absent) → was never assigned` · `T5 → nothing below`. Every fall is logged on `template_assigned.signals.degraded_from`. Publishing is NEVER blocked by imagery.

### 4.4 Images rail (post-Reveal, in Studio)

Left-rail item `Images` (below Style). Panel lists every image slot the current template uses, grouped: Hero (T1), Question imagery (T3), Answer tiles (T2), Loading screen (T2), Results. Each slot: 64 px thumb, slot name, source chip ("From your homepage"), and `Change`.

### 4.5 Brand library picker (the Shopify-theme-editor pattern — Aaron's requirement)

`Change` opens a **modal picker identical in pattern to Shopify's theme-editor image picker**: header "Your brand library" + search; filter chips `All · Products · Lifestyle · Banners · Logos`; a 4-col masonry grid of the indexed `brand_library` thumbnails (lazy-loaded, source badge on hover); footer: `Upload image` (secondary — allowed HERE, post-Reveal only) and `Select` (primary, enabled on selection). Selecting re-renders the canvas ≤ 1 s with Undo. Uploads enter the library tagged `source: upload`.

### 4.6 Acceptance criteria (Part 4)

- [ ] On the beauty dev store, ≥ 90% of T2 answer tiles resolve to variant/product images with zero merchant action.
- [ ] No upload UI exists on any route before `/studio/:id/build` (CI: `input[type=file]` banned in onboarding bundle).
- [ ] Gate-failure path lands on T5 with `degraded_from` logged; canvas never shows a broken-image glyph (placeholder block instead).
- [ ] Picker filters by tag correctly on a 300-image store in < 200 ms per filter; conformance diff vs `wireframes.html → Images & library`.

---

## Part 5 — Generation pipeline v2 (deltas to v1 P1–P7)

P1–P7 stand. Changes:

- **5.1 (P3) Minimum 4 questions, hard floor, any catalog size.** A 17-product store gets 4 questions (v1 allowed the model to go low; the Luna build produced 2). The validator rejects < 4; bank-fallback fills.
- **5.2 (P3+P4 unified with imagery)** The grounding validator now checks three floors per answer: products (≥ 3, ≥ 2 small-scope — v1), reachability (≥ 80% — v1), **and imagery per the assigned template's model (Part 4.2)**. One validator, one pass, in code.
- **5.3 Intro is its own screen.** Every template generates an Intro: headline in the store's voice, one support line, single CTA. Never stacked with Q1. Runtime already has the intro screen type — use it.
- **5.4 Unmapped products are prevented, not warned.** P4 must end with 100% of in-scope products attached to ≥ 1 path OR explicitly parked in a generated "everything else" wildcard slot; the "41 products no path reaches" state is a validator failure, never a merchant-facing warning. The Check-matches drawer (Part 6) then only ever shows post-edit orphans.
- **5.5 Answer copy bans:** generic-vibe answers with no facet behind them ("Everyday reliability") are impossible by construction — every answer names or maps to a facet value; validator asserts the mapping is non-empty.
- **5.6 Results-computation content (T2, optional T3):** P5 additionally extracts up to 3 trust statements (slogan, guarantee/shipping line from homepage, catalog-scale line). Hard ban on fabrication stands: statements must be verbatim-sourced or template-computed ("Matching across {N} shades"), never invented claims.
- **5.7 Results echo (T2/T3):** persist the shopper's answer chips into the results payload so the echo block renders from real answers.

Acceptance: Luna regression — the 17-product Luna catalog generates ≥ 4 questions, zero ungrounded answers, T2 assigned with tiles resolved, results echo present. This exact store is the smoke test.

---

## Part 6 — Check matches (rebuild; route `/studio/:id/matches`)

Delete the Logic-tab components entirely (Part 1.2). New screen: **left 55% = the actual quiz, playable**, in the assigned template on the themed canvas (same renderer as Build). **Right 45% = live results panel** for the current answer path: header "Play through — do the matches look right?"; each product card shows image, name, price, "Why: matched {answer}, {answer}", and three buttons `Pin` `Exclude` `Boost`. Actions write the existing rules format, re-render the path ≤ 500 ms, Undo toast. Collapsed `Advanced: edit matching notes` beneath (AI annotations, editable, demanded of no one). Footer drawer only when post-edit orphans exist: "{N} products unreached after your edits" + `Attach to answer…`. No dropdown answer-selection UI anywhere; answers are chosen by playing.

Acceptance: Pin→rules-diff→replay round-trip; grep bans `Not filled in`; conformance diff vs `wireframes.html → Check matches`.

---

## Part 7 — Live tab, slimmed

The 3 panels collapse to: a **publish sheet** (slide-over from `Publish`, usable from any tab): pre-publish checklist (v1, kept), placement (dedicated page default), "Add to main menu" checkbox (default on), `Publish` → v1 Part 4 mechanics → success state with live URL. The Live tab itself becomes: status header (Live/Off + URL + switch), quieter **version history** as a simple list (restore per row), and the placements settings link. Nothing else.

---

## Part 8 — Event deltas

All v1 events stand. Add/extend: `reveal_viewed {surface: 'studio_build'}` · `template_switched {source: overlay|style_panel|chat}` · `template_assigned.signals.degraded_from` · new `image_slot_changed {slot, source: library|upload}` · new `library_built {image_count, tagged_pct, ms}` · new `matches_action {action: pin|exclude|boost}`. Targets unchanged from v1.

---

## Part 9 — Agent task split v2

Task Z0 runs first and alone. Every task's Done-when includes: (a) its Part's acceptance boxes, (b) screenshot suite posted, (c) conformance diff vs the named wireframe screen approved by Aaron, (d) DELETE-list grep green.

| Task | Spec | Blocked by | Must not exist after | Done when |
| --- | --- | --- | --- | --- |
| Z0 Demolition | Part 1.2 | — | everything in 1.2 | CI grep green; app boots to scope→build→studio skeleton |
| G1 Brand library index + tagging | Part 4.1 | — | — | ≥ 90% tag accuracy on 3 dev stores (manual audit of 50 images each) |
| G2 Validator v2 (products+reach+imagery+min-4) | Part 5 | G1 | — | Luna regression passes |
| T-1…T-5 Template builds (one agent each) | Part 3 | Z0, v1 A2 | old radio variants | per-template conformance diff + snapshot tests |
| S1 Studio Build tab arrival state + banner | Part 2.1–2.3 | Z0, ≥ 1 of T-* | Reveal route | Part 2 boxes 1–3, 6 |
| S2 Template overlay | Part 2.4 | T-1…T-5 | style-bar thumbnails | live-render check + switch ≤ 1 s |
| S3 Images rail + library picker | Part 4.4–4.5 | G1 | — | Part 4 boxes |
| S4 Check matches | Part 6 | G2 | Logic tab | Part 6 boxes |
| S5 Live slim + publish sheet | Part 7 | v1 D2 | 3-panel Live | publish happy path ≤ 10 s |
| F2 Event deltas + screenshot suite in CI | Parts 8, 0.1(5) | — | — | screenshots post per build; events visible |

Build order: Z0 → {G1, G2, T-*} parallel → S1 → {S2, S3, S4, S5} parallel → F2 throughout.

---

## Part 10 — Open questions for Charlie (answer inline; defaults apply if blank)

Items 1–8 from v1 remain open. New:

9. **Image classification cost at sync** (Part 4.1). Default: heuristic-first, lazy ML on gate decisions, cached.
10. **Does the runtime's screen renderer support per-template root layout components today, or is it one layout with CSS switches?** Sizes T-1…T-5. Default: assume refactor; budget it in T-1.
11. **Face detection: client of an existing service in our stack, or add one?** Default: skip `has_face` in v2.0; ratio+role heuristics only.
12. **Variant-image coverage across current installs** — pull the % of variants with images; decides how often T2's gate passes. Log from G1 day 1.
