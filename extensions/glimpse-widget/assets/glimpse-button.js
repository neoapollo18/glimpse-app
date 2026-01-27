// Gleame Button Widget JavaScript v3.0 - Multi-instance support
console.log('Gleame Button Widget v3.0 loaded');

(function() {
  window.glimpseButton = window.glimpseButton || {};
  
  // Instance state storage - keyed by block.id
  const instances = new Map();
  
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  const WIDGET_TYPE = 'button';
  const loadingMessages = ['Processing...', 'Analyzing...', 'Creating magic...', 'Almost there...'];
  
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
        viewTracked: false,
        widget: null
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
    let el = document.getElementById(`${baseId}-${instanceId}`);
    if (el) return el;
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
    
    fetch(SHOPIFY_APP_URL + '/api/storefront/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: instance.shopDomain,
        productId: instance.productId,
        eventType: eventType,
        widgetType: WIDGET_TYPE
      })
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
    if (fileInput) fileInput.click();
  };
  
  // Set button to loading state
  function setButtonLoading(instanceId, isLoading) {
    const instance = getInstance(instanceId);
    const button = getElement(instanceId, 'mainButton');
    const btnText = button?.querySelector('.btn-text');
    const spinner = button?.querySelector('.btn-spinner');
    
    if (!button || !btnText) return;
    
    if (isLoading) {
      button.classList.add('is-loading');
      if (spinner) spinner.style.display = 'block';
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
      btnText.textContent = instance.originalButtonText;
      
      if (instance.loadingInterval) {
        clearInterval(instance.loadingInterval);
        instance.loadingInterval = null;
      }
    }
  }
  
  // Show results modal
  function showResults(instanceId, beforeUrl, afterUrl) {
    const modal = getElement(instanceId, 'resultsModal');
    const beforeImg = getElement(instanceId, 'beforeImage');
    const afterImg = getElement(instanceId, 'afterImage');
    
    if (beforeImg) beforeImg.src = beforeUrl;
    if (afterImg) afterImg.src = afterUrl;
    if (modal) modal.style.display = 'flex';
    
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
        
        transformImage(instanceId, isHeic ? file : fileToSend);
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
      
      console.log('Gleame Button: Sending transform for instance', instanceId, {
        productId: instance.productId,
        shopDomain: instance.shopDomain,
        variantId: instance.variantId
      });
      
      const response = await fetch(SHOPIFY_APP_URL + '/api/storefront/transform-image', {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Transformation failed');
      }
      
      setButtonLoading(instanceId, false);
      
      const beforeUrl = result.processedInputImage 
        ? `data:image/jpeg;base64,${result.processedInputImage}`
        : URL.createObjectURL(file);
      const afterUrl = `data:image/jpeg;base64,${result.generatedImage}`;
      
      showResults(instanceId, beforeUrl, afterUrl);
      
    } catch (error) {
      showError(instanceId, error.message || 'Something went wrong. Please try again.');
    }
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
    instance.originalButtonText = widget.getAttribute('data-button-text') || 'TRY IT ON';
    
    // Track widget view (only once per instance)
    if (!instance.viewTracked) {
      instance.viewTracked = true;
      trackEvent(instanceId, 'widget_view');
    }
    
    // Move modals to body for proper full-screen overlay
    const resultsModal = getElement(instanceId, 'resultsModal');
    const errorModal = getElement(instanceId, 'errorModal');
    const widgetStyles = widget.getAttribute('style') || '';
    
    if (resultsModal && resultsModal.parentElement !== document.body) {
      resultsModal.setAttribute('style', (resultsModal.getAttribute('style') || '') + ';' + widgetStyles);
      document.body.appendChild(resultsModal);
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
