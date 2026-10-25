/**
 * Tank code codec — the port of `TankData.ExportTankData` / `ImportTankData`
 * envelope encryption (docs 05 §3.2; decompiled TankData.as + `_-C5.as`).
 *
 * Wire format:
 *   code = k1 + hex(AES-128-ECB-PKCS5( utf8(header) )) + k2
 * where k1/k2 are 3 random hex chars regenerated per export, and the AES key
 * is the 16 ASCII chars k1 + k2 + "m7U5kDYy5W".
 *
 * NOTE: the decompiled source wraps the plaintext in `_-C5._-Xg` (utf8→hex)
 * and immediately reverses it with `toArray` (hex→bytes) — a no-op round
 * trip; the AES input is the utf8 plaintext directly. The import path does
 * the same double transform in reverse (`_-Wx` + `toString`).
 *
 * Plaintext layout (header row + part rows, `,` within rows, `;` between):
 *   author,name,always1,avatarFlag,class,life,bubblesReturned,speed,difficulty,strID,rating
 *   ;partName,partType,twin,x,y,rotation,scale,radius
 */

import { aesEcbDecrypt, aesEcbEncrypt } from "./crypto/aes";

export const KEY_SUFFIX = "m7U5kDYy5W";

const HEX_DIGITS = "0123456789abcdef";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8ToHex(text: string): string {
  return toHex(encoder.encode(text));
}

export function hexToUtf8(hex: string): string {
  return decoder.decode(fromHex(hex));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += (b < 16 ? "0" : "") + b.toString(16);
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[\s:]/g, "");
  const padded = clean.length % 2 === 1 ? "0" + clean : clean;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** `_-2D()` — three random lowercase hex chars. */
export function randomKeyCap(): string {
  let out = "";
  for (let i = 0; i < 3; i++) {
    out += HEX_DIGITS[Math.round(Math.random() * 15)]!;
  }
  return out;
}

export function deriveKey(code: string): Uint8Array {
  const k1 = code.substring(0, 3);
  const k2 = code.substring(code.length - 3);
  return encoder.encode(k1 + k2 + KEY_SUFFIX);
}

/** Encrypt a plaintext header into a shareable tank code. */
export function encryptTankCode(header: string): string {
  const k1 = randomKeyCap();
  const k2 = randomKeyCap();
  const key = encoder.encode(k1 + k2 + KEY_SUFFIX);
  // `_-Xg` + `toArray` cancel: the cipher input is the utf8 plaintext itself.
  const cipher = aesEcbEncrypt(encoder.encode(header), key);
  return k1 + toHex(cipher) + k2;
}

/**
 * Decrypt a tank code to its plaintext header. Throws on any tampering
 * (bad caps, bad hex, bad padding) — the original wraps import in try/catch
 * and treats every exception as a failed import.
 */
export function decryptTankCode(code: string): string {
  if (code.length < 12) throw new Error("tank code too short");
  const key = deriveKey(code);
  const cipherHex = code.substring(3, code.length - 3);
  // `_-Wx` + `toString` cancel on the import side: utf8 decode directly.
  return decoder.decode(aesEcbDecrypt(fromHex(cipherHex), key));
}
