/**
 * Top-level SWF asset extraction — merged, faithful port of
 * `extractAssets` (`research/swf-browser-extraction/swf.mjs`) and
 * `extractSymbols` (`swf-symbols.mjs`), minus the store-only ZIP export
 * (the game consumes assets directly instead of exporting them).
 *
 * Pipeline (same as the proven extractor):
 *   1. decompress (CWS → normalized FWS image),
 *   2. deep tag census,
 *   3. sync parse of every definition tag + SymbolClass,
 *   4. async decode of bitmap tags (JPEG tables stitching, alpha maps,
 *      lossless),
 *   5. usage map + static-text decoding via font code tables.
 *
 * Every per-tag failure is collected into `errors` instead of aborting, so a
 * single malformed tag cannot take down the whole asset load.
 */

import { decompressSWF, iterTags, readHeader, TAG_NAMES, type SwfHeaderInfo } from "./container";
import { u16, u32 } from "./bitReader";
import {
  buildJPEG,
  decodeJPEG3,
  decodeLossless,
  imageFromJPEG,
  type SwfImage,
} from "./images";
import { parseSound, type SwfSound } from "./sounds";
import {
  parseMorphShapeTag,
  parseShapeTag,
  type ParsedMorph,
  type ParsedShape,
} from "./shapes";
import {
  parseButtonTag,
  parseEditTextTag,
  parseExportAssets,
  parseFontNameTag,
  parseFontTag,
  parsePlace,
  parseSpriteTag,
  parseSymbolClass,
  parseTextTag,
  type ParsedButton,
  type ParsedEditText,
  type ParsedFont,
  type ParsedFontName,
  type ParsedSprite,
  type ParsedText,
} from "./symbols";

export * from "./bitReader";
export { decompressSWF, iterTags, readHeader, TAG_NAMES } from "./container";
export type { DecompressedSwf, SwfHeaderInfo, SwfTag } from "./container";
export * from "./art";
export * from "./images";
export * from "./sounds";
export * from "./shapes";
export * from "./symbols";
export * from "./canvas";
export { parseExportAssets } from "./symbols";

export interface SwfCensusEntry {
  code: number;
  name: string;
  top: number;
  nested: number;
}

export interface SwfCounts {
  tagsTopLevel: number;
  tagsNested: number;
  sprites: number;
  shapes: number;
  morphs: number;
  texts: number;
  fonts: number;
  buttons: number;
  abc: number;
  abcBytes: number;
  binaryData: number;
}

export type SwfCharacter =
  | { type: "shape"; shape: ParsedShape }
  | { type: "morph"; morph: ParsedMorph }
  | { type: "sprite"; sprite: ParsedSprite }
  | { type: "image"; image: SwfImage }
  | { type: "text"; text: ParsedText }
  | { type: "editText"; editText: ParsedEditText }
  | { type: "button"; button: ParsedButton };

export interface SwfAssetBundle {
  header: SwfHeaderInfo & { compression: "none" | "zlib"; sourceBytes: number };
  census: SwfCensusEntry[];
  counts: SwfCounts;
  images: Map<number, SwfImage>;
  sounds: Map<number, SwfSound>;
  shapes: ParsedShape[];
  morphs: ParsedMorph[];
  sprites: ParsedSprite[];
  texts: ParsedText[];
  editTexts: ParsedEditText[];
  fonts: ParsedFont[];
  fontNames: ParsedFontName[];
  buttons: ParsedButton[];
  binaryData: { id: number; bytes: number }[];
  videos: { id: number; frames: number }[];
  /** SymbolClass: character id → AS3 class name (cid 0 = document class). */
  symbolNames: Map<number, string>;
  /** Inverse of `symbolNames`: class name → character id. */
  symbolByName: Map<string, number>;
  /** ExportAssets: exported name → character id (sound/shape linkage). */
  exportedNames: Map<string, number>;
  /** character id → placing sprite ids (0 = main timeline). */
  usedBy: Map<number, number[]>;
  /** Every definable character id → its parsed record. */
  characters: Map<number, SwfCharacter>;
  errors: string[];
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Extract the full asset inventory from raw SWF bytes
 * (e.g. a user-supplied "Bubble Tanks 3.swf").
 */
export async function loadSwfAssets(raw: Uint8Array, log: (s: string) => void = () => {}): Promise<SwfAssetBundle> {
  const errors: string[] = [];

  const dec = await decompressSWF(raw);
  log(`decompressed ${dec.sig} v${dec.version}: ${raw.length} -> ${dec.bytes.length} bytes in ${dec.ms.toFixed(0)} ms`);

  const header = { ...readHeader(dec.bytes), compression: dec.compression, sourceBytes: raw.length };
  if (header.declaredLength !== 0 && header.declaredLength !== dec.bytes.length) {
    log(`note: declared length ${header.declaredLength} != actual ${dec.bytes.length}`);
  }

  // Pass 1 — deep census (sync, cheap). Definitions live at top level;
  // nested counts come from inside DefineSprite timelines.
  const censusMap = new Map<number, { top: number; nested: number }>();
  for (const tag of iterTags(dec.bytes, header.tagsOffset, { deep: true })) {
    const e = censusMap.get(tag.code) ?? { top: 0, nested: 0 };
    if (tag.depth === 0) e.top++;
    else e.nested++;
    censusMap.set(tag.code, e);
  }

  // Pass 2 — sync parse of definition tags + asset collection.
  const images = new Map<number, SwfImage>();
  const sounds = new Map<number, SwfSound>();
  const shapes: ParsedShape[] = [];
  const morphs: ParsedMorph[] = [];
  const sprites: ParsedSprite[] = [];
  const texts: ParsedText[] = [];
  const editTexts: ParsedEditText[] = [];
  const fonts: ParsedFont[] = [];
  const fontNames: ParsedFontName[] = [];
  const buttons: ParsedButton[] = [];
  const binaryData: { id: number; bytes: number }[] = [];
  const videos: { id: number; frames: number }[] = [];
  const symbolNames = new Map<number, string>();
  const exportedNames = new Map<string, number>();
  const abcSizes: number[] = [];
  let jpegTables: Uint8Array | null = null;
  type PendingBit =
    | { id: number; data: Uint8Array; tag: "DefineBits" | "DefineBitsJPEG2" }
    | { id: number; body: Uint8Array; tag: "DefineBitsJPEG3" | "DefineBitsJPEG4" | "DefineBitsLossless" | "DefineBitsLossless2" };
  const pendingBits: PendingBit[] = [];

  for (const tag of iterTags(dec.bytes, header.tagsOffset)) {
    try {
      switch (tag.code) {
        case 2:
        case 22:
        case 32:
        case 83:
          shapes.push(parseShapeTag(tag.body, tag.code));
          break;
        case 46:
        case 84:
          morphs.push(parseMorphShapeTag(tag.body, tag.code));
          break;
        case 39:
          sprites.push(parseSpriteTag(tag.body));
          break;
        case 37:
          editTexts.push(parseEditTextTag(tag.body));
          break;
        case 11:
        case 33:
          texts.push(parseTextTag(tag.body, tag.code));
          break;
        case 75: {
          const f = parseFontTag(tag.body, 75);
          if (f) fonts.push(f);
          break;
        }
        case 88:
          fontNames.push(parseFontNameTag(tag.body));
          break;
        case 34:
        case 7:
          buttons.push(parseButtonTag(tag.body, tag.code));
          break;
        case 87:
          binaryData.push({ id: u32(tag.body, 2), bytes: tag.len - 6 });
          break;
        case 60:
          videos.push({ id: u16(tag.body, 0), frames: u16(tag.body, 6) });
          break;
        case 76:
          parseSymbolClass(tag.body, symbolNames);
          break;
        case 56:
          parseExportAssets(tag.body, exportedNames);
          break;
        case 82:
        case 72:
          abcSizes.push(tag.len);
          break;
        // bitmaps & sounds
        case 8:
          jpegTables = tag.body;
          break;
        case 6:
          pendingBits.push({ id: u16(tag.body, 0), data: tag.body.subarray(2), tag: "DefineBits" });
          break;
        case 21:
          pendingBits.push({ id: u16(tag.body, 0), data: tag.body.subarray(2), tag: "DefineBitsJPEG2" });
          break;
        case 35:
          pendingBits.push({ id: u16(tag.body, 0), body: tag.body, tag: "DefineBitsJPEG3" });
          break;
        case 90:
          pendingBits.push({ id: u16(tag.body, 0), body: tag.body, tag: "DefineBitsJPEG4" });
          break;
        case 20:
          pendingBits.push({ id: u16(tag.body, 0), body: tag.body, tag: "DefineBitsLossless" });
          break;
        case 36:
          pendingBits.push({ id: u16(tag.body, 0), body: tag.body, tag: "DefineBitsLossless2" });
          break;
        case 14: {
          const s = parseSound(tag.body);
          sounds.set(s.id, s);
          break;
        }
      }
    } catch (e) {
      const msg = `${TAG_NAMES[tag.code] ?? tag.code} id=${u16(tag.body, 0)}: ${errMsg(e)}`;
      errors.push(msg);
      log(`ERROR ${msg}`);
    }
  }

  // Pass 3 — async bitmap decode.
  for (const rec of pendingBits) {
    try {
      if (rec.tag === "DefineBits" || rec.tag === "DefineBitsJPEG2") {
        const img = await imageFromJPEG(buildJPEG(jpegTables, rec.data), rec.id, rec.tag);
        images.set(rec.id, img);
      } else if (rec.tag === "DefineBitsJPEG3") {
        images.set(rec.id, await decodeJPEG3(rec.body, jpegTables, false));
      } else if (rec.tag === "DefineBitsJPEG4") {
        images.set(rec.id, await decodeJPEG3(rec.body, jpegTables, true));
      } else if (rec.tag === "DefineBitsLossless") {
        images.set(rec.id, await decodeLossless(rec.body, false));
      } else if (rec.tag === "DefineBitsLossless2") {
        images.set(rec.id, await decodeLossless(rec.body, true));
      }
    } catch (e) {
      const msg = `${rec.tag} id=${rec.id}: ${errMsg(e)}`;
      errors.push(msg);
      log(`ERROR ${msg}`);
    }
  }

  // Usage map: which sprite (0 = main timeline) places which character.
  const usedBy = new Map<number, number[]>();
  const addUse = (cid: number | undefined, user: number): void => {
    if (cid == null) return;
    const list = usedBy.get(cid) ?? [];
    list.push(user);
    usedBy.set(cid, list);
  };
  for (const sp of sprites) for (const p of sp.placements) addUse(p.charId, sp.id);
  for (const tag of iterTags(dec.bytes, header.tagsOffset)) {
    if (tag.code === 26 || tag.code === 70) {
      try {
        const p = parsePlace(tag.body, tag.code === 70);
        addUse(p.charId, 0);
      } catch {
        /* ignore */
      }
    }
  }

  // Decode static text strings via font code tables.
  const fontById = new Map(fonts.map((f) => [f.id, f]));
  for (const t of texts) {
    let str = "";
    for (const rec of t.records) {
      const font = rec.fontId !== undefined ? fontById.get(rec.fontId) : undefined;
      for (const g of rec.glyphs) {
        const code = font?.codeTable[g.index];
        str += code ? String.fromCharCode(code) : "?";
      }
    }
    t.string = str || null;
  }

  // Character id → record (what PlaceObject can instantiate).
  const characters = new Map<number, SwfCharacter>();
  for (const s of shapes) characters.set(s.id, { type: "shape", shape: s });
  for (const m of morphs) characters.set(m.id, { type: "morph", morph: m });
  for (const sp of sprites) characters.set(sp.id, { type: "sprite", sprite: sp });
  for (const [id, img] of images) characters.set(id, { type: "image", image: img });
  for (const t of texts) characters.set(t.id, { type: "text", text: t });
  for (const e of editTexts) characters.set(e.id, { type: "editText", editText: e });
  for (const b of buttons) characters.set(b.id, { type: "button", button: b });

  // Inverse SymbolClass map.
  const symbolByName = new Map<string, number>();
  for (const [cid, name] of symbolNames) if (!symbolByName.has(name)) symbolByName.set(name, cid);

  const censusArr: SwfCensusEntry[] = [...censusMap.entries()]
    .map(([code, c]) => ({ code, name: TAG_NAMES[code] ?? `Unknown(${code})`, ...c }))
    .sort((a, b) => b.top - a.top || b.nested - a.nested || a.code - b.code);

  const n = (code: number): number => censusMap.get(code)?.top ?? 0;
  const counts: SwfCounts = {
    tagsTopLevel: [...censusMap.values()].reduce((a, c) => a + c.top, 0),
    tagsNested: [...censusMap.values()].reduce((a, c) => a + c.nested, 0),
    sprites: n(39),
    shapes: n(2) + n(22) + n(32) + n(83),
    morphs: n(46) + n(84),
    texts: n(11) + n(33) + n(37),
    fonts: n(10) + n(48) + n(75) + n(91),
    buttons: n(7) + n(34),
    abc: abcSizes.length,
    abcBytes: abcSizes.reduce((a, b) => a + b, 0),
    binaryData: binaryData.length,
  };

  log(`extracted ${images.size} images, ${sounds.size} sounds, ${sprites.length} sprites, ${shapes.length} shapes`);
  if (errors.length) log(`WARNING: ${errors.length} parse errors (first: ${errors[0]})`);

  return {
    header,
    census: censusArr,
    counts,
    images,
    sounds,
    shapes,
    morphs,
    sprites,
    texts,
    editTexts,
    fonts,
    fontNames,
    buttons,
    binaryData,
    videos,
    symbolNames,
    symbolByName,
    exportedNames,
    usedBy,
    characters,
    errors,
  };
}

/** Look up a character by its AS3 class name (SymbolClass binding). */
export function characterByClassName(bundle: SwfAssetBundle, name: string): SwfCharacter | undefined {
  const cid = bundle.symbolByName.get(name);
  return cid === undefined ? undefined : bundle.characters.get(cid);
}
