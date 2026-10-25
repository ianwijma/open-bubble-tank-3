import { describe, expect, it } from "vitest";
import {
  ARCHETYPE_RULES,
  clauseMatches,
  effectiveRule,
  matchesRule,
  parseRule,
  RULE_FIELD,
  type TankStats,
} from "../src/data/rules";

const stats = (over: Partial<TankStats> = {}): TankStats => ({
  CLASS: 1,
  GP: 0,
  BP: 5,
  DIFF: 1,
  SP: 2.0,
  BR: 2,
  SUP: false,
  LIFE: 3,
  ...over,
});

describe("parseRule", () => {
  it("parses field,op,value clauses", () => {
    expect(parseRule("6,1,1;12,3,3.6")).toEqual([
      { field: RULE_FIELD.CLASS, op: 1, value: 1 },
      { field: RULE_FIELD.SP, op: 3, value: 3.6 },
    ]);
  });

  it("strips the trailing :8,1 sort tag", () => {
    const clauses = parseRule("6,1,1;8,1");
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toEqual({ field: 6, op: 1, value: 1 });
  });

  it("parses boolean values (support flag)", () => {
    const clauses = parseRule("15,1,true");
    expect(clauses).toEqual([{ field: 15, op: 1, value: true }]);
  });

  it("skips malformed segments and negative ranges keep both bounds", () => {
    expect(parseRule("6,1")).toEqual([]);
    expect(parseRule("")).toEqual([]);
    // SP range "1.2<speed<3.6" is two clauses: 12,2,1.2 and 12,3,3.6
    expect(parseRule("12,2,1.2;12,3,3.6")).toHaveLength(2);
  });
});

describe("clauseMatches / matchesRule", () => {
  it("applies op 1 ==, 2 >, 3 <", () => {
    const s = stats({ CLASS: 2, SP: 3, LIFE: 10 });
    expect(clauseMatches(s, { field: 6, op: 1, value: 2 })).toBe(true);
    expect(clauseMatches(s, { field: 6, op: 1, value: 3 })).toBe(false);
    expect(clauseMatches(s, { field: 12, op: 2, value: 2.9 })).toBe(true);
    expect(clauseMatches(s, { field: 12, op: 2, value: 3.0 })).toBe(false);
    expect(clauseMatches(s, { field: 16, op: 3, value: 11 })).toBe(true);
    expect(clauseMatches(s, { field: 16, op: 3, value: 10 })).toBe(false);
  });

  it("compares booleans exactly and numeric-vs-boolean fields never match", () => {
    expect(clauseMatches(stats({ SUP: true }), { field: 15, op: 1, value: true })).toBe(true);
    expect(clauseMatches(stats({ SUP: false }), { field: 15, op: 1, value: true })).toBe(false);
    expect(clauseMatches(stats({ SUP: false }), { field: 15, op: 1, value: 1 })).toBe(false);
  });

  it("requires every clause (conjunction)", () => {
    const rule = "6,1,1;12,2,1.5";
    expect(matchesRule(stats({ CLASS: 1, SP: 2 }), rule)).toBe(true);
    expect(matchesRule(stats({ CLASS: 3, SP: 2 }), rule)).toBe(false);
    expect(matchesRule(stats({ CLASS: 1, SP: 1 }), rule)).toBe(false);
  });

  it("returns false for empty rules and unknown fields", () => {
    expect(matchesRule(stats(), "")).toBe(false);
    expect(matchesRule(stats(), "99,1,1")).toBe(false);
  });
});

describe("SmallDeadHead archetype", () => {
  // docs 03 §3: class==1; GP==0; 1.2<speed<3.6; BP<10; 1≤BR<4; 0≤LIFE<4
  const rule = ARCHETYPE_RULES.SmallDeadHead!;

  it("accepts a textbook deadhead", () => {
    expect(
      matchesRule(stats({ CLASS: 1, GP: 0, SP: 2.5, BP: 7, BR: 2, LIFE: 2 }), rule),
    ).toBe(true);
  });

  it("rejects class-3 and fast tanks", () => {
    expect(matchesRule(stats({ CLASS: 3, GP: 0, SP: 2.5, BP: 7, BR: 2, LIFE: 2 }), rule)).toBe(false);
    expect(matchesRule(stats({ CLASS: 1, GP: 0, SP: 4.0, BP: 7, BR: 2, LIFE: 2 }), rule)).toBe(false);
  });

  it("rejects tanks with guns (GP>0)", () => {
    expect(matchesRule(stats({ CLASS: 1, GP: 2, SP: 2.5, BP: 7, BR: 2, LIFE: 2 }), rule)).toBe(false);
  });
});

describe("archetype table", () => {
  it("parses every archetype rule non-empty", () => {
    for (const [key, rule] of Object.entries(ARCHETYPE_RULES)) {
      const clauses = parseRule(rule);
      expect(clauses.length, key).toBeGreaterThan(0);
      for (const c of clauses) {
        expect([6, 7, 8, 11, 12, 13, 15, 16], `${key} field ${c.field}`).toContain(c.field);
        expect([1, 2, 3], `${key} op ${c.op}`).toContain(c.op);
      }
    }
  });

  it("appends the :8,1 sort tag", () => {
    expect(effectiveRule("Balanced")).toBe(ARCHETYPE_RULES.Balanced! + ":8,1");
    expect(effectiveRule("NoSuchKey")).toBe(":8,1");
  });
});
