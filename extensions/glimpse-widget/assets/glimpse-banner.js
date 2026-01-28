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
        originalButtonText: '',
        loadingInterval: null,
        loadingMessageIndex: 0,
        widget: null
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
  window.bannerWidgetFunctions.triggerFileInput = function(instanceId) {
    if (!instanceId) {
      const widget = document.querySelector('.glimpse-banner-widget');
      instanceId = widget?.getAttribute('data-block-id');
    }
    if (!instanceId) return;
    
    const btn = getButton(instanceId);
    if (btn?.classList.contains('is-loading')) return;
    
    const fileInput = getElement(instanceId, 'bannerFileInput');
    if (fileInput) fileInput.click();
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
        await uploadAndTransform(instanceId, file);
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
      await uploadAndTransform(instanceId, compressedFile);
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
