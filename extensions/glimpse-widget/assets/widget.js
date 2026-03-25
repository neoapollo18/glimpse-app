// Gleame Widget JavaScript v3.0 - Multi-instance support
// Shared by legacy widget layout
console.log('Gleame Legacy Widget v3.0 loaded');

(function() {
  window.widgetFunctions = window.widgetFunctions || {};
  
  // Instance state storage - keyed by block.id
  const instances = new Map();
  
  const loadingMessages = ['Analyzing image...', 'Creating your transformation...', 'Working our magic...', 'Almost there...'];
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  const WIDGET_TYPE = 'legacy';
  
  // Get or create instance state
  function getInstance(instanceId) {
    if (!instances.has(instanceId)) {
      instances.set(instanceId, {
        productId: null,
        shopDomain: null,
        variantId: null,
        cartToken: null,
        loadingTextInterval: null,
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
    // Try to find by block-id first
    let widget = document.querySelector(`.glimpse-ai-widget[data-block-id="${instanceId}"]`);
    if (widget) return widget;
    
    // Fallback: try first legacy widget
    widget = document.querySelector('.glimpse-ai-widget');
    return widget;
  }
  
  // Get element by ID with instance suffix, with fallback to legacy ID
  function getElement(instanceId, baseId) {
    // Try instance-specific ID first
    let el = document.getElementById(`${baseId}-${instanceId}`);
    if (el) return el;
    
    // Fallback to legacy ID (backwards compatibility)
    el = document.getElementById(baseId);
    return el;
  }

  // Track widget events (views, etc.)
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
    
    fetch(`${SHOPIFY_APP_URL}/api/storefront/track-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
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
    
    const allLinks = document.querySelectorAll('link[href*="myshopify.com"], a[href*="myshopify.com"]');
    for (let link of allLinks) {
      const match = link.href.match(/\/\/([^/]+\.myshopify\.com)/);
      if (match) return match[1];
    }
    
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
    if (window.productVariants?.current?.id) return window.productVariants.current.id.toString();
    if (window.theme?.product?.selected_or_first_available_variant?.id) return window.theme.product.selected_or_first_available_variant.id.toString();
    
    const urlParams = new URLSearchParams(window.location.search);
    const variantParam = urlParams.get('variant');
    if (variantParam) return variantParam;
    
    try {
      const productForm = document.querySelector('form[action*="/cart/add"]');
      if (productForm) {
        const formData = new FormData(productForm);
        const formVariantId = formData.get('id');
        if (formVariantId) return formVariantId.toString();
      }
    } catch (e) {}
    
    const formWithVariant = document.querySelector('[data-variant-id]');
    if (formWithVariant) {
      const variantId = formWithVariant.getAttribute('data-variant-id');
      if (variantId) return variantId;
    }
    
    const variantSelectsComponent = document.querySelector('variant-selects');
    if (variantSelectsComponent?.currentVariant) return variantSelectsComponent.currentVariant.id.toString();
    
    try {
      const selectedOptions = document.querySelectorAll('input[type="radio"][name^="options"]:checked');
      if (selectedOptions.length > 0) {
        const productJson = document.querySelector('[data-product-json], script[data-product-json], script[type="application/json"][data-product]');
        if (productJson) {
          const productData = JSON.parse(productJson.textContent);
          if (productData.variants) {
            const selectedOptionValues = Array.from(selectedOptions).map(opt => opt.value);
            const matchedVariant = productData.variants.find(variant => variant.options.every((opt, idx) => opt === selectedOptionValues[idx]));
            if (matchedVariant) return matchedVariant.id.toString();
          }
        }
      }
    } catch (e) {}
    
    return null;
  }
  
  // Initialize a single widget instance
  function initWidgetInstance(widget) {
    let instanceId = widget.getAttribute('data-block-id');
    
    // Generate an instanceId if missing (backwards compatibility)
    if (!instanceId) {
      instanceId = 'legacy-' + Math.random().toString(36).substr(2, 9);
      widget.setAttribute('data-block-id', instanceId);
      console.log('Gleame Legacy: Generated block-id for widget:', instanceId);
    }
    
    const instance = getInstance(instanceId);
    instance.widget = widget;
    instance.productId = widget.getAttribute('data-product-id');
    instance.shopDomain = getShopDomain(widget);
    instance.variantId = getCurrentVariantId();
    const rawCartToken = widget.getAttribute('data-cart-token');
    instance.cartToken = (rawCartToken && rawCartToken.trim()) ? rawCartToken.trim() : null;
    
    // Log initialization for debugging
    console.log('Gleame Legacy: initWidgetInstance', instanceId, {
      productId: instance.productId,
      shopDomain: instance.shopDomain,
      hasWidget: !!instance.widget
    });
    
    // Set up file input listener for this instance
    const imageUpload = getElement(instanceId, 'imageUpload');
    if (imageUpload && !imageUpload.dataset.listenerAttached) {
      imageUpload.dataset.listenerAttached = 'true';
      imageUpload.addEventListener('change', function(event) {
        const files = event.target.files;
        if (files?.length > 0) processSelectedFile(instanceId, files[0]);
      });
    }
    
    // Set up drag and drop for this instance
    const placeholderContainer = widget.querySelector('.placeholder-image-container');
    if (placeholderContainer && !placeholderContainer.dataset.listenerAttached) {
      placeholderContainer.dataset.listenerAttached = 'true';
      
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        placeholderContainer.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
      });
      
      ['dragenter', 'dragover'].forEach(eventName => {
        placeholderContainer.addEventListener(eventName, () => {
          placeholderContainer.style.opacity = '0.8';
          placeholderContainer.style.transform = 'scale(1.02)';
        }, false);
      });
      
      ['dragleave', 'drop'].forEach(eventName => {
        placeholderContainer.addEventListener(eventName, () => {
          placeholderContainer.style.opacity = '1';
          placeholderContainer.style.transform = 'scale(1)';
        }, false);
      });
      
      placeholderContainer.addEventListener('drop', e => {
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) processSelectedFile(instanceId, files[0]);
      }, false);
    }
    
    showState(instanceId, 'upload');
    
    // Track widget view (only once per instance)
    if (!instance.viewTracked && instance.shopDomain && instance.productId) {
      instance.viewTracked = true;
      trackEvent(instanceId, 'widget_view');
    }
  }
  
  // Initialize widget - now initializes all legacy widgets
  window.widgetFunctions.initWidget = function() {
    const widgets = document.querySelectorAll('.glimpse-ai-widget');
    widgets.forEach(widget => initWidgetInstance(widget));
  };
  
  // Trigger file input - now accepts instanceId
  // Desktop: opens camera modal. Mobile: native file picker.
  window.widgetFunctions.triggerFileInput = function(instanceId) {
    if (!instanceId) {
      let widget = document.querySelector('.glimpse-ai-widget');
      if (!widget) widget = document.querySelector('.glimpse-integrated-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) {
      console.warn('Gleame Legacy: triggerFileInput called but no widget found');
      return;
    }
    
    const fileInput = getElement(instanceId, 'imageUpload');
    const openFilePicker = function() { if (fileInput) fileInput.click(); };

    if (window.gleameCamera && !isMobileDevice()) {
      window.gleameCamera.open(
        function(file) { processSelectedFile(instanceId, file); },
        openFilePicker
      );
    } else {
      openFilePicker();
    }
  };
  
  function setupVariantChangeListeners() {
    const variantSelect = document.querySelector('select[name="id"]');
    if (variantSelect) {
      variantSelect.addEventListener('change', e => {
        instances.forEach((instance, id) => { instance.variantId = e.target.value; });
      });
    }
    
    const variantRadios = document.querySelectorAll('input[name="id"][type="radio"]');
    variantRadios.forEach(radio => {
      radio.addEventListener('change', e => {
        if (e.target.checked) {
          instances.forEach((instance, id) => { instance.variantId = e.target.value; });
        }
      });
    });
    
    const allIdInputs = document.querySelectorAll('input[name="id"]');
    allIdInputs.forEach(input => {
      input.addEventListener('change', e => {
        instances.forEach((instance, id) => { instance.variantId = e.target.value; });
      });
    });
    
    document.addEventListener('variant:change', event => {
      if (event.detail?.variant?.id) {
        const variantId = event.detail.variant.id.toString();
        instances.forEach((instance, id) => { instance.variantId = variantId; });
      }
    });
    
    const productForm = document.querySelector('form[action*="/cart/add"]');
    if (productForm) {
      const observer = new MutationObserver(() => {
        const newVariantId = getCurrentVariantId();
        if (newVariantId) {
          instances.forEach((instance, id) => {
            if (newVariantId !== instance.variantId) instance.variantId = newVariantId;
          });
        }
      });
      observer.observe(productForm, { attributes: true, childList: true, subtree: true });
    }
  }
  
  // Reset transformation - now accepts instanceId
  window.widgetFunctions.resetTransformation = function(instanceId) {
    // If no instanceId, try to find the first widget's instanceId
    if (!instanceId) {
      let widget = document.querySelector('.glimpse-ai-widget');
      if (!widget) widget = document.querySelector('.glimpse-integrated-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) {
      console.warn('Gleame Legacy: resetTransformation called but no widget found');
      return;
    }
    
    const imageUpload = getElement(instanceId, 'imageUpload');
    const beforeImage = getElement(instanceId, 'beforeImage');
    const afterImage = getElement(instanceId, 'afterImage');

    if (imageUpload) imageUpload.value = '';
    if (beforeImage) { beforeImage.onload = null; beforeImage.onerror = null; beforeImage.src = ''; }
    if (afterImage) { afterImage.onload = null; afterImage.onerror = null; afterImage.src = ''; }

    const resultsState = getElement(instanceId, 'resultsState');
    if (resultsState) {
      const carouselRoot = resultsState.querySelector('.gvc-root');
      if (carouselRoot) carouselRoot.remove();
      const originalComparison = resultsState.querySelector('.before-after-grid');
      if (originalComparison) originalComparison.style.display = '';
    }
    const instance = getInstance(instanceId);
    instance.carouselSlides = null;
    instance.currentSlide = 0;

    showState(instanceId, 'upload');
  };
  
  // Show state - now accepts instanceId
  function showState(instanceId, state) {
    ['upload', 'processing', 'results', 'error'].forEach(s => {
      const el = getElement(instanceId, `${s}State`);
      if (el) el.style.display = s === state ? 'block' : 'none';
    });
    
    if (state === 'processing') startLoadingTextAnimation(instanceId);
    else stopLoadingTextAnimation(instanceId);
  }
  
  // Expose showState for legacy compatibility
  window.widgetFunctions.showState = function(state, instanceId) {
    // If only state passed, try to find first widget
    if (!instanceId) {
      let widget = document.querySelector('.glimpse-ai-widget');
      if (!widget) widget = document.querySelector('.glimpse-integrated-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (instanceId) showState(instanceId, state);
  };
  
  function startLoadingTextAnimation(instanceId) {
    const instance = getInstance(instanceId);
    const widget = getWidgetElement(instanceId);
    const loadingTextEl = widget?.querySelector('.loading-text');
    if (!loadingTextEl) return;
    
    let currentIndex = 0;
    loadingTextEl.textContent = loadingMessages[currentIndex];
    
    instance.loadingTextInterval = setInterval(() => {
      currentIndex++;
      if (currentIndex < loadingMessages.length) {
        loadingTextEl.textContent = loadingMessages[currentIndex];
      } else {
        clearInterval(instance.loadingTextInterval);
        instance.loadingTextInterval = null;
      }
    }, 3000);
  }
  
  function stopLoadingTextAnimation(instanceId) {
    const instance = getInstance(instanceId);
    if (instance.loadingTextInterval) {
      clearInterval(instance.loadingTextInterval);
      instance.loadingTextInterval = null;
    }
  }
  
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
  
  function isValidImageByExtension(fileName) {
    if (!fileName) return false;
    const ext = fileName.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif'].includes(ext);
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
    if (!file.type || file.type === '' || file.type === 'application/octet-stream') {
      return isValidImageByExtension(file.name);
    }
    return false;
  }
  
  // Show error - now accepts instanceId
  function showError(instanceId, message) {
    const errorMessage = getElement(instanceId, 'errorMessage');
    if (errorMessage) errorMessage.textContent = message;
    showState(instanceId, 'error');
  }
  
  // Expose showError for legacy compatibility
  window.widgetFunctions.showError = function(message, instanceId) {
    // If only message passed, try to find first widget
    if (!instanceId) {
      let widget = document.querySelector('.glimpse-ai-widget');
      if (!widget) widget = document.querySelector('.glimpse-integrated-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (instanceId) showError(instanceId, message);
  };
  
  function processSelectedFile(instanceId, file) {
    if (!file) return;
    
    showState(instanceId, 'upload');
    
    if (!isValidImageFile(file)) {
      showError(instanceId, 'Please upload an image file (JPG, PNG, HEIC, etc.).');
      return;
    }
    
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showError(instanceId, 'Image too large. Please upload an image smaller than 5MB.');
      return;
    }
    
    if (file.size === 0) {
      showError(instanceId, 'The selected file appears to be empty. Please try another image.');
      return;
    }
    
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
        
        const beforeImg = getElement(instanceId, 'beforeImage');
        if (beforeImg) {
          beforeImg.onload = null;
          beforeImg.onerror = null;
          
          let transformationStarted = false;
          
          // For HEIC files, browser can't display - just start transform immediately
          if (isHeic) {
            checkVariantsAndProceed(instanceId, file);
          } else {
            beforeImg.onload = function() {
              beforeImg.onload = null;
              beforeImg.onerror = null;
              if (!transformationStarted) {
                transformationStarted = true;
                checkVariantsAndProceed(instanceId, fileToSend);
              }
            };
            
            beforeImg.onerror = function() {
              beforeImg.onload = null;
              beforeImg.onerror = null;
              showError(instanceId, 'Error displaying image preview. Please try again.');
            };
            
            beforeImg.src = imageDataUrl;
          }
        } else {
          checkVariantsAndProceed(instanceId, isHeic ? file : fileToSend);
        }
      } catch (error) {
        showError(instanceId, 'Error loading image preview. Please try again.');
      }
    };

    reader.onerror = () => showError(instanceId, 'Error reading the image file. Please try again.');
    reader.onabort = () => showError(instanceId, 'File reading was interrupted. Please try again.');
    
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      showError(instanceId, 'Error reading the image file. Please try again.');
    }
  }
  
  async function transformImage(instanceId, file) {
    const instance = getInstance(instanceId);
    const widget = getWidgetElement(instanceId);
    showState(instanceId, 'processing');
    
    try {
      const freshVariantId = getCurrentVariantId();
      if (freshVariantId && freshVariantId !== instance.variantId) instance.variantId = freshVariantId;
      
      // Try to get productId and shopDomain from widget if not in instance (late initialization)
      if (!instance.productId && widget) {
        instance.productId = widget.getAttribute('data-product-id');
        console.log('Gleame Legacy: Late-loaded productId:', instance.productId);
      }
      if (!instance.shopDomain && widget) {
        instance.shopDomain = getShopDomain(widget);
        console.log('Gleame Legacy: Late-loaded shopDomain:', instance.shopDomain);
      }
      
      // Validate required fields
      if (!instance.productId) throw new Error('Product not found. Please refresh the page and try again.');
      if (!instance.shopDomain) throw new Error('Could not determine shop domain. Please refresh the page and try again.');
      if (!SHOPIFY_APP_URL) throw new Error('App URL not configured.');
      
      const formData = new FormData();
      formData.append('image', file);
      formData.append('productId', instance.productId);
      formData.append('shopDomain', instance.shopDomain);
      formData.append('widgetType', 'legacy');
      if (instance.variantId) formData.append('variantId', instance.variantId);
      console.log('Gleame Legacy: Sending transform for instance', instanceId, {
        productId: instance.productId,
        shopDomain: instance.shopDomain,
        variantId: instance.variantId
      });
      
      const apiUrl = SHOPIFY_APP_URL + '/api/storefront/transform-image';
      
      // Create abort controller for timeout (45 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      let response;
      try {
        response = await fetch(apiUrl, {
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
      
      if (!response.ok) throw new Error(result.error || `Server error: ${response.status}`);
      if (!result.success) throw new Error(result.error || 'Transformation failed');
      if (!result.generatedImage) throw new Error('No transformed image received');
      
      const afterImg = getElement(instanceId, 'afterImage');
      const beforeImg = getElement(instanceId, 'beforeImage');
      
      // Always set before image from server's processed input (handles HEIC conversion)
      console.log('processedInputImage received:', !!result.processedInputImage);
      if (beforeImg && result.processedInputImage) {
        console.log('Setting before image from server for instance', instanceId);
        beforeImg.src = `data:image/jpeg;base64,${result.processedInputImage}`;
      }
      
      if (afterImg) {
        afterImg.onload = null;
        afterImg.onerror = null;
        afterImg.onload = function() {
          afterImg.style.imageOrientation = 'from-image';
          afterImg.style.transform = 'none';
        };
        afterImg.src = `data:image/jpeg;base64,${result.generatedImage}`;
      }
      showState(instanceId, 'results');
      
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

    const variants = await fetchConfiguredVariants(instance.shopDomain, instance.productId);

    if (variants.length === 0) {
      transformImage(instanceId, file);
      return;
    }

    openVariantModal(variants, function(selected) {
      showState(instanceId, 'processing');
      runMultiVariantTransform(instanceId, file, selected,
        function(slides) { showCarouselInline(instanceId, slides); },
        function(msg) { showError(instanceId, msg); }
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

  function showCarouselInline(instanceId, slides) {
    if (slides.length === 1) {
      const beforeImg = getElement(instanceId, 'beforeImage');
      const afterImg = getElement(instanceId, 'afterImage');
      if (beforeImg && slides[0].processedInputImage) {
        beforeImg.src = 'data:image/jpeg;base64,' + slides[0].processedInputImage;
      }
      if (afterImg) {
        afterImg.onload = null; afterImg.onerror = null;
        afterImg.src = 'data:image/jpeg;base64,' + slides[0].generatedImage;
      }
      showState(instanceId, 'results');
      return;
    }

    showState(instanceId, 'results');
    const resultsState = getElement(instanceId, 'resultsState');
    if (!resultsState) return;

    const originalComparison = resultsState.querySelector('.before-after-grid');
    if (originalComparison) originalComparison.style.display = 'none';

    const existing = resultsState.querySelector('.gvc-root');
    if (existing) existing.remove();

    const carouselRoot = document.createElement('div');
    carouselRoot.className = 'gvc-root';
    resultsState.insertBefore(carouselRoot, resultsState.firstChild);
    buildCarousel(instanceId, slides, carouselRoot);
  }

  function buildCarousel(instanceId, slides, containerEl) {
    const instance = getInstance(instanceId);
    instance.carouselSlides = slides;
    instance.currentSlide = 0;

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

    containerEl.innerHTML =
      '<div class="gvc-tabs" id="gvc-tabs-' + instanceId + '">' + tabsHtml + '</div>' +
      '<div class="gvc-slides-wrap">' + slidesHtml + '</div>';

    var tabsEl = document.getElementById('gvc-tabs-' + instanceId);
    if (tabsEl) {
      tabsEl.addEventListener('click', function(e) {
        var tab = e.target.closest('.gvc-tab');
        if (!tab) return;
        goToSlide(instanceId, parseInt(tab.dataset.slide, 10), containerEl);
      });
    }
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

  // Shared variant selector modal (DOM-injected singleton)

  function copyWidgetFonts(el) {
    var widget = document.querySelector('.glimpse-ai-widget');
    if (!widget) return;
    var cs = getComputedStyle(widget);
    ['--header-font-family','--header-font-weight','--body-font-family','--body-font-weight'].forEach(function(v) {
      var val = cs.getPropertyValue(v);
      if (val) el.style.setProperty(v, val.trim());
    });
  }

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

      var variantImages = window.gleameVariantImages || {};
      var swatchImgUrl = variantImages[v.variantId] || variantImages[String(v.variantId)];
      var swatchHtml = swatchImgUrl
        ? '<img class="gvm-swatch" src="' + swatchImgUrl + '" alt="' + v.variantTitle + '">'
        : v.displayColor
          ? '<span class="gvm-swatch" style="background:' + v.displayColor + '"></span>'
          : '<span class="gvm-swatch gvm-swatch-empty"></span>';
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

  document.addEventListener('DOMContentLoaded', function() {
    // Initialize all legacy widgets
    const widgets = document.querySelectorAll('.glimpse-ai-widget');
    widgets.forEach(widget => initWidgetInstance(widget));
    
    setupVariantChangeListeners();
    
    console.log('Gleame Legacy: Initialized', instances.size, 'widget instance(s)');
  });
})();
