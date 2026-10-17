// Realistic storefront homepages for the homepage-parsing tests. DAWN mirrors
// what Dawn 15 renders (meta-tags snippet, inline font vars and color
// schemes, image banner, featured collection, rich text, footer, the
// content_for_header scripts); CLASSIC is an older non-Dawn theme that inlines
// its CSS (h1 and button rules, no font custom properties) with uppercase
// tags, lazy images and content-before-property og tags; heavyStorefront()
// is a 3.5 MB page with the shapes saved beauty homepages of 1 to 3.3 MB
// showed (see its comment).

const CDN = "//glow-lab.com/cdn/shop";

const srcset = (file: string, widths: number[]) =>
  widths.map((w) => `${CDN}/files/${file}?v=1712345678&width=${w} ${w}w`).join(", ");

const productCard = (handle: string, title: string, file: string, price: string) => `
<li class="grid__item scroll-trigger animate--slide-in" data-cascade style="--animation-order: 1;">
  <div class="card-wrapper product-card-wrapper underline-links-hover">
    <div class="card card--standard card--media" style="--ratio-percent: 125.0%;">
      <div class="card__inner color-scheme-2 gradient ratio" style="--ratio-percent: 125.0%;">
        <div class="card__media">
          <div class="media media--transparent media--hover-effect">
            <img
              srcset="${srcset(file, [165, 360, 533, 720, 940, 1066])}, ${CDN}/files/${file}?v=1712345678 1080w"
              src="${CDN}/files/${file}?v=1712345678&width=533"
              sizes="(min-width: 1200px) 267px, (min-width: 990px) calc((100vw - 130px) / 4), (min-width: 750px) calc((100vw - 120px) / 3), calc((100vw - 35px) / 2)"
              alt="${title}"
              class="motion-reduce"
              loading="lazy"
              width="1080"
              height="1350"
            >
          </div>
        </div>
      </div>
      <div class="card__content">
        <div class="card__information">
          <h3 class="card__heading h5" id="title-template--1__featured_collection-${handle}">
            <a href="/products/${handle}" class="full-unstyled-link">${title}</a>
          </h3>
          <div class="price">
            <span class="price-item price-item--regular">${price}</span>
          </div>
        </div>
        <div class="quick-add no-js-hidden">
          <product-form data-section-id="template--1__featured_collection">
            <form method="post" action="/cart/add" accept-charset="UTF-8" class="form" enctype="multipart/form-data" novalidate="novalidate" data-type="add-to-cart-form">
              <input type="hidden" name="form_type" value="product" /><input type="hidden" name="utf8" value="✓" />
              <input type="hidden" name="id" value="4471234567${handle.length}" class="product-variant-id">
              <button id="quick-add-${handle}-submit" type="submit" name="add" class="quick-add__submit button button--full-width button--secondary" aria-haspopup="dialog">
                <span>Add to cart</span>
                <div class="loading__spinner hidden">
                  <svg aria-hidden="true" focusable="false" class="spinner" viewBox="0 0 66 66" xmlns="http://www.w3.org/2000/svg"><circle class="path" fill="none" stroke-width="6" cx="33" cy="33" r="30"></circle></svg>
                </div>
              </button>
            </form>
          </product-form>
        </div>
      </div>
    </div>
  </div>
</li>`;

export const DAWN = `<!doctype html>
<html class="js" lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="theme-color" content="">
    <link rel="canonical" href="https://glow-lab.com/">
    <link rel="preconnect" href="https://fonts.shopifycdn.com" crossorigin>
    <title>Glow Lab &ndash; Clean skincare &amp; color</title>
    <meta name="description" content="Clean, cruelty-free skincare and color made for every skin tone. Free shipping over $50.">

<meta property="og:site_name" content="Glow Lab">
<meta property="og:url" content="https://glow-lab.com/">
<meta property="og:title" content="Glow Lab">
<meta property="og:type" content="website">
<meta property="og:description" content="Clean, cruelty-free skincare and color made for every skin tone. Free shipping over $50."><meta property="og:image" content="http://glow-lab.com/cdn/shop/files/social-share.jpg?v=1712345678">
  <meta property="og:image:secure_url" content="https://glow-lab.com/cdn/shop/files/social-share.jpg?v=1712345678">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="628"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Glow Lab">
<meta name="twitter:description" content="Clean, cruelty-free skincare and color made for every skin tone. Free shipping over $50.">

    <script src="${CDN}/t/12/assets/constants.js?v=132983761750457495441712345678" defer="defer"></script>
    <script src="${CDN}/t/12/assets/pubsub.js?v=158357773527763999511712345678" defer="defer"></script>
    <script src="${CDN}/t/12/assets/global.js?v=88558128918567037191712345678" defer="defer"></script>
    <script>window.performance && window.performance.mark && window.performance.mark('shopify.content_for_header.start');</script><meta id="shopify-digital-wallet" name="shopify-digital-wallet" content="/61234567890/digital_wallets/dialog">
<script async="async" src="/checkouts/internal/preloads.js?locale=en-US"></script>
<script id="shopify-features" type="application/json">{"accessToken":"0f1e2d3c4b5a69788796a5b4c3d2e1f0","betas":["rich-media-storefront-analytics"],"domain":"glow-lab.com","predictiveSearch":true,"shopId":61234567890,"locale":"en"}</script>
<script>var Shopify = Shopify || {};
Shopify.shop = "glow-lab.myshopify.com";
Shopify.locale = "en";
Shopify.currency = {"active":"USD","rate":"1.0"};
Shopify.country = "US";
Shopify.theme = {"name":"Dawn","id":134567890123,"schema_name":"Dawn","schema_version":"15.0.0","theme_store_id":887,"role":"main"};
Shopify.theme.handle = "null";
Shopify.theme.style = {"id":null,"handle":null};
Shopify.cdnHost = "glow-lab.com/cdn";
Shopify.routes = Shopify.routes || {};
Shopify.routes.root = "/";
(function () { var el = document.querySelector('h1'); if (el && el.dataset.btn) { el.style.borderRadius = '4px'; } })();</script>
<script type="module">!function(o){(o.Shopify=o.Shopify||{}).modules=!0}(window);</script>
<script>(function() {
  var isLoaded = false;
  function asyncLoad() {
    if (isLoaded) return;
    isLoaded = true;
    var urls = ["https:\\/\\/cdn.reviews.example\\/widget.js?shop=glow-lab.myshopify.com"];
    for (var i = 0; i < urls.length; i++) {
      var s = document.createElement('script');
      s.type = 'text/javascript'; s.async = true; s.src = urls[i];
      var x = document.getElementsByTagName('script')[0];
      x.parentNode.insertBefore(s, x);
    }
  };
  if(window.attachEvent) { window.attachEvent('onload', asyncLoad); } else { window.addEventListener('load', asyncLoad, false); }
})();</script>
<script id="web-pixels-manager-setup">(function e(e,d,r,n,o){if(void 0===o&&(o={}),!Boolean(null===(t=null===(i=window.Shopify)||void 0===i?void 0:i.analytics)||void 0===t?void 0:t.replayQueue)){var i,t;window.Shopify=window.Shopify||{};}})(null,null,"https://glow-lab.com/cdn","sha384-abc","1.0");</script>
<script>window.performance && window.performance.mark && window.performance.mark('shopify.content_for_header.end');</script>

    <style data-shopify>
      @font-face {
  font-family: Assistant;
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  src: url("//glow-lab.com/cdn/fonts/assistant/assistant_n4.9120912a469cad1cc292572851508ca49d12e768.woff2") format("woff2"),
       url("//glow-lab.com/cdn/fonts/assistant/assistant_n4.6e9875ce64e0fefcd3f4446b7ec9036b3ddd2985.woff") format("woff");
}
      @font-face {
  font-family: "Playfair Display";
  font-weight: 700;
  font-style: normal;
  font-display: swap;
  src: url("//glow-lab.com/cdn/fonts/playfair_display/playfairdisplay_n7.woff2") format("woff2");
}

      :root {
        --font-body-family: Assistant, sans-serif;
        --font-body-style: normal;
        --font-body-weight: 400;
        --font-body-weight-bold: 700;

        --font-heading-family: "Playfair Display", serif;
        --font-heading-style: normal;
        --font-heading-weight: 700;

        --font-body-scale: 1.0;
        --font-heading-scale: 1.0;

        --color-base-text: #2b1d1a;
        --color-base-background-1: #fbf6f2;
        --color-base-accent-1: #c8553d;
        --color-base-accent-2: #f2c4b8;

        --page-width: 120rem;
        --page-width-margin: 0rem;

        --buttons-radius: 6px;
        --buttons-radius-outset: 7px;
        --buttons-border-width: 1px;
        --buttons-border-opacity: 1.0;
        --buttons-shadow-opacity: 0.0;
        --inputs-radius: 0px;
      }

      :root,
      .color-scheme-1 {
        --color-background: 251,246,242;
        --gradient-background: #fbf6f2;
        --color-foreground: 43,29,26;
        --color-button: 200,85,61;
        --color-button-text: 255,255,255;
      }
      .color-scheme-2 {
        --color-background: 242,196,184;
        --gradient-background: #f2c4b8;
        --color-foreground: 43,29,26;
        --color-button: 43,29,26;
      }

      body, .color-scheme-1, .color-scheme-2 {
        color: rgba(var(--color-foreground), 0.75);
        background-color: rgb(var(--color-background));
      }

      *, *::before, *::after { box-sizing: inherit; }
      html { box-sizing: border-box; font-size: calc(var(--font-body-scale) * 62.5%); height: 100%; }
      body {
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        grid-template-columns: 100%;
        min-height: 100%;
        margin: 0;
        font-size: 1.5rem;
        letter-spacing: 0.06rem;
        line-height: calc(1 + 0.8 / var(--font-body-scale));
        font-family: var(--font-body-family);
        font-style: var(--font-body-style);
        font-weight: var(--font-body-weight);
      }
    </style>

    <link href="${CDN}/t/12/assets/base.css?v=144968985024194912401712345678" rel="stylesheet" type="text/css" media="all" />
    <link rel="preload" as="font" href="//glow-lab.com/cdn/fonts/assistant/assistant_n4.woff2" type="font/woff2" crossorigin>
    <script>document.documentElement.className = document.documentElement.className.replace('no-js', 'js');
    if (Shopify.designMode) { document.documentElement.classList.add('shopify-design-mode'); }</script>
  </head>

  <body class="gradient animate--hover-default">
    <a class="skip-to-content-link button visually-hidden" href="#MainContent">Skip to content</a>

<link href="${CDN}/t/12/assets/quantity-popover.css?v=1" rel="stylesheet" type="text/css" media="all" />
<script src="${CDN}/t/12/assets/cart.js?v=1" defer="defer"></script>

<style>
  .drawer { visibility: hidden; }
</style>

<cart-drawer class="drawer is-empty">
  <div id="CartDrawer" class="cart-drawer">
    <div id="CartDrawer-Overlay" class="cart-drawer__overlay"></div>
    <div class="drawer__inner gradient color-scheme-1" role="dialog" aria-modal="true" aria-label="Your cart" tabindex="-1">
      <div class="drawer__inner-empty">
        <div class="cart-drawer__warnings center">
          <div class="cart-drawer__empty-content">
            <h2 class="cart__empty-text">Your cart is empty</h2>
            <button class="drawer__close" type="button" onclick="this.closest('cart-drawer').close()" aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" class="icon icon-close" fill="none" viewBox="0 0 18 17"><path d="M.865 15.978a.5.5 0 00.707.707l7.433-7.431 7.579 7.282a.501.501 0 00.846-.37.5.5 0 00-.153-.351L9.712 8.546l7.417-7.416a.5.5 0 10-.707-.708L8.991 7.853 1.413.573a.5.5 0 10-.693.72l7.563 7.268-7.418 7.417z" fill="currentColor"></path></svg>
            </button>
            <a href="/collections/all" class="button">Continue shopping</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</cart-drawer>

<!-- BEGIN sections: header-group -->
<div id="shopify-section-sections--1__announcement-bar" class="shopify-section shopify-section-group-header-group announcement-bar-section"><div class="utility-bar color-scheme-2 gradient">
  <div class="page-width utility-bar__grid">
    <div class="announcement-bar" role="region" aria-label="Announcement">
      <p class="announcement-bar__message h5"><span>Free shipping on orders over $50</span></p>
    </div>
  </div>
</div>
</div><div id="shopify-section-sections--1__header" class="shopify-section shopify-section-group-header-group section-header"><link rel="stylesheet" href="${CDN}/t/12/assets/component-list-menu.css?v=1" media="print" onload="this.media='all'">
<style>
  header-drawer { justify-self: start; margin-left: -1.2rem; }
  .header__heading-logo { max-width: 90px; }
  @media screen and (min-width: 990px) { header-drawer { display: none; } }
  .menu-drawer-container { display: flex; }
  .list-menu { list-style: none; padding: 0; margin: 0; }
</style>
<style data-shopify>.header { padding: 10px 3rem 10px 3rem; }
  .section-header { position: sticky; margin-bottom: 0px; }
  @media screen and (min-width: 750px) { .section-header { margin-bottom: 0px; } }
</style>
<sticky-header data-sticky-type="on-scroll-up" class="header-wrapper color-scheme-1 gradient header-wrapper--border-bottom">
  <header class="header header--middle-left header--mobile-center page-width header--has-menu header--has-social header--has-account">
    <header-drawer data-breakpoint="tablet">
      <details id="Details-menu-drawer-container" class="menu-drawer-container">
        <summary class="header__icon header__icon--menu header__icon--summary link focus-inset" aria-label="Menu">
          <span>
            <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" class="icon icon-hamburger" fill="none" viewBox="0 0 18 16"><path d="M1 .5a.5.5 0 100 1h15.71a.5.5 0 000-1H1zM.5 8a.5.5 0 01.5-.5h15.71a.5.5 0 010 1H1A.5.5 0 01.5 8zm0 7a.5.5 0 01.5-.5h15.71a.5.5 0 010 1H1a.5.5 0 01-.5-.5z" fill="currentColor"></path></svg>
          </span>
        </summary>
      </details>
    </header-drawer>
    <h1 class="header__heading">
      <a href="/" class="header__heading-link link link--text focus-inset"><div class="header__heading-logo-wrapper">
        <img src="${CDN}/files/glow-lab-logo.png?v=1712345678&amp;width=600" alt="Glow Lab" srcset="${srcset("glow-lab-logo.png", [90, 135, 180])}" width="90" height="28.0" loading="eager" class="header__heading-logo motion-reduce" sizes="(max-width: 180px) 50vw, 90px">
      </div></a>
    </h1>
    <nav class="header__inline-menu">
      <ul class="list-menu list-menu--inline" role="list">
        <li><a id="HeaderMenu-home" href="/" class="header__menu-item list-menu__item link link--text focus-inset" aria-current="page"><span class="header__active-menu-item">Home</span></a></li>
        <li><a id="HeaderMenu-skincare" href="/collections/skincare" class="header__menu-item list-menu__item link link--text focus-inset"><span>Skincare</span></a></li>
        <li><a id="HeaderMenu-color" href="/collections/color" class="header__menu-item list-menu__item link link--text focus-inset"><span>Color</span></a></li>
        <li><a id="HeaderMenu-about" href="/pages/about" class="header__menu-item list-menu__item link link--text focus-inset"><span>Our story</span></a></li>
      </ul>
    </nav>
    <div class="header__icons header__icons--localization header-localization">
      <details-modal class="header__search">
        <details>
          <summary class="header__icon header__icon--search header__icon--summary link focus-inset modal__toggle" aria-haspopup="dialog" aria-label="Search">
            <span><svg class="modal__toggle-open icon icon-search" aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></span>
          </summary>
        </details>
      </details-modal>
      <a href="/account/login" class="header__icon header__icon--account link focus-inset small-hide"><span class="visually-hidden">Log in</span></a>
      <a href="/cart" class="header__icon header__icon--cart link focus-inset" id="cart-icon-bubble"><span class="visually-hidden">Cart</span></a>
    </div>
  </header>
</sticky-header>
<script type="application/ld+json">
  {
    "@context": "http://schema.org",
    "@type": "Organization",
    "name": "Glow Lab",
    "logo": "https:\\/\\/glow-lab.com\\/cdn\\/shop\\/files\\/glow-lab-logo.png?v=1712345678\\u0026width=500",
    "sameAs": ["https:\\/\\/instagram.com\\/glowlab", "https:\\/\\/tiktok.com\\/@glowlab"],
    "url": "https:\\/\\/glow-lab.com"
  }
</script>
<script type="application/ld+json">
  {
    "@context": "http://schema.org",
    "@type": "WebSite",
    "name": "Glow Lab",
    "potentialAction": { "@type": "SearchAction", "target": "https:\\/\\/glow-lab.com\\/search?q={search_term_string}", "query-input": "required name=search_term_string" },
    "url": "https:\\/\\/glow-lab.com"
  }
</script>
</div>
<!-- END sections: header-group -->

    <main id="MainContent" class="content-for-layout focus-none" role="main" tabindex="-1">
      <section id="shopify-section-template--1__image_banner" class="shopify-section section"><link href="${CDN}/t/12/assets/section-image-banner.css?v=1" rel="stylesheet" type="text/css" media="all" />
<style data-shopify>@media screen and (max-width: 749px) {
    #Banner-template--1__image_banner::before,
    #Banner-template--1__image_banner .banner__media::before,
    #Banner-template--1__image_banner:not(.banner--mobile-bottom) .banner__content::before {
      padding-bottom: 56.25%;
      content: '';
      display: block;
    }
  }
  #Banner-template--1__image_banner::after { opacity: 0.2; }
</style>
<div id="Banner-template--1__image_banner" class="banner banner--content-align-center banner--content-align-mobile-center banner--adapt banner--mobile-bottom scroll-trigger animate--fade-in">
  <div class="banner__media media scroll-trigger animate--fade-in">
    <img src="${CDN}/files/hero-glow.jpg?v=1712345678&amp;width=3840" alt="Model wearing Glow Lab tinted balm" srcset="${srcset("hero-glow.jpg", [375, 550, 750, 1100, 1500, 1780, 2000, 3000, 3840])}" width="3840" height="2160.0" sizes="100vw" fetchpriority="high">
  </div>
  <div class="banner__content banner__content--bottom-center page-width scroll-trigger animate--slide-in">
    <div class="banner__box content-container content-container--full-width-mobile color-scheme-1 gradient">
      <h2 class="banner__heading inline-richtext h0">Glow, naturally.</h2>
      <div class="banner__text rte" ><p>Clean formulas that let your skin show through. Shades for every undertone.</p></div>
      <div class="banner__buttons">
        <a href="/collections/all" class="button button--secondary">Shop the collection</a>
      </div>
    </div>
  </div>
</div>
</section><section id="shopify-section-template--1__featured_collection" class="shopify-section section"><style data-shopify>.section-template--1__featured_collection-padding { padding-top: 27px; padding-bottom: 27px; }
  @media screen and (min-width: 750px) { .section-template--1__featured_collection-padding { padding-top: 36px; padding-bottom: 36px; } }
</style>
<div class="color-scheme-1 isolate gradient">
  <div class="collection section-template--1__featured_collection-padding" id="collection-template--1__featured_collection" data-id="template--1__featured_collection">
    <div class="collection__title title-wrapper title-wrapper--no-top-margin page-width">
      <h2 class="title inline-richtext h2 scroll-trigger animate--slide-in">Bestsellers</h2>
      <div class="collection__description body rte scroll-trigger animate--slide-in"><p>The formulas our community reorders most.</p></div>
    </div>
    <slider-component class="slider-mobile-gutter page-width page-width-desktop scroll-trigger animate--slide-in">
      <ul id="Slider-template--1__featured_collection" class="grid product-grid contains-card contains-card--product grid--4-col-desktop grid--2-col-tablet-down" role="list" aria-label="Slider">
        ${productCard("tinted-lip-oil", "Tinted Lip Oil", "lip-oil-rose.jpg", "$22.00")}
        ${productCard("glow-serum", "Glow Serum", "glow-serum.jpg", "$38.00")}
        ${productCard("cream-blush", "Cream Blush Stick", "blush-stick-peony.jpg", "$26.00")}
        ${productCard("skin-tint", "Skin Tint SPF 30", "skin-tint-medium.jpg", "$34.00")}
      </ul>
    </slider-component>
    <div class="center collection__view-all scroll-trigger animate--slide-in">
      <a href="/collections/bestsellers" class="button" aria-labelledby="ViewAll-template--1__featured_collection">View all</a>
    </div>
  </div>
</div>
</section><section id="shopify-section-template--1__rich_text" class="shopify-section section"><link href="${CDN}/t/12/assets/component-rte.css?v=1" rel="stylesheet" type="text/css" media="all" />
<style data-shopify>.section-template--1__rich_text-padding { padding-top: 30px; padding-bottom: 39px; }</style>
<div class="isolate">
  <div class="rich-text content-container color-scheme-2 gradient rich-text--full-width content-container--full-width section-template--1__rich_text-padding">
    <div class="rich-text__wrapper rich-text__wrapper--center page-width">
      <div class="rich-text__blocks center">
        <h2 class="rich-text__heading rte inline-richtext h1 scroll-trigger animate--slide-in">Made for every shade</h2>
        <div class="rich-text__text rte scroll-trigger animate--slide-in"><p>We test every formula on 40+ skin tones before it ships &mdash; <strong>vegan</strong>, cruelty-free and dermatologist tested.</p></div>
        <a href="/pages/about" class="button button--primary">Read our story</a>
      </div>
    </div>
  </div>
</div>
</section><section id="shopify-section-template--1__image_with_text" class="shopify-section section"><div class="image-with-text image-with-text--no-overlap page-width isolate">
  <div class="image-with-text__grid grid grid--gapless grid--1-col grid--2-col-tablet">
    <div class="image-with-text__media-item image-with-text__media-item--medium grid__item">
      <div class="image-with-text__media image-with-text__media--adapt gradient color-scheme-1 global-media-settings media">
        <img src="${CDN}/files/texture-swatches.jpg?v=1712345678&amp;width=1500" alt="Texture swatches" srcset="${srcset("texture-swatches.jpg", [165, 360, 535, 750, 1070, 1500])}" width="1500" height="1500" loading="lazy" sizes="(min-width: 1200px) 550px, (min-width: 750px) calc((100vw - 130px) / 2), calc((100vw - 50px) / 2)">
      </div>
    </div>
    <div class="image-with-text__text-item grid__item">
      <div class="image-with-text__content image-with-text__content--middle image-with-text__content--desktop-left image-with-text__content--mobile-left image-with-text__content--adapt content-container color-scheme-1 gradient">
        <h2 class="image-with-text__heading inline-richtext h2">Feel the formula</h2>
        <div class="image-with-text__text rte body"><p>Weightless textures that melt in and wear all day.</p></div>
        <a href="/collections/skincare" class="button button--primary">Shop skincare</a>
      </div>
    </div>
  </div>
</div>
</section><section id="shopify-section-template--1__newsletter" class="shopify-section section"><div class="newsletter center">
  <div class="newsletter__wrapper color-scheme-2 gradient content-container isolate content-container--full-width">
    <h2 class="inline-richtext h2">Join the glow list</h2>
    <div class="newsletter__subheading rte"><p>Early access to launches and 10% off your first order.</p></div>
    <form method="post" action="/contact#contact_form" id="ContactForm" accept-charset="UTF-8" class="newsletter-form"><input type="hidden" name="form_type" value="customer" /><input type="hidden" name="utf8" value="✓" />
      <input type="hidden" name="contact[tags]" value="newsletter">
      <div class="newsletter-form__field-wrapper">
        <div class="field">
          <input id="NewsletterForm--template--1__newsletter" type="email" name="contact[email]" class="field__input" value="" aria-required="true" autocorrect="off" autocapitalize="off" autocomplete="email" placeholder="Email" required>
          <label class="field__label" for="NewsletterForm--template--1__newsletter">Email</label>
          <button type="submit" class="newsletter-form__button field__button" name="commit" aria-label="Subscribe"><svg class="icon icon-arrow" aria-hidden="true" focusable="false"><use href="#icon-arrow"></use></svg></button>
        </div>
      </div>
    </form>
  </div>
</div>
</section>
    </main>

    <!-- BEGIN sections: footer-group -->
<div id="shopify-section-sections--1__footer" class="shopify-section shopify-section-group-footer-group"><style data-shopify>.footer { margin-top: 0px; }
  .section-sections--1__footer-padding { padding-top: 27px; padding-bottom: 27px; }
</style>
<footer class="footer color-scheme-1 gradient section-sections--1__footer-padding">
  <div class="footer__content-top page-width">
    <div class="footer__blocks-wrapper grid grid--1-col grid--2-col grid--4-col-tablet scroll-trigger animate--slide-in">
      <div class="footer-block grid__item footer-block--menu">
        <h2 class="footer-block__heading inline-richtext">Help</h2>
        <ul class="footer-block__details-content list-unstyled">
          <li><a href="/pages/shipping" class="link link--text list-menu__item list-menu__item--link">Shipping &amp; returns</a></li>
          <li><a href="/pages/faq" class="link link--text list-menu__item list-menu__item--link">FAQ</a></li>
        </ul>
      </div>
    </div>
  </div>
  <div class="footer__content-bottom">
    <div class="footer__copyright caption">
      <small class="copyright__content">&copy; 2026, <a href="/" title="">Glow Lab</a></small>
      <small class="copyright__content"><a target="_blank" rel="nofollow" href="https://www.shopify.com?utm_campaign=poweredby&amp;utm_medium=shopify&amp;utm_source=onlinestore">Powered by Shopify</a></small>
    </div>
  </div>
</footer>
</div>
<!-- END sections: footer-group -->

    <ul hidden>
      <li id="a11y-refresh-page-message">Choosing a selection results in a full page refresh.</li>
      <li id="a11y-new-window-message">Opens in a new window.</li>
    </ul>

    <script>
      window.shopUrl = 'https://glow-lab.com';
      window.routes = { cart_add_url: '/cart/add', cart_change_url: '/cart/change', cart_update_url: '/cart/update', cart_url: '/cart', predictive_search_url: '/search/suggest' };
      window.cartStrings = { error: \`There was an error while updating your cart. Please try again.\`, quantityError: \`You can only add [quantity] of this item to your cart.\` };
      window.variantStrings = { addToCart: \`Add to cart\`, soldOut: \`Sold out\`, unavailable: \`Unavailable\` };
      window.accessibilityStrings = { imageAvailable: \`Image [index] is now available in gallery view\`, shareSuccess: \`Link copied to clipboard\` };
    </script>
    <script src="${CDN}/t/12/assets/predictive-search.js?v=1" defer="defer"></script>
  </body>
</html>
`;

export const CLASSIC = `<!DOCTYPE html>
<HTML lang="en">
<HEAD>
  <META charset="utf-8">
  <title>Petal &amp; Pout</title>
  <meta content="https://cdn.shopify.com/s/files/1/0123/4567/files/og-petal.png?v=1650000000&amp;width=1200" property="og:image">
  <meta content="1200" property="og:image:width">
  <link rel="stylesheet" href="//cdn.shopify.com/s/files/1/0123/4567/t/3/assets/theme.scss.css?v=1">
  <SCRIPT type="text/javascript">
    var theme = { strings: { addToCart: "Add to cart" }, moneyFormat: "\${{amount}}" };
    document.documentElement.className += ' js';
  </SCRIPT>
  <style>
    @font-face { font-family: "Lora"; src: url(//cdn.shopify.com/s/files/1/0123/4567/t/3/assets/lora.woff2) format("woff2"); }
    body { font-family: "Karla", Helvetica, Arial, sans-serif; color: #3a3a3a; background: #FFF7F9; }
    h1, .h1, .section-header__title {
      font-family: "Lora", Georgia, serif;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #8e2c48;
    }
    h2, h3 { font-family: "Lora", Georgia, serif; }
    .btn, .shopify-payment-button__button--unbranded {
      display: inline-block;
      padding: 10px 22px;
      background-color: #8e2c48;
      color: #ffffff;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .btn--secondary { background: transparent; border: 1px solid #8e2c48; border-radius: 3px; }
    button.cart__checkout { border-radius: 24.5px; }
    .site-header { border-bottom: 1px solid #f1e3e7; }
  </style>
  <style>.announcement-bar { background-color: #8e2c48; color: #ffffff; }</style>
</HEAD>
<body id="petal-amp-pout" class="template-index">
  <div class="announcement-bar"><p class="announcement-bar__message">Bundle any 3 lip glosses and save 15%</p></div>
  <header class="site-header" role="banner">
    <h1 class="site-header__logo" itemscope itemtype="http://schema.org/Organization">
      <a href="/" itemprop="url" class="site-header__logo-image"><IMG SRC="//cdn.shopify.com/s/files/1/0123/4567/files/logo_250x.png?v=1650000000" ALT="Petal &amp; Pout" itemprop="logo"></a>
    </h1>
    <button type="button" class="btn--link site-header__icon site-header__menu js-mobile-nav-toggle mobile-nav--open" aria-controls="MobileNav" aria-expanded="false" aria-label="Menu">Menu</button>
  </header>
  <main role="main" id="MainContent">
    <div class="hero hero--large">
      <img class="hero__image lazyload" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="//cdn.shopify.com/s/files/1/0123/4567/files/hero-pout_{width}x.jpg?v=1650000000" data-widths="[180, 360, 540, 720, 900, 1080, 1296, 1512, 1728, 2048]" width="2048" alt="Gloss swatches">
      <div class="hero__inner"><h2 class="h1 hero__title">Pout-worthy shine</h2><p class="hero__subtitle">Non-sticky gloss in 12 sheer shades</p>
      <a href="/collections/gloss" class="btn hero__btn">Shop gloss</a></div>
    </div>
    <div class="feature-row">
      <img src="https://cdn.shopify.com/s/files/1/0123/4567/files/swatch-arm_1600x.jpg?v=1650000000" srcset="https://cdn.shopify.com/s/files/1/0123/4567/files/swatch-arm_800x.jpg?v=1650000000 800w, https://cdn.shopify.com/s/files/1/0123/4567/files/swatch-arm_1600x.jpg?v=1650000000 1600w" alt="Swatches on arm" width='1600' height='900'>
      <div class="feature-row__text"><h2>Swatch it first</h2><p>Every shade photographed on fair, medium and deep skin.</p></div>
    </div>
    <div class="grid grid--uniform">
      <div class="grid__item"><a href="/products/gloss-rose"><img src="//cdn.shopify.com/s/files/1/0123/4567/products/gloss-rose_300x.jpg?v=1650000000" alt="Rose gloss"><p>Rose Gloss</p><span class="price">$18</span></a></div>
      <div class="grid__item"><a href="/products/gloss-berry"><img src="//cdn.shopify.com/s/files/1/0123/4567/products/gloss-berry_300x.jpg?v=1650000000" alt="Berry gloss"><p>Berry Gloss</p><span class="price">$18</span></a></div>
    </div>
  </main>
  <footer class="site-footer"><p>&copy; 2026 Petal &amp; Pout. Price < $25 on every gloss.</p></footer>
  <script>window.addEventListener('load', function() { if (window.innerWidth < 750) { document.body.classList.add('mobile'); } });</script>
</body>
</HTML>
`;

export const PASSWORD_PAGE = `<!doctype html>
<html lang="en">
<head><title>Opening soon</title><meta property="og:image" content="https://glow-lab.com/cdn/shop/files/teaser.jpg"></head>
<body class="password gradient">
  <div class="password-main"><h1>Opening soon</h1><p>Be the first to know when we launch.</p>
  <img src="https://glow-lab.com/cdn/shop/files/teaser.jpg" width="2400"></div>
</body>
</html>
`;

const LUMEN = "//lumen-beauty.com/cdn/shop";

// A product card the way heavier themes print them: no inline CSS or JSON,
// so a run of cards is one long stretch of markup without a brace.
const lumenCard = (i: number) => `
<div class="product-card" data-product-id="${8812000 + i}">
  <a href="/products/shade-${i}" class="product-card__media">
    <img src="${LUMEN}/files/shade-${i}.jpg?v=1&amp;width=600" srcset="${LUMEN}/files/shade-${i}.jpg?v=1&amp;width=360 360w, ${LUMEN}/files/shade-${i}.jpg?v=1&amp;width=720 720w" width="720" height="900" loading="lazy" alt="Shade ${i}">
  </a>
  <p class="product-card__title">Velvet Lip Tint &ndash; Shade ${i}</p>
  <span class="price">$${18 + (i % 7)}.00</span>
  <button type="button" class="btn btn--quick-add" data-variant="${4400000 + i}">Quick add</button>
</div>`;

const lumenHero = (i: number) => `
<section class="hero" id="hero-${i}">
  <img src="${LUMEN}/files/campaign-${i}.jpg?v=1&amp;width=2400" srcset="${[600, 1200, 1800, 2400]
    .map((w) => `${LUMEN}/files/campaign-${i}.jpg?v=1&amp;width=${w} ${w}w`)
    .join(", ")}" width="2400" height="1350" alt="Campaign ${i}">
  <h2 class="hero__title h1">Look ${i}: soft-focus color</h2>
  <a class="button button--primary" href="/collections/look-${i}">Shop the look</a>
</section>
<style>#hero-${i} .hero__title { font-family: var(--font-display); letter-spacing: -0.01em; color: #1d1d1f; }
  #hero-${i} .button { background: #d63384; border-radius: ${i % 3 === 0 ? 0 : 24}px; }</style>`;

/**
 * 3.5 MB, with what made saved 1 to 3.3 MB beauty homepages parse
 * differently under a 1 MB cap or bounded regexes: a 1 MB inline catalog
 * script in <head> that pushes og:image past 1M characters, no font custom
 * properties, "h1" and "btn" in markup whose next "{" is 90 KB of product
 * cards later (the first h1 rule is reached through page text), and hero
 * images all the way down the page.
 */
export function heavyStorefront(): string {
  const catalog = Array.from(
    { length: 7600 },
    (_, i) =>
      `{"id":${8812000 + i},"title":"Velvet Lip Tint - Shade ${i}","handle":"shade-${i}","price":${1800 + (i % 7) * 100},"tags":["lip","tint","vegan"],"available":true}`
  ).join(",");
  const blocks = Array.from({ length: 25 }, (_, b) => {
    const cards = Array.from({ length: 150 }, (_, i) => lumenCard(b * 150 + i)).join("");
    const heroes = Array.from({ length: 4 }, (_, h) => lumenHero(b * 4 + h)).join("");
    return `
<div class="product-grid" id="grid-${b}">${cards}
</div>
<style>.product-grid { gap: 12px; font-family: inherit; border-radius: 18px; background: #fdf0f5; }</style>
${heroes}`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Lumen Beauty | Soft-focus color</title>
  <script>window.Lumen = window.Lumen || {}; window.Lumen.catalog = [${catalog}];</script>
  <meta property="og:site_name" content="Lumen Beauty">
  <meta property="og:image" content="http://lumen-beauty.com/cdn/shop/files/share.jpg?v=1&amp;width=1200">
  <style>:root { --color-primary: #d63384; --color-ink: #1d1d1f; } body { font-family: "Inter", sans-serif; color: #1d1d1f; background: #ffffff; }</style>
</head>
<body class="template-index">
  <header class="site-header"><h1 class="site-logo"><a href="/">Lumen Beauty</a></h1>
    <nav><a href="/collections/lips">Lips</a> <a href="/collections/cheeks">Cheeks</a> <a href="/pages/about">Our story</a></nav>
  </header>
  <main>${blocks}
  </main>
  <footer><p>&copy; 2026 Lumen Beauty. Vegan and cruelty-free.</p></footer>
  <script>document.querySelectorAll('.btn--quick-add').forEach(function (b) { b.addEventListener('click', function () { b.style.borderRadius = '6px'; }); });</script>
</body>
</html>
`;
}
