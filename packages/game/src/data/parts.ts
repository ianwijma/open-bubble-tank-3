/**
 * Parts database access — the port of `GameObjectLibrary` (`_-HJ`) data accessors.
 * Source: parts_database.json (extracted from the SWF; see re/bt3/docs/02, 05 §2.3).
 *
 * Part ID scheme (docs 03 §6):
 *   1xxx bodies (1001-1005 standard, 1101-1105 dark, 1201-1205 light, 1501-1505 clusters)
 *   2xxx avatar primary guns · 3xxx avatar secondary weapons · 4xxx enemy guns
 *   5xxx interfaces/passives · 6xxx enemy behaviors · 7xxx ally gun
 *   2013 remaps to 5003 (Auto Cannon alias).
 */

import rawDatabase from "./json/parts-database.json";

export interface PartRow {
  intObjID: number;
  strName: string;
  strPluralName: string;
  strShortName: string;
  /** Obfuscated symbol class in the original (kept for the asset pipeline). */
  claType: string;
  intBubbleCost: number;
  intGunCost: number;
  intClassCost: number;
  blnLower: boolean;
  strDamageText: string;
  strSummaryText: string;
  strFlavorText: string;
  intLocked: number;
  blnAfford: boolean;
  blnInterface: boolean;
  intCode: number;
}

/** Bucket arrays under their obfuscated keys (kept verbatim for traceability). */
export const PART_BUCKETS = {
  bodies: "_-N3",
  bodiesPacks: "_-Dg",
  avatarPrimary: "_-Ig",
  avatarSecondary: "_-NQ",
  interfaces: "_-VY",
  enemyGuns: "_-Oc",
  behaviors: "_-0N",
  allyGuns: "_-Tk",
  avatarTanks: "_-7G",
  enemyTanks: "_-UH",
  bosses: "_-W6",
} as const;

/** Tier unlock order `_-JY` — parts unlock as the avatar's tank level rises. */
export const TIER_UNLOCKS: number[][] = rawDatabase.tiers.map((t) => [...t]);

export interface ClassData {
  intClass: number;
  intArmor: number;
  intSpeed: number;
  /** GP cap per avatar tank level 1..6; 0 = class not buildable at that level. */
  arrGP: number[];
}

/** arrClassData normalized by class number (1..6). */
export const CLASS_DATA: ClassData[] = (() => {
  const byClass = new Map<number, ClassData>();
  for (const row of rawDatabase.classData as ClassData[]) {
    const existing = byClass.get(row.intClass);
    // The extraction carries one bare class-6 row (no arrGP) plus the full set;
    // prefer rows that have arrGP.
    if (!existing || (!existing.arrGP?.length && row.arrGP?.length)) {
      byClass.set(row.intClass, { ...row, arrGP: row.arrGP ?? [] });
    }
  }
  return [...byClass.values()].sort((a, b) => a.intClass - b.intClass);
})();

export function getClassData(classNum: number): ClassData {
  // Original fallback: { armor: 1, speed: 1 }.
  return CLASS_DATA.find((c) => c.intClass === classNum) ?? { intClass: 1, intArmor: 1, intSpeed: 1, arrGP: [] };
}

const ALL_PARTS: PartRow[] = Object.values(rawDatabase.arrays)
  .flat()
  .filter((p): p is PartRow => typeof p === "object" && p !== null && "intObjID" in p);

const byId = new Map<number, PartRow>();
for (const row of ALL_PARTS) byId.set(row.intObjID, row);

/** `RetrieveRowObject` — with the 2013 → 5003 alias. */
export function getPart(id: number): PartRow | null {
  if (id === 2013) id = 5003;
  return byId.get(id) ?? null;
}

/** `_-ME` — bubble points of a part (0 on unknown). */
export function getBubbleCost(id: number): number {
  return getPart(id)?.intBubbleCost ?? 0;
}

/** `_-HZ` — gun points of a part (0 on unknown). */
export function getGunCost(id: number): number {
  return getPart(id)?.intGunCost ?? 0;
}

/** `_-Vb` — class requirement of a part. */
export function getClassCost(id: number): number {
  return getPart(id)?.intClassCost ?? 0;
}

/** `_-4V` — requirement is "class ≤ N" when true, "class ≥ N" when false. */
export function getLower(id: number): boolean {
  return getPart(id)?.blnLower ?? false;
}

/** `_-Ee` — category bucket: floor(id / 1000). */
export function getCategory(id: number): number {
  return Math.floor(id / 1000);
}

/** `IsObjectAWeapon` — everything that is not a 1xxx body counts as a weapon. */
export function isWeapon(id: number): boolean {
  return !(id >= 1000 && id <= 1999);
}

/** `_-HM` — tier index 0..5 of a part (0 if absent from every tier list). */
export function getTier(id: number): number {
  const real = id === 2013 ? 5003 : id;
  for (let t = 0; t < TIER_UNLOCKS.length; t++) {
    if (TIER_UNLOCKS[t]?.includes(real)) return t;
  }
  return 0;
}

export function getPartName(id: number): string {
  return getPart(id)?.strName ?? "";
}

export function getPartPluralName(id: number): string {
  return getPart(id)?.strPluralName ?? getPartName(id);
}

/** `_-bv` — strShortName (the base label list groupings use when >2 entries). */
export function getPartShortName(id: number): string {
  return getPart(id)?.strShortName ?? getPartName(id);
}

export function getPartsByBucket(bucket: keyof typeof PART_BUCKETS): PartRow[] {
  return (rawDatabase.arrays as Record<string, PartRow[]>)[PART_BUCKETS[bucket]] ?? [];
}

/** Default unlock list (docs 05 §4.3): all bodies + 2001 + every enemy-side part. */
export function getDefaultUnlockedObjects(): number[] {
  const base = "1001,1002,1003,1004,1005,1101,1102,1103,1104,1105,1201,1202,1203,1204,1205,1501,1502,1503,1504,1505,2001".split(",").map(Number);
  for (const row of getPartsByBucket("enemyGuns")) base.push(row.intObjID);
  for (const row of getPartsByBucket("behaviors")) base.push(row.intObjID);
  for (const row of getPartsByBucket("allyGuns")) base.push(row.intObjID);
  return base;
}
