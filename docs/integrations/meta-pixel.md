# Meta Pixel: quiz events

The quiz widget publishes every funnel event to Shopify Customer Events as a
custom event named `gleame_<event>` (see `publishPixelEvent` in
`extensions/glimpse-widget/assets/gleame-quiz.js`). Shopify only delivers
them to pixels the shopper's cookie consent allows. A merchant forwards them
to Meta with a Custom Pixel. Nothing is sent to Meta unless the merchant adds
one.

On-store previews (`/apps/.../preview`) and Studio previews never publish.

## Events

| Shopify custom event | When | `customData` beyond `eventType`, `widget`, `device` |
|---|---|---|
| `gleame_quiz_view` | Quiz rendered | |
| `gleame_quiz_start` | First answer (once per session) | |
| `gleame_quiz_question_answered` | Every answer | |
| `gleame_quiz_lead_view` | Email step shown | |
| `gleame_quiz_lead_submitted` | Email submitted | |
| `gleame_quiz_results_shown` | Fresh results arrive | `matchCount`, `products: [{ handle, name }]` (max 12) |
| `gleame_quiz_view_product` | Product link clicked | |
| `gleame_quiz_add_to_cart` | Single add to bag | |
| `gleame_quiz_add_bundle_to_bag` | "Add all" bundle | |
| `gleame_quiz_cross_sell_add` | Cross-sell add | |

Every `trackEvent()` call in the widget publishes, so this table can lag the
code. Grep `trackEvent('` for the full list.

No personal data rides on these events: no email, phone or answers.

## Merchant setup

1. **Base pixel.** Install Meta's **Facebook & Instagram** app in Shopify, connect
   the Business account and pixel, and set data sharing to **Maximum**. That
   covers PageView, ViewContent, AddToCart, Checkout and Purchase. The
   snippet below does not fire those, so it never double counts.
2. **Quiz events.** Shopify admin > Settings > Customer events > Add custom
   pixel, name it "Gleame quiz to Meta", paste the code below, replace
   `YOUR_PIXEL_ID`, then:
   - Customer privacy > Permission: **Required**, with Marketing and Analytics ticked
   - Data sale: **Data collected qualifies as data sale**
   - Save, then **Connect**.
3. **Verify.** Meta Events Manager > the pixel > Test events, open the quiz
   page and take the quiz. QuizStarted, QuizCompleted and Lead should appear.
   The Meta Pixel Helper extension cannot see pixels inside Shopify's sandbox,
   so don't rely on it.
4. **Campaign.** `Lead` is a standard event and can be the optimization goal
   directly. To optimize on a custom event (QuizCompleted), first create a
   Custom Conversion on it in Events Manager. Build custom conversions on
   the event name, not a URL rule: events from Shopify's pixel sandbox may
   report the sandbox URL rather than the quiz page.

```js
// Gleame quiz -> Meta Pixel. Fires quiz events only; PageView, AddToCart and
// Purchase come from Meta's Facebook & Instagram app.
const PIXEL_ID = 'YOUR_PIXEL_ID';

!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('set', 'autoConfig', false, PIXEL_ID);
fbq('init', PIXEL_ID);

analytics.subscribe('gleame_quiz_start', () => {
  fbq('trackCustom', 'QuizStarted');
});

analytics.subscribe('gleame_quiz_results_shown', (event) => {
  const d = event.customData || {};
  fbq('trackCustom', 'QuizCompleted', {
    num_items: d.matchCount || 0,
    content_name: (d.products || []).map((p) => p.name).filter(Boolean).slice(0, 6).join(', '),
  });
});

analytics.subscribe('gleame_quiz_lead_submitted', () => {
  fbq('track', 'Lead', { content_name: 'Gleame quiz' });
});

analytics.subscribe('gleame_quiz_add_to_cart', () => {
  fbq('trackCustom', 'QuizAddToCart');
});

analytics.subscribe('gleame_quiz_add_bundle_to_bag', () => {
  fbq('trackCustom', 'QuizAddToCart', { bundle: true });
});
```

The same events work for TikTok, Pinterest or GA4: subscribe to the same
names in a custom pixel and call that platform's tag instead.
