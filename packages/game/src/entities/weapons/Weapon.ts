/**
 * Weapon base — the port of `Weapon.as` (docs 06 §2).
 *
 * `intWeaponMaster`: 1 = avatar, 2 = ally, 3 = enemy (docs 06 §2.7 correction).
 * Avatars: fire gated per gun (`intCounter == -1`), trigger driven by the HUD
 * while the LMB is held. Allies/enemies: standard timer (`RunStandardPartTimer`,
 * docs 07 §3.4) — fire on frames fireRate·k counting from registration.
 *
 * Part implementations live in guns.ts via per-part spec tables; `forPart` is
 * the registration factory (unknown/unimplemented parts are ignored with a
 * one-time warning — the stubs ledger tracks the gap).
 */

import type { TankDetail } from "../../tanks/TankData";
import type { TankLike } from "../field-context";
import type { Tank } from "../Tank";

export type WeaponMaster = 1 | 2 | 3;

export abstract class Weapon {
  readonly intObjID: number;
  intFireRate = -1;
  /** −1 = ready (avatar guns); enemies count up from 0. */
  intCounter = 0;
  /** `blnRotate` — false = locked to the hull (omni parts). */
  blnRotate = true;
  /** Part-clip rotation state (aim output; the view consumes it in M2/M3). */
  rotation = 0;
  /** `_-9S` — gun independently tracks the mouse (set when class > 3). */
  aimAtMouse = false;
  /** `_-MW` — deactivated. */
  deactivated = false;

  protected owner: Tank | null = null;
  protected readonly detailIndex: number;
  protected intWeaponMaster: WeaponMaster = 1;
  protected movTarget: TankLike | null = null;
  protected intCurrentAllies = -1;

  constructor(intObjID: number, detailIndex: number) {
    this.intObjID = intObjID;
    this.detailIndex = detailIndex;
  }

  /** `Weapon.Setup`. */
  setup(tank: Tank): void {
    this.owner = tank;
    // Class 4-6 tanks: guns aim independently (docs 06 §2.2/§2.5).
    if (tank.data.numClass > 3) this.aimAtMouse = true;
    this.separatePartSetup();
  }

  /** `SeperatePartSetup` hook (per-part post-setup). */
  protected separatePartSetup(): void {}

  /** `Weapon.Run` (docs 06 §2.3). */
  run(): void {
    const owner = this.owner;
    if (!owner || this.deactivated || this.intFireRate < 0) return;
    if (this.intWeaponMaster !== 1) this.acquireTarget();
    this.aim();
    if (this.intWeaponMaster === 1) {
      this.avatarShootTimer();
    } else {
      this.runStandardPartTimer();
    }
  }

  /** `AcquireTarget` (docs 07 §3.4). */
  protected acquireTarget(): void {
    const owner = this.owner;
    if (!owner) return;
    if (this.intWeaponMaster === 2) {
      // Ally: random enemy, re-rolled only when lost.
      if (!this.movTarget || !this.movTarget.alive) this.movTarget = pickRandomEnemy(owner);
      return;
    }
    // Master 3 (enemy): the avatar; 50% a random ally when allies exist.
    const avatar = owner.field?.avatar ?? null;
    if (!avatar || !avatar.alive) {
      this.movTarget = null;
      return;
    }
    this.movTarget = avatar;
    if (Math.random() < 0.5) {
      const allies = owner.field?.targets.allies ?? [];
      // NOTE: the original may index one past the end here (docs 07 §9.2);
      // the port clamps to a valid index (deviation documented).
      if (allies.length > 0) this.movTarget = allies[Math.floor(Math.random() * allies.length)] ?? avatar;
    }
    // Re-acquire when the ally count changed (enemies "notice" new allies).
    const allyCount = owner.field?.targets.allies.length ?? 0;
    if (allyCount !== this.intCurrentAllies) {
      this.intCurrentAllies = allyCount;
      this.acquireTarget();
    }
  }

  /** `AvatarAim` / `EnemyAim` (docs 06 §2.5, 07 §3.4). */
  protected aim(): void {
    const owner = this.owner;
    if (!owner) return;
    if (this.intWeaponMaster === 1) {
      if (!this.aimAtMouse) return;
      const aimPoint = owner.field?.avatarAimPoint ?? null;
      if (!aimPoint) return;
      const muzzle = owner.weaponMuzzle(this.detailIndex);
      this.rotation = angleBetweenDeg(muzzle, aimPoint) - owner.rotation;
      return;
    }
    const target = this.movTarget;
    if (!this.blnRotate || !target || !target.alive) return;
    const muzzle = owner.weaponMuzzle(this.detailIndex);
    this.rotation = angleBetweenDeg(muzzle, target) - owner.rotation;
  }

  /** `AvatarShootTimer` — counter runs to −1 (ready); docs 06 §2.3. */
  protected avatarShootTimer(): void {
    if (this.intCounter === -1) return;
    if (this.intCounter >= 0) this.intCounter--;
    else this.intCounter = -1;
  }

  /** `RunStandardPartTimer` — enemies/allies (docs 07 §3.4). */
  protected runStandardPartTimer(): void {
    const owner = this.owner;
    if (!owner) return;
    if (this.intWeaponMaster === 2 && (!this.movTarget || !this.movTarget.alive)) return;
    this.intCounter++;
    if (this.intCounter >= this.intFireRate) {
      this.partCallTrigger();
      this.intCounter = 0;
    }
  }

  /** `onJammed` — avatar guns re-cooldown fully; others restart (docs 07 §3.2). */
  onJammed(isAvatar: boolean): void {
    this.intCounter = isAvatar ? this.intFireRate : 0;
  }

  /** `PartCallTrigger` — the actual shot. */
  abstract partCallTrigger(): void;

  /** `StopFiring` hook (beams etc.). */
  stopFiring(): void {}

  /** `FinalPartCall` — tank death / deactivate. */
  finalPartCall(): void {
    this.stopFiring();
  }

  deactivate(): void {
    this.deactivated = true;
    this.owner = null;
    this.movTarget = null;
  }
}

// --- helpers ----------------------------------------------------------------

function angleBetweenDeg(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function pickRandomEnemy(owner: Tank): TankLike | null {
  const enemies = owner.field?.targets.enemies ?? [];
  if (enemies.length === 0) return null;
  return enemies[Math.floor(Math.random() * enemies.length)] ?? null;
}
