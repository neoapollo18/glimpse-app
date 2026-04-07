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

  // ---- State ----
  var config = null;
  var isOpen = false;
  var greetingShown = false;
  var greetingDismissed = false;
  var messages = [];
  var currentStep = 'idle'; // idle | greeting | preference | upload | loading | results

  // ---- DOM refs ----
  var bubble = null;
  var greetingEl = null;
  var panel = null;
  var messagesContainer = null;
  var inputArea = null;

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
    var delay = (config.greetingDelaySeconds || 2) * 1000;
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

    // Start conversation if first time
    if (messages.length === 0) startConversation();

    trackEvent('chat_open');
  }

  function closeChat() {
    if (!isOpen) return;
    isOpen = false;
    if (panel) panel.classList.remove('gleame-chat-visible');
    updateBubbleIcon(false);
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

    var closeBtn = document.createElement('button');
    closeBtn.className = 'gleame-chat-header-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.onclick = closeChat;

    header.appendChild(avatarWrap);
    header.appendChild(info);
    header.appendChild(closeBtn);

    // Messages
    messagesContainer = document.createElement('div');
    messagesContainer.className = 'gleame-chat-messages';

    // Input area
    inputArea = document.createElement('div');
    inputArea.className = 'gleame-chat-input-area';

    // Powered by
    var powered = document.createElement('div');
    powered.className = 'gleame-chat-powered';
    powered.innerHTML = 'Powered by <strong>Gleame</strong>';

    panel.appendChild(header);
    panel.appendChild(messagesContainer);
    panel.appendChild(inputArea);
    panel.appendChild(powered);
    root.appendChild(panel);
  }

  // ---- Conversation ----
  function startConversation() {
    currentStep = 'greeting';
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
      currentStep = 'preference';
      trackEvent('chat_recommend_start');

      setTimeout(function() {
        addBotMessage(config.preferenceQuestion || 'What kind of look are you going for?');
        setTimeout(function() {
          var options = (config.preferenceOptions || ['Natural', 'Bold', 'Glossy', 'Surprise me']);
          var buttons = options.map(function(opt) {
            return { label: opt, action: 'preference:' + opt };
          });
          addBotButtons(buttons);
        }, 300);
      }, 400);
    }

    if (action.indexOf('preference:') === 0) {
      var preference = action.replace('preference:', '');
      currentStep = 'upload';

      setTimeout(function() {
        addBotMessage("Upload a photo and I'll show you what looks best on you!");
        setTimeout(function() { showUploadButton(); }, 300);
      }, 400);

      // Store preference for later
      window.gleameChat._preference = preference;
    }
  }

  function showUploadButton() {
    var uploadWrap = document.createElement('div');
    uploadWrap.className = 'gleame-chat-msg gleame-chat-msg-bot';

    var uploadBtn = document.createElement('button');
    uploadBtn.className = 'gleame-chat-upload-btn';
    uploadBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>' +
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

    uploadWrap.appendChild(uploadBtn);
    uploadWrap.appendChild(fileInput);
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

    // Show typing indicator
    currentStep = 'loading';
    setTimeout(function() {
      showTyping();
      sendRecommendation(file);
    }, 600);
  }

  function sendRecommendation(file) {
    var formData = new FormData();
    formData.append('image', file);
    formData.append('shopDomain', shopDomain);
    formData.append('preference', window.gleameChat._preference || '');

    fetch(SHOPIFY_APP_URL + '/api/storefront/chat-recommend', {
      method: 'POST',
      body: formData,
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      hideTyping();
      if (data.recommendations && data.recommendations.length > 0) {
        currentStep = 'results';
        addBotMessage("Here's what I found for you! ✨");
        setTimeout(function() {
          showProductCards(data.recommendations);
          trackEvent('chat_recommendation_shown');
        }, 400);
      } else {
        addBotMessage("Sorry, I couldn't find a match right now. Please try again later!");
        currentStep = 'idle';
      }
    })
    .catch(function(err) {
      hideTyping();
      console.error('Gleame Chat: recommend error', err);
      addBotMessage("Something went wrong. Please try again!");
      currentStep = 'idle';
    });
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

  var typingEl = null;

  function showTyping() {
    typingEl = document.createElement('div');
    typingEl.className = 'gleame-chat-typing';
    typingEl.innerHTML =
      '<div class="gleame-chat-typing-dot"></div>' +
      '<div class="gleame-chat-typing-dot"></div>' +
      '<div class="gleame-chat-typing-dot"></div>';
    messagesContainer.appendChild(typingEl);
    scrollToBottom();
  }

  function hideTyping() {
    if (typingEl && typingEl.parentNode) {
      typingEl.parentNode.removeChild(typingEl);
      typingEl = null;
    }
  }

  function showProductCards(recommendations) {
    recommendations.forEach(function(rec) {
      var card = document.createElement('div');
      card.className = 'gleame-chat-msg gleame-chat-msg-bot';

      var cardInner = document.createElement('div');
      cardInner.className = 'gleame-chat-product-card';

      var html = '';
      if (rec.tryOnPreview) {
        html += '<img class="gleame-chat-product-image" src="data:image/jpeg;base64,' + rec.tryOnPreview + '" alt="' + escapeHtml(rec.title) + '">';
      }
      html += '<div class="gleame-chat-product-info">';
      html += '<div class="gleame-chat-product-title">' + escapeHtml(rec.title) + '</div>';
      var searchUrl = '/search?q=' + encodeURIComponent(rec.title);
      html += '<a href="' + searchUrl + '" class="gleame-chat-product-shop-btn" target="_top">Shop This</a>';
      html += '</div>';

      cardInner.innerHTML = html;
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
