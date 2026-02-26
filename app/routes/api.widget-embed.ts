/**
 * Standalone Widget Embed for Legacy Themes (v1.6 etc.)
 * 
 * Serves a self-contained JS file that renders the Gleame widget
 * without any Shopify app block dependencies.
 * 
 * Usage:
 *   <div id="gleame-widget" data-product-id="{{ product.id }}" data-shop-domain="store.myshopify.com"></div>
 *   <script src="https://glimpse-app-charles.onrender.com/api/widget-embed"></script>
 */

import type { LoaderFunctionArgs } from "@remix-run/node";

const WIDGET_JS = `
(function() {
  'use strict';

  // Prevent double-init
  if (window.__gleameEmbedLoaded) return;
  window.__gleameEmbedLoaded = true;

  var SHOPIFY_APP_URL = 'https://glimpse-app-charles.onrender.com';
  var WIDGET_TYPE = 'embed';

  // ========== CSS (inlined) ==========
  var css = \`
.gleame-embed-widget{--solid-button-color:#1f2937;--background-color:transparent;--text-color:#1f2937;--description-color:#6b7280;--button-text-color:#fff;--border-color:#e5e7eb;--widget-margin-top:20px;--widget-margin-bottom:20px;--widget-padding:0;--widget-border-radius:16px;--widget-shadow:none;--widget-border:none;--title-font-size:20px;--description-font-size:16px;--button-border-radius:12px;--button-text-case:none;--image-border:none;--image-border-radius:12px;--header-font-family:inherit;--header-font-weight:700;--body-font-family:inherit;--body-font-weight:400;background:var(--background-color);border-radius:var(--widget-border-radius);padding:var(--widget-padding);margin-top:var(--widget-margin-top);margin-bottom:var(--widget-margin-bottom);box-shadow:var(--widget-shadow);border:var(--widget-border);max-width:480px;width:100%;font-family:var(--body-font-family);font-weight:var(--body-font-weight);box-sizing:border-box}
.gleame-embed-widget *,.gleame-embed-widget *::before,.gleame-embed-widget *::after{box-sizing:border-box}
.gleame-embed-widget .ge-header{margin-bottom:20px}
.gleame-embed-widget .ge-title{color:var(--text-color);font-size:var(--title-font-size);font-family:var(--header-font-family);font-weight:var(--header-font-weight);margin:0 0 8px 0;line-height:1.2;letter-spacing:-0.02em}
.gleame-embed-widget .ge-desc{color:var(--description-color);font-size:var(--description-font-size);font-family:var(--body-font-family);font-weight:var(--body-font-weight);margin:0;line-height:1.5}
.gleame-embed-widget .ge-placeholder{margin-bottom:20px;cursor:pointer;border-radius:8px;overflow:hidden;transition:transform .2s ease,opacity .2s ease}
.gleame-embed-widget .ge-placeholder:hover{transform:scale(1.01);opacity:.95}
.gleame-embed-widget .ge-placeholder.drag-over{opacity:.7;transform:scale(1.02);outline:2px dashed #8b5cf6;outline-offset:4px}
.gleame-embed-widget .ge-default-ph{display:flex;gap:8px;height:200px}
.gleame-embed-widget .ge-ph-side{flex:1;border-radius:var(--image-border-radius);overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative}
.gleame-embed-widget .ge-ph-before{background:linear-gradient(145deg,#f3f4f6,#e5e7eb)}
.gleame-embed-widget .ge-ph-after{background:linear-gradient(145deg,#fef3c7,#fde68a)}
.gleame-embed-widget .ge-sil{width:80px;height:100px;background:linear-gradient(180deg,rgba(107,114,128,.5),rgba(75,85,99,.5));border-radius:40px 40px 20px 20px;position:relative;margin-top:25px}
.gleame-embed-widget .ge-sil::before{content:'';position:absolute;top:-30px;left:50%;transform:translateX(-50%);width:55px;height:55px;background:linear-gradient(180deg,rgba(107,114,128,.5),rgba(75,85,99,.5));border-radius:50%}
.gleame-embed-widget .ge-sil-glow{background:linear-gradient(180deg,rgba(217,119,6,.5),rgba(180,83,9,.5))}
.gleame-embed-widget .ge-sil-glow::before{background:linear-gradient(180deg,rgba(217,119,6,.5),rgba(180,83,9,.5))}
.gleame-embed-widget .ge-btn{width:100%;padding:16px 24px;border-radius:var(--button-border-radius);font-family:var(--body-font-family);font-size:16px;font-weight:500;cursor:pointer;transition:all .2s ease;display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;box-sizing:border-box;background:var(--solid-button-color)!important;color:var(--button-text-color)!important;border:none!important;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.gleame-embed-widget .ge-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.2);filter:brightness(1.1)}
.gleame-embed-widget .ge-btn:focus{outline:2px solid #8b5cf6;outline-offset:2px}
.gleame-embed-widget .ge-btn:focus:not(:focus-visible){outline:none}
.gleame-embed-widget .ge-btn .ge-btn-text{text-transform:var(--button-text-case)}
.gleame-embed-widget .ge-processing{padding:40px 20px}
.gleame-embed-widget .ge-loading{display:flex;flex-direction:column;align-items:center;justify-content:center}
.gleame-embed-widget .ge-loading-text{display:flex;align-items:center;justify-content:center;gap:10px;color:var(--text-color);font-size:15px;margin:0}
.gleame-embed-widget .ge-spinner{width:18px;height:18px;border:2px solid var(--text-color);border-top-color:transparent;border-radius:50%;animation:ge-spin .8s linear infinite;flex-shrink:0}
@keyframes ge-spin{to{transform:rotate(360deg)}}
.gleame-embed-widget .ge-results{margin-bottom:20px}
.gleame-embed-widget .ge-comparison{display:flex;gap:8px}
.gleame-embed-widget .ge-comp-side{flex:1;border-radius:8px;overflow:hidden}
.gleame-embed-widget .ge-comp-img{width:100%;height:220px;object-fit:cover;display:block;border-radius:var(--image-border-radius);border:var(--image-border);box-sizing:border-box;image-orientation:from-image}
.gleame-embed-widget .ge-error{text-align:center;padding:20px;background:#fef2f2;border-radius:12px;margin-bottom:16px}
.gleame-embed-widget .ge-error-icon{color:#dc2626;margin-bottom:12px}
.gleame-embed-widget .ge-error-msg{color:#dc2626;font-size:14px;margin:0 0 16px;line-height:1.4}
.gleame-embed-widget .ge-footer{display:flex;align-items:flex-start;gap:8px;margin-top:10px;padding-top:5px}
.gleame-embed-widget .ge-footer .ge-info-icon{color:#9ca3af;flex-shrink:0;margin-top:2px}
.gleame-embed-widget .ge-disclaimer{color:#9ca3af;font-size:12px;margin:0;line-height:1.4}
.gleame-embed-widget .ge-powered{text-align:right;font-size:10px;color:rgba(107,114,128,.5);margin-top:2px;padding-right:4px}
.gleame-embed-widget .ge-powered strong{font-weight:600;background:linear-gradient(135deg,#8b5cf6,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.gleame-embed-widget .ge-state{transition:opacity .3s ease}
@media(max-width:480px){.gleame-embed-widget{max-width:100%}.gleame-embed-widget .ge-title{font-size:calc(var(--title-font-size)*.9)}.gleame-embed-widget .ge-default-ph{height:160px}.gleame-embed-widget .ge-sil{width:60px;height:80px;margin-top:20px}.gleame-embed-widget .ge-sil::before{width:40px;height:40px;top:-24px}.gleame-embed-widget .ge-btn{padding:14px 20px;font-size:15px}.gleame-embed-widget .ge-comp-img{height:180px}}
\`;

  // ========== Inject CSS ==========
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ========== SVG Icons ==========
  var CAMERA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';
  var RETRY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';
  var ERROR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';
  var INFO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

  var loadingMessages = ['Analyzing image...', 'Creating your transformation...', 'Working our magic...', 'Almost there...'];

  // ========== Find container (with DOM-ready retry) ==========
  function gleameInit() {
    var container = document.getElementById('gleame-widget');
    if (!container) return false;
    gleameBoot(container);
    return true;
  }

  function gleameBoot(container) {

  var productId = container.getAttribute('data-product-id');
  var shopDomain = container.getAttribute('data-shop-domain');
  var title = container.getAttribute('data-title') || 'Try It Virtually';
  var description = container.getAttribute('data-description') || 'Upload a selfie and see your transformation';
  var buttonText = container.getAttribute('data-button-text') || 'Upload a Photo';
  var buttonColor = container.getAttribute('data-button-color') || '#1f2937';
  var textColor = container.getAttribute('data-text-color') || '#1f2937';
  var disclaimer = container.getAttribute('data-disclaimer') || 'Results are never guaranteed, just a generated image. Images are never saved.';

  if (!productId) {
    console.error('Gleame Embed: data-product-id is required');
    return;
  }

  // Auto-detect shop domain if not provided
  if (!shopDomain) {
    var h = window.location.hostname;
    if (h.includes('.myshopify.com')) { shopDomain = h; }
    else if (window.Shopify && window.Shopify.shop) { shopDomain = window.Shopify.shop; }
    else {
      var meta = document.querySelector('meta[name="shopify-shop-domain"]');
      if (meta) shopDomain = meta.content;
    }
    if (!shopDomain) {
      var scripts = document.querySelectorAll('script[src*="myshopify.com"]');
      for (var i = 0; i < scripts.length; i++) {
        var m = scripts[i].src.match(/\\/\\/([^/]+\\.myshopify\\.com)/);
        if (m) { shopDomain = m[1]; break; }
      }
    }
    if (!shopDomain) shopDomain = h;
  }

  var uid = 'ge-' + Math.random().toString(36).substr(2, 9);
  var loadingInterval = null;
  var variantId = null;
  var viewTracked = false;

  // ========== Render HTML ==========
  container.className = 'gleame-embed-widget';
  container.style.cssText += '--solid-button-color:' + buttonColor + ';--text-color:' + textColor + ';';

  container.innerHTML =
    '<div class="ge-header">' +
      '<h2 class="ge-title">' + title + '</h2>' +
      '<p class="ge-desc">' + description + '</p>' +
    '</div>' +
    '<div class="ge-state" id="uploadState-' + uid + '">' +
      '<div class="ge-placeholder" id="placeholder-' + uid + '">' +
        '<div class="ge-default-ph">' +
          '<div class="ge-ph-side ge-ph-before"><div class="ge-sil"></div></div>' +
          '<div class="ge-ph-side ge-ph-after"><div class="ge-sil ge-sil-glow"></div></div>' +
        '</div>' +
      '</div>' +
      '<input type="file" id="fileInput-' + uid + '" accept="image/*,.heic,.heif" style="display:none">' +
      '<button class="ge-btn" type="button" id="uploadBtn-' + uid + '">' +
        CAMERA_SVG +
        '<span class="ge-btn-text">' + buttonText + '</span>' +
      '</button>' +
    '</div>' +
    '<div class="ge-state ge-processing" id="processingState-' + uid + '" style="display:none">' +
      '<div class="ge-loading">' +
        '<p class="ge-loading-text"><span class="ge-spinner"></span><span id="loadingText-' + uid + '">Analyzing image...</span></p>' +
      '</div>' +
    '</div>' +
    '<div class="ge-state" id="resultsState-' + uid + '" style="display:none">' +
      '<div class="ge-results">' +
        '<div class="ge-comparison">' +
          '<div class="ge-comp-side"><img id="beforeImg-' + uid + '" alt="Before" class="ge-comp-img" width="300" height="300"></div>' +
          '<div class="ge-comp-side"><img id="afterImg-' + uid + '" alt="After" class="ge-comp-img" width="300" height="300"></div>' +
        '</div>' +
      '</div>' +
      '<button class="ge-btn" type="button" id="retryBtn-' + uid + '">' +
        RETRY_SVG +
        '<span class="ge-btn-text">Try Again</span>' +
      '</button>' +
    '</div>' +
    '<div class="ge-state" id="errorState-' + uid + '" style="display:none">' +
      '<div class="ge-error">' +
        '<div class="ge-error-icon">' + ERROR_SVG + '</div>' +
        '<p class="ge-error-msg" id="errorMsg-' + uid + '"></p>' +
        '<button class="ge-btn" type="button" id="errorRetryBtn-' + uid + '">' +
          '<span class="ge-btn-text">Try Again</span>' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div class="ge-footer">' +
      '<span class="ge-info-icon">' + INFO_SVG + '</span>' +
      '<p class="ge-disclaimer">' + disclaimer + '</p>' +
    '</div>' +
    '<div class="ge-powered">Powered by <strong>Gleame</strong></div>';

  // ========== Element refs ==========
  var el = function(id) { return document.getElementById(id); };
  var fileInput = el('fileInput-' + uid);
  var placeholder = el('placeholder-' + uid);
  var uploadBtn = el('uploadBtn-' + uid);
  var retryBtn = el('retryBtn-' + uid);
  var errorRetryBtn = el('errorRetryBtn-' + uid);

  // ========== State management ==========
  function showState(state) {
    ['upload', 'processing', 'results', 'error'].forEach(function(s) {
      var e = el(s + 'State-' + uid);
      if (e) e.style.display = s === state ? 'block' : 'none';
    });
    if (state === 'processing') startLoading();
    else stopLoading();
  }

  function startLoading() {
    var idx = 0;
    var textEl = el('loadingText-' + uid);
    if (textEl) textEl.textContent = loadingMessages[0];
    loadingInterval = setInterval(function() {
      idx++;
      if (idx < loadingMessages.length && textEl) {
        textEl.textContent = loadingMessages[idx];
      } else { clearInterval(loadingInterval); loadingInterval = null; }
    }, 3000);
  }

  function stopLoading() {
    if (loadingInterval) { clearInterval(loadingInterval); loadingInterval = null; }
  }

  function showError(msg) {
    var e = el('errorMsg-' + uid);
    if (e) e.textContent = msg;
    showState('error');
  }

  function reset() {
    if (fileInput) fileInput.value = '';
    var b = el('beforeImg-' + uid);
    var a = el('afterImg-' + uid);
    if (b) { b.onload = null; b.onerror = null; b.src = ''; }
    if (a) { a.onload = null; a.onerror = null; a.src = ''; }
    showState('upload');
  }

  function triggerUpload() { if (fileInput) fileInput.click(); }

  // ========== Variant detection ==========
  function getCurrentVariant() {
    var vs = document.querySelector('select[name="id"]');
    if (vs && vs.value) return vs.value;
    var vr = document.querySelector('input[name="id"]:checked');
    if (vr && vr.value) return vr.value;
    var vh = document.querySelector('input[name="id"][type="hidden"]');
    if (vh && vh.value) return vh.value;
    var vi = document.querySelector('input[name="id"]');
    if (vi && vi.value) return vi.value;
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.selectedVariantId) return String(window.ShopifyAnalytics.meta.selectedVariantId);
    var up = new URLSearchParams(window.location.search);
    var vp = up.get('variant');
    if (vp) return vp;
    return null;
  }

  // ========== Analytics ==========
  function trackEvent(eventType) {
    if (!shopDomain || !productId) return;
    var payload = { shopDomain: shopDomain, productId: productId, eventType: eventType, widgetType: WIDGET_TYPE };
    try {
      fetch(SHOPIFY_APP_URL + '/api/storefront/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function(){});
    } catch(e) {}
  }

  // ========== Mobile helpers ==========
  function isMobile() { return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent); }
  function isRecent(f) { return f.lastModified > (Date.now() - 120000); }

  function flipImage(dataUrl) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        try {
          var c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          var ctx = c.getContext('2d');
          ctx.translate(c.width, 0); ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/jpeg', 0.92));
        } catch(e) { resolve(dataUrl); }
      };
      img.onerror = function() { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  function dataUrlToFile(dataUrl, name) {
    var arr = dataUrl.split(',');
    var mime = arr[0].match(/:(.*?);/)[1];
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new File([u8], name, { type: mime });
  }

  function isHeic(f) {
    var types = ['image/heic','image/heif','image/heic-sequence','image/heif-sequence'];
    if (types.indexOf((f.type||'').toLowerCase()) >= 0) return true;
    var ext = (f.name||'').toLowerCase().split('.').pop();
    return ext === 'heic' || ext === 'heif';
  }

  function isValidImage(f) {
    if (f.type && f.type.indexOf('image/') === 0) return true;
    if (isHeic(f)) return true;
    var ext = (f.name||'').toLowerCase().split('.').pop();
    return ['jpg','jpeg','png','gif','webp','bmp','heic','heif','avif'].indexOf(ext) >= 0;
  }

  // ========== File processing ==========
  function processFile(file) {
    if (!file) return;
    if (!isValidImage(file)) { showError('Please upload an image file (JPG, PNG, HEIC, etc.).'); return; }
    if (file.size > 5 * 1024 * 1024) { showError('Image too large. Please upload an image smaller than 5MB.'); return; }
    if (file.size === 0) { showError('The file appears to be empty. Please try another image.'); return; }

    var reader = new FileReader();
    reader.onload = function(e) {
      (async function() {
        try {
          var dataUrl = e.target.result;
          var fileToSend = file;
          var heic = isHeic(file);

          if (isMobile() && isRecent(file) && !heic) {
            dataUrl = await flipImage(dataUrl);
            fileToSend = dataUrlToFile(dataUrl, file.name || 'selfie.jpg');
          }

          var beforeImg = el('beforeImg-' + uid);
          if (beforeImg && !heic) {
            beforeImg.src = dataUrl;
          }
          doTransform(heic ? file : fileToSend);
        } catch(err) { showError('Error loading image. Please try again.'); }
      })();
    };
    reader.onerror = function() { showError('Error reading image. Please try again.'); };
    reader.readAsDataURL(file);
  }

  // ========== Transform API call ==========
  async function doTransform(file) {
    showState('processing');
    try {
      variantId = getCurrentVariant();
      if (!productId) throw new Error('Product not found. Please refresh and try again.');
      if (!shopDomain) throw new Error('Shop domain not detected. Please refresh and try again.');

      var fd = new FormData();
      fd.append('image', file);
      fd.append('productId', productId);
      fd.append('shopDomain', shopDomain);
      fd.append('widgetType', WIDGET_TYPE);
      if (variantId) fd.append('variantId', variantId);

      var ctrl = new AbortController();
      var timeout = setTimeout(function() { ctrl.abort(); }, 90000);

      var resp;
      try {
        resp = await fetch(SHOPIFY_APP_URL + '/api/storefront/transform-image', {
          method: 'POST', body: fd,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          signal: ctrl.signal
        });
      } catch(fe) {
        clearTimeout(timeout);
        if (fe.name === 'AbortError') throw new Error('Request timed out. Please try again.');
        throw new Error('Network error. Please check your connection and try again.');
      }
      clearTimeout(timeout);

      var text = await resp.text();
      var result;
      try { result = JSON.parse(text); } catch(pe) { throw new Error('Invalid server response.'); }
      if (!resp.ok) throw new Error(result.error || 'Server error: ' + resp.status);
      if (!result.success) throw new Error(result.error || 'Transformation failed.');
      if (!result.generatedImage) throw new Error('No transformed image received.');

      var beforeImg = el('beforeImg-' + uid);
      var afterImg = el('afterImg-' + uid);
      if (beforeImg && result.processedInputImage) {
        beforeImg.src = 'data:image/jpeg;base64,' + result.processedInputImage;
      }
      if (afterImg) {
        afterImg.onload = function() { afterImg.style.imageOrientation = 'from-image'; afterImg.style.transform = 'none'; };
        afterImg.src = 'data:image/jpeg;base64,' + result.generatedImage;
      }
      showState('results');
    } catch(err) {
      showError(err.message || 'Something went wrong. Please try again.');
    }
  }

  // ========== Event listeners ==========
  uploadBtn.addEventListener('click', triggerUpload);
  retryBtn.addEventListener('click', reset);
  errorRetryBtn.addEventListener('click', reset);
  fileInput.addEventListener('change', function(e) {
    if (e.target.files && e.target.files.length > 0) processFile(e.target.files[0]);
  });
  placeholder.addEventListener('click', triggerUpload);

  // Drag and drop
  ['dragenter','dragover','dragleave','drop'].forEach(function(ev) {
    placeholder.addEventListener(ev, function(e) { e.preventDefault(); e.stopPropagation(); }, false);
  });
  ['dragenter','dragover'].forEach(function(ev) {
    placeholder.addEventListener(ev, function() { placeholder.classList.add('drag-over'); }, false);
  });
  ['dragleave','drop'].forEach(function(ev) {
    placeholder.addEventListener(ev, function() { placeholder.classList.remove('drag-over'); }, false);
  });
  placeholder.addEventListener('drop', function(e) {
    var files = Array.from(e.dataTransfer.files);
    if (files.length > 0) processFile(files[0]);
  }, false);

  // Variant change listeners
  var vs = document.querySelector('select[name="id"]');
  if (vs) vs.addEventListener('change', function(e) { variantId = e.target.value; });
  document.querySelectorAll('input[name="id"]').forEach(function(inp) {
    inp.addEventListener('change', function(e) { variantId = e.target.value; });
  });

  // Track widget view
  if (!viewTracked) { viewTracked = true; trackEvent('widget_view'); }

  console.log('Gleame Embed Widget loaded:', { productId: productId, shopDomain: shopDomain });
  } // end gleameBoot

  // Try to init immediately, or wait for DOM ready, or poll
  if (gleameInit()) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { gleameInit(); });
  } else {
    // DOM already loaded but element not found - poll briefly (yett.js may delay DOM insertion)
    var attempts = 0;
    var poller = setInterval(function() {
      attempts++;
      if (gleameInit() || attempts > 50) clearInterval(poller);
    }, 100);
  }
})();
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(WIDGET_JS, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
