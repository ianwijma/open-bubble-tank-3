/**
 * Bit-level reader for SWF tag bodies — TypeScript port of the `BR` class from
 * `research/swf-browser-extraction/swf-symbols.mjs`.
 *
 * Bit-layout facts locked down empirically against JPEXS FFDec (v26.4.0) and
 * kept verbatim here:
 *  - reads past the tag body yield zero bits (position still advances, so
 *    record loops terminate),
 *  - style counts are byte-aligned UI8 (0xFF → UI16),
 *  - MATRIX translate uses a 5-bit size prefix and stores raw twips,
 *  - edge numBits is stored `n` and read `n + 2`,
 *  - CXFORMWITHALPHA reads the add/multiply terms as sb(n): multipliers are
 *    8.8 fixed (÷256), offsets are raw.
 */

export class BitReader {
  readonly u8: Uint8Array;
  /** Bit position. */
  p: number;

  constructor(u8: Uint8Array, bitPos = 0) {
    this.u8 = u8;
    this.p = bitPos;
  }

  ub(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const idx = this.p >> 3;
      const bit = idx < this.u8.length ? (this.u8[idx]! >> (7 - (this.p & 7))) & 1 : 0;
      v = (v << 1) | bit;
      this.p++;
    }
    return v;
  }

  sb(n: number): number {
    const v = this.ub(n);
    return n !== 0 && (v & (1 << (n - 1))) !== 0 ? v - (1 << n) : v;
  }

  /** 16.16 fixed point (MATRIX scale/skew fields). */
  fb(n: number): number {
    return this.sb(n) / 65536;
  }

  align(): void {
    this.p = (this.p + 7) & ~7;
  }

  private byteStart(n: number): number {
    this.align();
    const s = this.p >> 3;
    if (s + n > this.u8.length) throw new Error("read past end of tag body");
    return s;
  }

  /** Aligned UI8. */
  b1(): number {
    const s = this.byteStart(1);
    this.p += 8;
    return this.u8[s]!;
  }

  /** Aligned UI16 (little-endian). */
  b2(): number {
    const s = this.byteStart(2);
    this.p += 16;
    return this.u8[s]! | (this.u8[s + 1]! << 8);
  }

  /** Aligned UI32 (little-endian). */
  b4(): number {
    const s = this.byteStart(4);
    this.p += 32;
    return (this.u8[s]! | (this.u8[s + 1]! << 8) | (this.u8[s + 2]! << 16) | (this.u8[s + 3]! << 24)) >>> 0;
  }

  /** Aligned read of `n` bytes (copy). */
  bytes(n: number): Uint8Array {
    const s = this.byteStart(n);
    this.p += n * 8;
    return this.u8.slice(s, s + n);
  }

  /** Null-terminated UTF-8 string (aligned). */
  string(): string {
    this.align();
    const s = this.p >> 3;
    let e = s;
    while (e < this.u8.length && this.u8[e] !== 0) e++;
    this.p = (e + 1) << 3;
    return new TextDecoder("utf-8").decode(this.u8.subarray(s, e));
  }

  /** Length-prefixed UTF-8 string (aligned). */
  netString(): string {
    const len = this.b1();
    return new TextDecoder("utf-8").decode(this.bytes(len));
  }

  get bitsRemaining(): number {
    return this.u8.length * 8 - this.p;
  }

  get inBounds(): boolean {
    return this.p < this.u8.length * 8;
  }
}

// ---------------------------------------------------------------- structures

export interface SwfRect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** MATRIX in raw SWF units: a..d unitless 16.16, tx/ty twips. */
export interface SwfMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/** CXFORMWITHALPHA: multipliers as 8.8 fixed (÷256), offsets raw. */
export interface SwfCxform {
  rM: number;
  gM: number;
  bM: number;
  aM: number;
  rO: number;
  gO: number;
  bO: number;
  aO: number;
}

/** Twips → px. */
export const tw2px = (t: number): number => t / 20;

export function readRect(br: BitReader): SwfRect {
  const n = br.ub(5);
  const r = { xMin: br.sb(n), xMax: br.sb(n), yMin: br.sb(n), yMax: br.sb(n) };
  br.align();
  return r;
}

export function readMatrix(br: BitReader): SwfMatrix {
  const m: SwfMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  if (br.ub(1)) {
    const n = br.ub(5);
    m.a = br.fb(n);
    m.d = br.fb(n);
  }
  if (br.ub(1)) {
    const n = br.ub(5);
    // SWF spec order: rotateSkew0 → c first, rotateSkew1 → b second.
    m.c = br.fb(n);
    m.b = br.fb(n);
  }
  const n = br.ub(5);
  m.tx = br.sb(n);
  m.ty = br.sb(n);
  return m;
}

export function readCxform(br: BitReader): SwfCxform {
  const hasAdd = br.ub(1);
  const hasMult = br.ub(1);
  const n = br.ub(4);
  const cx: SwfCxform = { rM: 1, gM: 1, bM: 1, aM: 1, rO: 0, gO: 0, bO: 0, aO: 0 };
  if (hasMult) {
    cx.rM = br.sb(n) / 256;
    cx.gM = br.sb(n) / 256;
    cx.bM = br.sb(n) / 256;
    cx.aM = br.sb(n) / 256;
  }
  if (hasAdd) {
    cx.rO = br.sb(n);
    cx.gO = br.sb(n);
    cx.bO = br.sb(n);
    cx.aO = br.sb(n);
  }
  br.align();
  return cx;
}

/** RGB(A) color as [r, g, b] or [r, g, b, a]. */
export type SwfColor = number[];

export function readColor(br: BitReader, n: 3 | 4): SwfColor {
  const c: SwfColor = [];
  for (let i = 0; i < n; i++) c.push(br.b1());
  return c;
}

export const alphaOf = (c: SwfColor): number => (c.length === 4 ? c[3]! : 255);

export const hexOf = (c: SwfColor): string =>
  "#" + c.slice(0, 3).map((v) => v!.toString(16).padStart(2, "0")).join("");

export const cssColor = (c: SwfColor): string => {
  const a = alphaOf(c) / 255;
  const h = hexOf(c);
  return a === 1 ? h : `${h.slice(0, 7)}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
};

// ------------------------------------------------------------ byte helpers

export const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
export const u32 = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
export const i16 = (b: Uint8Array, o: number): number => {
  const v = u16(b, o);
  return v & 0x8000 ? v - 0x10000 : v;
};

/**
 * TS ≥ 5.7 types byte views over `ArrayBufferLike`, which `BlobPart` rejects
 * (SharedArrayBuffer). Asset bytes always come from `fetch`/`arrayBuffer()`
 * — plain ArrayBuffers — so a defensive copy to a standalone buffer is safe
 * and keeps the Blob callsites honest.
 */
export function asBlobPart(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
