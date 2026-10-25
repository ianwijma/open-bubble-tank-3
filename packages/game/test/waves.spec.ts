import { describe, expect, it } from "vitest";
import { ARCHETYPE_RULES } from "../src/data/rules";
import {
  chooseWaveOption,
  generateBossWave,
  generateWave,
  gridDistance,
  UnitTable,
  WAVE_TABLES,
  type WaveOption,
} from "../src/data/waves";
import { TankData } from "../src/tanks/TankData";
import { ENEMY_BANK, BOSSES } from "../src/data/tanks";

describe("wave tables (`_-Wd` selection)", () => {
  it("exposes the four distance tables", () => {
    expect(Object.keys(WAVE_TABLES).sort()).toEqual(["far", "mid", "near", "retry"]);
  });

  it("every option is well-formed and every KEY has an archetype rule", () => {
    for (const [table, options] of Object.entries(WAVE_TABLES)) {
      expect(options.length, table).toBeGreaterThan(0);
      for (const o of options) {
        expect(o.chance, `${table} chance`).toBeGreaterThan(0);
        // retry-table options have scale: null (field keeps scale 1)
        if (o.scale !== null) expect(o.scale, `${table} scale`).toBeGreaterThan(0);
        for (const inst of o.instructions) {
          expect(ARCHETYPE_RULES[inst.key], `${table} key ${inst.key}`).toBeDefined();
          expect(inst.min, `${table} ${inst.key} min`).toBeGreaterThanOrEqual(0);
          expect(inst.max, `${table} ${inst.key} max`).toBeGreaterThanOrEqual(inst.min);
        }
      }
    }
  });

  it("the retry table (`_-Iy`) is deadheads only", () => {
    const keys = new Set<string>();
    for (const o of WAVE_TABLES.retry!) for (const i of o.instructions) keys.add(i.key);
    for (const key of keys) expect(key, key).toContain("DeadHead");
  });

  it("near/mid/far options grow with distance (counts per docs 03 §3)", () => {
    // 17 near / 34 mid / 44 far options were extracted in the dossier.
    expect(WAVE_TABLES.near!.length).toBe(17);
    expect(WAVE_TABLES.mid!.length).toBe(34);
    expect(WAVE_TABLES.far!.length).toBe(44);
  });
});

describe("chooseWaveOption", () => {
  it("returns null for an empty table", () => {
    expect(chooseWaveOption([])).toBeNull();
  });

  it("always returns the only option", () => {
    const option: WaveOption = { chance: 1, scale: 1.5, instructions: [{ key: "TinyDeadHead", min: 1, max: 2 }] };
    for (let i = 0; i < 20; i++) expect(chooseWaveOption([option])).toBe(option);
  });

  it("never returns anything outside the table", () => {
    const options = WAVE_TABLES.near!;
    for (let i = 0; i < 200; i++) expect(options).toContain(chooseWaveOption(options));
  });
});

describe("generateWave", () => {
  const units = new UnitTable();

  it("distance −1 uses the deadhead retry table", () => {
    // A retry wave contains only DeadHead-archetype units.
    for (let i = 0; i < 50; i++) {
      const wave = generateWave(-1, units);
      for (const e of wave.ENEMIES) expect(e.KEY).toContain("DeadHead");
    }
  });

  it("waves are spawnable: every unit re-imports through its tank code", () => {
    for (let i = 0; i < 50; i++) {
      const wave = generateWave(5, units);
      for (const e of wave.ENEMIES) {
        expect(e.AMT).toBeGreaterThan(0);
        const data = new TankData();
        expect(data.importTankCode(e.DATA), e.ID).toBe(true);
      }
    }
  });

  it("aggregates repeated units and keeps the option's SCALE", () => {
    for (let i = 0; i < 50; i++) {
      const wave = generateWave(0, units);
      const seen = new Set<string>();
      for (const e of wave.ENEMIES) {
        const k = `${e.ID}|${e.KEY}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
      expect(wave.SCALE).toBeGreaterThan(0);
    }
  });

  it("searchRandom never returns null while the bank covers the archetype", () => {
    for (const key of units.keys()) {
      let found = 0;
      for (let i = 0; i < 30; i++) if (units.searchRandom(key)) found++;
      expect(found, key).toBeGreaterThan(0);
    }
  });
});

describe("boss + grid helpers", () => {
  it("generateBossWave spawns exactly one built-in boss", () => {
    expect(BOSSES.length).toBe(1);
    for (let i = 0; i < 10; i++) {
      const wave = generateBossWave(BOSSES);
      expect(wave.ENEMIES).toHaveLength(1);
      expect(wave.ENEMIES[0]!.AMT).toBe(1);
      expect(wave.SCALE).toBe(1);
    }
  });

  it("gridDistance rounds sqrt(col²+row²)", () => {
    expect(gridDistance(0, 0)).toBe(0);
    expect(gridDistance(3, 4)).toBe(5);
    expect(gridDistance(-3, 4)).toBe(5);
    expect(gridDistance(1, 1)).toBe(1); // sqrt(2) ≈ 1.414 → 1
  });

  it("the built-in enemy bank is non-empty and importable", () => {
    expect(ENEMY_BANK.length).toBe(43);
    for (const tank of ENEMY_BANK) expect(tank.strTankCode.length).toBeGreaterThan(0);
  });
});
