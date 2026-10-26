/**
 * SWF vector shape parsing — faithful port of the shape half of
 * `research/swf-browser-extraction/swf-symbols.mjs`:
 *  - fill/line style arrays (solid, linear/radial/focal gradients, bitmap
 *    fills; morph variants),
 *  - the shape-record edge machine producing style-attributed runs,
 *  - DefineShape 1-4 and DefineMorphShape 1-2.
 *
 * Unlike the research file (which emits SVG documents), this module keeps the
 * parsed structures — Canvas2D path layers are built in `canvas.ts`, and a
 * debugging SVG generator lives in `svg.ts`.
 */

import { BitReader, readColor, readMatrix, readRect, type SwfColor, type SwfMatrix, type SwfRect } from "./bitReader";

// ------------------------------------------------------------------- styles

export type FillKind = "solid" | "linear" | "radial" | "focal" | "bitmap";

export interface GradientStop {
  ratio: number;
  /** Non-morph color. */
  color?: SwfColor;
  /** Morph start/end colors. */
  startColor?: SwfColor;
  endColor?: SwfColor;
}

export interface FillStyle {
  kind: FillKind;
  /** Solid (non-morph). */
  color?: SwfColor;
  /** Solid (morph). */
  startColor?: SwfColor;
  endColor?: SwfColor;
  /** Gradient/bitmap matrix (start state for morphs); tx/ty in twips. */
  matrix?: SwfMatrix;
  /** Morph end matrix. */
  endMatrix?: SwfMatrix;
  /** Gradients. */
  spreadMode?: number;
  stops?: GradientStop[];
  /** Focal gradients (type 0x13). */
  focal?: number;
  /** Bitmap fills. */
  bitmapId?: number;
  mode?: "repeating" | "clipped";
  smooth?: boolean;
}

export interface LineStyle {
  /** Stroke width in twips (non-morph). */
  width?: number;
  color?: SwfColor;
  /** LINESTYLE2 (DefineShape4). */
  startCap?: number;
  join?: number;
  endCap?: number;
  miterLimit?: number;
  noHScale?: boolean;
  noVScale?: boolean;
  pixelHinting?: boolean;
  noClose?: boolean;
  /** Fill-style stroke (LINESTYLE2 hasFill). */
  fill?: FillStyle;
  /** Morph line styles. */
  startWidth?: number;
  endWidth?: number;
  startColor?: SwfColor;
  endColor?: SwfColor;
}

function readFillStyle(br: BitReader, shapeNum: number, morph = false): FillStyle {
  const type = br.b1();
  const st: FillStyle = { kind: "solid" };
  if (type === 0x00) {
    st.kind = "solid";
    if (morph) {
      st.startColor = readColor(br, 4);
      st.endColor = readColor(br, 4);
    } else {
      st.color = readColor(br, shapeNum >= 3 ? 4 : 3);
    }
  } else if (type === 0x10 || type === 0x12 || type === 0x13) {
    st.kind = type === 0x10 ? "linear" : type === 0x13 ? "focal" : "radial";
    st.matrix = readMatrix(br);
    if (morph) {
      // morph writers byte-align each matrix (verified: both matrices
      // identical 7-byte blocks)
      br.align();
      st.endMatrix = readMatrix(br);
      // the MORPHGRADIENT that follows is byte-aligned
      br.align();
      br.ub(2);
      br.ub(2); // spread, interpolation
      const n = br.ub(4);
      st.stops = [];
      for (let i = 0; i < n; i++) {
        const startRatio = br.ub(8);
        const start = readColor(br, 4);
        br.ub(8); // endRatio (start ratios are kept, as in the proven extractor)
        const end = readColor(br, 4);
        st.stops.push({ ratio: startRatio, startColor: start, endColor: end });
      }
      if (type === 0x13) {
        st.focal = br.b2() / 256;
        br.b2(); // end focal
      }
    } else {
      // the GRADIENT structure that follows is byte-aligned (spec)
      br.align();
      st.spreadMode = br.ub(2);
      br.ub(2); // interpolation
      const n = br.ub(4);
      st.stops = [];
      for (let i = 0; i < n; i++) st.stops.push({ ratio: br.ub(8), color: readColor(br, shapeNum >= 3 ? 4 : 3) });
      if (type === 0x13) st.focal = br.b2() / 256;
    }
  } else if (type >= 0x40 && type <= 0x43) {
    st.kind = "bitmap";
    st.mode = (type & 1) === 1 ? "clipped" : "repeating";
    st.smooth = type < 0x42;
    st.bitmapId = br.b2();
    st.matrix = readMatrix(br);
    if (morph) {
      br.align();
      st.endMatrix = readMatrix(br);
      br.align();
    }
  } else throw new Error(`fill style type 0x${type.toString(16)}`);
  return st;
}

export function readFillStyleArray(br: BitReader, shapeNum: number, morph = false): FillStyle[] {
  let n = br.b1();
  if (n === 0xff && (shapeNum > 1 || morph)) n = br.b2(); // morph arrays always allow the extended count
  const arr: FillStyle[] = [];
  for (let i = 0; i < n; i++) arr.push(readFillStyle(br, shapeNum, morph));
  return arr;
}

export function readLineStyleArray(br: BitReader, shapeNum: number, morph = false): LineStyle[] {
  let n = br.b1();
  if (n === 0xff) n = br.b2();
  const arr: LineStyle[] = [];
  for (let i = 0; i < n; i++) {
    const ls: LineStyle = {};
    if (morph) {
      ls.startWidth = br.b2();
      ls.endWidth = br.b2();
      if (shapeNum >= 4) {
        // MORPHLINESTYLE2: caps block comes BEFORE the colors (verified vs FFDec)
        ls.startCap = br.ub(2);
        ls.join = br.ub(2);
        const hasFill = br.ub(1);
        br.ub(1);
        br.ub(1);
        br.ub(1); // noHScale, noVScale, pixelHinting
        br.ub(5);
        ls.noClose = br.ub(1) === 1;
        br.ub(2); // reserved, noClose, endCap
        if (ls.join === 2) {
          ls.miterLimit = br.b2() / 256;
          br.b2();
        }
        if (hasFill) ls.fill = readFillStyle(br, shapeNum, true);
        else {
          ls.startColor = readColor(br, 4);
          ls.endColor = readColor(br, 4);
        }
      } else {
        ls.startColor = readColor(br, 4);
        ls.endColor = readColor(br, 4);
      }
    } else if (shapeNum <= 3) {
      ls.width = br.b2();
      ls.color = readColor(br, shapeNum >= 3 ? 4 : 3);
    } else {
      // LINESTYLE2 (DefineShape4)
      ls.width = br.b2();
      ls.startCap = br.ub(2);
      ls.join = br.ub(2);
      const hasFill = br.ub(1);
      ls.noHScale = br.ub(1) === 1;
      ls.noVScale = br.ub(1) === 1;
      ls.pixelHinting = br.ub(1) === 1;
      br.ub(5);
      ls.noClose = br.ub(1) === 1;
      ls.endCap = br.ub(2);
      if (ls.join === 2) ls.miterLimit = br.b2() / 256;
      if (hasFill) ls.fill = readFillStyle(br, shapeNum);
      else ls.color = readColor(br, 4);
    }
    arr.push(ls);
  }
  return arr;
}

// ------------------------------------------------------------- shape records

export type ShapeOp =
  | { t: "L"; x: number; y: number }
  | { t: "Q"; cx: number; cy: number; x: number; y: number };

/** A style-attributed edge run; coordinates are twips. */
export interface ShapeRun {
  f0: number;
  f1: number;
  line: number;
  start: [number, number];
  ops: ShapeOp[];
}

export interface ParsedShapeRecords {
  fills: FillStyle[];
  lines: LineStyle[];
  numFillBits: number;
  numLineBits: number;
  runs: ShapeRun[];
  leftoverBits: number;
}

export function parseShapeRecords(
  br: BitReader,
  { withStyles, shapeNum, morph }: { withStyles: boolean; shapeNum: number; morph: boolean },
): ParsedShapeRecords {
  let fills: FillStyle[] = [];
  let lines: LineStyle[] = [];
  let numFillBits = 0;
  let numLineBits = 0;
  if (withStyles) {
    fills = readFillStyleArray(br, shapeNum, morph);
    lines = readLineStyleArray(br, shapeNum, morph);
  }
  // the record stream ALWAYS begins with the two bit-width fields (morphs included)
  numFillBits = br.ub(4);
  numLineBits = br.ub(4);
  let f0 = 0;
  let f1 = 0;
  let line = 0;
  let cx = 0;
  let cy = 0;
  let cur: ShapeRun | null = null;
  const runs: ShapeRun[] = [];
  const flush = (): void => {
    if (cur && cur.ops.length) runs.push(cur);
    cur = null;
  };
  const ensure = (): ShapeRun => {
    if (!cur) cur = { f0, f1, line, ops: [], start: [cx, cy] };
    return cur;
  };

  for (;;) {
    if (!(br.p < br.u8.length * 8)) throw new Error("unexpected end of shape records"); // also catches NaN positions
    const type = br.ub(1);
    if (type === 1) {
      // edge
      const straight = br.ub(1);
      if (straight) {
        const n = br.ub(4) + 2; // edge numBits is stored n and read n+2
        const general = br.ub(1);
        let dx = 0;
        let dy = 0;
        if (general) {
          dx = br.sb(n);
          dy = br.sb(n);
        } else if (br.ub(1)) {
          dy = br.sb(n); // vertical
        } else {
          dx = br.sb(n); // horizontal
        }
        // the run's start is the pen position BEFORE its first op — capture
        // it before advancing (the research extractor captured it after,
        // which dropped each run's first stroke segment)
        const run = ensure();
        cx += dx;
        cy += dy;
        run.ops.push({ t: "L", x: cx, y: cy });
      } else {
        const n = br.ub(4) + 2;
        const cX = br.sb(n);
        const cY = br.sb(n);
        const aX = br.sb(n);
        const aY = br.sb(n);
        const run = ensure();
        cx += cX;
        cy += cY;
        const qx = cx;
        const qy = cy;
        cx += aX;
        cy += aY;
        run.ops.push({ t: "Q", cx: qx, cy: qy, x: cx, y: cy });
      }
    } else {
      // style change or end
      const sNew = br.ub(1); // read in morphs too (bit exists; arrays are invalid there)
      const sLine = br.ub(1);
      const sF1 = br.ub(1);
      const sF0 = br.ub(1);
      const sMove = br.ub(1);
      if (!sNew && !sLine && !sF1 && !sF0 && !sMove) break; // EndShapeRecord
      if (sMove) {
        const mb = br.ub(5);
        cx = br.sb(mb);
        cy = br.sb(mb);
      }
      if (sF0) f0 = br.ub(numFillBits);
      if (sF1) f1 = br.ub(numFillBits);
      if (sLine) line = br.ub(numLineBits);
      if (sNew) {
        if (morph) throw new Error("new styles inside morph records");
        flush();
        br.align();
        fills = readFillStyleArray(br, shapeNum, false);
        lines = readLineStyleArray(br, shapeNum, false);
        numFillBits = br.ub(4);
        numLineBits = br.ub(4);
      } else {
        flush();
      }
    }
  }
  flush();
  br.align();
  return { fills, lines, numFillBits, numLineBits, runs, leftoverBits: br.u8.length * 8 - br.p };
}

// ------------------------------------------------------------------ tags

export interface ParsedShape {
  id: number;
  tagCode: number;
  bounds: SwfRect;
  edgeBounds: SwfRect | null;
  usesFillWinding: boolean;
  fills: FillStyle[];
  lines: LineStyle[];
  numFillBits: number;
  numLineBits: number;
  runs: ShapeRun[];
  leftoverBits: number;
}

export function parseShapeTag(body: Uint8Array, tagCode: number): ParsedShape {
  const br = new BitReader(body);
  const id = br.b2();
  const bounds = readRect(br);
  let edgeBounds: SwfRect | null = null;
  let usesFillWinding = false;
  if (tagCode === 83) {
    edgeBounds = readRect(br);
    br.ub(5); // reserved
    usesFillWinding = br.ub(1) === 1;
    br.ub(1); // usesNonScalingStrokes
    br.ub(1); // usesScalingStrokes
  }
  const shapeNum = tagCode === 2 ? 1 : tagCode === 22 ? 2 : tagCode === 32 ? 3 : 4;
  const sh = parseShapeRecords(br, { withStyles: true, shapeNum, morph: false });
  return { id, tagCode, bounds, edgeBounds, usesFillWinding, ...sh };
}

export interface ParsedMorph extends ParsedShape {
  startBounds: SwfRect;
  endBounds: SwfRect;
  startEdgeBounds: SwfRect | null;
  endEdgeBounds: SwfRect | null;
  endRuns: ShapeRun[];
}

export function parseMorphShapeTag(body: Uint8Array, tagCode: number): ParsedMorph {
  const br = new BitReader(body);
  const id = br.b2();
  const startBounds = readRect(br);
  const endBounds = readRect(br);
  let startEdgeBounds: SwfRect | null = null;
  let endEdgeBounds: SwfRect | null = null;
  const isMorph2 = tagCode === 84;
  if (isMorph2) {
    startEdgeBounds = readRect(br);
    endEdgeBounds = readRect(br);
    br.ub(6);
    br.ub(1);
    br.ub(1); // reserved, usesNonScalingStrokes, usesScalingStrokes
  }
  const offset = br.b4();
  const afterOffset = br.p >> 3; // endEdges live at afterOffset + offset (bytes)
  const fills = readFillStyleArray(br, 1, true);
  const lines = readLineStyleArray(br, tagCode === 84 ? 4 : 1, true);
  const start = parseShapeRecords(br, { withStyles: false, shapeNum: 1, morph: true });
  br.p = (afterOffset + offset) * 8; // seek to endEdges per the offset field
  const end = parseShapeRecords(br, { withStyles: false, shapeNum: 1, morph: true });
  return {
    id,
    tagCode,
    bounds: startBounds,
    edgeBounds: null,
    usesFillWinding: false,
    fills,
    lines,
    numFillBits: start.numFillBits,
    numLineBits: start.numLineBits,
    runs: start.runs,
    leftoverBits: start.leftoverBits,
    startBounds,
    endBounds,
    startEdgeBounds,
    endEdgeBounds,
    endRuns: end.runs,
  };
}
