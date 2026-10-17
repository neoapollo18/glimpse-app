import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import sharp from "sharp";

// heic-convert is the expensive decode the pixel cap and the concurrency
// slots exist to guard; a spy shows whether (and how often) it would run.
// heic-decode stays real so the header read is exercised for real.
const heicConvertMock = vi.hoisted(() => vi.fn());
vi.mock("heic-convert", () => ({ default: heicConvertMock }));

import { compressImage } from "../ai.server";

const b64 = (buf: Buffer) => buf.toString("base64");

// The test sharp build has no HEVC encoder, so stand in for an iPhone HEIC
// with an AV1 HEIF re-branded as 'mif1': same container, same header
// fields (ispe width/height) that heic-decode reads, a few KB on the wire.
async function heifOfSize(width: number, height: number): Promise<Buffer> {
  const avif = await sharp({ create: { width, height, channels: 3, background: "#806040" } })
    .avif({ effort: 0, quality: 30 })
    .toBuffer();
  const buf = Buffer.from(avif);
  buf.write("mif1", 8, "latin1");
  return buf;
}

let smallJpeg: Buffer;

beforeAll(async () => {
  smallJpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c08060" } })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  heicConvertMock.mockReset();
  heicConvertMock.mockImplementation(async () => smallJpeg);
});

describe("compressImage: undecodable uploads", () => {
  const junk = Buffer.from("not an image at all. ".repeat(500));

  it.each(["text/plain", "application/pdf", "audio/mp4", "video/mp4", ""])(
    "refuses bytes sharp can't read declared as %j instead of forwarding them",
    async (mime) => {
      await expect(compressImage(b64(junk), mime)).rejects.toThrow(/^UNSUPPORTED_IMAGE/);
    },
  );

  it("keeps the full-size fallback for undecodable bytes declared as an image", async () => {
    const out = await compressImage(b64(junk), "image/png");
    expect(out.compressedMimeType).toBe("image/png");
    expect(out.compressedBase64).toBe(b64(junk));
  });
});

describe("compressImage: real photos are unchanged", () => {
  it("resizes a photo to a JPEG within maxPx", async () => {
    const png = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#a07050" } })
      .png()
      .toBuffer();
    const out = await compressImage(b64(png), "image/png", 720);
    expect(out.compressedMimeType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(out.compressedBase64, "base64")).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(720);
  });

  it("still decodes a photo whose browser sent no type", async () => {
    const out = await compressImage(b64(smallJpeg), "");
    expect(out.compressedMimeType).toBe("image/jpeg");
  });

  it("does not resize past the input pixel cap (falls back like any decode failure)", async () => {
    // 100,005,000 px of flat colour: under 3 MB as a PNG.
    const bomb = await sharp({ create: { width: 20001, height: 5000, channels: 3, background: "#808080" } })
      .png({ compressionLevel: 1 })
      .toBuffer();
    const out = await compressImage(b64(bomb), "image/png");
    expect(out.compressedMimeType).toBe("image/png");
    expect(out.compressedBase64).toBe(b64(bomb));
  });
});

describe("compressImage: HEIC", () => {
  it("converts an iPhone-sized (48 MP) HEIC as before", async () => {
    const heic = await heifOfSize(8064, 6048);
    const out = await compressImage(b64(heic), "image/heic");
    expect(heicConvertMock).toHaveBeenCalledTimes(1);
    expect(out.compressedMimeType).toBe("image/jpeg");
  });

  it("rejects a HEIC declaring more than 60 MP before decoding it", async () => {
    const heic = await heifOfSize(9000, 7000);
    await expect(compressImage(b64(heic), "image/heic")).rejects.toThrow(/^UNSUPPORTED_IMAGE: .*pixel limit/);
    expect(heicConvertMock).not.toHaveBeenCalled();
  });

  it("applies the cap when only the magic bytes say HEIC", async () => {
    const heic = await heifOfSize(9000, 7000);
    await expect(compressImage(b64(heic), "image/jpeg")).rejects.toThrow(/^UNSUPPORTED_IMAGE/);
    expect(heicConvertMock).not.toHaveBeenCalled();
  });

  it("runs at most two conversions at once and queues the rest", async () => {
    const heic = await heifOfSize(64, 64);
    const releases: Array<() => void> = [];
    heicConvertMock.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve(smallJpeg))),
    );

    const runs = [1, 2, 3].map(() => compressImage(b64(heic), "image/heic"));
    await vi.waitFor(() => expect(heicConvertMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(heicConvertMock).toHaveBeenCalledTimes(2);

    releases[0]();
    await vi.waitFor(() => expect(heicConvertMock).toHaveBeenCalledTimes(3));
    releases[1]();
    releases[2]();
    const outs = await Promise.all(runs);
    expect(outs.every((o) => o.compressedMimeType === "image/jpeg")).toBe(true);
  });

  it("frees the slot when a conversion fails", async () => {
    const heic = await heifOfSize(64, 64);
    heicConvertMock.mockRejectedValue(new Error("decode failed"));
    for (let i = 0; i < 3; i++) {
      await expect(compressImage(b64(heic), "image/heic")).rejects.toThrow(/^UNSUPPORTED_IMAGE/);
    }
    heicConvertMock.mockImplementation(async () => smallJpeg);
    const out = await compressImage(b64(heic), "image/heic");
    expect(out.compressedMimeType).toBe("image/jpeg");
  });
});
