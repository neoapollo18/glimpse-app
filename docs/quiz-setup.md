# Gleame "Find My Fit" Quiz — End-to-End Setup

Everything needed to take a shop from zero to a working quiz page, in order.
Written for the Gleame team; sections 3–5 are the parts a merchant touches.

---

## 1. Platform prerequisites (one-time per environment)

Already done for production — needed only for a fresh environment.

1. **Database migrations**, run in the Supabase SQL editor, in order:
   - `supabase-migrations/043_quiz_experience.sql` — quiz config columns + `assistant_mode`
   - `supabase-migrations/044_quiz_rules_rpc.sql` — save RPC with quiz fields
   - `supabase-migrations/045_quiz_question_features.sql` — multi-select / screen groups / conditional + visual options + RPC update

   ⚠ **Migrations always run BEFORE deploying app code that references their columns.**
   Deploying first makes `getRecommendationFlow` / rule matching silently degrade on live shops.

2. **Backend deploy** — push to `main`; Render auto-deploys the Remix app
   (`glimpse-app-charles.onrender.com`). Note the free tier spins down when
   idle: the first request after hours can 502/timeout while it wakes
   (~30–60s). For anything customer-facing, upgrade the service or add an
   uptime-monitor ping.

3. **Theme extension deploy** — `npm run deploy` (Shopify CLI). Required
   whenever anything under `extensions/glimpse-widget/` changes; git push
   alone never ships widget JS/CSS/Liquid. After deploying, hard-refresh the
   storefront (theme CDN caches assets briefly).

---

## 2. Shop prerequisites

- Shop has the Gleame app installed, exists in the `shops` table, and passes
  the billing gate (active Mantle subscription, grace period, or
  grandfathered). Every storefront endpoint checks this — an inactive shop
  renders nothing with no visible error.
- **Products configured in Gleame** (`/app/products`): the quiz can only
  recommend products/variants that exist in Gleame's catalog with
  transformation prompts (needed for try-on) — plus reference images and
  taglines where wanted. Product handles/prices/images come live from the
  storefront, but the candidate pool is Gleame's.

---

## 3. Assistant configuration (Gleame admin)

### 3a. Surface & basics — `Assistant`
1. Master toggle **ON** (this gates BOTH chat and quiz — off kills everything).
2. **Surface**: `Quiz page` (bubble hides) or `Both`. Default `Chat` = quiz
   section renders empty.
3. Assistant name feeds `{assistant_name}` tokens in all copy.

### 3b. Quiz page copy & style — `Assistant → Quiz page`
All optional — sensible defaults exist. Groups:
- **Landing**: eyebrow / headline / subtext, trust items (≤4), before+after
  images with caption, alternate-audience link ("Shopping for accessories? →").
- **Try-on gate**: headline, helper, photo CTA label, skip label
  ("Just take me to my results"), privacy note. The privacy note's
  "never stored" promise is real: photos live in memory only.
- **Results**: headlines (photo / no-photo variants), Best-match pill,
  Also-matched label, add-button template (`{count}`, `{set_word}`, `{total}`
  tokens), view-product / retake labels. The restart link reuses the chat's
  "Try another look" field.
- **Shade gate**: headline, body, photo CTA, manual-picker CTA.
- **Style**: accent color (blank = assistant accent), button radius, and
  heading/body font overrides — leave fonts blank to **inherit the host
  theme's typography** (the point of the design).

### 3c. Questions & rules — `Assistant → Recommendation logic`

**Axes** (the traits): one per trait, `lower_snake_case` keys/values.
- Source `Question` = asked on the quiz; source `Photo` = detected from the
  shopper's photo (e.g. shade). Photo-axis values can carry a **swatch color**
  for the manual "I know my shade" picker.
- ⚠ Adding/removing an axis invalidates existing rules (cells are keyed on
  the full axis set) — finish the axis list before authoring the matrix.

**Questions** (one per question axis), in flow order:
- Prompt + optional **helper text** (the sub-line).
- **Multi-select** — shopper picks several; quiz shows Continue instead of
  tap-to-advance.
- **Screen group** — consecutive questions sharing a group key render on ONE
  screen (e.g. style + colors). Must be consecutive; the editor validates.
- **Options**: label (emoji fine) → axis value, plus optionally:
  - **Image URL** — options with images render as a visual grid (on-hand shots)
  - **Reason shown on result card** — the checkmark bullet when picked
  - **Show only if** — render only after a matching EARLIER answer
    (editor only offers earlier question axes; photo axes are excluded)
  - **Open to anything** — exclusive pick meaning "any value on this axis";
    sent as a marker that matches every rule value
  - Bot response — chat-surface personality line (quiz ignores it)

**Matrix (rules)**: one row per criteria combination, up to 3 ranked targets
per cell, each with **Qty** (units added to cart — "2 sets"). Rank 1 = Best
match. Multi-select shoppers reach every cell their selections cover; best
rank wins. Unmatched combinations fall back to AI-shuffled picks (no reasons
shown on those). Save is atomic — a validation error changes nothing.

### 3d. Shade detection (optional)
Add a **Photo**-source axis (e.g. `shade`) with one value per shade + swatch
colors. Rules then include shade in each cell. Flow effect: no photo →
provisional product-level match + shade gate ("Match my shade for me" /
"I know my shade"); photo → Gemini classifies the shade before matching.
No photo axis = no shade gate; the photo is purely for try-on.

---

## 4. Theme setup (storefront)

1. **Create the page**: Online Store → Pages → Add page — title "Find My Fit",
   empty body, visible.
2. **Template**: in the theme editor, top-center dropdown → Pages → the new
   page → **Create template** (e.g. `find-my-fit`) so other pages are
   unaffected. Hide the theme's page-title block if it renders one.
3. **Add the section**: left sidebar → Add section → **Apps** tab →
   **Gleame Quiz**. Section settings are layout-only (max width, padding,
   background); everything else lives in the app. If "Gleame Quiz" is
   missing, the extension deploy hasn't run.
4. **Navigation**: Online Store → Navigation → main menu → Add menu item →
   "Find My Fit" → link to the page.

The quiz renders only when: assistant enabled + surface includes quiz + at
least one configured question. In the theme editor it shows a setup hint.

---

## 5. Verify (10 minutes, on the live page — not the editor preview)

1. **No-photo run**: answer everything → "Just take me to my results" →
   results appear near-instantly; add-to-bag puts the right variant + qty in
   the cart; header cart badge updates.
2. **Photo run**: photo at the gate → results immediate → hero try-on
   blur-up reveals → "See it on you" on secondary cards.
3. **Shade gate** (if photo axis): skip photo → provisional card has NO
   add-to-bag; pick a swatch → full results crossfade in; "Retake photo"
   actually re-detects.
4. **Navigation**: browser Back/Forward mid-quiz keeps selections and can't
   skip unanswered questions; refresh resumes; "Try another look" restarts.
5. **New question features**: multi-select Continue enables at ≥1 pick;
   "Open to anything" is exclusive; conditional options appear/disappear
   live; grouped screen commits both parts.
6. **Typography**: headings/body visibly match the host theme, desktop + mobile
   (sticky add-to-bag bar on mobile).
7. **Analytics**: `analytics_events` shows the funnel —
   `quiz_view → quiz_start → quiz_question_answered… → quiz_gate_view →
   quiz_results_shown → quiz_add_to_cart` (`widget_type='quiz'`).
8. **Attribution**: place a test order from a quiz add-to-cart; confirm the
   conversion row lands via the orders webhook.

---

## 6. Gotchas

- **60s config cache**: admin copy changes take up to a minute to appear on
  the storefront.
- **State is per-tab** (sessionStorage): a new tab = fresh quiz; photos never
  survive refresh by design ("Retake photo" is the recovery).
- **Chat + quiz ('Both' mode)**: chat honors conditional options and "open to
  anything", but multi-select degrades to single-tap and screen
  groups/images don't apply — plain question sets work best on chat.
- **Ad-blockers** make Shopify's own `collect`/`metrics`/`produce_batch`
  requests fail red in DevTools — noise, not Gleame.
- **Distinct axis values per option**: options mapping to the same value are
  indistinguishable to the matrix; give each real choice its own value.
