/**
 * SWF sound parsing — faithful port of the sound half of
 * `research/swf-browser-extraction/swf.mjs`:
 *  - MP3 (format 2): SI16 seek value stripped, raw MPEG frames kept,
 *  - uncompressed PCM (formats 0/3): wrapped into a WAV blob,
 *  - ADPCM / Nellymoser / Speex marked unsupported (not natively decodable).
 */

import { asBlobPart, i16, u16, u32 } from "./bitReader";

export const SOUND_FORMATS: Record<number, string> = {
  0: "uncompressed(LE)",
  1: "ADPCM",
  2: "MP3",
  3: "uncompressed(LE)",
  4: "Nellymoser16",
  5: "Nellymoser8",
  6: "Nellymoser",
  11: "Speex",
};

const SOUND_RATES = [5512, 11025, 22050, 44100];

export interface SwfSound {
  id: number;
  format: number;
  formatName: string;
  sampleRate: number;
  bits: number;
  channels: number;
  sampleCount: number;
  /** MP3 only: SI16 seek value from the sound info header. */
  seek?: number;
  unsupported?: boolean;
  mimeType?: "audio/mpeg" | "audio/wav";
  ext?: "mp3" | "wav";
  /** Audio payload (after the 2-byte MP3 seek strip). */
  data: Uint8Array;
  blob?: Blob;
}

function pcmToWav(pcm: Uint8Array, sampleRate: number, bits: number, channels: number): Uint8Array {
  const blockAlign = channels * (bits / 8);
  const buf = new ArrayBuffer(44 + pcm.length);
  const dv = new DataView(buf);
  const wstr = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bits, true);
  wstr(36, "data");
  dv.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

export function parseSound(body: Uint8Array): SwfSound {
  const id = u16(body, 0);
  const flags = body[2]!;
  const format = (flags >> 4) & 0xf;
  const sampleRate = SOUND_RATES[(flags >> 2) & 3]!;
  const bits = (flags >> 1) & 1 ? 16 : 8;
  const channels = (flags & 1) + 1;
  const sampleCount = u32(body, 3);
  const s: SwfSound = {
    id,
    format,
    formatName: SOUND_FORMATS[format] ?? `format ${format}`,
    sampleRate,
    bits,
    channels,
    sampleCount,
    data: body.subarray(7),
  };
  if (format === 2) {
    // MP3: SI16 seek then raw MPEG frames
    s.seek = s.data.length >= 2 ? i16(s.data, 0) : 0;
    s.data = s.data.subarray(2);
    s.blob = new Blob([asBlobPart(s.data)], { type: "audio/mpeg" });
    s.mimeType = "audio/mpeg";
    s.ext = "mp3";
  } else if (format === 0 || format === 3) {
    // uncompressed little-endian PCM
    s.blob = new Blob([asBlobPart(pcmToWav(s.data, sampleRate, bits, channels))], { type: "audio/wav" });
    s.mimeType = "audio/wav";
    s.ext = "wav";
  } else {
    s.unsupported = true; // ADPCM / Nellymoser / Speex: not natively decodable in browsers
  }
  return s;
}
