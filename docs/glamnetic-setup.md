# Glamnetic "Find My Nail Match" — Full Setup Runbook

Everything to take the existing Glamnetic shop from app install to the live
quiz matching the approved wireframes. Copy strings are the wireframe copy —
paste them as-is.

---

## 0. Platform status check (Gleame side, before touching the shop)

- Migrations 043–046: **applied** ✓
- Backend: auto-deploys from `main` (engine hardening `212779f` included)
- Theme extension: run `npm run deploy` if the last widget change (honest
  fallback pills) hasn't shipped yet
- Render tier: upgrade or keep an uptime ping — a cold start during a
  Glamnetic demo will look like an outage

## 1. Decide the flow size FIRST (this gates everything)

With today's exact-cell matching, **every question you add is a required
rule dimension** — rules must cover all question axes, and the editor
authors the full cartesian:

| Flow | Cells to author |
|---|---|
| **A. Launch flow (recommended now)**: occasion × length × application | 5 × 4 × 3 = **60 cells** (authoring ~2–3 h) |
| B. Full wireframe flow: + shapes (7) + style (4) + colors (7) | **~12,000 cells — not feasible** until scored/partial-rule matching ships |

**Recommendation:** launch with A (it's the wireframes' Q1–Q3, which carry
most of the signal), keep Q4/Q5 out of the flow until scored matching is
built, then add them without re-authoring.

Also: **skip a hand-tone photo axis at launch.** It would multiply cells ×7
and force every photo-less run through the shade gate. The photo stays pure
try-on ("see them on your hands"), which is the wireframes' primary promise
anyway.

## 2. App install & access

1. Install Gleame on the Glamnetic shop (dev-store install link / Partners).
2. Billing gate: the shop must pass `shopHasValidAccess` — active Mantle
   subscription, trial, or grandfather flag. For the pilot, set them up on a
   plan (or grandfather) BEFORE testing storefront endpoints: an inactive
   shop renders an empty quiz with no error.
3. If the storefront runs on a custom domain (glamnetic.com), add it to the
   shop row's `alternate_domains` so shop verification passes from that
   domain (same mechanism the demo shop uses).

## 3. Products (Gleame → Products)

The quiz recommends only from Gleame's configured catalog.

1. Configure every press-on set that should be recommendable (60-cell flow
   needs up to 3 targets per cell — realistically 20–40 sets).
2. Per product/variant:
   - **Transformation prompt** — hands, not faces. Template that works:
     *"Apply [SET NAME] press-on nails — [length] [shape], [color/finish
     description] — to the person's natural nails. Keep the hand, skin
     tone, and lighting exactly as photographed. Realistic nail size and
     cuticle fit."*
   - **Reference images**: 1–2 clean product shots of the set (flat lay or
     on-hand) — these anchor the design faithfully.
   - **Tagline**: one persuasion line — shows on match cards 2/3
     ("Glossy black, pure dark & moody").
3. Spot-check 2–3 sets through the try-on with a real hand photo BEFORE
   authoring 60 cells — if the prompt template needs tuning, tune it once.

## 4. Assistant basics (Gleame → Assistant)

- Master toggle **ON**
- **Surface: Quiz page** (bubble hidden)
- Assistant name: whatever persona Glamnetic wants in `{assistant_name}`
  tokens (not otherwise visible on the quiz)

## 5. Quiz page copy & style (Gleame → Assistant → Quiz page)

**Style**
- Accent color: Glamnetic pink — sample the SHOP NOW button on their
  homepage (≈ `#e75480` family; confirm against their brand kit). Every
  tint, pip, chip, and pill derives from this one value.
- Fonts: leave BOTH overrides empty — the quiz inherits Glamnetic's theme
  typography at runtime.
- Button radius: leave empty (pill defaults match the wireframes).

**Landing**
| Field | Value |
|---|---|
| Eyebrow | `Find my nail match` |
| Headline | `Your perfect mani, matched in **60 seconds**` |
| Subtext | `Answer a few quick taps and we'll match you to the exact sets made for your length, shape, and style — then show them on your own hands.` |
| Trust items | `5 quick taps` · `Photo optional` · `Every set includes 15 sizes` |
| Before/After images | Their on-hand photo + an AI try-on render (labels configurable as Before/After tags) |
| Visual caption | `Jess matched with Mystic Topaz · Medium Oval — and saw it on her hand before she bought.` |

**Try-on gate**
| Field | Value |
|---|---|
| Headline | `Want to see them on **your** hands?` |
| Helper | `Snap a quick photo — no manicure required, any lighting works. We'll show your top matches on you, not on a model.` |
| Photo label | `Upload photo` |
| Skip label | `Skip — show my matches now` |
| Privacy note | `Used only for your try-on · never stored · never shared` |

**Results**
| Field | Value |
|---|---|
| Headline (photo) | `Your matches, {first_name} 💅 — on your hands` |
| Headline (no photo) | `Your matches, {first_name} 💅` |
| Subtext | `{count} sets made for your answers — every one includes 15 sizes, so fit is covered.` |
| Show matches label | `Show my matches` |
| Best match pill | `Top match` |
| Add button template | `Add to bag · {total}` |
| Upsell title | `See these on your hands ✨` |
| Upsell body | `One quick photo — no manicure required. We'll re-render your matches on you.` |
| Upsell CTA | `Try them on me` |

## 6. Questions & rules (Gleame → Assistant → Recommendation logic)

### Axes (create all three BEFORE authoring any rules — changing axes later
### drops rules, with a confirmation warning)

| Axis key | Label | Values (key → label) |
|---|---|---|
| `occasion` | Occasion | `everyday` → Everyday life, `work` → Work, `event` → A special event, `vacation` → Vacation, `newlook` → Just want a new look |
| `length` | Length | `super_short` → Super short, `short` → Short, `medium` → Medium, `long` → Long |
| `application` | Application | `press_go` → Press & go, `glue_on` → Glue-on, `tabs` → Adhesive tabs |

### Questions

**Q1 — occasion** (single-select, renders inline on the landing)
- Prompt: `What are these nails for?`
- Helper: `We'll match the vibe to the moment.`
- Options: Everyday life / Work / A special event 🥂 / Vacation ☀️ / Just
  want a new look — short labels render as pill chips automatically.

**Q2 — length** (**Multi-select ✓**)
- Prompt: `How long do you like your nails?`
- Helper: `Pick all the lengths you'd wear. On your hands a lot — typing, gym, kids? Shorter lengths hold up best.`
- Per option, Card display: **Image URL** = Glamnetic on-hand photo per
  length (this flips the question to the visual grid) + **Sublabel**:
  Super short → `Barely-there, ultra practical`, Short → `Everyday sweet
  spot`, Medium → `Elegant, still functional`, Long → `Full statement`.

**Q3 — application** (single-select, rich cards)
- Prompt: `How should they go on — and how long should they stay?`
- Helper: `All three are damage-free and reusable. This just decides your wear window.`
- Options with Card display:
  - Press & go — **Tag** `NO GLUE`, Sublabel `Peel, press, done in seconds. Built-in adhesive — zero mess.`, Meter `UP TO 5 DAYS` / 35%. **Show only if → length = super_short** (Quick Press ships in super-short only — confirm with Glamnetic; drop the condition if untrue).
  - Glue-on classic — Sublabel `The full salon mani. 10-minute application, longest wear.`, Meter `UP TO 2 WEEKS` / 100%
  - Adhesive tabs — Tag `NO GLUE`, Sublabel `Gentlest on natural nails. Perfect for one weekend.`, Meter `UP TO 3 DAYS` / 20%

### Rules (the 60-cell matrix)

- Per cell: rank 1 = the hero set, ranks 2–3 = alternates. **Qty = 1**
  (sets are single units; sizes are inside the box).
- Authoring order that keeps it sane: fix an occasion, sweep length ×
  application (12 cells), repeat ×5. Many cells legitimately share targets —
  that's fine (multi-select dedupes by best rank).
- Every option's **Reason** field: one bullet in the shopper's language —
  `Statement shimmer for your event`, `Short — holds up to typing`,
  `2-week wear for event + after`. These become the checkmarks on the top
  match card.
- Cells you don't author fall back to AI-shuffle across the CONFIGURED
  catalog — with only nail sets configured (step 3), even fallback shows
  nails, and the widget now labels fallback picks neutrally (no Top match
  pill). Author all 60 anyway for the pilot.

## 7. Theme setup (Glamnetic's Shopify admin)

1. Online Store → Pages → Add page: **Find My Nail Match** (empty body,
   visible)
2. Theme editor → page dropdown → the page → **Create template**
   `find-my-nail-match` → hide the page-title block
3. Add section → Apps → **Gleame Quiz** → Save (section settings: bump
   content max width to ~1200 for the 3-card results grid if their theme
   is wide)
4. Online Store → Navigation → main menu → add **FIND MY NAIL MATCH ✨** →
   link to the page

## 8. QA before showing Glamnetic (on the live page)

1. Q1 chips → Q2 visual multi-select (Continue) → Q3 rich cards with
   meters; verify Press & go only appears when Super short was picked
2. Skip path: matches render instantly, all three cards carry copy
   (reasons on top match, taglines on 2/3), prices correct, add-to-bag
   lands the right variant, cart badge ticks
3. Photo path: drag-drop AND webcam (desktop), top match re-renders
   "on you", "See on me ✨" works on cards 2/3
4. Answers rail: edit each answer → returns straight to updated results
5. Logged-in test customer → headline reads "Your matches, ⟨name⟩ 💅";
   logged out → clean headline, no dangling comma
6. Author-gap check: pick a combo you did NOT author → cards show neutral
   "Match 1/2/3" pills (no Top match claim) and only nail products
7. Mobile: pips fit, sticky add-to-bag doesn't cover the restart link
8. Funnel rows land in `analytics_events`; place one test order and confirm
   conversion attribution

## 9. Parked until scored matching ships (needs the go-ahead)

- Q4 shapes (visual grid + Open to anything) and Q5 style+colors (grouped
  screen, vibe cards + color-dot chips) — the full wireframe flow
- Hand-tone photo axis (nude-shade tuning + gate tone rail)
- Per-cell authored reason bullets on match cards 2/3
