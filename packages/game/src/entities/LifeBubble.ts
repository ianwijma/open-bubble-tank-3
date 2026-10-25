/**
 * Life bubbles — the port of the shared bubble behavior `_ -Pu` and the
 * denomination skins `_-Bd` (1) / `_-Oh` (5) / `_-5A` (50) (docs 08 §5).
 *
 * Lifecycle: burst out with a random drift (4..22 px/frame decaying ×0.9)
 * until it stops; then magnet phase — within `100 × avatarClass³` px of the
 * avatar (or force-collected after field completion) it homes in at
 * `7 × (1 − dist/magnetRadius)` (forced = 14). Collected inside 10px.
 * Drifting past the wall (415²·scale²) loses the bubble.
 */

import {
  BUBBLE_COLLECT_DIST,
  BUBBLE_DRIFT_MAX,
  BUBBLE_DRIFT_MIN,
  BUBBLE_MAGNET_BASE_RADIUS,
  BUBBLE_MAGNET_FORCED_SPEED,
  BUBBLE_MAGNET_MAX_SPEED,
  BUBBLE_PICKUP_RADIUS_SQ,
  BULLET_WALL_RADIUS_SQ,
  FIELD_RADIUS,
  LIFE_BUBBLE_LARGE,
  LIFE_BUBBLE_MEDIUM,
} from "../core/constants";
import { atan2Deg, cosDeg, randInt, sinDeg } from "../core/math";
import { DisplayNode } from "../core/DisplayNode";
import type { FieldContext } from "./field-context";

export class LifeBubble {
  readonly amount: number;
  x: number;
  y: number;
  rotation: number;
  /** `blnCollect` — fly-to-avatar mode (forced after field completion). */
  blnCollect = false;
  blnCollected = false;
  lost = false;
  readonly view: DisplayNode;

  private driftSpeed = 0;
  private field: FieldContext | null = null;

  constructor(x: number, y: number, amount: number, autoCollect = false) {
    this.x = x;
    this.y = y;
    this.amount = amount;
    this.rotation = randInt(-180, 180);
    this.driftSpeed = randInt(BUBBLE_DRIFT_MIN, BUBBLE_DRIFT_MAX);
    this.blnCollect = autoCollect;
    this.view = new DisplayNode((ctx) => drawLifeBubble(ctx, this.amount), "lifeBubble");
    this.view.x = x;
    this.view.y = y;
  }

  attach(field: FieldContext): void {
    this.field = field;
  }

  /** `_ -Pu.Run` — drift → magnet → collect (docs 08 §5.2). */
  run(): void {
    const field = this.field;
    if (!field) return;
    const avatar = field.avatar;
    if (this.driftSpeed >= 0.5) {
      this.driftSpeed *= 0.9;
      this.x += cosDeg(this.rotation) * this.driftSpeed;
      this.y += sinDeg(this.rotation) * this.driftSpeed;
    } else if (avatar && avatar.alive) {
      const dist = Math.sqrt((avatar.x - this.x) ** 2 + (avatar.y - this.y) ** 2);
      if (this.blnCollect || dist * dist < BUBBLE_PICKUP_RADIUS_SQ) {
        const classCubed = avatar.data.numClass ** 3;
        const magnetRadius = BUBBLE_MAGNET_BASE_RADIUS * classCubed;
        const speed = this.blnCollect
          ? BUBBLE_MAGNET_FORCED_SPEED
          : BUBBLE_MAGNET_MAX_SPEED * (1 - dist / magnetRadius);
        const angle = atan2Deg(avatar.y - this.y, avatar.x - this.x);
        this.x += cosDeg(angle) * speed;
        this.y += sinDeg(angle) * speed;
        if (dist < BUBBLE_COLLECT_DIST) this.blnCollected = true;
      }
    }
    // Wall expiry — lost forever (docs 08 §5.2).
    const wallSq = (BULLET_WALL_RADIUS_SQ * field.fieldRadius ** 2) / FIELD_RADIUS ** 2;
    if (this.x * this.x + this.y * this.y > wallSq) this.lost = true;
    this.view.x = this.x;
    this.view.y = this.y;
  }
}

function drawLifeBubble(ctx: CanvasRenderingContext2D, amount: number): void {
  const r = amount >= LIFE_BUBBLE_LARGE ? 14 : amount >= LIFE_BUBBLE_MEDIUM ? 9 : 5.5;
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  grad.addColorStop(0, "rgba(235,255,225,0.95)");
  grad.addColorStop(0.5, "rgba(120,240,120,0.85)");
  grad.addColorStop(1, "rgba(20,140,40,0.6)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(10,80,20,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
