/* Glimpse Banner Widget JavaScript */
console.log('Glimpse Banner Widget v1.0 loaded');

(function() {
  'use strict';

  // State
  let widget = null;
  let currentProductId = null;
  let currentShopDomain = null;
  let currentVariantId = null;
  
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';

  // Initialize namespace
  window.bannerWidgetFunctions = window.bannerWidgetFunctions || {};

  // Get shop domain (comprehensive detection like integrated widget)
  function getShopDomain() {
    // Check for manual override
    if (widget) {
      const manualDomain = widget.getAttribute('data-manual-shop-domain');
      if (manualDomain) return manualDomain;
    }
    
    const hostname = window.location.hostname;
    if (hostname.includes('.myshopify.com')) return hostname;
    
    // Check Shopify scripts
    const shopifyScripts = document.querySelectorAll('script[src*="myshopify.com"]');
    for (let script of shopifyScripts) {
      const match = script.src.match(/\/\/([^\/]+\.myshopify\.com)/);
      if (match) return match[1];
    }
    
    // Try Shopify global
    if (window.Shopify?.shop) return window.Shopify.shop;
    
    // Check meta tag
    const shopMeta = document.querySelector('meta[name="shopify-shop-domain"]');
    if (shopMeta) return shopMeta.content;
    
    // Check links
    const allLinks = document.querySelectorAll('link[href*="myshopify.com"], a[href*="myshopify.com"]');
    for (let link of allLinks) {
      const match = link.href.match(/\/\/([^\/]+\.myshopify\.com)/);
      if (match) return match[1];
    }
    
    return hostname;
  }

  // Get current variant ID (comprehensive detection like integrated widget)
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

  // Show state
  function showState(stateName) {
    if (!widget) return;
    
    const states = widget.querySelectorAll('.banner-state');
    states.forEach(state => {
      state.style.display = 'none';
    });
    
    const targetState = widget.querySelector('.' + stateName + '-state');
    if (targetState) {
      targetState.style.display = 'flex';
    }
  }

  // Trigger file input
  window.bannerWidgetFunctions.triggerFileInput = function() {
    if (!widget) return;
    const fileInput = widget.querySelector('.banner-file-input');
    if (fileInput) fileInput.click();
  };

  // Reset banner
  window.bannerWidgetFunctions.resetBanner = function() {
    showState('upload');
  };

  // Mobile detection
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

  // Convert data URL to File
  function dataUrlToFile(dataUrl, fileName) {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], fileName, { type: mime });
  }

  // Check if HEIC/HEIF file
  function isHeicOrHeif(file) {
    const heicMimeTypes = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
    if (heicMimeTypes.includes(file.type?.toLowerCase())) return true;
    const ext = file.name?.toLowerCase().split('.').pop();
    return ext === 'heic' || ext === 'heif';
  }

  // Handle file select
  window.bannerWidgetFunctions.handleFileSelect = async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    showState('processing');

    try {
      let processedFile = file;
      const isHeic = isHeicOrHeif(file);
      const isMobile = isMobileDevice();
      const isRecent = isRecentlyTakenPhoto(file);

      // Handle mobile selfie flip (for non-HEIC recent photos)
      if (isMobile && isRecent && !isHeic) {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        const flippedDataUrl = await flipImageHorizontally(dataUrl);
        processedFile = dataUrlToFile(flippedDataUrl, file.name || 'selfie.jpg');
      }

      // Compress image
      const compressedFile = await compressImage(processedFile);
      
      // Upload and transform
      await uploadAndTransform(compressedFile);
    } catch (error) {
      console.error('Error processing image:', error);
      showError(error.message || 'Failed to process image');
    }

    // Reset file input
    event.target.value = '';
  };

  // Compress image
  async function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
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

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  }

  // Upload and transform
  async function uploadAndTransform(file) {
    // Refresh variant ID before sending
    const freshVariantId = getCurrentVariantId();
    if (freshVariantId && freshVariantId !== currentVariantId) {
      currentVariantId = freshVariantId;
    }
    
    if (!currentShopDomain) {
      throw new Error('Could not determine shop domain. Please refresh and try again.');
    }
    
    const formData = new FormData();
    formData.append('image', file);
    formData.append('productId', currentProductId);
    formData.append('shopDomain', currentShopDomain);
    if (currentVariantId) {
      formData.append('variantId', currentVariantId);
    }

    const apiUrl = SHOPIFY_APP_URL + '/api/storefront/transform-image';

    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });

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

    // Use processedInputImage from server for before (handles HEIC), generatedImage for after
    const beforeUrl = result.processedInputImage 
      ? `data:image/jpeg;base64,${result.processedInputImage}`
      : URL.createObjectURL(file);
    const afterUrl = `data:image/jpeg;base64,${result.generatedImage}`;
    
    showResults(beforeUrl, afterUrl);
  }

  // Show results
  function showResults(originalUrl, transformedUrl) {
    if (!widget) return;
    
    const beforeImg = widget.querySelector('.result-before');
    const afterImg = widget.querySelector('.result-after');
    
    if (beforeImg) beforeImg.src = originalUrl;
    if (afterImg) afterImg.src = transformedUrl;
    
    showState('results');
  }

  // Show error
  function showError(message) {
    if (!widget) return;
    
    const errorMessage = widget.querySelector('.banner-error-message');
    if (errorMessage) {
      errorMessage.textContent = message;
    }
    
    showState('error');
  }

  // Initialize
  function init() {
    widget = document.querySelector('.glimpse-banner-widget');
    if (!widget) {
      console.log('Glimpse Banner: No widget found on page');
      return;
    }

    currentProductId = widget.getAttribute('data-product-id');
    currentShopDomain = getShopDomain();
    currentVariantId = getCurrentVariantId();
    
    console.log('Glimpse Banner initialized:', {
      productId: currentProductId,
      shopDomain: currentShopDomain,
      variantId: currentVariantId
    });

    showState('upload');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

