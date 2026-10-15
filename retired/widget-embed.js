/**
 * Gleame AI Widget - Standalone Embed Script
 * Matches the Theme App Extension UI exactly
 * Hosted at: https://glimpse-app-charles.onrender.com/widget-embed.js
 *
 * Usage in EComposer or any page builder:
 * <div class="glimpse-ai-widget"></div>
 * <script src="https://glimpse-app-charles.onrender.com/widget-embed.js"></script>
 */

(function() {
  'use strict';

  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  const WIDGET_TYPE = 'embed';
  let viewTracked = false;

  // Track widget events (views, etc.)
  function trackEvent(shopDomain, productId, eventType) {
    fetch(`${SHOPIFY_APP_URL}/api/storefront/track-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shopDomain,
        productId: productId,
        eventType: eventType,
        widgetType: WIDGET_TYPE
      })
    }).catch(() => {});
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlimpseWidgets);
  } else {
    initGlimpseWidgets();
  }

  function initGlimpseWidgets() {
    console.log('🎨 Gleame AI Widget - Initializing');
    
    const widgets = document.querySelectorAll('.glimpse-ai-widget:not([data-embed-initialized])');
    
    if (widgets.length === 0) {
      console.log('No Gleame widgets found on page');
      return;
    }
    
    widgets.forEach(function(container) {
      // Mark as initialized
      container.setAttribute('data-embed-initialized', 'true');
      
      // Get product ID and shop domain
      const productId = autoDetectProductId();
      const shopDomain = autoDetectShopDomain();
      
      if (!productId || !shopDomain) {
        console.error('Gleame Widget: Could not detect product ID or shop domain');
        container.innerHTML = '<p style="color:red;padding:20px;text-align:center;">Gleame Widget: Must be on a product page</p>';
        return;
      }
      
      console.log('✓ Initializing widget for product:', productId, 'on shop:', shopDomain);
      
      // Inject CSS
      injectCSS();
      
      // Render widget UI
      renderWidget(container, productId, shopDomain);
      
      // Track widget view once
      if (!viewTracked) {
        viewTracked = true;
        trackEvent(shopDomain, productId, 'widget_view');
      }
    });
  }

  function injectCSS() {
    // Check if CSS already injected
    if (document.getElementById('glimpse-widget-embed-css')) return;
    
    const style = document.createElement('style');
    style.id = 'glimpse-widget-embed-css';
    style.textContent = `
      /* Gleame AI Widget Embed Styles */
      .glimpse-ai-widget {
        --primary-color-1: #8b5cf6;
        --primary-color-2: #7c3aed;
        --caption-color-1: #6b7280;
        --caption-color-2: #9ca3af;
        --icon-color: #8b5cf6;
        --background-color: #ffffff;
        --text-color: #1f2937;
        --button-text-color: #ffffff;
        background: var(--background-color);
        border-radius: 16px;
        padding: 24px;
        margin: 20px auto;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        border: 1px solid #e5e7eb;
        max-width: 640px;
        width: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .glimpse-widget-header {
        text-align: center;
        margin-bottom: 20px;
      }
      
      .glimpse-widget-title {
        color: var(--text-color);
        font-size: 24px;
        font-weight: 600;
        margin: 0 0 8px 0;
        line-height: 1.2;
      }
      
      .glimpse-star-icon {
        margin: 8px 0;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      
      .glimpse-star-icon svg {
        color: var(--icon-color);
      }
      
      .glimpse-widget-description {
        background: linear-gradient(135deg, var(--caption-color-1), var(--caption-color-2));
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-size: 16px;
        line-height: 1.4;
        margin: 0;
      }
      
      .glimpse-placeholder-container {
        margin-bottom: 20px;
        cursor: pointer;
        transition: all 0.3s ease;
        border-radius: 12px;
        overflow: hidden;
      }
      
      .glimpse-placeholder-container:hover {
        transform: scale(1.02);
      }
      
      .glimpse-default-placeholder {
        width: 100%;
        height: 200px;
        border-radius: 12px;
        overflow: hidden;
        background: linear-gradient(45deg, #f3f4f6 0%, #e5e7eb 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      
      .glimpse-placeholder-split {
        width: 100%;
        height: 100%;
        display: flex;
        position: relative;
      }
      
      .glimpse-placeholder-half {
        width: 50%;
        height: 100%;
      }
      
      .glimpse-placeholder-before {
        background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .glimpse-placeholder-after {
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .glimpse-placeholder-silhouette {
        width: 60px;
        height: 75px;
        background: linear-gradient(180deg, rgba(209, 213, 219, 0.5) 0%, rgba(156, 163, 175, 0.5) 100%);
        border-radius: 30px 30px 20px 20px;
        position: relative;
        opacity: 0.6;
      }
      
      .glimpse-placeholder-silhouette::before {
        content: '';
        position: absolute;
        top: -22px;
        left: 50%;
        transform: translateX(-50%);
        width: 40px;
        height: 40px;
        background: linear-gradient(180deg, rgba(209, 213, 219, 0.5) 0%, rgba(156, 163, 175, 0.5) 100%);
        border-radius: 50%;
      }
      
      .glimpse-placeholder-silhouette-glow {
        background: linear-gradient(180deg, rgba(167, 139, 250, 0.5) 0%, rgba(139, 92, 246, 0.5) 100%);
      }
      
      .glimpse-placeholder-silhouette-glow::before {
        background: linear-gradient(180deg, rgba(167, 139, 250, 0.5) 0%, rgba(139, 92, 246, 0.5) 100%);
      }
      
      .glimpse-placeholder-split::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 2px;
        height: 60%;
        background: white;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
      }
      
      .glimpse-placeholder-split::before {
        content: "Before → After";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.95);
        color: #374151;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 8px;
        border-radius: 4px;
        z-index: 1;
      }
      
      .glimpse-upload-button {
        background: linear-gradient(135deg, var(--primary-color-1), var(--primary-color-2));
        color: var(--button-text-color);
        border: none;
        padding: 16px 32px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 4px 16px rgba(139, 92, 246, 0.3);
        width: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      
      .glimpse-upload-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4);
      }
      
      .glimpse-processing-state {
        text-align: center;
        padding: 40px 20px;
        display: none;
      }
      
      .glimpse-loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid #f3f4f6;
        border-top: 3px solid var(--primary-color-1);
        border-radius: 50%;
        animation: glimpse-spin 1s linear infinite;
        margin: 0 auto 16px;
      }
      
      @keyframes glimpse-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      .glimpse-loading-text {
        margin: 0;
        font-size: 16px;
        color: #6b7280;
      }
      
      .glimpse-results-state {
        display: none;
      }
      
      .glimpse-image-comparison {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0;
        margin-bottom: 20px;
      }
      
      .glimpse-comparison-item {
        text-align: center;
      }
      
      .glimpse-image-label {
        background: linear-gradient(135deg, var(--primary-color-1), var(--primary-color-2));
        color: var(--button-text-color);
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 20px;
        display: inline-block;
        margin-bottom: 8px;
        letter-spacing: 0.5px;
        box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
      }
      
        .glimpse-comparison-image {
        width: 100%;
        height: 260px;
        object-fit: cover;
        border: 2px solid #e5e7eb;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      
      .glimpse-retry-button {
        background: #f9fafb;
        color: #374151;
        border: 1px solid #d1d5db;
        padding: 16px 32px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        justify-content: center;
      }
      
      .glimpse-retry-button:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
        transform: translateY(-1px);
      }
      
      .glimpse-widget-footer {
        text-align: center;
        margin-top: 16px;
        padding-top: 8px;
      }
      
      .glimpse-info-icon {
        width: 20px;
        height: 20px;
        color: #9ca3af;
        margin: 0 auto 8px;
        display: block;
      }
      
      .glimpse-disclaimer {
        margin: 0;
        font-size: 12px;
        color: #9ca3af;
        line-height: 1.4;
      }
      
      .glimpse-error-state {
        display: none;
        text-align: center;
        padding: 20px;
        background: #fef2f2;
        border-radius: 8px;
        border: 1px solid #fecaca;
        margin-top: 16px;
      }
      
      .glimpse-error-message {
        margin: 0;
        font-size: 14px;
        color: #dc2626;
        line-height: 1.4;
      }
      
      @media (max-width: 640px) {
        .glimpse-ai-widget {
          padding: 20px;
        }
        .glimpse-default-placeholder {
          height: 160px;
        }
        .glimpse-comparison-image {
          height: 180px;
        }
        .glimpse-placeholder-silhouette {
          width: 45px;
          height: 55px;
        }
        .glimpse-placeholder-silhouette::before {
          width: 30px;
          height: 30px;
          top: -16px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function renderWidget(container, productId, shopDomain) {
    const widgetId = 'glimpse-' + Date.now();
    
    container.innerHTML = `
      <div class="glimpse-widget-header">
        <h3 class="glimpse-widget-title">See Your Transformation!</h3>
        <div class="glimpse-star-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>
          </svg>
        </div>
        <p class="glimpse-widget-description">Upload an image of yourself and see your transformation</p>
      </div>
      
      <div id="${widgetId}-upload" class="glimpse-upload-state">
        <div class="glimpse-placeholder-container" onclick="document.getElementById('${widgetId}-file').click()">
          <div class="glimpse-default-placeholder">
            <div class="glimpse-placeholder-split">
              <div class="glimpse-placeholder-half glimpse-placeholder-before">
                <div class="glimpse-placeholder-silhouette"></div>
              </div>
              <div class="glimpse-placeholder-half glimpse-placeholder-after">
                <div class="glimpse-placeholder-silhouette glimpse-placeholder-silhouette-glow"></div>
              </div>
            </div>
          </div>
        </div>
        <input type="file" id="${widgetId}-file" accept="image/*" style="display:none;">
        <button type="button" class="glimpse-upload-button" onclick="document.getElementById('${widgetId}-file').click(); return false;">
          Take A Photo
        </button>
      </div>
      
      <div id="${widgetId}-processing" class="glimpse-processing-state">
        <div class="glimpse-loading-spinner"></div>
        <p class="glimpse-loading-text">Analyzing image...</p>
      </div>
      
      <div id="${widgetId}-results" class="glimpse-results-state">
        <div class="glimpse-image-comparison">
          <div class="glimpse-comparison-item">
            <div class="glimpse-image-label">Me</div>
            <img id="${widgetId}-before" class="glimpse-comparison-image" alt="Before">
          </div>
          <div class="glimpse-comparison-item">
            <div class="glimpse-image-label">Future Me</div>
            <img id="${widgetId}-after" class="glimpse-comparison-image" alt="After">
          </div>
        </div>
        <button type="button" class="glimpse-retry-button" onclick="glimpseRetry('${widgetId}'); return false;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>
          </svg>
          Try Again
        </button>
      </div>
      
      <div id="${widgetId}-error" class="glimpse-error-state">
        <p class="glimpse-error-message"></p>
      </div>
      
      <div class="glimpse-widget-footer">
        <svg class="glimpse-info-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
        </svg>
        <p class="glimpse-disclaimer">Results are not guaranteed, just a generated image. Images are never saved.</p>
      </div>
    `;
    
    // Setup file input handler
    document.getElementById(widgetId + '-file').addEventListener('change', function(e) {
      if (e.target.files && e.target.files[0]) {
        handleUpload(e.target.files[0], widgetId, productId, shopDomain);
      }
    });
    
    // Make retry function globally accessible with unique name
    window['glimpseRetry'] = function(wid) {
      showState(wid, 'upload');
      document.getElementById(wid + '-error').style.display = 'none';
    };
  }

  function showState(widgetId, state) {
    document.getElementById(widgetId + '-upload').style.display = (state === 'upload') ? 'block' : 'none';
    document.getElementById(widgetId + '-processing').style.display = (state === 'processing') ? 'block' : 'none';
    document.getElementById(widgetId + '-results').style.display = (state === 'results') ? 'block' : 'none';
    document.getElementById(widgetId + '-error').style.display = 'none';
  }

  function showError(widgetId, message) {
    const errorEl = document.getElementById(widgetId + '-error');
    errorEl.querySelector('.glimpse-error-message').textContent = message;
    errorEl.style.display = 'block';
    showState(widgetId, 'upload');
  }

  async function handleUpload(file, widgetId, productId, shopDomain) {
    console.log('Gleame Widget: File selected:', file.name);
    
    // Validate file
    if (!file.type.startsWith('image/')) {
      showError(widgetId, 'Please upload an image file.');
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showError(widgetId, 'Image too large. Please upload an image smaller than 5MB.');
      return;
    }
    
    showState(widgetId, 'processing');
    
    // Read file and show preview
    const reader = new FileReader();
    reader.onload = async function(e) {
      document.getElementById(widgetId + '-before').src = e.target.result;
      
      // Transform image
      try {
        const variantId = getCurrentVariantId();
        const formData = new FormData();
        formData.append('image', file);
        formData.append('productId', productId);
        formData.append('shopDomain', shopDomain);
        if (variantId) {
          formData.append('variantId', variantId);
        }
        
        const response = await fetch(`${SHOPIFY_APP_URL}/api/storefront/transform-image`, {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (data.success && data.generatedImage) {
          document.getElementById(widgetId + '-after').src = 'data:image/jpeg;base64,' + data.generatedImage;
          showState(widgetId, 'results');
        } else {
          showError(widgetId, data.error || 'Transformation failed. Please try again.');
        }
      } catch (error) {
        console.error('Gleame Widget: Transform error:', error);
        showError(widgetId, 'Network error. Please try again.');
      }
    };
    
    reader.onerror = function() {
      showError(widgetId, 'Error reading the image file. Please try again.');
    };
    
    reader.readAsDataURL(file);
  }

  function getCurrentVariantId() {
    // Try multiple methods to detect variant
    const select = document.querySelector('select[name="id"]');
    if (select && select.value) return select.value;
    
    const radio = document.querySelector('input[name="id"]:checked');
    if (radio && radio.value) return radio.value;
    
    const hidden = document.querySelector('input[name="id"][type="hidden"]');
    if (hidden && hidden.value) return hidden.value;
    
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('variant') || null;
  }

  function autoDetectProductId() {
    // Method 1: Shopify Analytics
    if (window.ShopifyAnalytics?.meta?.product?.id) {
      return window.ShopifyAnalytics.meta.product.id.toString();
    }
    
    // Method 2: Check product form
    const form = document.querySelector('form[action*="/cart/add"]');
    if (form) {
      const idInput = form.querySelector('input[name="id"], select[name="id"]');
      if (idInput && idInput.value) {
        // This is the variant ID, try to get product ID from other sources
        const productIdInput = form.querySelector('input[name="product_id"]');
        if (productIdInput && productIdInput.value) {
          return productIdInput.value;
        }
      }
    }
    
    // Method 3: Check meta tags
    const metaProduct = document.querySelector('meta[property="product:id"], meta[name="product-id"]');
    if (metaProduct) {
      return metaProduct.getAttribute('content');
    }
    
    // Method 4: Check URL and try to extract from page
    const urlMatch = window.location.pathname.match(/\/products\/([^/?]+)/);
    if (urlMatch && form) {
      // Get first variant ID from form as fallback
      const variantInput = form.querySelector('input[name="id"], select[name="id"]');
      if (variantInput && variantInput.value) {
        return variantInput.value; // Use variant ID as product ID
      }
    }
    
    return null;
  }

  function autoDetectShopDomain() {
    // CRITICAL: Always try to get the .myshopify.com domain, not custom domains
    // This prevents "product not configured" errors when custom domains are used
    
    // Method 1: Shopify global (most reliable - always returns .myshopify.com)
    if (window.Shopify && window.Shopify.shop) {
      console.log('✅ Found shop domain from Shopify.shop:', window.Shopify.shop);
      return window.Shopify.shop;
    }
    
    // Method 2: Extract from Shopify scripts (second most reliable)
    const scripts = document.querySelectorAll('script[src*="myshopify.com"]');
    for (let script of scripts) {
      const match = script.src.match(/\/\/([^/]+\.myshopify\.com)/);
      if (match) {
        console.log('✅ Found shop domain from script:', match[1]);
        return match[1];
      }
    }
    
    // Method 3: Check if current hostname is .myshopify.com
    const hostname = window.location.hostname;
    if (hostname.includes('.myshopify.com')) {
      console.log('✅ Found shop domain from hostname:', hostname);
      return hostname;
    }
    
    // Method 4: Meta tag
    const shopMeta = document.querySelector('meta[name="shopify-shop-domain"]');
    if (shopMeta && shopMeta.content) {
      console.log('✅ Found shop domain from meta tag:', shopMeta.content);
      return shopMeta.content;
    }
    
    // Method 5: ShopifyAnalytics (another Shopify global)
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerId) {
      // Try to extract shop from ShopifyAnalytics
      const analyticsShop = window.ShopifyAnalytics.lib && window.ShopifyAnalytics.lib.config && window.ShopifyAnalytics.lib.config.Trekkie && window.ShopifyAnalytics.lib.config.Trekkie.defaultAttributes && window.ShopifyAnalytics.lib.config.Trekkie.defaultAttributes.shopId;
      if (analyticsShop) {
        console.log('✅ Found shop ID from ShopifyAnalytics:', analyticsShop);
        // Note: This might be a shop ID, not domain, but worth trying
      }
    }
    
    // FALLBACK WARNING: If we get here, we're using custom domain which may cause issues
    console.warn('⚠️  Could not find .myshopify.com domain. Using hostname as fallback:', hostname);
    console.warn('⚠️  This may cause "product not configured" errors if the shop uses a custom domain.');
    console.warn('⚠️  Please ensure products are configured with the correct shop domain.');
    return hostname;
  }

})();
