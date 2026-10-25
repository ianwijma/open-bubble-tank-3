/**
 * Visited-fields store — the port of `_-W-` (docs 03 §2): a sorted array of
 * `{xVal, yVal, storedEnemies, bScale}` records keyed by grid coordinates,
 * kept sorted for binary search (the original uses `binSearch` + `sortOn`).
 *
 * Semantics that must be preserved:
 * - Revisited field → enemies restored exactly (positions + rotation + scale).
 * - Cleared field → empty snapshot → stays empty forever ("the world remembers").
 * - Apocalypse-destroyed field → snapshot is the literal marker ["destroyed"],
 *   and the jump logic chains onward in the same direction past destroyed
 *   fields until a non-destroyed neighbor is found.
 */

export interface StoredEnemy {
  /** Encrypted tank code the enemy was built from. */
  DATA: string;
  x: number;
  y: number;
  rot: number;
}

export interface FieldRecord {
  xVal: number;
  yVal: number;
  /** ["destroyed"] marker or an enemy snapshot list. */
  storedEnemies: StoredEnemy[] | typeof DESTROYED;
  bScale: number;
}

export const DESTROYED = ["destroyed"];

export class FieldStore {
  private records: FieldRecord[] = [];

  /** `BoolSearch` — is (col,row) recorded? `indexOf` returns −(insertion+1) for misses. */
  has(col: number, row: number): boolean {
    return this.indexOf(col, row) >= 0;
  }

  /** `EnemySearch` — the record for (col,row), or a default empty one. */
  get(col: number, row: number): FieldRecord {
    const i = this.indexOf(col, row);
    return (
      this.records[i] ?? { xVal: 0, yVal: 0, storedEnemies: [], bScale: 1 }
    );
  }

  /** `PositionSearch` — insertion index, or the record's index if present. */
  indexOf(col: number, row: number): number {
    let lo = 0;
    let hi = this.records.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rec = this.records[mid];
      if (!rec) break;
      if (rec.xVal === col && rec.yVal === row) return mid;
      if (rec.xVal < col || (rec.xVal === col && rec.yVal < row)) lo = mid + 1;
      else hi = mid - 1;
    }
    return -lo - 1; // bitwise complement = insertion point (binary-search convention)
  }

  /** Insert or replace a record, keeping the xVal/yVal sort order. */
  upsert(record: FieldRecord): void {
    const i = this.indexOf(record.xVal, record.yVal);
    if (i >= 0) {
      this.records[i] = record;
    } else {
      this.records.splice(~i, 0, record);
    }
  }

  /** All records (persistence tests / debug). */
  all(): FieldRecord[] {
    return this.records;
  }
}
