/**
 * SWF symbol parsers — faithful port of the placement/text/font half of
 * `research/swf-browser-extraction/swf-symbols.mjs` plus the SymbolClass
 * reader from `swf.mjs`:
 *  - DefineSprite → placement graph (child ids, depths, matrices, names,
 *    frames, sound starts) + nested tag census,
 *  - PlaceObject2/3 records (color transforms are RETAINED here — the game
 *    needs them for placed-clip tinting; the research extractor discarded
 *    their values but read the identical bit layout),
 *  - DefineText/2 → glyph runs decoded to strings via font code tables,
 *  - DefineEditText → initial text, font, size, color, flags,
 *  - DefineFont3 → name, glyph count, code table,
 *  - DefineFontName, DefineButton1/2, SymbolClass.
 */

import { iterTags } from "./container";
import {
  BitReader,
  readColor,
  readCxform,
  readMatrix,
  readRect,
  u16,
  u32,
  type SwfColor,
  type SwfCxform,
  type SwfMatrix,
  type SwfRect,
} from "./bitReader";
import type { FillStyle } from "./shapes";

// ------------------------------------------------------------------ sprite

export interface SpritePlacement {
  depth: number;
  isPO3: boolean;
  charId?: number;
  matrix?: SwfMatrix;
  colorTransform?: SwfCxform;
  ratio?: number;
  name?: string;
  clipDepth?: number;
  className?: string;
  frame: number;
}

export interface ParsedSprite {
  id: number;
  tagCode: 39;
  frameCount: number;
  placements: SpritePlacement[];
  soundStarts: { soundId: number; frame: number }[];
  nestedTags: Record<number, number>;
}

export function parseSpriteTag(body: Uint8Array): ParsedSprite {
  const br = new BitReader(body);
  const id = br.b2();
  const frameCount = br.b2();
  const placements: SpritePlacement[] = [];
  const soundStarts: { soundId: number; frame: number }[] = [];
  const nestedTags: Record<number, number> = {};
  let frame = 1;
  for (const t of iterTags(body, 4)) {
    nestedTags[t.code] = (nestedTags[t.code] ?? 0) + 1;
    if (t.code === 1) frame++;
    else if (t.code === 26 || t.code === 70) {
      try {
        const p = parsePlace(t.body, t.code === 70);
        if (p) placements.push({ ...p, frame });
      } catch {
        /* skip malformed placements */
      }
    } else if (t.code === 15) soundStarts.push({ soundId: u16(t.body, 0), frame });
  }
  return { id, tagCode: 39, frameCount, placements, soundStarts, nestedTags };
}

export function parsePlace(body: Uint8Array, isPO3: boolean): SpritePlacement {
  const br = new BitReader(body);
  const flags = br.ub(8);
  const hasClipActions = (flags & 0x80) !== 0,
    hasClipDepth = (flags & 0x40) !== 0,
    hasName = (flags & 0x20) !== 0,
    hasRatio = (flags & 0x10) !== 0,
    hasColor = (flags & 0x08) !== 0,
    hasMatrix = (flags & 0x04) !== 0,
    hasChar = (flags & 0x02) !== 0,
    move = (flags & 0x01) !== 0;
  void move;
  const depth = br.b2();
  const p: SpritePlacement = { depth, isPO3, frame: 0 };
  if (isPO3) {
    const f2 = br.ub(8);
    const hasOpaqueBg = (f2 & 0x40) !== 0,
      hasVisible = (f2 & 0x20) !== 0,
      hasImage = (f2 & 0x10) !== 0,
      hasClassName = (f2 & 0x08) !== 0,
      hasCache = (f2 & 0x04) !== 0,
      hasBlend = (f2 & 0x02) !== 0,
      hasFilters = (f2 & 0x01) !== 0;
    void hasImage;
    void hasCache;
    if (hasClassName) p.className = br.string();
    else if (hasChar) p.charId = br.b2();
    if (hasMatrix) p.matrix = readMatrix(br);
    if (hasColor) p.colorTransform = readCxform(br);
    if (hasRatio) p.ratio = br.b2();
    if (hasName) p.name = br.string();
    if (hasClipDepth) p.clipDepth = br.b2();
    if (hasFilters) skipFilterList(br);
    if (hasBlend) br.b1();
    if (hasOpaqueBg) br.bytes(4); // SWF11+ — not expected in v10
    if (hasVisible) {
      br.b1();
      br.b1();
    } // SWF11+
    if (hasClipActions) skipClipActions(br);
    return p;
  }
  if (hasChar) p.charId = br.b2();
  if (hasMatrix) p.matrix = readMatrix(br);
  if (hasColor) p.colorTransform = readCxform(br);
  if (hasRatio) p.ratio = br.b2();
  if (hasName) p.name = br.string();
  if (hasClipDepth) p.clipDepth = br.b2();
  if (hasClipActions) skipClipActions(br);
  return p;
}

// ------------------------------------------------------------- skip helpers

function skipFilterList(br: BitReader): void {
  const n = br.b1();
  for (let i = 0; i < n; i++) skipFilter(br);
}

function skipFilter(br: BitReader): void {
  const id = br.b1();
  const B = (n: number): void => {
    br.p += n * 8;
  };
  switch (id) {
    case 0: B(4 + 4 + 4 + 4 + 4 + 2 + 1); break; // drop shadow
    case 1: B(4 + 4 + 1); break; // blur
    case 2: B(4 + 4 + 4 + 2 + 1); break; // glow
    case 3: B(4 + 4 + 4 + 4 + 4 + 4 + 2 + 1); break; // bevel
    case 4:
    case 7: {
      // gradient glow / bevel
      const n = br.b1();
      B(n * 5);
      B(4 * 4 + 2 + 1);
      break;
    }
    case 5: {
      // convolution
      const w = br.b1();
      const h = br.b1();
      B(8 + 4 * w * h + 4 + 1);
      break;
    }
    case 6: B(20 * 4); break; // color matrix
    default: throw new Error(`unknown filter id ${id}`);
  }
}

function skipClipActions(br: BitReader): void {
  br.b2(); // reserved
  br.b4(); // allEventFlags (SWF6+)
  for (;;) {
    if (!(br.p < br.u8.length * 8)) throw new Error("unterminated clip actions");
    const flags = br.b4();
    if (flags === 0) break;
    if (flags & 0x0800) br.b1(); // keyPressed → keyCode
    skipActionRecords(br);
  }
}

function skipActionRecords(br: BitReader): void {
  for (;;) {
    if (!(br.p < br.u8.length * 8)) throw new Error("unterminated action records");
    const op = br.b1();
    if (op === 0) break;
    if (op >= 0x80) {
      const len = br.b2();
      br.p += len * 8;
    }
  }
}

// -------------------------------------------------------------------- text

export interface ParsedEditText {
  id: number;
  tagCode: 37;
  bounds: SwfRect;
  flags: {
    hasText: boolean;
    wordWrap: boolean;
    multiline: boolean;
    password: boolean;
    readOnly: boolean;
    hasTextColor: boolean;
    hasMaxLength: boolean;
    hasFont: boolean;
    hasFontClass: boolean;
    autoSize: boolean;
    hasLayout: boolean;
    noSelect: boolean;
    border: boolean;
    wasStatic: boolean;
    html: boolean;
    useOutlines: boolean;
  };
  fontId?: number;
  fontClass?: string;
  fontHeight?: number;
  color?: SwfColor;
  maxLength?: number;
  align?: number;
  margins?: [number, number, number];
  leading?: number;
  variableName: string;
  text?: string;
}

export function parseEditTextTag(body: Uint8Array): ParsedEditText {
  const br = new BitReader(body);
  const id = br.b2();
  const bounds = readRect(br);
  // 16 flag bits, in spec order (bit 0 = hasText … bit 15 = useOutlines)
  const f = {
    hasText: br.ub(1) === 1,
    wordWrap: br.ub(1) === 1,
    multiline: br.ub(1) === 1,
    password: br.ub(1) === 1,
    readOnly: br.ub(1) === 1,
    hasTextColor: br.ub(1) === 1,
    hasMaxLength: br.ub(1) === 1,
    hasFont: br.ub(1) === 1,
    hasFontClass: br.ub(1) === 1,
    autoSize: br.ub(1) === 1,
    hasLayout: br.ub(1) === 1,
    noSelect: br.ub(1) === 1,
    border: br.ub(1) === 1,
    wasStatic: br.ub(1) === 1,
    html: br.ub(1) === 1,
    useOutlines: br.ub(1) === 1,
  };
  const { hasFont, hasFontClass, hasTextColor, hasMaxLength, hasLayout, hasText } = f;
  const e: ParsedEditText = {
    id,
    tagCode: 37,
    bounds,
    flags: f,
    variableName: "",
  };
  if (hasFont) e.fontId = br.b2();
  if (hasFontClass) e.fontClass = br.string();
  if (hasFont || hasFontClass) e.fontHeight = br.b2();
  if (hasTextColor) e.color = readColor(br, 4);
  if (hasMaxLength) e.maxLength = br.b2();
  if (hasLayout) {
    e.align = br.b1();
    e.margins = [br.b2(), br.b2(), br.b2()];
    e.leading = br.sb(16);
  }
  e.variableName = br.string();
  if (hasText) e.text = br.string();
  return e;
}

export interface ParsedFont {
  id: number;
  tagCode: number;
  name: string;
  numGlyphs: number;
  codeTable: number[];
  italic: boolean;
  bold: boolean;
  hasLayout: boolean;
  wideCodes: boolean;
  ascent?: number;
  descent?: number;
  leading?: number;
}

export function parseFontTag(body: Uint8Array, tagCode: number): ParsedFont | null {
  if (tagCode !== 75) return null; // only DefineFont3 ships in this file
  const br = new BitReader(body);
  const id = br.b2();
  const hasLayout = br.ub(1) === 1,
    shiftJIS = br.ub(1) === 1,
    smallText = br.ub(1) === 1,
    ansi = br.ub(1) === 1,
    wideOffsets = br.ub(1) === 1,
    wideCodes = br.ub(1) === 1,
    italic = br.ub(1) === 1,
    bold = br.ub(1) === 1;
  void shiftJIS;
  void smallText;
  void ansi;
  br.ub(8); // language code
  const name = br.netString();
  const numGlyphs = br.b2();
  const offsetsStart = br.p >> 3;
  if (numGlyphs > 0) {
    for (let i = 0; i < numGlyphs; i++) br.bytes(wideOffsets ? 4 : 2); // glyph offsets (shapes skipped)
    const codeTableOffset = br.bytes(wideOffsets ? 4 : 2);
    const codeOffset = wideOffsets ? u32(codeTableOffset, 0) : u16(codeTableOffset, 0);
    br.p = (offsetsStart + codeOffset) * 8; // code table lives after the glyph shapes
  }
  const codeTable: number[] = [];
  for (let i = 0; i < numGlyphs; i++) codeTable.push(wideCodes ? br.b2() : br.b1());
  const f: ParsedFont = { id, tagCode, name, numGlyphs, codeTable, italic, bold, hasLayout, wideCodes };
  if (hasLayout) {
    f.ascent = br.b2();
    f.descent = br.b2();
    f.leading = br.sb(16);
  }
  return f;
}

export interface ParsedFontName {
  id: number;
  tagCode: 88;
  name: string;
  copyright: string;
}

export function parseFontNameTag(body: Uint8Array): ParsedFontName {
  const br = new BitReader(body);
  const id = br.b2();
  br.ub(1);
  br.ub(1);
  br.ub(6); // italic, bold, reserved
  const name = br.string();
  const copyright = br.string();
  return { id, tagCode: 88, name, copyright };
}

export interface TextGlyph {
  index: number;
  advance: number;
}

export interface TextRecord {
  fontId?: number;
  color?: SwfColor;
  x?: number;
  y?: number;
  height?: number;
  glyphs: TextGlyph[];
}

export interface ParsedText {
  id: number;
  tagCode: number;
  bounds: SwfRect;
  matrix: SwfMatrix;
  records: TextRecord[];
  string?: string | null;
}

export function parseTextTag(body: Uint8Array, tagCode: number): ParsedText {
  const br = new BitReader(body);
  const id = br.b2();
  const bounds = readRect(br);
  const m = readMatrix(br);
  // NOTE: verified against FFDec's parse of this file — there is no tag-level
  // glyphCount field; the header is just the two bit-widths.
  const glyphBits = br.b1();
  const advanceBits = br.b1();
  const records: TextRecord[] = [];
  for (;;) {
    if (!(br.p < br.u8.length * 8)) throw new Error("unterminated text records");
    const first = br.ub(1);
    if (first === 0) {
      br.ub(7);
      break;
    } // terminator record (reserved + flag bits)
    br.ub(3); // reserved style flags
    const hasFont = br.ub(1) === 1,
      hasColor = br.ub(1) === 1,
      hasYOff = br.ub(1) === 1,
      hasXOff = br.ub(1) === 1;
    const rec: TextRecord = { glyphs: [] };
    if (hasFont) rec.fontId = br.b2(); // UI16 for both DefineText and DefineText2 (verified)
    if (hasColor) rec.color = readColor(br, tagCode === 33 ? 4 : 3);
    if (hasXOff) rec.x = br.sb(16);
    if (hasYOff) rec.y = br.sb(16);
    if (hasFont) rec.height = br.b2();
    const n = br.b1();
    for (let i = 0; i < n; i++) rec.glyphs.push({ index: br.ub(glyphBits), advance: br.sb(advanceBits) });
    br.align();
    records.push(rec);
    if (records.length > 8192) throw new Error("text record overflow");
  }
  return { id, tagCode, bounds, matrix: m, records };
}

// ------------------------------------------------------------------ buttons

export interface ParsedButton {
  id: number;
  tagCode: number;
  states: {
    states: { hit: boolean; down: boolean; over: boolean; up: boolean };
    charId: number;
    depth: number;
  }[];
  hasActions?: boolean;
}

export function parseButtonTag(body: Uint8Array, tagCode: number): ParsedButton {
  const br = new BitReader(body);
  const id = br.b2();
  const states: ParsedButton["states"] = [];
  if (tagCode === 7) {
    for (;;) {
      if (!(br.p < br.u8.length * 8)) throw new Error("unterminated button records");
      const flags = br.ub(8); // flag bits continue unaligned after the previous matrix
      if (flags === 0) break;
      states.push({
        states: { hit: (flags & 8) !== 0, down: (flags & 4) !== 0, over: (flags & 2) !== 0, up: (flags & 1) !== 0 },
        charId: br.b2(),
        depth: br.b2(),
      });
      readMatrix(br);
    }
    return { id, tagCode, states };
  }
  br.ub(7);
  br.ub(1); // reserved + trackAsMenu
  const actionOffset = br.b2();
  for (;;) {
    if (!(br.p < br.u8.length * 8)) throw new Error("unterminated button records");
    const flags = br.ub(8); // flag bits continue unaligned after the previous matrix
    if (flags === 0) break;
    states.push({
      states: { hit: (flags & 8) !== 0, down: (flags & 4) !== 0, over: (flags & 2) !== 0, up: (flags & 1) !== 0 },
      charId: br.b2(),
      depth: br.b2(),
    });
    readMatrix(br);
    br.align(); // the record's color transform is byte-aligned (verified 37/37)
    readCxform(br); // DefineButton2 records always carry a color transform
    if (flags & 0x10) skipFilterList(br); // buttonHasFilterList
    if (flags & 0x20) br.b1(); // buttonHasBlendMode
  }
  return { id, tagCode, states, hasActions: actionOffset > 0 };
}

// -------------------------------------------------------------- symbol class

/** SymbolClass (tag 76): cid → AS3 class name. */
export function parseSymbolClass(body: Uint8Array, map: Map<number, string>): void {
  const n = u16(body, 0);
  let p = 2;
  for (let i = 0; i < n && p < body.length; i++) {
    const cid = u16(body, p);
    p += 2;
    let e = p;
    while (e < body.length && body[e] !== 0) e++;
    map.set(cid, new TextDecoder("ascii").decode(body.subarray(p, e)));
    p = e + 1;
  }
}

/**
 * ExportAssets (tag 56): exported name → character id. Sounds exported for
 * AS linkage (e.g. `_ -9w`) are bound here — the game's audio cues resolve
 * through this map.
 */
export function parseExportAssets(body: Uint8Array, map: Map<string, number>): void {
  const n = u16(body, 0);
  let p = 2;
  for (let i = 0; i < n && p < body.length; i++) {
    const cid = u16(body, p);
    p += 2;
    let e = p;
    while (e < body.length && body[e] !== 0) e++;
    map.set(new TextDecoder("ascii").decode(body.subarray(p, e)), cid);
    p = e + 1;
  }
}

// re-export for loader convenience
export type { FillStyle };
