/* Glimpse Banner Widget JavaScript */
(function() {
  'use strict';

  // State
  let widget = null;
  let currentProductId = null;
  let currentShopDomain = null;
  let currentVariantId = null;

  // Initialize namespace
  window.bannerWidgetFunctions = window.bannerWidgetFunctions || {};

  // Get shop domain
  function getShopDomain() {
    // Check for manual override
    if (widget) {
      const manualDomain = widget.getAttribute('data-manual-shop-domain');
      if (manualDomain) return manualDomain;
    }
    
    // Try Shopify global
    if (typeof Shopify !== 'undefined' && Shopify.shop) {
      return Shopify.shop;
    }
    
    // Fallback to hostname
    return window.location.hostname;
  }

  // Get current variant ID
  function getCurrentVariantId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('variant');
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

  // Handle file select
  window.bannerWidgetFunctions.handleFileSelect = async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    showState('processing');

    try {
      let processedFile = file;

      // Handle HEIC files
      if (file.type === 'image/heic' || file.type === 'image/heif' || 
          file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
        if (typeof heic2any !== 'undefined') {
          try {
            const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
            processedFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
          } catch (heicError) {
            console.warn('HEIC conversion failed, trying original:', heicError);
          }
        }
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
    const formData = new FormData();
    formData.append('image', file);
    formData.append('productId', currentProductId);
    formData.append('shopDomain', currentShopDomain);
    if (currentVariantId) {
      formData.append('variantId', currentVariantId);
    }

    // Determine API URL
    let apiUrl = 'https://glimpse-app.onrender.com/api/storefront/transform-image';
    
    // Use relative URL if on same domain
    if (window.location.hostname.includes('glimpse-app') || 
        window.location.hostname === 'localhost') {
      apiUrl = '/api/storefront/transform-image';
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Transformation failed');
    }

    const result = await response.json();

    if (result.success && result.transformedImageUrl) {
      showResults(URL.createObjectURL(file), result.transformedImageUrl);
    } else {
      throw new Error(result.error || 'Transformation failed');
    }
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
    if (!widget) return;

    currentProductId = widget.getAttribute('data-product-id');
    currentShopDomain = getShopDomain();
    currentVariantId = getCurrentVariantId();

    showState('upload');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

