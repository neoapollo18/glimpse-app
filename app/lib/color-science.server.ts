// Perceptual color distance for shade filtering.
//
// RGB euclidean distance is a poor proxy for how different two cosmetic
// shades LOOK — the industry standard (and what Sephora's shade-matching
// patent US12446822B2 uses) is distance in CIELAB space. This module
// converts sRGB hex swatches to Lab (D65) and computes CIEDE2000, the
// current CIE-recommended perceptual difference formula.
//
// Rough calibration: ΔE00 ≈ 1 is the threshold of a just-noticeable
// difference; ≲ 10 reads as "the same color family"; ≳ 30 is clearly a
// different color.

export type Lab = { L: number; a: number; b: number };

// Accepts the same grammar the admin swatch validator does (#rgb through
// #rrggbbaa) — alpha digits are stripped, since Lab distance is opaque-color
// math. A narrower grammar here silently no-ops the color filter for any
// merchant swatch saved with alpha.
const HEX_RE = /^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Parse a #rgb(a) / #rrggbb(aa) hex swatch into CIELAB (D65). Null on bad input. */
export function hexToLab(hex: string | null | undefined): Lab | null {
  if (!hex) return null;
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 4 || h.length === 8) h = h.slice(0, h.length === 4 ? 3 : 6); // drop alpha
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  // sRGB -> linear RGB
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const rl = lin(r), gl = lin(g), bl = lin(b);

  // linear RGB -> XYZ (D65)
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;

  // XYZ -> Lab (D65 reference white)
  const xn = 0.95047, yn = 1.0, zn = 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / xn), fy = f(y / yn), fz = f(z / zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIEDE2000 color difference (Sharma et al. 2005 formulation). */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const rad = Math.PI / 180;
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = C1p === 0 ? 0 : ((Math.atan2(b1, a1p) / rad) + 360) % 360;
  const h2p = C2p === 0 ? 0 : ((Math.atan2(b2, a2p) / rad) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbarp += h1p + h2p < 360 ? 360 : -360;
    hbarp /= 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH),
  );
}

/** ΔE00 between two hex swatches. Null when either fails to parse. */
export function hexDeltaE(hexA: string | null | undefined, hexB: string | null | undefined): number | null {
  const a = hexToLab(hexA);
  const b = hexToLab(hexB);
  if (!a || !b) return null;
  return deltaE2000(a, b);
}
