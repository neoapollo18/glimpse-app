/**
 * Gleame AI Skin Analysis — storefront embed.
 *
 * Drop into any Liquid block, page, or section:
 *   <script src="https://glimpse-app-charles.onrender.com/skin-analysis-embed.js" defer></script>
 *   <div id="gleame-skin-analysis" data-shop="{{ shop.permanent_domain }}"></div>
 *
 * The script is feature-flagged server-side: the API returns 404 unless
 * shops.is_skin_analysis_enabled = true. If 404, the widget hides itself
 * silently — merchants who paste the snippet onto a non-allowlisted shop
 * see no UI at all (rather than a broken upload prompt).
 *
 * Photos are processed in memory only and never stored, per
 * legal/PRIVACY_POLICY.md §5.2.
 */
(function () {
  'use strict';

  // Same host as widget-embed.js. If the app moves, update both.
  var APP_URL = 'https://glimpse-app-charles.onrender.com';

  // Camera modal icons — mirrors the theme widget's gleame-camera.js.
  var CAM_CLOSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  var CAM_OFF_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2"/><path d="M14.5 4h-5L7 7"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5H20a2 2 0 0 1 2 2v7.5"/></svg>';
  var CAM_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';

  // Mobile UAs get the native file picker (with capture hint) instead of the
  // desktop webcam modal — mirrors gleame-camera.js's isMobile gate.
  function camIsMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  }
  function camHasGetUserMedia() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // 6 of the 8 metrics shown on the radar (texture + acne are bar-only —
  // they're noisier signals and a 6-axis hexagon reads cleaner than 8).
  var RADAR_AXES = [
    { key: 'wrinkles',     label: 'Wrinkles' },
    { key: 'sun_damage',   label: 'Sun damage' },
    { key: 'firmness',     label: 'Firmness' },
    { key: 'dark_circles', label: 'Dark circles' },
    { key: 'moisture',     label: 'Moisture' },
    { key: 'spots',        label: 'Spots' },
  ];

  // All 8 metrics, in render order, for the bars.
  var METRICS = [
    { key: 'wrinkles',     label: 'Wrinkles' },
    { key: 'sun_damage',   label: 'Sun damage' },
    { key: 'firmness',     label: 'Firmness' },
    { key: 'dark_circles', label: 'Dark circles' },
    { key: 'texture',      label: 'Texture' },
    { key: 'moisture',     label: 'Moisture' },
    { key: 'spots',        label: 'Spots' },
    { key: 'acne',         label: 'Acne' },
  ];

  // Scores are now grades (higher = better skin). Backend still emits
  // concern-style scores (higher = more concern), so convert at the boundary.
  function toGrade(rawScore) {
    return Math.max(0, Math.min(100, 100 - (rawScore || 0)));
  }
  // Severity bands. Higher GRADE = better skin.
  // 81-100 minimal (green), 61-80 mild (yellow),
  // 41-60 moderate (orange), 0-40 drastic (red).
  function severityTier(grade) {
    if (grade >= 81) return 'minimal';
    if (grade >= 61) return 'mild';
    if (grade >= 41) return 'moderate';
    return 'drastic';
  }
  var TIER_LABELS = { minimal: 'Minimal', mild: 'Mild', moderate: 'Moderate', drastic: 'Drastic' };
  var TIER_COLORS = { minimal: '#22a06b', mild: '#eab308', moderate: '#f97316', drastic: '#ef4444' };
  function readableSkinType(t) {
    if (!t) return '';
    return t.charAt(0).toUpperCase() + t.slice(1) + ' skin';
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ------------------------------------------------------------
  // Page-type guard.
  //
  // Merchants sometimes paste the embed snippet into a Liquid section that
  // ends up rendering on every product or collection page (e.g. a footer
  // section, or product-template.liquid). The widget is not designed for
  // that — it's a dedicated page experience. Default behavior: refuse to
  // mount on /products/* or /collections/*. Merchants can override on a
  // per-instance basis with `data-gleame-allow-anywhere` on the host element.
  // ------------------------------------------------------------
  function isBlockedPage() {
    var tmpl = (window.Shopify && window.Shopify.template) || '';
    var path = (window.location && window.location.pathname) || '';
    if (/^product/.test(tmpl) || /^collection/.test(tmpl)) return true;
    if (path.indexOf('/products/') === 0) return true;
    if (path.indexOf('/collections/') === 0) return true;
    return false;
  }

  // ------------------------------------------------------------
  // CSS — scoped under .gleame-skin to avoid leaking into theme.
  // Injected once per page.
  // ------------------------------------------------------------
  var CSS = ''
    + '.gleame-skin{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:1100px;margin:0 auto;}'
    + '.gleame-skin *{box-sizing:border-box;}'
    + '.gleame-skin-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;}'
    + '@media(max-width:760px){.gleame-skin-grid{grid-template-columns:1fr;}}'
    + '.gleame-skin-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;box-shadow:0 1px 2px rgba(15,23,42,.04);}'
    + '.gleame-skin-h{font-size:18px;font-weight:600;margin:0 0 16px;}'
    + '.gleame-skin-drop{display:block;position:relative;border:2px dashed #cbd5e1;border-radius:12px;padding:112px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background-color .15s;background:#f8fafc;margin:0;}'
    + '.gleame-skin-drop:hover{border-color:#22a06b;background:#f1f5f9;}'
    + '.gleame-skin-drop.is-dragging{border-color:#22a06b;background:#f0fdf4;}'
    // Bulletproof hide for the file input — themes often override `display:none`
    // on input[type=file]. Move it off-screen with !important so theme CSS
    // can't bring it back.
    + '.gleame-skin-drop input[type="file"]{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;border:0!important;opacity:0!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;pointer-events:none!important;}'
    + '.gleame-skin-drop-icon{font-size:32px;color:#94a3b8;margin-bottom:8px;}'
    + '.gleame-skin-drop-title{font-size:15px;font-weight:500;color:#0f172a;}'
    + '.gleame-skin-drop-hint{font-size:12px;color:#64748b;margin-top:4px;}'
    + '.gleame-skin-thumb{border-radius:12px;overflow:hidden;max-height:600px;position:relative;cursor:pointer;}'
    + '.gleame-skin-thumb img{display:block;width:100%;height:auto;object-fit:cover;}'
    + '.gleame-skin-thumb-swap{position:absolute;top:10px;right:10px;background:rgba(15,23,42,.7);color:#fff;font-size:11px;padding:6px 10px;border-radius:999px;backdrop-filter:blur(4px);opacity:0;transition:opacity .15s;pointer-events:none;}'
    + '.gleame-skin-thumb:hover .gleame-skin-thumb-swap{opacity:1;}'
    // Scanning bar — appears only while .is-scanning is set on the thumb.
    // A thin blue line travels top-to-bottom with a soft glow + faint trail,
    // reading as an "AI scanning" effect.
    + '.gleame-skin-scanner{position:absolute;left:0;right:0;top:0;height:3px;background:#22a06b;box-shadow:0 0 14px 3px rgba(34,160,107,.65);pointer-events:none;display:none;}'
    + '.gleame-skin-scanner:after{content:"";position:absolute;left:0;right:0;top:-44px;height:44px;background:linear-gradient(to bottom,rgba(34,160,107,0) 0%,rgba(34,160,107,.18) 60%,rgba(34,160,107,.4) 100%);}'
    + '.gleame-skin-thumb.is-scanning .gleame-skin-scanner{display:block;animation:gleame-scan 4.5s ease-in-out infinite;}'
    + '@keyframes gleame-scan{0%{top:-3px;}50%{top:calc(100% - 3px);}100%{top:-3px;}}'
    + '.gleame-skin-tips{font-size:13px;color:#64748b;margin:16px 0 0;padding:0;list-style:none;}'
    + '.gleame-skin-tips li{padding-left:18px;position:relative;margin-bottom:4px;}'
    + '.gleame-skin-tips li:before{content:"";position:absolute;left:6px;top:9px;width:4px;height:4px;border-radius:50%;background:#94a3b8;}'
    + '.gleame-skin-cta{margin-top:20px;width:100%;padding:14px 16px;border:0;border-radius:10px;background:#0f172a;color:#fff;font-size:15px;font-weight:500;cursor:pointer;transition:opacity .15s,transform .05s;}'
    + '.gleame-skin-cta:hover{opacity:.92;}'
    + '.gleame-skin-cta:active{transform:translateY(1px);}'
    + '.gleame-skin-cta:disabled{opacity:.5;cursor:not-allowed;}'
    // Loading status row — replaces the CTA while a scan is in flight.
    + '.gleame-skin-loading-row{margin-top:20px;display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:10px;background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d;font-size:14px;font-weight:500;}'
    + '.gleame-skin-loading-dot{width:9px;height:9px;border-radius:50%;background:#22a06b;flex-shrink:0;animation:gleame-pulse 1s ease-in-out infinite;}'
    + '@keyframes gleame-pulse{0%,100%{opacity:.35;transform:scale(.8);}50%{opacity:1;transform:scale(1.15);}}'
    + '.gleame-skin-loading-text{flex:1;min-height:18px;}'
    + '.gleame-skin-error{padding:12px 16px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:13px;margin-bottom:16px;}'
    + '.gleame-skin-radar-wrap{display:flex;justify-content:center;margin:0 -8px 8px;}'
    + '.gleame-skin-radar{width:100%;max-width:360px;height:auto;overflow:visible;}'
    + '.gleame-skin-radar-axis{stroke:#e2e8f0;stroke-width:1;fill:none;}'
    + '.gleame-skin-radar-grid{stroke:#e2e8f0;stroke-width:1;fill:none;}'
    + '.gleame-skin-radar-shape{fill:rgba(34,160,107,.22);stroke:#22a06b;stroke-width:2.5;stroke-linejoin:round;filter:drop-shadow(0 4px 10px rgba(34,160,107,.25));animation:gleame-radar-fade .6s ease-out;}'
    + '.gleame-skin-radar-dot{fill:#22a06b;}'
    + '.gleame-skin-radar-label{font-size:11px;fill:#475569;}'
    + '@keyframes gleame-radar-fade{from{opacity:0;transform:scale(.8);}to{opacity:1;transform:scale(1);}}'
    + '.gleame-skin-typebadge{display:inline-block;padding:4px 12px;border-radius:999px;background:#f0fdf4;color:#14532d;font-size:12px;font-weight:500;margin-bottom:16px;}'
    + '.gleame-skin-bars{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;margin-bottom:20px;}'
    + '@media(max-width:540px){.gleame-skin-bars{grid-template-columns:1fr;}}'
    + '.gleame-skin-bar-row{}'
    + '.gleame-skin-bar-head{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:6px;}'
    + '.gleame-skin-bar-label{color:#334155;font-weight:500;}'
    + '.gleame-skin-bar-value{color:#64748b;font-variant-numeric:tabular-nums;}'
    + '.gleame-skin-bar-track{height:12px;background:#f1f5f9;border-radius:6px;overflow:hidden;}'
    // Bar fill: color is applied via modifier class (avoids losing the
    // background-color to the placeholder shimmer rule, whose `background:`
    // shorthand sets background-image and would mask any background-color
    // we tried to set inline). Width still varies per bar so it stays inline.
    // background-image:none here defensively cancels any inherited gradient
    // from a stale placeholder render race.
    + '.gleame-skin-bar-fill{display:block;height:100%;border-radius:6px;min-width:8px;background-image:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);}'
    // Modifier classes use !important so they win against the placeholder
    // shimmer rule on a render race AND against any merchant-theme rule that
    // targets div/[class*=fill]. Also explicitly null out background-image
    // so a stale placeholder gradient can't mask the color.
    + '.gleame-skin-bar-fill--minimal{background-color:#22a06b!important;background-image:none!important;}'
    + '.gleame-skin-bar-fill--mild{background-color:#eab308!important;background-image:none!important;}'
    + '.gleame-skin-bar-fill--moderate{background-color:#f97316!important;background-image:none!important;}'
    + '.gleame-skin-bar-fill--drastic{background-color:#ef4444!important;background-image:none!important;}'
    + '.gleame-skin-bar-sev{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-top:5px;}'
    + '.gleame-skin-notes{padding:14px 16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;color:#334155;line-height:1.55;margin-bottom:20px;}'
    + '.gleame-skin-recs-h{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin:0 0 12px;}'
    + '.gleame-skin-recs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}'
    + '@media(max-width:540px){.gleame-skin-recs{grid-template-columns:1fr;}}'
    + '.gleame-skin-rec{display:flex;flex-direction:column;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;background:#fff;transition:transform .15s,box-shadow .15s;position:relative;}'
    + '.gleame-skin-rec:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(15,23,42,.08);}'
    + '.gleame-skin-rec-accent{height:3px;background:#22a06b;}'
    + '.gleame-skin-rec-img{aspect-ratio:1/1;width:100%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#cbd5e1;font-size:24px;}'
    + '.gleame-skin-rec-img img{display:block;width:100%;height:100%;object-fit:cover;}'
    + '.gleame-skin-rec-body{padding:10px 12px 14px;}'
    + '.gleame-skin-rec-concern{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#22a06b;font-weight:600;}'
    + '.gleame-skin-rec-title{font-size:13px;color:#0f172a;margin-top:4px;font-weight:500;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'
    + '.gleame-skin-rec-shop{margin-top:8px;display:inline-block;font-size:11px;color:#64748b;}'
    + '.gleame-skin-foot{margin-top:18px;font-size:11px;color:#94a3b8;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;}'
    + '.gleame-skin-foot a{color:#64748b;text-decoration:underline;cursor:pointer;}'
    + '.gleame-skin-foot a[aria-disabled="true"]{color:#cbd5e1;cursor:default;text-decoration:none;}'
    + '.gleame-skin-disclaimer{margin-top:14px;font-size:11px;color:#94a3b8;line-height:1.5;}'
    // ----- Placeholder mode -----
    // Wraps the right pane before any analysis runs (and between runs). It
    // shows the same shapes the real result will use — radar, bars, recs —
    // in a muted, dimmed, gently shimmering treatment so the layout never
    // jumps and the user can see what's coming.
    + '.gleame-skin-placeholder{position:relative;}'
    + '.gleame-skin-placeholder .gleame-skin-typebadge{background:#f1f5f9;color:#94a3b8;}'
    + '.gleame-skin-placeholder .gleame-skin-radar-shape,.gleame-skin-placeholder .gleame-skin-radar-dot{display:none;}'
    // !important needed because renderBars writes the severity color and
    // bold weight inline; without !important the inline styles paint the
    // placeholder values/labels in the result-state green.
    + '.gleame-skin-placeholder .gleame-skin-bar-value{color:#cbd5e1!important;font-weight:500!important;}'
    + '.gleame-skin-placeholder .gleame-skin-bar-sev{color:#cbd5e1!important;font-weight:500!important;}'
    + '.gleame-skin-placeholder .gleame-skin-bar-label{color:#cbd5e1;}'
    + '.gleame-skin-placeholder .gleame-skin-rec-accent{background:#e2e8f0;}'
    + '.gleame-skin-placeholder .gleame-skin-radar-label{fill:#cbd5e1;}'
    + '.gleame-skin-placeholder .gleame-skin-recs-h{color:#cbd5e1;}'
    + '.gleame-skin-placeholder .gleame-skin-bar-fill{background:linear-gradient(90deg,#e2e8f0 0%,#f1f5f9 50%,#e2e8f0 100%)!important;background-size:200% 100%!important;width:35%!important;animation:gleame-shimmer 1.6s ease-in-out infinite;}'
    + '.gleame-skin-placeholder .gleame-skin-rec{background:#fff;}'
    + '.gleame-skin-placeholder .gleame-skin-rec-img{background:linear-gradient(90deg,#f1f5f9 0%,#e2e8f0 50%,#f1f5f9 100%);background-size:200% 100%;animation:gleame-shimmer 1.6s ease-in-out infinite;color:transparent;}'
    + '.gleame-skin-placeholder .gleame-skin-rec-concern,.gleame-skin-placeholder .gleame-skin-rec-title,.gleame-skin-placeholder .gleame-skin-rec-shop{display:block;background:#f1f5f9;color:transparent!important;border-radius:4px;height:10px;}'
    + '.gleame-skin-placeholder .gleame-skin-rec-concern{width:55%;}'
    + '.gleame-skin-placeholder .gleame-skin-rec-title{height:14px;width:90%;margin-top:8px;}'
    + '.gleame-skin-placeholder .gleame-skin-rec-shop{height:9px;width:45%;margin-top:8px;}'
    + '.gleame-skin-placeholder-hint{position:absolute;top:12px;right:12px;font-size:12px;color:#94a3b8;background:rgba(255,255,255,.85);backdrop-filter:blur(2px);padding:6px 12px;border-radius:999px;border:1px solid #e2e8f0;pointer-events:none;z-index:2;}'
    + '@keyframes gleame-shimmer{0%,100%{background-position:0% 0;opacity:.7;}50%{background-position:100% 0;opacity:1;}}'
    // ----- Take-a-photo section (below the upload zone) -----
    // The "or" divider visually separates upload from camera capture so it
    // reads as two distinct options rather than a single ambiguous control.
    + '.gleame-skin-or{display:flex;align-items:center;gap:10px;margin:14px 0;color:#94a3b8;font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;}'
    + '.gleame-skin-or:before,.gleame-skin-or:after{content:"";flex:1;height:1px;background:#e2e8f0;}'
    + '.gleame-skin-camera-btn{width:100%;padding:14px 16px;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;color:#0f172a;font-size:14px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:border-color .15s,background-color .15s;}'
    + '.gleame-skin-camera-btn:hover{border-color:#22a06b;background:#f0fdf4;}'
    + '.gleame-skin-camera-btn svg{flex-shrink:0;}'
    // Modal lives at document.body (outside .gleame-skin) so it needs its own
    // font stack. Mirrors the theme widget's gleame-camera.css.
    + '.gleame-skin-cam-overlay{position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:2147483000;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;animation:gleame-cam-fade .2s ease;}'
    + '@keyframes gleame-cam-fade{from{opacity:0;}to{opacity:1;}}'
    + '.gleame-skin-cam-modal{background:#fff;border-radius:14px;width:640px;max-width:92vw;max-height:85vh;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.25);display:flex;}'
    + '.gleame-skin-cam-view-wrap{flex:1;min-width:0;background:#0a0a0a;position:relative;display:flex;align-items:center;justify-content:center;}'
    + '.gleame-skin-cam-view{width:100%;aspect-ratio:4/5;overflow:hidden;position:relative;}'
    + '.gleame-skin-cam-view video,.gleame-skin-cam-view img{width:100%;height:100%;object-fit:cover;display:block;}'
    + '.gleame-skin-cam-view video{transform:scaleX(-1);}'
    + '.gleame-skin-cam-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;animation:gleame-cam-flash .3s ease-out;}'
    + '@keyframes gleame-cam-flash{0%{opacity:.8;}100%{opacity:0;}}'
    + '.gleame-skin-cam-loading{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:rgba(255,255,255,.8);font-size:13px;text-align:center;}'
    + '.gleame-skin-cam-spinner{width:20px;height:20px;border:2px solid rgba(255,255,255,.2);border-top-color:rgba(255,255,255,.8);border-radius:50%;animation:gleame-cam-spin .7s linear infinite;margin:0 auto 10px;}'
    + '@keyframes gleame-cam-spin{to{transform:rotate(360deg);}}'
    + '.gleame-skin-cam-controls{width:220px;display:flex;flex-direction:column;border-left:1px solid #e5e7eb;}'
    + '.gleame-skin-cam-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;}'
    + '.gleame-skin-cam-head h3{margin:0;font-size:13px;font-weight:600;color:#111;text-transform:uppercase;letter-spacing:.02em;}'
    + '.gleame-skin-cam-close{background:none;border:none;cursor:pointer;padding:2px;color:#9ca3af;line-height:1;}'
    + '.gleame-skin-cam-close:hover{color:#111;}'
    + '.gleame-skin-cam-body{flex:1;padding:24px 20px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:16px;}'
    + '.gleame-skin-cam-hint{font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;margin:0;}'
    + '.gleame-skin-cam-actions{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;}'
    + '.gleame-skin-cam-shutter{width:56px;height:56px;border-radius:50%;border:3px solid #0f172a;background:transparent;cursor:pointer;position:relative;padding:0;}'
    + '.gleame-skin-cam-shutter:after{content:"";position:absolute;top:3px;left:3px;right:3px;bottom:3px;background:#0f172a;border-radius:50%;transition:transform .15s;}'
    + '.gleame-skin-cam-shutter:hover:after{transform:scale(.9);}'
    + '.gleame-skin-cam-shutter-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:500;}'
    + '.gleame-skin-cam-use{width:100%;padding:10px 16px;border-radius:8px;border:0;background:#0f172a;color:#fff;font-size:13px;font-weight:500;cursor:pointer;}'
    + '.gleame-skin-cam-use:hover{opacity:.92;}'
    + '.gleame-skin-cam-retake{width:100%;padding:10px 16px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#374151;font-size:13px;font-weight:500;cursor:pointer;}'
    + '.gleame-skin-cam-retake:hover{border-color:#9ca3af;background:#f9fafb;}'
    + '.gleame-skin-cam-foot{padding:14px 20px;border-top:1px solid #e5e7eb;}'
    + '.gleame-skin-cam-upload{width:100%;padding:9px 16px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#374151;font-size:12px;font-weight:500;cursor:pointer;}'
    + '.gleame-skin-cam-upload:hover{border-color:#9ca3af;background:#f9fafb;}'
    + '.gleame-skin-cam-error{text-align:center;padding:40px 20px;color:#6b7280;font-size:13px;line-height:1.5;}'
    + '.gleame-skin-cam-error svg{margin-bottom:12px;color:#d1d5db;}'
    + '@media(max-width:580px){.gleame-skin-cam-modal{flex-direction:column;width:380px;}.gleame-skin-cam-controls{width:100%;border-left:none;border-top:1px solid #e5e7eb;}.gleame-skin-cam-view{aspect-ratio:1;}}'
    + '';

  function injectCSS() {
    if (document.getElementById('gleame-skin-style')) return;
    var s = document.createElement('style');
    s.id = 'gleame-skin-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------
  // SVG radar — hand-rolled, no dependencies.
  // 6 axes, equally spaced; 4 grid rings (25/50/75/100).
  // ------------------------------------------------------------
  function pointOnAxis(cx, cy, radius, axisIndex, totalAxes) {
    // First axis points up. Each subsequent axis is rotated clockwise.
    var angle = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / totalAxes;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  }
  function renderRadar(scores) {
    var size = 320;
    var pad = 40;
    var cx = size / 2;
    var cy = size / 2;
    var rMax = (size - 2 * pad) / 2;
    var n = RADAR_AXES.length;

    var parts = [];
    parts.push('<svg class="gleame-skin-radar" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Skin profile radar chart">');

    // Concentric grid rings (4 rings: 25, 50, 75, 100).
    for (var ring = 1; ring <= 4; ring++) {
      var r = (rMax * ring) / 4;
      var pts = [];
      for (var i = 0; i < n; i++) {
        var p = pointOnAxis(cx, cy, r, i, n);
        pts.push(p.x.toFixed(1) + ',' + p.y.toFixed(1));
      }
      parts.push('<polygon class="gleame-skin-radar-grid" points="' + pts.join(' ') + '"/>');
    }

    // Axis lines and labels.
    for (var j = 0; j < n; j++) {
      var outer = pointOnAxis(cx, cy, rMax, j, n);
      parts.push('<line class="gleame-skin-radar-axis" x1="' + cx + '" y1="' + cy + '" x2="' + outer.x.toFixed(1) + '" y2="' + outer.y.toFixed(1) + '"/>');
      var labelP = pointOnAxis(cx, cy, rMax + 16, j, n);
      var anchor = labelP.x < cx - 1 ? 'end' : labelP.x > cx + 1 ? 'start' : 'middle';
      var dy = labelP.y < cy ? '-2' : labelP.y > cy ? '10' : '4';
      parts.push('<text class="gleame-skin-radar-label" x="' + labelP.x.toFixed(1) + '" y="' + labelP.y.toFixed(1) + '" text-anchor="' + anchor + '" dy="' + dy + '">' + escapeHtml(RADAR_AXES[j].label) + '</text>');
    }

    // Score polygon. Convert raw concern-score → grade (high = good) so the
    // polygon fills OUTWARD when the customer's skin looks great.
    var shapePts = [];
    var dots = [];
    for (var k = 0; k < n; k++) {
      var raw = scores[RADAR_AXES[k].key];
      var grade = raw != null ? toGrade(raw) : 0;
      var pt = pointOnAxis(cx, cy, (rMax * grade) / 100, k, n);
      shapePts.push(pt.x.toFixed(1) + ',' + pt.y.toFixed(1));
      dots.push('<circle class="gleame-skin-radar-dot" cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="3"/>');
    }
    parts.push('<polygon class="gleame-skin-radar-shape" points="' + shapePts.join(' ') + '"/>');
    parts.push(dots.join(''));
    parts.push('</svg>');
    return parts.join('');
  }

  // ------------------------------------------------------------
  // Bars — 8 metrics, each tinted by severity tier.
  //
  // The bar fill's color + width are baked directly into the inline style
  // attribute with !important so they're applied the instant the HTML is
  // parsed into the DOM. No post-render JS step, no timing race, no
  // dependency on a modifier class winning the cascade. Inline !important
  // is the single highest-priority origin in the CSS cascade and cannot be
  // overridden by any stylesheet — not the placeholder shimmer rule, not a
  // merchant-theme reset, nothing.
  //
  // PLACEHOLDER mode (scores = {} / null): we intentionally emit NO inline
  // style on the fill so the .gleame-skin-placeholder .gleame-skin-bar-fill
  // shimmer rule wins by default. That keeps the empty/pre-result state
  // gently animated instead of painted with a real severity color.
  // ------------------------------------------------------------
  function renderBars(scores) {
    var html = '<div class="gleame-skin-bars">';
    var hasData = scores && Object.keys(scores).length > 0;
    for (var i = 0; i < METRICS.length; i++) {
      var m = METRICS[i];
      // Convert raw concern-score (high = more concern, what the LLM emits)
      // → grade (high = better skin, what the customer sees). This mapping
      // is the entire reason the bars are colorful: a high LLM score on
      // wrinkles → low grade → red tier, etc.
      var raw = scores && scores[m.key] != null ? Number(scores[m.key]) : 0;
      if (!isFinite(raw)) raw = 0;
      var grade = hasData ? toGrade(raw) : 0;
      var tier = severityTier(grade);
      var color = TIER_COLORS[tier];
      var sev = TIER_LABELS[tier];
      var widthPct = Math.max(grade, 5); // 5% floor so even grade=0 shows a chip

      // Result mode: bake inline !important style so nothing can mask it.
      // Placeholder mode: empty string → fill renders without color/width
      // and the shimmer CSS rule paints it.
      var fillStyle = hasData
        ? ' style="background-color:' + color + ' !important;background-image:none !important;width:' + widthPct + '% !important;"'
        : '';

      html += ''
        + '<div class="gleame-skin-bar-row">'
        +   '<div class="gleame-skin-bar-head">'
        +     '<span class="gleame-skin-bar-label">' + escapeHtml(m.label) + '</span>'
        +     '<span class="gleame-skin-bar-value" style="color:' + color + ';font-weight:600;">' + grade + '</span>'
        +   '</div>'
        +   '<div class="gleame-skin-bar-track"><div class="gleame-skin-bar-fill gleame-skin-bar-fill--' + tier + '"' + fillStyle + '></div></div>'
        +   '<div class="gleame-skin-bar-sev" style="color:' + color + ';">' + sev + '</div>'
        + '</div>';
    }
    html += '</div>';
    return html;
  }

  // ------------------------------------------------------------
  // Recommendations
  // ------------------------------------------------------------
  function renderRecommendations(recs) {
    if (!recs || recs.length === 0) return '';
    var concernLabels = {};
    for (var i = 0; i < METRICS.length; i++) concernLabels[METRICS[i].key] = METRICS[i].label;

    var cards = recs.map(function (r) {
      var label = concernLabels[r.concern] || r.concern;
      var inner = ''
        + '<div class="gleame-skin-rec-accent"></div>'
        + '<div class="gleame-skin-rec-img">'
        +   (r.imageUrl ? '<img src="' + escapeHtml(r.imageUrl) + '" alt="' + escapeHtml(r.title || '') + '" loading="lazy"/>' : '◯')
        + '</div>'
        + '<div class="gleame-skin-rec-body">'
        +   '<div class="gleame-skin-rec-concern">' + escapeHtml(label) + '</div>'
        +   '<div class="gleame-skin-rec-title">' + escapeHtml(r.title || 'Recommended for you') + '</div>'
        +   '<span class="gleame-skin-rec-shop">View product →</span>'
        + '</div>';
      if (r.url) {
        // target="_blank" so the click always opens — some merchant themes
        // bind click listeners on .product-card / [href*="/products/"] etc.
        // that swallow same-tab navigations. Keeps the analysis open too.
        return '<a class="gleame-skin-rec" href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>';
      }
      return '<div class="gleame-skin-rec">' + inner + '</div>';
    }).join('');
    return ''
      + '<h4 class="gleame-skin-recs-h">Recommended for you</h4>'
      + '<div class="gleame-skin-recs">' + cards + '</div>';
  }

  // ------------------------------------------------------------
  // Placeholder result — same skeleton as the real result, but with all
  // empty/zeroed data and a `gleame-skin-placeholder` class on the wrapper
  // so CSS dims everything and runs the shimmer. Used as the rest state
  // (before any photo is analyzed) and during loading (right pane stays
  // calm; the action lives on the left side).
  // ------------------------------------------------------------
  function renderPlaceholderResult() {
    var typeBadge = '<div class="gleame-skin-typebadge">Skin type</div>';
    // Empty score map → renderRadar draws the grid and axes only; the
    // .gleame-skin-radar-shape is hidden by the placeholder CSS rule.
    var radar = '<div class="gleame-skin-radar-wrap">' + renderRadar({}) + '</div>';
    var bars = renderBars({});
    var ghostRecs = ''
      + '<h4 class="gleame-skin-recs-h">Recommended for you</h4>'
      + '<div class="gleame-skin-recs">'
      +   '<div class="gleame-skin-rec"><div class="gleame-skin-rec-accent"></div><div class="gleame-skin-rec-img"></div><div class="gleame-skin-rec-body"><div class="gleame-skin-rec-concern">Concern</div><div class="gleame-skin-rec-title">Product title placeholder line two</div><span class="gleame-skin-rec-shop">View product</span></div></div>'
      +   '<div class="gleame-skin-rec"><div class="gleame-skin-rec-accent"></div><div class="gleame-skin-rec-img"></div><div class="gleame-skin-rec-body"><div class="gleame-skin-rec-concern">Concern</div><div class="gleame-skin-rec-title">Product title placeholder line two</div><span class="gleame-skin-rec-shop">View product</span></div></div>'
      +   '<div class="gleame-skin-rec"><div class="gleame-skin-rec-accent"></div><div class="gleame-skin-rec-img"></div><div class="gleame-skin-rec-body"><div class="gleame-skin-rec-concern">Concern</div><div class="gleame-skin-rec-title">Product title placeholder line two</div><span class="gleame-skin-rec-shop">View product</span></div></div>'
      + '</div>';
    var hint = '<div class="gleame-skin-placeholder-hint">Upload a photo to see your profile</div>';
    return '<div class="gleame-skin-placeholder">' + typeBadge + radar + bars + ghostRecs + hint + '</div>';
  }

  // ------------------------------------------------------------
  // Loading messages — friendly progress text rotation.
  // The API call takes 5-10s; rotate every 1.5s so the user feels progress.
  // ------------------------------------------------------------
  var LOADING_MESSAGES = [
    'Reading your skin tone…',
    'Looking for fine lines…',
    'Checking sun damage…',
    'Measuring hydration…',
    'Matching your products…',
  ];

  function startLoadingRotator(el) {
    var i = 0;
    el.textContent = LOADING_MESSAGES[0];
    var timer = setInterval(function () {
      i = (i + 1) % LOADING_MESSAGES.length;
      el.textContent = LOADING_MESSAGES[i];
    }, 5000);
    return function () { clearInterval(timer); };
  }

  // ------------------------------------------------------------
  // Camera capture — desktop webcam modal.
  //
  // Same viewfinder → capture → review (Use / Retake) flow as the theme
  // widget's gleame-camera.js. Self-contained here because the skin-analysis
  // embed is a standalone script and can't assume the theme extension's
  // gleame-camera.js asset is on the page.
  //
  // `onCapture(file)` receives a JPEG File. `onUploadFallback()` fires if the
  // user clicks "Upload a file instead". Caller decides mobile gating before
  // calling this (mobile UAs use the native picker).
  // ------------------------------------------------------------
  function openSkinCamera(onCapture, onUploadFallback) {
    var stream = null;
    var capturedDataUrl = null;

    var overlay = document.createElement('div');
    overlay.className = 'gleame-skin-cam-overlay';
    overlay.innerHTML = ''
      + '<div class="gleame-skin-cam-modal">'
      +   '<div class="gleame-skin-cam-view-wrap">'
      +     '<div class="gleame-skin-cam-view" data-cam-view></div>'
      +   '</div>'
      +   '<div class="gleame-skin-cam-controls">'
      +     '<div class="gleame-skin-cam-head"><h3>Camera</h3>'
      +       '<button class="gleame-skin-cam-close" data-cam-close aria-label="Close">' + CAM_CLOSE_SVG + '</button>'
      +     '</div>'
      +     '<div class="gleame-skin-cam-body">'
      +       '<p class="gleame-skin-cam-hint" data-cam-hint>Position your face in the frame</p>'
      +       '<div class="gleame-skin-cam-actions" data-cam-actions></div>'
      +     '</div>'
      +     '<div class="gleame-skin-cam-foot" data-cam-foot>'
      +       '<button class="gleame-skin-cam-upload" data-cam-upload>Upload a file instead</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    var viewEl = overlay.querySelector('[data-cam-view]');
    var hintEl = overlay.querySelector('[data-cam-hint]');
    var actionsEl = overlay.querySelector('[data-cam-actions]');
    var footEl = overlay.querySelector('[data-cam-foot]');

    function stopStream() {
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
    }
    function close() {
      stopStream();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    function showCaptureUI() {
      actionsEl.innerHTML = ''
        + '<button class="gleame-skin-cam-shutter" data-cam-shoot title="Take photo"></button>'
        + '<span class="gleame-skin-cam-shutter-label">Capture</span>';
      actionsEl.querySelector('[data-cam-shoot]').addEventListener('click', capture);
      footEl.style.display = '';
      hintEl.textContent = 'Position your face in the frame';
    }
    function showReviewUI() {
      actionsEl.innerHTML = ''
        + '<button class="gleame-skin-cam-use" data-cam-use>Use photo</button>'
        + '<button class="gleame-skin-cam-retake" data-cam-retake>Retake</button>';
      actionsEl.querySelector('[data-cam-use]').addEventListener('click', use);
      actionsEl.querySelector('[data-cam-retake]').addEventListener('click', retake);
      footEl.style.display = 'none';
      hintEl.textContent = 'Looking good?';
    }
    function showError(msg) {
      viewEl.innerHTML = '<div class="gleame-skin-cam-error">' + CAM_OFF_SVG + '<p>' + msg + '</p></div>';
      actionsEl.innerHTML = '';
      hintEl.textContent = '';
    }

    function capture() {
      var video = viewEl.querySelector('video');
      if (!video) return;
      var flash = document.createElement('div');
      flash.className = 'gleame-skin-cam-flash';
      viewEl.appendChild(flash);

      var canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext('2d');
      // Un-mirror: the viewfinder is flipped for a natural selfie, but the
      // saved frame should match real-world orientation.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0);
      capturedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

      setTimeout(function () {
        stopStream();
        var img = document.createElement('img');
        img.src = capturedDataUrl;
        viewEl.innerHTML = '';
        viewEl.appendChild(img);
        showReviewUI();
      }, 150);
    }
    function retake() {
      capturedDataUrl = null;
      start();
      showCaptureUI();
    }
    function use() {
      if (!capturedDataUrl) return;
      var arr = capturedDataUrl.split(',');
      var mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
      var bstr = atob(arr[1]);
      var n = bstr.length;
      var u8 = new Uint8Array(n);
      while (n--) u8[n] = bstr.charCodeAt(n);
      var file = new File([u8], 'webcam-selfie.jpg', { type: mime });
      close();
      if (onCapture) onCapture(file);
    }
    function start() {
      hintEl.textContent = 'Allow camera access when prompted';
      viewEl.innerHTML = ''
        + '<div class="gleame-skin-cam-loading">'
        +   '<div class="gleame-skin-cam-spinner"></div><div>Starting camera…</div>'
        + '</div>';
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      }).then(function (s) {
        stream = s;
        if (!overlay.parentNode) { stopStream(); return; }
        var video = document.createElement('video');
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', '');
        video.muted = true;
        video.srcObject = stream;
        viewEl.innerHTML = '';
        viewEl.appendChild(video);
        video.play().catch(function () {});
        hintEl.textContent = 'Position your face in the frame';
      }).catch(function (err) {
        if (err && err.name === 'NotAllowedError') {
          showError('Camera access was denied.<br>Allow it in your browser settings, or upload a file.');
        } else if (err && err.name === 'NotFoundError') {
          showError('No camera found on this device.');
        } else {
          showError('Could not start the camera.<br>Please upload a file instead.');
        }
      });
    }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('[data-cam-close]').addEventListener('click', close);
    overlay.querySelector('[data-cam-upload]').addEventListener('click', function () {
      close();
      if (onUploadFallback) onUploadFallback();
    });
    document.addEventListener('keydown', onKey);

    showCaptureUI();
    start();
  }

  // ------------------------------------------------------------
  // Initial render of one widget instance.
  // ------------------------------------------------------------
  function renderShell(container, shopDomain) {
    container.classList.add('gleame-skin');
    container.innerHTML = ''
      + '<div class="gleame-skin-grid">'
      +   '<div class="gleame-skin-card" data-pane="upload">'
      +     '<h3 class="gleame-skin-h">Your skin analysis</h3>'
      +     '<label class="gleame-skin-drop" data-drop>'
      +       '<div class="gleame-skin-drop-icon">↑</div>'
      +       '<div class="gleame-skin-drop-title">Tap or drop a photo</div>'
      +       '<div class="gleame-skin-drop-hint">JPG, PNG, or HEIC — up to 5 MB</div>'
      +       '<input type="file" accept="image/*" data-file-input/>'
      +     '</label>'
      // "Or take a photo" section — visually a peer of the upload zone, not
      // a tiny secondary button. The divider makes the two paths feel equal.
      +     '<div class="gleame-skin-or" data-or-divider>or</div>'
      +     '<button class="gleame-skin-camera-btn" data-camera type="button">' + CAM_ICON_SVG + 'Take a photo</button>'
      // Hidden input used as the mobile fallback for "Take a photo" — the
      // capture="user" hint asks mobile browsers to open the front camera.
      +     '<input type="file" accept="image/*" capture="user" data-camera-input style="display:none"/>'
      +     '<div data-thumb></div>'
      +     '<ul class="gleame-skin-tips">'
      +       '<li>Face the camera in natural light</li>'
      +       '<li>Remove glasses and heavy makeup</li>'
      +     '</ul>'
      +     '<div data-cta-slot>'
      +       '<button class="gleame-skin-cta" data-analyze disabled>Analyze my skin</button>'
      +     '</div>'
      +     '<p class="gleame-skin-disclaimer">Cosmetic guidance only — photos are never stored.</p>'
      +     '<div class="gleame-skin-foot">'
      +       '<span>Powered by Gleame</span>'
      +       '<a data-report-link href="#" aria-disabled="true" tabindex="-1">Report a bad analysis</a>'
      +     '</div>'
      +   '</div>'
      +   '<div class="gleame-skin-card" data-pane="result">'
      +     renderPlaceholderResult()
      +   '</div>'
      + '</div>';
  }

  function setResultPaneHTML(container, html) {
    var pane = container.querySelector('[data-pane="result"]');
    if (pane) pane.innerHTML = html;
    return pane;
  }

  // ------------------------------------------------------------
  // Loading state — Stage 2 layout.
  //
  // The loading affordance lives on the LEFT pane: the photo gets a
  // scanning-line overlay, and the CTA slot is replaced with a status row
  // (pulsing dot + rotating message). The right pane stays in placeholder
  // mode the whole time, so the layout never collapses to a spinner.
  //
  // Returns a stop function that the caller invokes when the request
  // settles (success, error, or rejected).
  // ------------------------------------------------------------
  function showLoading(container) {
    var thumb = container.querySelector('.gleame-skin-thumb');
    if (thumb) {
      thumb.classList.add('is-scanning');
      // Idempotent: only inject the scanner element once per scan cycle.
      if (!thumb.querySelector('.gleame-skin-scanner')) {
        var scanner = document.createElement('div');
        scanner.className = 'gleame-skin-scanner';
        thumb.appendChild(scanner);
      }
    }

    var ctaSlot = container.querySelector('[data-cta-slot]');
    var ctaPrev = ctaSlot ? ctaSlot.innerHTML : null;
    if (ctaSlot) {
      ctaSlot.innerHTML = ''
        + '<div class="gleame-skin-loading-row" role="status" aria-live="polite">'
        +   '<div class="gleame-skin-loading-dot" aria-hidden="true"></div>'
        +   '<div class="gleame-skin-loading-text" data-loading-msg></div>'
        + '</div>';
    }

    var msgEl = container.querySelector('[data-loading-msg]');
    var stopRotator = msgEl ? startLoadingRotator(msgEl) : function () {};

    return function stop() {
      stopRotator();
      var t = container.querySelector('.gleame-skin-thumb');
      if (t) {
        t.classList.remove('is-scanning');
        var s = t.querySelector('.gleame-skin-scanner');
        if (s) s.parentNode.removeChild(s);
      }
      var slot = container.querySelector('[data-cta-slot]');
      if (slot && ctaPrev != null) slot.innerHTML = ctaPrev;
    };
  }

  function showError(container, message) {
    setResultPaneHTML(container, ''
      + '<div class="gleame-skin-error">' + escapeHtml(message) + '</div>'
      + renderPlaceholderResult());
  }

  function showResult(container, data) {
    var typeBadge = data.skin_type
      ? '<div class="gleame-skin-typebadge">' + escapeHtml(readableSkinType(data.skin_type)) + '</div>'
      : '';
    var radar = '<div class="gleame-skin-radar-wrap">' + renderRadar(data.scores || {}) + '</div>';
    var bars = renderBars(data.scores || {});
    var notes = data.notes ? '<div class="gleame-skin-notes">' + escapeHtml(data.notes) + '</div>' : '';
    var recs = renderRecommendations(data.recommendations || []);
    setResultPaneHTML(container, typeBadge + radar + bars + notes + recs);
    // Stash result for the report-bad link.
    container.__gleameLastResult = data;
  }

  function showRejected(container, reason) {
    var msg = reason === 'not_a_face'
      ? "We couldn't see a clear face in that photo. Try one with your face centered."
      : reason === 'multiple_faces'
        ? "We saw more than one face. Please upload a photo of just yourself."
        : reason === 'low_quality'
          ? "The photo was a little too blurry. Try one in better light."
          : reason === 'obstructed'
            ? "Something's blocking the view of your skin. Try without a mask, glasses, or heavy makeup."
            : "We couldn't analyze that photo. Try another one.";
    setResultPaneHTML(container, ''
      + '<div class="gleame-skin-error">' + escapeHtml(msg) + '</div>'
      + renderPlaceholderResult());
  }

  // ------------------------------------------------------------
  // Wire up one instance.
  // ------------------------------------------------------------
  function initInstance(container) {
    if (container.getAttribute('data-gleame-init') === '1') return;
    container.setAttribute('data-gleame-init', '1');

    // Page-type guard: refuse to render on product/collection pages unless
    // the merchant has explicitly opted in. Prevents the widget from leaking
    // onto every product page when the snippet is pasted into a global section.
    if (isBlockedPage() && container.getAttribute('data-gleame-allow-anywhere') == null) {
      container.style.display = 'none';
      return;
    }

    var shopDomain = container.getAttribute('data-shop')
      || (window.Shopify && window.Shopify.shop)
      || '';
    if (!shopDomain) {
      console.warn('[gleame-skin] No data-shop attribute and no window.Shopify.shop; widget cannot run.');
      container.style.display = 'none';
      return;
    }

    injectCSS();
    renderShell(container, shopDomain);

    var fileInput = container.querySelector('[data-file-input]');
    var dropEl = container.querySelector('[data-drop]');
    var thumbEl = container.querySelector('[data-thumb]');
    var analyzeBtn = container.querySelector('[data-analyze]');
    var reportLink = container.querySelector('[data-report-link]');
    var cameraBtn = container.querySelector('[data-camera]');
    var cameraInput = container.querySelector('[data-camera-input]');
    var orDivider = container.querySelector('[data-or-divider]');
    var selectedFile = null;

    function setSelected(file) {
      selectedFile = file;
      analyzeBtn.disabled = !file;
      // Reset CTA copy whenever the user picks a fresh photo so the button
      // never says "Try another photo" while pointing at a brand-new file.
      analyzeBtn.textContent = 'Analyze my skin';
      // Clear stale results — avoids showing the previous person's skin
      // profile while the new analysis is running.
      resetResultPane();
      if (!file) {
        thumbEl.innerHTML = '';
        // No photo: bring the drop zone + camera button back.
        dropEl.style.display = '';
        if (cameraBtn) cameraBtn.style.display = '';
        if (orDivider) orDivider.style.display = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function (ev) {
        thumbEl.innerHTML = ''
          + '<div class="gleame-skin-thumb" role="button" tabindex="0" aria-label="Replace photo">'
          +   '<img alt="Your photo preview" src="' + ev.target.result + '"/>'
          +   '<span class="gleame-skin-thumb-swap">Click to change</span>'
          + '</div>';
      };
      reader.readAsDataURL(file);
      // Photo selected: hide the drop zone + camera button so only the photo
      // shows. Clicking the photo (handler below) reopens the file picker.
      dropEl.style.display = 'none';
      if (cameraBtn) cameraBtn.style.display = 'none';
      if (orDivider) orDivider.style.display = 'none';
    }

    function resetResultPane() {
      setResultPaneHTML(container, renderPlaceholderResult());
    }

    function setReportEnabled(on) {
      if (on) {
        reportLink.removeAttribute('aria-disabled');
        reportLink.removeAttribute('tabindex');
      } else {
        reportLink.setAttribute('aria-disabled', 'true');
        reportLink.setAttribute('tabindex', '-1');
      }
    }

    fileInput.addEventListener('change', function (e) {
      var f = (e.target.files && e.target.files[0]) || null;
      setSelected(f);
    });

    // "Take a photo": desktop opens the webcam modal; mobile / no-getUserMedia
    // falls through to the native capture-hinted file input.
    if (cameraBtn) {
      cameraBtn.addEventListener('click', function () {
        if (camIsMobile() || !camHasGetUserMedia()) {
          if (cameraInput) cameraInput.click();
          return;
        }
        openSkinCamera(
          function (file) { setSelected(file); },
          function () { fileInput.click(); }
        );
      });
    }
    if (cameraInput) {
      cameraInput.addEventListener('change', function (e) {
        var f = (e.target.files && e.target.files[0]) || null;
        if (f) setSelected(f);
      });
    }

    // Click on the photo (after upload) reopens the file picker so the user
    // can swap photos without us needing the drop zone visible. Ignored
    // while a scan is in flight so they can't swap mid-analysis.
    thumbEl.addEventListener('click', function (e) {
      var thumb = e.target.closest && e.target.closest('.gleame-skin-thumb');
      if (!thumb) return;
      if (thumb.classList.contains('is-scanning')) return;
      fileInput.click();
    });
    thumbEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var thumb = e.target.closest && e.target.closest('.gleame-skin-thumb');
      if (!thumb) return;
      if (thumb.classList.contains('is-scanning')) return;
      e.preventDefault();
      fileInput.click();
    });

    // Drag and drop
    ['dragenter', 'dragover'].forEach(function (evt) {
      dropEl.addEventListener(evt, function (e) {
        e.preventDefault();
        dropEl.classList.add('is-dragging');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      dropEl.addEventListener(evt, function (e) {
        e.preventDefault();
        dropEl.classList.remove('is-dragging');
      });
    });
    dropEl.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setSelected(f);
    });

    // Click handler is bound to the container (delegated) because the CTA
    // slot's innerHTML is replaced during loading — the original button node
    // is destroyed and recreated, so a direct listener on the original would
    // not survive. Delegation keeps Analyze working across the loading cycle.
    container.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-analyze]');
      if (!btn) return;
      if (!selectedFile) return;
      if (btn.disabled) return;
      btn.disabled = true;

      var stopLoading = showLoading(container);

      var fd = new FormData();
      fd.append('image', selectedFile);
      fd.append('shopDomain', shopDomain);

      fetch(APP_URL + '/api/storefront/analyze-skin', { method: 'POST', body: fd })
        .then(function (res) {
          // 404 means feature not enabled. Hide the widget silently — the
          // merchant pasted the snippet on a non-allowlisted shop, no point
          // showing them a confusing error.
          if (res.status === 404) {
            container.style.display = 'none';
            return null;
          }
          return res.json().then(function (body) { return { status: res.status, body: body }; });
        })
        .then(function (out) {
          stopLoading();
          if (!out) return;
          // Re-resolve the analyze button — it was destroyed/recreated when
          // showLoading swapped the CTA slot back in.
          var freshBtn = container.querySelector('[data-analyze]');
          if (out.status >= 400) {
            showError(container, (out.body && out.body.error) || 'Something went wrong. Please try again.');
            if (freshBtn) freshBtn.disabled = false;
            return;
          }
          var data = out.body;
          if (data.rejected) {
            showRejected(container, data.reason);
            if (freshBtn) freshBtn.disabled = false;
            return;
          }
          showResult(container, data);
          setReportEnabled(true);
          if (freshBtn) {
            freshBtn.disabled = false;
            freshBtn.textContent = 'Try another photo';
          }
        })
        .catch(function (err) {
          stopLoading();
          console.error('[gleame-skin] request failed:', err);
          showError(container, 'Connection problem. Please try again in a moment.');
          var freshBtn = container.querySelector('[data-analyze]');
          if (freshBtn) freshBtn.disabled = false;
        });
    });

    // "Report a bad analysis" — POSTs the analysis JSON (no photo, no
    // identifier) to the report endpoint, which logs it server-side as a
    // free in-the-wild fairness signal.
    reportLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (reportLink.getAttribute('aria-disabled') === 'true') return;
      var last = container.__gleameLastResult;
      if (!last) return;
      var reason = window.prompt('Tell us what felt off (e.g. wrong skin type, scores too high/low):', '');
      if (reason === null) return; // user cancelled
      reportLink.textContent = 'Sending…';
      fetch(APP_URL + '/api/storefront/report-skin-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: shopDomain,
          reason: reason || '',
          analysis: last,
        }),
      })
        .then(function (res) {
          reportLink.textContent = res.ok ? 'Thanks for the report' : 'Could not send — try again';
        })
        .catch(function () {
          reportLink.textContent = 'Could not send — try again';
        });
    });
  }

  function initAll() {
    var nodes = document.querySelectorAll('#gleame-skin-analysis, [data-gleame-skin-analysis]');
    for (var i = 0; i < nodes.length; i++) initInstance(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
