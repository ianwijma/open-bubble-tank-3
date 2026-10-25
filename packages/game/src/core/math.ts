/**
 * Degree-based 2D math helpers — the port of `_-KM.as` (Vector class).
 * Flash screen convention: 0° points along +x; angles increase clockwise
 * because y points down. atan2 range is −180…+180 inclusive.
 */

export const DEG = Math.PI / 180;

export function atan2Deg(y: number, x: number): number {
  return Math.atan2(y, x) / DEG;
}

export function cosDeg(deg: number): number {
  return Math.cos(deg * DEG);
}

export function sinDeg(deg: number): number {
  return Math.sin(deg * DEG);
}

/** Wrap an angle to the −180…+180 range. */
export function wrapDeg(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** Signed shortest angle from `from` to `to`, in −180…+180. */
export function angleDelta(from: number, to: number): number {
  return wrapDeg(to - from);
}

/**
 * `_-KM._-Uo(targetAngle, rate, step)` — clamped rotate-toward helper.
 * Returns the signed step (never exceeding `step`) toward `targetAngle`.
 */
export function rotateToward(current: number, target: number, step: number): number {
  const delta = angleDelta(current, target);
  const mag = Math.min(step, Math.abs(delta));
  return Math.sign(delta) * mag;
}

/** `_-Wq(a, b)` — random integer in [a..b] inclusive (original helper). */
export function randInt(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

/** Random float in [min, max). */
export function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export interface Vec {
  x: number;
  y: number;
}

export function distSqrd(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function lengthDeg(len: number, deg: number): Vec {
  return { x: cosDeg(deg) * len, y: sinDeg(deg) * len };
}

/**
 * Point-in-circle test used for the port's collision (see docs 08 §6 port note:
 * the artwork-derived radii are the de facto hitboxes; `hitTestPoint` becomes a
 * per-part circle test).
 */
export function pointInCircle(
  px: number, py: number,
  cx: number, cy: number,
  radius: number,
): boolean {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Area-effect range test `_-E6`: `dist² < (radius × 1.15)²` — binary in/out,
 * no falloff (docs 08 §4.1).
 */
export function areaInRange(
  ax: number, ay: number, bx: number, by: number, radius: number,
): boolean {
  return distSqrd(ax, ay, bx, by) < (radius * 1.15) ** 2;
}
