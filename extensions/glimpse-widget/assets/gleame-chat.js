// Gleame AI Chat Assistant v1.0
// Global app embed — floating chat bubble + recommendation flow
console.log('Gleame Chat Assistant v1.0 loaded');

(function() {
  'use strict';

  window.gleameChat = window.gleameChat || {};

  var SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  var root = document.getElementById('gleame-chat-root');
  if (!root) return;

  var shopDomain = root.getAttribute('data-shop-domain') || '';
  if (!shopDomain) {
    // Fallback detection
    if (window.Shopify && window.Shopify.shop) shopDomain = window.Shopify.shop;
    else shopDomain = window.location.hostname;
  }

  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /Mobi/.test(navigator.userAgent));
  }

  // ---- State ----
  var config = null;
  var isOpen = false;
  var greetingShown = false;
  var greetingDismissed = false;
  var messages = [];
  var conversationEnded = false;
  var inFlightRequest = null; // AbortController for pending recommend fetch

  // ---- DOM refs ----
  var bubble = null;
  var greetingEl = null;
  var panel = null;
  var messagesContainer = null;
  var expandBtn = null;
  var expandSvgStr = '';
  var shrinkSvgStr = '';

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
      scheduleGreeting();
      trackEvent('widget_view');
    })
    .catch(function(err) {
      console.error('Gleame Chat: config fetch failed', err);
    });
  }

  function applyColors() {
    root.style.setProperty('--gleame-chat-bubble-color', config.bubbleColor || '#1f2937');
    root.style.setProperty('--gleame-chat-accent-color', config.accentColor || '#8b5cf6');
  }

  // ---- Bubble ----
  function renderBubble() {
    bubble = document.createElement('button');
    bubble.className = 'gleame-chat-bubble';
    bubble.setAttribute('aria-label', 'Open chat');
    bubble.onclick = toggleChat;

    if (config.avatarUrl) {
      var img = document.createElement('img');
      img.src = config.avatarUrl;
      img.alt = config.assistantName;
      img.className = 'gleame-chat-bubble-avatar';
      bubble.appendChild(img);
    } else {
      bubble.innerHTML = '<svg class="gleame-chat-bubble-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    }

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

    // Trigger animation
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        greetingEl.classList.add('gleame-chat-visible');
      });
    });

    // Auto-dismiss after 8 seconds
    setTimeout(function() {
      if (!greetingDismissed) dismissGreeting();
    }, 8000);
  }

  function dismissGreeting() {
    greetingDismissed = true;
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

    // Update bubble to show X
    updateBubbleIcon(true);

    // Start conversation if first time, or restart if previous flow ended
    if (messages.length === 0 || conversationEnded) {
      resetConversation();
      startConversation();
    }

    trackEvent('chat_open');
  }

  function closeChat() {
    if (!isOpen) return;
    isOpen = false;

    // Abort any pending recommendation request
    if (inFlightRequest) {
      try { inFlightRequest.abort(); } catch (e) {}
      inFlightRequest = null;
    }

    if (panel) {
      panel.classList.remove('gleame-chat-visible');
      // Reset expand state so reopen always starts collapsed
      if (panel.classList.contains('gleame-chat-expanded')) {
        panel.classList.remove('gleame-chat-expanded');
        if (expandBtn) {
          expandBtn.innerHTML = expandSvgStr;
          expandBtn.setAttribute('aria-label', 'Expand');
        }
      }
    }
    updateBubbleIcon(false);
  }

  function resetConversation() {
    messages = [];
    conversationEnded = false;
    if (messagesContainer) {
      while (messagesContainer.firstChild) {
        messagesContainer.removeChild(messagesContainer.firstChild);
      }
    }
    if (window.gleameChat) window.gleameChat._preference = null;
  }

  function updateBubbleIcon(showClose) {
    if (!bubble) return;
    if (showClose) {
      bubble.innerHTML = '<svg class="gleame-chat-bubble-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    } else {
      bubble.innerHTML = '';
      if (config.avatarUrl) {
        var img = document.createElement('img');
        img.src = config.avatarUrl;
        img.alt = config.assistantName;
        img.className = 'gleame-chat-bubble-avatar';
        bubble.appendChild(img);
      } else {
        bubble.innerHTML = '<svg class="gleame-chat-bubble-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      }
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
      var isExpanded = panel.classList.toggle('gleame-chat-expanded');
      expandBtn.innerHTML = isExpanded ? shrinkSvgStr : expandSvgStr;
      expandBtn.setAttribute('aria-label', isExpanded ? 'Shrink' : 'Expand');
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

    panel.appendChild(header);
    panel.appendChild(messagesContainer);
    root.appendChild(panel);
  }

  // ---- Conversation ----
  function startConversation() {
    addBotMessage(config.greetingMessage);

    // Show recommend button
    setTimeout(function() {
      addBotButtons([
        { label: config.recommendButtonText || 'Find my perfect shade', action: 'recommend' }
      ]);
    }, 500);
  }

  function handleButtonClick(action, label) {
    // Show user's choice as a message
    addUserMessage(label);

    if (action === 'recommend') {
      trackEvent('chat_recommend_start');

      setTimeout(function() {
        addBotMessage(config.preferenceQuestion || 'What kind of look are you going for?');
        setTimeout(function() {
          var configured = config.preferenceOptions;
          var options = (Array.isArray(configured) && configured.length > 0)
            ? configured
            : ['Natural', 'Bold', 'Glossy', 'Surprise me'];
          var buttons = options.map(function(opt) {
            return { label: opt, action: 'preference:' + opt };
          });
          addBotButtons(buttons);
        }, 300);
      }, 400);
      return;
    }

    if (action.indexOf('preference:') === 0) {
      var preference = action.replace('preference:', '');

      setTimeout(function() {
        var photoMsg = isMobile()
          ? "Upload a photo and I'll show you what looks best on you!"
          : "Take a photo or upload one and I'll show you what looks best on you!";
        addBotMessage(photoMsg);
        setTimeout(function() { showUploadButton(); }, 300);
      }, 400);

      // Store preference for later
      window.gleameChat._preference = preference;
    }
  }

  function showUploadButton() {
    var uploadWrap = document.createElement('div');
    uploadWrap.className = 'gleame-chat-msg gleame-chat-msg-bot';

    var btnGroup = document.createElement('div');
    btnGroup.className = 'gleame-chat-upload';

    // Upload a Photo button
    var uploadBtn = document.createElement('button');
    uploadBtn.className = 'gleame-chat-upload-btn';
    uploadBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
      '<span>Upload a Photo</span>';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    uploadBtn.onclick = function() { fileInput.click(); };
    fileInput.onchange = function(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/') && !file.name.match(/\.(heic|heif)$/i)) {
        addBotMessage('Please upload an image file (JPG, PNG, etc.).');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        addBotMessage('Image too large. Please upload one under 5MB.');
        return;
      }
      handlePhotoUpload(file);
    };

    // Take a Photo button
    var cameraBtn = document.createElement('button');
    cameraBtn.className = 'gleame-chat-upload-btn';
    cameraBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>' +
      '<span>Take a Photo</span>';

    cameraBtn.onclick = function() {
      if (window.gleameCamera) {
        window.gleameCamera.open(
          function(file) { handlePhotoUpload(file); },
          function() { fileInput.click(); }
        );
      } else {
        // Fallback: open file picker with camera capture hint
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
    scrollToBottom();
  }

  function handlePhotoUpload(file) {
    trackEvent('chat_photo_upload');

    // Show image preview as user message
    var reader = new FileReader();
    reader.onload = function(e) {
      var imgMsg = document.createElement('div');
      imgMsg.className = 'gleame-chat-msg gleame-chat-msg-user';
      var img = document.createElement('img');
      img.src = e.target.result;
      img.className = 'gleame-chat-msg-image';
      img.style.maxHeight = '200px';
      img.style.borderRadius = '12px';
      imgMsg.appendChild(img);
      messagesContainer.appendChild(imgMsg);
      scrollToBottom();
    };
    reader.readAsDataURL(file);

    // Show generating feedback with spinner
    setTimeout(function() {
      var loadingMsg = document.createElement('div');
      loadingMsg.className = 'gleame-chat-msg gleame-chat-msg-bot';
      loadingMsg.id = 'gleame-chat-loading-msg';
      var loadingBubble = document.createElement('div');
      loadingBubble.className = 'gleame-chat-msg-bubble';
      loadingBubble.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;margin-right:8px;animation:gleame-chat-spin 0.8s linear infinite"><circle cx="12" cy="12" r="10" stroke="#9ca3af" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg>Generating your personalized look...';
      loadingMsg.appendChild(loadingBubble);
      messagesContainer.appendChild(loadingMsg);
      scrollToBottom();
      sendRecommendation(file);
    }, 600);
  }

  function sendRecommendation(file) {
    var formData = new FormData();
    formData.append('image', file);
    formData.append('shopDomain', shopDomain);
    formData.append('preference', window.gleameChat._preference || '');

    // Abort any earlier in-flight request and register the new one
    if (inFlightRequest) {
      try { inFlightRequest.abort(); } catch (e) {}
    }
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    inFlightRequest = controller;

    fetch(SHOPIFY_APP_URL + '/api/storefront/chat-recommend', {
      method: 'POST',
      body: formData,
      signal: controller ? controller.signal : undefined,
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (inFlightRequest !== controller) return; // stale response
      inFlightRequest = null;
      if (!isOpen) return; // user closed the panel mid-request
      removeLoadingMsg();
      if (data.recommendations && data.recommendations.length > 0) {
        addBotMessage("Here's what I found for you! ✨");
        setTimeout(function() {
          showProductCards(data.recommendations);
          trackEvent('chat_recommendation_shown');
          conversationEnded = true;
        }, 400);
      } else {
        addBotMessage("Sorry, I couldn't find a match right now.");
        showTryAgainButton();
        conversationEnded = true;
      }
    })
    .catch(function(err) {
      if (err && err.name === 'AbortError') return;
      if (inFlightRequest !== controller) return;
      inFlightRequest = null;
      if (!isOpen) return;
      removeLoadingMsg();
      console.error('Gleame Chat: recommend error', err);
      addBotMessage("Something went wrong. Please try again!");
      showTryAgainButton();
      conversationEnded = true;
    });
  }

  function showTryAgainButton() {
    addBotButtons([
      { label: 'Try again', action: 'recommend' }
    ]);
  }

  // ---- Message helpers ----
  function addBotMessage(text) {
    var msg = document.createElement('div');
    msg.className = 'gleame-chat-msg gleame-chat-msg-bot';
    msg.innerHTML = '<div class="gleame-chat-msg-bubble">' + escapeHtml(text) + '</div>';
    messagesContainer.appendChild(msg);
    messages.push({ role: 'bot', text: text });
    scrollToBottom();
  }

  function addUserMessage(text) {
    var msg = document.createElement('div');
    msg.className = 'gleame-chat-msg gleame-chat-msg-user';
    msg.innerHTML = '<div class="gleame-chat-msg-bubble">' + escapeHtml(text) + '</div>';
    messagesContainer.appendChild(msg);
    messages.push({ role: 'user', text: text });
    scrollToBottom();
  }

  function addBotButtons(buttons) {
    var wrap = document.createElement('div');
    wrap.className = 'gleame-chat-msg gleame-chat-msg-bot';

    var btnGroup = document.createElement('div');
    btnGroup.className = 'gleame-chat-buttons';

    buttons.forEach(function(btn) {
      var el = document.createElement('button');
      el.className = 'gleame-chat-btn';
      el.textContent = btn.label;
      el.onclick = function() {
        // Remove buttons after click
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        handleButtonClick(btn.action, btn.label);
      };
      btnGroup.appendChild(el);
    });

    wrap.appendChild(btnGroup);
    messagesContainer.appendChild(wrap);
    scrollToBottom();
  }

  function removeLoadingMsg() {
    var el = document.getElementById('gleame-chat-loading-msg');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showProductCards(recommendations) {
    recommendations.forEach(function(rec) {
      var card = document.createElement('div');
      card.className = 'gleame-chat-msg gleame-chat-msg-bot';

      var cardInner = document.createElement('div');
      cardInner.className = 'gleame-chat-product-card';

      if (rec.tryOnPreview) {
        var previewImg = document.createElement('img');
        previewImg.className = 'gleame-chat-product-image';
        previewImg.src = 'data:image/jpeg;base64,' + rec.tryOnPreview;
        previewImg.alt = rec.title || '';
        previewImg.onerror = function() {
          previewImg.style.display = 'none';
        };
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
      // Shopify search with type=product filter keeps matches scoped to products
      // (themes like Dawn honor the filter; falls back to unfiltered search otherwise).
      // Search by product name only — variant titles like "She's a Wildflower"
      // would otherwise miss the parent product page.
      var searchQuery = rec.productName || rec.title || '';
      shopLink.href = '/search?type=product&q=' + encodeURIComponent(searchQuery);
      shopLink.textContent = 'Shop This';
      info.appendChild(shopLink);

      cardInner.appendChild(info);
      card.appendChild(cardInner);
      messagesContainer.appendChild(card);
    });
    scrollToBottom();
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

  // ---- Start ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
