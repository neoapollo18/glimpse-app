// Gleame AI Chat Assistant v1.0
// Global app embed — floating chat bubble + recommendation flow
console.log('Gleame Chat Assistant v1.0 loaded');

(function() {
  'use strict';

  window.gleameChat = window.gleameChat || {};

  var SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  var STORAGE_KEY = 'gleame-chat-state-v1';
  var root = document.getElementById('gleame-chat-root');
  if (!root) return;

  var shopDomain = root.getAttribute('data-shop-domain') || '';
  if (!shopDomain) {
    if (window.Shopify && window.Shopify.shop) shopDomain = window.Shopify.shop;
    else shopDomain = window.location.hostname;
  }

  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /Mobi/.test(navigator.userAgent));
  }

  // The chat panel goes fullscreen at <= 600px wide; we lock body scroll only
  // when the panel actually covers the viewport. Using a viewport check (not
  // the UA) keeps narrow desktop windows behaving like phones.
  function isPanelFullscreen() {
    return window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
  }

  function lockBodyScroll() {
    if (!isPanelFullscreen()) return;
    if (document.documentElement.classList.contains('gleame-chat-no-scroll')) return;
    // Remember the scroll position so we can restore it after unlocking.
    var scrollY = window.scrollY || window.pageYOffset || 0;
    document.body.setAttribute('data-gleame-chat-scroll-y', String(scrollY));
    document.body.style.top = '-' + scrollY + 'px';
    document.documentElement.classList.add('gleame-chat-no-scroll');
    document.body.classList.add('gleame-chat-no-scroll');
  }

  function unlockBodyScroll() {
    if (!document.documentElement.classList.contains('gleame-chat-no-scroll')) return;
    document.documentElement.classList.remove('gleame-chat-no-scroll');
    document.body.classList.remove('gleame-chat-no-scroll');
    var saved = parseInt(document.body.getAttribute('data-gleame-chat-scroll-y') || '0', 10);
    document.body.style.top = '';
    document.body.removeAttribute('data-gleame-chat-scroll-y');
    if (saved) window.scrollTo(0, saved);
  }

  // ---- Persisted state ----
  // messages: array of { type, ...payload }
  //   bot-text       { type, text }
  //   user-text      { type, text }
  //   user-image     { type, thumb } (small JPEG thumbnail persisted so the
  //                  photo survives navigation; the full dataUrl is not)
  //   bot-buttons    { type, buttons: [{label, action}], consumed: boolean }
  //   bot-upload     { type, consumed: boolean }
  //   bot-cards      { type, recommendations: [...] }
  var messages = [];
  var isOpen = false;
  var panelExpanded = false;
  var greetingDismissed = false;
  var conversationEnded = false;
  var preference = null;
  var pendingRequest = false;
  var heroDismissed = false;
  // Multi-question matrix flow: criteria builds up as user answers, sent
  // with the photo to /chat-recommend so the server can do a matrix lookup
  // instead of having the LLM pick variants.
  var criteria = {};
  // Index into recommendationFlow.questions for the next question to ask.
  // Restored from session to survive page nav mid-conversation.
  var questionIndex = 0;

  // ---- Session-only state ----
  var config = null;
  var recommendationFlow = null; // { questions, photoAxes, configured }
  var greetingShown = false;
  var inFlightRequest = null;
  var heroEl = null;
  var heroShown = false;
  // When recommendations are shown, anchor the scroll to the message right
  // before the cards (the "Here's what I found" bot-text) so the user lands
  // on the FIRST product and scrolls top → bottom, not bottom → top.
  var cardsAnchorEl = null;

  // ---- DOM refs ----
  var bubble = null;
  var greetingEl = null;
  var panel = null;
  var messagesContainer = null;
  var expandBtn = null;
  var expandSvgStr = '';
  var shrinkSvgStr = '';

  // ---- Persistence ----
  function saveState() {
    try {
      var serialisable = messages.map(function(m) {
        // Persist only the small thumbnail of the shopper's photo — the
        // full-size dataUrl stays transient.
        if (m.type === 'user-image') return { type: 'user-image', thumb: m.thumb || null };
        return m;
      });
      var state = {
        v: 1,
        messages: serialisable,
        isOpen: isOpen,
        panelExpanded: panelExpanded,
        greetingDismissed: greetingDismissed,
        conversationEnded: conversationEnded,
        preference: preference,
        pendingRequest: pendingRequest,
        heroDismissed: heroDismissed,
        criteria: criteria,
        questionIndex: questionIndex,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Quota exceeded — try a stripped version without product card images
      try {
        var stripped = messages.map(function(m) {
          if (m.type === 'user-image') return { type: 'user-image' };
          if (m.type === 'bot-cards') {
            return {
              type: 'bot-cards',
              recommendations: (m.recommendations || []).map(function(r) {
                return {
                  productId: r.productId,
                  variantId: r.variantId,
                  productHandle: r.productHandle,
                  variantNumericId: r.variantNumericId,
                  productName: r.productName,
                  variantTitle: r.variantTitle,
                  title: r.title,
                  // tryOnPreview omitted to fit in storage
                };
              }),
            };
          }
          return m;
        });
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          v: 1,
          messages: stripped,
          isOpen: isOpen,
          panelExpanded: panelExpanded,
          greetingDismissed: greetingDismissed,
          conversationEnded: conversationEnded,
          preference: preference,
          pendingRequest: pendingRequest,
          heroDismissed: heroDismissed,
          criteria: criteria,
          questionIndex: questionIndex,
        }));
      } catch (e2) {
        // Give up silently
      }
    }
  }

  function loadState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearState() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // ---- Init ----
  // Fetches both endpoints in parallel: chat-config controls the widget
  // itself, recommendation-config drives the multi-question matrix flow.
  // The widget works even if recommendation-config is empty — falls back
  // to the legacy single-preference flow from chatConfig.
  function init() {
    Promise.all([
      fetch(SHOPIFY_APP_URL + '/api/storefront/chat-config?shopDomain=' + encodeURIComponent(shopDomain))
        .then(function(res) { return res.json(); }),
      fetch(SHOPIFY_APP_URL + '/api/storefront/recommendation-config?shopDomain=' + encodeURIComponent(shopDomain))
        .then(function(res) { return res.ok ? res.json() : null; })
        .catch(function() { return null; }),
    ])
    .then(function(results) {
      var data = results[0];
      var flow = results[1];
      if (!data || !data.enabled) return;
      config = data;
      recommendationFlow = (flow && flow.configured) ? flow : null;
      root.style.display = '';
      applyColors();
      renderBubble();

      var saved = loadState();
      // Restore dismiss flags before deciding what to show, regardless of
      // whether a conversation is in flight. Previously these were only
      // restored inside restoreFromState() (the messages-exist branch),
      // which meant a shopper who dismissed the hero or greeting and then
      // navigated to a new page would see it again on every page load —
      // breaking the "X → just the pill" promise.
      if (saved) {
        if (saved.heroDismissed) heroDismissed = true;
        if (saved.greetingDismissed) greetingDismissed = true;
      }

      if (saved && Array.isArray(saved.messages) && saved.messages.length > 0) {
        restoreFromState(saved);
      } else {
        scheduleEntryPoint();
        trackEvent('widget_view');
      }
    })
    .catch(function(err) {
      console.error('Gleame Chat: config fetch failed', err);
    });
  }

  // Choose the first-visit entry point: hero takes precedence whenever
  // the merchant has enabled it — they explicitly opted in with custom
  // copy, so silently swapping to a generic greeting because some
  // optional data is missing would hide their work.
  //
  // The swatch row is rendered when it has data and quietly omitted when
  // it doesn't (see showHero) — but the hero itself still renders.
  //
  // Once the hero has been dismissed (this session), we do NOT fall back
  // to the greeting toast either — the shopper explicitly opted out and
  // a second nudge would be noise. The pill bubble remains visible.
  function scheduleEntryPoint() {
    var heroCfg = config && config.hero;
    if (heroCfg && heroCfg.enabled) {
      if (heroDismissed) return; // already dismissed this session — pill only
      scheduleHero();
      return;
    }
    scheduleGreeting();
  }

  function restoreFromState(saved) {
    messages = saved.messages || [];
    greetingDismissed = !!saved.greetingDismissed;
    heroDismissed = !!saved.heroDismissed;
    conversationEnded = !!saved.conversationEnded;
    preference = saved.preference || null;
    panelExpanded = !!saved.panelExpanded;
    criteria = (saved.criteria && typeof saved.criteria === 'object') ? saved.criteria : {};
    questionIndex = typeof saved.questionIndex === 'number' ? saved.questionIndex : 0;

    // Build the panel and re-render the persisted conversation
    if (!panel) buildPanel();
    renderAllMessages();

    // If a request was in flight when the user navigated, the request is gone.
    // Inject an interrupted notice + Try again button so the user isn't stuck.
    if (saved.pendingRequest) {
      pendingRequest = false;
      pushMessage({ type: 'bot-text', text: "Looks like your last request was interrupted." });
      pushMessage({ type: 'bot-buttons', buttons: [{ label: 'Try again', action: 'recommend' }], consumed: false });
      conversationEnded = true;
      saveState();
    }

    // Restore expand state
    if (panelExpanded) {
      panel.classList.add('gleame-chat-expanded');
      if (expandBtn) {
        expandBtn.innerHTML = shrinkSvgStr;
        expandBtn.setAttribute('aria-label', 'Shrink');
      }
    }

    // If panel was open at navigation time, reopen it
    if (saved.isOpen) {
      isOpen = true;
      panel.classList.add('gleame-chat-visible');
      updateBubbleIcon(true);
      lockBodyScroll();
    }

    // Reflect the most-likely status given saved state: done if results
    // already arrived, idle otherwise. Working state isn't preserved (the
    // restoreFromState path injects a "request interrupted" message instead).
    var hasResults = messages.some(function(m) { return m.type === 'bot-cards'; });
    setHeaderStatus(hasResults ? 'done' : 'idle');

    trackEvent('widget_view');
  }

  var TITLE_FONT_SERIF = "Georgia, 'Times New Roman', serif";
  var TITLE_FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  function applyColors() {
    root.style.setProperty('--gleame-chat-bubble-color', config.bubbleColor || '#1f2937');
    root.style.setProperty('--gleame-chat-accent-color', config.accentColor || '#8b5cf6');
    // Product + bundle title font is merchant-configurable (serif | sans).
    var titleFont = (config.titleFont === 'sans') ? TITLE_FONT_SANS : TITLE_FONT_SERIF;
    root.style.setProperty('--gleame-chat-title-font', titleFont);
    // Hero tint — its own configurable accent, resolved server-side to fall
    // back to the chat accent when the merchant hasn't set a hero color.
    var heroCfg = config.hero || {};
    var heroAccent = heroCfg.accentColor || config.accentColor || '#8b5cf6';
    root.style.setProperty('--gleame-hero-accent', heroAccent);
    // Explicit panel colors win over the accent-derived defaults. Only set
    // when configured — the CSS var() fallbacks carry the accent tint /
    // default dark headline otherwise.
    if (heroCfg.backgroundColor) {
      root.style.setProperty('--gleame-hero-bg', heroCfg.backgroundColor);
    }
    if (heroCfg.textColor) {
      root.style.setProperty('--gleame-hero-text', heroCfg.textColor);
    }
  }

  // ---- Bubble ----
  var BUBBLE_PILL_HTML =
    '<svg class="gleame-chat-bubble-sparkle" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z"/>' +
      '<path d="M19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9z" opacity=".7"/>' +
    '</svg>' +
    '<span class="gleame-chat-bubble-text"></span>';

  var BUBBLE_CLOSE_HTML =
    '<svg class="gleame-chat-bubble-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function bubbleLabel() {
    return (config && config.bubbleText) || 'Try on a shade';
  }

  function renderBubble() {
    bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'gleame-chat-bubble';
    bubble.setAttribute('aria-label', bubbleLabel());
    bubble.setAttribute('aria-expanded', 'false');
    bubble.onclick = toggleChat;
    bubble.innerHTML = BUBBLE_PILL_HTML;
    var textEl = bubble.querySelector('.gleame-chat-bubble-text');
    if (textEl) textEl.textContent = bubbleLabel();

    root.appendChild(bubble);
  }

  // ---- Greeting notification ----
  function scheduleGreeting() {
    var raw = Number(config.greetingDelaySeconds);
    var seconds = isFinite(raw) && raw >= 0 ? raw : 2;
    var delay = Math.min(seconds, 30) * 1000;
    setTimeout(function() {
      if (isOpen || greetingDismissed) return;
      showGreeting();
    }, delay);
  }

  function showGreeting() {
    if (greetingShown) return;
    greetingShown = true;

    greetingEl = document.createElement('div');
    greetingEl.className = 'gleame-chat-greeting';
    greetingEl.innerHTML =
      '<span class="gleame-chat-greeting-text">' + escapeHtml(config.greetingMessage) + '</span>' +
      '<button class="gleame-chat-greeting-close" aria-label="Dismiss">&times;</button>';

    greetingEl.querySelector('.gleame-chat-greeting-close').onclick = function(e) {
      e.stopPropagation();
      dismissGreeting();
    };
    greetingEl.onclick = function() {
      dismissGreeting();
      openChat();
    };

    root.appendChild(greetingEl);

    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        greetingEl.classList.add('gleame-chat-visible');
      });
    });

    setTimeout(function() {
      if (!greetingDismissed) dismissGreeting();
    }, 8000);
  }

  function dismissGreeting() {
    if (greetingDismissed) return;
    greetingDismissed = true;
    saveState();
    if (greetingEl) {
      greetingEl.classList.remove('gleame-chat-visible');
      setTimeout(function() {
        if (greetingEl && greetingEl.parentNode) greetingEl.parentNode.removeChild(greetingEl);
      }, 300);
    }
  }

  // ---- Hero popup ----
  // Configurable value-preview card. Same lifecycle shape as the greeting
  // (schedule → show → dismiss) so they're interchangeable as entry points.
  function scheduleHero() {
    var heroCfg = config.hero || {};
    var raw = Number(heroCfg.showDelaySeconds);
    var seconds = isFinite(raw) && raw >= 0 ? raw : 1;
    var delay = Math.min(seconds, 30) * 1000;
    setTimeout(function() {
      if (isOpen || heroDismissed) return;
      showHero();
    }, delay);
  }

  // Module-level so the Escape handler can be torn down on dismiss.
  var heroEscHandler = null;

  function showHero() {
    if (heroShown) return;
    var heroCfg = (config && config.hero) || null;
    if (!heroCfg) return;
    heroShown = true;

    heroEl = document.createElement('div');
    // The hero is always anchored directly above the pill (bottom-right);
    // CSS handles all the positioning. No per-instance corner class.
    heroEl.className = 'gleame-hero';
    heroEl.setAttribute('role', 'dialog');
    // The mobile sheet covers ~78dvh which is effectively modal; the desktop
    // corner card is more of a notification. aria-modal=true everywhere is
    // the safer default for screen readers — they'll know the rest of the
    // page is implicitly blocked while the hero is up.
    heroEl.setAttribute('aria-modal', 'true');
    // Prefer aria-labelledby pointing at a visible headline. If the headline
    // is empty we fall back to aria-label using the eyebrow or a default —
    // screen readers skip display:none elements even via aria-labelledby,
    // which would leave the dialog effectively unlabeled.
    if (heroCfg.headline) {
      heroEl.setAttribute('aria-labelledby', 'gleame-hero-headline');
    } else {
      heroEl.setAttribute('aria-label', heroCfg.eyebrow || heroCfg.ctaLabel || 'Personal consultation');
    }

    var swatchesHtml = '';
    // Merchant-supplied sample images win when present (they always render,
    // unlike the color swatches which depend on variants having display_color).
    // Cap at 4 so an oversized list can't scrunch the CSS grid.
    var sampleImages = Array.isArray(heroCfg.sampleImages)
      ? heroCfg.sampleImages.filter(function(u) { return typeof u === 'string' && u; }).slice(0, 4)
      : [];
    var swatches = Array.isArray(heroCfg.swatches) ? heroCfg.swatches.slice(0, 4) : [];
    var tilesHtml = '';
    if (sampleImages.length >= 1) {
      tilesHtml = sampleImages.map(function(url) {
        // escapeHtml guards the attribute (quotes/angle brackets); the URL is a
        // Supabase public URL written via the authenticated admin upload.
        return '<div class="gleame-hero-sample">' +
          '<img class="gleame-hero-sample-img" src="' + escapeHtml(url) + '" alt="" loading="lazy">' +
          '</div>';
      }).join('');
    } else if (swatches.length >= 2) {
      tilesHtml = swatches.map(function(s) {
        var color = (s && s.color) ? s.color : '#e5e7eb';
        // Inline style is necessary because the color comes from data, not CSS.
        return (
          '<div class="gleame-hero-sample" style="background:' + sanitizeColor(color) + '">' +
            (s && s.label ? '<span class="gleame-hero-sample-label-text">' + escapeHtml(s.label) + '</span>' : '') +
          '</div>'
        );
      }).join('');
    }
    if (tilesHtml) {
      swatchesHtml =
        (heroCfg.sampleLabel ? '<div class="gleame-hero-sample-label">' + escapeHtml(heroCfg.sampleLabel) + '</div>' : '') +
        '<div class="gleame-hero-samples">' + tilesHtml + '</div>';
    }

    var trustItems = Array.isArray(heroCfg.trustItems) ? heroCfg.trustItems.slice(0, 4) : [];
    var trustHtml = '';
    if (trustItems.length > 0) {
      trustHtml = '<div class="gleame-hero-trust">' +
        trustItems.map(function(item, i) {
          return (i > 0 ? '<span class="gleame-hero-trust-dot" aria-hidden="true"></span>' : '') +
            '<span class="gleame-hero-trust-item">' + escapeHtml(item) + '</span>';
        }).join('') +
        '</div>';
    }

    // Headline omitted entirely when empty — aria-labelledby was already
    // swapped for aria-label above in this case, so no orphan reference.
    var headlineHtml = heroCfg.headline
      ? '<h2 id="gleame-hero-headline" class="gleame-hero-headline">' + escapeHtml(heroCfg.headline) + '</h2>'
      : '';

    heroEl.innerHTML =
      '<div class="gleame-hero-top">' +
        (heroCfg.eyebrow ? '<div class="gleame-hero-eyebrow">' + escapeHtml(heroCfg.eyebrow) + '</div>' : '') +
        headlineHtml +
        '<button class="gleame-hero-close" aria-label="Dismiss">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="gleame-hero-body">' +
        swatchesHtml +
        (heroCfg.body ? '<p class="gleame-hero-copy">' + escapeHtml(heroCfg.body) + '</p>' : '') +
        trustHtml +
        '<button class="gleame-hero-cta" type="button">' + escapeHtml(heroCfg.ctaLabel || 'Start') + '</button>' +
        (heroCfg.footer ? '<div class="gleame-hero-footer">' + escapeHtml(heroCfg.footer) + '</div>' : '') +
      '</div>';

    heroEl.querySelector('.gleame-hero-close').onclick = function(e) {
      e.stopPropagation();
      dismissHero();
      trackEvent('hero_dismiss');
    };
    heroEl.querySelector('.gleame-hero-cta').onclick = function() {
      trackEvent('hero_cta_click');
      // skipPersist: openChatFromHero saves state itself.
      // keepLock: the chat panel will hold the body lock — don't unlock
      // here only for openChatFromHero to immediately re-lock.
      dismissHero(/* skipPersist */ true, /* keepLock */ true);
      openChatFromHero();
    };

    // Escape dismisses on desktop. Mobile usually doesn't have a physical
    // Esc key but the handler is cheap and harmless there. Defensively
    // tear down any prior handler before binding a new one — heroShown
    // already prevents double-show, but a stale listener would be silent
    // and hard to debug.
    if (heroEscHandler) document.removeEventListener('keydown', heroEscHandler);
    heroEscHandler = function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        dismissHero();
        trackEvent('hero_dismiss');
      }
    };
    document.addEventListener('keydown', heroEscHandler);

    root.appendChild(heroEl);
    trackEvent('hero_view');

    // Lock body scroll on mobile so the 78dvh sheet behaves like a real
    // modal — without this, accidental touches scroll the page underneath
    // while the user is trying to interact with the sheet.
    lockBodyScroll();

    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (heroEl) heroEl.classList.add('gleame-hero-visible');
      });
    });
  }

  function dismissHero(skipPersist, keepLock) {
    if (heroDismissed && !heroEl) return;
    heroDismissed = true;
    if (!skipPersist) saveState();
    if (heroEscHandler) {
      document.removeEventListener('keydown', heroEscHandler);
      heroEscHandler = null;
    }
    // Release the body lock unless the caller will hand off to another
    // component that also wants the lock (i.e. the chat panel via the
    // hero CTA). Also skip if a chat panel is already open for any other
    // reason — closing the hero shouldn't unlock under the open chat.
    if (!keepLock && !isOpen) unlockBodyScroll();
    if (heroEl) {
      heroEl.classList.remove('gleame-hero-visible');
      var el = heroEl;
      heroEl = null;
      setTimeout(function() {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 360);
    }
  }

  // Restricts the inline-style color we write into the swatch background.
  // display_color is a hex string from Supabase but we still want a hard
  // guard against any future code path that might inject untrusted input.
  function sanitizeColor(c) {
    if (typeof c !== 'string') return '#e5e7eb';
    var trimmed = c.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
    return '#e5e7eb';
  }

  // ---- Chat panel ----
  function toggleChat() {
    if (isOpen) closeChat();
    else openChat();
  }

  function openChat() {
    if (isOpen) return;
    isOpen = true;
    dismissGreeting();
    // keepLock: we're about to lock for the chat ourselves; passing
    // keepLock=true avoids the unlock-then-relock churn from dismissHero.
    dismissHero(/* skipPersist */ false, /* keepLock */ true);

    if (!panel) buildPanel();
    panel.classList.add('gleame-chat-visible');
    updateBubbleIcon(true);
    lockBodyScroll();

    // Start conversation only if there's nothing to restore. A finished flow
    // (conversationEnded === true) is preserved so reopening shows prior
    // messages; the trailing "Start a new search" / "Try again" button lets
    // the user restart on demand.
    if (messages.length === 0) {
      resetConversation();
      startConsultation();
    }

    saveState();
    trackEvent('chat_open');
  }

  // Open path from the hero CTA. Same consultation start as the bubble —
  // the hero just dismisses itself first (with keepLock) instead of going
  // through dismissHero here. Only fires for fresh sessions — the init()
  // flow short-circuits to restoreFromState when there are saved messages,
  // so this is never reached mid-conversation.
  function openChatFromHero() {
    if (isOpen) return;
    isOpen = true;
    dismissGreeting();

    if (!panel) buildPanel();
    panel.classList.add('gleame-chat-visible');
    updateBubbleIcon(true);
    lockBodyScroll();

    if (messages.length === 0) {
      resetConversation();
      startConsultation();
    }

    saveState();
    trackEvent('chat_open');
  }

  function closeChat() {
    if (!isOpen) return;
    isOpen = false;

    // An in-flight recommendation keeps running while the panel is closed.
    // Closing is browsing behavior, not a cancel intent — transforms take
    // ~20s and shoppers naturally minimize the chat to look at the page
    // while they wait. The response handlers render results into the
    // (hidden) conversation, so reopening shows them. Aborting here used
    // to throw the work away and greet the shopper with "Your request was
    // cancelled." when they peeked back in.

    if (panel) {
      panel.classList.remove('gleame-chat-visible');
      // Reset expand state so reopen always starts collapsed
      if (panel.classList.contains('gleame-chat-expanded')) {
        panel.classList.remove('gleame-chat-expanded');
        panelExpanded = false;
        if (expandBtn) {
          expandBtn.innerHTML = expandSvgStr;
          expandBtn.setAttribute('aria-label', 'Expand');
        }
      }
    }
    updateBubbleIcon(false);
    unlockBodyScroll();
    saveState();
  }

  function resetConversation() {
    messages = [];
    conversationEnded = false;
    preference = null;
    pendingRequest = false;
    criteria = {};
    questionIndex = 0;
    cardsAnchorEl = null;
    if (messagesContainer) {
      while (messagesContainer.firstChild) {
        messagesContainer.removeChild(messagesContainer.firstChild);
      }
    }
    setHeaderStatus('idle');
  }

  function updateBubbleIcon(showClose) {
    if (!bubble) return;
    if (showClose) {
      bubble.classList.add('gleame-chat-bubble-open');
      bubble.setAttribute('aria-label', 'Close');
      bubble.setAttribute('aria-expanded', 'true');
      bubble.innerHTML = BUBBLE_CLOSE_HTML;
    } else {
      bubble.classList.remove('gleame-chat-bubble-open');
      bubble.setAttribute('aria-label', bubbleLabel());
      bubble.setAttribute('aria-expanded', 'false');
      bubble.innerHTML = BUBBLE_PILL_HTML;
      var textEl = bubble.querySelector('.gleame-chat-bubble-text');
      if (textEl) textEl.textContent = bubbleLabel();
    }
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'gleame-chat-panel';

    // Header
    var header = document.createElement('div');
    header.className = 'gleame-chat-header';

    var avatarWrap = document.createElement('div');
    avatarWrap.className = 'gleame-chat-header-avatar';
    if (config.avatarUrl) {
      avatarWrap.innerHTML = '<img src="' + escapeHtml(config.avatarUrl) + '" alt="">';
    } else {
      // Initial-letter fallback — feels deliberate and on-brand vs the
      // generic person silhouette. Letter inherits header text color.
      var initial = (config.assistantName || '').trim().charAt(0).toUpperCase() || '·';
      avatarWrap.classList.add('gleame-chat-header-avatar-initial');
      avatarWrap.innerHTML = '<span class="gleame-chat-header-avatar-letter">' + escapeHtml(initial) + '</span>';
    }

    var info = document.createElement('div');
    info.className = 'gleame-chat-header-info';
    info.innerHTML =
      '<div class="gleame-chat-header-name-row">' +
        '<span class="gleame-chat-header-name">' + escapeHtml(config.assistantName) + '</span>' +
        '<span class="gleame-chat-header-presence-dot" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="gleame-chat-header-status">' + escapeHtml(headerStatusText('idle')) + '</div>';

    expandSvgStr = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    shrinkSvgStr = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

    expandBtn = document.createElement('button');
    expandBtn.className = 'gleame-chat-header-expand';
    expandBtn.setAttribute('aria-label', 'Expand');
    expandBtn.innerHTML = expandSvgStr;
    expandBtn.onclick = function() {
      panelExpanded = panel.classList.toggle('gleame-chat-expanded');
      expandBtn.innerHTML = panelExpanded ? shrinkSvgStr : expandSvgStr;
      expandBtn.setAttribute('aria-label', panelExpanded ? 'Shrink' : 'Expand');
      saveState();
    };

    var closeBtn = document.createElement('button');
    closeBtn.className = 'gleame-chat-header-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.onclick = closeChat;

    var actions = document.createElement('div');
    actions.className = 'gleame-chat-header-actions';
    actions.appendChild(expandBtn);
    actions.appendChild(closeBtn);

    header.appendChild(avatarWrap);
    header.appendChild(info);
    header.appendChild(actions);

    // Messages
    messagesContainer = document.createElement('div');
    messagesContainer.className = 'gleame-chat-messages';

    // Disclaimer — compact privacy reassurance, lock icon + short copy.
    // The full privacy policy link is still reachable but lives behind the
    // small "·" link so the footer doesn't read like a EULA.
    var disclaimer = document.createElement('div');
    disclaimer.className = 'gleame-chat-disclaimer';
    disclaimer.innerHTML =
      '<svg class="gleame-chat-disclaimer-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
      '<span>Processed instantly · never stored</span>' +
      '<span class="gleame-chat-disclaimer-sep" aria-hidden="true"> · </span>' +
      '<a class="gleame-chat-disclaimer-link" href="https://www.gleame.ai/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>';

    panel.appendChild(header);
    panel.appendChild(messagesContainer);
    panel.appendChild(disclaimer);
    root.appendChild(panel);
  }

  // ---- Header status ----
  // Single-source state machine for the line under the assistant's name.
  // Three states: idle (advisor tagline), working (during /chat-recommend),
  // done (recommendation count) after results arrive. All strings come from
  // the server-rendered config so merchants can re-skin the chat without
  // touching the bundle.
  function headerStatusText(state, count) {
    if (!config) return '';
    if (state === 'working') return config.headerWorkingStatus || 'Working on it…';
    if (state === 'done') {
      // Count fallback: if not passed in, look at saved messages for a
      // bot-cards entry — supports restoreFromState which doesn't know the
      // count at call time. Written defensively (no optional chaining) to
      // stay in the same ES5-style as the rest of the widget.
      var n = (typeof count === 'number' && count > 0) ? count : 0;
      if (n === 0) {
        for (var i = 0; i < messages.length; i++) {
          var m = messages[i];
          if (m && m.type === 'bot-cards' && m.recommendations && m.recommendations.length) {
            n = m.recommendations.length;
            break;
          }
        }
      }
      var template = config.headerDoneStatus || 'Your {count} perfect picks';
      return template.replace(/\{count\}/g, String(n || 0));
    }
    return config.headerIdleStatus || '';
  }

  function setHeaderStatus(state, count) {
    if (!panel) return;
    var el = panel.querySelector('.gleame-chat-header-status');
    if (el) el.textContent = headerStatusText(state, count);
    var dot = panel.querySelector('.gleame-chat-header-presence-dot');
    if (dot) {
      dot.classList.remove('gleame-chat-header-presence-working');
      if (state === 'working') dot.classList.add('gleame-chat-header-presence-working');
    }
  }

  // ---- Conversation ----
  // Note: messages within a single conversation step are pushed synchronously
  // (no setTimeout between pushMessage calls). Otherwise navigating mid-delay
  // would leave an orphan question without its follow-up buttons in storage.
  // Single consultation entry point for every fresh open — bubble, greeting,
  // and hero CTA all land here. Starts the recommendation flow directly,
  // optionally led by the merchant's opening message; no reply is expected
  // between the opening message and the first question. (Previously the
  // bubble showed a greeting + an intermediate "Find my perfect shade"
  // button before starting — that extra step was the "old flow".)
  function startConsultation() {
    trackEvent('chat_recommend_start');
    conversationEnded = false;
    criteria = {};
    questionIndex = 0;
    if (config.openingMessage) {
      pushMessage({ type: 'bot-text', text: config.openingMessage });
    }
    startRecommendFlow();
  }

  function handleButtonClick(action, label, sourceMsg) {
    // Mark the button group as consumed so it doesn't re-render after reload
    if (sourceMsg) {
      sourceMsg.consumed = true;
    }
    pushMessage({ type: 'user-text', text: label });

    if (action === 'recommend') {
      trackEvent('chat_recommend_start');
      conversationEnded = false;
      criteria = {};
      questionIndex = 0;
      startRecommendFlow();
      return;
    }

    // Question-answer action from the new matrix flow:
    // "qa:<axisKey>:<axisValue>" — record the criteria value, push the
    // configured bot response if any, then either ask the next question
    // or move to photo upload.
    if (action.indexOf('qa:') === 0) {
      handleQuestionAnswer(action.slice(3));
      return;
    }

    // Legacy single-preference action — used when no recommendation matrix
    // is configured. preference: prefix preserved for backward compat.
    if (action.indexOf('preference:') === 0) {
      preference = action.replace('preference:', '');
      askForPhoto();
    }
  }

  // Starts the recommend flow. Three paths:
  //   1. Matrix with user questions → ask them, collect criteria, then photo
  //   2. Matrix with only photo axes → skip straight to photo upload (the
  //      server will fill in photo-derived criteria); the legacy preference
  //      question would just record an unused "preference" string here
  //   3. No matrix configured → legacy single preference prompt
  function startRecommendFlow() {
    if (recommendationFlow && recommendationFlow.questions.length > 0) {
      askNextQuestion();
      return;
    }
    if (recommendationFlow) {
      // Matrix is configured (configured===true on the server only when
      // there's at least one user-question OR photo axis) but it has only
      // photo axes — no user questions to ask. Go straight to photo.
      askForPhoto();
      return;
    }
    pushMessage({
      type: 'bot-text',
      text: config.preferenceQuestion || 'What kind of look are you going for?',
    });
    var configured = config.preferenceOptions;
    var opts = (Array.isArray(configured) && configured.length > 0)
      ? configured
      : ['Natural', 'Bold', 'Glossy', 'Surprise me'];
    var buttons = opts.map(function(opt) {
      return { label: opt, action: 'preference:' + opt };
    });
    pushMessage({ type: 'bot-buttons', buttons: buttons, consumed: false });
  }

  function askNextQuestion() {
    var q = recommendationFlow.questions[questionIndex];
    if (!q) {
      askForPhoto();
      return;
    }
    pushMessage({ type: 'bot-text', text: q.prompt });
    var buttons = (q.options || []).map(function(opt) {
      return { label: opt.label, action: 'qa:' + q.axisKey + ':' + opt.axisValue };
    });
    pushMessage({ type: 'bot-buttons', buttons: buttons, consumed: false });
  }

  // Action payload after the "qa:" prefix is stripped: "<axisKey>:<axisValue>".
  // Records the criteria, plays back the merchant-configured bot personality
  // response for the chosen option, then advances.
  function handleQuestionAnswer(payload) {
    var firstColon = payload.indexOf(':');
    if (firstColon < 0) return;
    var axisKey = payload.slice(0, firstColon);
    var axisValue = payload.slice(firstColon + 1);
    criteria[axisKey] = axisValue;

    var q = recommendationFlow && recommendationFlow.questions[questionIndex];
    var chosen = q && (q.options || []).find(function(o) { return o.axisValue === axisValue; });
    if (chosen && chosen.botResponse) {
      pushMessage({ type: 'bot-text', text: chosen.botResponse });
    }

    questionIndex++;
    if (recommendationFlow && questionIndex < recommendationFlow.questions.length) {
      askNextQuestion();
    } else {
      askForPhoto();
    }
  }

  function askForPhoto() {
    var photoMsg = config.photoUploadMessage
      || "Take a photo or upload one and I'll show you what looks best on you!";
    pushMessage({ type: 'bot-text', text: photoMsg });
    pushMessage({ type: 'bot-upload', consumed: false });
  }

  // Downscale a data URL to a small JPEG thumbnail (longest edge maxPx).
  // Used to persist the shopper's photo across page navigations without
  // blowing the sessionStorage quota — a 240px JPEG is a few KB vs the
  // multi-MB original. cb(null) on any failure (e.g. HEIC the browser
  // can't decode) — callers fall back to the placeholder chip.
  function makeThumbnail(dataUrl, maxPx, cb) {
    try {
      var img = new Image();
      img.onload = function() {
        try {
          var scale = Math.min(1, maxPx / Math.max(img.width, img.height, 1));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          cb(canvas.toDataURL('image/jpeg', 0.7));
        } catch (e) {
          cb(null);
        }
      };
      img.onerror = function() { cb(null); };
      img.src = dataUrl;
    } catch (e) {
      cb(null);
    }
  }

  function handlePhotoUpload(file, uploadMsg) {
    trackEvent('chat_photo_upload');

    // Mark upload widget as consumed
    if (uploadMsg) uploadMsg.consumed = true;

    // Photo bubble: the full-size preview is shown transiently in-page; a
    // small thumbnail is persisted on the message record so the photo
    // survives navigation (e.g. the "View page" card CTA) instead of
    // restoring as a broken <img>.
    var imageMsg = { type: 'user-image', thumb: null };
    pushMessage(imageMsg);
    var lastImageEl = messagesContainer.lastChild;
    var reader = new FileReader();
    reader.onload = function(e) {
      var dataUrl = e.target.result;
      // Swap the placeholder chip for the actual full-size preview
      if (lastImageEl && lastImageEl.parentNode) {
        while (lastImageEl.firstChild) lastImageEl.removeChild(lastImageEl.firstChild);
        lastImageEl.appendChild(buildPreviewImg(dataUrl));
      }
      makeThumbnail(dataUrl, 240, function(thumb) {
        if (thumb) {
          imageMsg.thumb = thumb;
          saveState();
        }
      });
    };
    reader.readAsDataURL(file);

    // Show transient skeleton placeholders (Gemini-style) — not persisted
    setTimeout(function() {
      renderLoadingSpinner();
      sendRecommendation(file);
    }, 600);
  }

  // 3-step checklist labels come from chat-config so merchants can re-skin
  // without code changes. Each step "completes" cosmetically on a fixed
  // 2.5s timer — purely visual, doesn't reflect real backend progress.
  // The last step keeps spinning until removeLoadingMsg fires when the
  // API returns.
  var LOADING_STEPS_FALLBACK = [
    'Analyzing your photo',
    'Personalizing results',
    'Visualizing your picks',
  ];
  var LOADING_CAPTION_FALLBACK = 'Reading your skin tone and matching shades…';
  // Ribbon palette used when the shop has no variant display_colors —
  // warm beauty-shade neutrals matching the design mock.
  var LOADING_RIBBON_FALLBACK = [
    '#5b1f2a', '#f3e3d3', '#d9a86c', '#f7d9d0',
    '#7a3b2e', '#e8b4a6', '#e2725b', '#f0c9b1',
  ];
  var loadingStepInterval = null;

  // Renders the loading state in two parts that get cleaned up together:
  //   1. A transient bot text bubble with the loading caption ("Reading
  //      your skin tone and matching shades…"). Looks like a normal
  //      bot-text bubble (avatar + gray bubble) but isn't persisted to
  //      the messages array — removed in removeLoadingMsg.
  //   2. A marquee ribbon of shade swatches scrolling right-to-left +
  //      the 3-step checklist below it.
  function renderLoadingSpinner() {
    // 1. Transient text bubble — matches the regular bot-text rendering
    //    so the visual style is identical, including the inline avatar.
    var caption = (config && config.loadingCaption) || LOADING_CAPTION_FALLBACK;
    var textMsg = document.createElement('div');
    textMsg.id = 'gleame-chat-loading-text-msg';
    textMsg.className = 'gleame-chat-msg gleame-chat-msg-bot gleame-chat-msg-bot-text-row';
    textMsg.innerHTML =
      buildMessageAvatarHtml() +
      '<div class="gleame-chat-msg-bubble">' + escapeHtml(caption) + '</div>';
    messagesContainer.appendChild(textMsg);

    // 2. Ribbon + checklist
    var wrap = document.createElement('div');
    wrap.id = 'gleame-chat-loading-msg';
    wrap.className = 'gleame-chat-msg gleame-chat-msg-bot gleame-chat-loading-hero';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');

    var configSteps = (config && Array.isArray(config.loadingSteps) && config.loadingSteps.length > 0)
      ? config.loadingSteps
      : LOADING_STEPS_FALLBACK;
    // Clamp to 3 — CSS layout assumes ≤3 rows; merchants entering more
    // would distort the hero.
    var steps = configSteps.slice(0, 3);
    // {count} in step labels resolves to the configured recommendation
    // count (e.g. "Visualizing your 3 shades").
    var stepCount = Number(config && config.numRecommendations) || 3;

    var stepsHtml = steps.map(function(label, i) {
      var resolved = String(label).replace(/\{count\}/g, String(stepCount));
      return (
        '<li class="gleame-chat-loading-hero-step" data-step="' + i + '">' +
          '<span class="gleame-chat-loading-hero-step-mark" aria-hidden="true"></span>' +
          '<span class="gleame-chat-loading-hero-step-label">' + escapeHtml(resolved) + '</span>' +
        '</li>'
      );
    }).join('');

    // Shade ribbon — swatch tiles scrolling right-to-left like a marquee
    // until results arrive. The tile set is rendered twice back-to-back so
    // the -50% keyframe wrap is invisible (the second copy slides in
    // exactly where the first one started). Colors come from the shop's
    // variant display_colors via chat-config; the fallback palette keeps
    // the ribbon alive for shops without colors configured.
    var ribbonColors = (config && Array.isArray(config.loadingSwatches) && config.loadingSwatches.length >= 3)
      ? config.loadingSwatches
      : LOADING_RIBBON_FALLBACK;
    var tilesHtml = ribbonColors.map(function(c) {
      return '<span class="gleame-chat-loading-ribbon-tile" style="background:' + sanitizeColor(c) + '"></span>';
    }).join('');

    wrap.innerHTML =
      '<div class="gleame-chat-loading-ribbon" aria-hidden="true">' +
        '<div class="gleame-chat-loading-ribbon-track">' + tilesHtml + tilesHtml + '</div>' +
      '</div>' +
      '<ul class="gleame-chat-loading-hero-steps">' + stepsHtml + '</ul>';

    // First step starts active; the rest are pending.
    var stepEls = wrap.querySelectorAll('.gleame-chat-loading-hero-step');
    if (stepEls.length > 0) stepEls[0].classList.add('gleame-chat-loading-hero-step-active');

    messagesContainer.appendChild(wrap);
    scrollToBottom();

    // Tick through the steps cosmetically: 2.5s per step except the last
    // (which stays active until removeLoadingMsg cleans up on response).
    var current = 0;
    loadingStepInterval = setInterval(function() {
      if (current >= stepEls.length - 1) {
        clearInterval(loadingStepInterval);
        loadingStepInterval = null;
        return;
      }
      stepEls[current].classList.remove('gleame-chat-loading-hero-step-active');
      stepEls[current].classList.add('gleame-chat-loading-hero-step-done');
      current++;
      stepEls[current].classList.add('gleame-chat-loading-hero-step-active');
    }, 2500);
  }

  function sendRecommendation(file) {
    var formData = new FormData();
    formData.append('image', file);
    formData.append('shopDomain', shopDomain);
    formData.append('preference', preference || '');
    // Criteria JSON is the matrix-flow payload — the server uses it to look
    // up curated variants. Empty object is fine; server falls back to AI
    // pick when no criteria match a rule.
    formData.append('criteria', JSON.stringify(criteria || {}));

    if (inFlightRequest) {
      try { inFlightRequest.abort(); } catch (e) {}
    }
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    inFlightRequest = controller;
    pendingRequest = true;
    setHeaderStatus('working');
    saveState();

    fetch(SHOPIFY_APP_URL + '/api/storefront/chat-recommend', {
      method: 'POST',
      body: formData,
      signal: controller ? controller.signal : undefined,
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (inFlightRequest !== controller) return;
      inFlightRequest = null;
      pendingRequest = false;
      // No isOpen check: when the shopper closed the panel while waiting,
      // results still render into the hidden conversation and persist, so
      // reopening shows them instead of a stalled flow.
      removeLoadingMsg();
      if (data.recommendations && data.recommendations.length > 0) {
        setHeaderStatus('done', data.recommendations.length);
        // Intro line above the cards. {count} token swapped here so the
        // widget owns the runtime value (server doesn't know how many
        // recommendations succeeded after backfill).
        var introTemplate = (config && config.recommendationsIntro) ||
          'Here are your {count} perfect picks:';
        var introText = introTemplate.replace(/\{count\}/g, String(data.recommendations.length));
        pushMessage({ type: 'bot-text', text: introText });
        pushMessage({ type: 'bot-cards', recommendations: data.recommendations });
        // bot-end-actions stores only what renderEndActions actually uses:
        // the per-rec { variantId, handle } pairs for the bundle CTA + count
        // (for the {count} token). Handles are short, so this stays tiny —
        // unlike the full recommendations array, which carries hundreds of KB
        // of base64 tryOnPreview already present in bot-cards and would blow
        // past the sessionStorage quota on longer conversations.
        var endBundle = [];
        for (var i = 0; i < data.recommendations.length; i++) {
          var r = data.recommendations[i];
          var h = (r.productHandle || '').trim();
          if (!h) continue;
          var vid = (r.variantNumericId && /^\d+$/.test(String(r.variantNumericId)))
            ? String(r.variantNumericId) : null;
          endBundle.push({ variantId: vid, handle: h });
        }
        pushMessage({
          type: 'bot-end-actions',
          bundle: endBundle,
          count: data.recommendations.length,
        });
        trackEvent('chat_recommendation_shown');
        conversationEnded = true;
        saveState();
      } else {
        setHeaderStatus('idle');
        pushMessage({ type: 'bot-text', text: "Sorry, I couldn't find a match right now." });
        pushMessage({ type: 'bot-buttons', buttons: [{ label: 'Try again', action: 'recommend' }], consumed: false });
        conversationEnded = true;
        saveState();
      }
    })
    .catch(function(err) {
      if (err && err.name === 'AbortError') return;
      if (inFlightRequest !== controller) return;
      inFlightRequest = null;
      pendingRequest = false;
      removeLoadingMsg();
      setHeaderStatus('idle');
      console.error('Gleame Chat: recommend error', err);
      pushMessage({ type: 'bot-text', text: "Something went wrong. Please try again!" });
      pushMessage({ type: 'bot-buttons', buttons: [{ label: 'Try again', action: 'recommend' }], consumed: false });
      conversationEnded = true;
      saveState();
    });
  }

  // ---- Message log + rendering ----
  function pushMessage(msg) {
    messages.push(msg);
    renderMessage(msg);
    saveState();
  }

  function renderAllMessages() {
    if (!messagesContainer) return;
    while (messagesContainer.firstChild) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }
    cardsAnchorEl = null;
    messages.forEach(function(m) { renderMessage(m); });
  }

  function renderMessage(m) {
    if (!messagesContainer) return;
    var anchorCandidate = null;
    switch (m.type) {
      case 'bot-text':
        renderTextBubble(m.text, 'bot');
        break;
      case 'user-text':
        renderTextBubble(m.text, 'user');
        break;
      case 'user-image':
        renderImagePreview(m);
        break;
      case 'bot-buttons':
        if (!m.consumed) renderButtons(m);
        break;
      case 'bot-upload':
        if (!m.consumed) renderUpload(m);
        break;
      case 'bot-cards':
        // Anchor scroll to the message immediately preceding the cards (the
        // "Here's what I found" intro), so the FIRST card is visible at the
        // top of the scroll viewport.
        anchorCandidate = messagesContainer.lastElementChild;
        renderProductCards(m.recommendations || []);
        break;
      case 'bot-end-actions':
        renderEndActions(m);
        break;
    }
    if (anchorCandidate) {
      cardsAnchorEl = anchorCandidate;
    }
    if (cardsAnchorEl && messagesContainer.contains(cardsAnchorEl)) {
      scrollAnchorToTop(cardsAnchorEl);
    } else {
      scrollToBottom();
    }
  }

  function renderTextBubble(text, role) {
    var msg = document.createElement('div');
    msg.className = 'gleame-chat-msg gleame-chat-msg-' + role;
    if (role === 'bot') {
      // Bot text rows get the inline avatar — adds personality and matches
      // the design mockup. Button groups / upload widgets / cards don't
      // get one (avatar would feel redundant on action-only rows).
      msg.classList.add('gleame-chat-msg-bot-text-row');
      msg.innerHTML =
        buildMessageAvatarHtml() +
        '<div class="gleame-chat-msg-bubble">' + escapeHtml(text) + '</div>';
    } else {
      msg.innerHTML = '<div class="gleame-chat-msg-bubble">' + escapeHtml(text) + '</div>';
    }
    messagesContainer.appendChild(msg);
  }

  // Small circular avatar shown inline with each bot text bubble. Uses the
  // uploaded avatar URL when set, otherwise renders an initial-letter chip
  // with the same accent tint as the header avatar.
  function buildMessageAvatarHtml() {
    if (config && config.avatarUrl) {
      return '<div class="gleame-chat-msg-avatar">' +
        '<img src="' + escapeHtml(config.avatarUrl) + '" alt="">' +
      '</div>';
    }
    var initial = '·';
    if (config && config.assistantName) {
      var trimmed = String(config.assistantName).trim();
      if (trimmed.length > 0) initial = trimmed.charAt(0).toUpperCase();
    }
    return '<div class="gleame-chat-msg-avatar">' +
      '<span class="gleame-chat-msg-avatar-letter">' + escapeHtml(initial) + '</span>' +
    '</div>';
  }

  function buildPreviewImg(src) {
    var img = document.createElement('img');
    img.className = 'gleame-chat-msg-image';
    img.alt = 'Your photo';
    img.style.maxHeight = '200px';
    img.style.borderRadius = '12px';
    img.style.background = '#f3f4f6';
    img.style.minWidth = '120px';
    img.style.minHeight = '120px';
    img.src = src;
    return img;
  }

  // Renders the shopper's photo bubble. Restored sessions use the persisted
  // thumbnail; when none exists (upload still reading, pre-thumbnail saved
  // state, or an undecodable format) render a neutral chip instead of an
  // <img> with no src — that shows as a broken-image icon.
  function renderImagePreview(m) {
    var imgMsg = document.createElement('div');
    imgMsg.className = 'gleame-chat-msg gleame-chat-msg-user';
    if (m && m.thumb) {
      imgMsg.appendChild(buildPreviewImg(m.thumb));
    } else {
      var chip = document.createElement('div');
      chip.className = 'gleame-chat-msg-image-placeholder';
      chip.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>' +
        '<span>Your photo</span>';
      imgMsg.appendChild(chip);
    }
    messagesContainer.appendChild(imgMsg);
  }

  function renderButtons(msgRecord) {
    var wrap = document.createElement('div');
    // Full-width action row — same treatment as the upload widget so the
    // pill buttons reach the messages-container edges.
    wrap.className = 'gleame-chat-msg gleame-chat-msg-bot gleame-chat-msg-bot-action';

    var btnGroup = document.createElement('div');
    btnGroup.className = 'gleame-chat-buttons';

    msgRecord.buttons.forEach(function(btn) {
      var el = document.createElement('button');
      el.className = 'gleame-chat-btn';
      el.textContent = btn.label;
      el.onclick = function() {
        if (msgRecord.consumed) return;
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        handleButtonClick(btn.action, btn.label, msgRecord);
      };
      btnGroup.appendChild(el);
    });

    wrap.appendChild(btnGroup);
    messagesContainer.appendChild(wrap);
  }

  function renderUpload(msgRecord) {
    var uploadWrap = document.createElement('div');
    // gleame-chat-msg-bot-action lets the upload widget take the full
    // messages-container width instead of inheriting the 85% bubble cap.
    // The pill buttons inside need the room.
    uploadWrap.className = 'gleame-chat-msg gleame-chat-msg-bot gleame-chat-msg-bot-action';

    var btnGroup = document.createElement('div');
    btnGroup.className = 'gleame-chat-upload';

    // File input for "Upload a Photo" (gallery picker, no capture)
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    // Separate file input for mobile "Take a Photo" — uses capture="user"
    // to open the front camera directly. We keep this distinct from the
    // gallery picker so toggling between them doesn't fight each other.
    var captureInput = document.createElement('input');
    captureInput.type = 'file';
    captureInput.accept = 'image/*';
    captureInput.setAttribute('capture', 'user');
    captureInput.style.display = 'none';

    function validateAndSubmit(file) {
      if (!file) return;
      if (!file.type.startsWith('image/') && !file.name.match(/\.(heic|heif)$/i)) {
        pushMessage({ type: 'bot-text', text: 'Please upload an image file (JPG, PNG, etc.).' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        pushMessage({ type: 'bot-text', text: 'Image too large. Please upload one under 5MB.' });
        return;
      }
      if (uploadWrap.parentNode) uploadWrap.parentNode.removeChild(uploadWrap);
      handlePhotoUpload(file, msgRecord);
    }

    fileInput.onchange = function(e) {
      validateAndSubmit(e.target.files && e.target.files[0]);
    };
    captureInput.onchange = function(e) {
      validateAndSubmit(e.target.files && e.target.files[0]);
    };

    var mobile = isMobile();

    // "Take a photo" — primary (dark filled pill). On mobile, opens the
    // native front-facing camera directly. On desktop, opens the in-app
    // camera modal (gleame-camera) which falls back to a file picker if
    // the browser denies getUserMedia.
    var cameraBtn = document.createElement('button');
    cameraBtn.className = 'gleame-chat-upload-btn gleame-chat-upload-btn-primary';
    cameraBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>' +
      '<span>Take a photo</span>';
    cameraBtn.onclick = function() {
      if (msgRecord.consumed) return;
      if (mobile) {
        captureInput.click();
        return;
      }
      if (window.gleameCamera) {
        window.gleameCamera.open(
          function(file) {
            if (uploadWrap.parentNode) uploadWrap.parentNode.removeChild(uploadWrap);
            handlePhotoUpload(file, msgRecord);
          },
          function() { fileInput.click(); }
        );
      } else {
        captureInput.click();
      }
    };

    // "Upload from gallery" — secondary (outlined pill).
    var uploadBtn = document.createElement('button');
    uploadBtn.className = 'gleame-chat-upload-btn gleame-chat-upload-btn-secondary';
    uploadBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
      '<span>Upload from gallery</span>';
    uploadBtn.onclick = function() {
      if (msgRecord.consumed) return;
      fileInput.click();
    };

    // Primary action ("Take a photo") always comes first — same order on
    // desktop and mobile so the visual hierarchy matches across devices.
    btnGroup.appendChild(cameraBtn);
    btnGroup.appendChild(uploadBtn);
    btnGroup.appendChild(fileInput);
    btnGroup.appendChild(captureInput);
    uploadWrap.appendChild(btnGroup);
    messagesContainer.appendChild(uploadWrap);
  }

  // Redesigned product card. Layout (matches the storefront mockup):
  //   [TOP MATCH badge]
  //   [tryOnPreview image]
  //   [title ........... price]
  //   [variantTitle subtitle]
  //   [italic tagline (optional)]
  //   [View page button — full width]
  //
  // "Top Match" badge surfaces on rec.rank === 1 (preserved from matrix rank
  // — see chat-recommend backend). Price is pulled per-card from the
  // storefront's same-origin /products/{handle}.js (no heart / save — those
  // were removed by request).
  function renderProductCards(recommendations) {
    recommendations.forEach(function(rec, idx) {
      var card = document.createElement('div');
      // gleame-chat-msg-card lifts the 85% bubble cap so the card spans the
      // full conversation width.
      card.className = 'gleame-chat-msg gleame-chat-msg-bot gleame-chat-msg-card gleame-chat-card-enter';
      card.style.animationDelay = (idx * 90) + 'ms';

      var cardInner = document.createElement('div');
      cardInner.className = 'gleame-chat-product-card';

      // Image area (with overlaid TOP MATCH badge)
      var imgWrap = document.createElement('div');
      imgWrap.className = 'gleame-chat-product-image-wrap';

      if (rec.rank === 1) {
        var badge = document.createElement('span');
        badge.className = 'gleame-chat-product-badge';
        badge.textContent = 'TOP MATCH';
        imgWrap.appendChild(badge);
      }

      if (rec.tryOnPreview) {
        var previewImg = document.createElement('img');
        previewImg.className = 'gleame-chat-product-image gleame-chat-image-reveal';
        previewImg.style.animationDelay = (idx * 90) + 'ms';
        previewImg.src = 'data:image/jpeg;base64,' + rec.tryOnPreview;
        previewImg.alt = rec.title || '';
        previewImg.onerror = function() { previewImg.style.display = 'none'; };
        // Feed the same image to the blurred backdrop (::before) so the
        // contain-fit photo's side margins are filled instead of flat gray.
        imgWrap.style.setProperty(
          '--gleame-card-bg',
          "url('data:image/jpeg;base64," + rec.tryOnPreview + "')"
        );
        imgWrap.appendChild(previewImg);
      }

      cardInner.appendChild(imgWrap);

      var info = document.createElement('div');
      info.className = 'gleame-chat-product-info';

      // Title + price share one row, price right-aligned. Price is filled in
      // asynchronously once /products/{handle}.js loads — starts blank so we
      // never flash a placeholder if the lookup is slow or unavailable.
      var titleRow = document.createElement('div');
      titleRow.className = 'gleame-chat-product-title-row';
      var titleEl = document.createElement('div');
      titleEl.className = 'gleame-chat-product-title';
      titleEl.textContent = rec.productName || rec.title || '';
      var priceEl = document.createElement('div');
      priceEl.className = 'gleame-chat-product-price';
      titleRow.appendChild(titleEl);
      titleRow.appendChild(priceEl);
      info.appendChild(titleRow);

      if (rec.variantTitle) {
        var variantEl = document.createElement('div');
        variantEl.className = 'gleame-chat-product-variant';
        variantEl.textContent = rec.variantTitle;
        info.appendChild(variantEl);
      }

      if (rec.tagline) {
        var taglineEl = document.createElement('div');
        taglineEl.className = 'gleame-chat-product-tagline';
        // Wrap in curly quotes to match the mockup's italic-quote style.
        taglineEl.textContent = '“' + rec.tagline + '”';
        info.appendChild(taglineEl);
      }

      var cta = buildCardCta(rec);
      info.appendChild(cta.el);

      cardInner.appendChild(info);
      card.appendChild(cardInner);
      messagesContainer.appendChild(card);

      // One storefront lookup per card: fill the price and, for product-level
      // recs that have no specific variant id, resolve the product's default
      // variant so "View page" can deep-link the matched shade via ?variant=
      // (the curated 9-product configs come through as product-level recs).
      var handle = (rec.productHandle || '').trim();
      if (handle) {
        fetchProductJson(handle).then(function(pj) {
          if (!pj) return;
          var cents = priceCentsForRec(pj, rec);
          if (cents != null) priceEl.textContent = formatMoney(cents);
          if ((!rec.variantNumericId || !/^\d+$/.test(String(rec.variantNumericId))) &&
              Array.isArray(pj.variants) && pj.variants.length > 0) {
            cta.setVariantId(String(pj.variants[0].id));
          }
        });
      }
    });
  }

  // Card CTA: a single "View page" pill that navigates to the product page.
  // When a numeric variant id is known (directly, or resolved lazily via
  // setVariantId after the card's price lookup) the URL deep-links the
  // matched shade with ?variant=; with no handle at all it falls back to a
  // product search so the shopper is never stranded. Returns
  // { el, setVariantId }.
  function buildCardCta(rec) {
    var resolvedId = (rec.variantNumericId && /^\d+$/.test(String(rec.variantNumericId)))
      ? String(rec.variantNumericId) : null;
    var handle = (rec.productHandle || '').trim();

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gleame-chat-product-add-btn';
    btn.textContent = 'View page';

    function pdpUrl() {
      if (handle) {
        var u = '/products/' + encodeURIComponent(handle);
        if (resolvedId) u += '?variant=' + encodeURIComponent(resolvedId);
        return u;
      }
      return '/search?type=product&q=' + encodeURIComponent(rec.productName || rec.title || '');
    }

    btn.onclick = function() {
      trackEvent('chat_view_product');
      // Persist a closed-panel state before navigating so the conversation
      // restores quietly (pill only) on the product page instead of
      // reopening over it. pendingRequest is left as-is: if a request is
      // in flight (View page clicked on an older card mid-flow), the
      // navigation kills it and the saved flag lets restoreFromState show
      // its "interrupted" + Try again recovery on the next page.
      isOpen = false;
      unlockBodyScroll();
      saveState();
      window.location.href = pdpUrl();
    };

    return {
      el: btn,
      setVariantId: function(id) {
        if (id && /^\d+$/.test(String(id))) resolvedId = String(id);
      },
    };
  }

  // End-of-flow actions: a full-width "Try another look" restart, then the
  // curated footer line. (The "Save these" / heart affordances were removed
  // by request.)
  function renderEndActions(msg) {
    var count = (typeof msg.count === 'number') ? msg.count : 0;

    var wrap = document.createElement('div');
    wrap.className = 'gleame-chat-msg gleame-chat-msg-bot gleame-chat-msg-bot-action gleame-chat-end-actions';

    // Bundle card ("Love all N?") is disabled for now. To re-enable, uncomment
    // these three lines (buildBundleCard + addItemsToBag are kept intact below).
    //   var bundle = Array.isArray(msg.bundle) ? msg.bundle : [];
    //   var bundleEl = buildBundleCard(bundle);
    //   if (bundleEl) wrap.appendChild(bundleEl);

    var restartLabel = (config && config.endRestartLabel) || 'Try another look';
    var footerTemplate = (config && config.endFooter) || '';
    var footer = footerTemplate.replace(/\{count\}/g, String(count));

    var row = document.createElement('div');
    row.className = 'gleame-chat-end-actions-row';

    var restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.className = 'gleame-chat-end-action-btn';
    restartBtn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
      '<span>' + escapeHtml(restartLabel) + '</span>';
    restartBtn.onclick = function() {
      // Equivalent to clicking "Start a new search" — restarts the
      // recommend flow from the top.
      handleButtonClick('recommend', restartLabel, null);
    };

    row.appendChild(restartBtn);
    wrap.appendChild(row);

    if (footer) {
      var footerEl = document.createElement('div');
      footerEl.className = 'gleame-chat-end-footer';
      footerEl.textContent = footer;
      wrap.appendChild(footerEl);
    }

    messagesContainer.appendChild(wrap);
  }

  // DISABLED FOR NOW: renderEndActions does not call buildBundleCard, so the
  // bundle card never renders. Kept here (with addItemsToBag below) so it can
  // be re-enabled by restoring the commented call in renderEndActions.
  //
  // "Love all N?" bundle card. Resolves each item's price + variant id from
  // the storefront, then shows a single "Add all N to bag · $total" CTA that
  // posts every variant to the cart in one /cart/add.js call. Returns the
  // element (hidden until resolved) or null when there's nothing to bundle.
  // Note: the subtext does NOT promise a discount — there's no bundle pricing
  // wired up, so it stays factual ("…in one tap"). Override via config if a
  // real bundle offer exists.
  function buildBundleCard(bundle) {
    if (!Array.isArray(bundle) || bundle.length < 2) return null;
    // All copy + the on/off toggle come from chat-config (merchant-editable).
    var bundleCfg = (config && config.bundle) || {};
    if (bundleCfg.enabled === false) return null;

    var el = document.createElement('div');
    el.className = 'gleame-chat-bundle';
    el.style.display = 'none';

    var titleEl = document.createElement('div');
    titleEl.className = 'gleame-chat-bundle-title';
    var subEl = document.createElement('div');
    subEl.className = 'gleame-chat-bundle-sub';
    subEl.textContent = bundleCfg.subtext || 'Add your full match set in one tap.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gleame-chat-bundle-btn';
    el.appendChild(titleEl);
    el.appendChild(subEl);
    el.appendChild(btn);

    var lookups = bundle.map(function(item) {
      var handle = item && item.handle ? String(item.handle).trim() : '';
      if (!handle) return Promise.resolve(null);
      return fetchProductJson(handle).then(function(pj) {
        if (!pj) return null;
        var id = item.variantId;
        if ((!id || !/^\d+$/.test(String(id))) && Array.isArray(pj.variants) && pj.variants.length) {
          id = String(pj.variants[0].id);
        }
        if (!id || !/^\d+$/.test(String(id))) return null;
        var cents = null;
        if (Array.isArray(pj.variants)) {
          for (var i = 0; i < pj.variants.length; i++) {
            if (String(pj.variants[i].id) === String(id)) { cents = pj.variants[i].price; break; }
          }
        }
        if (typeof cents !== 'number') cents = pj.price;
        if (typeof cents !== 'number') return null;
        return { id: String(id), cents: cents };
      }).catch(function() { return null; });
    });

    Promise.all(lookups).then(function(results) {
      // De-dupe by variant id: if two recs resolve to the same variant (same
      // product recommended twice, or two product-level recs for one product),
      // we'd otherwise add it twice and double-count it in the total.
      var seen = {};
      var ok = [];
      for (var r = 0; r < results.length; r++) {
        var item = results[r];
        if (!item || seen[item.id]) continue;
        seen[item.id] = true;
        ok.push(item);
      }
      if (ok.length < 2) return; // not enough to bundle — leave hidden
      var ids = ok.map(function(x) { return x.id; });
      var total = ok.reduce(function(s, x) { return s + x.cents; }, 0);
      var n = ok.length;

      titleEl.textContent = (bundleCfg.title || 'Love all {count}?')
        .replace(/\{count\}/g, String(n));
      var idleLabel = (bundleCfg.button || 'Add all {count} to bag · {total}')
        .replace(/\{count\}/g, String(n))
        .replace(/\{total\}/g, formatMoney(total));
      btn.textContent = idleLabel;
      btn.onclick = function() {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('gleame-chat-bundle-btn-loading');
        btn.textContent = 'Adding…';
        addItemsToBag(ids)
          .then(function() {
            btn.classList.remove('gleame-chat-bundle-btn-loading');
            btn.classList.add('gleame-chat-bundle-btn-added');
            btn.textContent = 'Added ✓';
            trackEvent('chat_add_bundle_to_bag');
            setTimeout(function() {
              btn.classList.remove('gleame-chat-bundle-btn-added');
              btn.textContent = idleLabel;
              btn.disabled = false;
            }, 2000);
          })
          .catch(function(err) {
            console.error('Gleame Chat: bundle add failed', err);
            btn.classList.remove('gleame-chat-bundle-btn-loading');
            btn.textContent = 'Try again';
            setTimeout(function() {
              btn.textContent = idleLabel;
              btn.disabled = false;
            }, 1800);
          });
      };
      el.style.display = '';
    });

    return el;
  }

  // ---- Storefront product lookups (price + variant resolution) ----
  //
  // The widget runs on the merchant's storefront domain, so Shopify's
  // same-origin AJAX endpoints are available with no auth and no CORS.
  // /products/{handle}.js returns the product JSON including `price` (the
  // min variant price, in cents) and `variants[]` (each with `id` + `price`
  // in cents). We use it for two things: showing the price on each card, and
  // resolving a default variant id for product-level recommendations so
  // "Add to bag" still works when the rec has no specific variant.
  //
  // Cached per handle (Promise) so repeated cards / the bundle card don't
  // refetch the same product.

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

  // cents for a recommendation: the matched variant's price when we have a
  // variant id, else the product's (min) price. Returns null if unknown.
  function priceCentsForRec(pj, rec) {
    if (!pj) return null;
    if (rec.variantNumericId && Array.isArray(pj.variants)) {
      for (var i = 0; i < pj.variants.length; i++) {
        if (String(pj.variants[i].id) === String(rec.variantNumericId)) {
          return typeof pj.variants[i].price === 'number' ? pj.variants[i].price : null;
        }
      }
    }
    // Product-level rec: "Add to bag" (and the bundle) use the default — first
    // — variant, so show ITS price, not pj.price (the catalog MIN, which can be
    // a cheaper shade). Keeps the card price, the cart, and the bundle total in
    // agreement when a product has variants at differing prices.
    if (Array.isArray(pj.variants) && pj.variants.length > 0 &&
        typeof pj.variants[0].price === 'number') {
      return pj.variants[0].price;
    }
    return typeof pj.price === 'number' ? pj.price : null;
  }

  // Format cents in the shop's active currency ("$10.50"). Falls back to a
  // bare dollar string if Intl / Shopify.currency aren't available.
  function formatMoney(cents) {
    var amount = (Number(cents) || 0) / 100;
    try {
      var code = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD';
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount);
    } catch (e) {
      return '$' + amount.toFixed(2);
    }
  }

  // Multi-add for the bundle CTA. Shopify /cart/add.js accepts an `items`
  // array; mirrors addToBag's success / soft-failure handling + cart events.
  function addItemsToBag(variantIds) {
    var items = [];
    for (var i = 0; i < variantIds.length; i++) {
      items.push({ id: Number(variantIds[i]) || variantIds[i], quantity: 1 });
    }
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: items }),
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
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: { source: 'gleame-chat' } }));
          document.dispatchEvent(new CustomEvent('cart:refresh', { detail: { source: 'gleame-chat' } }));
        } catch (e) { /* old browsers without CustomEvent — ignore */ }
        return body;
      });
    });
  }

  // Shopify AJAX cart. Posted to /cart/add.js relative to the storefront
  // domain — same origin as the widget, so no CORS. Currently unused — the
  // per-card CTA navigates to the product page instead — but kept alongside
  // addItemsToBag for the disabled bundle path / easy re-enable.
  //
  // Note on Shopify's response shape: success returns the added line item
  // (has product_id / variant_id / title); SOFT failures (out of stock,
  // sell-with restriction, exceeded max-quantity) return HTTP 200 with a
  // body like `{status: 422, message: "...", description: "..."}`. So
  // res.ok is necessary but not sufficient — we also inspect the body.
  //
  // On success we dispatch theme cart-update events so the storefront's
  // cart icon refreshes its count badge without a full page reload.
  // Dawn-class themes listen for cart:updated; older / custom themes
  // commonly listen for cart:refresh — dispatching both is the
  // belt-and-braces version.
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
        // Soft-failure: HTTP 200 with an error body. Shopify's convention
        // is a `status` field set to the HTTP-equivalent error code.
        if (body && typeof body.status === 'number' && body.status >= 400) {
          throw new Error(body.description || body.message || ('cart add soft-failure: ' + body.status));
        }
        // Success — let the theme update its cart UI.
        try {
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: { source: 'gleame-chat' } }));
          document.dispatchEvent(new CustomEvent('cart:refresh', { detail: { source: 'gleame-chat' } }));
        } catch (e) { /* old browsers without CustomEvent — ignore */ }
        return body;
      });
    });
  }

  function removeLoadingMsg() {
    if (loadingStepInterval) {
      clearInterval(loadingStepInterval);
      loadingStepInterval = null;
    }
    var textEl = document.getElementById('gleame-chat-loading-text-msg');
    if (textEl && textEl.parentNode) textEl.parentNode.removeChild(textEl);
    var el = document.getElementById('gleame-chat-loading-msg');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---- Utilities ----
  function scrollToBottom() {
    if (messagesContainer) {
      setTimeout(function() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 50);
    }
  }

  function scrollAnchorToTop(el) {
    if (!messagesContainer || !el) return;
    setTimeout(function() {
      if (!messagesContainer.contains(el)) return;
      var rect = el.getBoundingClientRect();
      var contRect = messagesContainer.getBoundingClientRect();
      messagesContainer.scrollTop += rect.top - contRect.top;
    }, 50);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function trackEvent(eventType) {
    try {
      fetch(SHOPIFY_APP_URL + '/api/storefront/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: shopDomain,
          eventType: eventType,
          widgetType: 'chat',
          productId: null,
        }),
      }).catch(function() {});
    } catch (e) {}
  }

  // Keep scroll lock state in sync with viewport size — e.g. rotating from
  // landscape to portrait can flip the panel between docked and fullscreen.
  function handleViewportChange() {
    if (!isOpen) return;
    if (isPanelFullscreen()) lockBodyScroll();
    else unlockBodyScroll();
  }
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', handleViewportChange);

  // Expose minimal API for debugging / external triggers
  window.gleameChat.clearState = clearState;

  // ---- Start ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
