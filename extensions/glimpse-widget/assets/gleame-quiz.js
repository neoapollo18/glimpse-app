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
  var STORAGE_KEY = 'gleame-quiz-state-v1';
  var TRYON_SESSION_CAP = 10;

  var root = document.getElementById('gleame-quiz-root');
  if (!root) return;

  var shopDomain = root.getAttribute('data-shop-domain') || '';
  if (!shopDomain) {
    if (window.Shopify && window.Shopify.shop) shopDomain = window.Shopify.shop;
    else shopDomain = window.location.hostname;
  }

  // ---- Module state ----
  var config = null;   // quiz-config payload
  var flow = null;     // recommendation-config payload
  var stageEl = null;
  var quizStarted = false;

  // Persisted (sessionStorage) — everything EXCEPT images.
  var state = {
    screen: 'intro',        // 'intro' | 'question' | 'gate' | 'results'
    questionIndex: 0,       // current question when screen === 'question'
    criteria: {},           // axisKey -> axisValue
    answers: [],            // parallel to flow.questions: {axisKey, axisValue, label} | undefined
    hasPhoto: false,        // photo was provided this session (File itself is NOT persisted)
    detectedShade: null,    // {axisKey, value, label, source: 'photo'|'manual'}
    matches: null,          // quiz-recommend matches (no images — safe to persist)
    matrixApplied: false,
    partial: false,
  };

  // Memory only — the "never stored" promise.
  var photoFile = null;
  var photoObjectUrl = null;
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
    var formData = new FormData();
    formData.append('id', String(variantId));
    formData.append('quantity', String(quantity || 1));
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
        return body;
      });
    });
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
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, s: state }));
    } catch (e) { /* quota / private mode — quiz still works, just won't survive nav */ }
  }

  function loadState() {
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
  }

  // ---- History / step routing ----
  //
  // Every forward transition pushes a #gq-* hash entry; the quiz's Back
  // control is literally history.back(), so browser back and UI back are
  // one code path (the popstate handler).

  function stepSlug() {
    if (state.screen === 'question') return 'q' + (state.questionIndex + 1);
    return state.screen;
  }

  function pushStep() {
    try {
      history.pushState({ gq: { screen: state.screen, questionIndex: state.questionIndex } },
        '', '#gq-' + stepSlug());
    } catch (e) {}
  }

  function replaceStep() {
    try {
      history.replaceState({ gq: { screen: state.screen, questionIndex: state.questionIndex } },
        '', '#gq-' + stepSlug());
    } catch (e) {}
  }

  // Rewind answers/criteria when navigating back to an earlier step. Answers
  // at index >= keepCount are undone (their axis removed from criteria).
  function truncateAnswers(keepCount) {
    for (var i = keepCount; i < state.answers.length; i++) {
      var a = state.answers[i];
      if (a && a.axisKey) delete state.criteria[a.axisKey];
    }
    state.answers.length = Math.min(state.answers.length, keepCount);
  }

  // History entries can outlive the state that made them valid: Back pops
  // an answer out of criteria but the Forward entry survives, and "Start
  // over" resets state while old gate/question entries remain below. Clamp
  // every popped target to what the current answers actually support, so a
  // stale entry can never reach the gate/results with a criteria hole.
  function clampStep(target) {
    var total = flow.questions.length;
    var answered = state.answers.length; // answers is always a contiguous prefix

    if (target.screen === 'results' &&
        !(answered >= total && Array.isArray(state.matches) && state.matches.length > 0)) {
      target = { screen: 'gate', questionIndex: 0 };
    }
    if (target.screen === 'gate' && answered < total) {
      target = { screen: 'question', questionIndex: answered };
    }
    if (target.screen === 'question') {
      var idx = target.questionIndex || 0;
      if (idx > answered) idx = answered;            // can't skip unanswered questions
      if (idx >= total) idx = total - 1;
      if (idx <= 0) return { screen: 'intro', questionIndex: 0 }; // q0 lives on the intro
      target = { screen: 'question', questionIndex: idx };
    }
    return target;
  }

  function onPopState(e) {
    var target = e.state && e.state.gq;
    if (!target) {
      // Entry state (before our first pushState) — only relevant if the
      // hash still looks like ours; otherwise the user navigated away.
      if ((location.hash || '').indexOf('#gq-') !== 0) return;
      target = { screen: 'intro', questionIndex: 0 };
    }
    var original = target;
    target = clampStep(target);
    state.screen = target.screen;
    state.questionIndex = target.questionIndex || 0;
    if (state.screen === 'intro') truncateAnswers(0);
    else if (state.screen === 'question') truncateAnswers(state.questionIndex);
    // If the popped entry was stale, rewrite it in place so Forward from
    // here lands on the corrected step too.
    if (target.screen !== original.screen || (target.questionIndex || 0) !== (original.questionIndex || 0)) {
      replaceStep();
    }
    saveState();
    render('back');
  }

  // ---- API calls ----

  function quizRecommend() {
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
    return String(match.productId || '') + '|' + String(match.variantId || '');
  }

  function requestTryon(match) {
    var key = matchKey(match);
    if (!photoFile) return Promise.resolve(null);
    if (tryonCache[key]) return Promise.resolve(tryonCache[key]);
    if (tryonPending[key]) return tryonPending[key];
    if (tryonCount >= TRYON_SESSION_CAP) return Promise.resolve(null);
    tryonCount++;

    var fd = new FormData();
    fd.append('image', photoFile);
    fd.append('shopDomain', shopDomain);
    fd.append('productId', match.productId);
    if (match.variantId) fd.append('variantId', match.variantId);

    var p = fetch(SHOPIFY_APP_URL + '/api/storefront/quiz-tryon', {
      method: 'POST',
      body: fd,
    }).then(function(res) {
      if (res.status === 429) return { rateLimited: true };
      if (!res.ok) return null;
      return res.json();
    }).then(function(data) {
      delete tryonPending[key];
      if (data && data.rateLimited) return { rateLimited: true };
      if (data && data.tryOnPreview) {
        tryonCache[key] = data.tryOnPreview;
        return data.tryOnPreview;
      }
      return null;
    }).catch(function() {
      delete tryonPending[key];
      return null;
    });
    tryonPending[key] = p;
    return p;
  }

  // ---- Shade axis helpers ----

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
      case 'question': next = renderQuestion(); break;
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

  function totalSteps() {
    return (flow && flow.questions ? flow.questions.length : 0) + 1; // + try-on gate
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  // -- Intro (landing + question 1 inline) --

  function renderIntro() {
    var landing = config.landing || {};
    var screen = el('div', 'gq-intro');

    var main = el('div', 'gq-intro-main');
    var copy = el('div', 'gq-intro-copy');
    if (landing.eyebrow) copy.appendChild(el('p', 'gq-eyebrow', escapeHtml(landing.eyebrow)));
    copy.appendChild(el('h2', 'gq-headline', escapeHtml(landing.headline || '')));
    if (landing.subtext) copy.appendChild(el('p', 'gq-subtext', escapeHtml(landing.subtext)));

    // Question 1, inline on the landing.
    var q0 = flow && flow.questions && flow.questions[0];
    if (q0) {
      var qWrap = el('div', 'gq-intro-question');
      qWrap.appendChild(el('h3', 'gq-intro-question-title', escapeHtml(q0.prompt)));
      var cards = el('div', 'gq-option-cards');
      q0.options.forEach(function(opt, i) {
        var btn = el('button', 'gq-option-card', escapeHtml(opt.label));
        btn.type = 'button';
        btn.style.setProperty('--gq-stagger', i);
        btn.onclick = function() { answerQuestion(0, opt, btn); };
        cards.appendChild(btn);
      });
      qWrap.appendChild(cards);
      copy.appendChild(qWrap);
    } else {
      var empty = el('p', 'gq-subtext', 'This quiz isn’t configured yet.');
      copy.appendChild(empty);
    }

    if (landing.altAudienceLabel && landing.altAudienceUrl) {
      var alt = el('p', 'gq-alt-audience');
      var altLink = el('a', 'gq-alt-audience-link', escapeHtml(landing.altAudienceLabel) + ' →');
      altLink.href = landing.altAudienceUrl;
      alt.appendChild(altLink);
      copy.appendChild(alt);
    }
    main.appendChild(copy);

    // Before/after visual (desktop side panel).
    if (landing.beforeImageUrl || landing.afterImageUrl) {
      var visual = el('div', 'gq-intro-visual');
      var frames = el('div', 'gq-ba-frames');
      if (landing.beforeImageUrl) {
        var b = el('figure', 'gq-ba-frame');
        b.appendChild(el('span', 'gq-ba-tag', 'Before'));
        var bImg = el('img', 'gq-ba-img');
        bImg.src = landing.beforeImageUrl; bImg.alt = 'Before'; bImg.loading = 'lazy';
        b.appendChild(bImg);
        frames.appendChild(b);
      }
      if (landing.afterImageUrl) {
        var a = el('figure', 'gq-ba-frame gq-ba-frame-after');
        a.appendChild(el('span', 'gq-ba-tag gq-ba-tag-after', 'After'));
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

  // -- Question step --

  function renderQuestion() {
    var i = state.questionIndex;
    var q = flow.questions[i];
    var screen = el('div', 'gq-step');
    if (!q) return screen;

    screen.appendChild(buildStepHeader(i + 1));

    var body = el('div', 'gq-step-body');
    body.appendChild(el('h2', 'gq-question-title', escapeHtml(q.prompt)));
    if (q.helperText) body.appendChild(el('p', 'gq-question-helper', escapeHtml(q.helperText)));

    var list = el('div', 'gq-option-list');
    q.options.forEach(function(opt, idx) {
      var btn = el('button', 'gq-option', '<span>' + escapeHtml(opt.label) + '</span>' +
        '<svg class="gq-option-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>');
      btn.type = 'button';
      btn.style.setProperty('--gq-stagger', idx);
      var prev = state.answers[i];
      if (prev && prev.axisValue === opt.axisValue) btn.classList.add('is-selected');
      btn.onclick = function() { answerQuestion(i, opt, btn); };
      list.appendChild(btn);
    });
    body.appendChild(list);
    screen.appendChild(body);
    return screen;
  }

  function buildStepHeader(stepNumber) {
    var header = el('div', 'gq-step-header');
    var back = el('button', 'gq-back',
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg><span>Back</span>');
    back.type = 'button';
    back.onclick = function() { history.back(); };
    header.appendChild(back);
    header.appendChild(el('span', 'gq-step-count', stepNumber + ' of ' + totalSteps()));
    var track = el('div', 'gq-progress');
    var fill = el('div', 'gq-progress-fill');
    fill.style.width = Math.round((stepNumber / totalSteps()) * 100) + '%';
    track.appendChild(fill);
    header.appendChild(track);
    return header;
  }

  function answerQuestion(qIndex, opt, btn) {
    var q = flow.questions[qIndex];
    if (!q) return;
    if (btn) {
      var siblings = btn.parentNode.querySelectorAll('.is-selected');
      for (var s = 0; s < siblings.length; s++) siblings[s].classList.remove('is-selected');
      btn.classList.add('is-selected');
    }
    truncateAnswers(qIndex);
    state.criteria[q.axisKey] = opt.axisValue;
    state.answers[qIndex] = { axisKey: q.axisKey, axisValue: opt.axisValue, label: opt.label };

    if (!quizStarted) { quizStarted = true; trackEvent('quiz_start'); }
    trackEvent('quiz_question_answered');

    // Small selected-state beat before advancing — the tap should feel
    // acknowledged, not teleporting.
    setTimeout(function() {
      if (qIndex + 1 < flow.questions.length) {
        state.screen = 'question';
        state.questionIndex = qIndex + 1;
      } else {
        state.screen = 'gate';
        trackEvent('quiz_gate_view');
      }
      saveState();
      pushStep();
      render('forward');
    }, 220);
  }

  // -- Try-on gate (last numbered step) --

  function renderGate() {
    var gate = config.gate || {};
    var screen = el('div', 'gq-step');
    screen.appendChild(buildStepHeader(totalSteps()));

    var body = el('div', 'gq-step-body');
    body.appendChild(el('h2', 'gq-question-title', escapeHtml(gate.headline || 'Want to see it on you?')));
    if (gate.helper) body.appendChild(el('p', 'gq-question-helper', escapeHtml(gate.helper)));

    var actions = el('div', 'gq-gate-actions');

    var photoBtn = el('button', 'gq-gate-photo',
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>' +
      '<span class="gq-gate-photo-label">' + escapeHtml(gate.photoLabel || 'Show my match on me') + '</span>' +
      (gate.privacyNote ? '<span class="gq-gate-privacy">' + escapeHtml(gate.privacyNote) + '</span>' : ''));
    photoBtn.type = 'button';
    photoBtn.onclick = function() { openPhotoCapture(screen); };
    actions.appendChild(photoBtn);

    var skipBtn = el('button', 'gq-gate-skip', escapeHtml(gate.skipLabel || 'Just take me to my results'));
    skipBtn.type = 'button';
    skipBtn.onclick = function() {
      trackEvent('quiz_photo_skip');
      goToResults(screen);
    };
    actions.appendChild(skipBtn);

    body.appendChild(actions);
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

  function validPhoto(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('image/') !== 0) return false;
    if (file.size > 5 * 1024 * 1024) return false;
    return true;
  }

  function onPhotoChosen(file, screenEl, onDone) {
    if (!validPhoto(file)) return;
    photoFile = file;
    if (photoObjectUrl) { try { URL.revokeObjectURL(photoObjectUrl); } catch (e) {} }
    photoObjectUrl = URL.createObjectURL(file);
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

    var classify = needsShade
      ? quizShade(file).then(function(res) {
          var v = res && res.values && res.values[axis.key];
          if (v) {
            state.criteria[axis.key] = v;
            state.detectedShade = {
              axisKey: axis.key,
              value: v,
              label: (res.labels && res.labels[axis.key]) || shadeLabelFor(v),
              source: 'photo',
            };
            trackEvent('quiz_shade_detected');
          }
        })
      : Promise.resolve();

    classify.then(function() {
      if (onDone) return onDone();
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
  function rerunWithShade() {
    quizRecommend()
      .then(function(data) {
        state.matches = (data && data.matches) || [];
        state.matrixApplied = Boolean(data && data.matrixApplied);
        state.partial = Boolean(data && data.partial);
        saveState();
        render('forward');
      })
      .catch(function() { render('forward'); });
  }

  // -- Results --

  function renderResults() {
    var results = config.results || {};
    var matches = Array.isArray(state.matches) ? state.matches : [];
    var hasPhotoNow = state.hasPhoto && Boolean(photoFile);
    // Partial = the shade axis is still unresolved and the server collapsed
    // matches to product level. The card is provisional: no add-to-bag, no
    // variant try-on, no "also matched" — the shade gate below is the one
    // action. This applies on the photo path too (shade classification can
    // fail), not just when the shopper skipped the photo.
    var definitive = !state.partial;
    var showTryon = hasPhotoNow && definitive;
    var screen = el('div', showTryon ? 'gq-results gq-results--split' : 'gq-results');

    var headline = showTryon
      ? (results.headlinePhoto || "Here's your match — on you")
      : (results.headlineNoPhoto || 'We found your fit');

    var head = el('div', 'gq-results-head');
    head.appendChild(el('p', 'gq-eyebrow', escapeHtml('Your perfect fit')));
    head.appendChild(el('h2', 'gq-headline', escapeHtml(headline)));
    screen.appendChild(head);

    if (matches.length === 0) {
      var none = el('div', 'gq-error',
        '<p>We couldn’t find a match this time — try adjusting your answers.</p>');
      var restart = el('button', 'gq-retry', 'Start over');
      restart.type = 'button';
      restart.onclick = restartQuiz;
      none.appendChild(restart);
      screen.appendChild(none);
      return screen;
    }

    var hero = matches[0];
    var others = matches.slice(1);
    var grid = el('div', 'gq-results-grid');

    // Left: try-on panel (photo sessions with a resolved match only).
    if (showTryon) {
      grid.appendChild(buildTryonPanel(hero, results));
    }

    // Right (or full-width): cards column.
    var col = el('div', 'gq-results-col');
    col.appendChild(buildHeroCard(hero, results, definitive));

    // Shade gate: shown whenever the match is provisional, photo or not —
    // a failed classification needs the manual picker just as much as a
    // skipped photo does.
    if (state.partial && shadeAxis()) {
      col.appendChild(buildShadeGate());
    }

    if (others.length > 0 && definitive) {
      var alsoWrap = el('div', 'gq-also');
      alsoWrap.appendChild(el('p', 'gq-also-label', escapeHtml(results.alsoMatchedLabel || 'Also matched for you')));
      others.forEach(function(m) { alsoWrap.appendChild(buildAlsoCard(m, results)); });
      col.appendChild(alsoWrap);
    }

    grid.appendChild(col);
    screen.appendChild(grid);

    // Sticky mobile add-to-bag mirroring the hero CTA — resolved matches only.
    if (matches.length > 0 && definitive) screen.appendChild(buildStickyBar(hero, results));

    return screen;
  }

  function buildTryonPanel(hero, results) {
    var panel = el('div', 'gq-tryon-panel');
    var frame = el('div', 'gq-tryon-frame');
    frame.appendChild(el('span', 'gq-tryon-chip', 'You + your match'));

    var img = el('img', 'gq-tryon-img gq-tryon-img--pending');
    img.alt = 'Your match, on you';
    frame.appendChild(img);
    frame.appendChild(el('div', 'gq-tryon-shimmer'));

    // Before thumbnail from the in-memory photo.
    if (photoObjectUrl) {
      var thumb = el('img', 'gq-tryon-before');
      thumb.src = photoObjectUrl;
      thumb.alt = 'Your photo';
      frame.appendChild(thumb);
    }
    panel.appendChild(frame);

    var foot = el('div', 'gq-tryon-foot');
    var retake = el('button', 'gq-link-btn', escapeHtml(results.retakeLabel || 'Retake photo'));
    retake.type = 'button';
    retake.onclick = function() {
      trackEvent('quiz_retake_photo');
      openPhotoCapture(null, function() { rerunWithShade(); });
    };
    foot.appendChild(retake);
    panel.appendChild(foot);

    // Kick off the hero try-on immediately; blur-up reveal when it lands.
    requestTryon(hero).then(function(result) {
      if (!result || result.rateLimited) {
        // Soft-fail: keep the product image as the panel visual.
        var pjPromise = fetchProductJson(hero.productHandle);
        pjPromise.then(function(pj) {
          var src = imageForRec(pj, hero);
          if (src) { img.src = src; img.classList.remove('gq-tryon-img--pending'); }
          frame.classList.add('gq-tryon-frame--done');
        });
        return;
      }
      img.src = 'data:image/jpeg;base64,' + result;
      img.onload = function() {
        img.classList.remove('gq-tryon-img--pending');
        frame.classList.add('gq-tryon-frame--done');
        trackEvent('quiz_tryon_shown');
      };
    });

    return panel;
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
    var t = template || 'Add {count} to bag · {total}';
    return t
      .replace(/\{count\}/g, String(quantity))
      .replace(/\{set_word\}/g, quantity === 1 ? 'set' : 'sets')
      .replace(/\{total\}/g, totalCents != null ? formatMoney(totalCents) : '');
  }

  function buildHeroCard(hero, results, definitive) {
    var card = el('div', 'gq-card gq-card--hero');
    var head = el('div', 'gq-card-head');
    head.appendChild(el('h3', 'gq-card-title', escapeHtml(hero.title || hero.productName)));
    head.appendChild(el('span', 'gq-pill', escapeHtml(results.bestMatchPill || 'Best match')));
    card.appendChild(head);

    // Shade line with swatch dot.
    var shade = shadeReasonLine();
    if (shade) {
      var shadeLine = el('p', 'gq-shade-line');
      if (shade.swatch) {
        var dot = el('span', 'gq-shade-dot');
        dot.style.background = shade.swatch;
        shadeLine.appendChild(dot);
      }
      shadeLine.appendChild(document.createTextNode(shade.label + ' — ' + shade.source));
      card.appendChild(shadeLine);
    }

    // Reason bullets.
    if (Array.isArray(hero.reasons) && hero.reasons.length > 0) {
      var ul = el('ul', 'gq-reasons');
      hero.reasons.forEach(function(r) {
        var li = el('li', 'gq-reason');
        li.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
          '<span>' + escapeHtml(r) + '</span>';
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    if (hero.tagline) card.appendChild(el('p', 'gq-tagline', escapeHtml(hero.tagline)));

    // CTA row — price resolved from the storefront. Provisional (partial)
    // matches get no add-to-bag at all: the specific variant isn't known
    // yet, and the shade gate below the card is the intended action.
    if (definitive) {
      var addBtn = el('button', 'gq-add-btn', escapeHtml(buildAddLabel(results.addButtonTemplate, hero.quantity || 1, null)));
      addBtn.type = 'button';
      addBtn.disabled = true;
      card.appendChild(addBtn);

      fetchProductJson(hero.productHandle).then(function(pj) {
        var unit = priceCentsForRec(pj, hero);
        var qty = Math.max(1, hero.quantity || 1);
        var cartVariant = variantIdForCart(pj, hero);
        addBtn.textContent = buildAddLabel(results.addButtonTemplate, qty, unit != null ? unit * qty : null);
        if (!cartVariant) return; // leave disabled — nothing addable
        addBtn.disabled = false;
        wireAddButton(addBtn, cartVariant, qty);
      });
    }

    var view = el('a', 'gq-view-link', escapeHtml(results.viewProductLabel || 'View full product') + ' →');
    view.href = '/products/' + encodeURIComponent(hero.productHandle) +
      (hero.variantNumericId ? '?variant=' + encodeURIComponent(hero.variantNumericId) : '');
    view.onclick = function() { trackEvent('quiz_view_product'); saveState(); };
    card.appendChild(view);

    return card;
  }

  function buildAlsoCard(m, results) {
    var card = el('div', 'gq-card gq-card--also');
    var media = el('div', 'gq-also-media');
    var img = el('img', 'gq-also-img');
    img.alt = m.title || m.productName;
    img.loading = 'lazy';
    media.appendChild(img);
    card.appendChild(media);

    var body = el('div', 'gq-also-body');
    var title = el('a', 'gq-also-title', escapeHtml(m.title || m.productName));
    title.href = '/products/' + encodeURIComponent(m.productHandle) +
      (m.variantNumericId ? '?variant=' + encodeURIComponent(m.variantNumericId) : '');
    title.onclick = function() { trackEvent('quiz_view_product'); saveState(); };
    body.appendChild(title);
    var priceLine = el('p', 'gq-also-price', '');
    body.appendChild(priceLine);
    if (m.tagline) body.appendChild(el('p', 'gq-also-tagline', escapeHtml(m.tagline)));

    // On-demand try-on for secondary cards.
    if (state.hasPhoto && photoFile) {
      var seeBtn = el('button', 'gq-link-btn gq-see-btn', 'See it on you');
      seeBtn.type = 'button';
      seeBtn.onclick = function() {
        seeBtn.disabled = true;
        seeBtn.textContent = 'Working…';
        requestTryon(m).then(function(result) {
          if (result && !result.rateLimited) {
            img.src = 'data:image/jpeg;base64,' + result;
            media.classList.add('gq-also-media--tryon');
            seeBtn.textContent = 'That’s you ✨';
            trackEvent('quiz_tryon_secondary');
          } else {
            seeBtn.disabled = false;
            seeBtn.textContent = result && result.rateLimited
              ? 'One moment — try again shortly'
              : 'See it on you';
          }
        });
      };
      body.appendChild(seeBtn);
    }
    card.appendChild(body);

    var addBtn = el('button', 'gq-also-add', 'Add');
    addBtn.type = 'button';
    addBtn.disabled = true;
    card.appendChild(addBtn);

    fetchProductJson(m.productHandle).then(function(pj) {
      var unit = priceCentsForRec(pj, m);
      var src = imageForRec(pj, m);
      if (src) img.src = src;
      if (unit != null) priceLine.textContent = formatMoney(unit);
      var cartVariant = variantIdForCart(pj, m);
      if (!cartVariant) return;
      addBtn.disabled = false;
      wireAddButton(addBtn, cartVariant, Math.max(1, m.quantity || 1), true);
    });

    return card;
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
          btn.textContent = compact ? 'Added ✓' : 'Added to bag ✓';
          refreshCartToken().then(function() { trackEvent('quiz_add_to_cart'); });
          setTimeout(function() {
            btn.classList.remove('is-added');
            btn.textContent = original;
            btn.disabled = false;
          }, 3200);
        })
        .catch(function() {
          btn.classList.remove('is-working');
          btn.textContent = 'Couldn’t add — try again';
          setTimeout(function() {
            btn.textContent = original;
            btn.disabled = false;
          }, 2600);
        });
    };
  }

  // Shade gate ("Now let's nail your shade") for no-photo partial results.
  function buildShadeGate() {
    var sg = config.shadeGate || {};
    var axis = shadeAxis();
    var wrap = el('div', 'gq-shade-gate');
    wrap.appendChild(el('h3', 'gq-shade-headline', escapeHtml(sg.headline || "Now let's nail your shade")));
    if (sg.body) wrap.appendChild(el('p', 'gq-shade-body', escapeHtml(sg.body)));

    // Path 1 — photo.
    var photoBtn = el('button', 'gq-shade-photo-btn',
      '<span class="gq-shade-photo-label">' + escapeHtml(sg.ctaPhoto || 'Match my shade for me') + '</span>' +
      '<span class="gq-shade-photo-sub">' + escapeHtml((config.gate && config.gate.privacyNote) || 'Processed instantly · never stored') + '</span>');
    photoBtn.type = 'button';
    photoBtn.onclick = function() {
      openPhotoCapture(null, function() { rerunWithShade(); });
    };
    wrap.appendChild(photoBtn);

    // Path 2 — manual swatch row.
    var manual = el('div', 'gq-shade-manual');
    manual.appendChild(el('p', 'gq-shade-manual-label', escapeHtml(sg.ctaManual || 'I know my shade')));
    var dots = el('div', 'gq-shade-dots');
    (axis ? axis.values : []).forEach(function(v) {
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
        rerunWithShade();
      };
      dots.appendChild(dot);
    });
    manual.appendChild(dots);
    wrap.appendChild(manual);
    return wrap;
  }

  function buildStickyBar(hero, results) {
    var bar = el('div', 'gq-sticky-bar');
    var btn = el('button', 'gq-add-btn gq-add-btn--sticky', escapeHtml(buildAddLabel(results.addButtonTemplate, hero.quantity || 1, null)));
    btn.type = 'button';
    btn.disabled = true;
    bar.appendChild(btn);
    fetchProductJson(hero.productHandle).then(function(pj) {
      var unit = priceCentsForRec(pj, hero);
      var qty = Math.max(1, hero.quantity || 1);
      var cartVariant = variantIdForCart(pj, hero);
      btn.textContent = buildAddLabel(results.addButtonTemplate, qty, unit != null ? unit * qty : null);
      if (!cartVariant) return;
      btn.disabled = false;
      wireAddButton(btn, cartVariant, qty);
    });
    return bar;
  }

  function restartQuiz() {
    state = {
      screen: 'intro', questionIndex: 0, criteria: {}, answers: [],
      hasPhoto: false, detectedShade: null, matches: null,
      matrixApplied: false, partial: false,
    };
    photoFile = null;
    if (photoObjectUrl) { try { URL.revokeObjectURL(photoObjectUrl); } catch (e) {} photoObjectUrl = null; }
    tryonCache = {};
    tryonCount = 0;
    quizStarted = false; // the restarted run gets its own quiz_start event
    clearState();
    replaceStep();
    render('back');
  }

  // ---- Boot ----

  function init() {
    Promise.all([
      fetch(SHOPIFY_APP_URL + '/api/storefront/quiz-config?shopDomain=' + encodeURIComponent(shopDomain))
        .then(function(res) { return res.json(); })
        .catch(function() { return null; }),
      fetch(SHOPIFY_APP_URL + '/api/storefront/recommendation-config?shopDomain=' + encodeURIComponent(shopDomain))
        .then(function(res) { return res.ok ? res.json() : null; })
        .catch(function() { return null; }),
    ]).then(function(results) {
      config = results[0];
      flow = results[1];
      if (!config || !config.enabled) return;          // quiz mode off — section stays empty
      if (!flow || !flow.configured || !Array.isArray(flow.questions) || flow.questions.length === 0) return;

      detectThemeTypography();
      applyStyleConfig();

      root.innerHTML = '';
      root.classList.add('gq-active');
      stageEl = el('div', 'gq-stage');
      root.appendChild(stageEl);

      // Restore an in-flight session (per-tab). Photos don't survive a
      // refresh by design; results re-render in product-image mode.
      var saved = loadState();
      if (saved && saved.screen) {
        state = saved;
        state.hasPhoto = false; // File is gone — never persisted
        // A results screen restored without matches can't render; rewind
        // to the gate so the shopper takes one step, not five.
        if (state.screen === 'results' && (!state.matches || state.matches.length === 0)) {
          state.screen = 'gate';
        }
        // Guard restored indices against a changed question set.
        if (state.screen === 'question' && state.questionIndex >= flow.questions.length) {
          state.screen = 'intro';
          state.questionIndex = 0;
          truncateAnswers(0);
        }
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
