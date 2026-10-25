/**
 * TankData — the serializable tank description (port of `TankData.as`,
 * docs 05 §2). A tank is a list of placed parts plus scalar stats; the whole
 * thing round-trips through an encrypted tank code (§3 of the same doc).
 *
 * Owner types (`_-Tr`): 0 empty · 1 avatar · 2 ally · 3 enemy · 4 preview.
 */

import { getBubbleCost, getClassData, getGunCost, getPart, isWeapon } from "../data/parts";
import { decryptTankCode, encryptTankCode } from "./tank-code";

export interface TankDetail {
  /** Instance name of the part clip in the original ("4_mc", "instance32403"...). */
  name: string;
  /** Part intObjID (1001..7xxx); bucket = floor(type/1000). */
  type: number;
  /** Instance name of the symmetric twin, "" when none. */
  twin: string;
  x: number;
  y: number;
  /** Degrees. Mirrored twins store opposite angles (360 − θ). */
  rotation: number;
  /** Uniform scale (scaleX = scaleY). */
  scale: number;
  /** Pre-computed part radius at scale 1. */
  radius: number;
}

/** Parts that mark a tank as a support tank (docs 05 §2.1 blnSupportTank). */
const SUPPORT_PARTS = new Set([4003, 4024, 6002]);

export class TankData {
  /** Identity: `A…`/`E…` (server), `L…` (local), `B…` (built-in boss). */
  strID = "";
  /** Tank name (plaintext field 1). */
  tankName = "";
  /** Author name (plaintext field 0). */
  author = "";
  /** Version/revision field (plaintext field 2); always 1 in built-ins. */
  always1 = 1;
  avatarTank = false;
  numClass = 0;
  numLife = 1;
  numBubblesReturned = 1;
  numSpeed = 0;
  numRating = 0;
  details: TankDetail[] = [];

  // --- Computed on import (docs 05 §2.4) ---
  numBubbles = 0;
  numGunPoints = 0;
  numDifficultyRating = 0;
  supportTank = false;

  /** Last build mode (0/1/2/3/4); metadata for entity construction. */
  intType = 0;
  /** Viewer flag: 1 = current avatar (hides Save), 4 = template (hides Delete). */
  tankType = 4;
  /** Last imported/exported code. */
  strTankCode = "";

  importTankCode(code: string): boolean {
    try {
      const plaintext = decryptTankCode(code);
      return this.parsePlaintext(plaintext, code);
    } catch {
      return false;
    }
  }

  private parsePlaintext(plaintext: string, code: string): boolean {
    const records = plaintext.split(";");
    const basic = records[0]?.split(",") ?? [];
    if (basic.length !== 11) return false;
    const num = (s: string | undefined, fallback = 0): number => {
      const v = Number(s);
      return Number.isFinite(v) ? v : fallback;
    };
    this.author = basic[0] ?? "";
    this.tankName = basic[1] ?? "";
    this.always1 = num(basic[2], 1);
    this.avatarTank = num(basic[3]) === 1;
    this.numClass = num(basic[4]);
    this.numLife = num(basic[5], 1);
    this.numBubblesReturned = num(basic[6]);
    this.numSpeed = num(basic[7]);
    this.strID = basic[9] ?? "";
    this.numRating = num(basic[10]);

    const details: TankDetail[] = [];
    for (let i = 1; i < records.length; i++) {
      const row = records[i]?.split(",") ?? [];
      if (row.length !== 8) return false;
      const type = num(row[1], NaN);
      if (!Number.isFinite(type) || getPart(type) === null) return false; // unknown part → whole import fails
      details.push({
        name: row[0] ?? "",
        type,
        twin: row[2] ?? "",
        x: num(row[3]),
        y: num(row[4]),
        rotation: num(row[5]),
        scale: num(row[6], 1),
        radius: num(row[7]),
      });
    }
    this.details = details;
    this.supportTank = details.some((d) => SUPPORT_PARTS.has(d.type));
    this.strTankCode = code;
    this.recomputeStats();
    return true;
  }

  /** Load from an already-decrypted plaintext (builtin tank bank ships these). */
  importPlaintext(plaintext: string, id = ""): boolean {
    try {
      return this.parsePlaintext(plaintext, id);
    } catch {
      return false;
    }
  }

  /** `ExportTankData` — build the plaintext and encrypt it. */
  exportTankCode(): string {
    const basic = [
      this.author,
      this.tankName,
      String(this.always1),
      this.avatarTank ? "1" : "0",
      String(this.numClass),
      String(this.numLife),
      String(this.numBubblesReturned),
      String(this.numSpeed),
      String(this.numDifficultyRating),
      this.strID,
      String(this.numRating),
    ].join(",");
    const rows = this.details.map((d) =>
      [d.name, String(d.type), d.twin, String(d.x), String(d.y), String(d.rotation), String(d.scale), String(d.radius)].join(","),
    );
    const code = encryptTankCode([basic, ...rows].join(";"));
    this.strTankCode = code;
    return code;
  }

  /** Recompute BP/GP/difficulty (+class-derived speed for avatars). */
  recomputeStats(): void {
    this.numBubbles = this.details.reduce((sum, d) => sum + getBubbleCost(d.type), 0);
    this.numGunPoints = this.details.reduce((sum, d) => sum + (isWeapon(d.type) ? getGunCost(d.type) : 0), 0);
    if (this.numClass === 0) this.numClass = deriveClassFromArea(this.details);
    if (this.avatarTank) {
      // Avatar speed is always the class speed multiplier (docs 05 §2.4).
      this.numSpeed = getClassData(this.numClass).intSpeed;
    }
    this.numDifficultyRating = computeDifficultyRating(this.numSpeed, this.numGunPoints, this.numLife, this.numBubblesReturned);
  }

  /** `_-ZD()` — registration-centred bounding radius of the tank. */
  getRadius(): number {
    let max = 0;
    for (const d of this.details) {
      const r = Math.sqrt(d.x * d.x + d.y * d.y) + d.radius;
      if (r > max) max = r;
    }
    return max;
  }
}

/** `_-0w()` — difficulty rating formula, recomputed on every import. */
export function computeDifficultyRating(speed: number, gp: number, life: number, bubblesReturned: number): number {
  return Math.round(
    (1 / (5 - speed) + 1) * (gp / 2 - 0.2) + Math.sqrt(life) / 10 - bubblesReturned / life + 0.4,
  );
}

/**
 * `_-7e()` — class derivation from the assembled tank's pixel area.
 * The original rasterizes the preview clip and counts non-transparent pixels;
 * the port approximates each part's opaque area as π·r²·scale² (the parts are
 * bubbles) and uses the original's exact thresholds.
 */
export function deriveClassFromArea(details: TankDetail[]): number {
  let pixels = 0;
  for (const d of details) pixels += Math.PI * d.radius * d.radius * d.scale * d.scale;
  if (pixels <= 3465) return 1;
  if (pixels <= 7600) return 2;
  if (pixels <= 12370) return 3;
  if (pixels <= 18850) return 4;
  if (pixels <= 29700) return 5;
  return 6;
}
