/**
 * GameWorld — the port of `BTAGameWorld` (docs 03 §2/§4b, 07 §2-3).
 *
 * Coordinate model (equivalent to the original's world-shift rendering):
 * the avatar's tank lives in FIELD-LOCAL coordinates (the same space as
 * enemies/bullets); each field's view is positioned so that the avatar's
 * field-local position renders at the stage center. Movement integrates the
 * avatar's field-local position (+v) and shifts the field views (−v) — the
 * same relative geometry the original produces by sliding the world under a
 * stage-centered avatar clip. During transit both fields slide together by
 * the per-frame step while the avatar stays stage-centered.
 *
 * Modes (`_-Up`): 0 playing · 1 menu overlay · 2 jump transit · 3
 * input-locked · 4 freeze-time (parts-pack; stubbed).
 */

import {
  STAGE_CENTER_X,
  STAGE_CENTER_Y,
  TRANSIT_ARRIVE_DIST_SQ,
} from "../core/constants";
import { DisplayNode } from "../core/DisplayNode";
import { randInt } from "../core/math";
import type { InputSnapshot } from "../core/Input";
import { BOSSES, getStartingAvatar } from "../data/tanks";
import { generateBossWave, generateWave, UnitTable } from "../data/waves";
import { EnemyAI } from "../entities/EnemyAI";
import type { SoundCue } from "../entities/field-context";
import { Tank, TANK_TYPE } from "../entities/Tank";
import { TankData } from "../tanks/TankData";
import { AvatarInterface } from "../ui/AvatarInterface";
import { BubbleField } from "./BubbleField";
import { DESTROYED, FieldStore, type StoredEnemy } from "./FieldStore";

export const WORLD_MODE = { PLAYING: 0, MENU: 1, TRANSIT: 2, LOCKED: 3, FREEZE: 4 } as const;
export type WorldMode = (typeof WORLD_MODE)[keyof typeof WORLD_MODE];

export type JumpDirection = "left" | "right" | "up" | "down";

const DIRECTION_DELTA: Record<JumpDirection, { col: number; row: number }> = {
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
};

/** Minimap arrow rotations per jump direction (BTAGameWorld.as:1786-1800). */
const ARROW_ROTATION: Record<JumpDirection, number> = { left: 0, up: 90, right: 180, down: 270 };

export class GameWorld {
  readonly view = new DisplayNode(undefined, "gameWorld");
  readonly hud = new AvatarInterface();
  readonly store = new FieldStore();
  readonly units = new UnitTable();

  mode: WorldMode = WORLD_MODE.PLAYING;

  /** Grid coordinates of the current field (`_-cK`/`_-7U`). */
  col = 0;
  row = 0;

  currentField!: BubbleField;
  private nextField: BubbleField | null = null;
  private nextDirection: JumpDirection | null = null;
  /** Grid coords of the field being departed (for the arrival store write). */
  private departCol = 0;
  private departRow = 0;
  /** `_-5d` — a bubblefield jump is mid-flight. */
  jumping = false;

  avatar!: Tank;
  /** `_-Xw` — the progression boss has been triggered. */
  private bossTriggered = false;
  /** `_-41` — unique fields visited (fresh visits only). */
  visitedCount = 0;
  private frameCounter = 0;

  /** Fired when the boss field is beaten (win screen is M5). */
  onBossDefeated: (() => void) | null = null;
  /** Sound sink wired by the Game (noop until assets load). */
  soundSink: { play(cue: SoundCue): void } = { play: () => {} };

  // Layer containers: fields append (next renders above current in transit),
  // the avatar renders above fields, the HUD above everything.
  private fieldLayer = new DisplayNode(undefined, "fieldLayer");
  private avatarView = new DisplayNode(undefined, "avatarView");

  // ------------------------------------------------------------------ setup

  /** `Setup` + `PlaceFirstBubblefield` — the empty tutorial field. */
  setup(): void {
    this.view.addChild(this.fieldLayer);
    this.view.addChild(this.avatarView);
    this.view.addChild(this.hud.view);

    this.currentField = this.makeField({ scale: 1, col: 0, row: 0 });

    // First field: no wave (tutorial field; `PlaceFirstBubblefield` spawns none).
    this.avatar = new Tank(getStartingAvatar(), TANK_TYPE.AVATAR, this.currentField);
    this.avatar.x = 0;
    this.avatar.y = 0;
    this.avatar.onAvatarDeathJump = () => this.deathJump();

    this.avatarView.addChild(this.avatar.view);
    this.hud.setup(this.avatar, (vx, vy) => this.adjustBubblefieldObjects(vx, vy));
    this.hud.markCurrent(0, 0);
    this.hud.currentCol = 0;
    this.hud.currentRow = 0;
    this.positionCurrentField();
  }

  private makeField(options: { scale: number; col: number; row: number }): BubbleField {
    const field = new BubbleField(options);
    field.sounds = this.soundSink;
    field.onCompleted = (completed) => {
      if (completed.isBossField) this.onBossDefeated?.();
    };
    this.fieldLayer.addChild(field.view);
    return field;
  }

  /** Invariant: field view position = stage center − avatar field-local. */
  private positionCurrentField(): void {
    this.currentField.view.x = STAGE_CENTER_X - this.avatar.x;
    this.currentField.view.y = STAGE_CENTER_Y - this.avatar.y;
  }

  /** `AdjustBubblefieldObjects` — world slides by −v (both fields in transit). */
  adjustBubblefieldObjects(vx: number, vy: number): void {
    this.currentField.view.x -= vx;
    this.currentField.view.y -= vy;
    if (this.nextField) {
      this.nextField.view.x -= vx;
      this.nextField.view.y -= vy;
    }
  }

  // -------------------------------------------------------------------- run

  /** `BTAGameWorld.Run` mode switch (BTAGameWorld.as:517-560). */
  run(input: InputSnapshot): void {
    this.frameCounter++;
    // Aim point: the mouse in field-local space (the HUD/guns read it).
    this.currentField.avatarAimPoint = {
      x: input.mouseX - this.currentField.view.x,
      y: input.mouseY - this.currentField.view.y,
    };
    // The avatar's view is stage-anchored: always at center, rotated with the hull.
    this.avatar.view.x = STAGE_CENTER_X;
    this.avatar.view.y = STAGE_CENTER_Y;
    this.avatar.view.rotation = this.avatar.rotation;
    switch (this.mode) {
      case WORLD_MODE.PLAYING:
        this.checkExitTrigger();
        this.hud.run(input);
        this.currentField.run();
        this.avatar.run();
        break;
      case WORLD_MODE.TRANSIT:
        // Mode 2 runs the interface + both fields + the transit step; the
        // avatar entity itself does not Run (its weapons pause mid-jump).
        this.hud.run(input);
        this.currentField.run();
        this.nextField?.run();
        this.moveAvatarToNewBubblefieldLocation();
        break;
      case WORLD_MODE.MENU:
      case WORLD_MODE.LOCKED:
      case WORLD_MODE.FREEZE:
        // Menu overlays / dialogs / freeze-time: M2+ (stubs ledger).
        break;
    }
  }

  /** Pause/resume (mode 1 overlay; the Game draws the pause menu). */
  pause(): void {
    if (this.mode === WORLD_MODE.PLAYING) this.mode = WORLD_MODE.MENU;
  }

  resume(): void {
    if (this.mode === WORLD_MODE.MENU) this.mode = WORLD_MODE.PLAYING;
  }

  // ------------------------------------------------------------- exit/jump

  /** `IsAvatarOutsideOfBubblefield` — dist² > radius² (docs 03 §2). */
  isAvatarOutsideOfBubblefield(): boolean {
    const radius = this.currentField.fieldRadius;
    return this.avatar.x ** 2 + this.avatar.y ** 2 > radius * radius;
  }

  /** `_-ZY` — exit trigger, checked in mode 0 while not jumping. */
  private checkExitTrigger(): void {
    if (this.jumping) return;
    if (!this.isAvatarOutsideOfBubblefield()) return;
    this.hud.blnStopShoot = true;
    this.exitViaNearestMarker(false);
  }

  /** The four rim markers in field-local coordinates (`BFPoint_*_mc`). */
  private markers(): Array<{ name: string; x: number; y: number; direction: JumpDirection }> {
    const r = this.currentField.fieldRadius;
    return [
      { name: "BFPoint_left_mc", x: -r, y: 0, direction: "left" },
      { name: "BFPoint_right_mc", x: r, y: 0, direction: "right" },
      { name: "BFPoint_top_mc", x: 0, y: -r, direction: "up" },
      { name: "BFPoint_bottom_mc", x: 0, y: r, direction: "down" },
    ];
  }

  /** `_-Ud` — nearest marker to the avatar's field-local position. */
  private nearestMarker(): { name: string; x: number; y: number; direction: JumpDirection } {
    let best = this.markers()[0]!;
    let bestD = (this.avatar.x - best.x) ** 2 + (this.avatar.y - best.y) ** 2;
    for (const marker of this.markers().slice(1)) {
      const d = (this.avatar.x - marker.x) ** 2 + (this.avatar.y - marker.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = marker;
      }
    }
    return best;
  }

  /**
   * `_-1E(deathJump)` — exit via the nearest marker. Directions are checked
   * against `gData._-6N` (["left","right","up","down"] — all four allowed in
   * this build; the boolean allow-flag is vestigial in the original too).
   */
  exitViaNearestMarker(deathJump: boolean): void {
    if (this.jumping) return; // death-jumps during transit would stack fields (original glitch; guarded here)
    const marker = this.nearestMarker();
    this.attachNewBubblefield(marker.direction, deathJump);
    this.jumping = true;
    // `_-5d` lives on the world but the field refuses bullet spawns while it
    // is set — keep the current field's mirror flag in step.
    this.currentField.setJumping(true);
    this.hud.blnStopShoot = true;
    this.mode = WORLD_MODE.TRANSIT;
  }

  /** Death flow entry (`_-Zx.Damage` level-0 clamp → `_-1E(true)`). */
  private deathJump(): void {
    this.exitViaNearestMarker(true);
  }

  /**
   * `AttachNewBubblefield(direction, deathJump)` — grid step, destroyed-chain,
   * restore-or-generate, minimap, positioning (docs 03 §2; BTAGameWorld.as).
   */
  private attachNewBubblefield(direction: JumpDirection, deathJump: boolean): void {
    this.departCol = this.col;
    this.departRow = this.row;
    const delta = DIRECTION_DELTA[direction];
    this.col += delta.col;
    this.row += delta.row;

    // Visited-store consult + destroyed-chain (while stored[0] == "destroyed").
    let visited = this.store.has(this.col, this.row);
    let record = this.store.get(this.col, this.row);
    while (visited && record.storedEnemies === DESTROYED) {
      this.col += delta.col;
      this.row += delta.row;
      visited = this.store.has(this.col, this.row);
      if (!visited) break;
      record = this.store.get(this.col, this.row);
    }

    const scale = visited ? record.bScale : 1;
    const field = this.makeField({ scale, col: this.col, row: this.row });

    if (visited) {
      const stored = (record.storedEnemies === DESTROYED ? [] : record.storedEnemies) as StoredEnemy[];
      this.restoreField(field, stored);
    } else {
      this.visitedCount++;
      // Boss trigger: life ≥ 1000 && tank level ≥ 5 && not yet done (docs 03 §3).
      // The original gates the whole boss branch on `param2 == false`
      // (BTAGameWorld.as:1748) — a death jump always takes the deadhead
      // branch even when the boss condition holds.
      const bossReady =
        !this.bossTriggered && this.avatar.intTankLife >= 1000 && this.avatar.intTankLevel >= 5;
      if (deathJump) {
        // Post-death retry field: deadheads only (`_-Wd(-1)`).
        this.spawnWave(field, generateWave(-1, this.units));
      } else if (bossReady) {
        this.bossTriggered = true;
        field.isBossField = true;
        this.spawnWave(field, generateBossWave(BOSSES));
      } else {
        // distance = unrounded sqrt(col²+row²) (BTAGameWorld.as:1746).
        const distance = Math.sqrt(this.col * this.col + this.row * this.row);
        this.spawnWave(field, generateWave(distance, this.units));
      }
      this.attachTutorialCaption(field);
    }

    // Minimap bookkeeping (docs 03 §2: 25px per cell).
    this.hud.markVisited(this.col, this.row);
    this.hud.markCurrent(this.col, this.row);
    this.hud.addMapArrow(this.col, this.row, ARROW_ROTATION[direction]);
    this.hud.currentCol = this.col;
    this.hud.currentRow = this.row;

    this.nextField = field;
    this.nextDirection = direction;
    this.repositionNextField();
  }

  /** `_-Ar` — spawn the wave's enemies (random center positions × field scale). */
  private spawnWave(field: BubbleField, wave: { ENEMIES: Array<{ ID: string; AMT: number; DATA: string }> }): void {
    for (const entry of wave.ENEMIES) {
      for (let n = 0; n < entry.AMT; n++) {
        const data = new TankData();
        if (!data.importTankCode(entry.DATA)) continue;
        const enemy = new EnemyAI(data, TANK_TYPE.ENEMY, field);
        enemy.x = randInt(-200, 200) * field.scale;
        enemy.y = randInt(-200, 200) * field.scale;
        enemy.rotation = randInt(-180, 180);
        field.addEnemy(enemy);
      }
    }
  }

  /** `_-G0` — restore a revisited field's enemies exactly. */
  private restoreField(field: BubbleField, stored: StoredEnemy[]): void {
    for (const snap of stored) {
      const data = new TankData();
      if (!data.importTankCode(snap.DATA)) continue;
      const enemy = new EnemyAI(data, TANK_TYPE.ENEMY, field);
      enemy.x = snap.x;
      enemy.y = snap.y;
      enemy.rotation = snap.rot;
      field.addEnemy(enemy);
    }
  }

  /** Departure snapshot for the visited store (`_-4j` store write). */
  private snapshotAndStore(field: BubbleField, col: number, row: number): void {
    const stored: StoredEnemy[] | typeof DESTROYED = field.destroyed
      ? DESTROYED
      : field.enemies.map((enemy) => ({
          DATA: enemy.data.strTankCode,
          x: enemy.x,
          y: enemy.y,
          rot: enemy.rotation,
        }));
    this.store.upsert({ xVal: col, yVal: row, storedEnemies: stored, bScale: field.scale });
  }

  /**
   * `MoveAvatarToNewBubblefieldLocation` — per-frame transit step
   * (effective speed = 0.09 × remaining distance; arrival < 5px).
   */
  private moveAvatarToNewBubblefieldLocation(): void {
    const next = this.nextField;
    if (!next || !this.nextDirection) return;

    // Target: the mirrored entry marker in the next field's local space
    // (exiting right → entering the next field at its left rim, etc.).
    const r = next.fieldRadius;
    const target =
      this.nextDirection === "right"
        ? { x: -r, y: 0 }
        : this.nextDirection === "left"
          ? { x: r, y: 0 }
          : this.nextDirection === "down"
            ? { x: 0, y: -r }
            : { x: 0, y: r };

    // The avatar's local position within the next field, derived from the
    // stage-anchored invariant (see class doc): local = stageCenter − view.
    const local = {
      x: STAGE_CENTER_X - next.view.x,
      y: STAGE_CENTER_Y - next.view.y,
    };
    const dx = target.x - local.x;
    const dy = target.y - local.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist * dist < TRANSIT_ARRIVE_DIST_SQ) {
      this.completeJump(target);
      return;
    }
    const step = dist * 0.09;
    const ux = dx / dist;
    const uy = dy / dist;
    // Both fields slide by −step (the world moves under the fixed avatar).
    this.currentField.view.x -= ux * step;
    this.currentField.view.y -= uy * step;
    this.repositionNextField();
  }

  /**
   * Next-field positioning: center distance = (curWidth + nextWidth)/2 ∓ 4 —
   * the rims overlap by exactly 4px regardless of size difference
   * (BTAGameWorld.as:1817-1832, `_-RJ = int((cur.width − next.width)/2)`).
   */
  private repositionNextField(): void {
    const next = this.nextField;
    if (!next) return;
    const curW = this.currentField.fieldRadius * 2;
    const nextW = next.fieldRadius * 2;
    const gap = Math.trunc((curW - nextW) / 2);
    switch (this.nextDirection) {
      case "up":
        next.view.x = this.currentField.view.x;
        next.view.y = this.currentField.view.y - nextW - gap + 4;
        break;
      case "down":
        next.view.x = this.currentField.view.x;
        next.view.y = this.currentField.view.y + nextW + gap - 4;
        break;
      case "right":
        next.view.x = this.currentField.view.x + nextW + gap - 4;
        next.view.y = this.currentField.view.y;
        break;
      case "left":
        next.view.x = this.currentField.view.x - nextW - gap + 4;
        next.view.y = this.currentField.view.y;
        break;
    }
  }

  /** Arrival (`_-4j` + `SnapBackAllObject`): store, swap, snap. */
  private completeJump(targetLocal: { x: number; y: number }): void {
    const oldField = this.currentField;
    this.snapshotAndStore(oldField, this.departCol, this.departRow);
    oldField.clear();
    oldField.view.removeFromParent();

    const next = this.nextField;
    if (!next) return;
    this.currentField = next;
    // The avatar's field-local position becomes the entry-marker position.
    this.avatar.x = targetLocal.x;
    this.avatar.y = targetLocal.y;
    this.positionCurrentField();

    this.nextField = null;
    this.nextDirection = null;
    this.jumping = false;
    this.currentField.setJumping(false);
    this.hud.blnStopShoot = false;
    // Primary weapon counters reset to 0 on arrival (docs 03 §2).
    for (const w of this.avatar.primaryWeapons) w.intCounter = 0;
  }

  /**
   * Tutorial captions (texts 1659/1662/1664; docs 03 §2). The original reads
   * the visited counter BEFORE incrementing it, so with the port's
   * post-increment value: 2 → tut_2, 3 → tut_3, 4 → tut_4 (unknown art →
   * skipped). The "ag" sponsor frame is stripped (stubs ledger).
   */
  private attachTutorialCaption(field: BubbleField): void {
    const captions: Record<number, string> = {
      2: "You have jumped to\na new bubblefield!",
      3: "Collecting bubbles\nwill replenish lost life.",
    };
    const text = captions[this.visitedCount];
    if (!text) return;
    const node = new DisplayNode((ctx) => {
      ctx.fillStyle = "rgba(235,248,255,0.92)";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      text.split("\n").forEach((line, i) => ctx.fillText(line, 0, -120 + i * 17));
      ctx.textAlign = "left";
    }, "tutorialCaption");
    field.view.addChild(node);
  }
}
