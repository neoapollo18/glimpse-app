// Shared pieces of the onboarding screens (welcome intro and scope): the
// Gleame lockup, the merchant's product imagery with a drawn fallback, and
// a small specimen of each quiz template's own style.
//
// Built for Shopify: brand shows as the logo only, in black; nothing here
// uses AI purple or the sparkle glyph (both are Shopify's own AI). Every
// drawing is decorative (aria-hidden): the copy beside it says the same.

import { useId, type CSSProperties } from "react";
import { InlineStack, Text } from "@shopify/polaris";
import { TEMPLATE_STYLES, type TemplateId } from "../../lib/quiz-templates";

export const GLEAME_LOGO_SRC = "/brand/gleame-logo.svg";

export interface PreviewProduct {
  name: string;
  imageUrl: string;
}

export function BrandLockup({ size = 28 }: { size?: number }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <img className="oa-logo" src={GLEAME_LOGO_SRC} alt="" width={size} height={size} />
      <Text as="span" variant="headingMd">
        Gleame
      </Text>
    </InlineStack>
  );
}

/** Shopify CDN images resize by query string: ask for ~2x the drawn size
 * instead of the full-resolution original. */
export function sizedImage(url: string, width: number): string {
  try {
    const u = new URL(url);
    if (u.hostname === "cdn.shopify.com" || u.pathname.includes("/cdn/shop/")) {
      u.searchParams.set("width", String(Math.round(width * 2)));
    }
    return u.toString();
  } catch {
    return url;
  }
}

// What a shopper would see when the store has no product photos synced
// yet: four studio-lit product forms on warm paper, not clip art.
export const FALLBACK_PRODUCTS = ["Glow Serum", "Velvet Lip", "Cloud Cream", "Daily Cleanser"];
const FALLBACK_TILES = ["#EEE9E2", "#E9E4DD", "#F0ECE6", "#E7E2DA"];

/** The product's photo, or (no product) a drawn product form. Fills its box. */
export function ProductArt({
  product,
  index,
  width = 160,
}: {
  product?: PreviewProduct | null;
  index: number;
  width?: number;
}) {
  const kind = index % 4;
  return (
    <span className="oa-art" style={{ background: FALLBACK_TILES[kind] }} aria-hidden>
      {product ? (
        <img src={sizedImage(product.imageUrl, width)} alt="" loading="lazy" decoding="async" />
      ) : (
        <FallbackForm kind={kind} />
      )}
    </span>
  );
}

function FallbackForm({ kind }: { kind: number }) {
  // Per-instance gradient ids: a shared id breaks when its first copy is
  // inside a hidden element.
  const id = `oa-f${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 120 140" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id={`${id}-floor`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#1a140c" stopOpacity=".22" />
          <stop offset="1" stopColor="#1a140c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-ink`} x1="0" x2="1">
          <stop offset="0" stopColor="#2b2a28" />
          <stop offset=".45" stopColor="#0f0f0e" />
          <stop offset="1" stopColor="#1d1c1a" />
        </linearGradient>
        <linearGradient id={`${id}-body`} x1="0" x2="1">
          <stop offset="0" stopColor={["#B98D62", "#E9E1D6", "#F7F4EF", "#E4DACB"][kind]} />
          <stop offset=".55" stopColor={["#9A6B42", "#D9CEBF", "#EDE8E0", "#D3C6B4"][kind]} />
          <stop offset="1" stopColor={["#7E5431", "#CDBFAE", "#E2DCD2", "#C4B5A1"][kind]} />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="121" rx="34" ry="5" fill={`url(#${id}-floor)`} />
      {kind === 0 && (
        // Dropper serum: amber glass, black collar and bulb, paper label.
        <g>
          <rect x="53" y="20" width="14" height="22" rx="7" fill={`url(#${id}-ink)`} />
          <rect x="49" y="40" width="22" height="12" rx="2" fill={`url(#${id}-ink)`} />
          <rect x="41" y="51" width="38" height="70" rx="7" fill={`url(#${id}-body)`} />
          <rect x="46" y="74" width="28" height="30" rx="1.5" fill="#F6F2EC" />
          <rect x="51" y="82" width="18" height="2.4" rx="1.2" fill="#1a1a1a" />
          <rect x="54" y="87" width="12" height="1.6" rx=".8" fill="#1a1a1a" opacity=".45" />
          <rect x="45" y="55" width="3" height="60" rx="1.5" fill="#fff" opacity=".22" />
        </g>
      )}
      {kind === 1 && (
        // Lipstick: black case, champagne band, angled bullet.
        <g>
          <path d="M51 58 V35 c0-2 1-3.2 3-3.8 L69 26 V58 Z" fill="#B76E5F" />
          <path d="M51 58 V35 c0-2 1-3.2 3-3.8 L57 30 V58 Z" fill="#fff" opacity=".18" />
          <rect x="49" y="56" width="22" height="16" rx="1" fill="#D8C9B2" />
          <rect x="45" y="70" width="30" height="51" rx="3" fill={`url(#${id}-ink)`} />
          <rect x="45" y="70" width="30" height="5" fill="#CDB997" />
          <rect x="49" y="78" width="2.5" height="38" rx="1.2" fill="#fff" opacity=".14" />
        </g>
      )}
      {kind === 2 && (
        // Cream jar: low porcelain body, black lid.
        <g>
          <rect x="29" y="74" width="62" height="17" rx="4" fill={`url(#${id}-ink)`} />
          <rect x="31" y="90" width="58" height="31" rx="6" fill={`url(#${id}-body)`} stroke="#000" strokeOpacity=".06" />
          <rect x="47" y="101" width="26" height="2.4" rx="1.2" fill="#1a1a1a" />
          <rect x="52" y="106" width="16" height="1.6" rx=".8" fill="#1a1a1a" opacity=".45" />
          <rect x="35" y="93" width="3" height="24" rx="1.5" fill="#fff" opacity=".5" />
        </g>
      )}
      {kind === 3 && (
        // Squeeze tube standing on its cap.
        <g>
          <rect x="40" y="22" width="40" height="6" rx="1" fill="#C9BCA9" />
          <path d="M41 28 H79 L74 99 H46 Z" fill={`url(#${id}-body)`} />
          <rect x="47" y="98" width="26" height="23" rx="3" fill={`url(#${id}-ink)`} />
          <rect x="51" y="52" width="18" height="2.4" rx="1.2" fill="#1a1a1a" />
          <rect x="54" y="57" width="12" height="1.6" rx=".8" fill="#1a1a1a" opacity=".45" />
          <path d="M45 31 h3 l-2.4 62 h-2.2 Z" fill="#fff" opacity=".28" />
        </g>
      )}
    </svg>
  );
}

/** A specimen of a template's own design: its paper, its type, and its
 * answer treatment with one answer picked. Sized by `size` (px). */
export function TemplateMini({ id, size = 64 }: { id: TemplateId; size?: number }) {
  const t = TEMPLATE_STYLES[id]?.tokens ?? TEMPLATE_STYLES.t5.tokens;
  const vars = {
    fontSize: size / 10,
    background: t.colorBg,
    color: t.colorText,
    "--oa-acc": t.colorAccent,
    "--oa-line": t.colorBorder,
    "--oa-surface": t.colorSurface,
  } as CSSProperties;
  return (
    <span className={`oa-tpl oa-tpl--${id}`} style={vars} aria-hidden>
      <span className="oa-tpl-aa" style={{ fontFamily: t.fontHeading }}>
        Aa
      </span>
      <span className="oa-tpl-ans">
        <i />
        <i className="is-on" />
        <i />
      </span>
    </span>
  );
}

export function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 8.4 6.6 11.3 12.5 4.9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const ART_CSS = `
  .oa-logo { display: block; flex: none; border-radius: var(--p-border-radius-200, 8px); }

  .oa-art { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; }
  .oa-art img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .oa-art svg { position: absolute; inset: 0; width: 100%; height: 100%; }

  /* Template specimens: everything in em so one font-size scales the tile. */
  .oa-tpl { position: relative; display: flex; flex-direction: column; justify-content: space-between; flex: none; box-sizing: border-box;
    width: 10em; height: 10em; padding: 1.2em 1.2em 1.3em; border-radius: 1.8em; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08); }
  .oa-tpl-aa { font-size: 2.7em; line-height: 1; font-weight: 700; letter-spacing: -0.03em; }
  .oa-tpl-ans { display: grid; gap: .55em; }
  .oa-tpl-ans i { display: block; height: 1.45em; box-sizing: border-box; background: var(--oa-surface); border: .12em solid var(--oa-line); }
  /* Counter: blush photo chips, accent ring on the pick */
  .oa-tpl--t1 .oa-tpl-ans { grid-template-columns: repeat(3, 1fr); gap: .5em; }
  .oa-tpl--t1 .oa-tpl-ans i { height: 3em; border: 0; border-radius: .8em; background: linear-gradient(160deg, #F3E1DA, #E2C3B8); }
  .oa-tpl--t1 .oa-tpl-ans i:nth-child(3) { background: linear-gradient(160deg, #EBD6D9, #C99AA5); }
  .oa-tpl--t1 .oa-tpl-ans i.is-on { box-shadow: 0 0 0 .22em var(--oa-acc); background: linear-gradient(160deg, #E9CBBE, #C98E7C); }
  /* Editorial: serif, hairline rules, a square marker on the pick */
  .oa-tpl--t2 { border-radius: .4em; }
  .oa-tpl--t2 .oa-tpl-aa { font-weight: 400; font-style: italic; letter-spacing: -0.01em; }
  .oa-tpl--t2 .oa-tpl-ans { gap: .45em; }
  .oa-tpl--t2 .oa-tpl-ans i { height: 1.05em; background: none; border: 0; border-bottom: .1em solid var(--oa-line); position: relative; }
  .oa-tpl--t2 .oa-tpl-ans i.is-on::before { content: ""; position: absolute; left: 0; top: .1em; width: .6em; height: .6em; background: var(--oa-acc); }
  /* Ritual: soft capsules, sage fill on the pick */
  .oa-tpl--t3 .oa-tpl-aa { font-weight: 600; letter-spacing: -0.01em; }
  .oa-tpl--t3 .oa-tpl-ans i { border-radius: 999px; }
  .oa-tpl--t3 .oa-tpl-ans i.is-on { background: var(--oa-acc); border-color: var(--oa-acc); }
  /* Pop: ink outlines, hard offset shadows */
  .oa-tpl--t4 .oa-tpl-aa { font-weight: 800; }
  .oa-tpl--t4 .oa-tpl-ans { gap: .6em; padding-right: .3em; }
  .oa-tpl--t4 .oa-tpl-ans i { border: .14em solid #1c1410; border-radius: .5em; box-shadow: .22em .22em 0 #1c1410; height: 1.35em; }
  .oa-tpl--t4 .oa-tpl-ans i.is-on { background: var(--oa-acc); }
  /* Swiss: monochrome grotesk, inverted pick */
  .oa-tpl--t5 { border-radius: .8em; }
  .oa-tpl--t5 .oa-tpl-aa { letter-spacing: -0.045em; }
  .oa-tpl--t5 .oa-tpl-ans i { border-radius: .25em; }
  .oa-tpl--t5 .oa-tpl-ans i.is-on { background: #111; border-color: #111; }
`;
