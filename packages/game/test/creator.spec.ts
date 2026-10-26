import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, ENEMY_BANK } from "../src/data/tanks";
import { CLASS_DATA, getBubbleCost, getClassCost, getGunCost, isWeapon } from "../src/data/parts";
import { compressToBase64, decompressFromBase64, PlayerProfile, SettingsStore } from "../src/data/profile";
import { TankCreator, type CreatorPart } from "../src/tanks/creator";
import { TankData } from "../src/tanks/TankData";


function fakeStorage(): { store: Map<string, string>; storage: Storage } {
  const store = new Map<string, string>();
  return {
    store,
    storage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage,
  };
}

describe("SettingsStore (BTA mirror)", () => {
  it("defaults to gData values with the 10000001 L-counter", () => {
    const { storage } = fakeStorage();
    const s = new SettingsStore(storage);
    expect(s.value.intEnemyCountMaster).toBe(10000001);
    expect(s.value.f).toBe(50);
    expect(s.value.h1).toBe(87); // W
    expect(s.value.h5).toBe(80); // P
    expect(s.value.h6).toBe(81); // Q
  });

  it("persists and re-loads with the counter bumped", () => {
    const { store, storage } = fakeStorage();
    const s = new SettingsStore(storage);
    s.save({ intEnemyCountMaster: 10000005 });
    expect(s.value.SavedData).toBe(true);
    const reloaded = new SettingsStore(storage);
    expect(reloaded.value.intEnemyCountMaster).toBe(10000005);
    expect(store.size).toBe(1);
  });
});

describe("PlayerProfile (Player1Profile mirror)", () => {
  it("starts with the sentinel + 31 avatar + 43 enemy built-in rows", () => {
    const p = new PlayerProfile(AVATAR_PRESETS, ENEMY_BANK, fakeStorage().storage);
    expect(p.avatarTanks.length).toBe(32);
    expect(p.enemyTanks.length).toBe(44);
    const sentinel = p.avatarTanks[0]!;
    expect(sentinel).toMatchObject({ Data: "empty", ID: "none", GP: -1 });
    expect(sentinel.TIER).toBe(0);
    expect(p.enemyTanks[0]!.TIER).toBeUndefined();
  });

  it("serialize skips built-ins and round-trips added locals through the zlib+base64 envelope", async () => {
    const { storage } = fakeStorage();
    const p = new PlayerProfile(AVATAR_PRESETS, ENEMY_BANK, storage);
    const tank = new TankData();
    tank.importTankCode(AVATAR_PRESETS[0]!.strTankCode);
    tank.tankName = "Local Hero";
    const id = p.addLocalTank(tank, true, 10000001);
    expect(id).toBe("L10000001");
    const payload = p.serialize();
    expect(payload).not.toContain("empty"); // sentinel skipped
    expect(payload.split("~")).toHaveLength(9);

    const b64 = await compressToBase64(payload);
    const back = await decompressFromBase64(b64);
    expect(back).toBe(payload);

    const fresh = new PlayerProfile(AVATAR_PRESETS, ENEMY_BANK, storage);
    fresh.deserialize(back);
    expect(fresh.avatarTanks.length).toBe(33); // sentinel + 31 built-ins + 1 local
    // the row stores the tank's code — the retrieved data re-imports it
    expect(fresh.retrieveTankBasedOnID("L10000001")?.strTankCode).toBe(tank.strTankCode);
  });

  it("retrieveTankBasedOnID checks both lists for L-ids and only the avatar list for A-ids", () => {
    const p = new PlayerProfile(AVATAR_PRESETS, ENEMY_BANK, fakeStorage().storage);
    const tank = new TankData();
    tank.importTankCode(ENEMY_BANK[0]!.strTankCode);
    const id = p.addLocalTank(tank, false, 10000001); // locally created enemy
    expect(p.retrieveTankBasedOnID(id)).not.toBeNull();
    expect(p.retrieveTankBasedOnID("A99999999")).toBeNull();
    expect(p.retrieveTankBasedOnID("E99999999")).toBeNull();
  });

  it("rebuilds the default unlock list every launch (nothing serialized)", () => {
    const p = new PlayerProfile(AVATAR_PRESETS, ENEMY_BANK, fakeStorage().storage);
    p.grantTierUnlocks(3);
    expect(p.unlockedObjects.has(3001)).toBe(true); // a 3xxx secondary from tier 1-2
    const payload = p.serialize();
    expect(payload).not.toContain("3001");
  });
});

describe("TankCreator budgets", () => {
  function creator(maxClass = 6, unlocked: number[] = [], tier = 0): TankCreator {
    return new TankCreator(true, maxClass, new Set(unlocked), new Set<number>(), tier);
  }

  it("GP budget is arrClassData[class-1].arrGP[tier]", () => {
    const c = creator();
    expect(c.gunBudgetFor(1)).toBe(CLASS_DATA[0]!.arrGP[0]);
    expect(c.gunBudgetFor(3)).toBe(CLASS_DATA[2]!.arrGP[0]);
  });

  it("refuses parts above the GP cap, BP 100 cap, or class cost", () => {
    const c = creator(6, [1001, 2001, 2002]);
    const cheapGun = 2001;
    const gp = getGunCost(cheapGun);
    let placed = 0;
    while (c.canAddPart(cheapGun).ok) {
      expect(c.addPart(cheapGun, 0, 0)).toBe(true);
      placed++;
      if (placed > 20) break;
    }
    expect(c.usedGunPoints()).toBeLessThanOrEqual(c.gunBudgetFor());
    expect(c.usedGunPoints() + gp).toBeGreaterThan(c.gunBudgetFor());
    // complexity: BP cap at 100
    const c2 = creator(6, [1001, 2001]);
    let placed2 = 0;
    while (c2.canAddPart(1001).ok) {
      c2.addPart(1001, 0, 0);
      placed2++;
      if (placed2 > 30) break;
    }
    expect(c2.usedBubblePoints()).toBeLessThanOrEqual(100);
    // class cost gate: a part with intClassCost > currentClass
    const highClass = [2001, 2002, 2015, 2016, 2017, 2018].find((t) => getClassCost(t) > 1);
    if (highClass) {
      const c3 = creator(6, [highClass]);
      expect(c3.canAddPart(highClass).ok).toBe(false);
      c3.setClass(getClassCost(highClass));
      expect(c3.canAddPart(highClass).ok).toBe(true);
    }
  });

  it("mirror placement creates cross-referenced twins at the mirrored x", () => {
    const c = creator(6, [1001, 1002]);
    expect(c.addPart(1001, 42, -30, true)).toBe(true);
    const parts = c.partList;
    expect(parts).toHaveLength(2);
    const [a, b] = parts as [CreatorPart, CreatorPart];
    expect(a.twin).toBe(b.name);
    expect(b.twin).toBe(a.name);
    expect(b.x).toBe(-42);
    expect(b.y).toBe(-30);
    // moving one moves the twin
    c.movePart(a.name, 20, 8);
    expect(b.x).toBe(-20);
    // removing one unlinks the twin
    c.removePart(a.name);
    expect(c.partList).toHaveLength(1);
    expect(c.partList[0]!.twin).toBe("");
  });

  it("derived stats match the verbatim creator formulas", () => {
    const c = creator(3, [1001, 2001], 1);
    expect(c.setClass(3)).toBe(true);
    c.addPart(1001, 0, 0); // body: BP 1
    c.addPart(2001, 14, 0); // gun
    const gp = c.usedGunPoints();
    const bp = c.usedBubblePoints();
    const life = Math.round(bp / 2 + gp * 3) * 3;
    let sub = 0.0005 * life;
    if (sub > 0.1) sub = 0.1;
    const returned = Math.max(1, Math.round(life * (0.3 * ((7 - 3) / 6) + 0.005 * gp + 0.1 - sub)));
    const speed = Math.max(0.1, 3 * ((6 - 3) / 6) + 0.5 - gp * 0.1);
    const stats = c.derivedStats();
    expect(stats.life).toBe(life);
    expect(stats.bubblesReturned).toBe(returned);
    expect(stats.speed).toBeCloseTo(speed, 6);
    expect(stats.difficulty).toBe(1);
  });

  it("builds a tank that survives the plaintext→code envelope round-trip", () => {
    const c = creator(6, [1001, 2001, 2002], 4);
    expect(c.setClass(6)).toBe(true); // class 6 needs tier ≥ 5 (budget 20)
    c.addPart(1001, 0, 0, true); // body + mirror twin
    c.addPart(2001, 14, 0);
    const data = c.build("Test Tank", "Tester");
    expect(data).not.toBeNull();
    expect(data!.tankName).toBe("Test Tank");
    expect(data!.author).toBe("Tester");
    expect(data!.avatarTank).toBe(true);
    expect(data!.numClass).toBe(6);
    expect(data!.details.length).toBe(3);
    const stats = c.derivedStats();
    expect(data!.numLife).toBe(stats.life);
    expect(data!.numBubblesReturned).toBe(stats.bubblesReturned);
    // the raw creator speed ships in the code, but an AVATAR's effective
    // speed is always the class multiplier (docs 05 §2.4; recomputeStats)
    expect(data!.numSpeed).toBeCloseTo(CLASS_DATA[5]!.intSpeed, 6);
    // the envelope round-trip: export → import → same parts
    const code = data!.exportTankCode();
    const reimport = new TankData();
    expect(reimport.importTankCode(code)).toBe(true);
    expect(reimport.details.length).toBe(3);
    expect(reimport.numLife).toBe(stats.life);
    expect(reimport.tankName).toBe("Test Tank");
  });
});
