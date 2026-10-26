/**
 * M3 arsenal — per-part weapon implementations beyond the M1 uniform spec
 * guns (docs 06 §3-5, 07 §5-6). Every spawn call's numbers are transcribed
 * verbatim from the dossier tables; approximations are flagged inline and
 * mirrored in the stubs ledger.
 *
 * Covers:
 *   - avatar primaries with bespoke shots: 2009-2012, 2015-2018,
 *   - secondaries 3xxx (fire together on the shared Space cooldown),
 *   - interface/passive parts 5xxx (auto-fire weapons),
 *   - the ally auto cannon 7001,
 *   - the special enemy guns 4xxx (spawner, mines, sapper, carrier,
 *     rotating/burst MGs, spin-fire, rockets, neutralizer, ripple, spike,
 *     shield turrets),
 *   - behaviors 6002-6005 (Healer/Skittish/Phasing/Wall Flower).
 *
 * Import discipline: this module must not value-import `Tank`/`EnemyAI` —
 * Tank → guns → arsenal would close a class-extends cycle through EnemyAI.
 * Owner access is type-only; spawning goes through `FieldContext`.
 */

import { FIELD_RADIUS } from "../../core/constants";
import { atan2Deg, distSqrd, randInt, wrapDeg } from "../../core/math";
import { DisplayNode } from "../../core/DisplayNode";
import { UnitTable } from "../../data/waves";
import type { TankDetail } from "../../tanks/TankData";
import type { FieldContext, TankLike } from "../field-context";
import type { Tank } from "../Tank";
import {
  ApocalypseBullet,
  BeamBullet,
  BulletBuster,
  ClusterBomb,
  EnemyInkShot,
  EnemyJamShot,
  EnemyStickyShot,
  EnemyTurret,
  EnemyTurretBuilder,
  FlakPuff,
  FriendlySeeker,
  HealerBeam,
  InfectorSeeker,
  LeechBullet,
  MineBullet,
  OrbitalSeeker,
  PierceBullet,
  RepulsorWave,
  RocketBullet,
  SapperOrb,
  SeekerMine,
  ShellShot,
  SpinFireHub,
  StickyPellet,
  ThrowerGlob,
  WhipBullet,
  MassiveBullet,
  RicochetBullet,
} from "../bullets/specials";
import { Bullet, EnemySeekerBullet, ShellBullet } from "../bullets/Bullet";
import { Weapon } from "./Weapon";

// ------------------------------------------------------------ shared base

/** Arsenal base: null-safe owner/field/muzzle access for the subclasses. */
abstract class ArsenalWeapon extends Weapon {
  protected get tank(): TankLike | null {
    return this.owner;
  }
  protected get f(): FieldContext | null {
    return this.owner?.field ?? null;
  }
  protected muzzle(): { x: number; y: number } {
    return this.owner!.weaponMuzzle(this.detailIndex);
  }
  /** Mounted direction = gun rotation + hull rotation (`_-EL.rotation`). */
  protected mountedAngle(): number {
    return this.rotation + (this.owner?.rotation ?? 0);
  }
  /** Avatar primaries self-gate; enemy/ally guns run on the standard timer. */
  protected get avatarGated(): boolean {
    return this.intWeaponMaster === 1;
  }

  /** Lead-prediction aim shared by 5003 / 7001 (docs 06 §5.3, 07 §5.6):
   * aim at the target's closest detail point plus its predicted position. */
  protected leadAimTo(target: TankLike | null): void {
    const owner = this.owner;
    if (!owner || !target || !target.alive) return;
    const muzzle = this.muzzle();
    const aimPoint = target.getClosestDetailToCenterPoint();
    const frames = Math.round(Math.sqrt(distSqrd(muzzle.x, muzzle.y, aimPoint.x, aimPoint.y)) / 10);
    const predicted = target.predictTargetLocation(frames);
    if (!predicted) return;
    const offX = aimPoint.x - target.x;
    const offY = aimPoint.y - target.y;
    this.rotation = atan2Deg(predicted.y + offY - muzzle.y, predicted.x + offX - muzzle.x) - owner.rotation;
  }
}

// ------------------------------------------------------- avatar primaries

/** Shared body for the spec-shaped M3 primaries: one bespoke shot per fire. */
class SpecialShotWeapon extends ArsenalWeapon {
  private readonly make: (x: number, y: number, angle: number, owner: TankLike) => void;

  constructor(intObjID: number, detailIndex: number, fireRate: number, make: (x: number, y: number, angle: number, owner: TankLike) => void) {
    super(intObjID, detailIndex);
    this.intFireRate = fireRate;
    this.make = make;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    if (this.avatarGated && this.intCounter !== -1) return; // docs 06 §2.4
    const muzzle = this.muzzle();
    this.make(muzzle.x, muzzle.y, this.mountedAngle(), owner);
    if (this.avatarGated) this.intCounter = this.intFireRate;
  }
}

// ---------------------------------------------------------- secondaries 3xxx

/** `_-98` Sticky Burst (3001): 36 sticky pellets at exact 10° steps from the
 * part origin in the mounted direction (docs 06 §4.2). */
class StickyBurstWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 150;
    this.blnRotate = false;
    this.aimAtMouse = false;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const origin = this.muzzle();
    const base = this.mountedAngle();
    for (let i = 0; i < 36; i++) {
      field.spawnBulletFromField(new StickyPellet(origin.x, origin.y, base + i * 10, 0.9, 6, 0));
    }
  }
}

/** `_-31` Stun Burst (3002): AreaStunTest 145 px / 100 frames (docs 06 §3.2). */
class StunBurstWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 150;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const muzzle = this.muzzle();
    field.areaStunTest(muzzle.x, muzzle.y, 145, 100);
  }
}

/** `_-Ko` Area Burst (3003): AreaBurstTest 145 px / 25 dmg (docs 06 §3.2). */
class AreaBurstWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 120;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const muzzle = this.muzzle();
    field.areaBurstTest(muzzle.x, muzzle.y, 145, 25);
  }
}

/** `AGunAreaBurstCannon` (3004): `_-JU` exploding shell, speed 12, dmg 20 —
 * counter reset, no gate (docs 06 §3.2). */
class AreaBurstCannonWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 140;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const muzzle = this.muzzle();
    field.spawnBulletFromField(new ExplodingShell(muzzle.x, muzzle.y, this.mountedAngle(), 1, 12, 20));
  }
}

/** `_-DS` Star Burst (3005): `_-Hu` cluster, scale 1.7, speed 8, dmg 35
 * (docs 06 §3.2). */
class StarBurstWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 90;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const origin = this.muzzle();
    field.spawnBulletFromField(new ClusterBomb(origin.x, origin.y, this.mountedAngle(), 1.7, 8, 35));
  }
}

/** `AGunConversion` (3006): DroneConversionTest at the muzzle (docs 06 §4.6). */
class DroneConverterWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 160;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const muzzle = this.muzzle();
    field.droneConversionTest(muzzle.x, muzzle.y, false);
  }
}

/** Ally-bay shared logic (docs 06 §4.7): capacity = copies of this bay
 * mounted on the avatar (counted lazily — at setup time sibling parts are
 * not yet registered); spawns while live allies with the bay's code < cap. */
abstract class AllyBayWeapon extends ArsenalWeapon {
  protected abstract readonly allyCode: string;

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const capacity = owner.secondaryWeapons.filter((w) => w.intObjID === this.intObjID).length;
    const live = field.targets.allies.filter((a) => (a as TankLike & { data: { strTankCode: string } }).data.strTankCode === this.allyCode).length;
    if (live >= capacity) return;
    const muzzle = this.muzzle();
    field.spawnNewAlly(this.allyCode, muzzle.x, muzzle.y);
  }
}

/** `_-Va` Ally Bay: Swarm (3007). */
class SwarmBayWeapon extends AllyBayWeapon {
  protected readonly allyCode = SWARM_TANK_CODE;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 120;
  }
}

/** `_-AW` Ally Bay: Mine Layer (3016). */
class MineBayWeapon extends AllyBayWeapon {
  protected readonly allyCode = MINE_TANK_CODE;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 240;
  }
}

/** `_-YM` Massive Cannon (3008): charge anim then the `_ -dp` shot with
 * SHAKE(20) + FLASH (docs 06 §4.4). The port defers the spawn 20 frames (the
 * `_ -5z` timeline is art-driven; ledger note). */
class MassiveCannonWeapon extends ArsenalWeapon {
  private charge = -1;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 140;
    this.blnRotate = false;
    this.aimAtMouse = false;
  }

  partCallTrigger(): void {
    const field = this.f;
    if (!field || field.jumping) return;
    if (this.charge >= 0) return; // already charging
    this.charge = 20;
  }

  override run(): void {
    super.run();
    if (this.charge > 0 && --this.charge === 0) {
      const owner = this.tank;
      const field = this.f;
      if (!owner || !field) return;
      const muzzle = this.muzzle();
      field.screen.shake(20);
      field.screen.flash();
      field.spawnBulletFromField(new MassiveShot(muzzle.x, muzzle.y, this.mountedAngle()));
      this.charge = -1;
    }
  }
}

/** `_-V4` Seekers (3009): friendly seeker, speed 6, dmg 10 (docs 06 §3.2). */
class SeekersWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 90;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const muzzle = this.muzzle();
    field.spawnBulletFromField(new FriendlySeeker(muzzle.x, muzzle.y, this.mountedAngle(), 1, 6, 10, null));
  }
}

/** `AGunShield` (3010): a shield bubble blocks all damage until the shimmer
 * ends (docs 06 §4.3). The `_ -YE` timeline is art-driven — the port uses
 * 180 frames (ledger note). Re-firing replaces the shield. */
class ShieldWeapon extends ArsenalWeapon {
  static readonly SHIELD_FRAMES = 180;
  private shieldNode: DisplayNode | null = null;
  private shieldTimer = -1;

  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 60;
  }

  partCallTrigger(): void {
    const owner = this.tank as Tank | null;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    this.killShield();
    owner.blnShieled = true;
    const node = new DisplayNode((ctx) => {
      const r = owner.numRadius * 1.15;
      const grad = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r);
      grad.addColorStop(0, "rgba(160,220,255,0.06)");
      grad.addColorStop(0.85, "rgba(160,220,255,0.32)");
      grad.addColorStop(1, "rgba(200,240,255,0.55)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }, "shieldBubble");
    this.shieldNode = node;
    this.shieldTimer = ShieldWeapon.SHIELD_FRAMES;
    owner.view.addChild(node);
  }

  override run(): void {
    super.run();
    if (this.shieldTimer > 0 && --this.shieldTimer === 0) this.killShield();
  }

  private killShield(): void {
    const owner = this.tank as Tank | null;
    if (this.shieldNode) {
      this.shieldNode.removeFromParent();
      this.shieldNode = null;
    }
    this.shieldTimer = -1;
    if (owner) owner.blnShieled = false;
  }

  override deactivate(): void {
    this.killShield();
  }
}

/** `_-1W`/`_-QQ` Teleport Before/After (3011/3012): identical logic — jump to
 * the mouse clamped inside the field; the world re-anchors around the tank
 * (docs 06 §4.5). One teleport per frame via `blnOkToTeleport`. */
class TeleportWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 100;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    if (!owner.blnOkToTeleport) return;
    owner.blnOkToTeleport = false;
    const aim = field.avatarAimPoint;
    if (!aim) return;
    const r = field.fieldRadius;
    let dx = aim.x;
    let dy = aim.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > r) {
      dx = (dx / d) * r;
      dy = (dy / d) * r;
    }
    const startX = owner.x;
    const startY = owner.y;
    owner.x = dx;
    owner.y = dy;
    field.view.x -= dx - startX;
    field.view.y -= dy - startY;
    field.screen.flash();
  }
}

/** `_-RU` Doomsday Infector (3013): `_ -U4` infector, speed 6, dmg 1. */
class DoomsdayInfectorWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 240;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const muzzle = this.muzzle();
    field.spawnBulletFromField(new InfectorSeeker(muzzle.x, muzzle.y, this.mountedAngle(), 1, 6, 1, null));
  }
}

/** `_-dE` Bubble Whip (3014): `_-Rx` pinned to the emitter, dmg 30,
 * self-gated (docs 06 §3.2). */
class BubbleWhipWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 90;
  }

  partCallTrigger(): void {
    const owner = this.owner;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    if (this.avatarGated && this.intCounter !== -1) return;
    const index = this.detailIndex;
    const muzzle = this.muzzle();
    field.spawnBulletFromField(
      new WhipBullet(muzzle.x, muzzle.y, this.mountedAngle(), 1.25, 0, 30, () => owner.weaponMuzzle(index)),
    );
    if (this.avatarGated) this.intCounter = this.intFireRate;
  }
}

/** `_-VG` Rocket Launcher (3015): 10 rockets over ~1 s (the original uses a
 * real-time 100 ms Timer; the port uses the equivalent 5-frame step at
 * 50 fps — ledger note), emitters cycling 1-5 (docs 06 §4.9). */
class RocketLauncherWeapon extends ArsenalWeapon {
  private rocketsLeft = 0;
  private launchTimer = 0;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 120;
  }

  partCallTrigger(): void {
    const field = this.f;
    if (!field || field.jumping) return;
    if (this.rocketsLeft > 0) return;
    this.rocketsLeft = 10;
    this.launchTimer = 0;
  }

  override run(): void {
    super.run();
    if (this.rocketsLeft <= 0) return;
    if (--this.launchTimer > 0) return;
    this.launchTimer = 5;
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field) return;
    const muzzle = this.muzzle();
    const slot = (10 - this.rocketsLeft) % 5;
    const lateral = (slot - 2) * 6;
    const perp = this.mountedAngle() + 90;
    const angle = this.mountedAngle() + randInt(-10, 10);
    field.spawnBulletFromField(
      new RocketBullet(
        muzzle.x + Math.cos(perp * (Math.PI / 180)) * lateral,
        muzzle.y + Math.sin(perp * (Math.PI / 180)) * lateral,
        angle,
        1,
        10,
        4,
        false,
      ),
    );
    this.rocketsLeft--;
  }

  override finalPartCall(): void {
    this.rocketsLeft = 0; // a dead tank stops its rocket timer (docs 06 §4.9)
  }
}

/** `AGunApocalypseCannon` (3017): `_ -6`, speed 3, dmg 1000, fr 2500
 * (docs 06 §3.2). Fires in the mounted direction. */
class ApocalypseCannonWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 2500;
    this.blnRotate = false;
    this.aimAtMouse = false;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    if (this.avatarGated && this.intCounter !== -1) return;
    const muzzle = this.muzzle();
    field.spawnBulletFromField(new ApocalypseBullet(muzzle.x, muzzle.y, this.mountedAngle(), 1, 3, 1000));
    if (this.avatarGated) this.intCounter = this.intFireRate;
  }
}

// ------------------------------------------------------- interfaces 5xxx

/** Shared auto-weapon skeleton (docs 06 §5.3): timer → aim → fire when the
 * counter is ready. Never mouse-fired. */
abstract class AutoWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number, fireRate: number) {
    super(intObjID, detailIndex);
    this.intFireRate = fireRate;
    this.intCounter = -1; // fires immediately on the first frame
  }

  override run(): void {
    if (!this.owner || this.deactivated) return;
    this.avatarShootTimer();
    this.aimAutoWeapon();
    if (this.intCounter === -1) this.fireAutoWeapon();
  }

  protected abstract aimAutoWeapon(): void;
  protected abstract fireAutoWeapon(): void;

  partCallTrigger(): void {}
}

// ---- small local bullet skins ---------------------------------------------

/** `_-dp` massive shot (speed 7, damage 100 — docs 06 §4.4). */
class MassiveShot extends MassiveBullet {
  constructor(x: number, y: number, rotation: number) {
    super(x, y, rotation, 1, 7, 100);
  }
}

/** `_-GV` enemy shell alias used by the rotating/burst MGs. */
class EnemyShell extends ShellShot {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, scale, speed, damage, true);
  }
}

/** `AGunAutoCannon` (5003): nearest enemy, lead-predicted, `_-U7` s10 d1
 * (docs 06 §5.3). */
class AutoCannonWeapon extends AutoWeapon {
  private target: TankLike | null = null;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex, 12);
  }

  protected aimAutoWeapon(): void {
    this.retarget();
    this.leadAimTo(this.target);
  }

  protected fireAutoWeapon(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || !this.target) return;
    const muzzle = this.muzzle();
    field.spawnBulletFromField(new ShellBullet(muzzle.x, muzzle.y, this.rotation + owner.rotation, 1, 10, 1));
    this.retarget();
    this.intCounter = this.intFireRate;
  }

  private retarget(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field) return;
    let best: TankLike | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    const from = this.muzzle();
    for (const enemy of field.targets.enemies) {
      if (!enemy.alive) continue;
      const d = distSqrd(enemy.x, enemy.y, from.x, from.y);
      if (d < bestD) {
        bestD = d;
        best = enemy;
      }
    }
    this.target = best;
  }
}

/** `_-9A` Seeker Flak (5004): auto-shoots enemy seeker bullets within 100 px
 * with `_ -cW` speed 4, dmg 0 (docs 06 §5.4). */
class SeekerFlakWeapon extends AutoWeapon {
  private targetBullet: { x: number; y: number } | null = null;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex, 12);
  }

  protected aimAutoWeapon(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field) return;
    const from = this.muzzle();
    let best: { x: number; y: number } | null = null;
    let bestD = 10000; // squared 100 px
    for (const b of field.bullets) {
      if (!b.isEnemy || !b.seeker || b.readyForDelete) continue;
      const d = distSqrd(b.x, b.y, from.x, from.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    this.targetBullet = best;
    if (best) this.rotation = atan2Deg(best.y - from.y, best.x - from.x) - owner.rotation;
  }

  protected fireAutoWeapon(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || !this.targetBullet) return;
    const muzzle = this.muzzle();
    field.spawnBulletFromField(new FlakPuff(muzzle.x, muzzle.y, this.rotation + owner.rotation, 1, 4, 0));
    this.intCounter = this.intFireRate;
  }
}

/** `AInterfaceRadar` (5001) / `_-Yb` Health Readout (5002): passive markers —
 * the actual arrows/bars draw in the HUD, gated on these being mounted
 * (docs 06 §5.1-5.2). */
class InterfaceMarkerWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = -1;
  }

  partCallTrigger(): void {}
}

/** `APassiveForcefield` (5005): never fires; raises the tank's forcefield on
 * mount (the absorb/rebuild cycle lives in `Tank`, docs 06 §5.5). */
class ForcefieldWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = -1; // never fires
  }

  protected override separatePartSetup(): void {
    const owner = this.tank as Tank | null;
    if (owner) owner.blnForcefielded = true;
  }

  partCallTrigger(): void {}
}

/** `_-9U` Orbital Seekers (5006): keeps 6 orbiting seekers alive, respawning
 * one per 21-frame cooldown at a random ring angle (docs 06 §4.10). */
class OrbitalSeekersWeapon extends AutoWeapon {
  private readonly slots: Array<OrbitalSeeker | null> = [null, null, null, null, null, null];
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex, 20);
  }

  protected aimAutoWeapon(): void {}

  protected fireAutoWeapon(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field) return;
    // a slot frees when its seeker was removed (deactivated / readyForDelete)
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && (s.readyForDelete || s.getField() === null)) this.slots[i] = null;
    }
    const index = this.slots.findIndex((s) => s === null);
    if (index === -1) return;
    const angle = randInt(0, 360);
    const ring = owner.numRadius + 10;
    const seeker = new OrbitalSeeker(
      owner.x + Math.cos(angle * (Math.PI / 180)) * ring,
      owner.y + Math.sin(angle * (Math.PI / 180)) * ring,
      angle + 90,
      1,
      3,
      7,
      owner,
      ring,
    );
    this.slots[index] = seeker;
    field.spawnBulletFromField(seeker);
    this.intCounter = this.intFireRate;
  }

  override deactivate(): void {
    this.slots.length = 0; // Deactivate clears all six refs (docs 06 §4.10)
  }
}

// ------------------------------------------------------------------ ally gun

/** `AllyGunAutoCannon` (7001): master-2 lead-predicted gun, exactly a
 * 12-frame period via the standard timer (docs 06 §5.6). */
class AllyAutoCannonWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 12;
    this.intWeaponMaster = 2;
  }

  protected override aim(): void {
    this.leadAimTo(this.movTarget);
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const muzzle = this.muzzle();
    field.spawnBulletFromField(new ShellBullet(muzzle.x, muzzle.y, this.rotation + owner.rotation, 1, 10, 1));
  }
}

// ------------------------------------------------------------- enemy guns 4xxx

/** `_-1k` Enemy Spawner (4003): spawns a real EnemyAI tank from the wave
 * table's SmallFighter bucket, chosen once at setup (docs 07 §6.4). */
class EnemySpawnerWeapon extends ArsenalWeapon {
  private tankCode = "";
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 200;
    this.blnRotate = false;
    this.aimAtMouse = false;
  }

  protected override separatePartSetup(): void {
    const units = new UnitTable();
    this.tankCode = units.searchRandom("SmallFighter")?.DATA ?? "";
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping || !this.tankCode) return;
    const muzzle = this.muzzle();
    field.spawnNewEnemy(this.tankCode, muzzle.x, muzzle.y);
  }
}

/** `_-J2` Mine Dropper (4009) / `_-LM` Seeker Mine Dropper (4021): 8-mine
 * cap with oldest-force-despawn (docs 07 §5, §6.3). */
class MineDropperWeapon extends ArsenalWeapon {
  private readonly mines: Array<MineBullet | SeekerMine> = [];
  private readonly seeker: boolean;
  constructor(intObjID: number, detailIndex: number, seeker: boolean) {
    super(intObjID, detailIndex);
    this.intFireRate = 40;
    this.blnRotate = false;
    this.aimAtMouse = false;
    this.seeker = seeker;
  }

  protected override separatePartSetup(): void {
    const owner = this.tank as Tank | null;
    if (owner) owner.blnMineLayer = true;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    // cap 8: force-despawn the oldest (docs 07 §5)
    while (this.mines.length >= 8) {
      const oldest = this.mines.shift();
      if (oldest && !oldest.readyForDelete) {
        oldest.readyForDelete = true;
        field.sounds.play("pop");
      }
    }
    const muzzle = this.muzzle();
    const mine = this.seeker
      ? new SeekerMine(muzzle.x, muzzle.y, this.mountedAngle(), 1, 4, 7, 0)
      : new MineBullet(muzzle.x, muzzle.y, this.mountedAngle(), 1, 0, 10, owner.tankType === 3);
    this.mines.push(mine);
    field.spawnBulletFromField(mine);
  }
}

/** `_-Vc` Orbital Seeker (4010): enemy 6-slot halo, `_-H4` d1 s3 (docs 07 §5). */
class EnemyOrbitalSeekerWeapon extends AutoWeapon {
  private readonly slots: Array<OrbitalSeeker | null> = [null, null, null, null, null, null];
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex, 20);
  }

  protected aimAutoWeapon(): void {}

  protected fireAutoWeapon(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field) return;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && (s.readyForDelete || s.getField() === null)) this.slots[i] = null;
    }
    const index = this.slots.findIndex((s) => s === null);
    if (index === -1) return;
    const angle = randInt(0, 360);
    const ring = owner.numRadius / 2 + 10; // parent.width/2 + 10
    const seeker = new OrbitalSeeker(
      owner.x + Math.cos(angle * (Math.PI / 180)) * ring,
      owner.y + Math.sin(angle * (Math.PI / 180)) * ring,
      angle + 90,
      1,
      3,
      1,
      owner,
      ring,
    );
    this.slots[index] = seeker;
    field.spawnBulletFromField(seeker);
    this.intCounter = this.intFireRate;
  }

  override deactivate(): void {
    this.slots.length = 0;
  }
}

/** `_-3C` Sapper Drone (4012): keeps ONE drone alive; respawns on its
 * 120-frame cycle only when none is out (docs 07 §6.6). */
class SapperWeapon extends ArsenalWeapon {
  private drone: SapperOrb | null = null;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 120;
    this.blnRotate = false;
    this.aimAtMouse = false;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    if (this.drone && !this.drone.readyForDelete) return;
    const muzzle = this.muzzle();
    this.drone = new SapperOrb(muzzle.x, muzzle.y, this.mountedAngle(), 1, 6, 3, owner, field.avatar);
    field.spawnBulletFromField(this.drone);
  }
}

/** `_-Ng` Seeker Carrier (4013): Run is a no-op; on the tank's death its
 * FinalPartCall releases 6 seekers at ±22 px offsets targeting the avatar
 * (docs 07 §6.2). The shoot-to-release path is a documented ledger stub. */
class SeekerCarrierWeapon extends ArsenalWeapon {
  private released = false;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = -1;
    this.aimAtMouse = false;
  }

  partCallTrigger(): void {}

  override finalPartCall(): void {
    if (this.released) return;
    this.released = true;
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field) return;
    const muzzle = this.muzzle();
    const avatar = field.avatar;
    const offsets: Array<[number, number]> = [
      [-22, 0],
      [22, 0],
      [0, -22],
      [0, 22],
      [-9, 0],
      [9, 0],
    ];
    for (const [ox, oy] of offsets) {
      field.spawnBulletFromField(new EnemySeekerBullet(muzzle.x + ox, muzzle.y + oy, this.mountedAngle(), 1, 5, 2, avatar));
    }
  }
}

/** `_-KE` Rotating Machine Gun (4015): 100 idle → 100 frames of rotation
 * (+5°/frame) firing every 4th frame (docs 07 §5). */
class RotatingMachineGunWeapon extends ArsenalWeapon {
  private phase: "idle" | "firing" = "idle";
  private timer = 100;
  private shotCounter = 0;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 4;
  }

  override run(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || this.deactivated) return;
    if (this.phase === "idle") {
      if (--this.timer <= 0) {
        this.phase = "firing";
        this.timer = 100;
        this.shotCounter = 0;
      }
      return;
    }
    // firing phase: rotate + fire every 4th frame (≈25 shots, 500° sweep)
    this.rotation += 5;
    this.shotCounter++;
    if (this.shotCounter % 4 === 0) {
      const muzzle = this.muzzle();
      field.spawnBulletFromField(new EnemyShell(muzzle.x, muzzle.y, this.rotation + owner.rotation, 1.8, 6, 4));
    }
    if (--this.timer <= 0) {
      this.phase = "idle";
      this.timer = 100;
      this.rotation = 0;
    }
  }

  partCallTrigger(): void {}
}

/** `_-IB` Machine Gun (4017): burst engine — 120 idle ticks, then 10 shots
 * at 1-per-5 ticks (docs 07 §5). */
class BurstMachineGunWeapon extends ArsenalWeapon {
  private counter = 0;
  private shotsLeft = 0;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 1;
  }

  override run(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || this.deactivated) return;
    this.counter++;
    if (this.shotsLeft > 0) {
      if (this.counter % 5 === 0) {
        this.shotsLeft--;
        const muzzle = this.muzzle();
        field.spawnBulletFromField(new EnemyShell(muzzle.x, muzzle.y, this.rotation + owner.rotation, 1, 7, 2));
      }
      if (this.shotsLeft === 0) this.counter = 0;
      return;
    }
    if (this.counter >= 120) this.shotsLeft = 10;
  }

  partCallTrigger(): void {}
}

/** `_-HU` enemy Rocket Launcher (4020): 5 rockets, 1 per 6 frames, emitter
 * order 1,5,4,3,2; the first fires the frame after the trigger (docs 07 §5). */
class EnemyRocketWeapon extends ArsenalWeapon {
  private rocketsLeft = 0;
  private launchTimer = 0;
  private static readonly EMITTER_ORDER = [1, 5, 4, 3, 2];
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 150;
  }

  override run(): void {
    super.run();
    if (this.rocketsLeft <= 0) return;
    if (--this.launchTimer > 0) return;
    this.launchTimer = 6;
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field) return;
    const muzzle = this.muzzle();
    const slot = EnemyRocketWeapon.EMITTER_ORDER[10 - this.rocketsLeft - 1] ?? 1;
    const lateral = (slot - 3) * 7;
    const perp = this.mountedAngle() + 90;
    field.spawnBulletFromField(
      new RocketBullet(
        muzzle.x + Math.cos(perp * (Math.PI / 180)) * lateral,
        muzzle.y + Math.sin(perp * (Math.PI / 180)) * lateral,
        this.mountedAngle() + randInt(-10, 10),
        1,
        10,
        3,
        true,
      ),
    );
    this.rocketsLeft--;
  }

  partCallTrigger(): void {
    const field = this.f;
    if (!field || field.jumping) return;
    if (this.rocketsLeft > 0) return;
    this.rocketsLeft = 5;
    this.launchTimer = 1; // first rocket the frame after the trigger
  }
}

/** `EGunNeutralizer` (4023): counter pre-set to the fire rate; ticks only
 * during the apocalypse, then deletes every `_ -6` and ends it (docs 07 §5). */
class NeutralizerWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 240;
    this.intCounter = 240; // counter pre-set (fires immediately once ticking)
  }

  protected override runStandardPartTimer(): void {
    const field = this.f;
    if (!field || !field.blnApocalypse) return; // ticks only during apocalypse
    super.runStandardPartTimer();
  }

  partCallTrigger(): void {
    const field = this.f;
    if (!field) return;
    for (const bullet of field.bullets) {
      if (bullet instanceof ApocalypseBullet && !bullet.readyForDelete) bullet.readyForDelete = true;
    }
    field.endApocalypse();
    field.screen.flash();
  }
}

/** `_-GG` Ripple Generator (4024): pushes avatar + allies within 120 px;
 * non-avatar targets at 2× magnitude (docs 07 §5). */
class RippleWeapon extends ArsenalWeapon {
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 80;
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const push = (target: TankLike, isAvatar: boolean): void => {
      const d = Math.sqrt(distSqrd(target.x, target.y, owner.x, owner.y));
      if (d > 120) return;
      const gap = Math.max(1, d - owner.numRadius - target.numRadius);
      const mag = (15 - 2 * target.data.numClass) * ((120 - gap) / 120);
      const dir = atan2Deg(target.y - owner.y, target.x - owner.x);
      const factor = isAvatar ? 1 : 2;
      target.push(Math.cos(dir * (Math.PI / 180)) * mag * factor, Math.sin(dir * (Math.PI / 180)) * mag * factor);
    };
    const avatar = field.avatar;
    if (avatar && avatar.alive) push(avatar, true);
    for (const ally of field.targets.allies) if (ally.alive) push(ally, false);
  }
}

/** `EGunSpike` (4026): contact damage with a 15-frame per-target cooldown;
 * knockback `8 − targetClass` (×2 for non-avatar) (docs 07 §5). */
class SpikeWeapon extends ArsenalWeapon {
  private readonly cooldowns = new Map<TankLike, number>();
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = -1;
  }

  override run(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || this.deactivated) return;
    for (const [tank, frames] of this.cooldowns) {
      if (frames <= 1) this.cooldowns.delete(tank);
      else this.cooldowns.set(tank, frames - 1);
    }
    const tip = this.muzzle();
    const candidates: Array<{ t: TankLike; avatar: boolean }> = [];
    const avatar = field.avatar;
    if (avatar && avatar.alive) candidates.push({ t: avatar, avatar: true });
    for (const ally of field.targets.allies) if (ally.alive) candidates.push({ t: ally, avatar: false });
    for (const { t, avatar: isAvatar } of candidates) {
      if ((this.cooldowns.get(t) ?? 0) > 0) continue;
      if (!t.hitTestPoint(tip.x, tip.y, 10)) continue;
      this.cooldowns.set(t, 15);
      t.damage(3, this);
      const mag = isAvatar ? 8 - t.data.numClass : (8 - t.data.numClass) * 2;
      const dir = atan2Deg(t.y - owner.y, t.x - owner.x);
      t.push(Math.cos(dir * (Math.PI / 180)) * mag, Math.sin(dir * (Math.PI / 180)) * mag);
    }
  }

  partCallTrigger(): void {}
}

/** `_-DO` Shield Turrets (4032): the first trigger deploys an EnemyTurret;
 * later triggers aim builder bullets at it; a built turret shields the owner
 * until it dies (docs 07 §6.1). */
class ShieldTurretWeapon extends ArsenalWeapon {
  private turret: EnemyTurret | null = null;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 80;
  }

  override run(): void {
    super.run();
    const owner = this.tank as Tank | null;
    if (!owner) return;
    if (!this.turret) return;
    if (this.turret.readyForDelete) {
      owner.blnShieled = false;
      this.turret = null;
    } else if (this.turret.builtFrames >= 4) {
      owner.blnShieled = true;
    }
  }

  partCallTrigger(): void {
    const owner = this.tank;
    const field = this.f;
    if (!owner || !field || field.jumping) return;
    const muzzle = this.muzzle();
    if (!this.turret || this.turret.readyForDelete) {
      this.turret = new EnemyTurret(muzzle.x, muzzle.y, this.mountedAngle(), 1, 10, 0, owner);
      field.spawnBulletFromField(this.turret);
    } else {
      const aim = atan2Deg(this.turret.y - muzzle.y, this.turret.x - muzzle.x);
      field.spawnBulletFromField(new EnemyTurretBuilder(muzzle.x, muzzle.y, aim, 1, 10, 0, null));
    }
  }
}

// ------------------------------------------------------------- behaviors

/** Behavior-part contract mirror (the `guns.ts` `BehaviorPart` shape the
 * tank's `runParts` loop drives). */
export interface BehaviorLike {
  readonly intObjID: number;
  setup(tank: Tank): void;
  runBehavior(): void;
  onJammed(isAvatar: boolean): void;
  deactivate(): void;
}

/** Arsenal behavior base — mirrors the `BehaviorPart` lifecycle with the
 * arsenal's null-safe owner/field accessors. */
abstract class ArsenalBehavior implements BehaviorLike {
  readonly intObjID: number;
  protected owner: Tank | null = null;
  private readonly detailIndex: number;

  constructor(intObjID: number, detailIndex: number) {
    this.intObjID = intObjID;
    this.detailIndex = detailIndex;
  }

  protected get f(): FieldContext | null {
    return this.owner?.field ?? null;
  }

  protected muzzle(): { x: number; y: number } {
    return this.owner!.weaponMuzzle(this.detailIndex);
  }

  /** `Setup`. */
  setup(tank: Tank): void {
    this.owner = tank;
    this.separateSetup();
  }

  /** Per-behavior setup hook. */
  protected separateSetup(): void {}

  abstract runBehavior(): void;

  onJammed(_isAvatar: boolean): void {}

  deactivate(): void {
    this.owner = null;
  }
}

/** `EBehaviorHealer` (6002): maintains one HealerBeam on a damaged patient;
 * re-acquires when the patient heals or moves >400 px away (docs 07 §4). */
class HealerBehavior extends ArsenalBehavior {
  private beam: HealerBeam | null = null;

  private acquireTarget(): void {
    const owner = this.owner;
    const field = this.f;
    if (!owner || !field) return;
    if (owner.tankType === 3) {
      // enemy healer: first OTHER damaged enemy
      this.patient = field.targets.enemies.find((e) => e !== owner && e.alive && e.intTankLife < e.data.numLife) ?? null;
    } else {
      const avatar = field.avatar;
      if (avatar && avatar.alive && avatar.intTankLife < avatar.data.numLife) {
        this.patient = avatar;
        return;
      }
      this.patient = field.targets.allies.find((a) => a.alive && a.intTankLife < a.data.numLife) ?? null;
    }
  }

  private patient: TankLike | null = null;

  runBehavior(): void {
    const owner = this.owner;
    const field = this.f;
    if (!owner || !field) return;
    this.acquireTarget();
    const target = this.patient;
    if (!target || !target.alive || distSqrd(target.x, target.y, owner.x, owner.y) > 160000) {
      this.stopBeam();
      return;
    }
    if (!this.beam || this.beam.readyForDelete) {
      const muzzle = this.muzzle();
      this.beam = new HealerBeam(muzzle.x, muzzle.y, 0, 1, 1, owner, target);
      field.spawnBulletFromField(this.beam);
    }
  }

  private stopBeam(): void {
    if (this.beam && !this.beam.readyForDelete) this.beam.readyForDelete = true;
    this.beam = null;
  }

  override deactivate(): void {
    this.stopBeam();
    this.owner = null;
  }
}

/** `EBehaviorSkittish` (6003): flee when the target is near and in front
 * (veer ±90..110°, waypoint 700 px out); beyond 600 px just wander. */
class SkittishBehavior extends ArsenalBehavior {
  protected override separateSetup(): void {
    if (this.owner) this.owner.blnSkittish = true;
  }

  runBehavior(): void {
    const owner = this.owner;
    if (!owner) return;
    const target = this.f?.avatar ?? null;
    if (!target || !target.alive || distSqrd(target.x, target.y, owner.x, owner.y) > 600 * 600) {
      owner.swarmPoint = null;
      return;
    }
    const toTarget = atan2Deg(target.y - owner.y, target.x - owner.x);
    const delta = wrapDeg(toTarget - owner.rotation);
    if (Math.abs(delta) <= 90) {
      const side = delta >= 0 ? 1 : -1;
      const fleeAngle = wrapDeg(toTarget + side * randInt(90, 110) + 180);
      owner.swarmPoint = {
        x: owner.x + Math.cos(fleeAngle * (Math.PI / 180)) * 700,
        y: owner.y + Math.sin(fleeAngle * (Math.PI / 180)) * 700,
      };
    }
  }
}

/** `_-Ai` Phasing (6004): 300-frame alpha cloak cycle — fade out over frames
 * 0-50, fade in over 150-200 (docs 07 §4). */
class PhasingBehavior extends ArsenalBehavior {
  private counter = randInt(0, 50);

  runBehavior(): void {
    const owner = this.owner;
    if (!owner) return;
    this.counter = (this.counter + 1) % 300;
    if (this.counter <= 50) owner.view.alpha = Math.max(0, owner.view.alpha - 0.02);
    else if (this.counter >= 150 && this.counter <= 200) owner.view.alpha = Math.min(1, owner.view.alpha + 0.02);
  }
}

/** `_-WJ` Wall Flower (6005): orbit the rim with a wobbling radius
 * (docs 07 §4). */
class WallFlowerBehavior extends ArsenalBehavior {
  private readonly mod1 = randInt(2, 10) / 100;
  private readonly mod2 = randInt(10, 20);
  private counter = 0;
  private direction = 1;

  protected override separateSetup(): void {
    if (this.owner) this.owner.blnWallFlower = true;
  }

  runBehavior(): void {
    const owner = this.owner;
    const field = this.f;
    if (!owner || !field) return;
    this.counter++;
    const rim = field.fieldRadius * (424 / FIELD_RADIUS) - owner.numRadius;
    const outAngle = atan2Deg(owner.y, owner.x);
    const d = Math.sqrt(owner.x * owner.x + owner.y * owner.y);
    if (Math.abs(d - rim) > 30 + owner.numRadius) {
      owner.swarmPoint = {
        x: Math.cos(outAngle * (Math.PI / 180)) * rim,
        y: Math.sin(outAngle * (Math.PI / 180)) * rim,
      };
      return;
    }
    // advance the wall point ±1° per frame with a wobbled radius
    const wobble = rim - Math.sin(this.mod1 * this.counter) * this.mod2;
    const angle = outAngle + this.direction;
    owner.swarmPoint = {
      x: Math.cos(angle * (Math.PI / 180)) * wobble,
      y: Math.sin(angle * (Math.PI / 180)) * wobble,
    };
  }
}

/** M3 behavior factory — consulted by `createBehaviorForPart`. */
export function createSpecialBehavior(intObjID: number, detailIndex: number): BehaviorLike | null {
  switch (intObjID) {
    case 6002:
      return new HealerBehavior(intObjID, detailIndex);
    case 6003:
      return new SkittishBehavior(intObjID, detailIndex);
    case 6004:
      return new PhasingBehavior(intObjID, detailIndex);
    case 6005:
      return new WallFlowerBehavior(intObjID, detailIndex);
    default:
      return null;
  }
}

// ------------------------------------------------------------------ factory

/** M3 weapon factory — consulted by `createWeaponForPart` before the uniform
 * spec tables. */
export function createSpecialWeapon(intObjID: number, detailIndex: number): Weapon | null {
  switch (intObjID) {
    // avatar primaries with bespoke shots
    case 2009:
    case 2010:
    case 2011:
    case 2012:
    case 2015:
    case 2016:
    case 2018:
      return specialShotWeapon(intObjID, detailIndex);
    case 2017:
      return new BeamCannonWeapon(intObjID, detailIndex);
    // secondaries
    case 3001:
      return new StickyBurstWeapon(intObjID, detailIndex);
    case 3002:
      return new StunBurstWeapon(intObjID, detailIndex);
    case 3003:
      return new AreaBurstWeapon(intObjID, detailIndex);
    case 3004:
      return new AreaBurstCannonWeapon(intObjID, detailIndex);
    case 3005:
      return new StarBurstWeapon(intObjID, detailIndex);
    case 3006:
      return new DroneConverterWeapon(intObjID, detailIndex);
    case 3007:
      return new SwarmBayWeapon(intObjID, detailIndex);
    case 3008:
      return new MassiveCannonWeapon(intObjID, detailIndex);
    case 3009:
      return new SeekersWeapon(intObjID, detailIndex);
    case 3010:
      return new ShieldWeapon(intObjID, detailIndex);
    case 3011:
    case 3012:
      return new TeleportWeapon(intObjID, detailIndex);
    case 3013:
      return new DoomsdayInfectorWeapon(intObjID, detailIndex);
    case 3014:
      return new BubbleWhipWeapon(intObjID, detailIndex);
    case 3015:
      return new RocketLauncherWeapon(intObjID, detailIndex);
    case 3016:
      return new MineBayWeapon(intObjID, detailIndex);
    case 3017:
      return new ApocalypseCannonWeapon(intObjID, detailIndex);
    // interfaces
    case 5001:
    case 5002:
      return new InterfaceMarkerWeapon(intObjID, detailIndex);
    case 5003:
      return new AutoCannonWeapon(intObjID, detailIndex);
    case 5004:
      return new SeekerFlakWeapon(intObjID, detailIndex);
    case 5005:
      return new ForcefieldWeapon(intObjID, detailIndex);
    case 5006:
      return new OrbitalSeekersWeapon(intObjID, detailIndex);
    // ally gun
    case 7001:
      return new AllyAutoCannonWeapon(intObjID, detailIndex);
    // enemy guns
    case 4003:
      return new EnemySpawnerWeapon(intObjID, detailIndex);
    case 4009:
      return new MineDropperWeapon(intObjID, detailIndex, false);
    case 4010:
      return new EnemyOrbitalSeekerWeapon(intObjID, detailIndex);
    case 4011:
    case 4018:
    case 4019:
    case 4021:
    case 4025:
      return specialShotWeapon(intObjID, detailIndex);
    case 4012:
      return new SapperWeapon(intObjID, detailIndex);
    case 4013:
      return new SeekerCarrierWeapon(intObjID, detailIndex);
    case 4015:
      return new RotatingMachineGunWeapon(intObjID, detailIndex);
    case 4017:
      return new BurstMachineGunWeapon(intObjID, detailIndex);
    case 4020:
      return new EnemyRocketWeapon(intObjID, detailIndex);
    case 4023:
      return new NeutralizerWeapon(intObjID, detailIndex);
    case 4024:
      return new RippleWeapon(intObjID, detailIndex);
    case 4026:
      return new SpikeWeapon(intObjID, detailIndex);
    case 4032:
      return new ShieldTurretWeapon(intObjID, detailIndex);
    default:
      return null;
  }
}

/** Bespoke-shot primaries/enemy guns (docs 06 §3.1, 07 §5). */
function specialShotWeapon(intObjID: number, detailIndex: number): Weapon {
  switch (intObjID) {
    case 2009: // Pierce Cannon — `_-Un` s14 d15
      return new SpecialShotWeapon(2009, detailIndex, 32, (x, y, a, o) => o.field?.spawnBulletFromField(new PierceBullet(x, y, a, 1, 14, 15)));
    case 2010: // Exploding Pierce — `_-Un` s14 d30 + burst visual
      return new SpecialShotWeapon(2010, detailIndex, 45, (x, y, a, o) => o.field?.spawnBulletFromField(new PierceBullet(x, y, a, 1, 14, 30, true)));
    case 2011: // Leech Cannon — `_-El` s10 d2
      return new SpecialShotWeapon(2011, detailIndex, 8, (x, y, a, o) => o.field?.spawnBulletFromField(new LeechBullet(x, y, a, 1, 10, 2)));
    case 2012: // Bullet Buster — `_-c4` s10 d1
      return new SpecialShotWeapon(2012, detailIndex, 40, (x, y, a, o) => o.field?.spawnBulletFromField(new BulletBuster(x, y, a, 1, 10, 1)));
    case 2015: // Bubble Thrower — `_-dO` s10 d1, ±15° jitter
      return new SpecialShotWeapon(2015, detailIndex, 1, (x, y, a, o) => o.field?.spawnBulletFromField(new ThrowerGlob(x, y, a + randInt(-15, 15), 1, 10, 1)));
    case 2016: // Ricochet Gun — `_-bk` s15 d8
      return new SpecialShotWeapon(2016, detailIndex, 20, (x, y, a, o) => o.field?.spawnBulletFromField(new RicochetBullet(x, y, a, 1, 15, 8)));
    case 2018: // Repulsor — `_-OE` s8 d0
      return new SpecialShotWeapon(2018, detailIndex, 18, (x, y, a, o) => o.field?.spawnBulletFromField(new RepulsorWave(x, y, a, 1, 8, 0)));
    case 4011: // enemy Sticky Gun — `_-aw` s6 d0
      return new SpecialShotWeapon(4011, detailIndex, 80, (x, y, a, o) => o.field?.spawnBulletFromField(new EnemyStickyShot(x, y, a, 1, 6, 0)));
    case 4018: // Ink Gun — `_-ar` s6 d0
      return new SpecialShotWeapon(4018, detailIndex, 80, (x, y, a, o) => o.field?.spawnBulletFromField(new EnemyInkShot(x, y, a, 1, 6, 0)));
    case 4019: // Spin-Fire — `_-V3` hub s5 d3
      return new SpecialShotWeapon(4019, detailIndex, 240, (x, y, a, o) => o.field?.spawnBulletFromField(new SpinFireHub(x, y, a, 1, 5, 3)));
    case 4021: // Seeker Mine Dropper — `_-XK` s4 d7 (mine-cap weapon)
      return new MineDropperWeapon(4021, detailIndex, true);
    case 4025: // Jamming Gun — `_-Md` s6 d0
      return new SpecialShotWeapon(4025, detailIndex, 80, (x, y, a, o) => o.field?.spawnBulletFromField(new EnemyJamShot(x, y, a, 1, 6, 0)));
    default:
      throw new Error(`unreachable special shot ${intObjID}`);
  }
}
/** `_-JU` — Area Burst Cannon shell: on hit, burst + AoE 30 @ 125 px (×1.15)
 * vs enemies + enemy destroyable-bullet wipe (docs 08 §3.1). */
class ExplodingShell extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 9 });
  }

  protected override onHitTank(tank: TankLike): void {
    super.onHitTank(tank);
    this.field?.areaDamageTest("r", tank, this.x, this.y, 125, 30);
  }
}

// ---- beam weapon (declared late to sit with its bullet import) -------------

/** `ABeamCannon` (2017): maintains one beam bullet repositioned every frame;
 * removed on jam/mouse-up/death (docs 06 §4.1). */
class BeamCannonWeapon extends ArsenalWeapon {
  private beam: BeamBullet | null = null;
  constructor(intObjID: number, detailIndex: number) {
    super(intObjID, detailIndex);
    this.intFireRate = 3;
  }

  partCallTrigger(): void {
    const owner = this.tank as Tank | null;
    const field = this.f;
    if (!owner || !field) return;
    if (owner.blnJammed || field.jumping) {
      this.stopFiring();
      return;
    }
    const muzzle = this.muzzle();
    if (!this.beam || this.beam.readyForDelete) {
      this.beam = new BeamBullet(muzzle.x, muzzle.y, this.mountedAngle(), 1, 0, 1);
      field.spawnBulletFromField(this.beam);
    } else {
      this.beam.reposition(muzzle.x, muzzle.y, this.mountedAngle());
    }
  }

  override stopFiring(): void {
    if (this.beam && !this.beam.readyForDelete) this.beam.readyForDelete = true;
    this.beam = null;
  }
}

// Ally-bay encrypted tank codes (docs 06 §4.7 — verbatim literals).
const SWARM_TANK_CODE =
  "7bcb168570e756eed9aa5d84042bbf7aca242e9b5cb141cf162e79ecc5227190fd66aee199e8523624c01494fe25562fb1e0ae9d7da988ccd39edce1ead08022b7a590f4544703c048f333713de1102a18835d8e760191104b5474fa9d9a260466e9730bea431e8b07ca47563e1fec06b12f1e2492aea9d04e92ddde779fdcc698ffc60eb6d29c9e8a736e8c288ec28cd51847091cd324da1c1cca46b024f5763b221f2e5caced441bbfeded4686f4f095ce84d37f32e00bf3f79b716f967830de95709f5882388ccf9ccf12ce8443b04350830047bbb0eb8b3ef8ea49f7bba1fa0800cb6b787baa201b1ce9dbbf61f364e803";
const MINE_TANK_CODE =
  "e6c3657d420188175cb3dc4cb9f65e550feecc129c687a53853450953734391babe43089e14e02ea66cb20a746d4ba984c6312c64f8a780b61758f5c35426138a3b92258a24c8253fbd2afb62af51acf3688be6d0cfd2537af1a8cecae21b4d38aebc739c11a9a429c2e3f9f8639bde79bd3666ece261d7a795517bd371d4c71cce7f84552e3124c84a937be79b34b0f638cb4d0e633140676322bf1193781c9d63081eedfd415b2ce80f2dd77b2adf7544f439eb6244dcfadcae0d714f8963c52d3bd20bc930ea33ddd47b6fb2e0d82fca01721117609d8a2e8a14543850ac039ff2e7ad941a0f743e00095e01ec4efc0398d65f48da988b4689db5ba6c75aeb6cb02c9e6d18de95e52b80b242ceaf5421d6f6a7ade43b16f13ac53e42bb77c740aa3a98f946d313df588a62c4d4dabdde6ecf9ed98d1d4930e80b44d1acaa62c9b2085251a94f71e4a2d491799c71d9653c18cae17dc8e9da368a90834053e9a7bb5ab8689fd4d00caf6c59b8fc2a2c7a42fffb37c8f167c0f7135f1b71db613e0c4";
