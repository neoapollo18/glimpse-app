import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// DNS is faked per hostname so the tests never touch the network: every
// name below "resolves" to the address(es) listed here.
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
// safe-fetch calls undici directly; route it to the per-test global stub.
vi.mock("undici", () => ({ fetch: (...args: unknown[]) => (globalThis.fetch as (...a: unknown[]) => unknown)(...args) }));
vi.mock("../supabase.server", () => ({ supabase: {} }));

import { boundedPublicFetch, safeFetch, validatePublicUrl } from "../safe-fetch.server";
import { analyzeHomepage } from "../brand-profile.server";

const DNS: Record<string, string[]> = {
  "glow-lab.myshopify.com": ["23.227.38.65"],
  "glow-lab.com": ["23.227.38.32"],
  "www.glow-lab.com": ["23.227.38.32"],
  "cdn.shopify.com": ["151.101.1.12", "2a04:4e42::779"],
  "internal.attacker.example": ["10.0.0.5"],
  "unspecified.attacker.example": ["::"],
  "mapped.attacker.example": ["::ffff:7f00:1"],
  "cgnat.attacker.example": ["100.64.1.2"],
  "mixed.attacker.example": ["93.184.216.34", "192.168.1.10"],
  "img.attacker.example": ["93.184.216.34"],
  "rebind.attacker.example": ["93.184.216.35"],
};

const UA = { "User-Agent": "Mozilla/5.0 (compatible; GleameBrandBot/1.0)" };

type Route = (init: RequestInit) => Response;
let routes: Record<string, Route>;
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  const route = routes[url];
  if (!route) throw new TypeError(`fetch failed: ${url}`);
  return route(init);
});

const redirect = (location: string, status = 302): Route => () =>
  new Response(null, { status, headers: { location } });
const ok = (body: string): Route => () => new Response(body, { status: 200 });

beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  lookup.mockReset();
  lookup.mockImplementation(async (host: string) => {
    const addrs = DNS[host];
    if (!addrs) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("validatePublicUrl", () => {
  it("blocks private and reserved IP literals, including the newly listed ranges", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://10.1/", // parsed to 10.0.0.1
      "http://2130706433/", // parsed to 127.0.0.1
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://100.127.255.255/",
      "http://192.0.0.8/",
      "http://198.18.0.1/",
      "http://198.19.255.1/",
      "http://224.0.0.251/",
      "http://239.255.255.250:1900/",
      "http://255.255.255.255/",
      "http://[::1]/",
      "http://[::]:3000/",
      "http://[::ffff:127.0.0.1]/", // parsed to [::ffff:7f00:1]
      "http://[::ffff:a9fe:a9fe]/", // 169.254.169.254
      "http://[fd12:3456::1]/",
      "http://[fc00::1]/",
      "http://[fe80::1]/",
      "http://localhost:3000/",
      "file:///etc/passwd",
    ]) {
      expect(validatePublicUrl(url), url).toBeNull();
    }
  });

  it("keeps allowing public addresses and ordinary store hostnames", () => {
    for (const url of [
      "https://glow-lab.myshopify.com/",
      "https://cdn.shopify.com/s/files/1/0123/4567/files/hero.jpg?v=1",
      "http://100.63.255.255/",
      "http://100.128.0.1/",
      "http://198.20.0.1/",
      "http://223.255.255.255/",
      // A store handle that starts with "fd" is a name, not an fd00::/8
      // address (the old /^fd/ pattern blocked it).
      "https://fdbeauty.myshopify.com/",
      "https://fd-cosmetics.com/",
      "https://247.example.com/",
    ]) {
      expect(validatePublicUrl(url), url).toBe(url);
    }
  });
});

describe("safeFetch", () => {
  it("rejects names that resolve into the newly listed ranges", async () => {
    for (const host of ["cgnat.attacker.example", "unspecified.attacker.example", "mapped.attacker.example"]) {
      routes[`https://${host}/ref.png`] = ok("png");
      expect(await safeFetch(`https://${host}/ref.png`), host).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("boundedPublicFetch", () => {
  it("follows redirects by hand, sends the UA on every hop and returns the final URL", async () => {
    routes["https://glow-lab.myshopify.com/"] = redirect("https://glow-lab.com/", 301);
    routes["https://glow-lab.com/"] = redirect("https://www.glow-lab.com/");
    routes["https://www.glow-lab.com/"] = redirect("/en-us");
    routes["https://www.glow-lab.com/en-us"] = ok("<html>home</html>");

    const res = await boundedPublicFetch("https://glow-lab.myshopify.com/", {
      timeoutMs: 1000,
      maxBytes: 1000,
      headers: UA,
    });

    expect(res).not.toBeNull();
    expect(res!.url).toBe("https://www.glow-lab.com/en-us");
    expect(res!.status).toBe(200);
    expect(res!.body.toString()).toBe("<html>home</html>");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.redirect).toBe("manual");
      expect(init.headers).toEqual(UA);
    }
  });

  it("re-checks every hop: a redirect to an internal address is never fetched", async () => {
    for (const target of [
      "http://127.0.0.1:10000/admin",
      "http://[::ffff:7f00:1]/",
      "http://internal.attacker.example:8080/",
      "http://unspecified.attacker.example:3000/",
      "http://mapped.attacker.example/",
      "http://cgnat.attacker.example/",
      "http://mixed.attacker.example/",
      "http://metadata.google.internal/computeMetadata/v1/",
    ]) {
      fetchMock.mockClear();
      routes = {
        "https://glow-lab.myshopify.com/": redirect("https://glow-lab.com/", 301),
        "https://glow-lab.com/": redirect(target),
      };
      routes[target] = ok("secret");
      const res = await boundedPublicFetch("https://glow-lab.myshopify.com/", { timeoutMs: 1000, maxBytes: 1000 });
      expect(res, target).toBeNull();
      expect(fetchMock.mock.calls.map(([u]) => u)).not.toContain(target);
    }
  });

  it("allows 5 redirects and gives up on the 6th", async () => {
    const chain = (hops: number) => {
      routes = {};
      for (let i = hops; i > 0; i--) routes[`https://glow-lab.com/r${i}`] = redirect(`/r${i - 1}`, 307);
      routes["https://glow-lab.com/r0"] = ok("end");
    };
    chain(5);
    expect((await boundedPublicFetch("https://glow-lab.com/r5", { timeoutMs: 1000, maxBytes: 100 }))?.url).toBe(
      "https://glow-lab.com/r0"
    );
    chain(6);
    expect(await boundedPublicFetch("https://glow-lab.com/r6", { timeoutMs: 1000, maxBytes: 100 })).toBeNull();
  });

  it("with httpsOnly, never fetches a hop over plain http", async () => {
    // A merchant-controlled https image that redirects to an http name whose
    // DNS answer passes the check: without TLS it could rebind to an
    // internal address between the check and the connect.
    routes["https://img.attacker.example/hero.jpg"] = redirect("http://rebind.attacker.example:10000/admin");
    routes["http://rebind.attacker.example:10000/admin"] = ok("secret");
    routes["http://glow-lab.com/hero.jpg"] = ok("jpg");
    const opts = { timeoutMs: 1000, maxBytes: 100, httpsOnly: true };

    expect(await boundedPublicFetch("https://img.attacker.example/hero.jpg", opts)).toBeNull();
    expect(await boundedPublicFetch("http://glow-lab.com/hero.jpg", opts)).toBeNull();
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(["https://img.attacker.example/hero.jpg"]);

    // The https chains storefronts and the CDN use are unaffected.
    routes["https://glow-lab.myshopify.com/"] = redirect("https://glow-lab.com/", 301);
    routes["https://glow-lab.com/"] = ok("<html>home</html>");
    expect((await boundedPublicFetch("https://glow-lab.myshopify.com/", opts))?.url).toBe("https://glow-lab.com/");
  });

  it("returns null for a non-2xx answer or a redirect without Location", async () => {
    routes["https://glow-lab.com/404"] = () => new Response("missing", { status: 404 });
    routes["https://glow-lab.com/bare"] = () => new Response(null, { status: 302 });
    expect(await boundedPublicFetch("https://glow-lab.com/404", { timeoutMs: 1000, maxBytes: 100 })).toBeNull();
    expect(await boundedPublicFetch("https://glow-lab.com/bare", { timeoutMs: 1000, maxBytes: 100 })).toBeNull();
  });

  // A host that answers headers and then streams forever.
  const endless = () => {
    const state = { pulled: 0, cancelled: false };
    const route: Route = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            state.pulled++;
            controller.enqueue(new Uint8Array(64 * 1024).fill(97));
          },
          cancel() {
            state.cancelled = true;
          },
        }),
        { status: 200 }
      );
    return { state, route };
  };

  it("stops an endless body at the byte cap instead of buffering it", async () => {
    const { state, route } = endless();
    routes["https://cdn.shopify.com/huge.jpg"] = route;
    const res = await boundedPublicFetch("https://cdn.shopify.com/huge.jpg", { timeoutMs: 5000, maxBytes: 2_000_000 });
    expect(res).toBeNull();
    expect(state.cancelled).toBe(true);
    expect(state.pulled * 64 * 1024).toBeLessThan(2_000_000 + 4 * 64 * 1024);
  });

  it("keeps the first maxBytes when truncating (homepage HTML)", async () => {
    const { state, route } = endless();
    routes["https://glow-lab.com/"] = route;
    const res = await boundedPublicFetch("https://glow-lab.com/", { timeoutMs: 5000, maxBytes: 3_000_000, truncate: true });
    expect(res?.body.length).toBe(3_000_000);
    expect(state.cancelled).toBe(true);
  });

  it("accepts a body of exactly maxBytes", async () => {
    routes["https://cdn.shopify.com/exact.jpg"] = ok("x".repeat(2000));
    const res = await boundedPublicFetch("https://cdn.shopify.com/exact.jpg", { timeoutMs: 1000, maxBytes: 2000 });
    expect(res?.body.length).toBe(2000);
  });

  it("keeps the timeout armed through the body read", async () => {
    // Headers arrive at once, then the body stalls after one chunk.
    routes["https://glow-lab.com/slow"] = (init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([60, 104]));
            init.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("The operation was aborted.", "AbortError"))
            );
          },
        }),
        { status: 200 }
      );
    const started = Date.now();
    const res = await boundedPublicFetch("https://glow-lab.com/slow", { timeoutMs: 50, maxBytes: 1000 });
    expect(res).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("analyzeHomepage over boundedPublicFetch", () => {
  const HOME_HTML = `<html><head><style>:root { --font-heading-family: "Lora", serif; }</style></head>
<body class="template-index"><h2>Glow, naturally.</h2></body></html>`;

  it("follows the storefront's https redirects with the brand bot UA and parses the page", async () => {
    routes["https://glow-lab.myshopify.com/"] = redirect("https://glow-lab.com/", 301);
    routes["https://glow-lab.com/"] = ok(HOME_HTML);
    const out = await analyzeHomepage("glow-lab.myshopify.com");
    expect(out).toMatchObject({ headingFont: '"Lora", serif', headingSerif: true, copySample: "Glow, naturally." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) expect(init.headers).toEqual(UA);
  });

  it("still skips a password page found through the final URL", async () => {
    routes["https://glow-lab.myshopify.com/"] = redirect("https://glow-lab.com/password");
    routes["https://glow-lab.com/password"] = ok(HOME_HTML);
    expect(await analyzeHomepage("glow-lab.myshopify.com")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never reads back an internal or plain-http redirect target", async () => {
    for (const target of [
      "http://127.0.0.1:10000/admin",
      "https://internal.attacker.example/",
      "http://rebind.attacker.example/",
    ]) {
      fetchMock.mockClear();
      routes = { "https://glow-lab.myshopify.com/": redirect(target), [target]: ok(HOME_HTML) };
      expect(await analyzeHomepage("glow-lab.myshopify.com"), target).toBeNull();
      expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(["https://glow-lab.myshopify.com/"]);
    }
  });
});

describe("malformed redirects", () => {
  // Under remix-serve the global fetch (@remix-run/web-fetch) throws on a bad
  // Location inside a socket handler and crashes the process; that is why
  // safe-fetch calls undici. These pin both halves of that.
  it("both helpers answer null for an unparseable Location", async () => {
    routes["https://img.attacker.example/hero.jpg"] = redirect("http://[");
    await expect(safeFetch("https://img.attacker.example/hero.jpg")).resolves.toBeNull();
    await expect(
      boundedPublicFetch("https://img.attacker.example/hero.jpg", { timeoutMs: 1000, maxBytes: 1024, headers: UA })
    ).resolves.toBeNull();
  });

  it("undici hands back a 3xx with a malformed Location instead of throwing", async () => {
    const http = await import("node:http");
    const { fetch: realUndiciFetch } = await vi.importActual<typeof import("undici")>("undici");
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { Location: "http://[" });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as { port: number };
      const res = await realUndiciFetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("http://[");
    } finally {
      server.close();
    }
  });
});
