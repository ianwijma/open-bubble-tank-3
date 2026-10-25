/**
 * SWF bitmap decoders — faithful port of the bitmap half of
 * `research/swf-browser-extraction/swf.mjs`:
 *  - JPEG table stitching (DefineBits + JPEGTables),
 *  - JPEG3/JPEG4 zlib alpha maps composited via canvas 2D,
 *  - lossless bitmaps (20/36) inflated to pixels then drawn to a canvas.
 *
 * The pixel-expansion math (`expandLossless`) is factored out on the
 * already-inflated byte stream so it is pure and unit-testable; the
 * canvas-dependent decode step follows the proven extractor's hasCanvas()
 * guard.
 */

import { inflate } from "./container";
import { asBlobPart, u16, u32 } from "./bitReader";

/**
 * Rebuild a complete JPEG from a DefineBits fragment + the shared JPEGTables
 * tag. Most files embed a complete JPEG; old encoders split tables out.
 */
export function buildJPEG(tables: Uint8Array | null, data: Uint8Array): Uint8Array {
  if (data[0] === 0xff && data[1] === 0xd8) {
    if (data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9) return data;
    const out = new Uint8Array(data.length + 2);
    out.set(data);
    out.set([0xff, 0xd9], data.length);
    return out;
  }
  // Fragment: SOI + tables (minus SOI/EOI) + data (minus stray EOI) + EOI
  let t = tables ?? new Uint8Array(0);
  if (t[0] === 0xff && t[1] === 0xd8) t = t.subarray(2);
  if (t.length >= 2 && t[t.length - 2] === 0xff && t[t.length - 1] === 0xd9) t = t.subarray(0, t.length - 2);
  let d = data;
  if (d[0] === 0xff && d[1] === 0xd9) d = d.subarray(2); // old-Flash quirk: leading EOI
  const out = new Uint8Array(2 + t.length + d.length + 2);
  out.set([0xff, 0xd8], 0);
  out.set(t, 2);
  out.set(d, 2 + t.length);
  out.set([0xff, 0xd9], 2 + t.length + d.length);
  return out;
}

export interface SwfImage {
  id: number;
  tag: string;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  /** Encoded blob (always present). */
  blob: Blob;
  /** Decoded drawable (canvas) when a canvas is available. */
  source?: CanvasImageSource;
}

const hasCanvas = (): boolean =>
  typeof OffscreenCanvas !== "undefined" ||
  (typeof document !== "undefined" && typeof document.createElement === "function");

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function canvasToBlob(cv: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ("convertToBlob" in cv) return cv.convertToBlob({ type: "image/png" });
  return new Promise((res, rej) =>
    cv.toBlob((b) => (b ? res(b) : rej(new Error("canvas.toBlob failed"))), "image/png"),
  );
}

async function jpegDims(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== "function") return { width: 0, height: 0 };
  const bmp = await createImageBitmap(blob);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close?.();
  return dims;
}

/** Plain JPEG asset (DefineBits with tables / DefineBitsJPEG2). */
export async function imageFromJPEG(jpeg: Uint8Array, id: number, tagName: string): Promise<SwfImage> {
  const blob = new Blob([asBlobPart(jpeg)], { type: "image/jpeg" });
  const dims = await jpegDims(blob);
  return { id, tag: tagName, mimeType: "image/jpeg", blob, ...dims };
}

// ------------------------------------------------------------ lossless math

export interface RawPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Expand one lossless bitmap scanline stream (already inflated) into RGBA
 * pixels. `body` is the full tag body (needed for the colormap's
 * colorTableSize byte at offset 7).
 */
export function expandLossless(
  body: Uint8Array,
  data: Uint8Array,
  hasAlpha: boolean,
): RawPixels {
  const fmt = body[2]!;
  const w = u16(body, 3);
  const h = u16(body, 5);
  const px = new Uint8ClampedArray(w * h * 4);
  const put = (i: number, r: number, g: number, b: number, a: number): void => {
    const o = i * 4;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = a;
  };

  if (fmt === 3) {
    // colormap — colorTableSize lives in the TAG body (byte 7), palette starts at data[0]
    const nColors = body[7]! + 1;
    const entry = hasAlpha ? 4 : 3;
    const idx = nColors * entry;
    const rowBytes = (w + 3) & ~3; // 8bpp rows padded to 32-bit boundary
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = data[idx + y * rowBytes + x]! * entry;
        const i = y * w + x;
        if (hasAlpha) put(i, data[p]!, data[p + 1]!, data[p + 2]!, data[p + 3]!); // RGBA palette
        else put(i, data[p]!, data[p + 1]!, data[p + 2]!, 255);
      }
    }
  } else if (fmt === 4 && !hasAlpha) {
    // 15-bit RGB555 (tag 20 only)
    const rowBytes = (w * 2 + 3) & ~3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = y * rowBytes + x * 2;
        const v = (data[o]! << 8) | data[o + 1]!;
        const r = (v >> 10) & 31;
        const g = (v >> 5) & 31;
        const b = v & 31;
        put(y * w + x, (r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2), 255);
      }
    }
  } else if (fmt === 5) {
    for (let i = 0; i < w * h; i++) {
      const s = i * 4;
      if (hasAlpha) put(i, data[s + 1]!, data[s + 2]!, data[s + 3]!, data[s]!); // ARGB
      else put(i, data[s + 1]!, data[s + 2]!, data[s + 3]!, 255); // XRGB (byte0 ignored)
    }
  } else {
    throw new Error(`Unsupported lossless format ${fmt}${hasAlpha ? "" : " (tag 20)"}`);
  }
  return { width: w, height: h, data: px };
}

// --------------------------------------------------------------- decoders

/**
 * DefineBitsJPEG3/4: JPEG plus a zlib-compressed alpha map (1 byte per pixel).
 * `hasDebias` = JPEG4 (2 extra bytes before the alpha data).
 */
export async function decodeJPEG3(
  body: Uint8Array,
  tables: Uint8Array | null,
  hasDebias: boolean,
): Promise<SwfImage> {
  const id = u16(body, 0);
  const alphaOffset = u32(body, 2);
  const debias = hasDebias ? 2 : 0;
  const jpeg = buildJPEG(tables, body.subarray(6, 6 + alphaOffset));
  const alphaRaw = body.subarray(6 + alphaOffset + debias);
  if (alphaRaw.length === 0) {
    return {
      ...(await imageFromJPEG(jpeg, id, hasDebias ? "DefineBitsJPEG4" : "DefineBitsJPEG3")),
      mimeType: "image/jpeg",
    };
  }
  if (!hasCanvas()) throw new Error("canvas unavailable for alpha compositing");
  const alpha = await inflate(alphaRaw);
  const bmp = await createImageBitmap(new Blob([asBlobPart(jpeg)], { type: "image/jpeg" }));
  const w = bmp.width;
  const h = bmp.height;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  if (alpha.length >= w * h) {
    for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = alpha[i]!; // 8-bit alpha map, 1 byte/px
  }
  ctx.putImageData(img, 0, 0);
  const blob = await canvasToBlob(cv);
  return {
    id,
    tag: hasDebias ? "DefineBitsJPEG4" : "DefineBitsJPEG3",
    mimeType: "image/png",
    blob,
    width: w,
    height: h,
    source: cv as CanvasImageSource,
  };
}

/** DefineBitsLossless (20) / DefineBitsLossless2 (36). */
export async function decodeLossless(body: Uint8Array, hasAlpha: boolean): Promise<SwfImage> {
  const id = u16(body, 0);
  const fmt = body[2]!;
  const w = u16(body, 3);
  const h = u16(body, 5);
  // colormap format carries an extra colorTableSize byte before the zlib stream
  const data = await inflate(body.subarray(fmt === 3 ? 8 : 7));
  const raw = expandLossless(body, data, hasAlpha);

  if (!hasCanvas()) throw new Error("canvas unavailable for lossless decode");
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(raw.data), w, h), 0, 0);
  const blob = await canvasToBlob(cv);
  return {
    id,
    tag: hasAlpha ? "DefineBitsLossless2" : "DefineBitsLossless",
    mimeType: "image/png",
    blob,
    width: w,
    height: h,
    source: cv as CanvasImageSource,
  };
}
