/**
 * Glimpse AI Widget - Standalone Embed Script
 * This allows the widget to work in third-party page builders like EComposer
 */

(function() {
  'use strict';

  // Configuration
  const SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';

  // Initialize widget when DOM is ready
  function initGlimpseWidget() {
    console.log('=== Glimpse Widget Standalone Init ===');
    
    const widgets = document.querySelectorAll('.glimpse-widget:not([data-initialized])');
    
    widgets.forEach(function(widget) {
      const productId = widget.getAttribute('data-product-id');
      const shopDomain = widget.getAttribute('data-shop');
      
      if (!productId || !shopDomain) {
        console.error('Glimpse Widget: Missing product-id or shop domain');
        return;
      }
      
      console.log('Initializing widget for product:', productId);
      
      // Mark as initialized
      widget.setAttribute('data-initialized', 'true');
      
      // Inject widget HTML
      widget.innerHTML = `
        <div class="glimpse-ai-widget-embed">
          <div class="widget-upload-state">
            <h3>See Your Transformation!</h3>
            <p>Upload your photo to see how this product looks on you</p>
            <button class="upload-btn" onclick="glimpseWidget.triggerUpload('${productId}')">
              Upload Photo
            </button>
            <input type="file" id="glimpse-upload-${productId}" accept="image/*" style="display:none;">
          </div>
          <div class="widget-loading-state" style="display:none;">
            <p>Transforming your image...</p>
          </div>
          <div class="widget-result-state" style="display:none;">
            <div class="result-images"></div>
            <button onclick="glimpseWidget.retry('${productId}')">Try Again</button>
          </div>
        </div>
      `;
      
      // Add basic styles if not already added
      if (!document.getElementById('glimpse-widget-styles')) {
        const style = document.createElement('style');
        style.id = 'glimpse-widget-styles';
        style.textContent = `
          .glimpse-ai-widget-embed {
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 8px;
            text-align: center;
            max-width: 500px;
            margin: 0 auto;
          }
          .glimpse-ai-widget-embed h3 {
            margin: 0 0 10px 0;
            font-size: 24px;
          }
          .glimpse-ai-widget-embed .upload-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            font-size: 16px;
            border-radius: 6px;
            cursor: pointer;
            margin-top: 15px;
          }
          .glimpse-ai-widget-embed .upload-btn:hover {
            opacity: 0.9;
          }
        `;
        document.head.appendChild(style);
      }
      
      // Set up file upload handler
      const fileInput = document.getElementById(`glimpse-upload-${productId}`);
      if (fileInput) {
        fileInput.addEventListener('change', function(e) {
          handleFileUpload(e, productId, shopDomain, widget);
        });
      }
    });
  }
  
  // Handle file upload
  function handleFileUpload(event, productId, shopDomain, widgetElement) {
    const file = event.target.files[0];
    if (!file) return;
    
    console.log('File selected:', file.name);
    
    // Show loading state
    widgetElement.querySelector('.widget-upload-state').style.display = 'none';
    widgetElement.querySelector('.widget-loading-state').style.display = 'block';
    
    // Create form data
    const formData = new FormData();
    formData.append('image', file);
    formData.append('productId', productId);
    formData.append('shopDomain', shopDomain);
    
    // Send to API
    fetch(`${SHOPIFY_APP_URL}/api/storefront/transform-image`, {
      method: 'POST',
      body: formData
    })
    .then(response => response.json())
    .then(data => {
      if (data.success && data.generatedImage) {
        showResult(widgetElement, file, data.generatedImage);
      } else {
        showError(widgetElement, data.error || 'Transformation failed');
      }
    })
    .catch(error => {
      console.error('Transform error:', error);
      showError(widgetElement, 'Network error. Please try again.');
    });
  }
  
  // Show result
  function showResult(widgetElement, originalFile, transformedBase64) {
    const resultContainer = widgetElement.querySelector('.result-images');
    const originalUrl = URL.createObjectURL(originalFile);
    
    resultContainer.innerHTML = `
      <div style="display: flex; gap: 20px; justify-content: center;">
        <div>
          <p><strong>Before</strong></p>
          <img src="${originalUrl}" style="max-width: 200px; border-radius: 8px;">
        </div>
        <div>
          <p><strong>After</strong></p>
          <img src="data:image/jpeg;base64,${transformedBase64}" style="max-width: 200px; border-radius: 8px;">
        </div>
      </div>
    `;
    
    widgetElement.querySelector('.widget-loading-state').style.display = 'none';
    widgetElement.querySelector('.widget-result-state').style.display = 'block';
  }
  
  // Show error
  function showError(widgetElement, message) {
    widgetElement.querySelector('.widget-loading-state').style.display = 'none';
    widgetElement.querySelector('.widget-upload-state').style.display = 'block';
    alert(message);
  }
  
  // Expose global widget API
  window.glimpseWidget = {
    init: initGlimpseWidget,
    triggerUpload: function(productId) {
      const input = document.getElementById(`glimpse-upload-${productId}`);
      if (input) input.click();
    },
    retry: function(productId) {
      const widget = document.querySelector(`.glimpse-widget[data-product-id="${productId}"]`);
      if (widget) {
        widget.querySelector('.widget-result-state').style.display = 'none';
        widget.querySelector('.widget-upload-state').style.display = 'block';
      }
    }
  };
  
  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlimpseWidget);
  } else {
    initGlimpseWidget();
  }
  
  // Re-initialize if new widgets are added dynamically
  if (window.MutationObserver) {
    const observer = new MutationObserver(function() {
      initGlimpseWidget();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();

