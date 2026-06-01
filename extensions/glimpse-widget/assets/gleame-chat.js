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
  //   user-image     { type } (transient image preview; dataUrl not persisted)
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
        // Strip large transient fields before persisting
        if (m.type === 'user-image') return { type: 'user-image' };
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
    // restoreFromState path injects a "request cancelled" message instead).
    var hasResults = messages.some(function(m) { return m.type === 'bot-cards'; });
    setHeaderStatus(hasResults ? 'done' : 'idle');

    trackEvent('widget_view');
  }

  function applyColors() {
    root.style.setProperty('--gleame-chat-bubble-color', config.bubbleColor || '#1f2937');
    root.style.setProperty('--gleame-chat-accent-color', config.accentColor || '#8b5cf6');
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
    // Cap client-side as a defense in depth against any future API drift
    // (server already caps at 4). Without this, an unexpected 10-tile
    // payload would scrunch the CSS grid.
    var swatches = Array.isArray(heroCfg.swatches) ? heroCfg.swatches.slice(0, 4) : [];
    if (swatches.length >= 2) {
      var swatchTiles = swatches.map(function(s) {
        var color = (s && s.color) ? s.color : '#e5e7eb';
        // Inline style is necessary because the color comes from data, not CSS.
        // escapeHtml on the label; raw `color` is restricted to the hex set
        // we get from display_color in Supabase (validated server-side).
        return (
          '<div class="gleame-hero-sample" style="background:' + sanitizeColor(color) + '">' +
            (s && s.label ? '<span class="gleame-hero-sample-label-text">' + escapeHtml(s.label) + '</span>' : '') +
          '</div>'
        );
      }).join('');
      swatchesHtml =
        (heroCfg.sampleLabel ? '<div class="gleame-hero-sample-label">' + escapeHtml(heroCfg.sampleLabel) + '</div>' : '') +
        '<div class="gleame-hero-samples">' + swatchTiles + '</div>';
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
      startConversation();
    }

    saveState();
    trackEvent('chat_open');
  }

  // Open path from the hero CTA. The hero already delivered the value pitch
  // and the explicit "start" action, so skip the chat's intro greeting +
  // "Find my perfect shade" button and jump straight to the preference
  // question. Only fires for fresh sessions — the init() flow short-circuits
  // to restoreFromState when there are saved messages, so this is never
  // reached mid-conversation.
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
      startConversationFromHero();
    }

    saveState();
    trackEvent('chat_open');
  }

  function closeChat() {
    if (!isOpen) return;
    isOpen = false;

    // Abort any pending recommendation request and leave a recovery point
    // so reopening doesn't strand the user mid-loading. Header status
    // returns to idle so the next open doesn't show "Working on it…" for
    // a request that's no longer running.
    if (inFlightRequest) {
      try { inFlightRequest.abort(); } catch (e) {}
      inFlightRequest = null;
      removeLoadingMsg();
      setHeaderStatus('idle');
      pushMessage({ type: 'bot-text', text: "Your request was cancelled." });
      pushMessage({ type: 'bot-buttons', buttons: [{ label: 'Try again', action: 'recommend' }], consumed: false });
      conversationEnded = true;
    }
    pendingRequest = false;

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
  function startConversation() {
    pushMessage({ type: 'bot-text', text: config.greetingMessage });
    pushMessage({
      type: 'bot-buttons',
      buttons: [{ label: config.recommendButtonText || 'Find my perfect shade', action: 'recommend' }],
      consumed: false,
    });
  }

  // Entry point when the user came in through the hero CTA. Skips the
  // chat's intro greeting + "Find my perfect shade" button (the hero
  // already played that role) and starts the recommendation flow directly.
  function startConversationFromHero() {
    trackEvent('chat_recommend_start');
    conversationEnded = false;
    criteria = {};
    questionIndex = 0;
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

  function handlePhotoUpload(file, uploadMsg) {
    trackEvent('chat_photo_upload');

    // Mark upload widget as consumed
    if (uploadMsg) uploadMsg.consumed = true;

    // Show user image preview transiently (not persisted with dataUrl)
    pushMessage({ type: 'user-image' });
    var lastImageEl = messagesContainer.lastChild;
    var reader = new FileReader();
    reader.onload = function(e) {
      // Replace the placeholder with the actual preview
      if (lastImageEl && lastImageEl.parentNode) {
        var img = lastImageEl.querySelector('img');
        if (img) img.src = e.target.result;
      }
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
  // API returns. (The standalone "Working on your recommendations…"
  // caption row + Gleame logo were removed — redundant with the header
  // status line which already shows "Working on it…".)
  var LOADING_STEPS_FALLBACK = [
    'Analyzing your photo',
    'Personalizing results',
    'Visualizing your picks',
  ];
  var loadingStepInterval = null;

  // Renders the loading state: accent-color halo with sparkle + 3-step
  // checklist that ticks off on a cosmetic timer.
  function renderLoadingSpinner() {
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

    var stepsHtml = steps.map(function(label, i) {
      return (
        '<li class="gleame-chat-loading-hero-step" data-step="' + i + '">' +
          '<span class="gleame-chat-loading-hero-step-mark" aria-hidden="true"></span>' +
          '<span class="gleame-chat-loading-hero-step-label">' + escapeHtml(label) + '</span>' +
        '</li>'
      );
    }).join('');

    wrap.innerHTML =
      '<div class="gleame-chat-loading-hero-halo" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3.5l1.3 3.8L17 8.5l-3.7 1.3L12 13.5l-1.3-3.7L7 8.5l3.7-1.2z"/>' +
          '<path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" opacity=".7"/>' +
        '</svg>' +
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
      if (!isOpen) { saveState(); return; }
      removeLoadingMsg();
      if (data.recommendations && data.recommendations.length > 0) {
        setHeaderStatus('done', data.recommendations.length);
        pushMessage({ type: 'bot-text', text: "Here's what I found for you! ✨" });
        pushMessage({ type: 'bot-cards', recommendations: data.recommendations });
        pushMessage({ type: 'bot-buttons', buttons: [{ label: 'Start a new search', action: 'recommend' }], consumed: false });
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
      if (!isOpen) { saveState(); return; }
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
        renderImagePreview();
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

  function renderImagePreview() {
    var imgMsg = document.createElement('div');
    imgMsg.className = 'gleame-chat-msg gleame-chat-msg-user';
    var img = document.createElement('img');
    img.className = 'gleame-chat-msg-image';
    img.alt = 'Your photo';
    img.style.maxHeight = '200px';
    img.style.borderRadius = '12px';
    img.style.background = '#f3f4f6';
    img.style.minWidth = '120px';
    img.style.minHeight = '120px';
    imgMsg.appendChild(img);
    messagesContainer.appendChild(imgMsg);
  }

  function renderButtons(msgRecord) {
    var wrap = document.createElement('div');
    // Action rows (question options, "Try again", "Start a new search")
    // want the same full-width treatment as the upload widget so the pill
    // buttons inside reach the messages-container edges instead of being
    // capped at 85% via the bubble rule.
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

  function renderProductCards(recommendations) {
    recommendations.forEach(function(rec, idx) {
      var card = document.createElement('div');
      card.className = 'gleame-chat-msg gleame-chat-msg-bot gleame-chat-card-enter';
      card.style.animationDelay = (idx * 90) + 'ms';

      var cardInner = document.createElement('div');
      cardInner.className = 'gleame-chat-product-card';

      if (rec.tryOnPreview) {
        var previewImg = document.createElement('img');
        previewImg.className = 'gleame-chat-product-image gleame-chat-image-reveal';
        previewImg.style.animationDelay = (idx * 90) + 'ms';
        previewImg.src = 'data:image/jpeg;base64,' + rec.tryOnPreview;
        previewImg.alt = rec.title || '';
        previewImg.onerror = function() { previewImg.style.display = 'none'; };
        cardInner.appendChild(previewImg);
      }

      var info = document.createElement('div');
      info.className = 'gleame-chat-product-info';

      var titleEl = document.createElement('div');
      titleEl.className = 'gleame-chat-product-title';
      titleEl.textContent = rec.productName || rec.title || '';
      info.appendChild(titleEl);

      if (rec.variantTitle) {
        var variantEl = document.createElement('div');
        variantEl.className = 'gleame-chat-product-variant';
        variantEl.textContent = rec.variantTitle;
        info.appendChild(variantEl);
      }

      var shopLink = document.createElement('a');
      shopLink.className = 'gleame-chat-product-shop-btn';
      shopLink.target = '_top';
      var handle = (rec.productHandle || '').trim();
      if (handle) {
        var url = '/products/' + encodeURIComponent(handle);
        if (rec.variantNumericId) url += '?variant=' + encodeURIComponent(rec.variantNumericId);
        shopLink.href = url;
      } else {
        var searchQuery = rec.productName || rec.title || '';
        shopLink.href = '/search?type=product&q=' + encodeURIComponent(searchQuery);
      }
      shopLink.textContent = 'Shop This';
      // Mark chat as closed before navigating — otherwise the saved state
      // (isOpen: true) auto-reopens the fullscreen panel on the destination
      // page and covers the product the user just tapped to see.
      shopLink.addEventListener('click', function() {
        isOpen = false;
        pendingRequest = false;
        unlockBodyScroll();
        saveState();
      });
      info.appendChild(shopLink);

      cardInner.appendChild(info);
      card.appendChild(cardInner);
      messagesContainer.appendChild(card);
    });
  }

  function removeLoadingMsg() {
    if (loadingStepInterval) {
      clearInterval(loadingStepInterval);
      loadingStepInterval = null;
    }
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
