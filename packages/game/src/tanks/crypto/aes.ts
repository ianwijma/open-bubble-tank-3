/**
 * AES-128-ECB with PKCS#5 padding — faithful TypeScript port of the crypto
 * stack the game itself shipped (as3crypto):
 *   - `_-Xv.as` (com.hurlant.crypto.symmetric.AESKey) — fused-table AES core,
 *   - `_-Vy.as` (ECBMode),
 *   - `PKCS5.as` (IPadding).
 * from re/bt3/export/scripts/_-PB/. The fused Xtime*Sbox tables and the
 * subBytes-inside-shiftRows structure are intentional (that is how the
 * original computes AES); the round schedule is built in place exactly like
 * the AS3 key expansion.
 */

import { INV_SBOX, SBOX, XTIME11, XTIME13, XTIME14, XTIME2, XTIME2_SBOX, XTIME3_SBOX, XTIME9 } from "./tables";

const NK_MAX_BLOCK = 4; // AES block = 4 words = 16 bytes (as3crypto `_-YO§`)

/** `_Rcon` — Rcon[0] is unused (1-based round constants). */
const RCON = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];

/** AESKey — expanded schedule lives in `key` (the AS3 class mutates it in place). */
class AESKey {
  private key: Uint8Array;
  private state = new Uint8Array(16);
  private readonly numRounds: number;
  /** `_ -0a§` — original (pre-expansion) key length in bytes. */
  private readonly originalKeyLength: number;

  constructor(keyBytes: Uint8Array) {
    // AS3's ByteArray auto-grows on indexed writes during expansion; typed
    // arrays do not, so allocate the full schedule up front.
    this.numRounds = keyBytes.length / 4 + 6;
    this.key = new Uint8Array(16 * (this.numRounds + 1));
    this.key.set(keyBytes);
    this.originalKeyLength = keyBytes.length;
    this.expandKey();
  }

  get blockSize(): number {
    return 16;
  }

  toString(): string {
    return `aes${8 * this.originalKeyLength}`;
  }

  /** `§_-e-§` — in-place key expansion (supports 128/192/256 like the original). */
  private expandKey(): void {
    const key = this.key;
    const nk = this.originalKeyLength / 4;
    const nr = nk + 6;
    for (let i = nk; i < NK_MAX_BLOCK * (nr + 1); i++) {
      let t0 = key[4 * i - 4]!;
      let t1 = key[4 * i - 3]!;
      let t2 = key[4 * i - 2]!;
      let t3 = key[4 * i - 1]!;
      if (i % nk === 0) {
        const saved = t3;
        t3 = SBOX[t0]!;
        t0 = (SBOX[t1]! ^ RCON[i / nk]!) & 0xff;
        t1 = SBOX[t2]!;
        t2 = SBOX[saved]!;
      } else if (nk > 6 && i % nk === 4) {
        t0 = SBOX[t0]!;
        t1 = SBOX[t1]!;
        t2 = SBOX[t2]!;
        t3 = SBOX[t3]!;
      }
      key[4 * i + 0] = (key[4 * i - 4 * nk + 0]! ^ t0) & 0xff;
      key[4 * i + 1] = (key[4 * i - 4 * nk + 1]! ^ t1) & 0xff;
      key[4 * i + 2] = (key[4 * i - 4 * nk + 2]! ^ t2) & 0xff;
      key[4 * i + 3] = (key[4 * i - 4 * nk + 3]! ^ t3) & 0xff;
    }
  }

  /** `§_-R8§` — addRoundKey from schedule offset. */
  private addRoundKey(offset: number): void {
    for (let i = 0; i < 16; i++) this.state[i] = (this.state[i]! ^ this.key[i + offset]!) & 0xff;
  }

  /** `§_-DC§` — fused SubBytes+MixColumns into `tmp`, then swap into state. */
  private mixSubColumns(): void {
    const s = this.state;
    const t = new Uint8Array(16);
    t[0] = (XTIME2_SBOX[s[0]!]! ^ XTIME3_SBOX[s[5]!]! ^ SBOX[s[10]!]! ^ SBOX[s[15]!]!) & 0xff;
    t[1] = (SBOX[s[0]!]! ^ XTIME2_SBOX[s[5]!]! ^ XTIME3_SBOX[s[10]!]! ^ SBOX[s[15]!]!) & 0xff;
    t[2] = (SBOX[s[0]!]! ^ SBOX[s[5]!]! ^ XTIME2_SBOX[s[10]!]! ^ XTIME3_SBOX[s[15]!]!) & 0xff;
    t[3] = (XTIME3_SBOX[s[0]!]! ^ SBOX[s[5]!]! ^ SBOX[s[10]!]! ^ XTIME2_SBOX[s[15]!]!) & 0xff;
    t[4] = (XTIME2_SBOX[s[4]!]! ^ XTIME3_SBOX[s[9]!]! ^ SBOX[s[14]!]! ^ SBOX[s[3]!]!) & 0xff;
    t[5] = (SBOX[s[4]!]! ^ XTIME2_SBOX[s[9]!]! ^ XTIME3_SBOX[s[14]!]! ^ SBOX[s[3]!]!) & 0xff;
    t[6] = (SBOX[s[4]!]! ^ SBOX[s[9]!]! ^ XTIME2_SBOX[s[14]!]! ^ XTIME3_SBOX[s[3]!]!) & 0xff;
    t[7] = (XTIME3_SBOX[s[4]!]! ^ SBOX[s[9]!]! ^ SBOX[s[14]!]! ^ XTIME2_SBOX[s[3]!]!) & 0xff;
    t[8] = (XTIME2_SBOX[s[8]!]! ^ XTIME3_SBOX[s[13]!]! ^ SBOX[s[2]!]! ^ SBOX[s[7]!]!) & 0xff;
    t[9] = (SBOX[s[8]!]! ^ XTIME2_SBOX[s[13]!]! ^ XTIME3_SBOX[s[2]!]! ^ SBOX[s[7]!]!) & 0xff;
    t[10] = (SBOX[s[8]!]! ^ SBOX[s[13]!]! ^ XTIME2_SBOX[s[2]!]! ^ XTIME3_SBOX[s[7]!]!) & 0xff;
    t[11] = (XTIME3_SBOX[s[8]!]! ^ SBOX[s[13]!]! ^ SBOX[s[2]!]! ^ XTIME2_SBOX[s[7]!]!) & 0xff;
    t[12] = (XTIME2_SBOX[s[12]!]! ^ XTIME3_SBOX[s[1]!]! ^ SBOX[s[6]!]! ^ SBOX[s[11]!]!) & 0xff;
    t[13] = (SBOX[s[12]!]! ^ XTIME2_SBOX[s[1]!]! ^ XTIME3_SBOX[s[6]!]! ^ SBOX[s[11]!]!) & 0xff;
    t[14] = (SBOX[s[12]!]! ^ SBOX[s[1]!]! ^ XTIME2_SBOX[s[6]!]! ^ XTIME3_SBOX[s[11]!]!) & 0xff;
    t[15] = (XTIME3_SBOX[s[12]!]! ^ SBOX[s[1]!]! ^ SBOX[s[6]!]! ^ XTIME2_SBOX[s[11]!]!) & 0xff;
    this.state = t;
  }

  /** `invMixSubColumns` — fused InvSubBytes+InvMixColumns. */
  private invMixSubColumns(): void {
    const s = this.state;
    const t = new Uint8Array(16);
    t[0] = (XTIME14[s[0]!]! ^ XTIME11[s[1]!]! ^ XTIME13[s[2]!]! ^ XTIME9[s[3]!]!) & 0xff;
    t[5] = (XTIME9[s[0]!]! ^ XTIME14[s[1]!]! ^ XTIME11[s[2]!]! ^ XTIME13[s[3]!]!) & 0xff;
    t[10] = (XTIME13[s[0]!]! ^ XTIME9[s[1]!]! ^ XTIME14[s[2]!]! ^ XTIME11[s[3]!]!) & 0xff;
    t[15] = (XTIME11[s[0]!]! ^ XTIME13[s[1]!]! ^ XTIME9[s[2]!]! ^ XTIME14[s[3]!]!) & 0xff;
    t[4] = (XTIME14[s[4]!]! ^ XTIME11[s[5]!]! ^ XTIME13[s[6]!]! ^ XTIME9[s[7]!]!) & 0xff;
    t[9] = (XTIME9[s[4]!]! ^ XTIME14[s[5]!]! ^ XTIME11[s[6]!]! ^ XTIME13[s[7]!]!) & 0xff;
    t[14] = (XTIME13[s[4]!]! ^ XTIME9[s[5]!]! ^ XTIME14[s[6]!]! ^ XTIME11[s[7]!]!) & 0xff;
    t[3] = (XTIME11[s[4]!]! ^ XTIME13[s[5]!]! ^ XTIME9[s[6]!]! ^ XTIME14[s[7]!]!) & 0xff;
    t[8] = (XTIME14[s[8]!]! ^ XTIME11[s[9]!]! ^ XTIME13[s[10]!]! ^ XTIME9[s[11]!]!) & 0xff;
    t[13] = (XTIME9[s[8]!]! ^ XTIME14[s[9]!]! ^ XTIME11[s[10]!]! ^ XTIME13[s[11]!]!) & 0xff;
    t[2] = (XTIME13[s[8]!]! ^ XTIME9[s[9]!]! ^ XTIME14[s[10]!]! ^ XTIME11[s[11]!]!) & 0xff;
    t[7] = (XTIME11[s[8]!]! ^ XTIME13[s[9]!]! ^ XTIME9[s[10]!]! ^ XTIME14[s[11]!]!) & 0xff;
    t[12] = (XTIME14[s[12]!]! ^ XTIME11[s[13]!]! ^ XTIME13[s[14]!]! ^ XTIME9[s[15]!]!) & 0xff;
    t[1] = (XTIME9[s[12]!]! ^ XTIME14[s[13]!]! ^ XTIME11[s[14]!]! ^ XTIME13[s[15]!]!) & 0xff;
    t[6] = (XTIME13[s[12]!]! ^ XTIME9[s[13]!]! ^ XTIME14[s[14]!]! ^ XTIME11[s[15]!]!) & 0xff;
    t[11] = (XTIME11[s[12]!]! ^ XTIME13[s[13]!]! ^ XTIME9[s[14]!]! ^ XTIME14[s[15]!]!) & 0xff;
    // the fused InvSubBytes tail: every output byte goes through INV_SBOX
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[t[i]!]!;
  }

  /** `§_-Ou§` — fused SubBytes+ShiftRows (final round; `_-Xv.as` verbatim). */
  private subBytesShiftRows(): void {
    const s = this.state;
    s[0] = SBOX[s[0]!]!;
    s[4] = SBOX[s[4]!]!;
    s[8] = SBOX[s[8]!]!;
    s[12] = SBOX[s[12]!]!;
    const t1 = SBOX[s[1]!]!;
    s[1] = SBOX[s[5]!]!;
    s[5] = SBOX[s[9]!]!;
    s[9] = SBOX[s[13]!]!;
    s[13] = t1;
    const t2 = SBOX[s[2]!]!;
    s[2] = SBOX[s[10]!]!;
    s[10] = t2;
    const t3 = SBOX[s[6]!]!;
    s[6] = SBOX[s[14]!]!;
    s[14] = t3;
    const t4 = SBOX[s[15]!]!;
    s[15] = SBOX[s[11]!]!;
    s[11] = SBOX[s[7]!]!;
    s[7] = SBOX[s[3]!]!;
    s[3] = t4;
  }

  /** `invShiftRows` — fused InvSubBytes+InvShiftRows. */
  private invShiftRows(): void {
    const s = this.state;
    s[0] = INV_SBOX[s[0]!]!;
    s[4] = INV_SBOX[s[4]!]!;
    s[8] = INV_SBOX[s[8]!]!;
    s[12] = INV_SBOX[s[12]!]!;
    const t1 = INV_SBOX[s[13]!]!;
    s[13] = INV_SBOX[s[9]!]!;
    s[9] = INV_SBOX[s[5]!]!;
    s[5] = INV_SBOX[s[1]!]!;
    s[1] = t1;
    const t2 = INV_SBOX[s[2]!]!;
    s[2] = INV_SBOX[s[10]!]!;
    s[10] = t2;
    const t3 = INV_SBOX[s[6]!]!;
    s[6] = INV_SBOX[s[14]!]!;
    s[14] = t3;
    const t4 = INV_SBOX[s[3]!]!;
    s[3] = INV_SBOX[s[7]!]!;
    s[7] = INV_SBOX[s[11]!]!;
    s[11] = INV_SBOX[s[15]!]!;
    s[15] = t4;
  }

  encryptBlock(input: Uint8Array): Uint8Array {
    this.state.set(input.subarray(0, 16));
    this.addRoundKey(0);
    for (let round = 1; round <= this.numRounds; round++) {
      if (round < this.numRounds) this.mixSubColumns();
      else this.subBytesShiftRows();
      this.addRoundKey(round * 16);
    }
    return new Uint8Array(this.state);
  }

  decryptBlock(input: Uint8Array): Uint8Array {
    this.state.set(input.subarray(0, 16));
    this.addRoundKey(this.numRounds * 16);
    this.invShiftRows();
    let round = this.numRounds;
    while (round--) {
      this.addRoundKey(round * 16);
      if (round !== 0) this.invMixSubColumns();
    }
    return new Uint8Array(this.state);
  }
}

// --- PKCS5.as ---------------------------------------------------------------

export function pkcs5Pad(data: Uint8Array, blockSize = 16): Uint8Array {
  const pad = blockSize - (data.length % blockSize);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}

export function pkcs5Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error("PKCS#5::unpad: ByteArray.length isn't a multiple of the blockSize");
  const pad = data[data.length - 1]!;
  if (pad < 1 || pad > 16) throw new Error("PKCS#5:unpad: Invalid padding value.");
  for (let i = data.length - pad; i < data.length; i++) {
    if (data[i] !== pad) throw new Error("PKCS#5:unpad: Invalid padding value.");
  }
  return data.subarray(0, data.length - pad);
}

// --- ECBMode (§_-Vy§) -------------------------------------------------------

export function aesEcbEncrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new Error("AES-128 requires a 16-byte key");
  const aes = new AESKey(key);
  const padded = pkcs5Pad(plaintext, aes.blockSize);
  const out = new Uint8Array(padded.length);
  for (let off = 0; off < padded.length; off += 16) {
    out.set(aes.encryptBlock(padded.subarray(off, off + 16)), off);
  }
  return out;
}

export function aesEcbDecrypt(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new Error("AES-128 requires a 16-byte key");
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error("ECB mode cipher length must be a multiple of blocksize 16");
  }
  const aes = new AESKey(key);
  const out = new Uint8Array(ciphertext.length);
  for (let off = 0; off < ciphertext.length; off += 16) {
    out.set(aes.decryptBlock(ciphertext.subarray(off, off + 16)), off);
  }
  return pkcs5Unpad(out);
}
