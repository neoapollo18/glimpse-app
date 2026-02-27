// Gleame Camera Modal - Desktop webcam capture
// Only activates on desktop. Mobile users get the native file picker.
(function() {
  'use strict';

  if (window.gleameCamera) return;

  var CLOSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  var CAMERA_OFF_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2"/><path d="M14.5 4h-5L7 7"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5H20a2 2 0 0 1 2 2v7.5"/></svg>';

  var overlay = null;
  var stream = null;
  var currentCallback = null;
  var currentFallback = null;

  function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  }

  function hasCamera() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(function(t) { t.stop(); });
      stream = null;
    }
  }

  function closeModal() {
    stopStream();
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    overlay = null;
    currentCallback = null;
    currentFallback = null;
  }

  function createModal() {
    var el = document.createElement('div');
    el.className = 'gleame-camera-overlay';
    el.innerHTML =
      '<div class="gleame-camera-modal">' +
        '<div class="gleame-camera-header">' +
          '<h3>Take a Selfie</h3>' +
          '<button class="gleame-camera-close" id="gleameCameraClose">' + CLOSE_SVG + '</button>' +
        '</div>' +
        '<div class="gleame-camera-body">' +
          '<div class="gleame-camera-viewfinder" id="gleameCameraViewfinder">' +
            '<div class="gleame-camera-loading" id="gleameCameraLoading">' +
              '<div class="gleame-camera-loading-spinner"></div>' +
              '<div>Starting camera...</div>' +
            '</div>' +
          '</div>' +
          '<div class="gleame-camera-actions" id="gleameCameraActions">' +
            '<button class="gleame-camera-capture-btn" id="gleameCameraCapture" title="Take photo"></button>' +
          '</div>' +
          '<button class="gleame-camera-upload-link" id="gleameCameraUploadLink">or upload a file instead</button>' +
        '</div>' +
      '</div>';

    // Close on overlay click
    el.addEventListener('click', function(e) {
      if (e.target === el) closeModal();
    });

    return el;
  }

  function showCaptureUI() {
    var actions = document.getElementById('gleameCameraActions');
    if (actions) {
      actions.innerHTML = '<button class="gleame-camera-capture-btn" id="gleameCameraCapture" title="Take photo"></button>';
      document.getElementById('gleameCameraCapture').addEventListener('click', capturePhoto);
    }
  }

  function showReviewUI() {
    var actions = document.getElementById('gleameCameraActions');
    if (actions) {
      actions.innerHTML =
        '<button class="gleame-camera-retake-btn" id="gleameCameraRetake">Retake</button>' +
        '<button class="gleame-camera-use-btn" id="gleameCameraUse">Use Photo →</button>';
      document.getElementById('gleameCameraRetake').addEventListener('click', retakePhoto);
      document.getElementById('gleameCameraUse').addEventListener('click', usePhoto);
    }
    // Hide upload link during review
    var uploadLink = document.getElementById('gleameCameraUploadLink');
    if (uploadLink) uploadLink.style.display = 'none';
  }

  function showError(message) {
    var viewfinder = document.getElementById('gleameCameraViewfinder');
    if (viewfinder) {
      viewfinder.innerHTML =
        '<div class="gleame-camera-error">' +
          CAMERA_OFF_SVG +
          '<p>' + message + '</p>' +
        '</div>';
    }
    var actions = document.getElementById('gleameCameraActions');
    if (actions) actions.innerHTML = '';
  }

  var capturedDataUrl = null;

  function capturePhoto() {
    var viewfinder = document.getElementById('gleameCameraViewfinder');
    var video = viewfinder ? viewfinder.querySelector('video') : null;
    if (!video) return;

    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    var ctx = canvas.getContext('2d');

    // Mirror the capture to match the mirrored preview
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    capturedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

    // Stop video and show captured image
    stopStream();

    var img = document.createElement('img');
    img.src = capturedDataUrl;
    viewfinder.innerHTML = '';
    viewfinder.appendChild(img);

    showReviewUI();
  }

  function retakePhoto() {
    capturedDataUrl = null;
    startCamera();
    showCaptureUI();
    var uploadLink = document.getElementById('gleameCameraUploadLink');
    if (uploadLink) uploadLink.style.display = '';
  }

  function usePhoto() {
    if (!capturedDataUrl || !currentCallback) return;

    // Convert data URL to File
    var arr = capturedDataUrl.split(',');
    var mime = arr[0].match(/:(.*?);/)[1];
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    var file = new File([u8], 'webcam-selfie.jpg', { type: mime });

    var cb = currentCallback;
    closeModal();
    cb(file);
  }

  function startCamera() {
    var viewfinder = document.getElementById('gleameCameraViewfinder');
    if (!viewfinder) return;

    viewfinder.innerHTML =
      '<div class="gleame-camera-loading">' +
        '<div class="gleame-camera-loading-spinner"></div>' +
        '<div>Starting camera...</div>' +
      '</div>';

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
      audio: false
    }).then(function(s) {
      stream = s;
      // Check if modal was closed while waiting for permission
      if (!overlay || !overlay.parentNode) {
        stopStream();
        return;
      }

      var video = document.createElement('video');
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.muted = true;
      video.srcObject = stream;

      viewfinder.innerHTML = '';
      viewfinder.appendChild(video);

      video.play().catch(function() {});
    }).catch(function(err) {
      console.warn('Gleame Camera: getUserMedia failed:', err.message);
      if (err.name === 'NotAllowedError') {
        showError('Camera access was denied.<br>Please allow camera access in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        showError('No camera found on this device.');
      } else {
        showError('Could not start camera.<br>Please try uploading a file instead.');
      }
    });
  }

  // Public API
  window.gleameCamera = {
    open: function(onCapture, onFallbackUpload) {
      // Don't open on mobile
      if (isMobile()) {
        if (onFallbackUpload) onFallbackUpload();
        return;
      }

      // No camera API available
      if (!hasCamera()) {
        if (onFallbackUpload) onFallbackUpload();
        return;
      }

      currentCallback = onCapture;
      currentFallback = onFallbackUpload;
      capturedDataUrl = null;

      overlay = createModal();
      document.body.appendChild(overlay);

      // Bind events
      document.getElementById('gleameCameraClose').addEventListener('click', closeModal);
      document.getElementById('gleameCameraCapture').addEventListener('click', capturePhoto);
      document.getElementById('gleameCameraUploadLink').addEventListener('click', function() {
        var fallback = currentFallback;
        closeModal();
        if (fallback) fallback();
      });

      // Escape key to close
      var escHandler = function(e) {
        if (e.key === 'Escape') {
          closeModal();
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);

      startCamera();
    },

    isDesktop: function() {
      return !isMobile() && hasCamera();
    }
  };

  console.log('Gleame Camera module loaded');
})();
