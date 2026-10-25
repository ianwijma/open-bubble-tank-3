import { describe, expect, it } from "vitest";
import { DESTROYED, FieldStore, type FieldRecord } from "../src/world/FieldStore";

const rec = (col: number, row: number, storedEnemies: FieldRecord["storedEnemies"] = [], bScale = 1): FieldRecord => ({
  xVal: col,
  yVal: row,
  storedEnemies,
  bScale,
});

describe("FieldStore (`_-W-` visited-fields store)", () => {
  it("defaults missing fields to an empty record", () => {
    const store = new FieldStore();
    expect(store.has(2, 3)).toBe(false);
    const rec23 = store.get(2, 3);
    expect(rec23.storedEnemies).toEqual([]);
    expect(rec23.bScale).toBe(1);
  });

  it("upsert + get round-trips enemy snapshots", () => {
    const store = new FieldStore();
    const snapshot = [{ DATA: "abc123", x: 10, y: -4, rot: 90 }];
    store.upsert(rec(2, 3, snapshot, 1.4));
    expect(store.has(2, 3)).toBe(true);
    const got = store.get(2, 3);
    expect(got.storedEnemies).toEqual(snapshot);
    expect(got.bScale).toBe(1.4);
  });

  it("upsert replaces an existing record in place", () => {
    const store = new FieldStore();
    store.upsert(rec(5, 5, [{ DATA: "a", x: 0, y: 0, rot: 0 }], 1));
    store.upsert(rec(5, 5, [], 2));
    expect(store.all()).toHaveLength(1);
    expect(store.get(5, 5).bScale).toBe(2);
    expect(store.get(5, 5).storedEnemies).toEqual([]);
  });

  it("keeps records sorted by (xVal, yVal) after random inserts", () => {
    const store = new FieldStore();
    const cells: Array<[number, number]> = [];
    for (let x = -3; x <= 3; x++) {
      for (let y = -3; y <= 3; y++) cells.push([x, y]);
    }
    // insert in a shuffled order
    cells.sort(() => Math.random() - 0.5);
    for (const [x, y] of cells) store.upsert(rec(x, y));
    const all = store.all();
    expect(all).toHaveLength(49);
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      const cur = all[i]!;
      expect(
        prev.xVal < cur.xVal || (prev.xVal === cur.xVal && prev.yVal < cur.yVal),
        `${prev.xVal},${prev.yVal} before ${cur.xVal},${cur.yVal}`,
      ).toBe(true);
    }
  });

  it("binary search finds all records", () => {
    const store = new FieldStore();
    for (let x = 0; x < 10; x++) store.upsert(rec(x, x % 2));
    for (let x = 0; x < 10; x++) {
      expect(store.has(x, x % 2)).toBe(true);
      expect(store.get(x, x % 2).xVal).toBe(x);
    }
  });

  it("negative coords and row-major ordering behave (y is the secondary key)", () => {
    const store = new FieldStore();
    store.upsert(rec(0, 5));
    store.upsert(rec(0, -5));
    store.upsert(rec(-1, 0));
    expect(store.has(0, 5)).toBe(true);
    expect(store.has(0, -5)).toBe(true);
    expect(store.has(-1, 0)).toBe(true);
    expect(store.has(-1, 1)).toBe(false);
    expect(store.get(0, 4).xVal).toBe(0); // default record for a missing cell
    expect(store.get(0, 4).storedEnemies).toEqual([]);
  });

  it("the DESTROYED marker survives round-trips for cleared worlds", () => {
    const store = new FieldStore();
    store.upsert(rec(1, 1, DESTROYED, 0.8));
    const got = store.get(1, 1);
    expect(got.storedEnemies).toBe(DESTROYED); // same marker identity
    expect(got.bScale).toBe(0.8);
    // a re-visited cleared field restores empty (GameWorld maps DESTROYED → [])
    expect(got.storedEnemies === DESTROYED ? [] : got.storedEnemies).toEqual([]);
  });

  it("stores an independent snapshot per field", () => {
    const store = new FieldStore();
    store.upsert(rec(1, 0, [{ DATA: "one", x: 1, y: 1, rot: 0 }]));
    store.upsert(rec(2, 0, [{ DATA: "two", x: 2, y: 2, rot: 90 }]));
    expect(store.get(1, 0).storedEnemies).toEqual([{ DATA: "one", x: 1, y: 1, rot: 0 }]);
    expect(store.get(2, 0).storedEnemies).toEqual([{ DATA: "two", x: 2, y: 2, rot: 90 }]);
  });
});
