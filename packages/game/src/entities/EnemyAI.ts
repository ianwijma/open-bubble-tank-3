/**
 * EnemyAI — the enemy/ally movement brain (docs 07 §3.3, `EnemyAI.Move` +
 * the shared `_-Zx` wander primitives `_ -2T` / `_ -Ab` / `_ -dL`).
 *
 * Wander: drift along the current heading; ~2% per frame roll a new turn —
 * toward the center (±30°) when near the rim, otherwise a random ±100°
 * "wobble". Turn amount is applied over `round(|turn| / (speed·1.5))` frames.
 * Edge safety: when idle and the lookahead point would leave the field,
 * arc back inside with a strong ±120..180° turn held for 30 frames
 * (10 for Skittish).
 */

import {
  ENEMY_RIM_FRACTION,
  ENEMY_TURN_CHANCE_PER_FRAME,
  ENEMY_TURN_RATE,
  FIELD_RADIUS,
  TANK_WALL_RADIUS,
} from "../core/constants";
import { angleDelta, atan2Deg, cosDeg, randInt, sinDeg } from "../core/math";
import type { TankData } from "../tanks/TankData";
import type { FieldContext } from "./field-context";
import { Tank, type TankOwnerType } from "./Tank";

export class EnemyAI extends Tank {
  private readonly baseSpeed: number;
  private framesToTurn = 0;
  private amountToTurn = 0;
  private minFramesToHoldTurning = 0;
  private numLastAngle = 0;

  constructor(data: TankData, ownerType: TankOwnerType, field: FieldContext | null = null) {
    super(data, ownerType, field);
    this.baseSpeed = data.numSpeed;
    this.rotation = randInt(-180, 180);
  }

  /** `EnemyAI.Move` (docs 07 §3.3). */
  protected override move(): void {
    // Sticky: 0.3× speed for the sticky window, then restore.
    let speed = this.baseSpeed;
    if (this.stickyTimer > 0) speed *= STICKY_MULT;
    if (this.blnStationary) {
      this.applyForceOnly();
      return;
    }
    if (this.swarmPoint === null) {
      this.wander(speed);
    } else {
      this.seek(this.swarmPoint, speed);
    }
    this.decayForce();
  }

  /** `_ -2T` wander. */
  private wander(speed: number): void {
    this.stepLocomotion(speed);
    if (this.minFramesToHoldTurning > 0) {
      this.minFramesToHoldTurning--;
    } else if (this.framesToTurn === 0 && randInt(0, 1000) < ENEMY_TURN_CHANCE_PER_FRAME) {
      const field = this.field;
      if (field) {
        const distFromCenter = Math.sqrt(this.x * this.x + this.y * this.y);
        let turn: number;
        if (distFromCenter + this.numRadius > ENEMY_RIM_FRACTION * field.fieldRadius) {
          // Near the rim: arc back toward the center ±30°.
          const toCenter = atan2Deg(-this.y, -this.x);
          turn = randInt(-30, 30) + angleDelta(this.rotation, toCenter);
        } else {
          turn = randInt(-100, 100);
        }
        this.beginTurn(turn, speed);
      }
    }
  }

  /** `_ -Ab(point)` — seek a point (Aggressor's `swarmPoint` etc.). */
  private seek(point: { x: number; y: number }, speed: number): void {
    const d2 = point.x * point.x + point.y * point.y;
    // Wall Flowers always seek; others steer only beyond 200px.
    if (this.blnWallFlower || d2 > 40000) {
      const targetAngle = atan2Deg(point.y - this.y, point.x - this.x);
      const turn = angleDelta(this.rotation, targetAngle);
      this.framesToTurn = Math.round(Math.abs(turn) / (speed * ENEMY_TURN_RATE));
      this.amountToTurn = speed * ENEMY_TURN_RATE * Math.sign(turn);
    }
    this.stepLocomotion(speed);
  }

  /** `_ -dL` edge safety — arc back inside when the lookahead leaves the field. */
  private edgeSafety(speed: number): void {
    const field = this.field;
    if (!field || this.blnWallFlower) return;
    if (this.framesToTurn !== 0) return;
    const lookahead = 30 * speed + this.numRadius;
    const lx = this.x + cosDeg(this.rotation) * lookahead;
    const ly = this.y + sinDeg(this.rotation) * lookahead;
    const outside = lx * lx + ly * ly > field.fieldRadius * field.fieldRadius;
    if (!outside) return;
    const angleFromCenter = atan2Deg(this.y, this.x);
    const sign = angleDelta(angleFromCenter, this.numLastAngle) > 0 ? 1 : -1;
    const turn = sign * randInt(120, 180);
    this.beginTurn(turn, speed, this.blnSkittish ? 10 : 30);
    this.minFramesToHoldTurning = this.blnSkittish ? 10 : 30;
  }

  private beginTurn(turn: number, speed: number, hold = 0): void {
    this.framesToTurn = Math.round(Math.abs(turn) / (speed * ENEMY_TURN_RATE));
    this.amountToTurn = speed * ENEMY_TURN_RATE * Math.sign(turn);
    this.minFramesToHoldTurning = hold;
  }

  /** Position/rotation integration shared by wander/seek. */
  private stepLocomotion(speed: number): void {
    if (this.framesToTurn > 0) {
      this.rotation += this.amountToTurn;
      this.framesToTurn--;
    }
    this.x += cosDeg(this.rotation) * speed + this.vecForce.x;
    this.y += sinDeg(this.rotation) * speed + this.vecForce.y;
    this.numLastAngle = atan2Deg(this.y, this.x);
    this.edgeSafety(speed);
  }

  /** `_ -QH` — stationary: knockback only. */
  private applyForceOnly(): void {
    this.x += this.vecForce.x;
    this.y += this.vecForce.y;
  }

  /** `EnemyAI.IsOutside` — enemies die normally (bubbles) outside the wall. */
  protected override checkOutside(): void {
    const field = this.field;
    if (!field) return;
    const wall = (field.fieldRadius / FIELD_RADIUS) * TANK_WALL_RADIUS;
    const dist = Math.sqrt(this.x * this.x + this.y * this.y);
    if (dist + this.numRadius / 2 > wall) {
      this.damage(this.intTankLife);
    }
  }
}

const STICKY_MULT = 0.3;
