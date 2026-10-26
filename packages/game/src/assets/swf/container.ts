/**
 * SWF container — faithful port of the container half of
 * `research/swf-browser-extraction/swf.mjs`:
 * signature detection + decompression (CWS via DecompressionStream), the
 * uncompressed header, and the tag walker (optionally descending into
 * DefineSprite timelines).
 *
 * ZWS (LZMA) SWFs are deliberately unsupported, as in the research extractor.
 */

import { asBlobPart, BitReader, readRect, u16, u32, type SwfRect } from "./bitReader";

export async function inflate(zlibBytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([asBlobPart(zlibBytes)]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface DecompressedSwf {
  /** Normalized, fully-uncompressed SWF image (CWS re-wrapped with FWS header). */
  bytes: Uint8Array;
  /** ORIGINAL signature. */
  sig: "FWS" | "CWS" | "ZWS";
  version: number;
  declaredLength: number;
  compression: "none" | "zlib";
  ms: number;
}

export async function decompressSWF(raw: Uint8Array): Promise<DecompressedSwf> {
  const sig = String.fromCharCode(raw[0]!, raw[1]!, raw[2]!) as DecompressedSwf["sig"];
  const version = raw[3]!;
  const declaredLength = u32(raw, 4);
  if (sig === "FWS") return { bytes: raw, sig, version, declaredLength, compression: "none", ms: 0 };
  if (sig === "CWS") {
    const t0 = now();
    let body: Uint8Array;
    try {
      body = await inflate(raw.subarray(8));
    } catch {
      // Some dumps carry a stale CWS signature over an uncompressed body
      // (the dossier's binary does: file size == declared length). Be
      // liberal — try the body as raw tag data before giving up.
      if (raw.length === declaredLength) {
        body = raw.subarray(8);
      } else {
        throw new Error("SWF zlib stream is corrupt (and the body is not an uncompressed fallback)");
      }
    }
    const bytes = new Uint8Array(8 + body.length);
    bytes[0] = 0x46; // F
    bytes[1] = 0x57; // W
    bytes[2] = 0x53; // S
    bytes[3] = version;
    new DataView(bytes.buffer).setUint32(4, declaredLength, true);
    bytes.set(body, 8);
    return { bytes, sig, version, declaredLength, compression: "zlib", ms: now() - t0 };
  }
  if (sig === "ZWS") throw new Error("ZWS (LZMA-compressed) SWF is not supported by this extractor");
  throw new Error(`Not a SWF file (signature "${sig}")`);
}

const now = (): number => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

export interface SwfHeaderInfo {
  sig: string;
  version: number;
  declaredLength: number;
  rect: SwfRect;
  frameRate: number;
  frameCount: number;
  stageWidthPx: number;
  stageHeightPx: number;
  tagsOffset: number;
}

/** Parse the uncompressed header: stage rect, frame rate, frame count. */
export function readHeader(b: Uint8Array): SwfHeaderInfo {
  const sig = String.fromCharCode(b[0]!, b[1]!, b[2]!);
  const br = new BitReader(b, 8 * 8);
  const rect = readRect(br);
  const p = br.p >> 3; // readRect ends byte-aligned
  const frameRate = (b[p]! | (b[p + 1]! << 8)) / 256; // 8.8 fixed point
  const frameCount = u16(b, p + 2);
  return {
    sig,
    version: b[3]!,
    declaredLength: u32(b, 4),
    rect,
    frameRate,
    frameCount,
    stageWidthPx: (rect.xMax - rect.xMin) / 20,
    stageHeightPx: (rect.yMax - rect.yMin) / 20,
    tagsOffset: p + 4,
  };
}

// ---------------------------------------------------------------- tag names

export const TAG_NAMES: Record<number, string> = {
  0: "End",
  1: "ShowFrame",
  2: "DefineShape",
  4: "PlaceObject",
  5: "RemoveObject",
  6: "DefineBits",
  7: "DefineButton",
  8: "JPEGTables",
  9: "SetBackgroundColor",
  10: "DefineFont",
  11: "DefineText",
  12: "DoAction",
  13: "DefineFontInfo",
  14: "DefineSound",
  15: "StartSound",
  17: "DefineButtonSound",
  18: "SoundStreamHead",
  19: "SoundStreamBlock",
  20: "DefineBitsLossless",
  21: "DefineBitsJPEG2",
  22: "DefineShape2",
  23: "DefineButtonCxform",
  24: "Protect",
  26: "PlaceObject2",
  28: "RemoveObject2",
  32: "DefineShape3",
  33: "DefineText2",
  34: "DefineButton2",
  35: "DefineBitsJPEG3",
  36: "DefineBitsLossless2",
  37: "DefineEditText",
  39: "DefineSprite",
  41: "ProductInfo",
  43: "FrameLabel",
  45: "SoundStreamHead2",
  46: "DefineMorphShape",
  48: "DefineFont2",
  56: "ExportAssets",
  57: "ImportAssets",
  58: "EnableDebugger",
  59: "DoInitAction",
  60: "DefineVideoStream",
  61: "VideoFrame",
  62: "DefineFontInfo2",
  64: "EnableDebugger2",
  65: "ScriptLimits",
  66: "SetTabIndex",
  69: "FileAttributes",
  70: "PlaceObject3",
  71: "ImportAssets2",
  72: "DoABC",
  73: "DefineFontAlignZones",
  74: "CSMTextSettings",
  75: "DefineFont3",
  76: "SymbolClass",
  77: "Metadata",
  78: "DefineScalingGrid",
  82: "DoABC2",
  83: "DefineShape4",
  84: "DefineMorphShape2",
  86: "DefineSceneAndFrameLabelData",
  87: "DefineBinaryData",
  88: "DefineFontName",
  89: "StartSound2",
  90: "DefineBitsJPEG4",
  91: "DefineFont4",
  93: "EnableTelemetry",
};

// ---------------------------------------------------------------- tag walk

export interface SwfTag {
  index: number;
  code: number;
  len: number;
  /** Tag body (subarray view — nothing copied). */
  body: Uint8Array;
  /** 0 = top level, >0 = nested inside DefineSprite. */
  depth: number;
}

/**
 * Iterate tag records. `bytes` is a subarray view (copy nothing).
 * `deep` also yields the tags nested inside DefineSprite bodies
 * (counted with depth > 0 — definitions themselves live at top level).
 */
export function* iterTags(bytes: Uint8Array, start = 0, { deep = false } = {}): Generator<SwfTag> {
  const walk = function* (offset: number, depth: number): Generator<SwfTag> {
    let p = offset;
    let i = 0;
    while (p + 2 <= bytes.length) {
      const codeLen = u16(bytes, p);
      const code = codeLen >> 6;
      let len = codeLen & 0x3f;
      p += 2;
      if (len === 0x3f) {
        if (p + 4 > bytes.length) return;
        len = u32(bytes, p);
        p += 4;
      }
      if (p + len > bytes.length) return; // truncated file
      const body = bytes.subarray(p, p + len);
      yield { index: i++, code, len, body, depth };
      if (deep && code === 39 && len >= 4) yield* walk(p + 4, depth + 1); // DefineSprite: id + frameCount + tags
      p += len;
      if (code === 0) return;
    }
  };
  yield* walk(start, 0);
}
