/**
 * Wave archetype RULE engine — the port of `_-3y._-5E` / `_-as` / `GetLocalTank`.
 *
 * A RULE is a semicolon-joined list of `field,comparison,value` triples:
 *   fields: 6=CLASS 7=GP 8=BP 11=DIFF 12=SP 13=BR 15=SUP 16=LIFE
 *   comparisons: 1 ==, 2 >, 3 <
 * (docs 03 §3, 05 §6.7, 07 §2.2 — full archetype table transcribed from _-3y.as).
 */

export const RULE_FIELD = {
  CLASS: 6,
  GP: 7,
  BP: 8,
  DIFF: 11,
  SP: 12,
  BR: 13,
  SUP: 15,
  LIFE: 16,
} as const;

/** Stat record shape carried by profile tank rows (docs 05 §4.2). */
export interface TankStats {
  CLASS: number;
  GP: number;
  BP: number;
  DIFF: number;
  SP: number;
  BR: number;
  SUP: boolean;
  LIFE: number;
}

export interface RuleClause {
  field: number;
  op: 1 | 2 | 3;
  value: number | boolean;
}

/** Parse "6,1,1;12,3,1.1" → clauses. Trailing ":8,1" sort tag is stripped. */
export function parseRule(rule: string): RuleClause[] {
  const clean = rule.split(":")[0] ?? "";
  const clauses: RuleClause[] = [];
  for (const part of clean.split(";")) {
    const seg = part.trim();
    if (!seg) continue;
    const [f, op, v] = seg.split(",");
    if (f === undefined || op === undefined || v === undefined) continue;
    const field = Number(f);
    const cmp = Number(op) as 1 | 2 | 3;
    if (!Number.isFinite(field)) continue;
    if (v === "true" || v === "false") {
      clauses.push({ field, op: cmp, value: v === "true" });
    } else {
      clauses.push({ field, op: cmp, value: Number(v) });
    }
  }
  return clauses;
}

/** `_-as(v, ref, cmp)` — numeric/string comparison evaluator. */
export function clauseMatches(stats: TankStats, clause: RuleClause): boolean {
  const { field, op, value } = clause;
  const actual = readField(stats, field);
  if (typeof value === "boolean") return actual === value;
  if (typeof actual === "boolean") return false;
  switch (op) {
    case 1: return actual === value;
    case 2: return actual > value;
    case 3: return actual < value;
  }
}

function readField(stats: TankStats, field: number): number | boolean {
  switch (field) {
    case RULE_FIELD.CLASS: return stats.CLASS;
    case RULE_FIELD.GP: return stats.GP;
    case RULE_FIELD.BP: return stats.BP;
    case RULE_FIELD.DIFF: return stats.DIFF;
    case RULE_FIELD.SP: return stats.SP;
    case RULE_FIELD.BR: return stats.BR;
    case RULE_FIELD.SUP: return stats.SUP;
    case RULE_FIELD.LIFE: return stats.LIFE;
    default: return NaN;
  }
}

/** Does a tank satisfy every clause of the rule? */
export function matchesRule(stats: TankStats, rule: string): boolean {
  const clauses = parseRule(rule);
  if (clauses.length === 0) return false;
  return clauses.every((c) => clauseMatches(stats, c));
}

/**
 * Archetype KEY → RULE table (`_-3y._-5E`, _-3y.as:449-524, via docs 07 §2.2).
 * These bucket the tank bank into enemy archetypes; the wave instructions
 * reference them by KEY.
 */
export const ARCHETYPE_RULES: Record<string, string> = {
  TinyDeadHead: "6,1,1;7,1,0;12,3,1.1;8,3,12;13,3,3;16,3,4",
  SmallDeadHead: "6,1,1;7,1,0;12,2,1.2;12,3,3.6;8,3,10;13,2,1;13,3,4;16,2,0;16,3,4",
  SmallFighter: "6,1,1;7,1,1;12,2,1.8;12,3,3.6;8,3,16;13,2,1;13,3,6;16,2,3;16,3,9",
  Balanced: "6,3,4;11,2,0;11,3,3;7,2,2;7,3,5;8,3,50;13,2,3;13,3,11;16,2,10;16,3,45",
  EarlyHeavy: "6,3,3;11,2,0;11,3,3;7,1,2;12,2,0.4;12,3,1.1;8,3,28;13,2,3;13,3,11;16,2,9;16,3,19",
  MediumDeadHead: "6,2,1;6,3,4;11,2,-2;11,3,1;7,1,0;12,2,0.2;12,3,2.5;13,2,12;13,3,26;16,2,9;16,3,30;8,3,20",
  Fighter: "6,1,1;11,2,0;11,3,3;7,1,2;12,2,1.4;12,3,3.6;8,3,40;13,2,2;13,3,11;16,2,9;16,3,20",
  LightHeavy: "6,1,2;11,2,0;11,3,3;7,2,1;7,3,4;12,2,0.2;12,3,1;8,2,10;8,3,50;13,2,4;13,3,11;16,2,15;16,3,35",
  HeavyMiniBoss: "6,2,3;11,2,9;11,3,18;7,2,9;12,3,0.9;8,2,40;13,2,40;16,2,200;16,3,510",
  Heavy: "6,1,3;11,2,2;11,3,5;7,2,3;7,3,7;12,2,0.2;12,3,0.9;8,2,15;8,3,50;13,2,9;13,3,25;16,2,29;16,3,51",
  VeryHeavy: "6,2,2;11,2,5;11,3,13;7,2,8;7,3,15;12,3,1.5;8,2,15;8,3,70;13,2,14;13,3,31;16,2,90;16,3,180",
  SmallSupport: "6,3,3;11,2,-1;11,3,3;7,2,0;7,3,3;12,2,1;12,3,3;15,1,true;13,2,5;13,3,10;16,2,18;16,3,25",
  HeavyFighter: "6,3,3;11,2,3;11,3,7;7,2,3;7,3,8;12,2,1.9;12,3,3.1;8,2,5;8,3,35;13,2,5;13,3,20;16,2,20;16,3,45",
  SuperFighter: "6,3,3;11,2,6;11,3,13;7,2,6;7,3,13;12,2,2.1;12,3,3.6;8,2,5;8,3,35;13,2,9;13,3,30;16,2,49;16,3,110",
  FighterMiniBoss: "6,3,4;11,2,9;11,3,18;7,2,9;12,2,2.2;8,3,60;13,2,40;16,2,150;16,3,410",
  OpenEarlyUnit: "6,3,3;11,2,0;11,3,5;13,2,0;13,3,20;16,2,2;16,3,31",
  OpenFighter: "6,3,4;11,3,10;16,3,100",
  OpenHeavy: "6,2,2;11,2,3;16,2,30;16,3,200",
  OpenMiniBoss: "11,2,9;16,2,199;16,3,1001",
};

/** `_-a8(KEY)` — the effective rule used at runtime (sort tag appended). */
export function effectiveRule(key: string): string {
  const base = ARCHETYPE_RULES[key];
  return base ? base + ":8,1" : ":8,1";
}
