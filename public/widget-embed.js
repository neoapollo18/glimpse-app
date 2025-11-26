/**
 * Glimpse AI Widget - Standalone Embed Script
 * Hosted at: https://glimpse-app-charles.onrender.com/widget-embed.js
 * 
 * Usage in EComposer or any page builder:
 * 
 * <div class="glimpse-ai-widget" 
 *      data-product-id="{{ product.id }}"
 *      data-shop-domain="{{ shop.permanent_domain }}"></div>
 * <script src="https://glimpse-app-charles.onrender.com/widget-embed.js"></script>
 */

(function() {
  'use strict';

  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';

  function initGlimpseWidgets() {
    console.log('🎨 Glimpse AI Widget - Initializing');
    
    const widgets = document.querySelectorAll('.glimpse-ai-widget:not([data-embed-initialized])');
    
    if (widgets.length === 0) {
      console.log('No Glimpse widgets found on page');
      return;
    }
    
    widgets.forEach(function(container) {
      let productId = container.getAttribute('data-product-id');
      let shopDomain = container.getAttribute('data-shop-domain');
      
      // Auto-detect if attributes are missing or contain Liquid templates
      if (!productId || productId.includes('{{') || productId.includes('}}')) {
        productId = autoDetectProductId();
        console.log('Auto-detected product ID:', productId);
      }
      
      if (!shopDomain || shopDomain.includes('{{') || shopDomain.includes('}}')) {
        shopDomain = autoDetectShopDomain();
        console.log('Auto-detected shop domain:', shopDomain);
      }
      
      if (!productId || !shopDomain) {
        console.error('Glimpse Widget: Could not detect product ID or shop domain');
        container.innerHTML = '<p style="color:red;">Glimpse Widget: Must be on a product page</p>';
        return;
      }
      
      console.log('✓ Initializing widget for product:', productId, 'on shop:', shopDomain);
      container.setAttribute('data-embed-initialized', 'true');
      
      // Get current variant ID
      let currentVariantId = getCurrentVariantId();
      
      // Render widget UI
      renderWidget(container, productId, shopDomain, currentVariantId);
      
      // Listen for variant changes
      setupVariantListeners(container, productId, shopDomain);
    });
  }
  
  function autoDetectProductId() {
    // Method 1: Check meta tags
    const metaProduct = document.querySelector('meta[property="product:id"], meta[name="product-id"]');
    if (metaProduct) {
      return metaProduct.getAttribute('content');
    }
    
    // Method 2: Check Shopify global
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
      return window.ShopifyAnalytics.meta.product.id.toString();
    }
    
    // Method 3: Check window.meta.product
    if (window.meta && window.meta.product && window.meta.product.id) {
      return window.meta.product.id.toString();
    }
    
    // Method 4: Check product JSON-LD
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        if (data['@type'] === 'Product' && data.productID) {
          return data.productID;
        }
      } catch (e) {}
    }
    
    // Method 5: Extract from URL
    const urlMatch = window.location.pathname.match(/\/products\/([^\/\?]+)/);
    if (urlMatch) {
      // We have the handle, try to get ID from product form
      const form = document.querySelector('form[action*="/cart/add"]');
      if (form) {
        const idInput = form.querySelector('input[name="id"], select[name="id"]');
        if (idInput && idInput.value) {
          return idInput.value;
        }
      }
    }
    
    return null;
  }
  
  function autoDetectShopDomain() {
    // Method 1: Check Shopify global
    if (window.Shopify && window.Shopify.shop) {
      return window.Shopify.shop;
    }
    
    // Method 2: Check meta tags
    const metaShop = document.querySelector('meta[name="shopify-shop-domain"], meta[property="og:site_name"]');
    if (metaShop) {
      let domain = metaShop.getAttribute('content');
      if (domain && !domain.includes('.myshopify.com')) {
        domain = domain + '.myshopify.com';
      }
      return domain;
    }
    
    // Method 3: Extract from scripts
    const scripts = document.querySelectorAll('script[src*="myshopify.com"]');
    for (let script of scripts) {
      const match = script.src.match(/\/\/([^\/]+\.myshopify\.com)/);
      if (match) return match[1];
    }
    
    // Method 4: Check hostname if it's a myshopify domain
    if (window.location.hostname.includes('.myshopify.com')) {
      return window.location.hostname;
    }
    
    return null;
  }
  
  function getCurrentVariantId() {
    // Method 1: Check select with name="id"
    const select = document.querySelector('select[name="id"]');
    if (select && select.value) return select.value;
    
    // Method 2: Check radio buttons
    const radio = document.querySelector('input[name="id"]:checked');
    if (radio && radio.value) return radio.value;
    
    // Method 3: Check hidden input
    const hidden = document.querySelector('input[name="id"][type="hidden"]');
    if (hidden && hidden.value) return hidden.value;
    
    // Method 4: Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const variant = urlParams.get('variant');
    if (variant) return variant;
    
    return null;
  }
  
  function setupVariantListeners(container, productId, shopDomain) {
    // Listen for select changes
    const selects = document.querySelectorAll('select[name="id"], select[name^="option"]');
    selects.forEach(function(select) {
      select.addEventListener('change', function() {
        const newVariantId = getCurrentVariantId();
        console.log('Variant changed to:', newVariantId);
        container.setAttribute('data-current-variant', newVariantId || '');
      });
    });
    
    // Listen for radio button changes
    const radios = document.querySelectorAll('input[type="radio"][name="id"], input[type="radio"][name^="option"]');
    radios.forEach(function(radio) {
      radio.addEventListener('change', function() {
        const newVariantId = getCurrentVariantId();
        console.log('Variant changed to:', newVariantId);
        container.setAttribute('data-current-variant', newVariantId || '');
      });
    });
  }
  
  function renderWidget(container, productId, shopDomain, variantId) {
    const widgetId = 'glimpse-' + productId + '-' + Date.now();
    
    container.innerHTML = `
      <style>
        .glimpse-embed-widget {
          max-width: 100%;
          margin: 30px 0;
          padding: 40px 20px;
          border: 1px solid #e5e5e5;
          border-radius: 16px;
          background: linear-gradient(135deg, #f8f9ff 0%, #fff5f7 100%);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 2px 12px rgba(0,0,0,0.08);
        }
        .glimpse-embed-header {
          text-align: center;
          margin-bottom: 25px;
        }
        .glimpse-embed-header h3 {
          margin: 0 0 12px 0;
          font-size: 28px;
          font-weight: 700;
          color: #2d2d2d;
          letter-spacing: -0.5px;
        }
        .glimpse-embed-header p {
          margin: 0;
          color: #666;
          font-size: 16px;
          line-height: 1.5;
        }
        .glimpse-upload-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 18px 40px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 18px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
          margin: 0 auto;
          display: block;
        }
        .glimpse-upload-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
        .glimpse-upload-btn:active {
          transform: translateY(0);
        }
        .glimpse-loading {
          text-align: center;
          padding: 40px;
        }
        .glimpse-loading-spinner {
          border: 4px solid #f3f3f3;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .glimpse-results {
          display: flex;
          gap: 20px;
          justify-content: center;
          margin: 20px 0;
        }
        .glimpse-result-item {
          text-align: center;
        }
        .glimpse-result-item img {
          max-width: 250px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .glimpse-result-item p {
          margin: 10px 0 0 0;
          font-weight: 600;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .glimpse-retry-btn {
          display: block;
          width: 100%;
          padding: 12px;
          background: white;
          border: 2px solid #667eea;
          color: #667eea;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 15px;
        }
        .glimpse-error {
          background: #fee;
          border: 1px solid #fcc;
          padding: 15px;
          border-radius: 8px;
          color: #c00;
          text-align: center;
        }
      </style>
      
      <div class="glimpse-embed-widget">
        <div id="${widgetId}-upload" class="glimpse-upload-state">
          <div class="glimpse-embed-header">
            <h3>✨ See Your Transformation!</h3>
            <p>Upload your photo to see how this product looks on you</p>
          </div>
          <button type="button" class="glimpse-upload-btn" onclick="document.getElementById('${widgetId}-file').click(); return false;">
            📸 Upload Your Photo
          </button>
          <input type="file" id="${widgetId}-file" accept="image/*" style="display:none;">
        </div>
        
        <div id="${widgetId}-loading" class="glimpse-loading" style="display:none;">
          <div class="glimpse-loading-spinner"></div>
          <p>✨ Creating your transformation...</p>
          <p style="font-size: 12px; color: #999;">This may take a few seconds</p>
        </div>
        
        <div id="${widgetId}-results" style="display:none;">
          <div class="glimpse-results" id="${widgetId}-images"></div>
          <button type="button" class="glimpse-retry-btn" onclick="glimpseWidget.retry('${widgetId}'); return false;">
            🔄 Try Another Photo
          </button>
        </div>
        
        <div id="${widgetId}-error" class="glimpse-error" style="display:none;"></div>
      </div>
    `;
    
    // Set up file input handler
    document.getElementById(widgetId + '-file').addEventListener('change', function(e) {
      handleUpload(e, widgetId, productId, shopDomain, container);
    });
    
    // Store widget ID on container
    container.setAttribute('data-widget-id', widgetId);
  }
  
  function handleUpload(event, widgetId, productId, shopDomain, container) {
    const file = event.target.files[0];
    if (!file) return;
    
    console.log('📤 Uploading file:', file.name);
    
    // Show loading
    document.getElementById(widgetId + '-upload').style.display = 'none';
    document.getElementById(widgetId + '-loading').style.display = 'block';
    document.getElementById(widgetId + '-error').style.display = 'none';
    
    // Get current variant
    const variantId = container.getAttribute('data-current-variant') || getCurrentVariantId();
    
    // Prepare form data
    const formData = new FormData();
    formData.append('image', file);
    formData.append('productId', productId);
    formData.append('shopDomain', shopDomain);
    if (variantId) {
      formData.append('variantId', variantId);
      console.log('📦 Using variant:', variantId);
    }
    
    // Send to API
    fetch(SHOPIFY_APP_URL + '/api/storefront/transform-image', {
      method: 'POST',
      body: formData
    })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('API request failed');
      }
      return response.json();
    })
    .then(function(data) {
      if (data.success && data.generatedImage) {
        showResults(widgetId, file, data.generatedImage);
      } else {
        showError(widgetId, data.error || 'Transformation failed. Please try again.');
      }
    })
    .catch(function(error) {
      console.error('❌ Transform error:', error);
      showError(widgetId, 'Network error. Please check your connection and try again.');
    });
  }
  
  function showResults(widgetId, originalFile, transformedBase64) {
    const originalUrl = URL.createObjectURL(originalFile);
    
    document.getElementById(widgetId + '-loading').style.display = 'none';
    document.getElementById(widgetId + '-results').style.display = 'block';
    
    document.getElementById(widgetId + '-images').innerHTML = `
      <div class="glimpse-result-item">
        <img src="${originalUrl}" alt="Before">
        <p>Before</p>
      </div>
      <div class="glimpse-result-item">
        <img src="data:image/jpeg;base64,${transformedBase64}" alt="After">
        <p>After ✨</p>
      </div>
    `;
    
    console.log('✅ Transformation complete!');
  }
  
  function showError(widgetId, message) {
    document.getElementById(widgetId + '-loading').style.display = 'none';
    document.getElementById(widgetId + '-upload').style.display = 'block';
    
    const errorDiv = document.getElementById(widgetId + '-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    setTimeout(function() {
      errorDiv.style.display = 'none';
    }, 5000);
  }
  
  // Global API
  window.glimpseWidget = {
    init: initGlimpseWidgets,
    retry: function(widgetId) {
      document.getElementById(widgetId + '-results').style.display = 'none';
      document.getElementById(widgetId + '-upload').style.display = 'block';
      document.getElementById(widgetId + '-file').value = '';
    }
  };
  
  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlimpseWidgets);
  } else {
    initGlimpseWidgets();
  }
  
  // Watch for dynamic additions
  if (window.MutationObserver) {
    const observer = new MutationObserver(initGlimpseWidgets);
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();

