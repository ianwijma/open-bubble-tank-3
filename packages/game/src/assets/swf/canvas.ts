/**
 * Shape → Canvas2D layer conversion for the game renderer.
 *
 * The proven extractor bucketed edge runs by active style and emitted SVG
 * (`shapeToSVG`); this module performs the identical bucketing but produces
 * draw-ready layers: one layer per fill style / line style, each holding its
 * sub-runs in px coordinates plus the resolved paint. A run between two
 * different fills belongs to BOTH styles (fill0 = left of the edge, fill1 =
 * right) — same as the proven bucketing.
 *
 * Gradient mapping follows the verified FFDec convention: raw SWF matrix
 * scale, translate/20, gradient space ±819.2px (linear) / r=819.2px (radial).
 * Bitmap fills map 1 bitmap px = 1/20 matrix unit (matrix scale /20), exactly
 * like the proven SVG output.
 */

import { alphaOf, cssColor, tw2px, type SwfCxform, type SwfMatrix } from "./bitReader";
import type { SwfImage } from "./images";
import type {
  FillStyle,
  GradientStop,
  LineStyle,
  ParsedMorph,
  ParsedShape,
  ShapeOp,
  ShapeRun,
} from "./shapes";

export type PxOp =
  | { t: "L"; x: number; y: number }
  | { t: "Q"; cx: number; cy: number; x: number; y: number };

export interface PxRun {
  start: [number, number];
  ops: PxOp[];
}

export interface ShapeLayer {
  kind: "fill" | "stroke";
  runs: PxRun[];
  rule: "nonzero" | "evenodd";
  /** Fill layers. */
  fillStyle?: FillStyle;
  /** Stroke layers. */
  lineWidthPx?: number;
  lineColor?: number[];
  lineFillStyle?: FillStyle;
  startCap?: number;
  join?: number;
  endCap?: number;
  miterLimit?: number;
}

export interface MorphLerp {
  /** 0 = start state, 1 = end state. */
  ratio: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function lerpColor(a: number[] | undefined, b: number[] | undefined, t: number): number[] | undefined {
  if (!a && !b) return undefined;
  const A = a ?? [0, 0, 0, 255];
  const B = b ?? [0, 0, 0, 255];
  const out: number[] = [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    out.push(Math.round(lerp(A[i] ?? B[i] ?? 0, B[i] ?? A[i] ?? 0, t)));
  }
  return out;
}

function toPxRun(run: ShapeRun): PxRun {
  return {
    start: [tw2px(run.start[0]), tw2px(run.start[1])],
    ops: run.ops.map((op): PxOp =>
      op.t === "L"
        ? { t: "L", x: tw2px(op.x), y: tw2px(op.y) }
        : { t: "Q", cx: tw2px(op.cx), cy: tw2px(op.cy), x: tw2px(op.x), y: tw2px(op.y) },
    ),
  };
}

function lerpRun(a: ShapeRun, b: ShapeRun, t: number): PxRun {
  const sameShape =
    a.ops.length === b.ops.length && a.ops.every((op, i) => op.t === b.ops[i]?.t);
  if (!sameShape || t === 0) return toPxRun(a);
  if (t === 1) return toPxRun(b);
  const ops: PxOp[] = a.ops.map((op, i) => {
    const q = b.ops[i]!;
    return op.t === "L"
      ? { t: "L", x: tw2px(lerp(op.x, (q as typeof op).x, t)), y: tw2px(lerp(op.y, (q as typeof op).y, t)) }
      : {
          t: "Q",
          cx: tw2px(lerp(op.cx, (q as typeof op).cx, t)),
          cy: tw2px(lerp(op.cy, (q as typeof op).cy, t)),
          x: tw2px(lerp(op.x, (q as typeof op).x, t)),
          y: tw2px(lerp(op.y, (q as typeof op).y, t)),
        };
  });
  return {
    start: [tw2px(lerp(a.start[0], b.start[0], t)), tw2px(lerp(a.start[1], b.start[1], t))],
    ops,
  };
}

/** Resolve a fill style's colors for the drawn state (morph-aware). */
function styleColor(st: FillStyle, morph: MorphLerp | null): number[] | undefined {
  if (st.kind === "solid") {
    if (st.startColor && st.endColor && morph && morph.ratio > 0) {
      return lerpColor(st.startColor, st.endColor, morph.ratio);
    }
    return st.color ?? st.startColor;
  }
  return undefined;
}

function morphStops(st: FillStyle, morph: MorphLerp | null): GradientStop[] {
  const stops = st.stops ?? [];
  if (!morph || morph.ratio === 0 || !stops.some((s) => s.startColor)) return stops;
  const t = morph.ratio;
  return stops.map((s) => ({
    ratio: s.ratio,
    color: lerpColor(s.startColor ?? s.color, s.endColor ?? s.color, t) ?? s.color,
  }));
}

/**
 * Bucket runs by active style and emit one layer per style, in style-index
 * order (fills first, then strokes) — mirroring the proven SVG body order.
 */
export function buildShapeLayers(
  shape: ParsedShape | ParsedMorph,
  morph: MorphLerp | null = null,
): ShapeLayer[] {
  const rule: "nonzero" | "evenodd" = shape.usesFillWinding ? "nonzero" : "evenodd";
  const fillBuckets = new Map<number, PxRun[]>();
  const strokeBuckets = new Map<number, PxRun[]>();
  const fillLayers: ShapeLayer[] = [];
  const strokeLayers: ShapeLayer[] = [];

  // Walk runs directly, emitting each run into its style buckets (keeps the
  // f0/f1/line pairing exact — a run can land in two fill buckets).
  const emit = (run: ShapeRun, px: PxRun): void => {
    if (run.f0 > 0) {
      let b = fillBuckets.get(run.f0);
      if (!b) fillBuckets.set(run.f0, (b = []));
      b.push(px);
    }
    if (run.f1 > 0 && run.f1 !== run.f0) {
      let b = fillBuckets.get(run.f1);
      if (!b) fillBuckets.set(run.f1, (b = []));
      b.push(px);
    }
    if (run.line > 0) {
      let b = strokeBuckets.get(run.line);
      if (!b) strokeBuckets.set(run.line, (b = []));
      b.push(px);
    }
  };

  const srcRuns = shape.runs;
  const mo = shape as ParsedMorph;
  const useMorph = Boolean(morph && mo.endRuns && mo.endRuns.length > 0 && morph.ratio > 0);
  if (useMorph) {
    const t = morph!.ratio;
    const n = Math.max(srcRuns.length, mo.endRuns.length);
    for (let i = 0; i < n; i++) {
      const a = srcRuns[i];
      const b = mo.endRuns[i];
      if (a && b) emit(a, lerpRun(a, b, t));
      else if (a) emit(a, toPxRun(a));
      else if (b) emit(b, toPxRun(b));
    }
  } else {
    for (const run of srcRuns) emit(run, toPxRun(run));
  }

  for (const idx of [...fillBuckets.keys()].sort((a, b) => a - b)) {
    const st = shape.fills[idx - 1];
    if (!st) continue;
    fillLayers.push({
      kind: "fill",
      runs: fillBuckets.get(idx)!,
      rule,
      fillStyle: st,
    });
  }
  for (const idx of [...strokeBuckets.keys()].sort((a, b) => a - b)) {
    const ls = shape.lines[idx - 1];
    if (!ls) continue;
    strokeLayers.push(strokeLayer(ls, rule, morph));
  }
  return [...fillLayers, ...strokeLayers];
}

function strokeLayer(ls: LineStyle, rule: "nonzero" | "evenodd", morph: MorphLerp | null): ShapeLayer {
  const layer: ShapeLayer = {
    kind: "stroke",
    runs: [],
    rule,
    lineWidthPx: tw2px(ls.width ?? ls.startWidth ?? 0),
    startCap: ls.startCap,
    join: ls.join,
    endCap: ls.endCap,
    miterLimit: ls.miterLimit ? ls.miterLimit : undefined,
  };
  if (ls.fill) {
    layer.lineFillStyle = ls.fill;
  } else {
    const c = morph && ls.startColor && ls.endColor ? lerpColor(ls.startColor, ls.endColor, morph.ratio) : ls.color;
    layer.lineColor = c ?? [0, 0, 0, 255];
  }
  return layer;
}

// ------------------------------------------------------------------ paints

export type ResolvedPaint =
  | { kind: "solid"; css: string }
  | { kind: "linear" | "radial" | "focal"; gradient: CanvasGradient }
  | { kind: "bitmap"; pattern: CanvasPattern | null; fallback: string };

const GRAD_EXTENT = 819.2; // gradient space: ±819.2px (linear) / r=819.2px (radial)

/** Apply a SWF matrix (unitless a..d, twips tx/ty) to a gradient-space px point. */
function applyGradientMatrix(m: SwfMatrix, gx: number, gy: number): [number, number] {
  return [m.a * gx + m.c * gy + tw2px(m.tx), m.b * gx + m.d * gy + tw2px(m.ty)];
}

function stopCss(s: GradientStop): string {
  const c = s.color ?? [0, 0, 0, 255];
  const a = alphaOf(c) / 255;
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/**
 * Resolve a fill/line style into something Canvas2D can paint with, in the
 * shape's px coordinate space. Bitmap fills need `images` (the loader's
 * image map); unavailable bitmaps fall back to the proven extractor's
 * `#808080` placeholder.
 */
export function resolvePaint(
  ctx: CanvasRenderingContext2D,
  st: FillStyle,
  images: Map<number, SwfImage>,
  morph: MorphLerp | null = null,
  cxform?: SwfCxform,
): ResolvedPaint {
  if (st.kind === "solid") {
    const c = styleColor(st, morph) ?? [0, 0, 0, 255];
    return { kind: "solid", css: tintedCss(cssColor(c), c, cxform) };
  }
  if (st.kind === "bitmap") {
    const img = images.get(st.bitmapId ?? 0);
    if (!img?.source) return { kind: "bitmap", pattern: null, fallback: "#808080" };
    const pattern = ctx.createPattern(img.source, "repeat");
    if (pattern && st.matrix) {
      // bitmap fill maps 1 bitmap px = 1/20 matrix unit (matches the proven SVG transform)
      const m = st.matrix;
      pattern.setTransform(
        new DOMMatrix([m.a / 20, m.b / 20, m.c / 20, m.d / 20, tw2px(m.tx), tw2px(m.ty)]),
      );
    }
    return { kind: "bitmap", pattern, fallback: "#808080" };
  }

  // linear / radial / focal gradients (gradient colors morph-interpolated)
  const stops = morphStops(st, morph);
  const m = st.matrix ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const scale = Math.sqrt((m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d) / 2);
  let gradient: CanvasGradient;
  if (st.kind === "linear") {
    const [x1, y1] = applyGradientMatrix(m, -GRAD_EXTENT, 0);
    const [x2, y2] = applyGradientMatrix(m, GRAD_EXTENT, 0);
    gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  } else {
    const [cxp, cyp] = applyGradientMatrix(m, 0, 0);
    const r = GRAD_EXTENT * scale;
    if (st.kind === "focal" && st.focal) {
      const [fx, fy] = applyGradientMatrix(m, st.focal * GRAD_EXTENT, 0);
      gradient = ctx.createRadialGradient(fx, fy, 0, cxp, cyp, r);
    } else {
      gradient = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, r);
    }
  }
  for (const s of stops) {
    const c = s.color ?? [0, 0, 0, 255];
    gradient.addColorStop(clamp01(s.ratio / 255), tintedCss(stopCss(s), c, cxform));
  }
  return { kind: st.kind, gradient };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Apply a color transform to a css color string (multipliers/offsets). */
function tintedCss(_css: string, _c: number[], _cx: SwfCxform | undefined): string {
  // STUB (M2+): placed-clip color transforms (cxform tinting) are parsed and
  // retained but not yet applied at paint time. The base color is used as-is.
  return _css;
}

// ------------------------------------------------------------------ drawing

function tracePath(path: Path2D, run: PxRun): void {
  path.moveTo(run.start[0], run.start[1]);
  for (const op of run.ops) {
    if (op.t === "L") path.lineTo(op.x, op.y);
    else path.quadraticCurveTo(op.cx, op.cy, op.x, op.y);
  }
}

/** Build the Path2D for a layer (all runs concatenated, like the SVG `d`). */
export function pathForLayer(layer: ShapeLayer): Path2D {
  const p = new Path2D();
  for (const run of layer.runs) tracePath(p, run);
  return p;
}

/**
 * Mask path for a shape: every run's filled outline in px, with the mask
 * placement's matrix baked in numerically (no DOMMatrix dependency, so
 * this works in Node test shims too). Used to implement SWF clip depths.
 */
export function maskPathFor(
  shape: ParsedShape | ParsedMorph,
  matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number } | undefined,
): Path2D {
  const m = matrix ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const pt = (tx: number, ty: number): [number, number] => [
    (tx * m.a + ty * m.c + m.tx) / 20,
    (tx * m.b + ty * m.d + m.ty) / 20,
  ];
  const p = new Path2D();
  const srcRuns = shape.runs;
  const mo = shape as ParsedMorph;
  const runs = mo.endRuns && mo.endRuns.length > 0 ? mo.endRuns : srcRuns;
  for (const run of runs) {
    const [sx, sy] = pt(run.start[0], run.start[1]);
    p.moveTo(sx, sy);
    for (const op of run.ops) {
      if (op.t === "L") {
        const [x, y] = pt(op.x, op.y);
        p.lineTo(x, y);
      } else {
        const [cx, cy] = pt(op.cx, op.cy);
        const [x, y] = pt(op.x, op.y);
        p.quadraticCurveTo(cx, cy, x, y);
      }
    }
    p.closePath();
  }
  return p;
}

const CAP_CSS: Record<number, CanvasLineCap> = { 0: "round", 1: "butt", 2: "square" };
const JOIN_CSS: Record<number, CanvasLineJoin> = { 0: "round", 1: "bevel", 2: "miter" };

/**
 * Draw parsed shape layers onto a 2D context. Coordinates are already in px
 * symbol space; the caller applies placement/animation transforms before
 * calling. `layers` may be cached per (shape id, morph bucket).
 */
export function drawShapeLayers(
  ctx: CanvasRenderingContext2D,
  layers: ShapeLayer[],
  images: Map<number, SwfImage>,
  cxform?: SwfCxform,
): void {
  for (const layer of layers) {
    const path = pathForLayer(layer);
    if (layer.kind === "fill") {
      const st = layer.fillStyle;
      if (!st) continue;
      const paint = resolvePaint(ctx, st, images, null, cxform);
      if (paint.kind === "bitmap" && !paint.pattern) ctx.fillStyle = paint.fallback;
      else ctx.fillStyle = paint.kind === "solid" ? paint.css : paint.kind === "bitmap" ? paint.pattern! : paint.gradient;
      ctx.fill(path, layer.rule);
    } else {
      ctx.lineWidth = layer.lineWidthPx ?? 0;
      ctx.lineCap = CAP_CSS[layer.startCap ?? 0] ?? "round";
      ctx.lineJoin = JOIN_CSS[layer.join ?? 0] ?? "round";
      if (layer.join === 2) ctx.miterLimit = layer.miterLimit ? 3 : 3;
      if (layer.lineFillStyle) {
        const paint = resolvePaint(ctx, layer.lineFillStyle, images, null, cxform);
        if (paint.kind === "bitmap" && !paint.pattern) ctx.strokeStyle = paint.fallback;
        else ctx.strokeStyle = paint.kind === "solid" ? paint.css : paint.kind === "bitmap" ? paint.pattern! : paint.gradient;
      } else {
        ctx.strokeStyle = cssColor(layer.lineColor ?? [0, 0, 0, 255]);
      }
      ctx.stroke(path);
    }
  }
}
