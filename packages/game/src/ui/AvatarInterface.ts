/**
 * AvatarInterface — the HUD/controller hybrid (port of `AvatarInterface`,
 * docs 04 §6). The original's interface owns the movement vector, aims the
 * tank, drives primary/secondary triggering, detects level-up/down
 * (`_-dI`), and draws the life/weapon bars + minimap.
 *
 * Per-frame order mirrors AvatarInterface.as:929-947:
 * teleport flag → ControlAvatarDirection → velocity (_-Km) → MoveAvatar
 * (world scroll) → secondary cooldown → AvatarShootTest → interface motion →
 * level check (_-dI) → minimap/status updates.
 *
 * M1 HUD scope: life bar, primary weapon cooldown bar, minimap dots+arrows.
 * UpgradeMenu hook (`_-3F`), edit slider, target lock, ally rings → stubs.
 */

import {
  ACCEL,
  AVATAR_FRICTION,
  FRICTION_SNAP,
  HUD_SLIDE_FRAMES,
  MAX_VELOCITY,
  SECONDARY_COOLDOWN_DEFAULT,
  STAGE_CENTER_X,
  STAGE_CENTER_Y,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  STICKY_SPEED_MULT,
  TANK_LEVEL_LIFE,
  LEVELUP_SPAWN_DIVISOR,
} from "../core/constants";
import { DisplayNode } from "../core/DisplayNode";
import { atan2Deg, rotateToward } from "../core/math";
import type { InputSnapshot } from "../core/Input";
import { getPartName, getPartPluralName } from "../data/parts";
import type { Tank } from "../entities/Tank";
import { TankData } from "../tanks/TankData";

export type AdjustWorldFn = (vx: number, vy: number) => void;

export class AvatarInterface {
  readonly view: DisplayNode;
  private avatar: Tank | null = null;
  private adjustWorld: AdjustWorldFn = () => {};
  private input: InputSnapshot | null = null;
  /** Callback when the avatar must die-jump (level 0). */
  onAvatarFatal: (() => void) | null = null;

  /** `_-At` — per-axis velocity (the movement vector the world scrolls by). */
  private vx = 0;
  private vy = 0;
  private stickyFrames = 0;

  /** `intTankLevel` (0..6) — authoritative here, as in the original (it must
   * survive avatar replacement, which the per-Tank copy in M1 did not). */
  intTankLevel = 0;
  /** `_-6L` progression slot codes (null until the UpgradeMenu exists). */
  progressionSlots: Array<string | null> = [null, null, null, null, null, null, null];
  /** `maxClass` DataObject — bumped to min(level+1, 6) on level-up (creator gate, M4). */
  maxClass = 1;
  /** Fired when `_-dI` needs the UpgradeMenu (slot missing/invalid). */
  onOpenUpgradeMenu: (() => void) | null = null;
  /** Fired when `_-dI` restores a progression slot: (code, dir ±1). */
  onRestoreAvatar: ((code: string, dir: 1 | -1) => void) | null = null;

  /** `blnStopShoot` — blocks firing during jumps/menus. */
  blnStopShoot = false;

  // --- shared secondary cooldown (`_-dJ`/`_-DR`/`_-34`) ---
  private secondaryMax = SECONDARY_COOLDOWN_DEFAULT;
  private secondaryCounter = 0;
  private secondaryReady = true;

  // --- HUD bar state ---
  private lifeIdleTimer = 0;
  private lastLife = -1;
  private lifeBarY = 0; // current animated offset
  private weaponIdleTimer = 0;

  // --- minimap ---
  private mapDots: Array<{ col: number; row: number; kind: "home" | "visited" | "current" }> = [];
  private mapArrows: Array<{ col: number; row: number; rot: number }> = [];

  constructor() {
    this.view = new DisplayNode(undefined, "avatarInterface");
  }

  /** `Setup` — wire avatar + world scroll callback. */
  setup(avatar: Tank, adjustWorld: AdjustWorldFn): void {
    this.avatar = avatar;
    this.adjustWorld = adjustWorld;
  }

  /** `UpdateAvatarHotkeys` — M5 (fixed WASD for M1). */
  updateAvatarHotkeys(): void {}

  /** Minimap bookkeeping (world calls these on jumps). */
  markVisited(col: number, row: number): void {
    if (col === 0 && row === 0) return; // home bubble is special-cased
    if (!this.mapDots.some((d) => d.col === col && d.row === row)) {
      this.mapDots.push({ col, row, kind: "visited" });
    }
  }
  markCurrent(col: number, row: number): void {
    // Demote the previous current dot, then mark this cell.
    this.mapDots.forEach((d) => {
      if (d.kind === "current") d.kind = "visited";
    });
    const existing = this.mapDots.find((d) => d.col === col && d.row === row);
    if (existing) existing.kind = "current";
    else this.mapDots.push({ col, row, kind: "current" });
  }
  addMapArrow(col: number, row: number, rot: number): void {
    this.mapArrows.push({ col, row, rot });
  }

  /** Sticky surfaces slow the avatar for 80 frames (docs 04 §6.5). */
  avatarSticky(frames = 80): void {
    if (this.avatar?.blnForcefielded) return; // forcefield blocks sticky
    this.stickyFrames = frames;
  }

  /** External knockback (`PushAvatar`). */
  pushAvatar(fx: number, fy: number): void {
    this.vx += fx;
    this.vy += fy;
  }

  /** `Run` — one HUD/control frame. */
  /** `Run` — one HUD/control frame. */
  run(input: InputSnapshot): void {
    this.input = input;
    const avatar = this.avatar;
    if (!avatar) return;
    if (avatar.intState === 3) return;

    avatar.blnOkToTeleport = true;
    this.controlAvatarDirection();
    this.processVelocity();
    this.moveAvatar();
    this.processSecondaryCooldown();
    this.avatarShootTest();
    this.interfaceMotion();
    this.levelCheck();
  }

  /** `ControlAvatarDirection` (docs 04 §6.4). */
  private controlAvatarDirection(): void {
    const avatar = this.avatar;
    if (!avatar) return;
    const aim = avatar.field?.avatarAimPoint ?? null;
    if (!aim) return;
    if (avatar.data.numClass <= 3) {
      // Class 1-3: the whole tank tracks the mouse.
      avatar.rotation = atan2Deg(aim.y - avatar.y, aim.x - avatar.x);
    } else {
      // Class 4-6: rate-limited turn toward the movement direction.
      const moveLen = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (moveLen > 0) {
        const target = atan2Deg(this.vy, this.vx);
        avatar.rotation += rotateToward(avatar.rotation, target, 0.5 * (moveLen / 2));
      }
    }
  }

  /** `_-Km` — velocity model (docs 03 §4b): accel 0.6·speed, max 6·speed, friction 0.09. */
  private processVelocity(): void {
    const avatar = this.avatar;
    const input = this.input;
    if (!avatar || !input) return;
    const speed = avatar.numSpeed;
    const accel = ACCEL * speed;
    const cap = this.stickyFrames > 0 ? MAX_VELOCITY * speed * STICKY_SPEED_MULT : MAX_VELOCITY * speed;

    const drive = (held: boolean, dir: 1 | -1, v: number): number => {
      if (held) {
        v += dir * accel;
        return Math.max(-cap, Math.min(cap, v));
      }
      v -= dir * AVATAR_FRICTION * Math.sign(v);
      return Math.abs(v) < FRICTION_SNAP ? 0 : v;
    };
    this.vx = drive(input.right, 1, this.vx);
    this.vx = drive(input.left, -1, this.vx);
    this.vy = drive(input.down, 1, this.vy);
    this.vy = drive(input.up, -1, this.vy);
  }

  /**
   * `MoveAvatar` — the world scrolls opposite the velocity; the avatar's
   * field-local position integrates the velocity directly (the two views of
   * the same motion), so the avatar stays stage-centered while the field
   * slides by −v.
   */
  private moveAvatar(): void {
    const avatar = this.avatar;
    if (!avatar) return;
    avatar.x += this.vx;
    avatar.y += this.vy;
    this.adjustWorld(this.vx, this.vy);
  }

  /** Secondary shared cooldown (`_-dJ`/`_-DR`/`_-34`, docs 06 §2.4). */
  private processSecondaryCooldown(): void {
    const avatar = this.avatar;
    if (!avatar) return;
    const maxFire = avatar.secondaryWeapons.reduce((m, w) => Math.max(m, w.intFireRate), 0);
    this.secondaryMax = maxFire > 0 ? maxFire : SECONDARY_COOLDOWN_DEFAULT;
    if (avatar.secondaryWeapons.length === 0) return;
    if (this.secondaryCounter > 0) {
      this.secondaryCounter--;
    } else if (this.secondaryCounter === 0) {
      this.secondaryReady = true;
      this.secondaryCounter = -1;
    }
  }

  /** `AvatarShootTest` — primaries fire while LMB held (self-gated), secondaries on SPACE. */
  private avatarShootTest(): void {
    const avatar = this.avatar;
    const input = this.input;
    if (!avatar || !input) return;
    if (this.blnStopShoot) {
      for (const w of avatar.primaryWeapons) w.stopFiring();
      return;
    }
    if (avatar.blnJammed) return;

    // Primaries: the interface calls PartCallTrigger every frame while the
    // mouse is held; each gun self-gates on intCounter === -1 (docs 06 §2.4).
    if (input.mouseDown) {
      for (const w of avatar.primaryWeapons) w.partCallTrigger();
    } else {
      for (const w of avatar.primaryWeapons) w.stopFiring();
    }

    // Secondaries: all fire together on the shared cooldown while SPACE is held.
    if (input.space && this.secondaryReady && avatar.secondaryWeapons.length > 0) {
      for (const w of avatar.secondaryWeapons) w.partCallTrigger();
      this.secondaryReady = false;
      this.secondaryCounter = this.secondaryMax;
    }
  }

  /** `InterfaceMotion` — bar slide behavior (0.8/0.2 lerp, 75-frame idle). */
  private interfaceMotion(): void {
    const avatar = this.avatar;
    if (!avatar) return;
    if (avatar.intTankLife !== this.lastLife) {
      this.lastLife = avatar.intTankLife;
      this.lifeIdleTimer = 0;
    } else if (this.lifeIdleTimer < HUD_SLIDE_FRAMES) {
      this.lifeIdleTimer++;
    }
    const target = this.lifeIdleTimer < HUD_SLIDE_FRAMES ? 0 : 100;
    this.lifeBarY = this.lifeBarY * 0.8 + target * 0.2;
    this.weaponIdleTimer++;
  }

  /** `_-dI` — level-up at full health / downgrade at 0 (docs 04 §6.2). */
  /**
   * `UpdateAvatar` tail (AvatarInterface.as:1044-1112) — slot bookkeeping +
   * the tier life override. `dir` 0 = menu choice (slot overwrite), ±1 =
   * level-up/downgrade restore (fill-if-null). `numLife` is forced to the
   * tier's life budget regardless of the tank code; the new tank starts at
   * `numLife/75 + 1` (level-up/choice sliver) or `numLife − 1` (downgrade,
   * near-full so you don't instantly re-die).
   */
  updateAvatar(avatar: Tank, dir: 1 | -1 | 0): void {
    this.avatar = avatar;
    const level = this.intTankLevel;
    if (dir === 0) {
      this.progressionSlots[level] = avatar.data.strTankCode;
    } else if (this.progressionSlots[level] == null) {
      this.progressionSlots[level] = avatar.data.strTankCode;
    }
    const lifeBudget = TANK_LEVEL_LIFE[Math.min(6, Math.max(0, level))] ?? TANK_LEVEL_LIFE[6]!;
    avatar.data.numLife = lifeBudget;
    avatar.intTankLife = dir >= 0 ? Math.floor(lifeBudget / LEVELUP_SPAWN_DIVISOR) + 1 : lifeBudget - 1;
    avatar.refreshAvatarStats();
  }

  /**
   * `_-dI` (AvatarInterface.as:280-334) — runs every frame:
   *   full life & level < 6 → level up (maxClass bump; import the
   *     progression slot, or open the UpgradeMenu when missing/invalid);
   *   life ≤ 0 & level > 0 → downgrade in place (same rules).
   * Level 0 death is handled by the world's death-jump instead.
   */
  private levelCheck(): void {
    const avatar = this.avatar;
    if (!avatar) return;
    if (avatar.intTankLife === avatar.data.numLife) {
      if (this.intTankLevel < this.progressionSlots.length - 1) {
        this.intTankLevel++;
        this.maxClass = Math.min(this.intTankLevel + 1, 6);
        const slot = this.progressionSlots[this.intTankLevel];
        const data = new TankData();
        if (slot == null || !data.importTankCode(slot)) {
          // `_-AD._-YK()` (cheat-console close) is M5.
          this.onOpenUpgradeMenu?.();
        } else {
          this.onRestoreAvatar?.(slot, 1);
        }
      }
    } else if (avatar.intTankLife <= 0) {
      if (this.intTankLevel > 0) {
        this.intTankLevel--;
        const slot = this.progressionSlots[this.intTankLevel];
        const data = new TankData();
        if (slot == null || !data.importTankCode(slot)) {
          this.onOpenUpgradeMenu?.();
        } else {
          this.onRestoreAvatar?.(slot, -1);
        }
      }
    }
  }

  // ------------------------------------------------------------------ draw

  /** Canvas HUD (called by the renderer between world layers). */
  draw(ctx: CanvasRenderingContext2D): void {
    const avatar = this.avatar;
    if (!avatar) return;

    // --- life bar (bottom-left) ---
    const lx = 14;
    const ly = STAGE_HEIGHT - 46 + this.lifeBarY;
    ctx.save();
    // panel
    ctx.fillStyle = "rgba(10,25,40,0.72)";
    roundRect(ctx, lx, ly, 196, 34, 8);
    ctx.fill();
    // life fill
    const frac = Math.max(0, Math.min(1, avatar.intTankLife / Math.max(1, avatar.data.numLife)));
    ctx.fillStyle = "rgba(90,200,120,0.9)";
    roundRect(ctx, lx + 4, ly + 4, Math.max(2, 148 * frac), 26, 6);
    ctx.fill();
    // texts
    ctx.fillStyle = "#eaf6ff";
    ctx.font = "bold 11px system-ui, sans-serif";
    const left = Math.max(0, avatar.data.numLife - avatar.intTankLife);
    ctx.fillText(`${left} Bubbles left`, lx + 8, ly + 15);
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "rgba(220,240,255,0.85)";
    ctx.fillText(avatar.data.tankName, lx + 8, ly + 27);
    // level pips
    for (let i = 0; i <= 6; i++) {
      ctx.fillStyle = i <= this.intTankLevel ? "rgba(255,220,120,0.95)" : "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.arc(lx + 162, ly + 8 + i * 4, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // --- weapon bar (bottom-right) ---
    const primaries = uniquePrimaries(avatar);
    if (primaries.length > 0) {
      const wx = STAGE_WIDTH - 150;
      const wy = STAGE_HEIGHT - 18 - primaries.length * 20;
      ctx.save();
      ctx.fillStyle = "rgba(10,25,40,0.72)";
      roundRect(ctx, wx, wy, 136, primaries.length * 20 + 8, 8);
      ctx.fill();
      primaries.forEach((p, i) => {
        const y = wy + 6 + i * 20;
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        roundRect(ctx, wx + 6, y, 124, 14, 4);
        ctx.fill();
        const fill = p.fireRate > 0 ? Math.max(0, Math.min(1, (p.fireRate - p.counter) / p.fireRate)) : 1;
        ctx.fillStyle = fill >= 1 ? "rgba(255,200,90,0.95)" : "rgba(255,160,60,0.7)";
        roundRect(ctx, wx + 6, y, Math.max(2, 124 * fill), 14, 4);
        ctx.fill();
        ctx.fillStyle = "#1a2a3a";
        ctx.font = "bold 9px system-ui, sans-serif";
        ctx.fillText(p.label, wx + 10, y + 10.5);
      });
      ctx.restore();
    }

    // --- minimap (top-right, 25px/cell at zoom 1) ---
    this.drawMinimap(ctx);
  }

  private drawMinimap(ctx: CanvasRenderingContext2D): void {
    const size = 25;
    const cx = STAGE_WIDTH - 92;
    const cy = 12;
    ctx.save();
    ctx.fillStyle = "rgba(6,16,28,0.55)";
    roundRect(ctx, cx - 6, cy - 6, 84, 84, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(140,190,240,0.4)";
    ctx.lineWidth = 1;
    roundRect(ctx, cx - 6, cy - 6, 84, 84, 8);
    ctx.stroke();
    // 3×3 cell viewport centered on the current cell (zoom level 1 of 3; M5 zoom).
    const centerCol = this.currentCol;
    const centerRow = this.currentRow;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const col = centerCol + dc;
        const row = centerRow + dr;
        const x = cx + (dc + 1) * size;
        const y = cy + (dr + 1) * size;
        if (col === 0 && row === 0) {
          ctx.fillStyle = "rgba(255,230,140,0.95)";
          ctx.beginPath();
          ctx.arc(x + size / 2, y + size / 2, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        const dot = this.mapDots.find((d) => d.col === col && d.row === row);
        if (dot) {
          ctx.fillStyle =
            dot.kind === "current" ? "rgba(140,255,180,0.95)" : dot.kind === "visited" ? "rgba(150,210,255,0.55)" : "rgba(150,210,255,0.55)";
          ctx.beginPath();
          ctx.arc(x + size / 2, y + size / 2, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        const arrow = this.mapArrows.find((a) => a.col === col && a.row === row);
        if (arrow) {
          ctx.save();
          ctx.translate(x + size / 2, y + size / 2);
          ctx.rotate(arrow.rot * (Math.PI / 180));
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-5, 0);
          ctx.lineTo(5, 0);
          ctx.lineTo(1, -4);
          ctx.moveTo(5, 0);
          ctx.lineTo(1, 4);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    ctx.restore();
    this.drawEnemyOverlays(ctx);
  }

  /**
   * Interface parts 5001/5002 (docs 06 §5.1-5.2): off-screen enemy arrows and
   * floating health bars, drawn in stage space. Bars skip while the world is
   * in mode 3 (`GetWState`), and the width cap replicates the original's
   * `> 120 → 100` bug verbatim.
   */
  private drawEnemyOverlays(ctx: CanvasRenderingContext2D): void {
    const avatar = this.avatar;
    const field = avatar?.field;
    if (!avatar || !field) return;
    const parts = avatar.interfaceParts.map((w) => w.intObjID);
    const hasRadar = parts.includes(5001);
    const hasHealth = parts.includes(5002);
    if (!hasRadar && !hasHealth) return;
    const view = field.view;
    const enemies = field.targets.enemies;

    if (hasRadar) {
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        // outside the 550×450 viewport around the avatar (field-local)
        if (Math.abs(enemy.x - avatar.x) <= 275 && Math.abs(enemy.y - avatar.y) <= 225) continue;
        ctx.save();
        ctx.translate(STAGE_CENTER_X, STAGE_CENTER_Y);
        ctx.rotate((atan2Deg(enemy.y - avatar.y, enemy.x - avatar.x) * Math.PI) / 180);
        ctx.fillStyle = "rgba(255,120,90,0.9)";
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(2, 5);
        ctx.lineTo(2, -5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    if (hasHealth && field.worldMode !== 3) {
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        let width = enemy.data.numClass * 20;
        if (width > 120) width = 100; // original bug, replicated (docs 06 §5.2)
        const sx = view.x + enemy.x;
        const sy = view.y + enemy.y - 10 - enemy.numRadius;
        const frac = enemy.data.numLife > 0 ? Math.max(0, Math.min(1, enemy.intTankLife / enemy.data.numLife)) : 0;
        ctx.save();
        ctx.fillStyle = "rgba(10,20,24,0.7)";
        ctx.fillRect(sx - width / 2, sy, width, 5);
        ctx.fillStyle = frac > 0.5 ? "rgba(120,230,140,0.9)" : "rgba(255,120,90,0.9)";
        ctx.fillRect(sx - width / 2, sy, width * frac, 5);
        ctx.restore();
      }
    }
  }

  currentCol = 0;
  currentRow = 0;
}

interface PrimarySummary {
  label: string;
  fireRate: number;
  counter: number;
}

function uniquePrimaries(avatar: Tank): PrimarySummary[] {
  const seen = new Map<number, PrimarySummary>();
  let countOf: Map<number, number>;
  countOf = new Map();
  for (const w of avatar.primaryWeapons) {
    countOf.set(w.intObjID, (countOf.get(w.intObjID) ?? 0) + 1);
  }
  for (const w of avatar.primaryWeapons) {
    if (seen.has(w.intObjID)) continue;
    const total = countOf.get(w.intObjID) ?? 1;
    const name = total >= 2 ? getPartPluralName(w.intObjID) : trimName(getPartName(w.intObjID));
    seen.set(w.intObjID, { label: name, fireRate: w.intFireRate, counter: w.intCounter });
  }
  return [...seen.values()];
}

/** The HUD's singular-label rule strips the last 2 chars (docs 04 §6.3). */
function trimName(name: string): string {
  return name.length > 2 ? name.slice(0, -2) : name;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
