/**
 * Field context interfaces — the seams between entities and the Bubblefield
 * controller (`_-0D`). Entities depend on these interfaces, not the concrete
 * world module, which keeps the combat code headless-testable and lets the
 * renderer/audio stay swappable.
 */

import type { DisplayNode } from "../core/DisplayNode";
import type { TankDetail } from "../tanks/TankData";

/** Sound cues the combat code raises; the SoundPlayer decides what actually plays. */
export type SoundCue =
  | "shoot"      // _-dH (avatar shots, throttled by the field)
  | "hit"        // _-49 (player bullet hits, 4-frame throttle)
  | "avatarHit"  // _-JV (0.9 volume, 7-frame throttle)
  | "collect"    // _-Fe (0.6 volume, 4-frame throttle)
  | "enemyDeath" // _-AH (enemy tank death; the life-bubble drop rides this branch)
  | "allyDeath"  // _-9w (ally death — the source plays the "enemy tank destroyed" sample here, a verbatim quirk)
  | "pop"        // _-6j / poof-style one-shots
  | "teleport"   // teleport FLASH pair
  | "fieldComplete";

/** Effect layers the original used (docs 06 §2.9 AddEffectToQueue). */
export type EffectLayer = "BottomEffectsLayer" | "TopEffectsLayer" | "ScreenEffectsLayer";

export interface EffectRequest {
  node: DisplayNode;
  x: number;
  y: number;
  layer: EffectLayer;
  randomRotation: boolean;
  /** Frames the effect lives; removed (with optional callback) afterwards. */
  frames?: number;
  onEnd?: () => void;
}

/** Owner-side side of a hit: who can be damaged, in test order. */
export interface DamageTargets {
  readonly avatar: TankLike | null;
  readonly allies: TankLike[];
  readonly enemies: TankLike[];
}

/**
 * The subset of tank behavior the bullet/collision code needs. Implemented by
 * entities/Tank.ts; enemies and the avatar are the same shape (docs 03 §4).
 */
export interface TankLike {
  readonly id: number;
  readonly isAvatar: boolean;
  readonly data: {
    numClass: number;
    numLife: number;
    numBubblesReturned: number;
    details: TankDetail[];
  };
  /** Field-local position (field origin = registration center). */
  x: number;
  y: number;
  rotation: number;
  /** Bounding radius from registration (part extents). */
  numRadius: number;
  intTankLife: number;
  /** Tanks (and their part views) vanish when dead. */
  readonly alive: boolean;
  damage(dmg: number, source?: unknown): void;
  addLife(amount: number): void;
  /**
   * Per-part circle hit test at field-local coordinates. `otherRadius` is the
   * testing bullet's radius (circle-circle); omitted = point test.
   */
  hitTestPoint(x: number, y: number, otherRadius?: number): boolean;
  getStuck(frames?: number): void;
  jamMe(frames?: number): void;
  inkMe(frames?: number): void;
  stunMe(frames: number): void;
  weakMe(frames?: number): void;
  infectMe(): void;
}

export interface FieldContext {
  /** Radius of the field background × scale (docs 07 header). */
  readonly fieldRadius: number;
  /** Frame counter of the field's Run loop (parity for periodic effects). */
  readonly frameCount: number;
  /** All tanks currently registered (avatar excluded). */
  readonly targets: DamageTargets;
  /** The player avatar (null during transitions). */
  readonly avatar: TankLike | null;
  /**
   * The avatar's aim point in field-local space (the HUD sets it from the
   * mouse each frame; guns of class 4-6 tanks track it independently).
   */
  readonly avatarAimPoint: { x: number; y: number } | null;

  spawnLifeBubbles(x: number, y: number, amount: number, autoCollect?: boolean): void;
  /**
   * `_ -U4` infector seekers spawned when an infected tank dies
   * (docs 08 §2.3: 2 in random directions; Doomsday Infector spread).
   */
  spawnInfectorSeekers(x: number, y: number, count: number): void;
  spawnBulletFromField(bullet: FieldBullet): void;
  addEffect(request: EffectRequest): void;
  sounds: {
    play(cue: SoundCue): void;
  };
  /** True while a bubblefield jump is mid-flight (spawning is refused). */
  readonly jumping: boolean;
}

/** Field-side contract every bullet implements (`_-BL`). */
export interface FieldBullet {
  readonly view: DisplayNode;
  x: number;
  y: number;
  rotation: number;
  readonly speed: number;
  readonly damage: number;
  readonly isEnemy: boolean;
  /** Radius at scale 1 (art-derived hitbox). */
  readonly bulletRadius: number;
  readonly scale: number;
  /** Homing marker — also the field-completion wipe criterion (docs 08 §2.1). */
  readonly seeker: boolean;
  /** May be destroyed by AoE blasts / opposing seekers. */
  readonly destroyable: boolean;
  run(): boolean;
  deactivate(): void;
}
