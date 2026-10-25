/**
 * Built-in tank bank — the port of the encrypted tank lists inside `_-HJ`
 * (`_-7G` 31 avatar presets, `_-UH` 43 enemy tanks, `_-W6` 1 boss), shipped
 * decrypted in builtin-tanks.json (re/bt3/builtin_tanks.json).
 *
 * Also builds the profile-style stat records (`CLASS/GP/BP/DIFF/SP/BR/SUP/
 * LIFE/NAME/AUTH/HI`) the RULE engine and unit table filter on (docs 05 §4.2).
 */

import builtinTanksJson from "./json/builtin-tanks.json";
import { getBubbleCost, getGunCost, isWeapon } from "./parts";
import type { TankStats } from "./rules";
import { TankData } from "../tanks/TankData";

interface BuiltinTankEntry {
  name: string;
  author: string;
  id: string;
  isAvatar: string;
  class: string;
  life: string;
  speed: string;
  diff: string;
  rating: string;
  /** Decrypted plaintext header + part rows. */
  plaintext: string;
  /** Original encrypted code (kept for round-trip tests + sharing). */
  code: string;
}

function toTankData(entry: BuiltinTankEntry): TankData | null {
  const data = new TankData();
  if (!data.importPlaintext(entry.plaintext, entry.id)) return null;
  // Cross-check the plaintext stats against the bank's own record.
  data.numClass = Number(entry.class) || data.numClass;
  data.numLife = Number(entry.life) || data.numLife;
  data.numSpeed = Number(entry.speed) || data.numSpeed;
  // Keep the original encrypted code as the wire form (spawning re-imports it,
  // exactly like the original's SpawnNewEnemy → ImportTankData(DATA) path).
  data.strTankCode = entry.code;
  return data;
}

/** Stat record for the RULE engine (docs 05 §4.2 row shape). */
export function statRecord(data: TankData, builtIn = true): TankStats & { NAME: string; AUTH: string; HI: boolean } {
  return {
    CLASS: data.numClass,
    GP: data.numGunPoints,
    BP: data.numBubbles,
    DIFF: data.numDifficultyRating,
    SP: data.numSpeed,
    BR: data.numBubblesReturned,
    SUP: data.supportTank,
    LIFE: data.numLife,
    NAME: data.tankName,
    AUTH: data.author,
    HI: builtIn,
  };
}

const avatarEntries = (builtinTanksJson as { avatar_defaults: BuiltinTankEntry[] }).avatar_defaults;
const enemyEntries = (builtinTanksJson as { enemy_tanks: BuiltinTankEntry[] }).enemy_tanks;
const bossEntries = (builtinTanksJson as { bosses: BuiltinTankEntry[] }).bosses;

/** The 31 avatar preset tanks (`_-7G`). */
export const AVATAR_PRESETS: TankData[] = avatarEntries
  .map(toTankData)
  .filter((t): t is TankData => t !== null);

/** The 43 enemy tanks (`_-UH`) — the "local tank bank" the waves filter. */
export const ENEMY_BANK: TankData[] = enemyEntries
  .map(toTankData)
  .filter((t): t is TankData => t !== null);

/** Enemy bank stat records paired with their tanks. */
export const ENEMY_BANK_STATS: Array<{ tank: TankData; stats: TankStats }> = ENEMY_BANK.map((tank) => ({
  tank,
  stats: statRecord(tank),
}));

/** The progression boss (`_-W6`, class 6, life 1000). */
export const BOSSES: TankData[] = bossEntries.map(toTankData).filter((t): t is TankData => t !== null);

/** The starter avatar: the first preset ("Basic Tank", A10000063). */
export function getStartingAvatar(): TankData {
  const basic = AVATAR_PRESETS.find((t) => t.tankName === "Basic Tank") ?? AVATAR_PRESETS[0];
  if (!basic) throw new Error("builtin tank bank is missing the starter avatar");
  return basic;
}
