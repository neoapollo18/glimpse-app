// Gleame Widget JavaScript - Integrated Horizontal Design v2.0
// Multi-instance support with backwards compatibility
console.log('Gleame Integrated Horizontal Widget v2.0 loaded');

(function() {
  // Namespace for this widget (shared with other Gleame widgets)
  window.widgetFunctions = window.widgetFunctions || {};
  
  // Instance state storage - keyed by block.id
  const instances = new Map();
  
  const loadingMessages = ['Analyzing image...', 'Creating preview...', 'Working our magic...', 'Almost there...'];
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  const WIDGET_TYPE = 'horizontal';
  
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
        widget: null
      });
    }
    return instances.get(instanceId);
  }
  
  // Find widget element by instanceId
  function getWidgetElement(instanceId) {
    // Try to find by block-id first
    let widget = document.querySelector(`.glimpse-integrated-horizontal[data-block-id="${instanceId}"]`);
    if (widget) return widget;
    
    // Fallback: try first horizontal widget
    widget = document.querySelector('.glimpse-integrated-horizontal');
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
  
  // Track analytics event (widget view, add to cart, etc.)
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
    }).catch(() => {}); // Silent fail
  }

  // Initialize a single widget instance
  function initWidgetInstance(widget) {
    let instanceId = widget.getAttribute('data-block-id');
    
    // Generate an instanceId if missing (backwards compatibility)
    if (!instanceId) {
      instanceId = 'horizontal-' + Math.random().toString(36).substr(2, 9);
      widget.setAttribute('data-block-id', instanceId);
      console.log('Gleame Horizontal: Generated block-id for widget:', instanceId);
    }
    
    const instance = getInstance(instanceId);
    instance.widget = widget;
    instance.productId = widget.getAttribute('data-product-id');
    instance.shopDomain = getShopDomain(widget);
    instance.variantId = getCurrentVariantId();
    const rawCartToken = widget.getAttribute('data-cart-token');
    instance.cartToken = (rawCartToken && rawCartToken.trim()) ? rawCartToken.trim() : null;
    
    // Log initialization for debugging
    console.log('Gleame Horizontal: initWidgetInstance', instanceId, {
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
    const placeholderContainer = widget.querySelector('.horizontal-placeholder');
    if (placeholderContainer && !placeholderContainer.dataset.listenerAttached) {
      placeholderContainer.dataset.listenerAttached = 'true';
      
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        placeholderContainer.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
      });
      
      ['dragenter', 'dragover'].forEach(eventName => {
        placeholderContainer.addEventListener(eventName, () => {
          placeholderContainer.classList.add('drag-over');
        }, false);
      });
      
      ['dragleave', 'drop'].forEach(eventName => {
        placeholderContainer.addEventListener(eventName, () => {
          placeholderContainer.classList.remove('drag-over');
        }, false);
      });
      
      placeholderContainer.addEventListener('drop', e => {
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) processSelectedFile(instanceId, files[0]);
      }, false);
    }
    
    showStateHorizontal(instanceId, 'upload');
    
    // Track widget view (only once per instance)
    if (!instance.viewTracked) {
      instance.viewTracked = true;
      trackEvent(instanceId, 'widget_view');
    }
  }

  // Initialize horizontal widget - now initializes all horizontal widgets
  window.widgetFunctions.initIntegratedHorizontalWidget = function() {
    const widgets = document.querySelectorAll('.glimpse-integrated-horizontal');
    widgets.forEach(widget => initWidgetInstance(widget));
  };
  
  // Horizontal-specific trigger - now accepts instanceId
  // Desktop: opens camera modal. Mobile: native file picker.
  window.widgetFunctions.triggerFileInputHorizontal = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-integrated-horizontal');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) {
      console.warn('Gleame Horizontal: triggerFileInputHorizontal called but no widget found');
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
  
  // Horizontal-specific reset - now accepts instanceId
  window.widgetFunctions.resetTransformationHorizontal = function(instanceId) {
    // If no instanceId, try to find the first widget's instanceId
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-integrated-horizontal');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) {
      console.warn('Gleame Horizontal: resetTransformationHorizontal called but no widget found');
      return;
    }
    
    const imageUpload = getElement(instanceId, 'imageUpload');
    const beforeImage = getElement(instanceId, 'beforeImage');
    const afterImage = getElement(instanceId, 'afterImage');
    
    if (imageUpload) imageUpload.value = '';
    if (beforeImage) { beforeImage.onload = null; beforeImage.onerror = null; beforeImage.src = ''; }
    if (afterImage) { afterImage.onload = null; afterImage.onerror = null; afterImage.src = ''; }
    
    showStateHorizontal(instanceId, 'upload');
  };
  
  function showStateHorizontal(instanceId, state) {
    const widget = getWidgetElement(instanceId);
    if (!widget) return;
    
    ['upload', 'processing', 'results', 'error'].forEach(s => {
      const el = getElement(instanceId, `${s}State`);
      if (el) el.style.display = s === state ? 'block' : 'none';
    });
    
    // Toggle buttons
    const uploadBtn = getElement(instanceId, 'uploadButton');
    const retryBtn = getElement(instanceId, 'retryButton');
    
    if (uploadBtn) uploadBtn.style.display = (state === 'upload' || state === 'processing') ? 'flex' : 'none';
    if (retryBtn) retryBtn.style.display = (state === 'results' || state === 'error') ? 'flex' : 'none';
    
    if (state === 'processing') startLoadingTextAnimation(instanceId);
    else stopLoadingTextAnimation(instanceId);
  }
  
  function startLoadingTextAnimation(instanceId) {
    const instance = getInstance(instanceId);
    const widget = getWidgetElement(instanceId);
    const loadingTextEl = widget?.querySelector('.loading-text-content');
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
  
  // Mobile device detection
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  }
  
  // Check if photo was recently taken (within 2 minutes)
  function isRecentlyTakenPhoto(file) {
    return file.lastModified > (Date.now() - 120000);
  }
  
  // Flip image horizontally (for mobile front camera selfies)
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
  
  // Convert data URL to File object
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
  
  function showErrorHorizontal(instanceId, message) {
    const errorMessage = getElement(instanceId, 'errorMessage');
    if (errorMessage) errorMessage.textContent = message;
    showStateHorizontal(instanceId, 'error');
  }
  
  function processSelectedFile(instanceId, file) {
    if (!file) return;
    
    showStateHorizontal(instanceId, 'upload');
    
    if (!isValidImageFile(file)) {
      showErrorHorizontal(instanceId, 'Please upload an image file (JPG, PNG, HEIC, etc.).');
      return;
    }
    
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showErrorHorizontal(instanceId, 'Image too large. Please upload an image smaller than 5MB.');
      return;
    }
    
    if (file.size === 0) {
      showErrorHorizontal(instanceId, 'The selected file appears to be empty. Please try another image.');
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
        
        // Flip mobile selfies (front camera) that were just taken
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
            transformImage(instanceId, file);
          } else {
            beforeImg.onload = function() {
              beforeImg.onload = null;
              beforeImg.onerror = null;
              if (!transformationStarted) {
                transformationStarted = true;
                transformImage(instanceId, fileToSend);
              }
            };
            
            beforeImg.onerror = function() {
              beforeImg.onload = null;
              beforeImg.onerror = null;
              showErrorHorizontal(instanceId, 'Error displaying image preview. Please try again.');
            };
            
            beforeImg.src = imageDataUrl;
          }
        } else {
          transformImage(instanceId, isHeic ? file : fileToSend);
        }
      } catch (error) {
        showErrorHorizontal(instanceId, 'Error loading image preview. Please try again.');
      }
    };
    
    reader.onerror = () => showErrorHorizontal(instanceId, 'Error reading the image file. Please try again.');
    reader.onabort = () => showErrorHorizontal(instanceId, 'File reading was interrupted. Please try again.');
    
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      showErrorHorizontal(instanceId, 'Error reading the image file. Please try again.');
    }
  }
  
  async function transformImage(instanceId, file) {
    const instance = getInstance(instanceId);
    const widget = getWidgetElement(instanceId);
    showStateHorizontal(instanceId, 'processing');
    
    try {
      const freshVariantId = getCurrentVariantId();
      if (freshVariantId && freshVariantId !== instance.variantId) instance.variantId = freshVariantId;
      
      // Try to get productId and shopDomain from widget if not in instance (late initialization)
      if (!instance.productId && widget) {
        instance.productId = widget.getAttribute('data-product-id');
        console.log('Gleame Horizontal: Late-loaded productId:', instance.productId);
      }
      if (!instance.shopDomain && widget) {
        instance.shopDomain = getShopDomain(widget);
        console.log('Gleame Horizontal: Late-loaded shopDomain:', instance.shopDomain);
      }
      
      // Validate required fields
      if (!instance.productId) throw new Error('Product not found. Please refresh the page and try again.');
      if (!instance.shopDomain) throw new Error('Could not determine shop domain. Please refresh the page and try again.');
      if (!SHOPIFY_APP_URL) throw new Error('App URL not configured.');
      
      const formData = new FormData();
      formData.append('image', file);
      formData.append('productId', instance.productId);
      formData.append('shopDomain', instance.shopDomain);
      formData.append('widgetType', 'horizontal');
      if (instance.variantId) formData.append('variantId', instance.variantId);
      console.log('Gleame Horizontal: Sending transform for instance', instanceId, {
        productId: instance.productId,
        shopDomain: instance.shopDomain,
        variantId: instance.variantId
      });
      
      const apiUrl = SHOPIFY_APP_URL + '/api/storefront/transform-image';
      
      // Create abort controller for timeout (90 seconds - OpenAI can be slower)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

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
      
      showStateHorizontal(instanceId, 'results');
      
    } catch (error) {
      showErrorHorizontal(instanceId, error.message || 'Something went wrong. Please try again.');
    }
  }
  
  document.addEventListener('DOMContentLoaded', function() {
    // Initialize all horizontal widgets
    const widgets = document.querySelectorAll('.glimpse-integrated-horizontal');
    widgets.forEach(widget => initWidgetInstance(widget));
    
    setupVariantChangeListeners();
    
    console.log('Gleame Horizontal: Initialized', instances.size, 'widget instance(s)');
  });
})();
