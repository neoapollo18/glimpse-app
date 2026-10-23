// Editable shopper-facing text (Studio → Text & labels, 2026-10-16).
//
// Every fixed string the quiz widget shows has one entry here: the Studio
// panel lists them pre-filled with these defaults, and the widget looks
// each up by key with T(key, fallback). Most live in the
// chat_assistant_config.quiz_ui_text jsonb map (migration 092); entries
// with `column` already had their own column before this panel existed
// and keep it, so the storefront endpoints and the AI copilot read them
// exactly as before.
//
// The widget keeps its own English fallbacks (extension assets can't
// import), and they must equal `default` here so an untouched quiz never
// changes. Pure module: shared by the Studio client, the save validator
// and the storefront payload.

import type { TemplateId } from "./quiz-templates";

export type UiTextGroupId = "nav" | "photo" | "loading" | "results" | "bag" | "email" | "template" | "camera";

export const UI_TEXT_GROUPS: Array<{ id: UiTextGroupId; title: string; description?: string }> = [
  { id: "nav", title: "Buttons & navigation" },
  { id: "photo", title: "Photo & try-on" },
  { id: "results", title: "Results" },
  { id: "bag", title: "Add to bag & bundles" },
  { id: "email", title: "Email capture" },
  { id: "loading", title: "Loading & errors" },
  { id: "template", title: "Template text", description: "Lines only your current template shows." },
  { id: "camera", title: "Camera (desktop)", description: "The webcam window desktop shoppers see when they take a photo." },
];

/** Where a string can appear. Studio hides entries that don't apply to
 * the current layout; absent = every layout. "pool" = a classic quiz on
 * the pool (columnar) matching engine. */
export type UiTextScope = "classic" | "featured" | "grid" | "boutique" | "pool" | "template" | TemplateId;

export interface UiTextEntry {
  /** Key in quiz_ui_text, or the column name when `column` is true. */
  key: string;
  /** Lives in its own chat_assistant_config column (pre-2026-10-16). */
  column?: true;
  label: string;
  group: UiTextGroupId;
  default: string;
  /** Per-template defaults where a template ships different copy. */
  templateDefaults?: Partial<Record<TemplateId, string>>;
  /** Placeholders the widget fills, e.g. {count}. Shown as help text. */
  vars?: string[];
  /** What a placeholder means here, when the generic wording is wrong. */
  varHints?: Partial<Record<string, string>>;
  scope?: UiTextScope[];
  help?: string;
}

export const UI_TEXT_ENTRIES: UiTextEntry[] = [
  // ---- Buttons & navigation ----
  {
    key: "start",
    label: "Start button",
    group: "nav",
    default: "Start the quiz",
    templateDefaults: { t1: "Find my match", t2: "Find my match", t3: "Let’s get started", t4: "Let’s go →", t5: "Start the quiz" },
  },
  { key: "unlockDiscount", label: "Start button (email discount offered up front)", group: "nav", default: "Unlock my discount", scope: ["template"] },
  { key: "back", label: "Back button", group: "nav", default: "Back" },
  { key: "next", label: "Next button", group: "nav", default: "Continue", templateDefaults: { t4: "Next" }, help: "Shown on screens where shoppers pick more than one answer." },
  { key: "quiz_show_matches_label", column: true, label: "Last question button", group: "nav", default: "Show my matches" },
  { key: "skip", label: "Skip", group: "nav", default: "Skip", scope: ["t3"], help: "Skipping the name question." },
  { key: "selectAll", label: "Multi-select hint", group: "nav", default: "Select all that apply", scope: ["template"] },
  { key: "selectUpTo", label: "Multi-select hint (with a limit)", group: "nav", default: "Select up to {n}", vars: ["n"], scope: ["template"] },
  { key: "openToAnything", label: "“Open to anything” answer", group: "nav", default: "Open to anything", help: "Used when an answer has no label of its own." },
  { key: "pickAnyHint", label: "Hint before picking", group: "nav", default: "Pick any that fit", scope: ["boutique"] },
  { key: "anyHint", label: "Hint after “open to anything”", group: "nav", default: "Open to anything · change any answer later", scope: ["boutique"] },
  { key: "selectedOfHint", label: "Hint with a pick limit", group: "nav", default: "{n} of {max} selected · change any answer later", vars: ["n", "max"], scope: ["boutique"] },
  { key: "selectedHint", label: "Hint after picking", group: "nav", default: "{n} selected · change any answer later", vars: ["n"], scope: ["boutique"] },
  { key: "nextPhotoHint", label: "Hint on the last question", group: "nav", default: "Next: see your matches on you (optional)", scope: ["boutique"] },
  {
    key: "shapeSkipped",
    label: "Shape step skipped",
    group: "nav",
    default: "Super short has one shape, so we skipped that step.",
    scope: ["pool"],
    help: "On the color step when Super Short is the only length picked.",
  },
  { key: "stepCount", label: "Step counter", group: "nav", default: "{n} of {total}", vars: ["n", "total"], varHints: { n: "the step", total: "the number of steps" }, scope: ["classic"] },
  { key: "stepWord", label: "Word before the step counter", group: "nav", default: "Step", scope: ["boutique"] },
  { key: "bonusStep", label: "Bonus step label", group: "nav", default: "Bonus", scope: ["classic", "t1", "t4", "t5"] },
  { key: "optionalStep", label: "Optional step label", group: "nav", default: "Optional", scope: ["boutique"] },
  { key: "beforeTag", label: "Before photo tag", group: "nav", default: "Before", scope: ["classic"] },
  { key: "afterTag", label: "After photo tag", group: "nav", default: "After", scope: ["classic"] },
  { key: "triedOnTag", label: "After photo tag (boutique)", group: "nav", default: "Tried on", scope: ["boutique"] },
  { key: "yourPhotoTag", label: "Before photo tag (compact)", group: "nav", default: "Your photo", scope: ["classic"] },
  { key: "yourTryonTag", label: "After photo tag (compact)", group: "nav", default: "Your try-on", scope: ["classic"] },

  // ---- Photo & try-on ----
  { key: "quiz_gate_photo_label", column: true, label: "Add photo button", group: "photo", default: "Show my match on me" },
  { key: "quiz_gate_skip_label", column: true, label: "Skip photo link", group: "photo", default: "Just take me to my results" },
  { key: "photoLaterNote", label: "Note beside the skip link", group: "photo", default: "You can try them on from your results any time", scope: ["boutique"] },
  { key: "dropMobile", label: "Upload area (phone)", group: "photo", default: "Tap to add a quick photo", scope: ["classic"] },
  { key: "dropDesktop", label: "Upload area (desktop)", group: "photo", default: "Drag a photo here, or tap to upload", scope: ["classic"] },
  { key: "photoNoFile", label: "No photo chosen", group: "photo", default: "No file selected." },
  { key: "photoNotImage", label: "Not a photo", group: "photo", default: "That file isn’t a photo — please choose an image." },
  { key: "photoTooLarge", label: "Photo too large", group: "photo", default: "That photo is too large (over 8MB). Try a smaller photo or a screenshot of it." },
  { key: "seeOnMe", label: "See on me button", group: "photo", default: "See on me" },
  { key: "onYou", label: "“On you” badge", group: "photo", default: "On you" },
  { key: "tryonWorking", label: "Try-on in progress", group: "photo", default: "Working…" },
  { key: "tryonLimit", label: "Try-on limit reached", group: "photo", default: "Try-on limit reached" },
  { key: "tryonWait", label: "Try-on cooldown", group: "photo", default: "Ready in {s}s…", vars: ["s"] },
  { key: "tryonFailed", label: "Try-on failed", group: "photo", default: "Couldn’t load, try again" },
  { key: "shadeFromPhoto", label: "Shade source: photo", group: "photo", default: "detected from your photo" },
  { key: "shadeYourPick", label: "Shade source: picked", group: "photo", default: "your pick" },
  {
    key: "shadeReadFail",
    label: "Couldn’t read a shade",
    group: "photo",
    default: "We couldn’t read your shade from that photo — natural light helps. You can also pick the closest shade manually.",
  },

  // ---- Results ----
  { key: "quiz_best_match_pill", column: true, label: "Best match pill", group: "results", default: "Best match" },
  // Match (t1) only: the pool results' Also matched row was retired.
  { key: "quiz_also_matched_label", column: true, label: "Also matched heading", group: "results", default: "Also matched for you", scope: ["t1"] },
  { key: "quiz_view_product_label", column: true, label: "View product", group: "results", default: "View full product" },
  { key: "viewShort", label: "View product (small cards)", group: "results", default: "View", scope: ["t1", "t2", "t3"] },
  { key: "end_restart_label", column: true, label: "Try another look", group: "results", default: "Try another look" },
  { key: "yourMatches", label: "Results eyebrow", group: "results", default: "Your matches", scope: ["grid"] },
  { key: "notQuiteRight", label: "Before the retake link", group: "results", default: "Not quite right?", scope: ["grid"] },
  { key: "yourAnswers", label: "Your answers label", group: "results", default: "Your answers", scope: ["grid"] },
  { key: "editAnswers", label: "Edit answers", group: "results", default: "Edit", scope: ["grid"] },
  // Pool-matched quizzes (columnar spec on, contract 4): no exact match
  // for the answers. Only those quizzes list these in Studio.
  { key: "zeroHeadline", label: "No exact match headline", group: "results", default: "We don’t have that combination yet.", scope: ["pool"], help: "When the matching sends no headline of its own." },
  { key: "zeroLoosen", label: "No exact match, with a loosen button", group: "results", default: "Open up one answer and we’ll show you what we have.", scope: ["pool"] },
  { key: "zeroEdit", label: "No exact match, nothing to loosen", group: "results", default: "Change an answer above to see what we have.", scope: ["pool"] },
  // Pool-matched quizzes, logic v6.1: the header says how many sets match
  // every answer, and each perfect match carries the badge.
  { key: "poolHeaderAll", label: "Header: all six match everything", group: "results", default: "Six sets that match everything you picked", scope: ["pool"] },
  { key: "poolHeaderAllFew", label: "Header: all match, fewer than six", group: "results", default: "Every set here matches everything you picked", scope: ["pool"], help: "When sold-out sets leave fewer than six." },
  { key: "poolHeaderSome", label: "Header: some perfect matches", group: "results", default: "{n} perfect matches, plus our next-best picks", vars: ["n"], varHints: { n: "how many sets match every answer" }, scope: ["pool"] },
  { key: "poolHeaderSomeOne", label: "Header: one perfect match", group: "results", default: "{n} perfect match, plus our next-best picks", vars: ["n"], varHints: { n: "1" }, scope: ["pool"] },
  { key: "poolHeaderClosest", label: "Header: no perfect match", group: "results", default: "Nothing matches every pick yet, so here are the closest.", scope: ["pool"] },
  { key: "perfectMatch", label: "Perfect match badge", group: "results", default: "Perfect match", scope: ["pool"], help: "On every set that matches every answer." },
  { key: "answersRailTitle", label: "Answers panel title", group: "results", default: "Your answers · tap to edit", scope: ["featured"] },
  { key: "answersRailEdit", label: "Edit one answer", group: "results", default: "edit", scope: ["featured"] },
  { key: "saveMatches", label: "Email card title", group: "results", default: "Save your matches", scope: ["grid"] },
  { key: "savedDone", label: "Email card thank-you", group: "results", default: "Saved ✓ You’re on the list.", scope: ["grid", "template"] },
  { key: "completeTheLook", label: "Cross-sell heading", group: "results", default: "Complete the look", help: "When the cross-sell title under Sell more is blank." },
  { key: "choose", label: "Cross-sell choose button", group: "results", default: "Choose" },
  { key: "xsellAdd", label: "Cross-sell add button", group: "results", default: "+ Add" },
  { key: "topMatch", label: "Top match pill", group: "results", default: "Top match", scope: ["featured"], help: "When the Best match pill is blank." },
  { key: "matchN", label: "Other match pills", group: "results", default: "Match {n}", vars: ["n"], scope: ["featured"] },
  { key: "setsCount", label: "Quantity", group: "results", default: "{n} sets", vars: ["n"] },
  { key: "matchWord", label: "{match_word}, one match", group: "results", default: "match", help: "Fills {match_word} in your results text." },
  { key: "matchesWord", label: "{match_word}, several", group: "results", default: "matches" },
  { key: "setWord", label: "{set_word}, one", group: "results", default: "set", help: "Fills {set_word} in add to cart text." },
  { key: "setsWord", label: "{set_word}, several", group: "results", default: "sets" },

  // ---- Add to bag & bundles ----
  {
    key: "quiz_add_button_template",
    column: true,
    label: "Add to cart button",
    group: "bag",
    default: "Add {count} to bag · {total}",
    vars: ["count", "total"],
    scope: ["featured", "template"],
  },
  { key: "gridAdd", label: "Add to cart button", group: "bag", default: "Add to bag", scope: ["grid"] },
  { key: "adding", label: "While adding", group: "bag", default: "Adding…" },
  { key: "added", label: "Added", group: "bag", default: "Added to bag ✓" },
  { key: "addedShort", label: "Added (small buttons)", group: "bag", default: "Added ✓" },
  { key: "addFailed", label: "Add failed", group: "bag", default: "Couldn’t add — try again" },
  { key: "addedSome", label: "Added part of a set", group: "bag", default: "Added {n} of {total} to bag", vars: ["n", "total"], help: "When the store refuses some items of a set (sold out, subscription only)." },
  { key: "addFailedItem", label: "Item couldn’t be added", group: "bag", default: "Couldn’t add {name}.", vars: ["name"], help: "Followed by the store’s reason." },
  { key: "unavailable", label: "Sold out / unavailable", group: "bag", default: "Unavailable" },
  { key: "soldOut", label: "Sold out", group: "bag", default: "Sold out", help: "On a recommended product with nothing left in stock. Blank keeps your Sold out / unavailable text." },
  { key: "variantSwapped", label: "Sold-out option swapped", group: "bag", default: "{wanted} is sold out, so we’ll add {variant}.", vars: ["wanted", "variant"], varHints: { wanted: "the recommended option", variant: "the in-stock option added instead" }, help: "When the recommended size or shade is sold out and another is in stock." },
  { key: "viewBag", label: "View bag", group: "bag", default: "View bag" },
  { key: "bundleTitleSet", label: "Bundle title", group: "bag", default: "Get the full set" },
  { key: "bundleTitleSave", label: "Bundle title (discount)", group: "bag", default: "Bundle your matches & save" },
  { key: "bundleTitleSaveAmount", label: "Bundle title (discount amount)", group: "bag", default: "Bundle all {count} and save {amount}", vars: ["count", "amount"] },
  { key: "bundleTitleMix", label: "Bundle title (mix & match)", group: "bag", default: "Bundle & save {amount}", vars: ["amount"] },
  { key: "bundleSubSet", label: "Bundle subtitle", group: "bag", default: "Everything we matched you with, in one tap." },
  { key: "bundleSubAll", label: "Bundle subtitle (discount)", group: "bag", default: "All {count} of your matches, in one tap.", vars: ["count"] },
  { key: "bundleSubMix", label: "Bundle subtitle (mix & match)", group: "bag", default: "Pick any {n} or more of your matches.", vars: ["n"] },
  { key: "bundleAddAll", label: "Bundle button", group: "bag", default: "Add all {count} to bag", vars: ["count"] },
  { key: "bundleAddSome", label: "Bundle button (some picked)", group: "bag", default: "Add {count} to bag", vars: ["count"] },
  { key: "bundlePickOne", label: "Bundle with nothing picked", group: "bag", default: "Pick at least one" },
  { key: "bundleSelectMore", label: "Bundle needs more picks", group: "bag", default: "Select {n} more", vars: ["n"] },
  { key: "bundlePickMore", label: "Bundle discount hint", group: "bag", default: "Pick {n} more to save {amount}", vars: ["n", "amount"] },
  { key: "bundleFine", label: "Bundle small print", group: "bag", default: "Bundle savings applied at checkout", help: "When the discount note under Sell more is blank." },
  { key: "bundleAppliedAmount", label: "Bundle discount applied", group: "bag", default: "{amount} off applied. You’ll see it at checkout.", vars: ["amount"] },
  { key: "bundleApplied", label: "Bundle discount applied (no amount)", group: "bag", default: "Bundle discount applied. You’ll see it at checkout." },
  { key: "bundleRefused", label: "Bundle discount refused", group: "bag", default: "We couldn’t apply the bundle discount to this cart." },
  { key: "bundleSave", label: "Bundle saving", group: "bag", default: "Save {amount}", vars: ["amount"] },
  { key: "bundleRowHint", label: "Bundle discount hint (template)", group: "bag", default: "Bundle {n}+ to save {amount}", vars: ["n", "amount"], scope: ["template"] },
  { key: "rangeOr", label: "Pick range", group: "bag", default: "{min} or {max}", vars: ["min", "max"], varHints: { min: "the fewest", max: "the most" }, scope: ["grid"], help: "Fills {range} in the mix & match bar." },
  { key: "gridAdded", label: "Added (grid cards)", group: "bag", default: "Added", scope: ["grid"] },
  { key: "gridBundleBar", label: "Mix & match bar", group: "bag", default: "**Mix & match:** add any {range} and save {discount}", vars: ["range", "discount"], scope: ["grid"], help: "**Stars** make text bold." },
  { key: "gridSetBar", label: "Mix & match bar (no discount)", group: "bag", default: "**Mix & match:** pick any {range} and add them in one tap", vars: ["range"], scope: ["grid"], help: "Used when the bundle label doesn't name {range}. **Stars** make text bold." },
  { key: "gridSetPickMore", label: "Mix & match: pick more", group: "bag", default: "Pick {n} more", vars: ["n"], scope: ["grid"] },
  { key: "ariaSetPick", label: "Set pick (screen readers)", group: "bag", default: "Pick {name} for the set", vars: ["name"], scope: ["grid"] },
  { key: "gridAddedCount", label: "Mix & match progress", group: "bag", default: "**{n} of {min}** added", vars: ["n", "min"], scope: ["grid"] },
  { key: "gridDiscountAppliedAmount", label: "Mix & match discount applied", group: "bag", default: "{amount} off applied ✓", vars: ["amount"], scope: ["grid"] },
  { key: "gridDiscountApplied", label: "Mix & match discount applied (no amount)", group: "bag", default: "Discount applied ✓", scope: ["grid"] },
  { key: "gridDiscountRefused", label: "Mix & match discount refused", group: "bag", default: "Discount couldn’t be applied", scope: ["grid"] },
  { key: "gridDiscountApplying", label: "Mix & match discount applying", group: "bag", default: "Applying your discount…", scope: ["grid"] },
  { key: "bagUnlocked", label: "Bag bar: bundle unlocked", group: "bag", default: "Bundle unlocked", scope: ["grid"] },
  { key: "bagAddedCount", label: "Bag bar: progress", group: "bag", default: "{n} of {min} added", vars: ["n", "min"], scope: ["grid"] },
  { key: "bagAddMoreSave", label: "Bag bar: add more to save", group: "bag", default: "Add {n} more to save {amount}", vars: ["n", "amount"], scope: ["grid"] },
  { key: "bagAddMoreUnlock", label: "Bag bar: add more to unlock", group: "bag", default: "Add {n} more to unlock your bundle discount", vars: ["n"], scope: ["grid"] },
  { key: "bagAppliedAmount", label: "Bag bar: discount applied", group: "bag", default: "{amount} off applied at checkout", vars: ["amount"], scope: ["grid"] },
  { key: "bagApplied", label: "Bag bar: discount applied (no amount)", group: "bag", default: "Discount applied at checkout", scope: ["grid"] },
  { key: "bagRefused", label: "Bag bar: discount refused", group: "bag", default: "We couldn’t apply the bundle discount to this cart", scope: ["grid"] },
  { key: "bagApplying", label: "Bag bar: discount applying", group: "bag", default: "Applying your bundle discount…", scope: ["grid"] },
  { key: "bagCount", label: "Bag bar: items", group: "bag", default: "{n} in your bag", vars: ["n"], scope: ["grid"] },
  { key: "ariaBundlePick", label: "Bundle pick (screen readers)", group: "bag", default: "Include in bundle" },
  { key: "ariaBundleOffer", label: "Bundle card (screen readers)", group: "bag", default: "Bundle offer" },

  // ---- Email capture ----
  { key: "quiz_lead_button_label", column: true, label: "Submit button", group: "email", default: "Save my results" },
  { key: "quiz_lead_skip_label", column: true, label: "Skip link", group: "email", default: "Skip" },
  { key: "emailPlaceholder", label: "Email field placeholder", group: "email", default: "you@email.com" },
  { key: "phonePlaceholder", label: "Phone field placeholder", group: "email", default: "Phone number (optional)" },
  { key: "saving", label: "While saving", group: "email", default: "Saving…" },
  { key: "emailMissing", label: "No email entered", group: "email", default: "Enter your email." },
  { key: "emailOrPhoneMissing", label: "No email or phone entered", group: "email", default: "Enter your email or phone number." },
  { key: "emailInvalid", label: "Email looks wrong", group: "email", default: "That email doesn’t look right." },
  { key: "phoneInvalid", label: "Phone looks wrong", group: "email", default: "That phone number doesn’t look right." },
  {
    key: "leadFailed",
    label: "Save failed",
    group: "email",
    default: "Something went wrong — try again, or skip for now.",
    templateDefaults: {
      t1: "Something went wrong — try again, or skip.",
      t2: "Something went wrong — try again, or skip.",
      t3: "Something went wrong — try again, or skip.",
      t4: "Something went wrong — try again, or skip.",
      t5: "Something went wrong — try again, or skip.",
    },
  },
  { key: "codeTitle", label: "Discount code title", group: "email", default: "Here’s your code", scope: ["template"] },
  { key: "copy", label: "Copy code button", group: "email", default: "Copy" },
  { key: "copied", label: "Code copied", group: "email", default: "Copied" },
  { key: "leadContinue", label: "Continue after the code", group: "email", default: "Continue →" },
  { key: "leadReadyTitle", label: "Email title (discount offered up front)", group: "email", default: "Your match is ready", scope: ["template"] },
  { key: "revealDiscount", label: "Submit button (discount offered up front)", group: "email", default: "Reveal my discount →", scope: ["template"] },
  { key: "appliedAtCheckout", label: "Code applied note", group: "email", default: "Applied at checkout", scope: ["template"] },
  { key: "mysteryWord", label: "Discount badge: first word", group: "email", default: "Mystery", scope: ["template"] },
  { key: "offWord", label: "Discount badge: last word", group: "email", default: "off", scope: ["template"] },
  { key: "ariaEmail", label: "Email field (screen readers)", group: "email", default: "Email address" },
  { key: "ariaPhone", label: "Phone field (screen readers)", group: "email", default: "Phone number" },

  // ---- Loading & errors ----
  { key: "findingMatch", label: "Finding matches", group: "loading", default: "Finding your match…" },
  { key: "matchingYou", label: "Matching after a photo", group: "loading", default: "Matching you up…" },
  { key: "readingShade", label: "Reading a shade from a photo", group: "loading", default: "Reading your shade…" },
  { key: "updatingMatches", label: "Updating matches", group: "loading", default: "Updating your matches…" },
  { key: "loadingResults", label: "Opening a results link", group: "loading", default: "Loading your matches…", scope: ["pool"] },
  { key: "pickingMatches", label: "Loading screen live line", group: "loading", default: "Picking your best matches", scope: ["boutique"] },
  { key: "loadingKicker", label: "Loading screen eyebrow", group: "loading", default: "One moment", scope: ["boutique"] },
  { key: "loadingTitle", label: "Loading screen title", group: "loading", default: "Finding your matches", scope: ["boutique"] },
  { key: "loadingNote", label: "Loading screen note", group: "loading", default: "Usually takes a few seconds", scope: ["boutique"] },
  { key: "buildingRoutine", label: "Loading title", group: "loading", default: "Building your routine…", scope: ["t3"] },
  { key: "errorFinding", label: "Couldn’t load matches", group: "loading", default: "Something went wrong finding your match." },
  { key: "errorUpdating", label: "Couldn’t update matches", group: "loading", default: "Something went wrong updating your matches." },
  { key: "noMatch", label: "No matches found", group: "loading", default: "We couldn’t find a match this time — try adjusting your answers." },
  { key: "tryAgain", label: "Try again button", group: "loading", default: "Try again" },
  { key: "startOver", label: "Start over button", group: "loading", default: "Start over" },

  // ---- Template text ----
  { key: "quizPreview", label: "Intro preview label", group: "template", default: "Quiz preview", scope: ["template"] },
  { key: "questionOf", label: "Question counter", group: "template", default: "Question {n} of {total}", vars: ["n", "total"], varHints: { n: "the question", total: "the number of questions" }, scope: ["template"] },
  { key: "founderHi", label: "Founder greeting", group: "template", default: "Hi, I’m {name}.", vars: ["name"], scope: ["template"] },

  { key: "reviewsCount", label: "Review count", group: "template", default: "{n} reviews", vars: ["n"], scope: ["template"] },
  { key: "tip", label: "Tip label", group: "template", default: "Tip", scope: ["t1"] },
  { key: "t1Headline", label: "Results headline", group: "template", default: "Here's what we think will look amazing", scope: ["t1"], help: "When the results headline is blank." },
  { key: "yourMatchSmall", label: "Under the first product name", group: "template", default: "your match", scope: ["t2"] },
  { key: "addRoutine", label: "Add the routine button", group: "template", default: "Add routine to cart", scope: ["t3"] },
  { key: "ariaName", label: "Name field (screen readers)", group: "template", default: "Your name", scope: ["t3"] },
  { key: "yourType", label: "Type reveal kicker", group: "template", default: "Your type", scope: ["t4"] },
  { key: "yourKitNamed", label: "Kit title", group: "template", default: "Your {name} kit", vars: ["name"], scope: ["t4"] },
  { key: "yourKit", label: "Kit title (no type name)", group: "template", default: "Your kit", scope: ["t4"] },
  { key: "kitAddAll", label: "Kit add-all button", group: "template", default: "Add all {count} — {total}", vars: ["count", "total"], scope: ["t4"] },
  { key: "oneLastThing", label: "Bonus step label", group: "template", default: "One last thing", scope: ["t2"] },
  { key: "almostThere", label: "Bonus step label", group: "template", default: "Almost there", scope: ["t3"] },
  { key: "aboutMatch", label: "About your match", group: "template", default: "About your match", scope: ["t1"] },
  { key: "aboutMatchSub", label: "About your match subtitle", group: "template", default: "Selected for you based on your answers:", scope: ["t1"] },
  { key: "yourShade", label: "Your shade", group: "template", default: "Your shade", scope: ["t1"] },
  { key: "shadeMissing", label: "No shade yet", group: "template", default: "Add a photo or pick your shade below", scope: ["t1"] },
  { key: "whyWorks", label: "Why this works", group: "template", default: "Why this works", scope: ["t1"] },
  { key: "selectOption", label: "Variant picker title", group: "template", default: "Select {option}", vars: ["option"], scope: ["t1"] },
  { key: "alsoWorthLook", label: "Other matches heading", group: "template", default: "Also worth a look", scope: ["t1"], help: "When the Also matched heading is blank." },
  { key: "basedOnAnswers", label: "Answers recap label", group: "template", default: "Based on your answers", scope: ["t2"] },
  { key: "yourMatchHeadline", label: "Results headline", group: "template", default: "Your match: {name}", vars: ["name"], scope: ["t2"], help: "When the results headline is blank." },
  { key: "bestForYou", label: "Best match label", group: "template", default: "Best for you", scope: ["t2"] },
  { key: "ourPick", label: "AI pick label", group: "template", default: "Our pick", scope: ["t2"] },
  { key: "yourMatchCol", label: "Comparison column", group: "template", default: "Your match", scope: ["t2"] },
  { key: "rowPrice", label: "Comparison row: price", group: "template", default: "Price", scope: ["t2"] },
  { key: "rowOption", label: "Comparison row: option", group: "template", default: "Option", scope: ["t2"] },
  { key: "rowSets", label: "Comparison row: sets", group: "template", default: "Sets", scope: ["t2"] },
  { key: "rowWhy", label: "Comparison row: why", group: "template", default: "Why", scope: ["t2"] },
  { key: "nameQuestion", label: "Name question", group: "template", default: "To start, who is the routine for?", scope: ["t3"] },
  { key: "namePlaceholder", label: "Name field placeholder", group: "template", default: "Enter your name here", scope: ["t3"] },
  { key: "niceToMeet", label: "Greeting after the name", group: "template", default: "Nice to meet you, {name}.", vars: ["name"], scope: ["t3"] },
  { key: "routineHeadline", label: "Results headline", group: "template", default: "Your personalized routine", scope: ["t3"], help: "When the results headline is blank." },
  { key: "builtFor", label: "Built for", group: "template", default: "Built for {name}", vars: ["name"], scope: ["t3"] },
  { key: "builtForAnon", label: "Built for (no name)", group: "template", default: "Built for", scope: ["t3"] },
  { key: "regimenWhy", label: "Why this regimen", group: "template", default: "Why this regimen is right for you", scope: ["t3"] },
  { key: "toldUs", label: "Answer recap", group: "template", default: "You told us {answers}.", vars: ["answers"], scope: ["t3"] },
  { key: "toldUsAnon", label: "Answer recap (no answers)", group: "template", default: "You told us what you’re working with.", scope: ["t3"] },
  { key: "regimenTitle", label: "Regimen title", group: "template", default: "Your regimen", scope: ["t3"] },
  { key: "morning", label: "Morning", group: "template", default: "Morning", scope: ["t3"] },
  { key: "night", label: "Night", group: "template", default: "Night", scope: ["t3"] },
  { key: "stepLabel", label: "Step label", group: "template", default: "Step {n}", vars: ["n"], scope: ["t3"] },
  { key: "todaysTotal", label: "Total label", group: "template", default: "Today’s total:", scope: ["t3"] },
  { key: "basedOn", label: "Answers recap", group: "template", default: "Based on: {answers}", vars: ["answers"], scope: ["t5"] },

  // ---- Camera (desktop webcam window) ----
  { key: "cameraTitle", label: "Window title", group: "camera", default: "Camera" },
  { key: "cameraStarting", label: "Starting", group: "camera", default: "Starting camera..." },
  { key: "cameraCapture", label: "Capture button", group: "camera", default: "Capture" },
  { key: "cameraUpload", label: "Upload instead", group: "camera", default: "Upload file" },
  { key: "cameraReview", label: "After capture", group: "camera", default: "Looking good?" },
  { key: "cameraUse", label: "Use photo button", group: "camera", default: "Use Photo" },
  { key: "cameraRetake", label: "Retake button", group: "camera", default: "Retake" },
  { key: "cameraAllow", label: "Permission prompt", group: "camera", default: "Allow camera access when prompted" },
  { key: "cameraStill", label: "Camera not ready", group: "camera", default: "Camera is still starting... try again in a moment" },
  { key: "cameraDenied", label: "Camera blocked", group: "camera", default: "Camera access was denied. Please allow camera access in your browser settings." },
  { key: "cameraMissing", label: "No camera", group: "camera", default: "No camera found on this device." },
  { key: "cameraFailed", label: "Camera failed", group: "camera", default: "Could not start camera. Please try uploading a file instead." },
];

export const UI_TEXT_MAX_LEN = 200;

const ENTRY_BY_KEY = new Map(UI_TEXT_ENTRIES.map((e) => [e.key, e]));

/** Keys stored in quiz_ui_text (not the column-backed entries). */
export const UI_TEXT_KEYS: ReadonlySet<string> = new Set(UI_TEXT_ENTRIES.filter((e) => !e.column).map((e) => e.key));

export function uiTextEntry(key: string): UiTextEntry | undefined {
  return ENTRY_BY_KEY.get(key);
}

/** The default a shopper sees for this entry under the given template. */
export function uiTextDefault(entry: UiTextEntry, template: string | null | undefined): string {
  const t = template as TemplateId | null | undefined;
  return (t && entry.templateDefaults?.[t]) || entry.default;
}

/** Studio filter: does this entry show up in the current layout? */
export function uiTextApplies(
  entry: UiTextEntry,
  layout: { template: string | null; grid: boolean; boutique: boolean; pool?: boolean },
): boolean {
  if (!entry.scope) return true;
  return entry.scope.some((s) => {
    if (s === "template") return Boolean(layout.template);
    if (s === "classic") return !layout.template;
    if (s === "featured") return !layout.template && !layout.grid;
    if (s === "grid") return !layout.template && layout.grid;
    if (s === "boutique") return !layout.template && layout.boutique;
    if (s === "pool") return !layout.template && Boolean(layout.pool);
    return layout.template === s;
  });
}

/**
 * The stored map, cleaned: known keys only, trimmed non-empty strings,
 * capped length. Used for the public payload and as the read side of
 * the mapper, so a hand-edited or stale row can never put an unknown key
 * or a non-string in front of shoppers.
 */
export function sanitizeUiText(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!UI_TEXT_KEYS.has(k) || typeof v !== "string") continue;
    const s = v.trim().slice(0, UI_TEXT_MAX_LEN);
    if (s) out[k] = s;
  }
  return out;
}

/**
 * Apply a Studio/copilot patch ({key: text | null}) to the stored map.
 * null, blank, or text equal to the entry's default clears the override,
 * so "pre-filled with our default" never pins a copy of the default.
 * Returns an error for unknown keys or non-string values.
 */
export function applyUiTextPatch(
  current: unknown,
  patch: Record<string, unknown>,
  template: string | null | undefined,
): { ok: true; value: Record<string, string> | null } | { ok: false; error: string } {
  const next = sanitizeUiText(current);
  for (const [k, v] of Object.entries(patch)) {
    const entry = ENTRY_BY_KEY.get(k);
    if (!entry || entry.column) return { ok: false, error: `Unknown text key: ${k}` };
    if (v != null && typeof v !== "string") return { ok: false, error: `${k} must be text` };
    const s = typeof v === "string" ? v.trim().slice(0, UI_TEXT_MAX_LEN) : "";
    if (!s || s === uiTextDefault(entry, template)) delete next[k];
    else next[k] = s;
  }
  return { ok: true, value: Object.keys(next).length > 0 ? next : null };
}

// ---------------------------------------------------------------------
// "Why this fits" lines (migration 092): one merchant line per product,
// keyed by products.id, shown under that product on result cards.
// Default blank = nothing shown (no more auto-generated answer echo).
// ---------------------------------------------------------------------

export const PRODUCT_WHY_MAX_LEN = 160;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeProductWhy(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!UUID_RE.test(k) || typeof v !== "string") continue;
    const s = v.replace(/\s+/g, " ").trim().slice(0, PRODUCT_WHY_MAX_LEN);
    if (s) out[k] = s;
  }
  return out;
}

/** Set or clear one product's line. Blank/null clears it. */
export function applyProductWhyPatch(
  current: unknown,
  productId: unknown,
  text: unknown,
): { ok: true; value: Record<string, string> | null } | { ok: false; error: string } {
  if (typeof productId !== "string" || !UUID_RE.test(productId)) return { ok: false, error: "productId must be a product id" };
  if (text != null && typeof text !== "string") return { ok: false, error: "text must be text" };
  const next = sanitizeProductWhy(current);
  const s = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, PRODUCT_WHY_MAX_LEN) : "";
  if (s) next[productId] = s;
  else delete next[productId];
  return { ok: true, value: Object.keys(next).length > 0 ? next : null };
}

// ---------------------------------------------------------------------
// Payload pieces shared by the storefront quiz-config endpoint and the
// Studio preview, so the two can't drift.
// ---------------------------------------------------------------------

type TextConfigFields = {
  quiz_ui_text?: unknown;
  quiz_body_weight?: string | null;
  quiz_body_color?: string | null;
  quiz_results_primary_cta?: string | null;
  quiz_results_secondary_link?: boolean | null;
};

/** Top-level fields: text overrides and body typography. All null = today. */
export function quizTextPayload(config: TextConfigFields) {
  const uiText = sanitizeUiText(config.quiz_ui_text);
  return {
    uiText: Object.keys(uiText).length > 0 ? uiText : null,
    bodyWeight: ["400", "500", "600"].includes(String(config.quiz_body_weight)) ? String(config.quiz_body_weight) : null,
    bodyColor:
      typeof config.quiz_body_color === "string" && /^#[0-9a-fA-F]{6}$/.test(config.quiz_body_color)
        ? config.quiz_body_color
        : null,
  };
}

/** results.* fields: which action is the card button, and the link. */
export function resultsCtaPayload(config: TextConfigFields) {
  return {
    primaryCta: config.quiz_results_primary_cta === "view" ? ("view" as const) : ("add" as const),
    secondaryLink: config.quiz_results_secondary_link !== false,
  };
}
