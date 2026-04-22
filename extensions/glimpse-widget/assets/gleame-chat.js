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

  // ---- Session-only state ----
  var config = null;
  var greetingShown = false;
  var inFlightRequest = null;

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
  function init() {
    fetch(SHOPIFY_APP_URL + '/api/storefront/chat-config?shopDomain=' + encodeURIComponent(shopDomain))
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data.enabled) return;
      config = data;
      root.style.display = '';
      applyColors();
      renderBubble();

      var saved = loadState();
      if (saved && Array.isArray(saved.messages) && saved.messages.length > 0) {
        restoreFromState(saved);
      } else {
        scheduleGreeting();
        trackEvent('widget_view');
      }
    })
    .catch(function(err) {
      console.error('Gleame Chat: config fetch failed', err);
    });
  }

  function restoreFromState(saved) {
    messages = saved.messages || [];
    greetingDismissed = !!saved.greetingDismissed;
    conversationEnded = !!saved.conversationEnded;
    preference = saved.preference || null;
    panelExpanded = !!saved.panelExpanded;

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
    }

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

  // ---- Chat panel ----
  function toggleChat() {
    if (isOpen) closeChat();
    else openChat();
  }

  function openChat() {
    if (isOpen) return;
    isOpen = true;
    dismissGreeting();

    if (!panel) buildPanel();
    panel.classList.add('gleame-chat-visible');
    updateBubbleIcon(true);

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

  function closeChat() {
    if (!isOpen) return;
    isOpen = false;

    // Abort any pending recommendation request and leave a recovery point
    // so reopening doesn't strand the user mid-loading.
    if (inFlightRequest) {
      try { inFlightRequest.abort(); } catch (e) {}
      inFlightRequest = null;
      removeLoadingMsg();
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
    saveState();
  }

  function resetConversation() {
    messages = [];
    conversationEnded = false;
    preference = null;
    pendingRequest = false;
    if (messagesContainer) {
      while (messagesContainer.firstChild) {
        messagesContainer.removeChild(messagesContainer.firstChild);
      }
    }
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
      avatarWrap.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }

    var info = document.createElement('div');
    info.className = 'gleame-chat-header-info';
    info.innerHTML =
      '<div class="gleame-chat-header-name">' + escapeHtml(config.assistantName) + '</div>' +
      '<div class="gleame-chat-header-status">Online</div>';

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

    // Disclaimer — privacy notice with link
    var disclaimer = document.createElement('div');
    disclaimer.className = 'gleame-chat-disclaimer';
    disclaimer.innerHTML =
      'This assistant is powered by Gleame AI. Any photos you submit are processed in real time to generate personalized recommendations and are not stored. For more information, see our ' +
      '<a class="gleame-chat-disclaimer-link" href="https://www.gleame.ai/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.';

    panel.appendChild(header);
    panel.appendChild(messagesContainer);
    panel.appendChild(disclaimer);
    root.appendChild(panel);
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

  function handleButtonClick(action, label, sourceMsg) {
    // Mark the button group as consumed so it doesn't re-render after reload
    if (sourceMsg) {
      sourceMsg.consumed = true;
    }
    pushMessage({ type: 'user-text', text: label });

    if (action === 'recommend') {
      trackEvent('chat_recommend_start');
      // If we're restarting after a finished flow, allow further messages
      conversationEnded = false;

      pushMessage({ type: 'bot-text', text: config.preferenceQuestion || 'What kind of look are you going for?' });
      var configured = config.preferenceOptions;
      var options = (Array.isArray(configured) && configured.length > 0)
        ? configured
        : ['Natural', 'Bold', 'Glossy', 'Surprise me'];
      var buttons = options.map(function(opt) {
        return { label: opt, action: 'preference:' + opt };
      });
      pushMessage({ type: 'bot-buttons', buttons: buttons, consumed: false });
      return;
    }

    if (action.indexOf('preference:') === 0) {
      preference = action.replace('preference:', '');

      var photoMsg = config.photoUploadMessage
        || "Take a photo or upload one and I'll show you what looks best on you!";
      pushMessage({ type: 'bot-text', text: photoMsg });
      pushMessage({ type: 'bot-upload', consumed: false });
    }
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

  var LOADING_PHRASES = [
    'Analyzing characteristics',
    'Personalizing results',
    'Applying to your photo',
    'Finishing touches',
  ];
  var loadingPhraseInterval = null;

  var GLEAME_LOADING_LOGO_SVG =
    '<svg class="gleame-chat-loading-logo" viewBox="0 0 518 530" fill="none" aria-hidden="true">' +
      '<path class="gleame-chat-loading-logo-p1" d="M270.314 21.0001V21.3223C132.622 21.3223 21 134.639 21 274.421C21 373.976 63.8516 451.773 146.184 493.102C136.046 487.808 140.348 490.009 131.677 483.036C95.6525 454.069 73.3975 410.683 73.3975 353.101C73.3975 238.649 161.317 145.689 270.222 144.641V144.632H365.396C432.655 144.632 487.18 89.2798 487.18 21.0001H270.314Z" fill="url(#gleame-loading-grad1)"/>' +
      '<path class="gleame-chat-loading-logo-p2" d="M143.264 490.907C161.826 494.411 179.736 492.577 197.451 489.147C227.389 483.351 254.31 469.192 279.928 450.049C322.499 418.236 353.942 370.527 362.189 319.712L245.748 320.816C245.34 320.82 244.969 320.658 244.696 320.392C244.156 319.976 243.945 319.226 244.23 318.568L260.097 281.892L260.103 281.878L260.113 281.851C260.132 281.805 260.161 281.735 260.196 281.648C260.269 281.47 260.374 281.206 260.514 280.868C260.792 280.19 261.2 279.207 261.716 277.988C262.748 275.548 264.217 272.153 265.964 268.333C269.449 260.715 274.077 251.33 278.575 244.466C279.888 242.463 281.471 240.299 283.21 238.07C298.966 217.878 324.122 208.61 349.256 208.61C349.323 208.61 349.396 208.602 349.461 208.61L517.133 208.625V278.334C517.133 321.827 506.415 364.629 485.955 402.843L484.308 405.919C473.542 426.026 459.96 444.444 443.988 460.594C397.154 507.947 332.574 533.89 266.751 526.843C245.836 524.604 226.787 521.983 215.711 519.085C197.963 514.44 159.247 497.551 142.338 490.907C140.985 490.488 141.95 490.659 143.264 490.907Z" fill="url(#gleame-loading-grad2)"/>' +
      '<defs>' +
        '<linearGradient id="gleame-loading-grad1" x1="489.18" y1="274.26" x2="19" y2="274.26" gradientUnits="userSpaceOnUse">' +
          '<stop stop-color="#FAFAFA"/>' +
          '<stop offset="0.740385" stop-color="#6A2393"/>' +
          '<stop offset="1" stop-color="#4B0A4B"/>' +
        '</linearGradient>' +
        '<linearGradient id="gleame-loading-grad2" x1="517.133" y1="368.297" x2="141.684" y2="368.297" gradientUnits="userSpaceOnUse">' +
          '<stop stop-color="white"/>' +
          '<stop offset="0.571225" stop-color="#56077B"/>' +
        '</linearGradient>' +
      '</defs>' +
    '</svg>';

  function renderLoadingSpinner() {
    var wrap = document.createElement('div');
    wrap.id = 'gleame-chat-loading-msg';
    wrap.className = 'gleame-chat-msg gleame-chat-msg-bot gleame-chat-loading-row';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');

    var logo = document.createElement('span');
    logo.className = 'gleame-chat-loading-logo-wrap';
    logo.setAttribute('aria-hidden', 'true');
    logo.innerHTML = GLEAME_LOADING_LOGO_SVG;

    var text = document.createElement('span');
    text.className = 'gleame-chat-loading-text';
    text.textContent = LOADING_PHRASES[0];

    wrap.appendChild(logo);
    wrap.appendChild(text);
    messagesContainer.appendChild(wrap);
    scrollToBottom();

    var idx = 0;
    loadingPhraseInterval = setInterval(function() {
      if (idx >= LOADING_PHRASES.length - 1) {
        clearInterval(loadingPhraseInterval);
        loadingPhraseInterval = null;
        return;
      }
      idx++;
      var next = LOADING_PHRASES[idx];
      text.style.opacity = '0';
      setTimeout(function() {
        text.textContent = next;
        text.style.opacity = '1';
      }, 120);
    }, 6000);
  }

  function sendRecommendation(file) {
    var formData = new FormData();
    formData.append('image', file);
    formData.append('shopDomain', shopDomain);
    formData.append('preference', preference || '');

    if (inFlightRequest) {
      try { inFlightRequest.abort(); } catch (e) {}
    }
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    inFlightRequest = controller;
    pendingRequest = true;
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
        pushMessage({ type: 'bot-text', text: "Here's what I found for you! ✨" });
        pushMessage({ type: 'bot-cards', recommendations: data.recommendations });
        pushMessage({ type: 'bot-buttons', buttons: [{ label: 'Start a new search', action: 'recommend' }], consumed: false });
        trackEvent('chat_recommendation_shown');
        conversationEnded = true;
        saveState();
      } else {
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
    messages.forEach(function(m) { renderMessage(m); });
  }

  function renderMessage(m) {
    if (!messagesContainer) return;
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
        renderProductCards(m.recommendations || []);
        break;
    }
    scrollToBottom();
  }

  function renderTextBubble(text, role) {
    var msg = document.createElement('div');
    msg.className = 'gleame-chat-msg gleame-chat-msg-' + role;
    msg.innerHTML = '<div class="gleame-chat-msg-bubble">' + escapeHtml(text) + '</div>';
    messagesContainer.appendChild(msg);
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
    wrap.className = 'gleame-chat-msg gleame-chat-msg-bot';

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
    uploadWrap.className = 'gleame-chat-msg gleame-chat-msg-bot';

    var btnGroup = document.createElement('div');
    btnGroup.className = 'gleame-chat-upload';

    var uploadBtn = document.createElement('button');
    uploadBtn.className = 'gleame-chat-upload-btn';
    uploadBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
      '<span>Upload a Photo</span>';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    uploadBtn.onclick = function() {
      if (msgRecord.consumed) return;
      fileInput.click();
    };
    fileInput.onchange = function(e) {
      var file = e.target.files && e.target.files[0];
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
    };

    var cameraBtn = document.createElement('button');
    cameraBtn.className = 'gleame-chat-upload-btn';
    cameraBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>' +
      '<span>Take a Photo</span>';

    cameraBtn.onclick = function() {
      if (msgRecord.consumed) return;
      if (window.gleameCamera) {
        window.gleameCamera.open(
          function(file) {
            if (uploadWrap.parentNode) uploadWrap.parentNode.removeChild(uploadWrap);
            handlePhotoUpload(file, msgRecord);
          },
          function() { fileInput.click(); }
        );
      } else {
        fileInput.setAttribute('capture', 'user');
        fileInput.click();
        fileInput.removeAttribute('capture');
      }
    };

    btnGroup.appendChild(uploadBtn);
    if (!isMobile()) {
      btnGroup.appendChild(cameraBtn);
    }
    btnGroup.appendChild(fileInput);
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
      info.appendChild(shopLink);

      cardInner.appendChild(info);
      card.appendChild(cardInner);
      messagesContainer.appendChild(card);
    });
  }

  function removeLoadingMsg() {
    if (loadingPhraseInterval) {
      clearInterval(loadingPhraseInterval);
      loadingPhraseInterval = null;
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

  // Expose minimal API for debugging / external triggers
  window.gleameChat.clearState = clearState;

  // ---- Start ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
