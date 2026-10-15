Retired storefront scripts, kept for reference (see app/lib/retired-features.ts).

- `widget-embed.js`: the standalone try-on widget for page builders, served at
  `/widget-embed.js` by `app/routes/widget-embed[.]js.ts`. It lives here rather
  than in `public/` because remix-serve serves `public/` statically before any
  route runs, which would bypass the retirement switch. While
  `TRYON_WIDGETS_RETIRED` is on, that URL returns a no-op script.
