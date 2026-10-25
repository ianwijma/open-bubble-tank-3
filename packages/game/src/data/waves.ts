/**
 * Wave generation — the port of the `WaveGenerator` (`_-3y`) selection math
 * (docs 03 §3, 07 §2.2).
 *
 * - Difficulty by distance: dist<10 → table `_-Pb`, 10≤dist<20 → `_-ad`,
 *   ≥20 → `_-9k`, −1 (post-death retry / first field) → `_-Iy` (deadheads only).
 * - `ChooseWaveOption` weighted-picks an option by cumulative `chance`.
 * - Each instruction `KEY × rand(min..max)` resolves through the unit table
 *   (`Search4RandomUnitWithKey`), never picking the same unit twice in a row.
 * - The SCALE value sizes the bubblefield, not the enemies.
 *
 * The original filled the unit table from bubbletanks.com with a local
 * fallback; the server is dead (stubbed), so local filling is the primary
 * path exactly as documented in docs 05 §8.
 */

import waveTablesJson from "./json/wave-tables.json";
import { randInt } from "../core/math";
import { ENEMY_BANK_STATS } from "./tanks";
import type { TankData } from "../tanks/TankData";
import { ARCHETYPE_RULES, effectiveRule, matchesRule } from "./rules";

export interface WaveInstruction {
  key: string;
  min: number;
  max: number;
}

export interface WaveOption {
  chance: number;
  /** Field size multiplier (BF_BG_mc.scaleX); null for the retry table. */
  scale: number | null;
  instructions: WaveInstruction[];
}

export interface WaveUnit {
  ID: string;
  DATA: string;
  KEY: string;
}

export interface Wave {
  ENEMIES: Array<WaveUnit & { AMT: number }>;
  SCALE: number;
}

export const WAVE_TABLES: Record<string, WaveOption[]> = {
  near: waveTablesJson["_-Pb"]! as WaveOption[],
  mid: waveTablesJson["_-ad"]! as WaveOption[],
  far: waveTablesJson["_-9k"]! as WaveOption[],
  retry: waveTablesJson["_-Iy"]! as WaveOption[],
};

/**
 * Unit table `_-0G`: archetype KEY → matching built-in tanks. The original's
 * `GetLocalTank` filters the saved enemy bank by the KEY's RULE per request;
 * we precompute the (small) bank match per archetype once — same result.
 */
export class UnitTable {
  private byKey = new Map<string, WaveUnit[]>();
  private lastKey = "";
  private lastIndex = -1;

  constructor() {
    for (const key of Object.keys(ARCHETYPE_RULES)) {
      const rule = effectiveRule(key);
      const matches = ENEMY_BANK_STATS.filter(({ stats }) => matchesRule(stats, rule));
      this.byKey.set(
        key,
        matches.map(({ tank }) => this.tankToUnit(tank, key)),
      );
    }
  }

  private tankToUnit(tank: TankData, key: string): WaveUnit {
    // DATA is the encrypted tank code — the spawn path re-imports it.
    return { ID: tank.strID, DATA: tank.strTankCode, KEY: key };
  }

  /** `Search4RandomUnitWithKey` — random unit of KEY, avoiding the same unit twice in a row. */
  searchRandom(key: string): WaveUnit | null {
    const units = this.byKey.get(key) ?? [];
    if (units.length === 0) return null;
    if (units.length === 1) return units[0] ?? null;
    let index = randInt(0, units.length - 1);
    if (key === this.lastKey && index === this.lastIndex) {
      index = (index + 1) % units.length;
    }
    this.lastKey = key;
    this.lastIndex = index;
    return units[index] ?? null;
  }

  /** Keys present in the table (used by the cheat console / debug). */
  keys(): string[] {
    return [...this.byKey.keys()];
  }
}

function tableForDistance(distance: number): WaveOption[] {
  // the four keys are statically populated above
  if (distance < 0) return WAVE_TABLES.retry!;
  if (distance < 10) return WAVE_TABLES.near!;
  if (distance < 20) return WAVE_TABLES.mid!;
  return WAVE_TABLES.far!;
}

/** `ChooseWaveOption` — cumulative-chance weighted pick. */
export function chooseWaveOption(options: WaveOption[]): WaveOption | null {
  if (options.length === 0) return null;
  const total = options.reduce((sum, o) => sum + o.chance, 0);
  let roll = Math.random() * total;
  for (const option of options) {
    roll -= option.chance;
    if (roll < 0) return option;
  }
  return options[options.length - 1] ?? null;
}

/**
 * `_-Wd(distance)` — build a wave for a field at grid distance `distance`
 * (round(sqrt(col² + row²)); −1 for post-death/first fields).
 */
export function generateWave(distance: number, units: UnitTable): Wave {
  const option = chooseWaveOption(tableForDistance(distance));
  if (!option) return { ENEMIES: [], SCALE: 1 };
  const enemies: Array<WaveUnit & { AMT: number }> = [];
  for (const instruction of option.instructions) {
    const amt = randInt(instruction.min, instruction.max);
    if (amt <= 0) continue;
    const unit = units.searchRandom(instruction.key);
    // -1 / missing KEY aborts the whole wave with an empty array (original).
    if (!unit) return { ENEMIES: [], SCALE: option.scale ?? 1 };
    const existing = enemies.find((e) => e.ID === unit.ID && e.KEY === unit.KEY);
    if (existing) {
      existing.AMT += amt;
    } else {
      enemies.push({ ID: unit.ID, AMT: amt, DATA: unit.DATA, KEY: unit.KEY });
    }
  }
  return { ENEMIES: enemies, SCALE: option.scale ?? 1 };
}

/** Boss field `_-De()` — one random boss from the progression list. */
export function generateBossWave(bosses: TankData[]): Wave {
  const boss = bosses[randInt(0, bosses.length - 1)];
  if (!boss) return { ENEMIES: [], SCALE: 1 };
  return { ENEMIES: [{ ID: boss.strID, AMT: 1, DATA: boss.strTankCode, KEY: "Boss" }], SCALE: 1 };
}

/** `distance = round(sqrt(col² + row²))` of grid coords. */
export function gridDistance(col: number, row: number): number {
  return Math.round(Math.sqrt(col * col + row * row));
}
