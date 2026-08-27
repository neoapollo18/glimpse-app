// Gleame Quiz — "Find My Fit" full-page experience v1.0
//
// Step-based quiz rendered into a theme section block:
//   intro (question 1 inline) → question steps → try-on gate → results
//
// Design goals:
// - Emulate the host site: headings/body inherit the theme's fonts
//   (Dawn CSS vars → computed styles → fallback), accent + radius come
//   from the merchant's Gleame config.
// - Results render INSTANTLY from a criteria-only recommendation call;
//   try-on images stream in per card (hero first, others on demand).
// - Photos live in module memory only — never persisted anywhere.
//
// Several small utilities are mirrored from gleame-chat.js (no build step
// exists for extension assets, so no imports): fetchProductJson,
// priceCentsForRec, formatMoney, addToBag, escapeHtml, trackEvent.

(function() {
  'use strict';

  var SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  // v2: screen-based steps + multi-select answers — v1 states don't restore.
  var STORAGE_KEY = 'gleame-quiz-state-v2';
  var TRYON_SESSION_CAP = 10;

  var root = document.getElementById('gleame-quiz-root');
  if (!root) return;

  // ---- Admin preview mode ----
  // When the admin Quiz Builder embeds this file with an injected
  // window.GLEAME_QUIZ_PREVIEW = { config, flow, sampleRecommend }, the quiz
  // renders that DRAFT config and stubs every network side effect (analytics,
  // cart, try-on, persistence). Absent the global, nothing changes.
  var PREVIEW = window.GLEAME_QUIZ_PREVIEW || null;

  var shopDomain = root.getAttribute('data-shop-domain') || '';
  if (!shopDomain) {
    if (window.Shopify && window.Shopify.shop) shopDomain = window.Shopify.shop;
    else shopDomain = window.location.hostname;
  }

  // ---- Module state ----
  var config = null;   // quiz-config payload
  var flow = null;     // recommendation-config payload
  var stageEl = null;

  // Screens: array of arrays of question indexes. Consecutive questions
  // sharing a non-empty screenGroup render together on one screen (e.g.
  // "style" part A + "colors" part B); everything else is one question per
  // screen. Built once from flow.questions at boot.
  var screens = [];

  // Persisted (sessionStorage) — everything EXCEPT images.
  var state = {
    screen: 'intro',        // 'intro' | 'question' | 'gate' | 'results'
    screenIndex: 0,         // current screen when screen === 'question'
    criteria: {},           // axisKey -> axisValue | [axisValue, ...] (arrays = multi-select)
    answers: [],            // parallel to flow.questions: {axisKey, values[], labels[]} | undefined
    hasPhoto: false,        // photo was provided this session (File itself is NOT persisted)
    detectedShade: null,    // {axisKey, value, label, source: 'photo'|'manual'}
    matches: null,          // quiz-recommend matches (no images — safe to persist)
    matrixApplied: false,
    partial: false,
    quizStarted: false,     // quiz_start fired; persisted so a mid-quiz refresh doesn't re-fire it
  };

  // Memory only — the "never stored" promise.
  var photoFile = null;
  var tryonCache = {};     // matchKey -> base64
  var tryonPending = {};
  var tryonCount = 0;

  // ---- Small utilities (mirrored from gleame-chat.js) ----

  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /Mobi/.test(navigator.userAgent));
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Logged-in customer's first name (Liquid-injected). Empty for guests.
  var customerFirstName = (root.getAttribute('data-customer-first-name') || '').trim();

  // {first_name} token: "Your matches, {first_name} X" -> "Your matches, Jess X"
  // for logged-in shoppers; for guests the token AND its leading comma/space
  // are removed so the copy still reads naturally.
  function renderName(t) {
    if (!t) return '';
    if (t.indexOf('{first_name}') === -1) return t;
    if (customerFirstName) return t.replace(/\{first_name\}/g, customerFirstName);
    // Guests: remove the token plus whichever comma flanks it, then tidy
    // whitespace — works for leading, trailing, and mid-sentence placement.
    return t
      .replace(/,\s*\{first_name\}/g, '')
      .replace(/\{first_name\}\s*,?\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // **accent** markup in merchant copy renders the wrapped words in the
  // accent color ("matched in **60 seconds**"). Escapes first, so the
  // output is safe to assign as innerHTML.
  function renderAccent(t) {
    return escapeHtml(t).replace(/\*\*([^*]+)\*\*/g, '<span class="gq-accent">$1</span>');
  }

  function formatMoney(cents) {
    var amount = (Number(cents) || 0) / 100;
    try {
      var code = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD';
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount);
    } catch (e) {
      return '$' + amount.toFixed(2);
    }
  }

  var productJsonCache = {};
  function fetchProductJson(handle) {
    if (PREVIEW) {
      return Promise.resolve((PREVIEW.productJson && PREVIEW.productJson[handle]) || null);
    }
    if (!handle) return Promise.resolve(null);
    if (productJsonCache[handle]) return productJsonCache[handle];
    var p = fetch('/products/' + encodeURIComponent(handle) + '.js', {
      headers: { 'Accept': 'application/json' },
    })
      .then(function(res) { return res.ok ? res.json() : null; })
      .catch(function() { return null; });
    productJsonCache[handle] = p;
    return p;
  }

  function priceCentsForRec(pj, rec) {
    if (!pj) return null;
    if (rec.variantNumericId && Array.isArray(pj.variants)) {
      for (var i = 0; i < pj.variants.length; i++) {
        if (String(pj.variants[i].id) === String(rec.variantNumericId)) {
          return typeof pj.variants[i].price === 'number' ? pj.variants[i].price : null;
        }
      }
    }
    if (Array.isArray(pj.variants) && pj.variants.length > 0 &&
        typeof pj.variants[0].price === 'number') {
      return pj.variants[0].price;
    }
    return typeof pj.price === 'number' ? pj.price : null;
  }

  // Product image for a match: the matched variant's own image when it has
  // one, else the product's featured image.
  function imageForRec(pj, rec) {
    if (!pj) return null;
    if (rec.variantNumericId && Array.isArray(pj.variants)) {
      for (var i = 0; i < pj.variants.length; i++) {
        if (String(pj.variants[i].id) === String(rec.variantNumericId) &&
            pj.variants[i].featured_image && pj.variants[i].featured_image.src) {
          return pj.variants[i].featured_image.src;
        }
      }
    }
    if (pj.featured_image) return pj.featured_image;
    if (Array.isArray(pj.images) && pj.images.length > 0) return pj.images[0];
    return null;
  }

  // Resolve a variant id we can add to cart: the matched variant, else the
  // product's first (default) variant.
  function variantIdForCart(pj, rec) {
    if (rec.variantNumericId) return rec.variantNumericId;
    if (pj && Array.isArray(pj.variants) && pj.variants.length > 0) return pj.variants[0].id;
    return null;
  }

  function addToBag(variantId, quantity) {
    if (PREVIEW) return Promise.resolve({ preview: true });
    var formData = new FormData();
    formData.append('id', String(variantId));
    formData.append('quantity', String(quantity || 1));
    // Section Rendering API: ask Shopify to return the re-rendered header
    // cart badge with the add response. Dawn-family themes name it
    // 'cart-icon-bubble'; themes without that section just omit it from the
    // response and we fall back to the generic count update below.
    formData.append('sections', 'cart-icon-bubble');
    formData.append('sections_url', window.location.pathname);
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: formData,
    }).then(function(res) {
      return res.json().then(function(body) {
        if (!res.ok) {
          var msg = (body && (body.description || body.message)) || ('cart add failed: ' + res.status);
          throw new Error(msg);
        }
        if (body && typeof body.status === 'number' && body.status >= 400) {
          throw new Error(body.description || body.message || ('cart add soft-failure: ' + body.status));
        }
        try {
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: { source: 'gleame-quiz' } }));
          document.dispatchEvent(new CustomEvent('cart:refresh', { detail: { source: 'gleame-quiz' } }));
        } catch (e) { /* old browsers — ignore */ }
        refreshCartUi(body);
        return body;
      });
    });
  }

  // Best-effort header cart refresh after an AJAX add. /cart/add.js changes
  // the cart but themes only re-render their own badge/drawer on their own
  // form submits — without this, the count looks stale until a reload.
  // Three layers, all guarded so unknown themes degrade to nothing breaking:
  // 1) swap in the re-rendered 'cart-icon-bubble' section when the theme
  //    provided one (Dawn family), 2) rewrite common count-badge elements
  //    from /cart.js, 3) the Added state also links to /cart as the
  //    always-works path.
  function refreshCartUi(addBody) {
    try {
      var sections = addBody && addBody.sections;
      var html = sections && sections['cart-icon-bubble'];
      var holder = document.getElementById('cart-icon-bubble');
      if (html && holder) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var fresh = tmp.querySelector('#cart-icon-bubble');
        holder.innerHTML = fresh ? fresh.innerHTML : html;
        return; // authoritative render — skip the generic pass
      }
    } catch (e) { /* fall through to the generic pass */ }

    fetch('/cart.js', { credentials: 'same-origin' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(cart) {
        if (!cart || typeof cart.item_count !== 'number') return;
        var count = String(cart.item_count);
        var selectors = [
          '[data-cart-count]', '.cart-count', '.cart__count', '#CartCount',
          '.cart-count-bubble span[aria-hidden="true"]', '.cart-link__bubble-num',
        ];
        for (var i = 0; i < selectors.length; i++) {
          var nodes = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < nodes.length; j++) {
            if (nodes[j].hasAttribute('data-cart-count')) nodes[j].setAttribute('data-cart-count', count);
            nodes[j].textContent = count;
          }
        }
      })
      .catch(function() {});
  }

  // Cart token for conversion attribution. The Liquid-rendered token can be
  // stale/legacy; refresh from /cart.js before attributing purchases.
  var cartToken = null;
  function acceptToken(t) {
    if (typeof t !== 'string') return null;
    if (!/^[a-zA-Z0-9-_]+$/.test(t) || t.length > 64) return null;
    if (/^[0-9a-f]{32}$/.test(t)) return null; // legacy pre-SFAPI format
    return t;
  }
  cartToken = acceptToken(root.getAttribute('data-cart-token'));
  function refreshCartToken() {
    if (PREVIEW) return Promise.resolve(null);
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(cart) {
        var t = acceptToken(cart && cart.token);
        if (t) cartToken = t;
        return cartToken;
      })
      .catch(function() { return cartToken; });
  }

  function trackEvent(eventType) {
    if (PREVIEW) return; // draft previews never pollute analytics
    try {
      var payload = {
        shopDomain: shopDomain,
        eventType: eventType,
        widgetType: 'quiz',
        productId: null,
        deviceType: isMobile() ? 'mobile' : 'desktop',
      };
      if (cartToken) payload.cartToken = cartToken;
      fetch(SHOPIFY_APP_URL + '/api/storefront/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(function() {});
    } catch (e) {}
  }

  // ---- Persistence (no images, ever) ----

  function saveState() {
    if (PREVIEW) return; // previews are ephemeral
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, s: state }));
    } catch (e) { /* quota / private mode — quiz still works, just won't survive nav */ }
  }

  function loadState() {
    if (PREVIEW) return null;
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !parsed.s) return null;
      return parsed.s;
    } catch (e) { return null; }
  }

  function clearState() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // ---- Theme typography inheritance ----
  //
  // Precedence per font: merchant override (quiz-config) → Dawn-family CSS
  // vars on :root → computed style of a real heading / the body → fallback
  // stack. Runs synchronously before first render; the theme's fonts are
  // already loaded on the page, so there's no flash of restyled text.

  function detectThemeTypography() {
    var docStyle = getComputedStyle(document.documentElement);
    var heading = (docStyle.getPropertyValue('--font-heading-family') || '').trim();
    var headingWeight = (docStyle.getPropertyValue('--font-heading-weight') || '').trim();
    var body = (docStyle.getPropertyValue('--font-body-family') || '').trim();

    if (!heading) {
      var h = document.querySelector('h1, h2, .h1, .h2');
      if (h && !root.contains(h)) {
        var hs = getComputedStyle(h);
        heading = hs.fontFamily || '';
        if (!headingWeight) headingWeight = hs.fontWeight || '';
      }
    }
    if (!body && document.body) {
      body = getComputedStyle(document.body).fontFamily || '';
    }

    if (config && config.headingFontOverride) heading = config.headingFontOverride;
    if (config && config.bodyFontOverride) body = config.bodyFontOverride;

    root.style.setProperty('--gq-font-heading', heading || 'Georgia, "Times New Roman", serif');
    root.style.setProperty('--gq-font-body', body || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
    root.style.setProperty('--gq-heading-weight', headingWeight || '600');
  }

  function applyStyleConfig() {
    if (config.accentColor) root.style.setProperty('--gq-accent', config.accentColor);
    if (typeof config.buttonRadius === 'number') {
      root.style.setProperty('--gq-radius-btn', config.buttonRadius + 'px');
    }
    // Design tokens (migration 049). Every field is optional; unset fields
    // leave the stylesheet defaults — the shipped design — untouched.
    if (config.inkColor) {
      root.style.setProperty('--gq-ink', config.inkColor);
      // Soft/faint text derive from the ink so a light-on-dark palette
      // stays readable without two more merchant fields.
      root.style.setProperty('--gq-ink-soft', 'color-mix(in srgb, ' + config.inkColor + ' 62%, transparent)');
      root.style.setProperty('--gq-ink-faint', 'color-mix(in srgb, ' + config.inkColor + ' 42%, transparent)');
    }
    if (config.cardBgColor) root.style.setProperty('--gq-card-bg', config.cardBgColor);
    if (config.lineColor) root.style.setProperty('--gq-line', config.lineColor);
    if (config.ctaColor) root.style.setProperty('--gq-dark', config.ctaColor);
    if (typeof config.cardRadius === 'number') {
      root.style.setProperty('--gq-radius-card', config.cardRadius + 'px');
    }
    if (config.animationStyle === 'minimal' || config.animationStyle === 'off') {
      root.classList.add('gq-anim-' + config.animationStyle);
    }
  }

  // ---- History / step routing ----
  //
  // Every forward transition pushes a #gq-* hash entry; the quiz's Back
  // control is literally history.back(), so browser back and UI back are
  // one code path (the popstate handler).

  // ---- Screen helpers ----

  function buildScreens() {
    screens = [];
    var currentGroup = null;
    for (var i = 0; i < flow.questions.length; i++) {
      var g = flow.questions[i].screenGroup || null;
      if (g && currentGroup === g) {
        screens[screens.length - 1].push(i);
      } else {
        screens.push([i]);
      }
      currentGroup = g;
    }
  }

  // Number of contiguously answered screens from the start. A screen counts
  // as answered only when EVERY question on it has an answer.
  function answeredScreenCount() {
    for (var s = 0; s < screens.length; s++) {
      // Fully-hidden screens are auto-skipped by navigation — they can't be
      // answered and must not block "quiz complete" (results clamp,
      // edit-return) for everyone downstream of a showIf.
      if (screenFullyHidden(s)) continue;
      for (var j = 0; j < screens[s].length; j++) {
        var a = state.answers[screens[s][j]];
        if (!a || !a.values || a.values.length === 0) return s;
      }
    }
    return screens.length;
  }

  // The first screen renders inline on the intro ONLY when it's a single
  // plain single-select question — multi-select and grouped screens need a
  // Continue button and their own space. It must also have something to
  // tap: a first question whose options are all conditional (never
  // satisfiable with no answers yet) falls through to the Start-button
  // path instead of an unstartable intro.
  function introHostsFirstScreen() {
    if (screens.length === 0) return false;
    var s0 = screens[0];
    return s0.length === 1 &&
      !flow.questions[s0[0]].multiSelect &&
      visibleOptions(flow.questions[s0[0]]).length > 0;
  }

  function stepSlug() {
    if (state.screen === 'question') return 'q' + (state.screenIndex + 1);
    return state.screen;
  }

  function pushStep() {
    try {
      history.pushState({ gq: { screen: state.screen, screenIndex: state.screenIndex } },
        '', '#gq-' + stepSlug());
    } catch (e) {}
  }

  function replaceStep() {
    try {
      history.replaceState({ gq: { screen: state.screen, screenIndex: state.screenIndex } },
        '', '#gq-' + stepSlug());
    } catch (e) {}
  }

  // Rewind answers/criteria for every question from screen `keepScreens` on.
  function truncateToScreen(keepScreens) {
    var firstQ = keepScreens >= screens.length
      ? flow.questions.length
      : screens[keepScreens][0];
    for (var i = firstQ; i < state.answers.length; i++) {
      var a = state.answers[i];
      if (a && a.axisKey) delete state.criteria[a.axisKey];
    }
    state.answers.length = Math.min(state.answers.length, firstQ);
  }

  // History entries can outlive the state that made them valid: Back pops
  // answers out of criteria but the Forward entry survives, and "Start
  // over" resets state while old gate/question entries remain below. Clamp
  // every popped target to what the current answers actually support, so a
  // stale entry can never reach the gate/results with a criteria hole.
  function clampStep(target) {
    var total = screens.length;
    var answered = answeredScreenCount();

    if (target.screen === 'results' &&
        !(answered >= total && Array.isArray(state.matches) && state.matches.length > 0)) {
      target = { screen: 'gate', screenIndex: 0 };
    }
    if (target.screen === 'gate' && answered < total) {
      target = { screen: 'question', screenIndex: answered };
    }
    if (target.screen === 'question') {
      var idx = target.screenIndex || 0;
      if (idx > answered) idx = answered;            // can't skip unanswered screens
      if (idx >= total) idx = total - 1;
      if (idx <= 0 && introHostsFirstScreen()) {
        return { screen: 'intro', screenIndex: 0 };  // screen 0 lives on the intro
      }
      target = { screen: 'question', screenIndex: Math.max(0, idx) };
    }
    return target;
  }

  function onPopState(e) {
    var target = e.state && e.state.gq;
    if (!target) {
      // Entry state (before our first pushState) — only relevant if the
      // hash still looks like ours; otherwise the user navigated away.
      if ((location.hash || '').indexOf('#gq-') !== 0) return;
      target = { screen: 'intro', screenIndex: 0 };
    }
    var original = target;
    target = clampStep(target);
    state.screen = target.screen;
    state.screenIndex = target.screenIndex || 0;
    // Manual navigation ends an in-flight edit-from-results round trip.
    if (state.screen === 'results' || state.screen === 'intro') editReturn = false;
    // NO truncation on navigation: answers survive Back/Forward so the
    // shopper's selections re-render (draft seeding) and criteria can't
    // develop holes. Re-ANSWERING a screen truncates downstream at commit.
    // If the popped entry was stale, rewrite it in place so Forward from
    // here lands on the corrected step too.
    if (target.screen !== original.screen || (target.screenIndex || 0) !== (original.screenIndex || 0)) {
      replaceStep();
    }
    saveState();
    render('back');
  }

  // ---- API calls ----

  function quizRecommend() {
    if (PREVIEW) {
      return Promise.resolve(
        PREVIEW.sampleRecommend || { matches: [], matrixApplied: false, partial: false }
      );
    }
    return fetch(SHOPIFY_APP_URL + '/api/storefront/quiz-recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopDomain: shopDomain, criteria: state.criteria }),
    }).then(function(res) {
      if (!res.ok) throw new Error('quiz-recommend ' + res.status);
      return res.json();
    });
  }

  function quizShade(file) {
    if (PREVIEW) return Promise.resolve({ values: {}, labels: {} });
    var fd = new FormData();
    fd.append('image', file);
    fd.append('shopDomain', shopDomain);
    return fetch(SHOPIFY_APP_URL + '/api/storefront/quiz-shade', {
      method: 'POST',
      body: fd,
    }).then(function(res) {
      if (!res.ok) return { values: {}, labels: {} };
      return res.json();
    }).catch(function() { return { values: {}, labels: {} }; });
  }

  function matchKey(match) {
    // Quantity is part of the key: a 2-set try-on renders differently from a
    // single set of the same variant (server appends the multi-set prompt).
    return String(match.productId || '') + '|' + String(match.variantId || '') +
      '|' + String(Math.max(1, match.quantity || 1));
  }

  function requestTryon(match) {
    if (PREVIEW) return Promise.resolve(null);
    var key = matchKey(match);
    if (!photoFile) return Promise.resolve(null);
    if (tryonCache[key]) return Promise.resolve(tryonCache[key]);
    if (tryonPending[key]) return tryonPending[key];
    // Distinct marker (not null): consumers show "limit reached" instead of
    // silently reverting the See-on-me button as if nothing happened.
    if (tryonCount >= TRYON_SESSION_CAP) return Promise.resolve({ capReached: true });
    tryonCount++;

    var fd = new FormData();
    fd.append('image', photoFile);
    fd.append('shopDomain', shopDomain);
    fd.append('productId', match.productId);
    if (match.variantId) fd.append('variantId', match.variantId);
    // Per-rule sets count — the server swaps in the multi-set prompt for 2+.
    fd.append('quantity', String(Math.max(1, match.quantity || 1)));

    var p = fetch(SHOPIFY_APP_URL + '/api/storefront/quiz-tryon', {
      method: 'POST',
      body: fd,
    }).then(function(res) {
      if (res.status === 429) return { rateLimited: true };
      if (!res.ok) return null;
      return res.json();
    }).then(function(data) {
      delete tryonPending[key];
      if (data && data.rateLimited) { tryonCount--; return { rateLimited: true }; }
      if (data && data.tryOnPreview) {
        tryonCache[key] = data.tryOnPreview;
        return data.tryOnPreview;
      }
      tryonCount--; // failed attempt — don't burn the session cap
      return null;
    }).catch(function() {
      delete tryonPending[key];
      tryonCount--;
      return null;
    });
    tryonPending[key] = p;
    return p;
  }

  // ---- Shade axis helpers ----

  // Manual shade/tone dot row, shared by the gate's "no photo handy?" rail
  // and the results shade gate — only the terminal action differs.
  function buildShadeDots(axis, extraClass, onPicked) {
    var dots = el('div', 'gq-shade-dots' + (extraClass ? ' ' + extraClass : ''));
    axis.values.forEach(function(v) {
      var dot = el('button', v.swatch ? 'gq-shade-pick' : 'gq-shade-pick gq-shade-pick--chip');
      dot.type = 'button';
      dot.title = v.label;
      dot.setAttribute('aria-label', v.label);
      if (v.swatch) dot.style.background = v.swatch;
      else dot.textContent = v.label;
      dot.onclick = function() {
        state.criteria[axis.key] = v.value;
        state.detectedShade = { axisKey: axis.key, value: v.value, label: v.label, source: 'manual' };
        trackEvent('quiz_shade_manual');
        saveState();
        onPicked();
      };
      dots.appendChild(dot);
    });
    return dots;
  }

  function shadeAxis() {
    if (!flow || !Array.isArray(flow.photoAxisDetails) || flow.photoAxisDetails.length === 0) return null;
    return flow.photoAxisDetails[0];
  }

  function shadeLabelFor(value) {
    var axis = shadeAxis();
    if (!axis) return value;
    for (var i = 0; i < axis.values.length; i++) {
      if (axis.values[i].value === value) return axis.values[i].label;
    }
    return value;
  }

  // ---- Rendering ----

  var renderSeq = 0;

  function render(direction) {
    var seq = ++renderSeq;
    var next;
    switch (state.screen) {
      case 'question': next = renderScreen(); break;
      case 'gate':     next = renderGate(); break;
      case 'results':  next = renderResults(); break;
      case 'intro':
      default:         next = renderIntro(); break;
    }
    swapScreen(next, direction || 'forward', seq);
  }

  function swapScreen(nextEl, direction, seq) {
    if (!stageEl) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var current = stageEl.firstElementChild;

    nextEl.classList.add('gq-screen');
    if (reduce) {
      stageEl.innerHTML = '';
      stageEl.appendChild(nextEl);
      return;
    }

    nextEl.classList.add(direction === 'back' ? 'gq-enter-back' : 'gq-enter');
    if (current) {
      current.classList.add(direction === 'back' ? 'gq-leave-back' : 'gq-leave');
      setTimeout(function() {
        if (seq !== renderSeq) return;
        stageEl.innerHTML = '';
        stageEl.appendChild(nextEl);
        requestAnimationFrame(function() {
          requestAnimationFrame(function() { nextEl.classList.add('gq-enter-active'); });
        });
      }, 160);
    } else {
      stageEl.appendChild(nextEl);
      requestAnimationFrame(function() {
        requestAnimationFrame(function() { nextEl.classList.add('gq-enter-active'); });
      });
    }
    // Keep the step in view when screens change height.
    setTimeout(function() {
      if (seq !== renderSeq) return;
      var rect = root.getBoundingClientRect();
      if (rect.top < 0) root.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }, 180);
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  // -- Intro (landing + question 1 inline) --

  function renderIntro() {
    // Abandoned uncommitted picks from a screen must not influence intro
    // option visibility (conditionMet consults draft).
    draft = {};
    var landing = config.landing || {};
    // Centered landing variant (quiz_intro_layout, migration 049). Default
    // stays the split two-column layout.
    var screen = el('div', 'gq-intro' +
      (config.introLayout === 'centered' ? ' gq-intro--centered' : ''));

    var main = el('div', 'gq-intro-main');
    var copy = el('div', 'gq-intro-copy');
    if (landing.eyebrow) copy.appendChild(el('p', 'gq-eyebrow', escapeHtml(landing.eyebrow)));
    copy.appendChild(el('h2', 'gq-headline', renderAccent(landing.headline || '')));
    if (landing.subtext) copy.appendChild(el('p', 'gq-subtext', escapeHtml(landing.subtext)));

    // First screen inline on the landing — only when it's a plain
    // single-select question. Multi-select / grouped first screens get a
    // Start button instead (they need Continue semantics and room).
    if (introHostsFirstScreen()) {
      var q0 = flow.questions[screens[0][0]];
      var qWrap = el('div', 'gq-intro-question');
      qWrap.appendChild(el('h3', 'gq-intro-question-title', escapeHtml(q0.prompt)));
      if (q0.helperText) qWrap.appendChild(el('p', 'gq-intro-question-helper', escapeHtml(q0.helperText)));
      // The intro's inline question defaults to the classic compact chip
      // row regardless of content — but an explicit merchant style
      // (question.optionStyle) wins here too, so "make question 1 boxed"
      // works whether it renders on the intro or its own screen.
      var introVariant = (q0.optionStyle && STYLE_TO_VARIANT[q0.optionStyle]) || 'chip';
      var cards = el('div', VARIANT_CONTAINER[introVariant]);
      visibleOptions(q0).forEach(function(opt, i) {
        var btn = el('button', VARIANT_BTN_CLASS[introVariant], optionButtonHtml(opt, introVariant));
        btn.type = 'button';
        btn.style.setProperty('--gq-stagger', i);
        btn.onclick = function() {
          markSelected(btn);
          commitSingle(0, screens[0][0], opt);
        };
        cards.appendChild(btn);
      });
      qWrap.appendChild(cards);
      copy.appendChild(qWrap);
    } else if (screens.length > 0) {
      var startBtn = el('button', 'gq-add-btn gq-start-btn', escapeHtml('Start the quiz'));
      startBtn.type = 'button';
      startBtn.onclick = function() {
        state.screen = 'question';
        state.screenIndex = 0;
        saveState();
        pushStep();
        render('forward');
      };
      copy.appendChild(startBtn);
    } else {
      copy.appendChild(el('p', 'gq-subtext', 'This quiz isn’t configured yet.'));
    }

    if (landing.altAudienceLabel && landing.altAudienceUrl) {
      // javascript: (and other scheme) URLs from admin input must never
      // reach href. Only http(s) and site-relative paths render; anything
      // else drops the link entirely.
      var altUrl = String(landing.altAudienceUrl).trim();
      if (/^(https?:\/\/|\/)/i.test(altUrl)) {
        var alt = el('p', 'gq-alt-audience');
        var altLink = el('a', 'gq-alt-audience-link', escapeHtml(landing.altAudienceLabel) + ' →');
        altLink.href = altUrl;
        alt.appendChild(altLink);
        copy.appendChild(alt);
      }
    }
    main.appendChild(copy);

    // Before/after visual (desktop side panel).
    if (landing.beforeImageUrl || landing.afterImageUrl) {
      var visual = el('div', 'gq-intro-visual');
      var frames = el('div', 'gq-ba-frames');
      if (landing.beforeImageUrl) {
        var b = el('figure', 'gq-ba-frame');
        b.appendChild(el('span', 'gq-ba-tag', escapeHtml(landing.beforeTag || 'Before')));
        var bImg = el('img', 'gq-ba-img');
        bImg.src = landing.beforeImageUrl; bImg.alt = 'Before'; bImg.loading = 'lazy';
        b.appendChild(bImg);
        frames.appendChild(b);
      }
      if (landing.afterImageUrl) {
        var a = el('figure', 'gq-ba-frame gq-ba-frame-after');
        a.appendChild(el('span', 'gq-ba-tag gq-ba-tag-after', escapeHtml(landing.afterTag || 'After')));
        var aImg = el('img', 'gq-ba-img');
        aImg.src = landing.afterImageUrl; aImg.alt = 'After'; aImg.loading = 'lazy';
        a.appendChild(aImg);
        frames.appendChild(a);
      }
      visual.appendChild(frames);
      if (landing.visualCaption) visual.appendChild(el('p', 'gq-ba-caption', escapeHtml(landing.visualCaption)));
      main.appendChild(visual);
    }
    screen.appendChild(main);

    // Trust row.
    if (Array.isArray(landing.trustItems) && landing.trustItems.length > 0) {
      var trust = el('div', 'gq-trust-row');
      landing.trustItems.forEach(function(item) {
        var t = el('span', 'gq-trust-item');
        t.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
          '<span>' + escapeHtml(item) + '</span>';
        trust.appendChild(t);
      });
      screen.appendChild(trust);
    }

    return screen;
  }

  // -- Question screens --

  // Draft selections for the screen being rendered — committed to
  // criteria/answers only on advance (tap for single-select, Continue for
  // multi-select and grouped screens). qIdx -> {options: [opt], selectAll}
  var draft = {};

  // "Open to anything" marker sent instead of expanding a select-all pick
  // into every axis value. The server treats it as "axis answered, any rule
  // value matches"; conditions on the axis are likewise satisfied.
  var ANY_VALUE = '_any';

  // Options whose showIf condition is met by committed answers or by the
  // current screen's draft (same-screen dependencies re-evaluate live via
  // the onSelectionChange rebuild in renderScreen).
  function conditionMet(showIf) {
    if (!showIf) return true;
    var v = state.criteria[showIf.axisKey];
    if (Array.isArray(v) && (v.indexOf(showIf.axisValue) !== -1 || v.indexOf(ANY_VALUE) !== -1)) return true;
    if (typeof v === 'string' && (v === showIf.axisValue || v === ANY_VALUE)) return true;
    for (var qi in draft) {
      var q = flow.questions[qi];
      if (!q || q.axisKey !== showIf.axisKey) continue;
      var d = draft[qi];
      if (d.selectAll) return true; // open to anything covers the condition
      var opts = d.options || [];
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].axisValue === showIf.axisValue) return true;
      }
    }
    return false;
  }

  function visibleOptions(q) {
    // Question-level showIf: an unmet condition hides the WHOLE question.
    // Returning [] here routes it through every existing "no visible
    // options" path — screen skipping (screenFullyHidden), progress
    // counting (answeredScreenCount), and answer pruning
    // (pruneDownstreamAnswers) — so a gated question behaves exactly like
    // one whose options are all conditional.
    if (q.showIf && !conditionMet(q.showIf)) return [];
    return q.options.filter(function(opt) { return conditionMet(opt.showIf); });
  }

  // A screen every question of which has no visible options is unanswerable —
  // navigation skips it rather than stranding the shopper.
  function screenFullyHidden(s) {
    var qIdxs = screens[s];
    if (!qIdxs) return false;
    for (var j = 0; j < qIdxs.length; j++) {
      if (visibleOptions(flow.questions[qIdxs[j]]).length > 0) return false;
    }
    return true;
  }

  function markSelected(btn) {
    // Radio semantics span the whole option block — the "open to anything"
    // row lives outside the tile container, so clearing must reach it too.
    var scope = (btn.closest && btn.closest('.gq-option-block')) || btn.parentNode;
    if (scope) {
      var siblings = scope.querySelectorAll('.is-selected');
      for (var s = 0; s < siblings.length; s++) siblings[s].classList.remove('is-selected');
    }
    btn.classList.add('is-selected');
  }

  function renderScreen() {
    var screenIdx = state.screenIndex;
    var qIdxs = screens[screenIdx];
    var screen = el('div', 'gq-step');
    if (!qIdxs) return screen;

    // Seed drafts from committed answers so back-nav re-renders selections
    // (answers survive navigation — they're only truncated at commit time).
    draft = {};
    qIdxs.forEach(function(qi) {
      var a = state.answers[qi];
      if (a && a.values && a.values.length > 0) {
        var q = flow.questions[qi];
        draft[qi] = {
          selectAll: Boolean(a.selectAll),
          options: q.options.filter(function(o) {
            return a.selectAll ? o.selectAll : a.values.indexOf(o.axisValue) !== -1;
          }),
        };
      }
    });

    // Dead screen (every option hidden by showIf) reached via history or a
    // config change: skip past it in place instead of stranding the shopper.
    if (screenFullyHidden(screenIdx)) {
      setTimeout(function() {
        if (state.screen !== 'question' || state.screenIndex !== screenIdx) return;
        var next = screenIdx + 1;
        while (next < screens.length && screenFullyHidden(next)) next++;
        if (next < screens.length) {
          state.screenIndex = next;
        } else {
          state.screen = 'gate';
        }
        saveState();
        replaceStep();
        render('forward');
      }, 0);
      return screen;
    }

    screen.appendChild(buildStepHeader(screenIdx + 1));
    var body = el('div', 'gq-step-body');

    // Continue appears for multi-select or grouped screens; plain
    // single-select keeps the tap-and-advance rhythm.
    var needsContinue = qIdxs.length > 1 || flow.questions[qIdxs[0]].multiSelect;
    var continueBtn = null;
    // Same-screen showIf dependencies need the option lists re-evaluated
    // whenever a selection changes.
    var hasConditionals = qIdxs.some(function(qi) {
      return flow.questions[qi].options.some(function(o) { return Boolean(o.showIf); });
    });
    var listHolders = {};

    function refreshContinue() {
      if (!continueBtn) return;
      // Only questions that currently HAVE visible options require an
      // answer — a fully-hidden part of a grouped screen must not block.
      var ready = qIdxs.every(function(qi) {
        if (visibleOptions(flow.questions[qi]).length === 0) return true;
        return draft[qi] && draft[qi].options.length > 0;
      });
      continueBtn.disabled = !ready;
    }

    function onSelectionChange() {
      if (hasConditionals) {
        // Prune picks whose options just became hidden, then rebuild every
        // list so visibility reflects the new draft (both directions:
        // newly-revealed options appear, stale hidden picks can't commit).
        qIdxs.forEach(function(qi) {
          var d = draft[qi];
          if (!d) return;
          var vis = visibleOptions(flow.questions[qi]);
          d.options = d.options.filter(function(o) { return vis.indexOf(o) !== -1; });
          if (d.options.length === 0) delete draft[qi];
        });
        qIdxs.forEach(function(qi) {
          var fresh = buildOptionList(qi, flow.questions[qi], needsContinue, onSelectionChange, true);
          var old = listHolders[qi];
          if (old && old.parentNode) old.parentNode.replaceChild(fresh, old);
          listHolders[qi] = fresh;
        });
      }
      refreshContinue();
    }

    qIdxs.forEach(function(qi, part) {
      var q = flow.questions[qi];
      if (part === 0) {
        body.appendChild(el('h2', 'gq-question-title', escapeHtml(q.prompt)));
      } else {
        body.appendChild(el('h3', 'gq-question-subtitle', escapeHtml(q.prompt)));
      }
      if (q.helperText) body.appendChild(el('p', 'gq-question-helper', escapeHtml(q.helperText)));
      var list = buildOptionList(qi, q, needsContinue, onSelectionChange, false);
      listHolders[qi] = list;
      body.appendChild(list);
    });

    if (needsContinue) {
      // The last question screen's CTA promises the payoff ("Show my
      // matches"), not another generic Continue.
      var isLast = screenIdx === screens.length - 1;
      var ctaLabel = isLast
        ? ((config.results && config.results.showMatchesLabel) || 'Show my matches')
        : 'Continue';
      continueBtn = el('button', 'gq-add-btn gq-continue-btn', escapeHtml(ctaLabel) + ' \u2192');
      continueBtn.type = 'button';
      continueBtn.onclick = function() { commitScreen(screenIdx); };
      body.appendChild(continueBtn);
      refreshContinue();
    }

    screen.appendChild(body);
    return screen;
  }

  var CHECK_SVG = '<svg class="gq-option-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  // Merchant-facing style names (question.optionStyle, migration 048) →
  // render variants. 'chips' maps to dotchip: the color dot only renders
  // per-option when a swatch exists, so it degrades to a plain chip.
  var STYLE_TO_VARIANT = {
    chips: 'dotchip',
    boxed: 'boxed',
    list: 'list',
    visual: 'visual',
    rich: 'rich',
    vibe: 'vibe',
  };

  // Pick a presentation variant for a question. An explicit optionStyle
  // from the quiz config wins; otherwise (the default) it's inferred from
  // the options' data — brands style questions purely through content:
  //   visual  — any option has an image (on-hand photography grid)
  //   rich    — tag chips / wear meters (application-system cards)
  //   vibe    — two-tone swatch style cards
  //   dotchip — color-dot pill chips
  //   boxed   — label + sublabel cards
  //   chip    — short labels, pill chips
  //   list    — fallback stacked rows
  function optionVariantFor(q, specific) {
    if (q.optionStyle && STYLE_TO_VARIANT[q.optionStyle]) {
      return STYLE_TO_VARIANT[q.optionStyle];
    }
    var has = function(key) {
      return specific.some(function(o) { return o.displayMeta && o.displayMeta[key]; });
    };
    if (specific.some(function(o) { return o.imageUrl; })) return 'visual';
    if (has('meterLabel') || has('tag')) return 'rich';
    if (has('swatch2')) return 'vibe';
    if (has('swatch')) return 'dotchip';
    if (has('sublabel')) return 'boxed';
    var short = specific.every(function(o) { return (o.label || '').length <= 22; });
    return short ? 'chip' : 'list';
  }

  var VARIANT_CONTAINER = {
    visual: 'gq-option-grid',
    rich: 'gq-rich-list',
    vibe: 'gq-vibe-grid',
    dotchip: 'gq-chip-row',
    chip: 'gq-chip-row',
    boxed: 'gq-option-grid gq-option-grid--boxed',
    list: 'gq-option-list',
  };

  function optionButtonHtml(opt, variant) {
    var meta = opt.displayMeta || {};
    var label = escapeHtml(opt.label);
    var sub = meta.sublabel ? '<span class="gq-option-sub">' + escapeHtml(meta.sublabel) + '</span>' : '';
    switch (variant) {
      case 'visual':
        return (opt.imageUrl
            ? '<img class="gq-option-img" src="' + escapeHtml(opt.imageUrl) + '" alt="" loading="lazy">'
            : '<span class="gq-option-img gq-option-img--empty"></span>') +
          '<span class="gq-option-visual-label">' + label + '</span>' + sub + CHECK_SVG;
      case 'rich': {
        var tag = meta.tag ? '<span class="gq-option-tag">' + escapeHtml(meta.tag) + '</span>' : '';
        var meter = meta.meterLabel
          ? '<span class="gq-meter"><span class="gq-meter-fill" style="width:' +
            Math.max(4, Math.min(100, Number(meta.meterPct) || 0)) + '%"></span></span>' +
            '<span class="gq-meter-label">' + escapeHtml(meta.meterLabel) + '</span>'
          : '';
        return tag + '<span class="gq-option-rich-title">' + label + '</span>' + sub + meter + CHECK_SVG;
      }
      case 'vibe': {
        // Swatch-less options in a vibe question fall back to a plain boxed
        // card — a defaulted gray gradient would read as a real colorway.
        if (!meta.swatch && !meta.swatch2) {
          return '<span class="gq-option-visual-label">' + label + '</span>' + sub + CHECK_SVG;
        }
        var s1 = meta.swatch || meta.swatch2;
        var s2 = meta.swatch2 || meta.swatch;
        return '<span class="gq-vibe-tone" style="background:linear-gradient(105deg,' +
          escapeHtml(s1) + ' 50%,' + escapeHtml(s2) + ' 50%)"></span>' +
          '<span class="gq-option-visual-label">' + label + '</span>' + sub + CHECK_SVG;
      }
      case 'dotchip':
      case 'chip': {
        // Chips keep authored sublabels as a stacked second line rather
        // than silently dropping them when a sibling's swatch flips the
        // question into chip rendering.
        var chipText = meta.sublabel
          ? '<span class="gq-chip-text"><span>' + label + '</span><span class="gq-chip-sub">' + escapeHtml(meta.sublabel) + '</span></span>'
          : '<span>' + label + '</span>';
        return (variant === 'dotchip' && meta.swatch
            ? '<span class="gq-chip-dot" style="background:' + escapeHtml(meta.swatch) + '"></span>'
            : '') + chipText;
      }
      case 'boxed':
        return '<span class="gq-option-visual-label">' + label + '</span>' + sub + CHECK_SVG;
      default: // list
        return '<span>' + label + (meta.sublabel ? '<span class="gq-option-sub gq-option-sub--inline">' + escapeHtml(meta.sublabel) + '</span>' : '') + '</span>' + CHECK_SVG;
    }
  }

  var VARIANT_BTN_CLASS = {
    visual: 'gq-option gq-option--visual',
    rich: 'gq-option gq-option--rich',
    vibe: 'gq-option gq-option--vibe',
    dotchip: 'gq-chip',
    chip: 'gq-chip',
    boxed: 'gq-option gq-option--boxed',
    list: 'gq-option',
  };

  // Shared selection behavior for every variant (single-radio, multi-toggle,
  // exclusive "open to anything").
  function wireOptionClick(btn, qi, q, opt, needsContinue, onChange) {
    btn.onclick = function() {
      if (!q.multiSelect) {
        draft[qi] = { selectAll: opt.selectAll, options: [opt] };
        markSelected(btn);
        if (!needsContinue) {
          commitSingle(state.screenIndex, qi, opt);
          return;
        }
      } else if (opt.selectAll) {
        draft[qi] = { selectAll: true, options: [opt] };
        markSelected(btn);
      } else {
        var d = draft[qi];
        if (!d || d.selectAll) {
          draft[qi] = d = { selectAll: false, options: [] };
          var all = btn.parentNode ? btn.parentNode.parentNode.querySelectorAll('.is-selected') : [];
          for (var t = 0; t < all.length; t++) all[t].classList.remove('is-selected');
        }
        var at = d.options.indexOf(opt);
        if (at === -1) {
          // Per-question pick cap (migration 055). Deselecting is always
          // allowed; extra picks are ignored so the shopper swaps by
          // deselecting first, like every "pick up to N" UI.
          if (q.maxSelections && d.options.length >= q.maxSelections) return;
          d.options.push(opt);
          btn.classList.add('is-selected');
        } else {
          d.options.splice(at, 1);
          btn.classList.remove('is-selected');
          if (d.options.length === 0) delete draft[qi];
        }
      }
      if (onChange) onChange();
    };
  }

  function buildOptionList(qi, q, needsContinue, onChange, noAnim) {
    var opts = visibleOptions(q);
    var anyOpt = null;
    var specific = [];
    opts.forEach(function(o) {
      if (o.selectAll && !anyOpt) anyOpt = o;
      else specific.push(o);
    });

    var variant = optionVariantFor(q, specific.length > 0 ? specific : opts);
    var block = el('div', 'gq-option-block' + (noAnim ? ' gq-no-anim' : ''));
    var list = el('div', VARIANT_CONTAINER[variant]);

    specific.forEach(function(opt, idx) {
      var btn = el('button', VARIANT_BTN_CLASS[variant], optionButtonHtml(opt, variant));
      btn.type = 'button';
      btn.style.setProperty('--gq-stagger', idx);
      var current = draft[qi];
      if (current && current.options.indexOf(opt) !== -1) btn.classList.add('is-selected');
      wireOptionClick(btn, qi, q, opt, needsContinue, onChange);
      list.appendChild(btn);
    });
    block.appendChild(list);

    // "Open to anything" renders as a full-width dashed escape hatch,
    // visually distinct from the tiles — selecting it clears them.
    if (anyOpt) {
      var anyBtn = el('button', 'gq-option-any', '<span>' + escapeHtml(anyOpt.label) + '</span>');
      anyBtn.type = 'button';
      var cur = draft[qi];
      if (cur && cur.options.indexOf(anyOpt) !== -1) anyBtn.classList.add('is-selected');
      wireOptionClick(anyBtn, qi, q, anyOpt, needsContinue, onChange);
      block.appendChild(anyBtn);
    }

    return block;
  }

  // Resolve a question's draft into criteria values. "Open to anything"
  // becomes the ANY_VALUE marker — the server matches it against any rule
  // value, with no expansion (so option subsets and value caps can't bite).
  function draftToAnswer(qi) {
    var q = flow.questions[qi];
    var d = draft[qi];
    if (!d || d.options.length === 0) return null;
    var values = [];
    if (d.selectAll) {
      values = [ANY_VALUE];
    } else {
      d.options.forEach(function(o) {
        if (values.indexOf(o.axisValue) === -1) values.push(o.axisValue);
      });
    }
    return { axisKey: q.axisKey, values: values, selectAll: Boolean(d.selectAll) };
  }

  function recordAnswer(qi, answer) {
    var q = flow.questions[qi];
    state.answers[qi] = answer;
    state.criteria[q.axisKey] = q.multiSelect ? answer.values : answer.values[0];
  }

  // Fired synchronously at commit — NOT inside the tap-acknowledge delay,
  // where a fast tab-close would drop the funnel's first-step beacons.
  function fireAnswerEvents() {
    if (!state.quizStarted) { state.quizStarted = true; trackEvent('quiz_start'); }
    trackEvent('quiz_question_answered');
  }

  function advanceFrom(screenIdx) {
    // Skip screens whose every option is hidden by the answers so far.
    var next = screenIdx + 1;
    while (next < screens.length && screenFullyHidden(next)) next++;
    if (next < screens.length) {
      state.screen = 'question';
      state.screenIndex = next;
    } else {
      state.screen = 'gate';
      trackEvent('quiz_gate_view');
    }
    saveState();
    pushStep();
    render('forward');
  }

  // After a commit: normal flow advances forward; an edit-from-results
  // commit re-validates downstream answers (pruneDownstreamAnswers) and
  // returns straight to re-rendered results when everything still holds —
  // otherwise the flow continues at the first broken screen, and finishing
  // THAT screen returns to results (editReturn persists until then).
  function finishCommit(screenIdx) {
    committing = false; // acknowledge window over; taps commit again
    fireAnswerEvents();
    if (editReturn) {
      var broken = pruneDownstreamAnswers();
      if (broken === -1 && answeredScreenCount() >= screens.length) {
        editReturn = false;
        saveState();
        // Re-committing the same answer changes nothing — skip the server
        // round trip and re-render the results already in state.
        if (editSnapshot === JSON.stringify(state.criteria) &&
            Array.isArray(state.matches) && state.matches.length > 0) {
          state.screen = 'results';
          pushStep();
          render('forward');
          return;
        }
        goToResults(stageEl ? stageEl.firstElementChild : null);
        return;
      }
      if (broken !== -1) {
        // Land the shopper directly on the invalidated screen (it can sit
        // anywhere relative to the edited one) — editReturn stays true, so
        // completing it returns to results.
        saveState();
        state.screen = 'question';
        state.screenIndex = broken;
        pushStep();
        render('forward');
        return;
      }
    }
    advanceFrom(screenIdx);
  }

  // Tap-to-advance path for plain single-select screens (and the intro's
  // inline first question). Small selected-state beat before advancing —
  // the tap should feel acknowledged, not teleporting.
  // Double-tap guard: a second tap inside the acknowledge delay re-ran the
  // whole commit (duplicate history entries + double analytics). The pending
  // timer is never cancelled anywhere, so finishCommit ALWAYS runs and
  // clears the flag; no navigation path (popstate included) can leave it
  // stuck true.
  var committing = false;
  function commitSingle(screenIdx, qi, opt) {
    if (committing) return;
    // Edits from results keep downstream answers (pruned in finishCommit);
    // normal flow truncates so a changed answer restarts what follows.
    if (!editReturn) truncateToScreen(screenIdx);
    draft[qi] = { selectAll: opt.selectAll, options: [opt] };
    var answer = draftToAnswer(qi);
    if (!answer) return;
    recordAnswer(qi, answer);
    committing = true;
    setTimeout(function() { finishCommit(screenIdx); }, 220);
  }

  // Continue path for multi-select and grouped screens. Questions whose
  // options are all hidden are skipped, not required.
  function commitScreen(screenIdx) {
    var qIdxs = screens[screenIdx];
    var commits = [];
    for (var j = 0; j < qIdxs.length; j++) {
      var qi = qIdxs[j];
      if (visibleOptions(flow.questions[qi]).length === 0) continue;
      var answer = draftToAnswer(qi);
      if (!answer) return; // Continue was enabled prematurely — refuse
      commits.push({ qi: qi, answer: answer });
    }
    if (commits.length === 0) return;
    if (!editReturn) truncateToScreen(screenIdx);
    for (var k = 0; k < commits.length; k++) {
      recordAnswer(commits[k].qi, commits[k].answer);
    }
    finishCommit(screenIdx);
  }

  function buildStepHeader(stepNumber, isBonus) {
    var header = el('div', 'gq-step-header');
    var back = el('button', 'gq-back',
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg><span>Back</span>');
    back.type = 'button';
    back.onclick = function() { history.back(); };
    header.appendChild(back);

    // Progress indicator. Default is the nail pips — the signature element
    // of the quiz chrome; merchants can switch to a bar, a bare counter, or
    // nothing (quiz_progress_style, migration 049).
    var progressStyle = (config && config.progressStyle) || 'pips';
    var right = el('div', 'gq-progress-wrap');
    if (progressStyle !== 'none') {
      right.appendChild(el('span', 'gq-step-count',
        isBonus ? 'Bonus' : (stepNumber + ' of ' + screens.length)));
    }
    if (progressStyle === 'pips') {
      var pips = el('div', 'gq-pips');
      for (var i = 0; i < screens.length; i++) {
        var cls = 'gq-pip';
        if (!isBonus) {
          if (i < stepNumber - 1) cls += ' gq-pip--done';
          else if (i === stepNumber - 1) cls += ' gq-pip--current';
        } else {
          cls += ' gq-pip--done';
        }
        pips.appendChild(el('span', cls));
      }
      right.appendChild(pips);
    } else if (progressStyle === 'bar') {
      var bar = el('div', 'gq-progress-bar');
      // Completed steps only — the current step is in progress, matching
      // the pips' done/current semantics (a 1-question quiz starts at 0%,
      // not 100%).
      var pct = isBonus ? 100 : Math.round(((stepNumber - 1) / screens.length) * 100);
      var fill = el('span', 'gq-progress-bar-fill');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      right.appendChild(bar);
    }
    header.appendChild(right);
    return header;
  }


  // -- Try-on gate (last numbered step) --

  function renderGate() {
    var gate = config.gate || {};
    // Without a photo axis there's no tone rail: the two-column wireframe
    // layout would leave a dead right column and a lopsided page — the solo
    // variant centers the whole gate instead.
    var gateAxis = shadeAxis();
    // Merchant toggle (migration 054): manualEnabled=false hides the manual
    // shade rail on this step — photo or skip only. Absent (older cached
    // config) means enabled. The results shade gate is NOT gated by this;
    // it stays the recovery path for no-photo shoppers.
    var manualRailOn = !((config.shadeGate || {}).manualEnabled === false);
    var hasRail = Boolean(gateAxis && gateAxis.values.length > 0 && manualRailOn);
    var screen = el('div', 'gq-step gq-step--gate' + (hasRail ? '' : ' gq-step--gate-solo'));
    screen.appendChild(buildStepHeader(0, true));

    var body = el('div', 'gq-step-body');
    body.appendChild(el('h2', 'gq-question-title', renderAccent(gate.headline || 'Want to see it on you?')));
    if (gate.helper) body.appendChild(el('p', 'gq-question-helper', escapeHtml(gate.helper)));

    var cols = el('div', 'gq-gate-cols');

    // Dropzone — drag a photo or tap anywhere; mobile taps open the camera
    // sheet via the file input's capture behavior.
    var drop = el('div', 'gq-dropzone');
    drop.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>' +
      '<p class="gq-dropzone-title">' + (isMobile() ? 'Tap to add a quick photo' : 'Drag a photo here, or tap to upload') + '</p>';
    var uploadBtn = el('button', 'gq-dropzone-btn', escapeHtml(gate.photoLabel || 'Upload photo'));
    uploadBtn.type = 'button';
    drop.appendChild(uploadBtn);
    if (gate.privacyNote) {
      drop.appendChild(el('p', 'gq-dropzone-privacy',
        '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ' +
        escapeHtml(gate.privacyNote)));
    }

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.onchange = function(e) {
      var f = e.target.files && e.target.files[0];
      if (f) onPhotoChosen(f, screen); // rejection feedback lives inside
      // Reset so picking the SAME file again re-fires change (it doesn't
      // otherwise, which made a rejected photo look permanently broken).
      e.target.value = '';
    };
    drop.appendChild(fileInput);
    drop.onclick = function() {
      if (!isMobile() && window.gleameCamera) {
        openPhotoCapture(screen);
      } else {
        fileInput.click();
      }
    };
    drop.ondragover = function(e) { e.preventDefault(); drop.classList.add('is-dragover'); };
    drop.ondragleave = function() { drop.classList.remove('is-dragover'); };
    drop.ondrop = function(e) {
      e.preventDefault();
      drop.classList.remove('is-dragover');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onPhotoChosen(f, screen); // rejection feedback lives inside
    };
    cols.appendChild(drop);

    // Manual fallback rail — pick the closest tone/shade instead of a
    // photo (only when the shop has a photo-sourced axis).
    var axis = gateAxis;
    var sg = config.shadeGate || {};
    if (hasRail) {
      var rail = el('div', 'gq-tone-rail');
      rail.appendChild(el('p', 'gq-tone-rail-title', escapeHtml(sg.ctaManual || 'No photo handy?')));
      if (sg.body) rail.appendChild(el('p', 'gq-tone-rail-body', escapeHtml(sg.body)));
      rail.appendChild(buildShadeDots(axis, 'gq-shade-dots--left', function() { goToResults(screen); }));
      cols.appendChild(rail);
    }

    body.appendChild(cols);

    // Skip is a first-class path, not fine print with guilt attached.
    var skip = el('button', 'gq-skip-link', escapeHtml(gate.skipLabel || 'Skip — show my matches now') + ' \u2192');
    skip.type = 'button';
    skip.onclick = function() {
      trackEvent('quiz_photo_skip');
      goToResults(screen);
    };
    body.appendChild(skip);

    screen.appendChild(body);
    return screen;
  }

  // Photo capture shared by the gate and the results shade path. Desktop
  // uses the gleame-camera modal (falls back to a file picker); mobile goes
  // straight to the native camera/file sheet.
  function openPhotoCapture(screenEl, onDone) {
    var handler = function(file) { onPhotoChosen(file, screenEl, onDone); };

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.onchange = function(e) {
      var f = e.target.files && e.target.files[0];
      if (f) handler(f);
      e.target.value = ''; // same-file re-pick must re-fire change
      // One-shot input: remove after use (these used to accumulate in the
      // DOM holding File references for the life of the page).
      if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
    };
    document.body.appendChild(fileInput);

    if (!isMobile() && window.gleameCamera) {
      window.gleameCamera.open(
        handler,
        function() { fileInput.click(); },
        { hint: config && config.photoFrameHint }
      );
    } else {
      fileInput.click();
    }
  }

  // Why the photo can't be used, or null when it can. The server accepts
  // 8MB — the old silent 5MB client cap rejected ordinary 12MP phone photos
  // with NO feedback, which read as "uploading a photo does nothing".
  function photoRejectReason(file) {
    if (!file) return 'No file selected.';
    if (file.type && file.type.indexOf('image/') !== 0) {
      return 'That file isn’t a photo — please choose an image.';
    }
    if (file.size > 8 * 1024 * 1024) {
      return 'That photo is too large (over 8MB). Try a smaller photo or a screenshot of it.';
    }
    return null;
  }

  function validPhoto(file) {
    return photoRejectReason(file) === null;
  }

  // Transient notice for photo problems. Inline on the given screen when
  // there is one; a fixed toast otherwise (results shade path).
  function showPhotoNotice(screenEl, msg) {
    var host = screenEl || root;
    var existing = host.querySelector('.gq-photo-notice');
    if (existing) existing.parentNode.removeChild(existing);
    var n = el('p', 'gq-photo-notice', escapeHtml(msg));
    n.setAttribute('role', 'alert');
    n.style.cssText = screenEl
      ? 'margin:10px 0 0;font-size:13px;line-height:1.4;color:#b54708;'
      : 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#1a1a1a;color:#fff;' +
        'padding:10px 16px;border-radius:10px;font-size:13px;max-width:90vw;text-align:center;';
    host.appendChild(n);
    setTimeout(function() {
      if (n.parentNode) n.parentNode.removeChild(n);
    }, 6000);
  }

  function onPhotoChosen(file, screenEl, onDone) {
    var reason = photoRejectReason(file);
    if (reason) {
      showPhotoNotice(screenEl, reason);
      return;
    }
    photoFile = file;
    state.hasPhoto = true;
    tryonCache = {};
    tryonCount = 0;
    trackEvent('quiz_photo_upload');

    var axis = shadeAxis();
    // Re-classify when the current shade came from a previous photo — a
    // retake is very often a correction of a bad detection, so the stale
    // value must not survive it. A manually-picked shade is an explicit
    // choice and does survive.
    var staleDetection = axis && state.detectedShade && state.detectedShade.source === 'photo';
    var needsShade = axis && (!state.criteria[axis.key] || staleDetection);
    if (staleDetection) {
      delete state.criteria[axis.key];
      state.detectedShade = null;
    }

    showWorking(screenEl, needsShade ? 'Reading your shade…' : 'Matching you up…');

    var detected = false;
    var classify = needsShade
      ? quizShade(file).then(function(res) {
          var v = res && res.values && res.values[axis.key];
          if (v) {
            detected = true;
            state.criteria[axis.key] = v;
            state.detectedShade = {
              axisKey: axis.key,
              value: v,
              label: (res.labels && res.labels[axis.key]) || shadeLabelFor(v),
              source: 'photo',
            };
            trackEvent('quiz_shade_detected');
          } else {
            // Failure and "couldn't classify" used to be silent and
            // indistinguishable — the shopper retried photos in a loop with
            // zero feedback. Say it, and point at the manual rail.
            trackEvent('quiz_shade_detect_failed');
            showPhotoNotice(
              screenEl,
              'We couldn’t read your shade from that photo — natural light helps. ' +
                'You can also pick the closest shade manually.'
            );
          }
        })
      : Promise.resolve();

    classify.then(function() {
      // shadeChanged tells results-side callers whether criteria moved —
      // a rerun after a FAILED classification would just re-render the
      // identical partial results (the old infinite-retry loop).
      var shadeChanged = Boolean(needsShade) && detected;
      if (onDone) return onDone(shadeChanged);
      return goToResults(screenEl);
    });
  }

  // Lightweight in-step working indicator (shown over the gate while
  // classify + recommend run — typically 1-3s).
  function showWorking(screenEl, caption) {
    if (!screenEl) return;
    var existing = screenEl.querySelector('.gq-working');
    if (existing) { existing.querySelector('.gq-working-caption').textContent = caption; return; }
    var w = el('div', 'gq-working');
    w.appendChild(el('div', 'gq-working-spinner'));
    w.appendChild(el('p', 'gq-working-caption', escapeHtml(caption)));
    screenEl.appendChild(w);
  }

  function goToResults(screenEl) {
    if (screenEl) showWorking(screenEl, 'Finding your match…');
    return quizRecommend()
      .then(function(data) {
        // A resolved response without a usable matches payload (or an empty
        // set the server flagged as an error) is a failure, not a results
        // screen: throw into the catch below so it renders the same retry
        // UI as a network error instead of an empty results page.
        if (!data || !Array.isArray(data.matches) ||
            (data.matches.length === 0 && data.error)) {
          throw new Error('quiz-recommend empty');
        }
        state.matches = (data && data.matches) || [];
        state.matrixApplied = Boolean(data && data.matrixApplied);
        state.partial = Boolean(data && data.partial);
        state.screen = 'results';
        saveState();
        pushStep();
        trackEvent('quiz_results_shown');
        render('forward');
      })
      .catch(function() {
        if (!screenEl) return;
        var w = screenEl.querySelector('.gq-working');
        if (w && w.parentNode) w.parentNode.removeChild(w);
        var err = screenEl.querySelector('.gq-error');
        if (!err) {
          err = el('div', 'gq-error',
            '<p>Something went wrong finding your match.</p>');
          var retry = el('button', 'gq-retry', 'Try again');
          retry.type = 'button';
          retry.onclick = function() {
            if (err.parentNode) err.parentNode.removeChild(err);
            goToResults(screenEl);
          };
          err.appendChild(retry);
          screenEl.appendChild(err);
        }
      });
  }

  // Re-run recommend after the shade resolves (photo or manual pick) and
  // re-render results in place.
  var rerunPending = false;
  function rerunWithShade() {
    if (rerunPending) return; // double-tap guard — one recommend in flight
    rerunPending = true;
    // The results screen is live behind this call — show the standard
    // working spinner instead of freezing silently for the round trip.
    showWorking(stageEl ? stageEl.firstElementChild : null, 'Updating your matches\u2026');
    quizRecommend()
      .then(function(data) {
        state.matches = (data && data.matches) || [];
        state.matrixApplied = Boolean(data && data.matrixApplied);
        state.partial = Boolean(data && data.partial);
        saveState();
      })
      .catch(function() {})
      .then(function() {
        rerunPending = false;
        render('forward');
      });
  }

  // -- Results --

  // Set when the shopper taps an "edit" chip on the results rail: after the
  // edited screen commits (and downstream answers are re-validated), the
  // flow returns straight to re-rendered results instead of marching
  // forward through the remaining questions.
  var editReturn = false;
  // Criteria snapshot at edit time — lets an unchanged re-commit skip the
  // recommend round trip entirely.
  var editSnapshot = null;

  function jumpToScreen(screenIdx) {
    editReturn = true;
    editSnapshot = JSON.stringify(state.criteria);
    draft = {};
    state.screen = 'question';
    state.screenIndex = screenIdx;
    saveState();
    pushStep();
    render('back');
  }

  // After an edited answer changes, downstream answers may reference
  // options that are no longer visible (showIf) — drop just those values
  // instead of wiping every later answer. Returns the first screen index
  // left unanswered by the pruning, or -1 when everything still holds.
  function pruneDownstreamAnswers() {
    draft = {};
    var broken = -1;
    for (var s = 0; s < screens.length; s++) {
      for (var j = 0; j < screens[s].length; j++) {
        var qi = screens[s][j];
        var a = state.answers[qi];
        if (!a || !a.values || a.values.length === 0) continue;
        var q = flow.questions[qi];
        var vis = visibleOptions(q);
        var visValues = {};
        var visAny = false;
        vis.forEach(function(o) {
          if (o.selectAll) visAny = true;
          else visValues[o.axisValue] = true;
        });
        var kept = a.values.filter(function(v) {
          return v === ANY_VALUE ? visAny : Boolean(visValues[v]);
        });
        if (kept.length === a.values.length) continue;
        if (kept.length === 0) {
          delete state.criteria[a.axisKey];
          state.answers[qi] = undefined;
          if (broken === -1) broken = s;
        } else {
          a.values = kept;
          state.criteria[a.axisKey] = q.multiSelect ? kept : kept[0];
        }
      }
    }
    return broken;
  }

  function shadeReasonLine() {
    var axis = shadeAxis();
    if (!axis || !state.criteria[axis.key]) return null;
    var label = state.detectedShade && state.detectedShade.label
      ? state.detectedShade.label
      : shadeLabelFor(state.criteria[axis.key]);
    var source = state.detectedShade && state.detectedShade.source === 'photo'
      ? 'detected from your photo'
      : 'your pick';
    var swatch = null;
    for (var i = 0; i < axis.values.length; i++) {
      if (axis.values[i].value === state.criteria[axis.key]) swatch = axis.values[i].swatch;
    }
    return { label: label, source: source, swatch: swatch };
  }

  function buildAddLabel(template, quantity, totalCents) {
    var t = template || 'Add {count} to bag \u00b7 {total}';
    return t
      .replace(/\{count\}/g, String(quantity))
      .replace(/\{set_word\}/g, quantity === 1 ? 'set' : 'sets')
      .replace(/\{total\}/g, totalCents != null ? formatMoney(totalCents) : '');
  }

  function renderResults() {
    var results = config.results || {};
    var matches = Array.isArray(state.matches) ? state.matches : [];
    var hasPhotoNow = state.hasPhoto && Boolean(photoFile);
    var definitive = !state.partial;
    var screen = el('div', 'gq-results');

    var headline = (hasPhotoNow && definitive)
      ? (results.headlinePhoto || "Here's your match \u2014 on you")
      : (results.headlineNoPhoto || 'Your matches');

    // Empty state stands alone — a personalized headline plus "0 picks
    // made for your answers" above the apology reads as a contradiction.
    if (matches.length === 0) {
      screen.appendChild(el('div', 'gq-results-head'));
      var none = el('div', 'gq-error',
        '<p>We couldn\u2019t find a match this time \u2014 try adjusting your answers.</p>');
      var restart = el('button', 'gq-retry', 'Start over');
      restart.type = 'button';
      restart.onclick = restartQuiz;
      none.appendChild(restart);
      screen.appendChild(none);
      return screen;
    }

    var head = el('div', 'gq-results-head');
    head.appendChild(el('h2', 'gq-headline gq-results-headline', renderAccent(renderName(headline))));
    if (results.subtext) {
      // {match_word} pluralizes for brands whose rules return one or two
      // picks (e.g. a lone clip-in) — "{count} {match_word} made for you".
      head.appendChild(el('p', 'gq-results-subtext',
        escapeHtml(renderName(results.subtext)
          .replace(/\{count\}/g, String(matches.length))
          .replace(/\{match_word\}/g, matches.length === 1 ? 'match' : 'matches'))));
    }
    screen.appendChild(head);

    var layout = el('div', 'gq-results-layout');
    layout.appendChild(buildAnswersRail());

    var main = el('div', 'gq-results-main');
    // Column count follows the match count (capped at 3) so one or two
    // curated picks render centered at card width instead of rattling
    // around the left of a fixed 3-column grid.
    var grid = el('div', 'gq-match-grid gq-match-grid--' + Math.min(matches.length, 3));
    matches.forEach(function(m, i) {
      grid.appendChild(buildMatchCard(m, i, definitive, hasPhotoNow, results));
    });
    main.appendChild(grid);

    if (state.partial && shadeAxis()) {
      main.appendChild(buildShadeGate());
    }
    if (definitive && !hasPhotoNow && config.upsell && config.upsell.cta) {
      main.appendChild(buildUpsellBanner());
    }
    layout.appendChild(main);
    screen.appendChild(layout);

    if (definitive) screen.appendChild(buildStickyBar(matches[0], results));

    var restartRow = el('div', 'gq-restart-row');
    var restartBtn = el('button', 'gq-link-btn', escapeHtml(results.restartLabel || 'Try another look'));
    restartBtn.type = 'button';
    restartBtn.onclick = function() {
      trackEvent('quiz_restart');
      restartQuiz();
    };
    restartRow.appendChild(restartBtn);
    screen.appendChild(restartRow);

    return screen;
  }

  // "YOUR ANSWERS · TAP TO EDIT" — one chip per answered question; edit
  // jumps back to that screen and returns straight here after the change.
  function buildAnswersRail() {
    var rail = el('aside', 'gq-answers-rail');
    rail.appendChild(el('p', 'gq-rail-title', 'Your answers \u00b7 tap to edit'));

    screens.forEach(function(qIdxs, s) {
      qIdxs.forEach(function(qi) {
        var a = state.answers[qi];
        if (!a || !a.values || a.values.length === 0) return;
        var q = flow.questions[qi];
        var labels = [];
        if (a.selectAll || a.values.indexOf(ANY_VALUE) !== -1) {
          var anyOpt = q.options.filter(function(o) { return o.selectAll; })[0];
          labels.push(anyOpt ? anyOpt.label : 'Open to anything');
        } else {
          a.values.forEach(function(v) {
            var opt = q.options.filter(function(o) { return o.axisValue === v; })[0];
            labels.push(opt ? opt.label : v);
          });
        }
        var chip = el('div', 'gq-rail-chip');
        chip.appendChild(el('span', 'gq-rail-axis', escapeHtml(q.axisLabel)));
        chip.appendChild(el('span', 'gq-rail-value', escapeHtml(labels.join(', '))));
        var edit = el('button', 'gq-rail-edit', 'edit');
        edit.type = 'button';
        edit.onclick = function() { jumpToScreen(s); };
        chip.appendChild(edit);
        rail.appendChild(chip);
      });
    });

    // Shade/tone answer (photo axis) — editable via retake or manual pick.
    var shade = shadeReasonLine();
    if (shade) {
      var axis = shadeAxis();
      var chip = el('div', 'gq-rail-chip');
      chip.appendChild(el('span', 'gq-rail-axis', escapeHtml(axis.label)));
      var val = el('span', 'gq-rail-value');
      if (shade.swatch) {
        var dot = el('span', 'gq-shade-dot');
        dot.style.background = shade.swatch;
        val.appendChild(dot);
      }
      val.appendChild(document.createTextNode(shade.label));
      chip.appendChild(val);
      // Editable like every other answer: clearing the shade drops results
      // to the partial state, whose shade gate offers a fresh photo AND the
      // manual picker — the recovery path for a wrong detection.
      var editShade = el('button', 'gq-rail-edit', 'edit');
      editShade.type = 'button';
      editShade.onclick = function() {
        if (state.detectedShade && state.detectedShade.source === 'photo') {
          trackEvent('quiz_retake_photo');
        }
        delete state.criteria[axis.key];
        state.detectedShade = null;
        saveState();
        rerunWithShade();
      };
      chip.appendChild(editShade);
      rail.appendChild(chip);
    }
    return rail;
  }

  // Swap a match card's media to the generated try-on with a blur-up
  // reveal; falls back silently (product image stays) on failure.
  function applyTryonToMedia(media, img, match, isHero, onDone) {
    var prevSrc = img.src;
    requestTryon(match).then(function(result) {
      // Card torn down by a re-render while the transform ran: the fresh
      // card resolves the same cached promise; don't decode or double-track
      // on the detached copy.
      var connected = media.isConnected !== undefined ? media.isConnected : document.contains(media);
      if (!connected) { if (onDone) onDone(false, false); return; }
      if (!result || result.rateLimited || result.capReached) {
        if (onDone) {
          onDone(false, Boolean(result && result.rateLimited),
            Boolean(result && result.capReached));
        }
        return;
      }
      img.classList.add('gq-media-img--pending');
      img.onload = function() {
        img.onload = null;
        img.onerror = null;
        img.classList.remove('gq-media-img--pending');
        media.classList.add('gq-media--tryon');
        setMediaBadge(media);
        // Analytics keyed on card POSITION — merchant matrix ranks can
        // legitimately start above 1, so rank is the wrong key.
        trackEvent(isHero ? 'quiz_tryon_shown' : 'quiz_tryon_secondary');
        if (onDone) onDone(true, false);
      };
      img.onerror = function() {
        // Corrupt payload — restore the product image instead of leaving
        // the card blurred under a shimmer forever.
        img.onload = null;
        img.onerror = null;
        img.classList.remove('gq-media-img--pending');
        if (prevSrc) img.src = prevSrc;
        if (onDone) onDone(false, false);
      };
      img.src = 'data:image/jpeg;base64,' + result;
    });
  }

  // "On you" badge lives in JS (not CSS content) so it's configurable and
  // translatable like its sibling pills.
  function setMediaBadge(media) {
    if (media.querySelector('.gq-media-badge')) return;
    var results = config.results || {};
    media.appendChild(el('span', 'gq-media-badge', escapeHtml(results.onYouBadge || 'On you')));
  }

  function buildMatchCard(m, idx, definitive, hasPhotoNow, results) {
    var card = el('div', 'gq-match-card' + (idx === 0 ? ' gq-match-card--top' : ''));

    // "Top match" is a curation claim — only make it when the matrix
    // actually matched. AI-fallback picks get neutral position pills.
    var isCuratedTop = idx === 0 && state.matrixApplied;
    card.appendChild(el('span', 'gq-pill' + (isCuratedTop ? ' gq-pill--top' : ''),
      escapeHtml(isCuratedTop ? (results.bestMatchPill || 'Top match') : 'Match ' + (idx + 1))));

    // Media: product image, upgraded to a try-on when a photo exists —
    // automatically for the top match, on demand for the others.
    var media = el('div', 'gq-media');
    var img = el('img', 'gq-media-img');
    img.alt = m.title || m.productName;
    img.loading = 'lazy';
    media.appendChild(img);
    card.appendChild(media);

    var body = el('div', 'gq-match-body');
    body.appendChild(el('h3', 'gq-match-title', escapeHtml(m.productName)));
    var specBits = [];
    if (m.variantTitle) specBits.push(m.variantTitle);
    if (m.quantity > 1) specBits.push(m.quantity + ' sets');
    if (specBits.length > 0) body.appendChild(el('p', 'gq-match-spec', escapeHtml(specBits.join(' \u00b7 '))));

    // Shade line on the top match when a shade is resolved.
    if (idx === 0) {
      var shade = shadeReasonLine();
      if (shade && definitive) {
        var line = el('p', 'gq-shade-line');
        if (shade.swatch) {
          var dot = el('span', 'gq-shade-dot');
          dot.style.background = shade.swatch;
          line.appendChild(dot);
        }
        line.appendChild(document.createTextNode(shade.label + ' \u2014 ' + shade.source));
        body.appendChild(line);
      }
    }

    // Reasons on the top match; taglines everywhere they exist.
    if (idx === 0 && Array.isArray(m.reasons) && m.reasons.length > 0) {
      var ul = el('ul', 'gq-reasons');
      m.reasons.forEach(function(r) {
        var li = el('li', 'gq-reason');
        li.innerHTML =
          '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
          '<span>' + escapeHtml(r) + '</span>';
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    if (m.tagline) {
      body.appendChild(el('p', 'gq-tagline', escapeHtml(m.tagline)));
    } else if (idx > 0 && Array.isArray(m.reasons) && m.reasons.length > 0) {
      // No authored tagline: borrow one criteria reason so non-top cards
      // aren't bare name/price stubs next to the rich top match.
      var mini = el('ul', 'gq-reasons');
      var li = el('li', 'gq-reason');
      li.innerHTML =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
        '<span>' + escapeHtml(m.reasons[0]) + '</span>';
      mini.appendChild(li);
      body.appendChild(mini);
    }

    var price = el('p', 'gq-match-price', '');
    body.appendChild(price);

    if (definitive) {
      var addBtn = el('button', 'gq-add-btn gq-add-btn--card', escapeHtml(buildAddLabel(results.addButtonTemplate, m.quantity || 1, null)));
      addBtn.type = 'button';
      body.appendChild(addBtn);
      if (m.productHandle) {
        wirePricedAddButton(addBtn, m, results);
      } else {
        // No handle means no product JSON, no price, no cart variant to arm.
        addBtn.disabled = true;
        addBtn.textContent = 'Unavailable';
      }
    }

    // No handle means nowhere to link; skip the View link rather than render a
    // dead '/products/undefined' href.
    if (m.productHandle) {
      var view = el('a', 'gq-view-link', escapeHtml(results.viewProductLabel || 'View full product') + ' \u2192');
      view.href = '/products/' + encodeURIComponent(m.productHandle) +
        (m.variantNumericId ? '?variant=' + encodeURIComponent(m.variantNumericId) : '');
      view.onclick = function() { trackEvent('quiz_view_product'); saveState(); };
      body.appendChild(view);
    }
    card.appendChild(body);

    fetchProductJson(m.productHandle).then(function(pj) {
      var src = imageForRec(pj, m);
      var cached = tryonCache[matchKey(m)];
      if (cached) {
        img.src = 'data:image/jpeg;base64,' + cached;
        media.classList.add('gq-media--tryon');
        setMediaBadge(media);
      } else if (src) {
        img.src = src;
      }
      var unit = priceCentsForRec(pj, m);
      var qty = Math.max(1, m.quantity || 1);
      if (unit != null) price.textContent = formatMoney(unit * qty);

      if (hasPhotoNow && !cached) {
        if (idx === 0) {
          media.classList.add('gq-media--working');
          applyTryonToMedia(media, img, m, true, function() { media.classList.remove('gq-media--working'); });
        } else {
          var seeBtn = el('button', 'gq-media-see', 'See on me \u2728');
          seeBtn.type = 'button';
          seeBtn.onclick = function(e) {
            e.stopPropagation();
            seeBtn.disabled = true;
            seeBtn.textContent = 'Working\u2026';
            applyTryonToMedia(media, img, m, false, function(ok, limited, capped) {
              if (ok) { if (seeBtn.parentNode) seeBtn.parentNode.removeChild(seeBtn); }
              else if (capped) {
                // Session try-on cap hit: a persistent disabled label, not
                // a silent revert that reads as a broken button.
                seeBtn.disabled = true;
                seeBtn.textContent = 'Try-on limit reached';
              } else if (limited) {
                // Rate-limited: soft copy for a beat, then invite a retry.
                seeBtn.textContent = 'One moment\u2026';
                setTimeout(function() {
                  seeBtn.disabled = false;
                  seeBtn.textContent = 'See on me \u2728';
                }, 4000);
              } else {
                seeBtn.disabled = false;
                seeBtn.textContent = 'See on me \u2728';
              }
            });
          };
          media.appendChild(seeBtn);
        }
      }
    });

    return card;
  }

  // Post-results photo upsell — the second chance at try-on for shoppers
  // who skipped the gate.
  function buildUpsellBanner() {
    var upsell = config.upsell || {};
    var banner = el('div', 'gq-upsell');
    var copy = el('div', 'gq-upsell-copy');
    if (upsell.title) copy.appendChild(el('p', 'gq-upsell-title', escapeHtml(upsell.title)));
    if (upsell.body) copy.appendChild(el('p', 'gq-upsell-body', escapeHtml(upsell.body)));
    banner.appendChild(copy);
    var cta = el('button', 'gq-upsell-cta', escapeHtml(upsell.cta || 'Try them on me'));
    cta.type = 'button';
    cta.onclick = function() {
      if (cta.disabled) return;
      cta.disabled = true;
      openPhotoCapture(null, function(shadeChanged) {
        // No shade movement (e.g. shop without a photo axis): the matches
        // can't change — just re-render so the try-on kicks in from the
        // photo now held in memory.
        if (shadeChanged) rerunWithShade();
        else render('forward');
      });
      // Re-enable after a beat in case the shopper cancels the picker.
      setTimeout(function() { cta.disabled = false; }, 4000);
    };
    banner.appendChild(cta);
    return banner;
  }

  function wireAddButton(btn, variantId, quantity, compact) {
    var original = btn.textContent;
    btn.onclick = function() {
      btn.disabled = true;
      btn.classList.add('is-working');
      addToBag(variantId, quantity)
        .then(function() {
          btn.classList.remove('is-working');
          btn.classList.add('is-added');
          btn.textContent = compact ? 'Added \u2713' : 'Added to bag \u2713';
          if (!compact && btn.parentNode && !btn.parentNode.querySelector('.gq-viewbag-link')) {
            var bagLink = el('a', 'gq-view-link gq-viewbag-link', 'View bag \u2192');
            bagLink.href = '/cart';
            btn.parentNode.insertBefore(bagLink, btn.nextSibling);
          }
          refreshCartToken().then(function() { trackEvent('quiz_add_to_cart'); });
          setTimeout(function() {
            btn.classList.remove('is-added');
            btn.textContent = original;
            btn.disabled = false;
          }, 3200);
        })
        .catch(function() {
          btn.classList.remove('is-working');
          btn.textContent = 'Couldn\u2019t add \u2014 try again';
          setTimeout(function() {
            btn.textContent = original;
            btn.disabled = false;
          }, 2600);
        });
    };
  }

  // Shade gate ("Now let's nail your shade") for partial results.
  function buildShadeGate() {
    var sg = config.shadeGate || {};
    var axis = shadeAxis();
    var wrap = el('div', 'gq-shade-gate');
    wrap.appendChild(el('h3', 'gq-shade-headline', escapeHtml(sg.headline || "Now let's nail your shade")));
    if (sg.body) wrap.appendChild(el('p', 'gq-shade-body', escapeHtml(sg.body)));

    var photoBtn = el('button', 'gq-shade-photo-btn',
      '<span class="gq-shade-photo-label">' + escapeHtml(sg.ctaPhoto || 'Match my shade for me') + '</span>' +
      '<span class="gq-shade-photo-sub">' + escapeHtml((config.gate && config.gate.privacyNote) || 'Processed instantly \u00b7 never stored') + '</span>');
    photoBtn.type = 'button';
    photoBtn.onclick = function() {
      openPhotoCapture(null, function(shadeChanged) {
        // Rerunning after a failed classification re-renders the identical
        // partial screen — only rerun when the shade actually moved.
        if (shadeChanged) rerunWithShade();
      });
    };
    wrap.appendChild(photoBtn);

    var manual = el('div', 'gq-shade-manual');
    manual.appendChild(el('p', 'gq-shade-manual-label', escapeHtml(sg.ctaManual || 'I know my shade')));
    if (axis) manual.appendChild(buildShadeDots(axis, '', rerunWithShade));
    wrap.appendChild(manual);
    return wrap;
  }

  // Resolve price/variant from the storefront and arm an add-to-bag button.
  // Shared by the match cards and the mobile sticky bar so their labels and
  // cart behavior can never disagree (fetchProductJson is promise-cached —
  // no extra request).
  function wirePricedAddButton(btn, match, results) {
    btn.disabled = true;
    fetchProductJson(match.productHandle).then(function(pj) {
      var unit = priceCentsForRec(pj, match);
      var qty = Math.max(1, match.quantity || 1);
      var cartVariant = variantIdForCart(pj, match);
      btn.textContent = buildAddLabel(results.addButtonTemplate, qty, unit != null ? unit * qty : null);
      if (!cartVariant) return;
      btn.disabled = false;
      wireAddButton(btn, cartVariant, qty);
    });
  }

  function buildStickyBar(hero, results) {
    var bar = el('div', 'gq-sticky-bar');
    var btn = el('button', 'gq-add-btn gq-add-btn--sticky', escapeHtml(buildAddLabel(results.addButtonTemplate, hero.quantity || 1, null)));
    btn.type = 'button';
    bar.appendChild(btn);
    wirePricedAddButton(btn, hero, results);
    return bar;
  }

  function restartQuiz() {
    state = {
      screen: 'intro', screenIndex: 0, criteria: {}, answers: [],
      hasPhoto: false, detectedShade: null, matches: null,
      matrixApplied: false, partial: false,
      quizStarted: false, // the restarted run gets its own quiz_start event
    };
    draft = {}; // ghost selections must not leak into intro option visibility
    editReturn = false;
    photoFile = null;
    tryonCache = {};
    tryonCount = 0;
    clearState();
    replaceStep();
    render('back');
  }

  // ---- Boot ----

  // Preview navigation: jump the quiz to a named step ('intro', 'q1'..'qN',
  // 'gate', 'results'). Only wired up in preview mode. qN refers to the Nth
  // QUESTION — mapped to the screen hosting it, since screenGroup can put
  // several questions on one screen.
  function previewGoto(step) {
    if (!PREVIEW || !stageEl) return;
    if (step === 'intro') {
      state.screen = 'intro';
      state.screenIndex = 0;
    } else if (step === 'gate') {
      state.screen = 'gate';
    } else if (step === 'results') {
      var sample = PREVIEW.sampleRecommend || { matches: [], matrixApplied: false, partial: false };
      state.matches = sample.matches || [];
      state.matrixApplied = !!sample.matrixApplied;
      state.partial = !!sample.partial;
      state.screen = 'results';
    } else {
      var n = parseInt(String(step).replace(/^q/, ''), 10);
      if (!isFinite(n)) return;
      var questionIndex = n - 1;
      var screenIndex = 0;
      for (var si = 0; si < screens.length; si++) {
        if (screens[si].indexOf(questionIndex) !== -1) { screenIndex = si; break; }
      }
      state.screen = 'question';
      state.screenIndex = Math.max(0, Math.min(screens.length - 1, screenIndex));
    }
    replaceStep();
    render('forward');
  }

  // Preview with nothing to render (no questions yet): show a friendly
  // placeholder instead of a blank frame, and keep the update listener able
  // to boot the real quiz once questions exist.
  function renderPreviewPlaceholder() {
    root.classList.add('gq-active');
    root.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;' +
      'padding:24px;text-align:center;font-family:sans-serif;color:#6d7175;font-size:14px;line-height:1.5;">' +
      'Nothing to preview yet — add questions to your draft and this phone will come to life.</div>';
  }

  function previewUsable() {
    return config && flow && flow.configured && Array.isArray(flow.questions) && flow.questions.length > 0;
  }

  function activateQuiz() {
    buildScreens();
    detectThemeTypography();
    applyStyleConfig();
    root.innerHTML = '';
    root.classList.add('gq-active');
    stageEl = el('div', 'gq-stage');
    root.appendChild(stageEl);
  }

  function initPreviewListener() {
    window.addEventListener('message', function(ev) {
      var d = ev.data || {};
      if (d.type === 'gleame-preview-goto') {
        previewGoto(d.step);
      } else if (d.type === 'gleame-preview-update') {
        if (d.config) config = d.config;
        if (d.flow) flow = d.flow;
        if (d.sampleRecommend) PREVIEW.sampleRecommend = d.sampleRecommend;
        if (d.productJson) PREVIEW.productJson = d.productJson;
        if (!previewUsable()) {
          stageEl = null;
          renderPreviewPlaceholder();
          return;
        }
        if (!stageEl) {
          // The initial boot bailed (draft had no questions then) — the
          // stage doesn't exist, so run the full activation now.
          activateQuiz();
          state.screen = 'intro';
          state.screenIndex = 0;
        }
        buildScreens();
        applyStyleConfig();
        var clamped = clampStep({ screen: state.screen, screenIndex: state.screenIndex || 0 });
        state.screen = clamped.screen;
        state.screenIndex = clamped.screenIndex || 0;
        replaceStep();
        render('forward');
      }
    });
  }

  function init() {
    Promise.all([
      PREVIEW
        ? Promise.resolve(PREVIEW.config)
        : fetch(SHOPIFY_APP_URL + '/api/storefront/quiz-config?shopDomain=' + encodeURIComponent(shopDomain))
            .then(function(res) { return res.json(); })
            .catch(function() { return null; }),
      PREVIEW
        ? Promise.resolve(PREVIEW.flow)
        : fetch(SHOPIFY_APP_URL + '/api/storefront/recommendation-config?shopDomain=' + encodeURIComponent(shopDomain))
            .then(function(res) { return res.ok ? res.json() : null; })
            .catch(function() { return null; }),
    ]).then(function(results) {
      config = results[0];
      flow = results[1];
      if (PREVIEW) initPreviewListener();
      if (!config || !config.enabled) {               // quiz mode off — section stays empty
        if (PREVIEW) renderPreviewPlaceholder();      // previews explain themselves instead
        return;
      }
      if (!flow || !flow.configured || !Array.isArray(flow.questions) || flow.questions.length === 0) {
        if (PREVIEW) renderPreviewPlaceholder();
        return;
      }

      activateQuiz();

      // Restore an in-flight session (per-tab). Photos don't survive a
      // refresh by design; results re-render in product-image mode.
      var saved = loadState();
      // Answers are stored positionally (parallel to flow.questions): if
      // the merchant reordered, replaced, or removed questions since this
      // session was saved, answer i may no longer belong to question i and
      // would feed garbage criteria into quiz-recommend. Any axis mismatch
      // invalidates the WHOLE restore; the shopper starts fresh.
      if (saved && saved.screen) {
        var savedAnswers = Array.isArray(saved.answers) ? saved.answers : [];
        for (var ai = 0; ai < savedAnswers.length; ai++) {
          if (!savedAnswers[ai]) continue;
          if (!flow.questions[ai] || savedAnswers[ai].axisKey !== flow.questions[ai].axisKey) {
            clearState();
            saved = null;
            break;
          }
        }
      }
      if (saved && saved.screen) {
        state = saved;
        state.hasPhoto = false; // File is gone — never persisted
        // A results screen restored without matches can't render; rewind
        // to the gate so the shopper takes one step, not five.
        if (state.screen === 'results' && (!state.matches || state.matches.length === 0)) {
          state.screen = 'gate';
        }
        // Guard restored indices against a changed question set — clampStep
        // covers both a shorter quiz and answers invalidated by edits.
        // No truncation here: restored answers stay so the landed screen
        // re-renders the shopper's selections (commit truncates on change).
        var restored = clampStep({ screen: state.screen, screenIndex: state.screenIndex || 0 });
        state.screen = restored.screen;
        state.screenIndex = restored.screenIndex || 0;
      }

      replaceStep();
      window.addEventListener('popstate', onPopState);
      render('forward');
      trackEvent('quiz_view');
    });
  }

  window.gleameQuiz = window.gleameQuiz || {};
  window.gleameQuiz.clearState = clearState;
  window.gleameQuiz.restart = restartQuiz;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
