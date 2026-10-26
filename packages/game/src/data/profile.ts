/**
 * PlayerProfile + settings persistence — the port of the two Flash
 * SharedObjects (docs 05 §4):
 *
 *   - `"BTA"` — settings (`q,s,m,ss,f,h1..h6`), `arrLocalRatings`,
 *     `SavedData`, `intEnemyCountMaster` (the `L`-ID counter, starts
 *     10000001),
 *   - `"Player1Profile"` — one field `strCompressed`: zlib-compress +
 *     Base64 of a 9-field `~`-joined payload holding the tank lists.
 *
 * Tank rows (`_-1Y`/`_-L6` shape): `{Data, ID, blnShowInSearch, CLASS, GP,
 * BP, DIFF, SP, BR, SUP, LIFE, NAME, AUTH, HI(, TIER)}` with a sentinel
 * first row `{Data:"empty", ID:"none", …}` that the save/load loops skip.
 *
 * `arrUnlockedObjects` is NOT serialized (docs 05 §4.3): it is rebuilt to
 * the default set on every launch — the port mirrors that exactly.
 */

import { DEFAULT_FPS, LOCAL_ID_START, STORAGE_KEY_PROFILE, STORAGE_KEY_SETTINGS } from "../core/constants";
import { getDefaultUnlockedObjects, TIER_UNLOCKS } from "./parts";
import { statRecord } from "./tanks";
import { TankData } from "../tanks/TankData";

// ---------------------------------------------------------------- settings

/** `gData.prehot1..6` — W/S/A/D/P/Q key codes. */
export const DEFAULT_HOTKEYS = { h1: 87, h2: 83, h3: 65, h4: 68, h5: 80, h6: 81 };

/** `BTA` SharedObject mirror — field names kept verbatim (docs 05 §4.1). */
export interface PersistedSettings {
  /** Render quality (the port always renders at HIGH). */
  q: "LOW" | "MEDIUM" | "HIGH";
  s: boolean;
  m: boolean;
  /** Screen shake. */
  ss: boolean;
  /** FPS (35/50/65). */
  f: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  h5: number;
  h6: number;
  arrLocalRatings: Array<{ TankID: string; Rating: number }>;
  /** "has saved" flag. */
  SavedData: boolean;
  /** `L`-ID counter for locally created tanks (starts 10000001). */
  intEnemyCountMaster: number;
}

const SETTINGS_DEFAULTS: PersistedSettings = {
  q: "HIGH",
  s: true,
  m: true,
  ss: true,
  f: DEFAULT_FPS,
  ...DEFAULT_HOTKEYS,
  arrLocalRatings: [],
  SavedData: false,
  intEnemyCountMaster: LOCAL_ID_START,
};

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** localStorage-backed `BTA` mirror. Storage failures disable saving
 * (`Main._-3E = false` semantics — the port degrades to memory-only). */
export class SettingsStore {
  private data: PersistedSettings;
  private savesDisabled = false;

  constructor(private readonly storage: Storage | null = safeLocalStorage()) {
    this.data = this.load();
  }

  get value(): PersistedSettings {
    return this.data;
  }

  get canSave(): boolean {
    return !this.savesDisabled;
  }

  /** `SaveAllData` — merge partials, set the saved flag, persist. */
  save(partial?: Partial<PersistedSettings>): void {
    this.data = { ...this.data, ...partial, SavedData: true };
    if (!this.storage || this.savesDisabled) return;
    try {
      this.storage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(this.data));
    } catch {
      this.savesDisabled = true; // flush failure → saving disabled
    }
  }

  private load(): PersistedSettings {
    if (!this.storage) return { ...SETTINGS_DEFAULTS };
    try {
      const raw = this.storage.getItem(STORAGE_KEY_SETTINGS);
      if (!raw) return { ...SETTINGS_DEFAULTS };
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return { ...SETTINGS_DEFAULTS, ...parsed };
    } catch {
      return { ...SETTINGS_DEFAULTS };
    }
  }
}

// ---------------------------------------------------------- tank list rows

/** `_-1Y`/`_-L6` row shape (docs 05 §4.2). */
export interface TankRow {
  Data: string;
  ID: string;
  blnShowInSearch: string;
  CLASS: number;
  GP: number;
  BP: number;
  DIFF: number;
  SP: number;
  BR: number;
  SUP: boolean;
  LIFE: number;
  NAME: string;
  AUTH: string;
  HI: string;
  TIER?: number;
}

/** The sentinel row every list starts with (skipped by save/load loops). */
export function sentinelRow(withTier: boolean): TankRow {
  const row: TankRow = {
    Data: "empty",
    ID: "none",
    blnShowInSearch: "true",
    CLASS: 0,
    GP: -1,
    BP: 0,
    DIFF: -1,
    SP: 0,
    BR: 0,
    SUP: false,
    LIFE: 0,
    NAME: "name",
    AUTH: "author",
    HI: "true",
  };
  if (withTier) row.TIER = 0;
  return row;
}

function rowFromTank(tank: TankData, id: string, tier: number | undefined, builtIn: boolean): TankRow {
  const stats = statRecord(tank);
  const row: TankRow = {
    Data: tank.strTankCode,
    ID: id,
    blnShowInSearch: "true",
    CLASS: stats.CLASS,
    GP: stats.GP,
    BP: stats.BP,
    DIFF: stats.DIFF,
    SP: stats.SP,
    BR: stats.BR,
    SUP: stats.SUP,
    LIFE: stats.LIFE,
    NAME: stats.NAME,
    AUTH: stats.AUTH,
    HI: builtIn ? "true" : "false",
  };
  if (tier !== undefined) row.TIER = tier;
  return row;
}

// ---------------------------------------------------------------- profile

/** `PlayerProfile` — the `Player1Profile` SharedObject mirror. */
export class PlayerProfile {
  /** `_ -ch` — avatar tank list (sentinel + 31 built-ins + local). */
  readonly avatarTanks: TankRow[] = [sentinelRow(true)];
  /** `_ -BK` — enemy tank list (sentinel + 43 built-ins + local). */
  readonly enemyTanks: TankRow[] = [sentinelRow(false)];
  /** `_-JH` — pending/failed tank codes (payload field 2). */
  readonly pendingCodes: string[] = [];
  /** `strPreviousTankProgression` (payload field 8). */
  previousTankProgression = "";
  /** `arrUnlockedObjects` — rebuilt to the default set every launch. */
  readonly unlockedObjects: Set<number> = new Set(getDefaultUnlockedObjects());

  private savesDisabled = false;

  constructor(
    avatarBank: TankData[],
    enemyBank: TankData[],
    private readonly storage: Storage | null = safeLocalStorage(),
  ) {
    // `_-L6` — built-ins re-added on every load with HI = true. The TIER on
    // built-in avatar rows is 0 (starter-grade; TankData carries no tier).
    for (const tank of avatarBank) {
      this.avatarTanks.push(rowFromTank(tank, tank.strID, 0, true));
    }
    for (const tank of enemyBank) {
      this.enemyTanks.push(rowFromTank(tank, tank.strID, undefined, true));
    }
  }

  /** `_-4s` — async load (base64 → inflate → parse); no-op when empty. */
  async loadAsync(): Promise<void> {
    if (!this.storage) return;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY_PROFILE);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      this.deserialize(await decompressFromBase64(raw));
    } catch {
      // a broken save is ignored (the original try/catches the load too)
    }
  }

  /** `_-Lm` — serialize + persist (zlib + base64 of the 9-field payload). */
  async save(): Promise<void> {
    if (!this.storage || this.savesDisabled) return;
    try {
      this.storage.setItem(STORAGE_KEY_PROFILE, await compressToBase64(this.serialize()));
    } catch {
      this.savesDisabled = true;
    }
  }

  /** `_-Wu` — the 9-field `~`-joined payload (docs 05 §4.2). */
  serialize(): string {
    // save starts AFTER the sentinel + 31 built-in avatar rows / + 43 enemy
    const avatarRows = this.avatarTanks
      .slice(32)
      .map((r) => `${r.Data};${r.ID};${r.blnShowInSearch}`)
      .join("|");
    const enemyRows = this.enemyTanks
      .slice(44)
      .map((r) => `${r.Data};${r.ID};${r.blnShowInSearch}`)
      .join("|");
    return [
      avatarRows,
      enemyRows,
      this.pendingCodes.join("|"),
      "false", // _-Xq (unknown purpose)
      "false", // _-bP achievements-tutorial pair
      "0", // intAchievementTutorialShown
      "false", // _-Do (unknown purpose)
      "false", // _-7W start-notification seen
      this.previousTankProgression,
    ].join("~");
  }

  /** `_-Ly(_-Ht(...))` parse — rows load from index 1 (sentinels skipped). */
  deserialize(payload: string): void {
    if (!payload) return;
    const fields = payload.split("~");
    this.importRows(fields[0] ?? "", this.avatarTanks, true);
    this.importRows(fields[1] ?? "", this.enemyTanks, false);
    this.pendingCodes.length = 0;
    for (const code of (fields[2] ?? "").split("|")) if (code) this.pendingCodes.push(code);
    this.previousTankProgression = fields[8] ?? "";
  }

  private importRows(chunk: string, list: TankRow[], isAvatar: boolean): void {
    let first = true;
    for (const row of chunk.split("|")) {
      if (!row) continue;
      const [Data, ID] = row.split(";");
      if (!Data || !ID) continue;
      if (first && Data === "empty") {
        first = false; // load loop skips the sentinel
        continue;
      }
      first = false;
      const tank = new TankData();
      list.push(tank.importTankCode(Data) ? rowFromTank(tank, ID, isAvatar ? 0 : undefined, false) : { ...sentinelRow(isAvatar), Data, ID, HI: "false" });
    }
  }

  /** `_-1Y` — add a locally created tank under the next `L` id. */
  addLocalTank(tank: TankData, isAvatar: boolean, idCounter: number): string {
    const id = `L${idCounter}`;
    (isAvatar ? this.avatarTanks : this.enemyTanks).push(rowFromTank(tank, id, isAvatar ? 0 : undefined, false));
    return id;
  }

  /** `RetrieveTankBasedOnID` — `A`→avatars, `E`→enemies, `L`→both. */
  retrieveTankBasedOnID(id: string): TankData | null {
    const lists = id.startsWith("A") ? [this.avatarTanks] : id.startsWith("E") ? [this.enemyTanks] : [this.avatarTanks, this.enemyTanks];
    for (const list of lists) {
      const row = list.find((r) => r.ID === id);
      if (!row || row.Data === "empty") continue;
      const data = new TankData();
      if (data.importTankCode(row.Data)) return data;
    }
    return null;
  }

  /** Tier grants — parts unlock as the avatar levels (docs 05 §4.3). */
  grantTierUnlocks(level: number): void {
    for (let tier = 0; tier < level; tier++) {
      for (const id of TIER_UNLOCKS[tier] ?? []) this.unlockedObjects.add(id);
    }
  }
}

// ------------------------------------------------------- zlib + base64

/** `_-On` — zlib-compress (AS3 `ByteArray.compress()` = zlib stream) then
 * Base64 (standard alphabet). Native CompressionStream('deflate') = zlib. */
export async function compressToBase64(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const buf = await new Response(stream).arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

/** `_-Ht` inverse — base64 → inflate → utf8 (async; Node ≥ 18 / browsers). */
export async function decompressFromBase64(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buf);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
