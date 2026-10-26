/**
 * Tank Creator engine — the headless model behind `TankCreatorScreen`
 * (docs 04 §4.5 + the decompiled creator flow, TankCreatorScreen.as).
 *
 * Budget system (docs 04 §4.5): Σ part.intGunCost ≤ `arrClassData[c-1].arrGP[tier]`
 * (GP = Gun Points), Σ part.intBubbleCost ≤ 100 (BP = complexity), and every
 * part's `intClassCost` ≤ the current class. There is no per-part purchase —
 * the budget is the currency.
 *
 * Derived stats (verbatim from the decompiled formulas):
 *   life   = Math.round(BP/2 + GP*3) * class                       (`_-Fr`)
 *   returned = Math.round(life * (0.3*((7-c)/6) + 0.005*GP + 0.1 - min(0.0005*life, 0.1))), min 1 (`_-Jq`)
 *   speed  = 3*((6-c)/6) + 0.5 - GP*0.1, min 0.1                   (`_-38`)
 *   difficulty = 1 (fixed — TankCreatorScreen.as:3074)
 *
 * Symmetric placement: a part dropped with mirroring on gets a twin at the
 * mirrored x with cross-referenced `twin` names (TankCreatorScreen.as:725-745).
 */

import { CLASS_DATA, getBubbleCost, getClassCost, getGunCost, isWeapon } from "../data/parts";
import { TankData } from "./TankData";

export interface CreatorPart {
  /** Unique row name (`name` in the TankData plaintext; `movDragObj.name`). */
  name: string;
  type: number;
  /** Cross-referenced twin row name ("" when unpaired). */
  twin: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  radius: number;
}

export interface CreatorBudget {
  /** GP cap for the current class + tier (0 = class not buildable here). */
  gunPointsMax: number;
  usedGunPoints: number;
  /** BP (complexity) cap — fixed 100. */
  bubblePointsMax: number;
  usedBubblePoints: number;
}

export interface DerivedStats {
  life: number;
  bubblesReturned: number;
  speed: number;
  difficulty: number;
}

let rowCounter = 0;

/** Fresh unique part-row name (`t_mc` style locals in the original). */
function nextRowName(type: number): string {
  rowCounter += 1;
  return `p${type}_${rowCounter}`;
}

export class TankCreator {
  private parts: CreatorPart[] = [];
  private classNum = 1;
  constructor(
    private readonly isAvatar: boolean,
    private readonly maxClass: number,
    private readonly unlockedObjects: ReadonlySet<number>,
    /** Enemy-side parts are always unlocked (docs 05 §4.3). */
    private readonly alwaysUnlocked: ReadonlySet<number> = new Set(),
    /** The avatar's tank level — indexes the per-class GP budget. */
    private readonly tier = 0,
  ) {}

  // ------------------------------------------------------------- structure

  get partList(): readonly CreatorPart[] {
    return this.parts;
  }

  get currentClass(): number {
    return this.classNum;
  }

  /** Can the player pick this class here? (0-budget tiers lock classes.) */
  classAvailable(classNum: number): boolean {
    if (classNum < 1 || classNum > 6) return false;
    if (classNum > Math.min(6, this.maxClass)) return false;
    return this.gunBudgetFor(classNum) > 0;
  }

  setClass(classNum: number): boolean {
    if (!this.classAvailable(classNum)) return false;
    // dropping the class below a part's classCost invalidates the build —
    // the original blocks the slider instead; the port refuses the change
    // while any part exceeds the new class cost.
    if (this.parts.some((p) => getClassCost(p.type) > classNum)) return false;
    this.classNum = classNum;
    return true;
  }

  // --------------------------------------------------------------- budgets

  gunBudgetFor(classNum = this.classNum): number {
    return CLASS_DATA[classNum - 1]?.arrGP[this.tier] ?? 0;
  }

  get budget(): CreatorBudget {
    return {
      gunPointsMax: this.gunBudgetFor(),
      usedGunPoints: this.usedGunPoints(),
      bubblePointsMax: 100,
      usedBubblePoints: this.usedBubblePoints(),
    };
  }

  usedGunPoints(): number {
    return this.parts.reduce((sum, p) => sum + (isWeapon(p.type) ? getGunCost(p.type) : 0), 0);
  }

  usedBubblePoints(): number {
    return this.parts.reduce((sum, p) => sum + getBubbleCost(p.type), 0);
  }

  /** Would adding this part stay within every budget? */
  canAddPart(type: number): { ok: boolean; reason: string } {
    if (!this.unlockedObjects.has(type) && !this.alwaysUnlocked.has(type)) {
      return { ok: false, reason: "locked" };
    }
    if (getClassCost(type) > this.classNum) return { ok: false, reason: "class" };
    const gunAfter = this.usedGunPoints() + (isWeapon(type) ? getGunCost(type) : 0);
    if (gunAfter > this.gunBudgetFor()) return { ok: false, reason: "gunPoints" };
    const bpAfter = this.usedBubblePoints() + getBubbleCost(type);
    if (bpAfter > 100) return { ok: false, reason: "bubblePoints" }; // TankCreatorScreen.as:3619
    return { ok: true, reason: "" };
  }

  // ------------------------------------------------------------ part edits

  /** `addPart` — places a part; with mirroring on, also places the mirrored
   * twin across the tank's vertical axis (docs 04 §4.5 flow). */
  addPart(type: number, x: number, y: number, mirror = false, radius = 7): boolean {
    if (!this.canAddPart(type).ok) return false;
    // two mirrored parts must both fit the budget
    if (mirror && !this.canAddPart(type).ok) return false;
    const name = nextRowName(type);
    const part: CreatorPart = { name, type, twin: "", x, y, rotation: 0, scale: 1, radius };
    this.parts.push(part);
    if (mirror) {
      const twinName = nextRowName(type);
      const twin: CreatorPart = { name: twinName, type, twin: name, x: -x, y, rotation: 0, scale: 1, radius };
      part.twin = twinName;
      this.parts.push(twin);
    }
    return true;
  }

  /** Move a part (and its twin, mirrored). */
  movePart(name: string, x: number, y: number): void {
    const part = this.parts.find((p) => p.name === name);
    if (!part) return;
    part.x = x;
    part.y = y;
    if (part.twin) {
      const twin = this.parts.find((p) => p.name === part.twin);
      if (twin) {
        twin.x = -x;
        twin.y = y;
      }
    }
  }

  /** Remove a part (and its twin link). */
  removePart(name: string): void {
    const part = this.parts.find((p) => p.name === name);
    if (!part) return;
    if (part.twin) {
      const twin = this.parts.find((p) => p.name === part.twin);
      if (twin) twin.twin = "";
    }
    this.parts = this.parts.filter((p) => p !== part && p.twin !== name);
  }

  /** Replace the whole part list (import path — `ImportTankFromTankDataObject`). */
  importParts(parts: CreatorPart[]): void {
    this.parts = parts.map((p) => ({ ...p }));
  }

  // --------------------------------------------------------- derived stats

  /** The verbatim creator stat formulas (see module doc). */
  derivedStats(): DerivedStats {
    const c = this.classNum;
    const gp = this.usedGunPoints();
    const bp = this.usedBubblePoints();
    const life = Math.round(bp / 2 + gp * 3) * c;
    let sub = 0.0005 * life;
    if (sub > 0.1) sub = 0.1;
    const returned = Math.max(1, Math.round(life * (0.3 * ((7 - c) / 6) + 0.005 * gp + 0.1 - sub)));
    let speed = 3 * ((6 - c) / 6) + 0.5 - gp * 0.1;
    if (speed < 0.1) speed = 0.1;
    return { life, bubblesReturned: returned, speed, difficulty: 1 };
  }

  /** Build the TankData — `_-VM` (TankCreatorScreen.as:3062-3105). */
  build(tankName: string, author: string): TankData | null {
    if (this.parts.length === 0 || tankName === "" || author === "") return null;
    const stats = this.derivedStats();
    const data = new TankData();
    // `,` within rows, `;` between rows (docs 05 §3.2): header fields 0-10,
    // then one row per part.
    const header = [
      author,
      tankName,
      "1",
      this.isAvatar ? "1" : "0",
      String(this.classNum),
      String(stats.life),
      String(stats.bubblesReturned),
      String(stats.speed),
      String(stats.difficulty),
      "L0", // replaced by the caller's L-id on save
      "0",
    ].join(",");
    const rows = this.parts
      .map((p) => `${p.name},${p.type},${p.twin},${p.x},${p.y},${p.rotation},${p.scale},${p.radius}`)
      .join(";");
    data.importPlaintext(`${header};${rows}`);
    return data;
  }
}
