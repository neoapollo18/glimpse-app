// Gleame Button Widget JavaScript v3.0 - Multi-instance support
console.log('Gleame Button Widget v3.0 loaded');

(function() {
  window.glimpseButton = window.glimpseButton || {};
  
  // Instance state storage - keyed by block.id
  const instances = new Map();
  
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  const WIDGET_TYPE = 'button';
  const loadingMessages = ['Analyzing characteristics', 'Personalizing results', 'Applying to your photo', 'Finishing touches'];
  
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
        variantsPromise: null,
        carouselSlides: null,
        currentSlide: 0,
      });
    }
    return instances.get(instanceId);
  }

  // Find widget element by instanceId
  function getWidgetElement(instanceId) {
    let widget = document.querySelector(`.glimpse-button-widget[data-block-id="${instanceId}"]`);
    if (widget) return widget;
    widget = document.querySelector('.glimpse-button-widget');
    return widget;
  }

  // Get element by ID with instance suffix, with fallback to legacy ID
  function getElement(instanceId, baseId) {
    // First try the new format with instance suffix
    const newId = `${baseId}-${instanceId}`;
    let el = document.getElementById(newId);
    if (el) {
      return el;
    }
    
    // Fallback to legacy ID (no suffix)
    el = document.getElementById(baseId);
    if (el) {
      console.log(`Gleame Button: Using legacy ID "${baseId}" (new ID "${newId}" not found)`);
    }
    return el;
  }
  
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
    
    return hostname;
  }
  
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
  
  function setupVariantListeners() {
    const variantSelect = document.querySelector('select[name="id"]');
    if (variantSelect) {
      variantSelect.addEventListener('change', e => {
        instances.forEach((instance, id) => { instance.variantId = e.target.value; });
      });
    }
    
    document.addEventListener('variant:change', event => {
      if (event.detail?.variant?.id) {
        const variantId = event.detail.variant.id.toString();
        instances.forEach((instance, id) => { instance.variantId = variantId; });
      }
    });
  }
  
  // Trigger file upload
  // Desktop: opens camera modal. Mobile: native file picker.
  window.glimpseButton.triggerUpload = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-button-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) {
      console.warn('Gleame Button: triggerUpload called but no widget found');
      return;
    }
    
    const fileInput = getElement(instanceId, 'imageUpload');
    const openFilePicker = function() { if (fileInput) fileInput.click(); };

    if (window.gleameCamera && !isMobileDevice()) {
      window.gleameCamera.open(
        function(file) { processFile(instanceId, file); },
        openFilePicker
      );
    } else {
      openFilePicker();
    }
  };
  
  // Set button to loading state
  function setButtonLoading(instanceId, isLoading) {
    const instance = getInstance(instanceId);
    const button = getElement(instanceId, 'mainButton');
    const btnText = button?.querySelector('.btn-text');
    const spinner = button?.querySelector('.btn-spinner');
    const cameraIcon = button?.querySelector('.btn-camera-icon');

    if (!button || !btnText) return;

    if (isLoading) {
      button.classList.add('is-loading');
      if (spinner) spinner.style.display = 'inline-flex';
      if (cameraIcon) cameraIcon.style.display = 'none';
      instance.loadingMessageIndex = 0;
      btnText.textContent = loadingMessages[0];

      instance.loadingInterval = setInterval(() => {
        instance.loadingMessageIndex++;
        if (instance.loadingMessageIndex < loadingMessages.length) {
          btnText.textContent = loadingMessages[instance.loadingMessageIndex];
        }
      }, 2500);
    } else {
      button.classList.remove('is-loading');
      if (spinner) spinner.style.display = 'none';
      if (cameraIcon) cameraIcon.style.display = '';
      btnText.textContent = instance.originalButtonText;

      if (instance.loadingInterval) {
        clearInterval(instance.loadingInterval);
        instance.loadingInterval = null;
      }
    }
  }
  
  // Show results modal
  function showResults(instanceId, beforeUrl, afterUrl) {
    console.log('Gleame Button: showResults called for instance', instanceId);
    
    const modal = getElement(instanceId, 'resultsModal');
    
    // Try to find images - first by global ID, then within modal context
    let beforeImg = getElement(instanceId, 'beforeImage');
    let afterImg = getElement(instanceId, 'afterImage');
    
    // Fallback: search within the modal if not found globally
    if (!beforeImg && modal) {
      beforeImg = modal.querySelector(`#beforeImage-${instanceId}`) || modal.querySelector('[id^="beforeImage"]');
      if (beforeImg) console.log('Gleame Button: Found beforeImg via modal querySelector');
    }
    if (!afterImg && modal) {
      afterImg = modal.querySelector(`#afterImage-${instanceId}`) || modal.querySelector('[id^="afterImage"]');
      if (afterImg) console.log('Gleame Button: Found afterImg via modal querySelector');
    }
    
    console.log('Gleame Button: Found elements -', {
      modal: !!modal,
      modalId: modal?.id,
      beforeImg: !!beforeImg,
      afterImg: !!afterImg,
      beforeImgId: beforeImg?.id,
      afterImgId: afterImg?.id
    });
    
    if (beforeImg) {
      beforeImg.onerror = () => console.error('Gleame Button: Before image failed to load');
      beforeImg.onload = () => console.log('Gleame Button: Before image loaded successfully');
      beforeImg.src = beforeUrl;
      console.log('Gleame Button: Set beforeImg src, length:', beforeUrl?.length, 'starts with:', beforeUrl?.substring(0, 50));
    } else {
      console.error('Gleame Button: beforeImage element not found for instance', instanceId);
    }
    
    if (afterImg) {
      afterImg.onerror = () => console.error('Gleame Button: After image failed to load');
      afterImg.onload = () => console.log('Gleame Button: After image loaded successfully');
      afterImg.src = afterUrl;
      console.log('Gleame Button: Set afterImg src, length:', afterUrl?.length, 'starts with:', afterUrl?.substring(0, 50));
    } else {
      console.error('Gleame Button: afterImage element not found for instance', instanceId);
    }
    
    if (modal) {
      modal.style.display = 'flex';
    } else {
      console.error('Gleame Button: resultsModal element not found for instance', instanceId);
    }
    
    document.body.style.overflow = 'hidden';
  }
  
  // Close results modal
  window.glimpseButton.closeResults = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-button-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    
    const modal = getElement(instanceId, 'resultsModal');
    if (modal) modal.style.display = 'none';
    
    document.body.style.overflow = '';

    // Clean up any object URLs to prevent memory leaks
    const instance = instances.get(instanceId);
    if (instance?.beforeUrlToRevoke) {
      URL.revokeObjectURL(instance.beforeUrlToRevoke);
      instance.beforeUrlToRevoke = null;
    }
  };
  
  // Show error modal
  function showError(instanceId, message) {
    setButtonLoading(instanceId, false);
    
    const modal = getElement(instanceId, 'errorModal');
    const errorMessage = getElement(instanceId, 'errorMessage');
    
    if (errorMessage) errorMessage.textContent = message;
    if (modal) modal.style.display = 'flex';
    
    document.body.style.overflow = 'hidden';
  }
  
  // Close error modal
  window.glimpseButton.closeError = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-button-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    
    const modal = getElement(instanceId, 'errorModal');
    if (modal) modal.style.display = 'none';
    
    document.body.style.overflow = '';
  };
  
  // Try again
  window.glimpseButton.tryAgain = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-button-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    
    window.glimpseButton.closeResults(instanceId);
    window.glimpseButton.closeError(instanceId);
    
    const imageUpload = getElement(instanceId, 'imageUpload');
    const beforeImage = getElement(instanceId, 'beforeImage');
    const afterImage = getElement(instanceId, 'afterImage');
    
    if (imageUpload) imageUpload.value = '';
    if (beforeImage) { beforeImage.onload = null; beforeImage.onerror = null; beforeImage.src = ''; }
    if (afterImage) { afterImage.onload = null; afterImage.onerror = null; afterImage.src = ''; }
    
    window.glimpseButton.triggerUpload(instanceId);
  };
  
  // Reset to initial state
  window.glimpseButton.reset = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-button-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    
    setButtonLoading(instanceId, false);
    window.glimpseButton.closeResults(instanceId);
    window.glimpseButton.closeError(instanceId);
    
    const imageUpload = getElement(instanceId, 'imageUpload');
    const beforeImage = getElement(instanceId, 'beforeImage');
    const afterImage = getElement(instanceId, 'afterImage');
    
    if (imageUpload) imageUpload.value = '';
    if (beforeImage) { beforeImage.onload = null; beforeImage.onerror = null; beforeImage.src = ''; }
    if (afterImage) { afterImage.onload = null; afterImage.onerror = null; afterImage.src = ''; }
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
  
  function processFile(instanceId, file) {
    if (!file) return;
    
    if (!isValidImageFile(file)) {
      showError(instanceId, 'Please upload an image file (JPG, PNG, HEIC, etc.).');
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showError(instanceId, 'Image too large. Please upload an image smaller than 5MB.');
      return;
    }
    
    setButtonLoading(instanceId, true);
    
    const reader = new FileReader();
    
    reader.onload = async function(e) {
      try {
        let imageDataUrl = e.target.result;
        let fileToSend = file;
        
        const isHeic = isHeicOrHeif(file);
        const isMobile = isMobileDevice();
        const isRecent = isRecentlyTakenPhoto(file);
        
        if (isMobile && isRecent && !isHeic) {
          imageDataUrl = await flipImageHorizontally(imageDataUrl);
          fileToSend = dataUrlToFile(imageDataUrl, file.name || 'selfie.jpg');
        }
        
        checkVariantsAndProceed(instanceId, isHeic ? file : fileToSend);
      } catch (error) {
        showError(instanceId, 'Error loading image. Please try again.');
      }
    };
    
    reader.onerror = () => showError(instanceId, 'Error reading the image file.');
    reader.readAsDataURL(file);
  }
  
  async function transformImage(instanceId, file) {
    const instance = getInstance(instanceId);
    const widget = getWidgetElement(instanceId);
    
    try {
      // Late load if needed
      if (!instance.productId && widget) {
        instance.productId = widget.getAttribute('data-product-id');
      }
      if (!instance.shopDomain && widget) {
        instance.shopDomain = getShopDomain(widget);
      }
      
      const freshVariantId = getCurrentVariantId();
      if (freshVariantId) instance.variantId = freshVariantId;
      
      if (!instance.productId) throw new Error('Product not found. Please refresh and try again.');
      if (!instance.shopDomain) throw new Error('Could not determine shop domain.');
      
      const formData = new FormData();
      formData.append('image', file);
      formData.append('productId', instance.productId);
      formData.append('shopDomain', instance.shopDomain);
      formData.append('widgetType', 'button');
      if (instance.variantId) formData.append('variantId', instance.variantId);
      if (instance.cartToken) formData.append('cartToken', instance.cartToken);

      console.log('Gleame Button: Sending transform for instance', instanceId, {
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
      
      let result;
      try {
        result = await response.json();
      } catch (parseError) {
        throw new Error('Invalid server response. Please try again.');
      }
      
      console.log('Gleame Button: API response', {
        ok: response.ok,
        status: response.status,
        success: result.success,
        hasGeneratedImage: !!result.generatedImage,
        hasProcessedInput: !!result.processedInputImage,
        error: result.error
      });
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Transformation failed');
      }
      
      // Validate that we have the generated image
      if (!result.generatedImage) {
        throw new Error('No image was generated. Please try again.');
      }
      
      setButtonLoading(instanceId, false);
      
      // Use data URL from server if available, otherwise create object URL (and track for cleanup)
      let beforeUrl;
      if (result.processedInputImage) {
        beforeUrl = `data:image/jpeg;base64,${result.processedInputImage}`;
      } else {
        beforeUrl = URL.createObjectURL(file);
        // Store for cleanup when modal closes
        instance.beforeUrlToRevoke = beforeUrl;
      }
      const afterUrl = `data:image/jpeg;base64,${result.generatedImage}`;
      
      console.log('Gleame Button: Showing results with images', {
        beforeUrlLength: beforeUrl?.length,
        afterUrlLength: afterUrl?.length
      });
      
      showResults(instanceId, beforeUrl, afterUrl);
      
    } catch (error) {
      showError(instanceId, error.message || 'Something went wrong. Please try again.');
    }
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
      transformImage(instanceId, file);
      return;
    }

    const variants = instance.variantsPromise
      ? await instance.variantsPromise
      : await fetchConfiguredVariants(instance.shopDomain, instance.productId);

    if (variants.length === 0) {
      transformImage(instanceId, file);
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
          showError(instanceId, msg);
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
      if (instance.cartToken) formData.append('cartToken', instance.cartToken);

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
          variantId: (selectedVariants[i] && selectedVariants[i].variantId) || null,
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

  function showCarouselModal(instanceId, slides) {
    if (slides.length === 1) {
      const beforeUrl = 'data:image/jpeg;base64,' + slides[0].processedInputImage;
      const afterUrl = 'data:image/jpeg;base64,' + slides[0].generatedImage;
      showResults(instanceId, beforeUrl, afterUrl);
      return;
    }

    ensureCarouselModal();
    const instance = getInstance(instanceId);
    instance.carouselSlides = slides;
    instance.currentSlide = 0;

    const contentEl = document.getElementById('gcm-content');
    if (!contentEl) return;

    const variantImages = window.gleameVariantImages || {};
    const tabsHtml = slides.map(function(s, i) {
      const imgUrl = s.variantId && (variantImages[s.variantId] || variantImages[String(s.variantId)]);
      const dot = imgUrl
        ? '<img class="gvc-tab-img" src="' + imgUrl + '" alt="' + s.variantTitle + '">'
        : s.displayColor
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

    const carouselModal = document.getElementById('gleame-carousel-modal');
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

  function copyWidgetFonts(el) {
    var widget = document.querySelector('.glimpse-ai-widget') || document.querySelector('[class*="glimpse-button"]');
    if (!widget) return;
    var cs = getComputedStyle(widget);
    ['--header-font-family','--header-font-weight','--body-font-family','--body-font-weight'].forEach(function(v) {
      var val = cs.getPropertyValue(v);
      if (val) el.style.setProperty(v, val.trim());
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
    copyWidgetFonts(modal);

    document.getElementById('gcm-close-btn').addEventListener('click', closeCarouselModal);
    document.getElementById('gcm-try-again-btn').addEventListener('click', function() {
      closeCarouselModal();
      instances.forEach(function(_inst, id) {
        window.glimpseButton.triggerUpload(id);
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
          '<p class="gvm-subtitle">Pick up to 3 to try on together<span class="gvm-count" id="gvm-count">0 / 3</span></p>' +
        '</div>' +
        '<div class="gvm-grid" id="gvm-grid"></div>' +
        '<button type="button" class="gvm-cta" id="gvm-cta" disabled>Choose a shade</button>' +
      '</div>';
    document.body.appendChild(modal);
    copyWidgetFonts(modal);

    document.getElementById('gvm-close-btn').addEventListener('click', closeVariantModal);
    modal.querySelector('.gvm-backdrop').addEventListener('click', closeVariantModal);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && document.getElementById('gleame-variant-modal')?.classList.contains('gvm-visible')) {
        closeVariantModal();
      }
    });
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
    var countEl = document.getElementById('gvm-count');
    var selected = [];

    function updateCTA() {
      var n = selected.length;
      cta.disabled = n === 0;
      cta.textContent = n === 0 ? 'Choose a shade'
        : n === 1 ? 'Generate 1 Look'
        : 'Generate ' + n + ' Looks';
      if (countEl) {
        countEl.textContent = n + ' / 3';
        countEl.classList.toggle('gvm-count-full', n >= 3);
      }
    }

    function updateFade() {
      var scrollable = grid.scrollHeight > grid.clientHeight + 1;
      var atTop = grid.scrollTop < 2;
      var atBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2;
      grid.classList.toggle('gvm-fade-top', scrollable && !atTop);
      grid.classList.toggle('gvm-fade-bottom', scrollable && !atBottom);
    }

    grid.innerHTML = '';
    grid.classList.remove('gvm-fade-top', 'gvm-fade-bottom');
    variants.forEach(function(v) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'gvm-card';
      card.dataset.variantId = v.variantId;

      var variantImages = window.gleameVariantImages || {};
      var swatchImgUrl = variantImages[v.variantId] || variantImages[String(v.variantId)];
      var swatch;
      if (swatchImgUrl) {
        swatch = document.createElement('img');
        swatch.className = 'gvm-swatch';
        swatch.src = swatchImgUrl;
        swatch.alt = v.variantTitle || '';
      } else if (v.displayColor) {
        swatch = document.createElement('span');
        swatch.className = 'gvm-swatch';
        swatch.style.background = v.displayColor;
      } else {
        swatch = document.createElement('span');
        swatch.className = 'gvm-swatch gvm-swatch-empty';
      }
      var label = document.createElement('span');
      label.className = 'gvm-card-label';
      label.textContent = v.variantTitle || '';
      var checkmark = document.createElement('span');
      checkmark.className = 'gvm-checkmark';
      checkmark.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      card.appendChild(swatch);
      card.appendChild(label);
      card.appendChild(checkmark);

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
    grid.onscroll = updateFade;
    requestAnimationFrame(updateFade);
  }

  // Initialize a single widget instance
  function initWidgetInstance(widget) {
    let instanceId = widget.getAttribute('data-block-id');

    if (!instanceId) {
      instanceId = 'button-' + Math.random().toString(36).substr(2, 9);
      widget.setAttribute('data-block-id', instanceId);
      console.log('Gleame Button: Generated block-id for widget:', instanceId);
    }
    
    const instance = getInstance(instanceId);
    instance.widget = widget;
    instance.productId = widget.getAttribute('data-product-id');
    instance.shopDomain = getShopDomain(widget);
    instance.variantId = getCurrentVariantId();
    const rawCartToken = widget.getAttribute('data-cart-token');
    const trimmedRaw = (rawCartToken && rawCartToken.trim()) || '';
    // 32-hex tokens come from themes still on the legacy cart cookie and
    // never appear on orders/create — treat as null so the refresh below
    // can pick up a real Cart-API token instead.
    const isLegacyHex = /^[0-9a-f]{32}$/.test(trimmedRaw);
    instance.cartToken = (trimmedRaw && !isLegacyHex) ? trimmedRaw.split('?')[0] : null;
    // Shopify doesn't mint a cart token until the cart has a line or an
    // attribute, so try-ons on empty carts can't be attributed. Read the
    // token if one exists; otherwise force creation via a hidden attribute
    // (underscore prefix = invisible in checkout / order notifications).
    fetch('/cart.js', { credentials: 'same-origin' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(cart) {
        if (cart && cart.token) {
          instance.cartToken = String(cart.token).split('?')[0];
          return null;
        }
        return fetch('/cart/update.js', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attributes: { _gleame: '1' } })
        }).then(function(r) { return r.ok ? r.json() : null; });
      })
      .then(function(cart) {
        if (cart && cart.token) instance.cartToken = String(cart.token).split('?')[0];
      })
      .catch(function() {});
    instance.originalButtonText = widget.getAttribute('data-button-text') || 'TRY IT ON';
    
    // Track widget view (only once per instance)
    if (!instance.viewTracked) {
      instance.viewTracked = true;
      trackEvent(instanceId, 'widget_view');
    }

    // Prefetch configured variants so upload has zero delay
    if (instance.shopDomain && instance.productId) {
      instance.variantsPromise = fetchConfiguredVariants(instance.shopDomain, instance.productId);
    }

    // Move modals to body for proper full-screen overlay
    const resultsModal = getElement(instanceId, 'resultsModal');
    const errorModal = getElement(instanceId, 'errorModal');
    const widgetStyles = widget.getAttribute('style') || '';
    
    console.log('Gleame Button: Moving modals for instance', instanceId, {
      resultsModalFound: !!resultsModal,
      resultsModalId: resultsModal?.id,
      errorModalFound: !!errorModal,
      errorModalId: errorModal?.id
    });
    
    if (resultsModal && resultsModal.parentElement !== document.body) {
      resultsModal.setAttribute('style', (resultsModal.getAttribute('style') || '') + ';' + widgetStyles);
      document.body.appendChild(resultsModal);
      
      // Verify images are still accessible after move
      const beforeImg = resultsModal.querySelector(`#beforeImage-${instanceId}`) || resultsModal.querySelector('#beforeImage');
      const afterImg = resultsModal.querySelector(`#afterImage-${instanceId}`) || resultsModal.querySelector('#afterImage');
      console.log('Gleame Button: After move - images accessible:', {
        beforeImg: !!beforeImg,
        beforeImgId: beforeImg?.id,
        afterImg: !!afterImg,
        afterImgId: afterImg?.id
      });
    }
    if (errorModal && errorModal.parentElement !== document.body) {
      errorModal.setAttribute('style', (errorModal.getAttribute('style') || '') + ';' + widgetStyles);
      document.body.appendChild(errorModal);
    }
    
    // Set up file input listener
    const imageUpload = getElement(instanceId, 'imageUpload');
    if (imageUpload && !imageUpload.dataset.listenerAttached) {
      imageUpload.dataset.listenerAttached = 'true';
      imageUpload.addEventListener('change', function(event) {
        const files = event.target.files;
        if (files?.length > 0) processFile(instanceId, files[0]);
      });
    }
    
    console.log('Gleame Button: Initialized instance', instanceId, {
      productId: instance.productId,
      shopDomain: instance.shopDomain
    });
  }
  
  // Handle overlay click to close
  function handleOverlayClick(e) {
    if (e.target.classList.contains('results-modal-overlay')) {
      const instanceId = e.target.id.replace('resultsModal-', '');
      window.glimpseButton.closeResults(instanceId);
    }
    if (e.target.classList.contains('error-modal-overlay')) {
      const instanceId = e.target.id.replace('errorModal-', '');
      window.glimpseButton.closeError(instanceId);
    }
  }
  
  // Handle escape key
  function handleEscapeKey(e) {
    if (e.key === 'Escape') {
      instances.forEach((instance, id) => {
        window.glimpseButton.closeResults(id);
        window.glimpseButton.closeError(id);
      });
    }
  }
  
  document.addEventListener('DOMContentLoaded', function() {
    // Initialize all button widgets
    const widgets = document.querySelectorAll('.glimpse-button-widget');
    widgets.forEach(widget => initWidgetInstance(widget));
    
    setupVariantListeners();
    
    // Add click outside to close
    document.addEventListener('click', handleOverlayClick);
    
    // Add escape key listener
    document.addEventListener('keydown', handleEscapeKey);
    
    console.log('Gleame Button: Initialized', instances.size, 'widget instance(s)');
  });
})();
