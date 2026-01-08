// Gleame Widget JavaScript - Integrated Design v1.0
// Full feature parity with original widget (HEIC, mobile selfie flip, variant detection)
console.log('Gleame Integrated Widget v1.0 loaded');

(function() {
  // Namespace for this widget (shared with other Gleame widgets)
  window.widgetFunctions = window.widgetFunctions || {};
  
  let currentProductId = null;
  let currentShopDomain = null;
  let currentVariantId = null;
  let loadingTextInterval = null;
  let currentImageWasFlipped = false;
  
  const loadingMessages = ['Analyzing image...', 'Creating your transformation...', 'Working our magic...', 'Almost there...'];
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  
  function getShopDomain() {
    // Check integrated widget first, then fall back to original
    const widget = document.querySelector('.glimpse-integrated-widget') || document.querySelector('.glimpse-ai-widget');
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
    
    const allLinks = document.querySelectorAll('link[href*="myshopify.com"], a[href*="myshopify.com"]');
    for (let link of allLinks) {
      const match = link.href.match(/\/\/([^\/]+\.myshopify\.com)/);
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
  
  window.widgetFunctions.initWidget = function() {
    // Prioritize integrated widget, but support original if this JS is used there
    const widget = document.querySelector('.glimpse-integrated-widget') || document.querySelector('.glimpse-ai-widget');
    if (!widget) return;
    
    currentProductId = widget.getAttribute('data-product-id');
    currentShopDomain = getShopDomain();
    currentVariantId = getCurrentVariantId();
    window.widgetFunctions.showState('upload');
  };
  
  // Separate init for integrated widget specifically
  window.widgetFunctions.initIntegratedWidget = function() {
    const widget = document.querySelector('.glimpse-integrated-widget');
    if (!widget) return;
    
    currentProductId = widget.getAttribute('data-product-id');
    currentShopDomain = getShopDomain();
    currentVariantId = getCurrentVariantId();
    window.widgetFunctions.showState('upload');
  };
  
  window.widgetFunctions.triggerFileInput = function() {
    const fileInput = document.getElementById('imageUpload');
    if (fileInput) fileInput.click();
  };
  
  function setupVariantChangeListeners() {
    const variantSelect = document.querySelector('select[name="id"]');
    if (variantSelect) {
      variantSelect.addEventListener('change', e => { currentVariantId = e.target.value; });
    }
    
    const variantRadios = document.querySelectorAll('input[name="id"][type="radio"]');
    variantRadios.forEach(radio => {
      radio.addEventListener('change', e => { if (e.target.checked) currentVariantId = e.target.value; });
    });
    
    const allIdInputs = document.querySelectorAll('input[name="id"]');
    allIdInputs.forEach(input => {
      input.addEventListener('change', e => { currentVariantId = e.target.value; });
    });
    
    document.addEventListener('variant:change', event => {
      if (event.detail?.variant?.id) currentVariantId = event.detail.variant.id.toString();
    });
    
    const productForm = document.querySelector('form[action*="/cart/add"]');
    if (productForm) {
      const observer = new MutationObserver(() => {
        const newVariantId = getCurrentVariantId();
        if (newVariantId && newVariantId !== currentVariantId) currentVariantId = newVariantId;
      });
      observer.observe(productForm, { attributes: true, childList: true, subtree: true });
    }
  }
  
  window.widgetFunctions.resetTransformation = function() {
    const imageUpload = document.getElementById('imageUpload');
    const beforeImage = document.getElementById('beforeImage');
    const afterImage = document.getElementById('afterImage');
    
    if (imageUpload) imageUpload.value = '';
    if (beforeImage) { beforeImage.onload = null; beforeImage.onerror = null; beforeImage.src = ''; }
    if (afterImage) { afterImage.onload = null; afterImage.onerror = null; afterImage.src = ''; }
    
    window.widgetFunctions.showState('upload');
  };
  
  window.widgetFunctions.showState = function(state) {
    ['upload', 'processing', 'results', 'error'].forEach(s => {
      const el = document.getElementById(`${s}State`);
      if (el) el.style.display = s === state ? 'block' : 'none';
    });
    
    if (state === 'processing') startLoadingTextAnimation();
    else stopLoadingTextAnimation();
  };
  
  function startLoadingTextAnimation() {
    const loadingTextEl = document.querySelector('.loading-text-content');
    if (!loadingTextEl) return;
    
    let currentIndex = 0;
    loadingTextEl.textContent = loadingMessages[currentIndex];
    
    loadingTextInterval = setInterval(() => {
      currentIndex++;
      if (currentIndex < loadingMessages.length) {
        loadingTextEl.textContent = loadingMessages[currentIndex];
      } else {
        clearInterval(loadingTextInterval);
        loadingTextInterval = null;
      }
    }, 3000);
  }
  
  function stopLoadingTextAnimation() {
    if (loadingTextInterval) {
      clearInterval(loadingTextInterval);
      loadingTextInterval = null;
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
  
  window.widgetFunctions.showError = function(message) {
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) errorMessage.textContent = message;
    window.widgetFunctions.showState('error');
  };
  
  function processSelectedFile(file) {
    if (!file) return;
    
    window.widgetFunctions.showState('upload');
    
    if (!isValidImageFile(file)) {
      window.widgetFunctions.showError('Please upload an image file (JPG, PNG, HEIC, etc.).');
      return;
    }
    
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      window.widgetFunctions.showError('Image too large. Please upload an image smaller than 5MB.');
      return;
    }
    
    if (file.size === 0) {
      window.widgetFunctions.showError('The selected file appears to be empty. Please try another image.');
      return;
    }
    
    const reader = new FileReader();
    
    reader.onload = async function(e) {
      try {
        let imageDataUrl = e.target.result;
        let fileToSend = file;
        currentImageWasFlipped = false;
        
        const isHeic = isHeicOrHeif(file);
        const isMobile = isMobileDevice();
        const isRecent = isRecentlyTakenPhoto(file);
        
        // Flip mobile selfies (front camera) that were just taken
        if (isMobile && isRecent && !isHeic) {
          imageDataUrl = await flipImageHorizontally(imageDataUrl);
          fileToSend = dataUrlToFile(imageDataUrl, file.name || 'selfie.jpg');
          currentImageWasFlipped = true;
        }
        
        const beforeImg = document.getElementById('beforeImage');
        if (beforeImg) {
          beforeImg.onload = null;
          beforeImg.onerror = null;
          
          let transformationStarted = false;
          
          // For HEIC files, browser can't display - just start transform immediately
          if (isHeic) {
            transformImage(file);
          } else {
            beforeImg.onload = function() {
              beforeImg.onload = null;
              beforeImg.onerror = null;
              if (!transformationStarted) {
                transformationStarted = true;
                transformImage(fileToSend);
              }
            };
            
            beforeImg.onerror = function() {
              beforeImg.onload = null;
              beforeImg.onerror = null;
              window.widgetFunctions.showError('Error displaying image preview. Please try again.');
            };
            
            beforeImg.src = imageDataUrl;
          }
        } else {
          transformImage(isHeic ? file : fileToSend);
        }
      } catch (error) {
        window.widgetFunctions.showError('Error loading image preview. Please try again.');
      }
    };
    
    reader.onerror = () => window.widgetFunctions.showError('Error reading the image file. Please try again.');
    reader.onabort = () => window.widgetFunctions.showError('File reading was interrupted. Please try again.');
    
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      window.widgetFunctions.showError('Error reading the image file. Please try again.');
    }
  }
  
  async function transformImage(file) {
    window.widgetFunctions.showState('processing');
    
    try {
      const freshVariantId = getCurrentVariantId();
      if (freshVariantId && freshVariantId !== currentVariantId) currentVariantId = freshVariantId;
      
      if (!currentShopDomain) throw new Error('Could not determine shop domain. Please refresh the page and try again.');
      if (!SHOPIFY_APP_URL) throw new Error('App URL not configured.');
      
      const formData = new FormData();
      formData.append('image', file);
      formData.append('productId', currentProductId);
      formData.append('shopDomain', currentShopDomain);
      if (currentVariantId) formData.append('variantId', currentVariantId);
      
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
      
      if (!response.ok) throw new Error(result.error || `Server error: ${response.status}`);
      if (!result.success) throw new Error(result.error || 'Transformation failed');
      if (!result.generatedImage) throw new Error('No transformed image received');
      
      const afterImg = document.getElementById('afterImage');
      const beforeImg = document.getElementById('beforeImage');
      
      // Always set before image from server's processed input (handles HEIC conversion)
      console.log('processedInputImage received:', !!result.processedInputImage);
      if (beforeImg && result.processedInputImage) {
        console.log('Setting before image from server');
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
      
      window.widgetFunctions.showState('results');
      
    } catch (error) {
      window.widgetFunctions.showError(error.message || 'Something went wrong. Please try again.');
    }
  }
  
  document.addEventListener('DOMContentLoaded', function() {
    // Use integrated-specific init if this is the integrated widget
    const integratedWidget = document.querySelector('.glimpse-integrated-widget');
    if (integratedWidget) {
      window.widgetFunctions.initIntegratedWidget();
    } else {
      window.widgetFunctions.initWidget();
    }
    setupVariantChangeListeners();
    
    const imageUpload = document.getElementById('imageUpload');
    const placeholderContainer = document.querySelector('.integrated-placeholder');
    
    if (!imageUpload) return;
    
    imageUpload.addEventListener('change', function(event) {
      const files = event.target.files;
      if (files?.length > 0) processSelectedFile(files[0]);
    });
    
    // Drag and drop support
    if (placeholderContainer) {
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
        if (files.length > 0) processSelectedFile(files[0]);
      }, false);
    }
  });
})();
