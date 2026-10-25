import { describe, expect, it } from "vitest";
import { aesEcbDecrypt, aesEcbEncrypt } from "../src/tanks/crypto/aes";
import {
  decryptTankCode,
  deriveKey,
  encryptTankCode,
  KEY_SUFFIX,
} from "../src/tanks/tank-code";
import builtinTanks from "../src/data/json/builtin-tanks.json";

interface BuiltinEntry {
  name: string;
  plaintext: string;
  code: string;
}

const allEntries: BuiltinEntry[] = [
  ...(builtinTanks.avatar_defaults as BuiltinEntry[]),
  ...(builtinTanks.enemy_tanks as BuiltinEntry[]),
  ...(builtinTanks.bosses as BuiltinEntry[]),
];

describe("AES-128-ECB", () => {
  // FIPS-197 appendix C.1 known-answer test.
  it("matches the FIPS-197 vector", () => {
    const key = Uint8Array.of(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f);
    const plaintext = Uint8Array.of(0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff);
    const expected = Uint8Array.of(0x69, 0xc4, 0xe0, 0xd8, 0x6a, 0x7b, 0x04, 0x30, 0xd8, 0xcd, 0xb7, 0x80, 0x70, 0xb4, 0xc5, 0x5a);
    const cipher = aesEcbEncrypt(plaintext, key);
    // PKCS5 pads a full extra block when the plaintext is exactly 16 bytes,
    // so the ciphertext carries the FIPS block followed by the padding block.
    expect([...cipher.slice(0, 16)]).toEqual([...expected]);
    expect([...aesEcbDecrypt(cipher, key)]).toEqual([...plaintext]);
  });

  it("round-trips multi-block payloads with PKCS5 padding", () => {
    const key = new TextEncoder().encode("m7U5kDYy5Wabbaxx");
    for (const len of [0, 1, 15, 16, 17, 31, 32, 100, 1000]) {
      const data = new Uint8Array(len).map((_, i) => i % 251);
      const cipher = aesEcbEncrypt(data, key);
      expect(cipher.length % 16).toBe(0);
      expect([...aesEcbDecrypt(cipher, key)].slice(0, len)).toEqual([...data]);
    }
  });

  it("encrypts to something different from the plaintext", () => {
    const key = new TextEncoder().encode("0123456789abcdef");
    const data = new TextEncoder().encode("attack at dawn attack at dawn");
    const cipher = aesEcbEncrypt(data, key);
    expect([...cipher].slice(0, data.length)).not.toEqual([...data]);
  });
});

describe("tank-code codec", () => {
  it("decrypts every builtin encrypted code to its plaintext", () => {
    for (const entry of allEntries) {
      expect(decryptTankCode(entry.code), entry.name).toBe(entry.plaintext);
    }
  });

  it("encrypt→decrypt round-trips a synthetic header", () => {
    const header =
      "TestAuthor,My Tank,1,1,1,1,1,1,7,A10000057,3;71_mc,3004,,22,0,0,0.5657894736842105,17.475;28_mc,1003,,1,0,0,0.5789473684210527,22.5";
    const code = encryptTankCode(header);
    expect(code.length).toBeGreaterThanOrEqual(12);
    expect(decryptTankCode(code)).toBe(header);
  });

  it("produces fresh key caps per export (ciphertext differs)", () => {
    const header = "a,b,1,1,1,1,1,1,7,X,3";
    const c1 = encryptTankCode(header);
    const c2 = encryptTankCode(header);
    expect(c1).not.toBe(c2); // random caps → different keys
    expect(decryptTankCode(c1)).toBe(header);
    expect(decryptTankCode(c2)).toBe(header);
  });

  it("derives the key from k1 + k2 + suffix", () => {
    const key = deriveKey("abcqqqzzz");
    expect(new TextDecoder().decode(key)).toBe("abc" + "zzz" + KEY_SUFFIX);
    expect(key.length).toBe(16);
  });

  it("tampering either throws or changes the plaintext", () => {
    const header = "a,b,1,1,1,1,1,1,7,X,3";
    const code = encryptTankCode(header);
    // flip one hex char in the middle of the ciphertext (deterministic spot)
    const mid = Math.floor(code.length / 2);
    const swapped = code[mid] === "0" ? "1" : "0";
    const tampered = code.slice(0, mid) + swapped + code.slice(mid + 1);
    let outcome: string;
    try {
      outcome = decryptTankCode(tampered);
    } catch {
      outcome = "<threw>";
    }
    // Accidentally-valid padding is possible in principle (~0.4%); the
    // original's contract is only "tampering fails the import", i.e. it never
    // round-trips the original plaintext.
    expect(outcome).not.toBe(header);
    // bad key caps: wrong first chars → wrong key
    let capsOutcome: string;
    try {
      capsOutcome = decryptTankCode("fff" + code.slice(3));
    } catch {
      capsOutcome = "<threw>";
    }
    expect(capsOutcome).not.toBe(header);
    // too short
    expect(() => decryptTankCode("abc")).toThrow();
  });
});
