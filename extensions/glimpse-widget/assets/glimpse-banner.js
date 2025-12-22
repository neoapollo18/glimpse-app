// Glimpse Banner Widget JavaScript v1.0
console.log('Glimpse Banner Widget v1.0 loaded');

(function() {
  window.glimpseBanner = window.glimpseBanner || {};
  
  let currentProductId = null;
  let currentShopDomain = null;
  let currentVariantId = null;
  
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  
  function getShopDomain() {
    const widget = document.querySelector('.glimpse-banner-widget');
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
  
  function init() {
    const widget = document.querySelector('.glimpse-banner-widget');
    if (!widget) return;
    
    currentProductId = widget.getAttribute('data-product-id');
    currentShopDomain = getShopDomain();
    currentVariantId = getCurrentVariantId();
    
    showState('upload');
    setupVariantListeners();
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
  
  window.glimpseBanner.triggerUpload = function() {
    const widget = document.querySelector('.glimpse-banner-widget');
    const fileInput = widget?.querySelector('#imageUpload');
    if (fileInput) fileInput.click();
  };
  
  window.glimpseBanner.reset = function() {
    const widget = document.querySelector('.glimpse-banner-widget');
    const imageUpload = widget?.querySelector('#imageUpload');
    const beforeImage = widget?.querySelector('#beforeImage');
    const afterImage = widget?.querySelector('#afterImage');
    
    if (imageUpload) imageUpload.value = '';
    if (beforeImage) { beforeImage.onload = null; beforeImage.onerror = null; beforeImage.src = ''; }
    if (afterImage) { afterImage.onload = null; afterImage.onerror = null; afterImage.src = ''; }
    
    showState('upload');
  };
  
  function showState(state) {
    const widget = document.querySelector('.glimpse-banner-widget');
    if (!widget) return;
    
    ['upload', 'processing', 'results', 'error'].forEach(s => {
      const el = widget.querySelector(`#${s}State`);
      if (el) el.style.display = s === state ? 'flex' : 'none';
    });
  }
  
  function showError(message) {
    const widget = document.querySelector('.glimpse-banner-widget');
    const errorMessage = widget?.querySelector('#errorMessage');
    if (errorMessage) errorMessage.textContent = message;
    showState('error');
  }
  
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
    showState('processing');
    
    try {
      const freshVariantId = getCurrentVariantId();
      if (freshVariantId) currentVariantId = freshVariantId;
      
      if (!currentShopDomain) throw new Error('Could not determine shop domain.');
      
      const formData = new FormData();
      formData.append('image', file);
      formData.append('productId', currentProductId);
      formData.append('shopDomain', currentShopDomain);
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
      
      const widget = document.querySelector('.glimpse-banner-widget');
      const beforeImg = widget?.querySelector('#beforeImage');
      const afterImg = widget?.querySelector('#afterImage');
      
      if (beforeImg && result.processedInputImage) {
        beforeImg.src = `data:image/jpeg;base64,${result.processedInputImage}`;
      }
      
      if (afterImg && result.generatedImage) {
        afterImg.src = `data:image/jpeg;base64,${result.generatedImage}`;
      }
      
      showState('results');
      
    } catch (error) {
      showError(error.message || 'Something went wrong. Please try again.');
    }
  }
  
  document.addEventListener('DOMContentLoaded', function() {
    const widget = document.querySelector('.glimpse-banner-widget');
    if (!widget) return;
    
    init();
    
    const imageUpload = widget.querySelector('#imageUpload');
    if (imageUpload) {
      imageUpload.addEventListener('change', function(event) {
        const files = event.target.files;
        if (files?.length > 0) processFile(files[0]);
      });
    }
  });
})();

