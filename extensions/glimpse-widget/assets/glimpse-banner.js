/* Gleame Banner Widget JavaScript v3.0 - Multi-instance support */
console.log('Gleame Banner Widget v3.0 loaded');

(function() {
  'use strict';

  // Instance state storage - keyed by block.id
  const instances = new Map();
  
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  const WIDGET_TYPE = 'banner';
  const loadingMessages = ['Processing...', 'Analyzing...', 'Creating magic...', 'Almost there...'];

  // Initialize namespace
  window.bannerWidgetFunctions = window.bannerWidgetFunctions || {};

  // Get or create instance state
  function getInstance(instanceId) {
    if (!instances.has(instanceId)) {
      instances.set(instanceId, {
        productId: null,
        shopDomain: null,
        variantId: null,
        cartToken: null,
        originalButtonText: '',
        loadingInterval: null,
        loadingMessageIndex: 0,
        viewTracked: false,
        widget: null,
        carouselSlides: null,
        currentSlide: 0,
      });
    }
    return instances.get(instanceId);
  }

  // Find widget element by instanceId
  function getWidgetElement(instanceId) {
    let widget = document.querySelector(`.glimpse-banner-widget[data-block-id="${instanceId}"]`);
    if (widget) return widget;
    widget = document.querySelector('.glimpse-banner-widget');
    return widget;
  }

  // Get element by ID with instance suffix, with fallback to legacy ID
  function getElement(instanceId, baseId) {
    let el = document.getElementById(`${baseId}-${instanceId}`);
    if (el) return el;
    el = document.getElementById(baseId);
    return el;
  }

  // Get shop domain
  function getShopDomain(widget) {
    const manualDomain = widget?.getAttribute('data-manual-shop-domain');
    if (manualDomain) return manualDomain;
    
    const hostname = window.location.hostname;
    if (hostname.includes('.myshopify.com')) return hostname;
    
    const shopifyScripts = document.querySelectorAll('script[src*="myshopify.com"]');
    for (let script of shopifyScripts) {
      const match = script.src.match(/\/\/([^/]+\.myshopify\.com)/);
      if (match) return match[1];
    }
    
    if (window.Shopify?.shop) return window.Shopify.shop;
    
    const shopMeta = document.querySelector('meta[name="shopify-shop-domain"]');
    if (shopMeta) return shopMeta.content;
    
    const allLinks = document.querySelectorAll('link[href*="myshopify.com"], a[href*="myshopify.com"]');
    for (let link of allLinks) {
      const match = link.href.match(/\/\/([^/]+\.myshopify\.com)/);
      if (match) return match[1];
    }
    
    return hostname;
  }

  // Get current variant ID
  function getCurrentVariantId() {
    const variantSelect = document.querySelector('select[name="id"]');
    if (variantSelect?.value) return variantSelect.value;
    
    const variantRadio = document.querySelector('input[name="id"]:checked');
    if (variantRadio?.value) return variantRadio.value;
    
    const variantHidden = document.querySelector('input[name="id"][type="hidden"]');
    if (variantHidden?.value) return variantHidden.value;
    
    const anyIdInput = document.querySelector('input[name="id"]');
    if (anyIdInput?.value) return anyIdInput.value;
    
    if (window.ShopifyAnalytics?.meta?.selectedVariantId) return window.ShopifyAnalytics.meta.selectedVariantId.toString();
    
    const urlParams = new URLSearchParams(window.location.search);
    const variantParam = urlParams.get('variant');
    if (variantParam) return variantParam;
    
    return null;
  }

  // Track analytics event
  function trackEvent(instanceId, eventType) {
    const instance = getInstance(instanceId);
    if (!instance.shopDomain || !instance.productId) return;
    
    const payload = {
      shopDomain: instance.shopDomain,
      productId: instance.productId,
      eventType: eventType,
      widgetType: WIDGET_TYPE
    };
    
    // Include cart token for conversion tracking if available
    if (instance.cartToken) {
      payload.cartToken = instance.cartToken;
    }
    
    fetch(SHOPIFY_APP_URL + '/api/storefront/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  // Setup listeners to detect variant changes on product page
  function setupVariantListeners() {
    const variantSelect = document.querySelector('select[name="id"]');
    if (variantSelect) {
      variantSelect.addEventListener('change', e => {
        instances.forEach((instance, id) => { instance.variantId = e.target.value; });
      });
    }
    
    // Listen for Shopify's variant change custom event
    document.addEventListener('variant:change', event => {
      if (event.detail?.variant?.id) {
        const variantId = event.detail.variant.id.toString();
        instances.forEach((instance, id) => { instance.variantId = variantId; });
      }
    });
  }

  // Get button elements for an instance
  function getButton(instanceId) {
    return getElement(instanceId, 'bannerMainButton');
  }
  
  function getButtonText(instanceId) {
    const btn = getButton(instanceId);
    return btn?.querySelector('.button-text');
  }
  
  function getSpinner(instanceId) {
    const btn = getButton(instanceId);
    return btn?.querySelector('.banner-spinner-inline');
  }

  // Set button loading state
  function setButtonLoading(instanceId, isLoading) {
    const instance = getInstance(instanceId);
    const btn = getButton(instanceId);
    const btnText = getButtonText(instanceId);
    const spinner = getSpinner(instanceId);
    
    if (!btn || !btnText || !spinner) return;
    
    if (isLoading) {
      instance.originalButtonText = btnText.textContent;
      btn.classList.add('is-loading');
      spinner.style.display = 'inline-block';
      btnText.textContent = loadingMessages[0];
      
      instance.loadingMessageIndex = 0;
      instance.loadingInterval = setInterval(() => {
        instance.loadingMessageIndex = (instance.loadingMessageIndex + 1) % loadingMessages.length;
        btnText.textContent = loadingMessages[instance.loadingMessageIndex];
      }, 2000);
    } else {
      btn.classList.remove('is-loading');
      spinner.style.display = 'none';
      btnText.textContent = instance.originalButtonText;
      
      if (instance.loadingInterval) {
        clearInterval(instance.loadingInterval);
        instance.loadingInterval = null;
      }
    }
  }

  // Show results modal
  function showResultsModal(instanceId, beforeUrl, afterUrl) {
    const modal = getElement(instanceId, 'bannerResultsModal');
    if (!modal) return;
    
    const beforeImg = getElement(instanceId, 'bannerBeforeImage');
    const afterImg = getElement(instanceId, 'bannerAfterImage');
    
    if (beforeImg) beforeImg.src = beforeUrl;
    if (afterImg) afterImg.src = afterUrl;
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  // Show error modal
  function showErrorModal(instanceId, message) {
    const modal = getElement(instanceId, 'bannerErrorModal');
    const errorText = getElement(instanceId, 'bannerErrorMessage');
    
    if (!modal) return;
    
    if (errorText) errorText.textContent = message;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  // Close modal
  window.bannerWidgetFunctions.closeModal = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-banner-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) return;
    
    const resultsModal = getElement(instanceId, 'bannerResultsModal');
    const errorModal = getElement(instanceId, 'bannerErrorModal');
    
    if (resultsModal) resultsModal.style.display = 'none';
    if (errorModal) errorModal.style.display = 'none';
    
    document.body.style.overflow = '';

    // Clean up any object URLs to prevent memory leaks
    const instance = instances.get(instanceId);
    if (instance?.beforeUrlToRevoke) {
      URL.revokeObjectURL(instance.beforeUrlToRevoke);
      instance.beforeUrlToRevoke = null;
    }
  };

  // Try again - close modal and open file picker
  window.bannerWidgetFunctions.tryAgain = function(instanceId) {
    window.bannerWidgetFunctions.closeModal(instanceId);
    window.bannerWidgetFunctions.triggerFileInput(instanceId);
  };

  // Trigger file input
  // Desktop: opens camera modal. Mobile: native file picker.
  window.bannerWidgetFunctions.triggerFileInput = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-banner-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) return;
    
    const btn = getButton(instanceId);
    if (btn?.classList.contains('is-loading')) return;
    
    const fileInput = getElement(instanceId, 'bannerFileInput');
    const openFilePicker = function() { if (fileInput) fileInput.click(); };

    if (window.gleameCamera && !isMobileDevice()) {
      window.gleameCamera.open(
        function(file) {
          // Simulate a file select event for the banner handler
          var fakeEvent = { target: { files: [file] } };
          window.bannerWidgetFunctions.handleFileSelect(fakeEvent, instanceId);
        },
        openFilePicker
      );
    } else {
      openFilePicker();
    }
  };

  // Reset banner
  window.bannerWidgetFunctions.resetBanner = function(instanceId) {
    window.bannerWidgetFunctions.closeModal(instanceId);
  };

  // Mobile detection
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  }

  function isRecentlyTakenPhoto(file) {
    return file.lastModified > (Date.now() - 120000);
  }

  function flipImageHorizontally(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = function() {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        } catch (err) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function dataUrlToFile(dataUrl, fileName) {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], fileName, { type: mime });
  }

  function isHeicOrHeif(file) {
    const heicMimeTypes = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
    if (heicMimeTypes.includes(file.type?.toLowerCase())) return true;
    const ext = file.name?.toLowerCase().split('.').pop();
    return ext === 'heic' || ext === 'heif';
  }

  function isValidImageFile(file) {
    if (file.type?.startsWith('image/')) return true;
    if (isHeicOrHeif(file)) return true;
    const ext = file.name?.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif'].includes(ext);
  }

  // Handle file select
  window.bannerWidgetFunctions.handleFileSelect = async function(event, instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-banner-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) return;
    
    const file = event.target.files[0];
    if (!file) return;

    if (!isValidImageFile(file)) {
      showErrorModal(instanceId, 'Please upload an image file (JPG, PNG, HEIC, etc.).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showErrorModal(instanceId, 'Image too large. Please upload an image smaller than 5MB.');
      return;
    }

    setButtonLoading(instanceId, true);

    try {
      let processedFile = file;
      const isHeic = isHeicOrHeif(file);
      const isMobile = isMobileDevice();
      const isRecent = isRecentlyTakenPhoto(file);

      if (isHeic) {
        await checkVariantsAndProceed(instanceId, file);
        event.target.value = '';
        return;
      }

      if (isMobile && isRecent) {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const flippedDataUrl = await flipImageHorizontally(dataUrl);
        processedFile = dataUrlToFile(flippedDataUrl, file.name || 'selfie.jpg');
      }

      const compressedFile = await compressImage(processedFile);
      await checkVariantsAndProceed(instanceId, compressedFile);
    } catch (error) {
      console.error('Error processing image:', error);
      setButtonLoading(instanceId, false);
      showErrorModal(instanceId, error.message || 'Failed to process image');
    }

    event.target.value = '';
  };

  // Compress image
  async function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let objectUrl = null;

      img.onload = () => {
        // Revoke object URL to prevent memory leak
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }

        let { width, height } = img;
        const maxDimension = 1200;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(new File([blob], file.name, { type: 'image/jpeg' }));
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          0.85
        );
      };

      img.onerror = () => {
        // Revoke object URL on error too
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        reject(new Error('Failed to load image'));
      };

      objectUrl = URL.createObjectURL(file);
      img.src = objectUrl;
    });
  }

  // Upload and transform
  async function uploadAndTransform(instanceId, file) {
    const instance = getInstance(instanceId);
    const widget = getWidgetElement(instanceId);
    
    // Late load if needed
    if (!instance.productId && widget) {
      instance.productId = widget.getAttribute('data-product-id');
    }
    if (!instance.shopDomain && widget) {
      instance.shopDomain = getShopDomain(widget);
    }
    
    const freshVariantId = getCurrentVariantId();
    if (freshVariantId && freshVariantId !== instance.variantId) {
      instance.variantId = freshVariantId;
    }
    
    if (!instance.productId) {
      throw new Error('Product not found. Please refresh and try again.');
    }
    if (!instance.shopDomain) {
      throw new Error('Could not determine shop domain. Please refresh and try again.');
    }
    
    const formData = new FormData();
    formData.append('image', file);
    formData.append('productId', instance.productId);
    formData.append('shopDomain', instance.shopDomain);
    formData.append('widgetType', WIDGET_TYPE);
    if (instance.variantId) {
      formData.append('variantId', instance.variantId);
    }

    console.log('Gleame Banner: Sending transform for instance', instanceId, {
      productId: instance.productId,
      shopDomain: instance.shopDomain,
      variantId: instance.variantId
    });

    // Create abort controller for timeout (45 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    let response;
    try {
      response = await fetch(SHOPIFY_APP_URL + '/api/storefront/transform-image', {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        signal: controller.signal
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('Request timed out. Please try again.');
      }
      throw new Error('Network error. Please check your connection and try again.');
    }
    clearTimeout(timeoutId);

    const responseText = await response.text();
    let result;
    
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error('Invalid server response. Please try again.');
    }

    if (!response.ok) {
      throw new Error(result.error || `Server error: ${response.status}`);
    }
    
    if (!result.success) {
      throw new Error(result.error || 'Transformation failed');
    }
    
    if (!result.generatedImage) {
      throw new Error('No transformed image received');
    }

    // Use data URL from server if available, otherwise create object URL (and track for cleanup)
    let beforeUrl;
    let beforeUrlNeedsRevoke = false;
    if (result.processedInputImage) {
      beforeUrl = `data:image/jpeg;base64,${result.processedInputImage}`;
    } else {
      beforeUrl = URL.createObjectURL(file);
      beforeUrlNeedsRevoke = true;
      // Store for cleanup when modal closes
      instance.beforeUrlToRevoke = beforeUrl;
    }
    const afterUrl = `data:image/jpeg;base64,${result.generatedImage}`;
    
    setButtonLoading(instanceId, false);
    showResultsModal(instanceId, beforeUrl, afterUrl);
  }

  // ============================================================
  // VARIANT + CAROUSEL MODULE
  // ============================================================

  async function fetchConfiguredVariants(shopDomain, productId) {
    try {
      const params = new URLSearchParams({ shopDomain, productId });
      const response = await fetch(
        SHOPIFY_APP_URL + '/api/storefront/get-product-variants?' + params,
        { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
      );
      if (!response.ok) return [];
      const data = await response.json();
      return data.variants || [];
    } catch (e) {
      return [];
    }
  }

  async function checkVariantsAndProceed(instanceId, file) {
    const instance = getInstance(instanceId);
    const widget = getWidgetElement(instanceId);
    if (!instance.productId && widget) instance.productId = widget.getAttribute('data-product-id');
    if (!instance.shopDomain && widget) instance.shopDomain = getShopDomain(widget);

    if (!instance.productId || !instance.shopDomain) {
      await uploadAndTransform(instanceId, file);
      return;
    }

    const variants = await fetchConfiguredVariants(instance.shopDomain, instance.productId);

    if (variants.length === 0) {
      await uploadAndTransform(instanceId, file);
      return;
    }

    // Stop button spinner while user picks variants
    setButtonLoading(instanceId, false);

    openVariantModal(variants, function(selected) {
      setButtonLoading(instanceId, true);
      runMultiVariantTransform(instanceId, file, selected,
        function(slides) {
          setButtonLoading(instanceId, false);
          showCarouselModal(instanceId, slides);
        },
        function(msg) {
          setButtonLoading(instanceId, false);
          showErrorModal(instanceId, msg);
        }
      );
    });
  }

  async function runMultiVariantTransform(instanceId, file, selectedVariants, onSuccess, onError) {
    const instance = getInstance(instanceId);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('productId', instance.productId);
      formData.append('shopDomain', instance.shopDomain);
      formData.append('widgetType', WIDGET_TYPE);
      selectedVariants.forEach(function(v) { formData.append('variantIds[]', v.variantId); });

      const controller = new AbortController();
      const timeoutId = setTimeout(function() { controller.abort(); }, 120000);

      let response;
      try {
        response = await fetch(SHOPIFY_APP_URL + '/api/storefront/transform-image', {
          method: 'POST',
          body: formData,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          signal: controller.signal
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') throw new Error('Request timed out. Please try again.');
        throw new Error('Network error. Please check your connection and try again.');
      }
      clearTimeout(timeoutId);

      let result;
      try { result = await response.json(); } catch (e) { throw new Error('Invalid server response. Please try again.'); }
      if (!response.ok) throw new Error(result.error || 'Server error: ' + response.status);
      if (!result.success) throw new Error(result.error || 'Transformation failed');

      const slides = (result.results || []).map(function(r, i) {
        return {
          variantTitle: (selectedVariants[i] && selectedVariants[i].variantTitle) || ('Look ' + (i + 1)),
          displayColor: (selectedVariants[i] && selectedVariants[i].displayColor) || null,
          generatedImage: r.generatedImage || null,
          processedInputImage: r.processedInputImage || null,
          error: r.error || null
        };
      }).filter(function(s) { return !s.error && s.generatedImage; });

      if (slides.length === 0) throw new Error('No transformations succeeded. Please try again.');
      onSuccess(slides);
    } catch (error) {
      onError(error.message || 'Something went wrong. Please try again.');
    }
  }

  // Show multi-variant results in the dedicated carousel modal overlay
  function showCarouselModal(instanceId, slides) {
    if (slides.length === 1) {
      // Single result: reuse the existing results modal
      const beforeUrl = 'data:image/jpeg;base64,' + slides[0].processedInputImage;
      const afterUrl = 'data:image/jpeg;base64,' + slides[0].generatedImage;
      showResultsModal(instanceId, beforeUrl, afterUrl);
      return;
    }

    ensureCarouselModal();
    const instance = getInstance(instanceId);
    instance.carouselSlides = slides;
    instance.currentSlide = 0;

    const carouselModal = document.getElementById('gleame-carousel-modal');
    const titleEl = carouselModal.querySelector('.gcm-title');
    if (titleEl) titleEl.textContent = 'Your Virtual Try-On';

    const contentEl = document.getElementById('gcm-content');
    if (!contentEl) return;

    const tabsHtml = slides.map(function(s, i) {
      const dot = s.displayColor
        ? '<span class="gvc-tab-dot" style="background:' + s.displayColor + '"></span>'
        : '';
      return '<button type="button" class="gvc-tab' + (i === 0 ? ' gvc-tab-active' : '') +
        '" data-slide="' + i + '">' + dot + '<span>' + s.variantTitle + '</span></button>';
    }).join('');

    const slidesHtml = slides.map(function(s, i) {
      return '<div class="gvc-slide' + (i === 0 ? ' gvc-slide-active' : '') + '" data-slide="' + i + '">' +
        '<div class="gvc-comparison">' +
        '<div class="gvc-side"><img class="gvc-img" src="data:image/jpeg;base64,' + s.processedInputImage + '" alt="Before"></div>' +
        '<div class="gvc-side"><img class="gvc-img" src="data:image/jpeg;base64,' + s.generatedImage + '" alt="' + s.variantTitle + '"></div>' +
        '</div>' +
        '<p class="gvc-shade-label">' + s.variantTitle + '</p>' +
        '</div>';
    }).join('');

    contentEl.innerHTML =
      '<div class="gvc-tabs" id="gcm-tabs-' + instanceId + '">' + tabsHtml + '</div>' +
      '<div class="gvc-slides-wrap">' + slidesHtml + '</div>';

    var tabsEl = document.getElementById('gcm-tabs-' + instanceId);
    if (tabsEl) {
      tabsEl.addEventListener('click', function(e) {
        var tab = e.target.closest('.gvc-tab');
        if (!tab) return;
        goToSlide(instanceId, parseInt(tab.dataset.slide, 10), contentEl);
      });
    }

    carouselModal.classList.add('gcm-visible');
    document.body.style.overflow = 'hidden';
  }

  function goToSlide(instanceId, idx, containerEl) {
    const instance = getInstance(instanceId);
    if (!instance.carouselSlides || idx < 0 || idx >= instance.carouselSlides.length) return;
    const prev = instance.currentSlide;
    instance.currentSlide = idx;

    containerEl.querySelectorAll('.gvc-tab').forEach(function(t, i) {
      t.classList.toggle('gvc-tab-active', i === idx);
    });

    containerEl.querySelectorAll('.gvc-slide').forEach(function(s, i) {
      if (i === idx) {
        s.classList.add('gvc-slide-active');
        s.classList.remove('gvc-slide-exit');
      } else if (i === prev) {
        s.classList.remove('gvc-slide-active');
        s.classList.add('gvc-slide-exit');
        setTimeout(function() { s.classList.remove('gvc-slide-exit'); }, 250);
      } else {
        s.classList.remove('gvc-slide-active', 'gvc-slide-exit');
      }
    });
  }

  function ensureCarouselModal() {
    if (document.getElementById('gleame-carousel-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'gleame-carousel-modal';
    modal.innerHTML =
      '<div class="gcm-sheet">' +
        '<button type="button" class="gcm-close" id="gcm-close-btn">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
        '</button>' +
        '<h3 class="gcm-title">Your Virtual Try-On</h3>' +
        '<div id="gcm-content"></div>' +
        '<div class="gcm-actions">' +
          '<button type="button" class="gcm-try-again" id="gcm-try-again-btn">Try another photo</button>' +
        '</div>' +
        '<p class="gcm-powered">Powered by <strong>Gleame</strong></p>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('gcm-close-btn').addEventListener('click', closeCarouselModal);
    document.getElementById('gcm-try-again-btn').addEventListener('click', function() {
      closeCarouselModal();
      // Find the active banner instance and trigger file input
      instances.forEach(function(_inst, id) {
        window.bannerWidgetFunctions.triggerFileInput(id);
      });
    });
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeCarouselModal();
    });
  }

  function closeCarouselModal() {
    const modal = document.getElementById('gleame-carousel-modal');
    if (!modal) return;
    modal.classList.remove('gcm-visible');
    document.body.style.overflow = '';
  }

  // Shared variant selector modal (DOM-injected singleton)

  function ensureVariantModal() {
    var modal = document.getElementById('gleame-variant-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'gleame-variant-modal';
    modal.innerHTML =
      '<div class="gvm-backdrop"></div>' +
      '<div class="gvm-sheet">' +
        '<button type="button" class="gvm-close" id="gvm-close-btn">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
        '</button>' +
        '<div class="gvm-header">' +
          '<h3 class="gvm-title">Choose your shades</h3>' +
          '<p class="gvm-subtitle">Select up to 3 to try on at once</p>' +
        '</div>' +
        '<div class="gvm-grid" id="gvm-grid"></div>' +
        '<button type="button" class="gvm-cta" id="gvm-cta" disabled>Choose a shade</button>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('gvm-close-btn').addEventListener('click', closeVariantModal);
    modal.querySelector('.gvm-backdrop').addEventListener('click', closeVariantModal);
    return modal;
  }

  function closeVariantModal() {
    var modal = document.getElementById('gleame-variant-modal');
    if (!modal) return;
    modal.classList.remove('gvm-visible');
    document.body.style.overflow = '';
    window._gleameVariantOnConfirm = null;
  }

  function openVariantModal(variants, onConfirm) {
    if (variants.length === 1) { onConfirm(variants); return; }

    ensureVariantModal();
    var grid = document.getElementById('gvm-grid');
    var cta  = document.getElementById('gvm-cta');
    var selected = [];

    function updateCTA() {
      var n = selected.length;
      cta.disabled = n === 0;
      cta.textContent = n === 0 ? 'Choose a shade'
        : n === 1 ? 'Generate 1 Look'
        : 'Generate ' + n + ' Looks';
    }

    grid.innerHTML = '';
    variants.forEach(function(v) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'gvm-card';
      card.dataset.variantId = v.variantId;

      var swatchHtml = v.displayColor
        ? '<span class="gvm-swatch" style="background:' + v.displayColor + '"></span>'
        : '';
      card.innerHTML = swatchHtml +
        '<span class="gvm-card-label">' + v.variantTitle + '</span>' +
        '<span class="gvm-checkmark">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
        '</span>';

      card.addEventListener('click', function() {
        var idx = selected.findIndex(function(s) { return s.variantId === v.variantId; });
        if (idx >= 0) {
          selected.splice(idx, 1);
          card.classList.remove('gvm-selected');
        } else if (selected.length < 3) {
          selected.push(v);
          card.classList.add('gvm-selected');
        }
        grid.querySelectorAll('.gvm-card').forEach(function(c) {
          c.classList.toggle('gvm-dimmed', selected.length >= 3 && !c.classList.contains('gvm-selected'));
        });
        updateCTA();
      });

      grid.appendChild(card);
    });

    updateCTA();

    window._gleameVariantOnConfirm = function() {
      if (selected.length === 0) return;
      closeVariantModal();
      onConfirm(selected);
    };
    document.getElementById('gvm-cta').onclick = function() {
      window._gleameVariantOnConfirm && window._gleameVariantOnConfirm();
    };

    var modal = document.getElementById('gleame-variant-modal');
    modal.classList.add('gvm-visible');
    document.body.style.overflow = 'hidden';
  }

  // Initialize a single widget instance
  function initWidgetInstance(widget) {
    let instanceId = widget.getAttribute('data-block-id');
    
    if (!instanceId) {
      instanceId = 'banner-' + Math.random().toString(36).substr(2, 9);
      widget.setAttribute('data-block-id', instanceId);
      console.log('Gleame Banner: Generated block-id for widget:', instanceId);
    }
    
    const instance = getInstance(instanceId);
    instance.widget = widget;
    instance.productId = widget.getAttribute('data-product-id');
    instance.shopDomain = getShopDomain(widget);
    instance.variantId = getCurrentVariantId();
    const rawCartToken = widget.getAttribute('data-cart-token');
    instance.cartToken = (rawCartToken && rawCartToken.trim()) ? rawCartToken.trim() : null;
    
    const btnText = getButtonText(instanceId);
    if (btnText) {
      instance.originalButtonText = btnText.textContent;
    }
    
    // Set up file input listener
    const fileInput = getElement(instanceId, 'bannerFileInput');
    if (fileInput && !fileInput.dataset.listenerAttached) {
      fileInput.dataset.listenerAttached = 'true';
      // Listener is set via onchange in HTML
    }
    
    // Move modals to body for proper full-screen overlay
    const resultsModal = getElement(instanceId, 'bannerResultsModal');
    const errorModal = getElement(instanceId, 'bannerErrorModal');
    const widgetStyles = widget.getAttribute('style') || '';
    
    if (resultsModal && resultsModal.parentElement !== document.body) {
      resultsModal.setAttribute('style', (resultsModal.getAttribute('style') || '') + ';' + widgetStyles);
      document.body.appendChild(resultsModal);
    }
    if (errorModal && errorModal.parentElement !== document.body) {
      errorModal.setAttribute('style', (errorModal.getAttribute('style') || '') + ';' + widgetStyles);
      document.body.appendChild(errorModal);
    }
    
    console.log('Gleame Banner: Initialized instance', instanceId, {
      productId: instance.productId,
      shopDomain: instance.shopDomain
    });
    
    // Track widget view (only once per instance)
    if (!instance.viewTracked && instance.shopDomain && instance.productId) {
      instance.viewTracked = true;
      trackEvent(instanceId, 'widget_view');
    }
  }

  // Initialize all widgets
  function init() {
    const widgets = document.querySelectorAll('.glimpse-banner-widget');
    widgets.forEach(widget => initWidgetInstance(widget));
    
    // Setup variant change listeners
    setupVariantListeners();
    
    // Close modal on clicking overlay background
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('banner-modal-overlay')) {
        const instanceId = e.target.id.replace('bannerResultsModal-', '').replace('bannerErrorModal-', '');
        window.bannerWidgetFunctions.closeModal(instanceId);
      }
    });
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        instances.forEach((instance, id) => {
          window.bannerWidgetFunctions.closeModal(id);
        });
      }
    });
    
    console.log('Gleame Banner: Initialized', instances.size, 'widget instance(s)');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
