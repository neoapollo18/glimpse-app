/**
 * Storefront homepage HTML scanning shared by the brand profile (fonts,
 * button radius, imagery, copy) and the brand library (og:image and hero
 * image candidates).
 *
 * The HTML is merchant-controlled and the scans run on the one event loop,
 * so none of them may backtrack. Each scan here is a forward pass that
 * returns exactly what the regex it replaced returned (the tests keep those
 * regexes as the oracle and fuzz against them): real storefronts extract the
 * same values, and a crafted page costs linear time.
 */

/** Homepage bytes read off the wire. Beauty storefronts already reach 3.3 MB
 * (ORLY), so this leaves headroom; only a page past it is cut. */
export const HOMEPAGE_MAX_BYTES = 8_000_000;

/** Homepage characters parsed, for HTML handed in as a string. 8 MB of UTF-8
 * never decodes to more. */
export const HOMEPAGE_HTML_MAX_CHARS = 8_000_000;

export function capHomepageHtml(html: string): string {
  return html.length > HOMEPAGE_HTML_MAX_CHARS ? html.slice(0, HOMEPAGE_HTML_MAX_CHARS) : html;
}

/**
 * Index of the first match of `source` at or after `from`, or -1. Callers
 * must never pass a smaller `from` than before: an earlier answer that is
 * still ahead is reused, so each stretch of HTML is searched once however
 * often it is asked about. That is what keeps every scan below linear.
 */
function forward(html: string, source: string, flags = "g"): (from: number) => number {
  const re = new RegExp(source, flags);
  let at = -2; // -2: not searched yet, -1: no match left
  return (from) => {
    if (at === -1 || at >= from) return at;
    re.lastIndex = from;
    at = re.exec(html)?.index ?? -1;
    return at;
  };
}

/** Storefront password page: there is no public homepage to read. Same
 * answer as /<body[^>]*class="[^"]*password/i on the HTML. */
export function isPasswordPage(finalUrl: string, html: string): boolean {
  if (/\/password/.test(finalUrl)) return true;
  const body = /<body/gi;
  const tagEnd = forward(html, ">");
  const classAttr = forward(html, 'class="', "gi");
  const quote = forward(html, '"');
  const word = forward(html, "password", "gi");
  for (let m = body.exec(html); m; m = body.exec(html)) {
    const end = tagEnd(m.index + 5);
    const stop = end < 0 ? html.length : end;
    for (let c = classAttr(m.index + 5); c >= 0 && c < stop; c = classAttr(c + 1)) {
      const w = word(c + 7);
      if (w < 0) return false;
      const q = quote(c + 7);
      if (q < 0 || w < q) return true;
    }
    // A later "<body" inside this tag only sees a subset of its attributes.
    if (end < 0) return false;
    body.lastIndex = end + 1;
  }
  return false;
}

/** A CSS custom property's value as /--NAME\s*:\s*([^;}]+)[;}]/ found it
 * (first match, trimmed), or null. */
export function cssVariable(html: string, name: string): string | null {
  const head = new RegExp(`--${name}\\s*:`, "y");
  const next = forward(html, `--${name}`);
  const semi = forward(html, ";");
  const brace = forward(html, "}");
  for (let at = next(0); at >= 0; at = next(at + 1)) {
    head.lastIndex = at;
    if (!head.test(html)) continue;
    const start = head.lastIndex;
    const s = semi(start);
    const b = brace(start);
    const end = s < 0 ? b : b < 0 ? s : Math.min(s, b);
    if (end < 0) return null; // unterminated, and so is every later one
    if (end > start) return html.slice(start, end).trim();
  }
  return null;
}

/**
 * Captures of a /SELECTOR[^{}]*\{[^}]*DECLARATION/gi regex, in matchAll
 * order. A match is a rule whose selector text holds SELECTOR, and the
 * greedy [^}]* makes it the LAST declaration in that block that
 * `declaration` accepts (given where PROPERTY was found and where the block
 * ends, it returns the capture and where the match ends, or null). Each
 * block is scanned once, however many selectors lead into it.
 */
function* ruleDeclarations(
  html: string,
  selector: string,
  property: string,
  declaration: (at: number, blockEnd: number) => { value: () => string; end: number } | null
): Generator<string> {
  const key = new RegExp(selector, "gi");
  const open = forward(html, "\\{");
  const close = forward(html, "\\}");
  const prop = forward(html, property, "gi");
  let blockEnd = -1;
  // value is a thunk: only the winning declaration's text is ever built.
  // Slicing and trimming every candidate made a block with many
  // declarations and a long whitespace tail quadratic.
  let last: { at: number; value: () => string; end: number } | null = null;
  for (let m = key.exec(html); m; m = key.exec(html)) {
    const from = m.index + m[0].length;
    const b = open(from);
    if (b < 0) return; // no block left for this selector or any later one
    const c = close(from);
    if (c >= 0 && c < b) continue; // the selector text ran into a "}" first
    const end = c < 0 ? html.length : c;
    if (end !== blockEnd) {
      blockEnd = end;
      last = null;
      for (let at = prop(b + 1); at >= 0 && at < end; at = prop(at + 1)) {
        const d = declaration(at, end);
        if (d) last = { at, ...d };
      }
    }
    if (last && last.at > b) {
      yield last.value();
      key.lastIndex = last.end;
    }
  }
}

/** The first h1 rule's font-family, as
 * /h1[^{}]*\{[^}]*font-family\s*:\s*([^;}]+)/i found it (trimmed), or null. */
export function h1FontFamily(html: string): string | null {
  const family = /font-family\s*:/iy;
  const semi = forward(html, ";");
  for (const value of ruleDeclarations(html, "h1", "font-family", (at, blockEnd) => {
    family.lastIndex = at;
    if (!family.test(html)) return null;
    const start = family.lastIndex;
    const s = semi(start);
    const end = s >= 0 && s < blockEnd ? s : blockEnd;
    return end > start ? { value: () => html.slice(start, end).trim(), end } : null;
  })) {
    return value;
  }
  return null;
}

/** Every button rule's px border-radius, as the captures of
 * /(?:button|btn)[^{}]*\{[^}]*border-radius\s*:\s*(\d+(?:\.\d+)?)px/gi. */
export function buttonRadii(html: string): string[] {
  const radius = /border-radius\s*:\s*(\d+(?:\.\d+)?)px/iy;
  return [
    ...ruleDeclarations(html, "button|btn", "border-radius", (at) => {
      radius.lastIndex = at;
      const m = radius.exec(html);
      if (!m) return null;
      const px = m[1];
      return { value: () => px, end: radius.lastIndex };
    }),
  ];
}

const OG_IMAGE_PROPERTY = `property=["']og:image(?::secure_url)?["']`;
const META_CONTENT = `content=["']`; // the value starts 9 characters in

/**
 * The og:image meta content, as
 *   /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i
 * or, failing that,
 *   /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i
 * found it, or null.
 */
export function ogImageContent(html: string): string | null {
  return ogPropertyThenContent(html) ?? ogContentThenProperty(html);
}

function ogPropertyThenContent(html: string): string | null {
  const meta = /<meta/gi;
  const property = new RegExp(OG_IMAGE_PROPERTY, "iy");
  const tagEnd = forward(html, ">");
  const nextProperty = forward(html, OG_IMAGE_PROPERTY, "gi");
  const nextContent = forward(html, META_CONTENT, "gi");
  const quote = forward(html, `["']`);
  for (let m = meta.exec(html); m; m = meta.exec(html)) {
    const end = tagEnd(m.index + 5);
    const stop = end < 0 ? html.length : end;
    // The greedy [^>]+ pairs the tag's last usable content with ANY og:image
    // property before it, so the first property is the one that counts.
    const p = nextProperty(m.index + 6);
    if (p >= 0 && p < stop) {
      property.lastIndex = p;
      property.test(html);
      let found: string | null = null;
      for (let c = nextContent(property.lastIndex + 1); c >= 0 && c < stop; c = nextContent(c + 1)) {
        const q = quote(c + 9);
        if (q > c + 9) found = html.slice(c + 9, q);
      }
      if (found) return found;
    }
    // A later "<meta" inside this tag only sees a subset of its attributes.
    if (end < 0) return null;
    meta.lastIndex = end + 1;
  }
  return null;
}

function ogContentThenProperty(html: string): string | null {
  const meta = /<meta/gi;
  const tagEnd = forward(html, ">");
  const nextContent = forward(html, META_CONTENT, "gi");
  const quote = forward(html, `["']`);
  const gtAfterValue = forward(html, ">");
  const nextProperty = forward(html, OG_IMAGE_PROPERTY, "gi");
  for (let m = meta.exec(html); m; m = meta.exec(html)) {
    const end = tagEnd(m.index + 5);
    const stop = end < 0 ? html.length : end;
    let found: string | null = null;
    for (let c = nextContent(m.index + 6); c >= 0 && c < stop; c = nextContent(c + 1)) {
      const q = quote(c + 9);
      if (q <= c + 9) continue;
      // After the value: [^>]+ and then the og:image property.
      const p = nextProperty(q + 2);
      const gt = gtAfterValue(q + 1);
      if (p >= 0 && (gt < 0 || p < gt)) found = html.slice(c + 9, q);
    }
    if (found) return found;
    if (end < 0) return null;
    meta.lastIndex = end + 1;
  }
  return null;
}

/** Every `<img ...>` tag in document order: the same strings as
 * html.matchAll(/<img\b[^>]*>/gi), in one pass. */
export function* imgTags(html: string): Generator<string> {
  const open = /<img\b/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const end = html.indexOf(">", m.index + m[0].length);
    if (end < 0) return; // no later <img can close either
    yield html.slice(m.index, end + 1);
    open.lastIndex = end + 1;
  }
}

/** html.replace(/<script[\s\S]*?<\/script>/gi, " ") (or style), in one pass. */
export function stripElements(html: string, name: "script" | "style"): string {
  const open = new RegExp(`<${name}`, "gi");
  const close = new RegExp(`</${name}>`, "gi");
  let out = "";
  let pos = 0;
  for (;;) {
    open.lastIndex = pos;
    const o = open.exec(html);
    if (!o) break;
    close.lastIndex = o.index + o[0].length;
    const c = close.exec(html);
    if (!c) break; // unclosed: no later opener can close either
    out += html.slice(pos, o.index) + " ";
    pos = c.index + c[0].length;
  }
  return out + html.slice(pos);
}

/** html.replace(/<[^>]+>/g, " "), in one pass. */
export function stripTags(html: string): string {
  let out = "";
  let pos = 0; // copied up to here
  let from = 0; // next "<" to try
  for (;;) {
    const lt = html.indexOf("<", from);
    if (lt < 0) break;
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break; // no later "<" can close either
    if (gt === lt + 1) {
      from = lt + 1; // "<>" is not a tag
      continue;
    }
    out += html.slice(pos, lt) + " ";
    pos = from = gt + 1;
  }
  return out + html.slice(pos);
}
