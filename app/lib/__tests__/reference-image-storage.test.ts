import { describe, it, expect, vi, beforeEach } from "vitest";

// deleteReferenceImage runs with the service-role client against a bucket
// every shop shares, so its key guard is the last line of defense. Fake the
// supabase-js client and record what reaches storage.remove().
const removed = vi.hoisted(() => {
  process.env.SUPABASE_URL ||= "https://proj.supabase.co";
  process.env.SUPABASE_API_KEY ||= "test-key";
  return [] as string[][];
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => {
        if (bucket !== "reference-images") throw new Error(`unexpected bucket ${bucket}`);
        return { remove: async (paths: string[]) => { removed.push(paths); return { data: [], error: null }; } };
      },
    },
  }),
}));

import { deleteReferenceImage } from "../supabase.server";
import { isDeletableReferenceImageKey, referenceImageShopFolder } from "../reference-images";

const PUBLIC = "https://proj.supabase.co/storage/v1/object/public/reference-images";

beforeEach(() => {
  removed.length = 0;
});

describe("referenceImageShopFolder", () => {
  it("matches the upload helpers' sanitization", () => {
    expect(referenceImageShopFolder("shop-a.myshopify.com")).toBe("shop-a.myshopify.com");
    expect(referenceImageShopFolder("we!rd/shop")).toBe("we_rd_shop");
  });
});

describe("isDeletableReferenceImageKey", () => {
  it("accepts every key shape the upload helpers and backfill scripts write", () => {
    const owner = "shop-a.myshopify.com";
    for (const key of [
      "shop-a.myshopify.com/2b1c-1781295019016.webp",
      "shop-a.myshopify.com/avatar-1781298000207.jpg",
      "shop-a.myshopify.com/brand-library-1781298000207.png",
      "shop-a.myshopify.com/2b1c-v-9f8e-1781295019016.jpeg",
      "shop-a.myshopify.com/two-set/blonde/Honey Blonde.jpg",
    ]) {
      expect(isDeletableReferenceImageKey(key, owner)).toBe(true);
      expect(isDeletableReferenceImageKey(key)).toBe(true);
    }
  });

  it("refuses traversal-shaped keys with or without an owner", () => {
    for (const key of [
      "shop-a.myshopify.com/../shop-b.myshopify.com/avatar-1.png",
      "../shop-b.myshopify.com/avatar-1.png",
      "/shop-b.myshopify.com/avatar-1.png",
      "shop-a.myshopify.com\\..\\shop-b.myshopify.com\\avatar-1.png",
      "",
    ]) {
      expect(isDeletableReferenceImageKey(key)).toBe(false);
      expect(isDeletableReferenceImageKey(key, "shop-a.myshopify.com")).toBe(false);
    }
  });

  it("refuses keys outside the owner's folder, including look-alike prefixes", () => {
    const owner = "shop-a.myshopify.com";
    expect(isDeletableReferenceImageKey("shop-b.myshopify.com/avatar-1.png", owner)).toBe(false);
    expect(isDeletableReferenceImageKey("shop-a.myshopify.com.evil/avatar-1.png", owner)).toBe(false);
    expect(isDeletableReferenceImageKey("shop-a.myshopify.com", owner)).toBe(false);
  });
});

describe("deleteReferenceImage", () => {
  it("removes the shop's own object exactly as before", async () => {
    await deleteReferenceImage(`${PUBLIC}/shop-a.myshopify.com/avatar-1781298000207.jpg`, "shop-a.myshopify.com");
    expect(removed).toEqual([["shop-a.myshopify.com/avatar-1781298000207.jpg"]]);
  });

  it("still removes without an owner (founder admin callers)", async () => {
    await deleteReferenceImage(`${PUBLIC}/shop-b.myshopify.com/p-1.webp`);
    expect(removed).toEqual([["shop-b.myshopify.com/p-1.webp"]]);
  });

  it("decodes the key the way the public URL encodes it", async () => {
    await deleteReferenceImage(`${PUBLIC}/shop-a.myshopify.com/two-set/blonde/Honey%20Blonde.jpg`, "shop-a.myshopify.com");
    expect(removed).toEqual([["shop-a.myshopify.com/two-set/blonde/Honey Blonde.jpg"]]);
  });

  it("refuses another shop's object when the owner is given", async () => {
    await deleteReferenceImage(`${PUBLIC}/victim.myshopify.com/avatar-1.png`, "attacker.myshopify.com");
    expect(removed).toEqual([]);
  });

  it("refuses encoded traversal out of the owner's folder", async () => {
    await deleteReferenceImage(
      `${PUBLIC}/attacker.myshopify.com%2F..%2Fvictim.myshopify.com%2Favatar-1.png`,
      "attacker.myshopify.com"
    );
    await deleteReferenceImage(`${PUBLIC}/attacker.myshopify.com%2F..%2Fvictim.myshopify.com%2Favatar-1.png`);
    await deleteReferenceImage(`${PUBLIC}/%2Fvictim.myshopify.com%2Favatar-1.png`);
    await deleteReferenceImage(`${PUBLIC}/attacker.myshopify.com%5C..%5Cvictim.myshopify.com%5Cavatar-1.png`);
    expect(removed).toEqual([]);
  });

  it("ignores URLs outside the reference-images bucket", async () => {
    await deleteReferenceImage("https://proj.supabase.co/storage/v1/object/public/other/x.png", "shop-a.myshopify.com");
    await deleteReferenceImage("not a url", "shop-a.myshopify.com");
    expect(removed).toEqual([]);
  });
});
