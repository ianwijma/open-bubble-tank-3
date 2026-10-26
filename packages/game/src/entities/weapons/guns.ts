/**
 * Per-part weapon implementations — M1 covers the plain-shell gun families
 * (avatar 2xxx primaries that spawn `_-U7` rounds, enemy 4xxx guns that spawn
 * `_-GV` rounds, plus the 4002 homing seekers and the 6001 Aggressor
 * behavior). Every spawn call's numbers are transcribed verbatim from
 * docs 06 §3.1 / 07 §5.
 *
 * Remaining parts (secondaries, interfaces/passives, special enemy guns) are
 * stubbed — see packages/game/src/stubs/README.md for the ledger.
 */

import { FIELD_RADIUS } from "../../core/constants";
import { randInt } from "../../core/math";
import type { TankDetail } from "../../tanks/TankData";
import { Bullet, EnemySeekerBullet, EnemyShellBullet, ShellBullet, drawShellBullet } from "../bullets/Bullet";
import type { FieldContext, TankLike } from "../field-context";
import type { Tank } from "../Tank";
import { createSpecialBehavior, createSpecialWeapon } from "./arsenal";
import { Weapon } from "./Weapon";

// --- Spec tables -------------------------------------------------------------

interface ShotSpec {
  /** Offset angle from the gun's facing, degrees. */
  angle: number;
  scale: number;
  speed: number;
  dmg: number;
}

interface GunSpec {
  fireRate: number;
  shots: ShotSpec[];
  /** Lock to the hull (omni-directional parts). */
  blnRotate?: boolean;
  seeker?: boolean;
}

/** Avatar primaries 2xxx (docs 06 §3.1). Codes win over DB text discrepancies. */
const AVATAR_PRIMARIES: Record<number, GunSpec> = {
  2001: { fireRate: 13, shots: [{ angle: 0, scale: 1, speed: 10, dmg: 1 }] }, // Basic Cannon
  2002: { fireRate: 25, shots: [{ angle: 0, scale: 2.5, speed: 8, dmg: 3 }] }, // Heavy Cannon
  2003: { fireRate: 6, shots: [{ angle: 0, scale: 1, speed: 10, dmg: 1 }] }, // Machine Gun
  2004: { fireRate: 4, shots: [{ angle: 0, scale: 1, speed: 10, dmg: 1 }] }, // Super Machine Gun
  2005: { fireRate: 10, shots: [{ angle: 0, scale: 1.25, speed: 10, dmg: 2 }, { angle: 0, scale: 1.25, speed: 10, dmg: 2 }] }, // Dual Large MG
  2006: { fireRate: 11, shots: [{ angle: 0, scale: 1, speed: 10, dmg: 1 }, { angle: 0, scale: 1, speed: 10, dmg: 1 }] }, // 2 Parallel
  2007: { fireRate: 11, shots: [{ angle: 0, scale: 1, speed: 10, dmg: 1 }, { angle: -30, scale: 1, speed: 10, dmg: 1 }, { angle: 30, scale: 1, speed: 10, dmg: 1 }] }, // 3 Spread
  2008: {
    fireRate: 11,
    shots: [
      { angle: -20, scale: 1, speed: 10, dmg: 1 },
      { angle: -10, scale: 1, speed: 10, dmg: 1 },
      { angle: 0, scale: 1, speed: 10, dmg: 1 },
      { angle: 10, scale: 1, speed: 10, dmg: 1 },
      { angle: 20, scale: 1, speed: 10, dmg: 1 },
    ],
  }, // 5 Spread
  2014: { fireRate: 18, shots: [{ angle: 0, scale: 2.5, speed: 8, dmg: 3 }] }, // Mega Cannon
  2022: {
    fireRate: 12,
    shots: [
      { angle: 0, scale: 1, speed: 10, dmg: 1 },
      { angle: 0, scale: 1, speed: 10, dmg: 1 },
      { angle: 0, scale: 1, speed: 10, dmg: 1 },
    ],
  }, // 3 Parallel
};

/** Enemy primaries 4xxx (docs 07 §5). */
const ENEMY_PRIMARIES: Record<number, GunSpec> = {
  4001: { fireRate: 50, shots: [{ angle: 0, scale: 1, speed: 7, dmg: 1 }] }, // Basic Cannon
  4002: { fireRate: 120, shots: [{ angle: 0, scale: 1, speed: 5, dmg: 2 }], blnRotate: false, seeker: true }, // Seekers
  4004: { fireRate: 60, shots: [{ angle: -30, scale: 1, speed: 8, dmg: 2 }, { angle: 0, scale: 1, speed: 8, dmg: 2 }, { angle: 30, scale: 1, speed: 8, dmg: 2 }] }, // 3 Spread
  4005: { fireRate: 60, shots: [{ angle: 0, scale: 1, speed: 8, dmg: 1 }, { angle: 0, scale: 1, speed: 8, dmg: 1 }, { angle: 0, scale: 1, speed: 8, dmg: 1 }] }, // 3 Parallel
  4006: {
    fireRate: 60,
    shots: [
      { angle: 0, scale: 1, speed: 8, dmg: 1 },
      { angle: 0, scale: 1, speed: 8, dmg: 1 },
      { angle: 0, scale: 1, speed: 8, dmg: 1 },
      { angle: 0, scale: 1, speed: 8, dmg: 1 },
      { angle: 0, scale: 1, speed: 8, dmg: 1 },
    ],
  }, // 5 Parallel
  4007: {
    fireRate: 60,
    shots: [
      { angle: -20, scale: 1, speed: 8, dmg: 2 },
      { angle: -10, scale: 1, speed: 8, dmg: 2 },
      { angle: 0, scale: 1, speed: 8, dmg: 2 },
      { angle: 10, scale: 1, speed: 8, dmg: 2 },
      { angle: 20, scale: 1, speed: 8, dmg: 2 },
    ],
  }, // 5 Spread
  4008: {
    fireRate: 100,
    blnRotate: false,
    shots: Array.from({ length: 10 }, (_, i) => ({ angle: -144 + i * 36, scale: 1, speed: 7, dmg: 2 })),
  }, // 360 Spread
  4016: { fireRate: 90, shots: [{ angle: 0, scale: 2.5, speed: 5, dmg: 4 }] }, // Heavy Cannon
};

/** Behaviors 6xxx — M1 implements Aggressor; the rest are stubbed. */
const BEHAVIORS = new Set([6001, 6002, 6003, 6004, 6005]);
const KNOWN_UNIMPLEMENTED = new Set<number>();

// --- Gun implementation ------------------------------------------------------

class PartWeapon extends Weapon {
  private readonly spec: GunSpec | null;

  constructor(intObjID: number, detailIndex: number, spec: GunSpec | null) {
    super(intObjID, detailIndex);
    this.spec = spec;
    if (spec) {
      this.intFireRate = spec.fireRate;
      if (spec.blnRotate === false) {
        this.blnRotate = false;
        this.aimAtMouse = false;
      }
    }
  }

  partCallTrigger(): void {
    const owner = this.owner;
    const field = owner?.field;
    if (!owner || !field || !this.spec || field.jumping) return;
    // Avatar primaries self-gate: ready only when the cooldown has expired
    // (intCounter == -1); net fire period = intFireRate + 1 frames (docs 06 §2.4).
    if (this.intWeaponMaster === 1 && this.intCounter !== -1) return;
    const muzzle = owner.weaponMuzzle(this.detailIndex);
    const hullRotation = owner.rotation;
    for (const shot of this.spec.shots) {
      const angle = this.rotation + hullRotation + shot.angle;
      if (this.spec.seeker) {
        const target = field.avatar; // 4002 targets the avatar always (docs 07 §5)
        field.spawnBulletFromField(new EnemySeekerBullet(muzzle.x, muzzle.y, angle, shot.scale, shot.speed, shot.dmg, target));
      } else if (this.intWeaponMaster === 1) {
        field.spawnBulletFromField(new ShellBullet(muzzle.x, muzzle.y, angle, shot.scale, shot.speed, shot.dmg));
      } else {
        field.spawnBulletFromField(new EnemyShellBullet(muzzle.x, muzzle.y, angle, shot.scale, shot.speed, shot.dmg));
      }
    }
    if (this.intWeaponMaster === 1) this.intCounter = this.intFireRate; // self-gate
  }
}

/**
 * `EBehaviorAggressor` (6001) — chase the target by steering (`swarmPoint`).
 * Other behaviors (Healer 6002, Skittish 6003, Phasing 6004, Wall Flower
 * 6005) are M2+; they register as no-ops.
 */
export class BehaviorPart {
  protected owner: Tank | null = null;
  protected movTarget: TankLike | null = null;
  deactivated = false;

  constructor(readonly intObjID: number, private readonly detailIndex: number) {}

  setup(tank: Tank): void {
    this.owner = tank;
    switch (this.intObjID) {
      case 6003:
        tank.blnSkittish = true;
        break;
      case 6005:
        tank.blnWallFlower = true;
        break;
      default:
        break;
    }
  }

  runBehavior(): void {
    const owner = this.owner;
    if (!owner || this.deactivated) return;
    switch (this.intObjID) {
      case 6001: {
        // Aggressor: swarmPoint = target position (docs 07 §4).
        this.acquireTarget();
        const target = this.movTarget;
        owner.swarmPoint = target && target.alive ? { x: target.x, y: target.y } : null;
        return;
      }
      default:
        return; // stubbed behavior
    }
  }

  onJammed(_isAvatar: boolean): void {}

  private acquireTarget(): void {
    const owner = this.owner;
    if (!owner) return;
    if (owner.isAvatar) {
      const enemies = owner.field?.targets.enemies ?? [];
      this.movTarget = enemies.length > 0 ? (enemies[randInt(0, enemies.length - 1)] ?? null) : null;
    } else {
      this.movTarget = owner.field?.avatar ?? null;
    }
  }

  deactivate(): void {
    this.deactivated = true;
    this.owner = null;
  }
}

/** `Weapon.forPart` implementation — spec-table resolution with the M3
 * arsenal consulted first (bespoke per-part classes). */
export function createWeaponForPart(owner: Tank, detail: TankDetail, index: number): Weapon | null {
  const { type } = detail;
  const special = createSpecialWeapon(type, index);
  if (special) return special;
  const spec = AVATAR_PRIMARIES[type] ?? ENEMY_PRIMARIES[type];
  if (spec) return new PartWeapon(type, index, spec);
  if (BEHAVIORS.has(type)) return null; // behaviors route through BehaviorPart
  warnUnimplemented(type);
  return null;
}

/** Factory used by Tank for behavior categories — the M3 behaviors (6002-6005)
 * come from the arsenal; 6001 Aggressor stays here. */
export function createBehaviorForPart(detail: TankDetail, index: number): BehaviorPart | null {
  const special = createSpecialBehavior(detail.type, index);
  if (special) return special as BehaviorPart;
  if (!BEHAVIORS.has(detail.type)) {
    warnUnimplemented(detail.type);
    return null;
  }
  return new BehaviorPart(detail.type, index);
}

function warnUnimplemented(type: number): void {
  if (KNOWN_UNIMPLEMENTED.has(type)) return;
  KNOWN_UNIMPLEMENTED.add(type);
  // One-time notice; the stubs ledger lists these (M2/M3 scope).
  console.info(`[open-bt3] part ${type}: behavior not yet implemented (stubbed)`);
}

/** Field wall for spawn clamping helpers. */
export function wallRadius(field: FieldContext): number {
  return field.fieldRadius * (415 / FIELD_RADIUS);
}

export { drawShellBullet };
