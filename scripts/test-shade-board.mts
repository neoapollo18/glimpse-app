// Direct shade-board classifier test (2026-09-22 "broken again" hunt).
// Feeds known L&M variant photos through the EXACT production path and
// prints the verdicts. Expected: each photo matches its own shade.
import { classifyPhotoAxesForShopDetailed } from "../app/lib/photo-axis-classifier.server";

const DOMAIN = "locks-mane.myshopify.com";
const catalogRes = await fetch("https://locks-mane.myshopify.com/products.json?limit=250");
const catalog = (await catalogRes.json()).products as any[];
const wanted = ["Vanilla", "Butterscotch", "Espresso"];
const picks: Array<{ title: string; url: string }> = [];
for (const w of wanted) {
  for (const prod of catalog) {
    if (!/Clip-In Extensions/.test(prod.title)) continue;
    const v = (prod.variants ?? []).find((x: any) => String(x.title).startsWith(w));
    const img = v?.featured_image?.src ?? (prod.images?.[0]?.src ?? null);
    if (v && img) { picks.push({ title: `${prod.title} ${v.title}`, url: img }); break; }
  }
}
console.log("testing", picks.map((p) => p.title));

const axes = [
  {
    key: "hair_shade",
    label: "Hair shade",
    values: [
      "vanilla", "toastedmarshmallow", "cinnamonbun", "butterpecan", "butterscotch",
      "peanutbuttercup", "gingerbread", "milkchocolate", "darkchocolate", "espresso",
    ].map((v) => ({ value: v, label: v })),
  },
];

for (const p of picks) {
  const res = await fetch(p.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const b64 = buf.toString("base64");
  const t0 = Date.now();
  try {
    const out = await classifyPhotoAxesForShopDetailed(DOMAIN, b64, "image/jpeg", axes as any);
    console.log(
      p.title, "->", JSON.stringify(out.values), "noMatch:", out.shadeNoMatch,
      out.noMatchMessage ? `msg:"${out.noMatchMessage.slice(0, 40)}..."` : "", `${Date.now() - t0}ms`
    );
  } catch (e) {
    console.log(p.title, "-> ERROR:", (e as Error).message, `${Date.now() - t0}ms`);
  }
}
