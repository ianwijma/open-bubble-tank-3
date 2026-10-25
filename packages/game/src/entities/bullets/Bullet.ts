/**
 * Bullet base class — the port of `_-BL` (docs 08 §2).
 *
 * Original collision is Flash pixel-perfect `hitTestPoint` at the bullet's
 * position and a half-step back (`pos − move/2`, anti-tunneling). The port
 * note in docs 08 §6 replaces those with circle approximations per part plus
 * the documented numeric radii — implemented here as circle-vs-part tests at
 * both sample points.
 *
 * Movement is constant per frame, no drag. Bullets die at the bubble wall
 * (x²+y² > 415²·scale²), on tank hit, or via the field's remove queue.
 */

import { DisplayNode } from "../../core/DisplayNode";
import { BULLET_WALL_RADIUS_SQ, FIELD_RADIUS } from "../../core/constants";
import { atan2Deg } from "../../core/math";
import type { EffectRequest, FieldBullet, FieldContext, TankLike } from "../field-context";

export interface BulletOptions {
  scale?: number;
  isEnemy?: boolean;
  damage?: number;
  target?: TankLike | null;
  homeTank?: TankLike | null;
  specialData?: Record<string, number> | null;
  seeker?: boolean;
  destroyable?: boolean;
  rotateTowardTarget?: boolean;
  /** Radius of the bullet art at scale 1 (hitbox; parts use their detail radii). */
  bulletRadius?: number;
}

export abstract class Bullet implements FieldBullet {
  readonly view: DisplayNode;

  x: number;
  y: number;
  rotation = 0;
  readonly scale: number;
  readonly isEnemy: boolean;
  readonly bulletRadius: number;

  speed: number;
  damage: number;
  moveX = 0;
  moveY = 0;
  /** 1 = normal, 2 = ghost (moves, collides with nothing — docs 08 §2.1). */
  state = 1;
  /** `_-PJ` / blnMoveTank — set true by the field after Setup. */
  active = false;
  /** `blnReadyForDeleteQueue` — force-remove flag checked by the field loop. */
  readyForDelete = false;
  /** Mines/seeker-mines register as mine-like for the completion wipe (M2+). */
  isMineLike(): boolean {
    return false;
  }
  /** `_-MB` — "has hit something" (suppresses the miss statistic). */
  hasHit = false;
  /** `_-7g` pierce hit-list: tanks already damaged by this bullet. */
  protected readonly hitList: TankLike[] = [];

  protected readonly target: TankLike | null;
  protected readonly homeTank: TankLike | null;
  protected readonly specialData: Record<string, number>;
  protected field: FieldContext | null = null;

  readonly seeker: boolean;
  readonly destroyable: boolean;
  protected readonly rotateTowardTarget: boolean;

  constructor(x: number, y: number, rotation: number, speed: number, damage: number, options: BulletOptions = {}) {
    this.x = x;
    this.y = y;
    this.rotation = rotation;
    this.speed = speed;
    this.damage = options.damage ?? 1;
    this.scale = options.scale ?? 1;
    this.isEnemy = options.isEnemy ?? true;
    this.target = options.target ?? null;
    this.homeTank = options.homeTank ?? null;
    this.specialData = options.specialData ?? {};
    this.seeker = options.seeker ?? false;
    this.destroyable = options.destroyable ?? false;
    this.rotateTowardTarget = options.rotateTowardTarget ?? false;
    this.bulletRadius = options.bulletRadius ?? 8;
    this.view = new DisplayNode((ctx) => this.drawBullet(ctx), "bullet");
    this.view.x = x;
    this.view.y = y;
    this.view.scaleX = this.scale;
    this.view.scaleY = this.scale;
    this.view.rotation = rotation;
  }

  /** `Setup` tail — bind to the field and initialize velocity. */
  setup(field: FieldContext): void {
    this.field = field;
    if (this.rotateTowardTarget && this.target) {
      this.rotation = angleToTarget(this, this.target);
    }
    this.setMovement(this.rotation);
  }

  /** `SetMovement` — per-frame velocity from a degree angle. */
  setMovement(angleDeg: number): void {
    this.moveX = Math.cos(angleDeg * (Math.PI / 180)) * this.speed;
    this.moveY = Math.sin(angleDeg * (Math.PI / 180)) * this.speed;
  }

  /** Rotate exactly onto the target each frame (base homing; docs 08 §2.2). */
  protected rotateToward(): number {
    const target = this.target;
    if (!target || !target.alive || !this.field) return this.rotation;
    this.rotation = angleToTarget(this, target);
    return this.rotation;
  }

  /** `IsOutsideOfBubble` — wall at 415 × field scale. */
  isOutsideOfBubble(): boolean {
    if (!this.field) return false;
    const wallSq = (BULLET_WALL_RADIUS_SQ * this.field.fieldRadius ** 2) / FIELD_RADIUS ** 2;
    return this.x * this.x + this.y * this.y > wallSq;
  }

  /** `Run` — returns true = remove me (docs 08 §2.2). */
  run(): boolean {
    if (!this.field) return false;
    switch (this.state) {
      case 1:
        return this.moveBullet();
      case 2: // ghost
        this.x += this.moveX;
        this.y += this.moveY;
        this.syncView();
        return this.isOutsideOfBubble();
      default:
        return true;
    }
  }

  /** `MoveBullet` (docs 08 §2.2). */
  protected moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (this.isOutsideOfBubble()) {
      this.onWallExpire();
      return true;
    }
    if (this.rotateTowardTarget) this.setMovement(this.rotateToward());
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }

  protected onWallExpire(): void {
    this.active = false;
    this.spawnPuff(this.x, this.y);
  }

  /**
   * `TestForCollision` — circle-based port of the two-branch pixel test
   * (docs 08 §2.3). Sample points: bullet center and half-step back.
   */
  protected testForCollision(): boolean {
    const field = this.field;
    if (!field) return false;
    const targets = field.targets;
    const sx = this.x - this.moveX / 2;
    const sy = this.y - this.moveY / 2;

    if (this.isEnemy) {
      const avatar = field.avatar;
      if (avatar && avatar.alive) {
        if (this.hitsTank(avatar, sx, sy)) {
          this.onHitTank(avatar);
          avatar.damage(this.damage, this);
          return true;
        }
      }
      for (const ally of targets.allies) {
        if (ally.alive && this.hitsTank(ally, sx, sy)) {
          this.onHitTank(ally);
          ally.damage(this.damage, this);
          return true;
        }
      }
      return false;
    }

    for (const enemy of targets.enemies) {
      if (!enemy.alive) continue;
      if (this.isPierceImmune(enemy)) continue;
      if (this.hitsTank(enemy, sx, sy)) {
        this.onHitTank(enemy);
        enemy.damage(this.damage, this);
        this.hasHit = true;
        return true;
      }
    }
    return false;
  }

  /** `_-SS` — pierce hit-list membership. */
  protected isPierceImmune(tank: TankLike): boolean {
    return this.hitList.includes(tank);
  }

  /** Add a tank to the pierce hit-list (pierce-family bullets call this). */
  protected markHit(tank: TankLike): void {
    if (!this.hitList.includes(tank)) this.hitList.push(tank);
  }

  /** Two-point circle test: current position and half-step-back position. */
  private hitsTank(tank: TankLike, sx: number, sy: number): boolean {
    const myR = this.bulletRadius * this.scale;
    return (
      tank.hitTestPoint(this.x, this.y, myR) ||
      tank.hitTestPoint(sx, sy, myR)
    );
  }

  /** `BulletCallCollisionDetected` — puff + throttled hit sound. */
  protected onHitTank(_tank: TankLike): void {
    this.spawnPuff(this.x, this.y);
    if (!this.isEnemy) {
      this.field?.sounds.play("hit");
    }
  }

  protected spawnPuff(x: number, y: number): void {
    const field = this.field;
    if (!field) return;
    const puff = new DisplayNode((ctx) => drawPuff(ctx, this.bulletRadius * this.scale));
    puff.x = x;
    puff.y = y;
    const request: EffectRequest = { node: puff, x, y, layer: "TopEffectsLayer", randomRotation: true, frames: 12 };
    field.addEffect(request);
  }

  /** Subclass art hook (default: plain bubble shell). */
  protected drawBullet(ctx: CanvasRenderingContext2D): void {
    drawShellBullet(ctx, this.bulletRadius, this.isEnemy);
  }

  syncView(): void {
    this.view.x = this.x;
    this.view.y = this.y;
    this.view.rotation = this.rotation;
  }

  deactivate(): void {
    this.active = false;
    this.field = null;
    this.view.removeFromParent();
  }
}

/** Angle from a bullet to a point (degrees). */
export function angleToTarget(bullet: { x: number; y: number }, target: { x: number; y: number }): number {
  return atan2Deg(target.y - bullet.y, target.x - bullet.x);
}

// --- Shared procedural bullet art (docs' parts are bubbles; procedural until
// the symbol-art pipeline lands) -------------------------------------------

export function drawShellBullet(ctx: CanvasRenderingContext2D, radius: number, enemy: boolean): void {
  const r = Math.max(2.5, radius);
  const grad = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
  if (enemy) {
    grad.addColorStop(0, "#ffd6d6");
    grad.addColorStop(0.55, "#ff7d6b");
    grad.addColorStop(1, "rgba(210,60,40,0.55)");
  } else {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.55, "#9fd8ff");
    grad.addColorStop(1, "rgba(60,120,220,0.55)");
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // rim
  ctx.strokeStyle = enemy ? "rgba(120,20,10,0.5)" : "rgba(30,70,140,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawPuff(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, r * 0.9), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(180,220,255,0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(3, r * 1.3), 0, Math.PI * 2);
  ctx.stroke();
}
