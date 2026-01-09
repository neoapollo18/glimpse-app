// Gleame Button Widget JavaScript v2.0
console.log('Gleame Button Widget v2.0 loaded');

(function() {
  window.glimpseButton = window.glimpseButton || {};
  
  let currentProductId = null;
  let currentShopDomain = null;
  let currentVariantId = null;
  let originalButtonText = '';
  
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  const WIDGET_TYPE = 'button';
  const loadingMessages = ['Processing...', 'Analyzing...', 'Creating magic...', 'Almost there...'];
  let viewTracked = false;
  let loadingMessageIndex = 0;
  let loadingInterval = null;
  
  function getShopDomain() {
    const widget = document.querySelector('.glimpse-button-widget');
    const manualDomain = widget?.getAttribute('data-manual-shop-domain');
    if (manualDomain) return manualDomain;
    
    const hostname = window.location.hostname;
    if (hostname.includes('.myshopify.com')) return hostname;
    
    const shopifyScripts = document.querySelectorAll('script[src*="myshopify.com"]');
    for (let script of shopifyScripts) {
      const match = script.src.match(/\/\/([^\/]+\.myshopify\.com)/);
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
  
  // Track analytics event (widget view, add to cart, etc.)
  function trackEvent(eventType) {
    if (!currentShopDomain || !currentProductId) return;
    
    fetch(SHOPIFY_APP_URL + '/api/storefront/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: currentShopDomain,
        productId: currentProductId,
        eventType: eventType,
        widgetType: WIDGET_TYPE
      })
    }).catch(() => {}); // Silent fail
  }

  function init() {
    const widget = document.querySelector('.glimpse-button-widget');
    if (!widget) return;
    
    currentProductId = widget.getAttribute('data-product-id');
    currentShopDomain = getShopDomain();
    currentVariantId = getCurrentVariantId();
    originalButtonText = widget.getAttribute('data-button-text') || 'TRY IT ON';
    
    // Track widget view (only once per page load)
    if (!viewTracked) {
      viewTracked = true;
      trackEvent('widget_view');
    }
    
    // Move modals to body for proper full-screen overlay
    // Copy CSS variables from widget to modals so they inherit the configuration
    const resultsModal = widget.querySelector('#resultsModal');
    const errorModal = widget.querySelector('#errorModal');
    const widgetStyles = widget.getAttribute('style') || '';
    
    if (resultsModal) {
      resultsModal.setAttribute('style', (resultsModal.getAttribute('style') || '') + ';' + widgetStyles);
      document.body.appendChild(resultsModal);
    }
    if (errorModal) {
      errorModal.setAttribute('style', (errorModal.getAttribute('style') || '') + ';' + widgetStyles);
      document.body.appendChild(errorModal);
    }
    
    setupVariantListeners();
    
    console.log('Gleame Button initialized:', {
      productId: currentProductId,
      shopDomain: currentShopDomain,
      variantId: currentVariantId
    });
  }
  
  function setupVariantListeners() {
    const variantSelect = document.querySelector('select[name="id"]');
    if (variantSelect) {
      variantSelect.addEventListener('change', e => { currentVariantId = e.target.value; });
    }
    
    document.addEventListener('variant:change', event => {
      if (event.detail?.variant?.id) currentVariantId = event.detail.variant.id.toString();
    });
  }
  
  // Trigger file upload
  window.glimpseButton.triggerUpload = function() {
    const widget = document.querySelector('.glimpse-button-widget');
    const fileInput = widget?.querySelector('#imageUpload');
    if (fileInput) fileInput.click();
  };
  
  // Set button to loading state
  function setButtonLoading(isLoading) {
    const widget = document.querySelector('.glimpse-button-widget');
    const button = widget?.querySelector('#mainButton');
    const btnText = button?.querySelector('.btn-text');
    const spinner = button?.querySelector('.btn-spinner');
    
    if (!button || !btnText) return;
    
    if (isLoading) {
      button.classList.add('is-loading');
      spinner.style.display = 'block';
      loadingMessageIndex = 0;
      btnText.textContent = loadingMessages[0];
      
      // Cycle through loading messages
      loadingInterval = setInterval(() => {
        loadingMessageIndex++;
        if (loadingMessageIndex < loadingMessages.length) {
          btnText.textContent = loadingMessages[loadingMessageIndex];
        }
      }, 2500);
    } else {
      button.classList.remove('is-loading');
      spinner.style.display = 'none';
      btnText.textContent = originalButtonText;
      
      if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
      }
    }
  }
  
  // Show results modal
  function showResults(beforeUrl, afterUrl) {
    const modal = document.getElementById('resultsModal');
    const beforeImg = document.getElementById('beforeImage');
    const afterImg = document.getElementById('afterImage');
    
    if (beforeImg) beforeImg.src = beforeUrl;
    if (afterImg) afterImg.src = afterUrl;
    if (modal) modal.style.display = 'flex';
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }
  
  // Close results modal
  window.glimpseButton.closeResults = function() {
    const modal = document.getElementById('resultsModal');
    if (modal) modal.style.display = 'none';
    
    // Restore body scroll
    document.body.style.overflow = '';
  };
  
  // Show error modal
  function showError(message) {
    setButtonLoading(false);
    
    const modal = document.getElementById('errorModal');
    const errorMessage = document.getElementById('errorMessage');
    
    if (errorMessage) errorMessage.textContent = message;
    if (modal) modal.style.display = 'flex';
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }
  
  // Close error modal
  window.glimpseButton.closeError = function() {
    const modal = document.getElementById('errorModal');
    if (modal) modal.style.display = 'none';
    
    // Restore body scroll
    document.body.style.overflow = '';
  };
  
  // Try again - close modal and reset
  window.glimpseButton.tryAgain = function() {
    window.glimpseButton.closeResults();
    window.glimpseButton.closeError();
    
    const widget = document.querySelector('.glimpse-button-widget');
    const imageUpload = widget?.querySelector('#imageUpload');
    const beforeImage = document.getElementById('beforeImage');
    const afterImage = document.getElementById('afterImage');
    
    if (imageUpload) imageUpload.value = '';
    if (beforeImage) { beforeImage.onload = null; beforeImage.onerror = null; beforeImage.src = ''; }
    if (afterImage) { afterImage.onload = null; afterImage.onerror = null; afterImage.src = ''; }
    
    // Trigger new upload
    window.glimpseButton.triggerUpload();
  };
  
  // Reset to initial state
  window.glimpseButton.reset = function() {
    setButtonLoading(false);
    window.glimpseButton.closeResults();
    window.glimpseButton.closeError();
    
    const widget = document.querySelector('.glimpse-button-widget');
    const imageUpload = widget?.querySelector('#imageUpload');
    const beforeImage = document.getElementById('beforeImage');
    const afterImage = document.getElementById('afterImage');
    
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
  
  function processFile(file) {
    if (!file) return;
    
    if (!isValidImageFile(file)) {
      showError('Please upload an image file (JPG, PNG, HEIC, etc.).');
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showError('Image too large. Please upload an image smaller than 5MB.');
      return;
    }
    
    // Start loading state on button
    setButtonLoading(true);
    
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
        
        transformImage(isHeic ? file : fileToSend);
      } catch (error) {
        showError('Error loading image. Please try again.');
      }
    };
    
    reader.onerror = () => showError('Error reading the image file.');
    reader.readAsDataURL(file);
  }
  
  async function transformImage(file) {
    try {
      const freshVariantId = getCurrentVariantId();
      if (freshVariantId) currentVariantId = freshVariantId;
      
      if (!currentShopDomain) throw new Error('Could not determine shop domain.');
      
      const formData = new FormData();
      formData.append('image', file);
      formData.append('productId', currentProductId);
      formData.append('shopDomain', currentShopDomain);
      formData.append('widgetType', 'button');
      if (currentVariantId) formData.append('variantId', currentVariantId);
      
      const response = await fetch(SHOPIFY_APP_URL + '/api/storefront/transform-image', {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Transformation failed');
      }
      
      // Stop loading state
      setButtonLoading(false);
      
      // Build image URLs
      const beforeUrl = result.processedInputImage 
        ? `data:image/jpeg;base64,${result.processedInputImage}`
        : URL.createObjectURL(file);
      const afterUrl = `data:image/jpeg;base64,${result.generatedImage}`;
      
      // Show results in modal
      showResults(beforeUrl, afterUrl);
      
    } catch (error) {
      showError(error.message || 'Something went wrong. Please try again.');
    }
  }
  
  // Close modal when clicking outside
  function handleOverlayClick(e) {
    if (e.target.classList.contains('results-modal-overlay')) {
      window.glimpseButton.closeResults();
    }
    if (e.target.classList.contains('error-modal-overlay')) {
      window.glimpseButton.closeError();
    }
  }
  
  // Close modal on escape key
  function handleEscapeKey(e) {
    if (e.key === 'Escape') {
      window.glimpseButton.closeResults();
      window.glimpseButton.closeError();
    }
  }
  
  document.addEventListener('DOMContentLoaded', function() {
    const widget = document.querySelector('.glimpse-button-widget');
    if (!widget) return;
    
    init();
    
    const imageUpload = widget.querySelector('#imageUpload');
    if (imageUpload) {
      imageUpload.addEventListener('change', function(event) {
        const files = event.target.files;
        if (files?.length > 0) processFile(files[0]);
      });
    }
    
    // Add click outside to close (modals are now on body)
    const resultsModal = document.getElementById('resultsModal');
    const errorModal = document.getElementById('errorModal');
    
    if (resultsModal) resultsModal.addEventListener('click', handleOverlayClick);
    if (errorModal) errorModal.addEventListener('click', handleOverlayClick);
    
    // Add escape key listener
    document.addEventListener('keydown', handleEscapeKey);
  });
})();
