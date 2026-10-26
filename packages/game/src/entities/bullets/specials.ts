/**
 * M3 projectile catalogue — the live `_-14` classes (docs 08 §3.1), one
 * TypeScript subclass per documented behavior. Spawn numbers come from the
 * weapon tables (docs 06 §3 / 07 §5); behavior notes cite the doc section.
 *
 * Base-class hooks used: `moveBullet` (per-frame motion), `testForCollision`
 * (two-point tank test), `onHitTank` (impact), `onWallExpire`, `markHit` /
 * `isPierceImmune` (pierce hit-list), `drawBullet` (art).
 */

import { DisplayNode } from "../../core/DisplayNode";
import { atan2Deg, wrapDeg } from "../../core/math";
import type { TankLike } from "../field-context";
import { bulletsOverlap, Bullet } from "./Bullet";

// ------------------------------------------------------- pierce family

/**
 * `_-Un` — pierce shot (docs 08 §3.1). `MoveBullet` ignores the collision
 * result; each first contact damages, plays the hit sound, and delivers
 * **AoE 100 @ 75px (×1.15)** excluding the directly-hit tank; the hit-list
 * prevents re-hits. `blnExplode` adds the `_ -1g` burst visual only.
 */
export class PierceBullet extends Bullet {
  private readonly explode: boolean;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, explode = false) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 8 });
    this.explode = explode;
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (this.isOutsideOfBubble()) {
      this.onWallExpire();
      return true;
    }
    void this.testForCollision(); // result ignored — the shot flies on
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }

  protected override testForCollision(): boolean {
    const field = this.field;
    if (!field) return false;
    const sx = this.x - this.moveX / 2;
    const sy = this.y - this.moveY / 2;
    for (const enemy of field.targets.enemies) {
      if (!enemy.alive || this.isPierceImmune(enemy)) continue;
      if (this.hitsTank(enemy, sx, sy)) {
        this.markHit(enemy);
        enemy.damage(this.damage, this);
        field.sounds.play("hit");
        // AoE excluding the directly-hit tank (source = that tank)
        field.areaDamageTest("r", enemy, this.x, this.y, 75, 100);
        if (this.explode) this.spawnBurst();
      }
    }
    return false;
  }

  private burst: DisplayNode | null = null;
  protected spawnBurst(): void {
    const field = this.field;
    if (!field || this.burst) return;
    this.burst = new DisplayNode((ctx) => {
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 40);
      grad.addColorStop(0, "rgba(255,240,200,0.9)");
      grad.addColorStop(1, "rgba(255,160,60,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, Math.PI * 2);
      ctx.fill();
    }, "explodeBurst");
    field.addEffect({ node: this.burst, x: this.x, y: this.y, layer: "TopEffectsLayer", randomRotation: false, frames: 12 });
  }
}

/** `_-dp` — massive shot: pierces like `_-Un`, each first contact → `_ -1g`
 * burst + AoE 30 @ 75px (docs 06 §4.4, 08 §3.1). */
export class MassiveBullet extends PierceBullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, scale, speed, damage, true);
  }

  protected override testForCollision(): boolean {
    const field = this.field;
    if (!field) return false;
    const sx = this.x - this.moveX / 2;
    const sy = this.y - this.moveY / 2;
    for (const enemy of field.targets.enemies) {
      if (!enemy.alive || this.isPierceImmune(enemy)) continue;
      if (this.hitsTank(enemy, sx, sy)) {
        this.markHit(enemy);
        enemy.damage(this.damage, this);
        field.sounds.play("hit");
        field.areaDamageTest("r", enemy, this.x, this.y, 75, 30);
        this.spawnBurst();
      }
    }
    return false;
  }
}

// -------------------------------------------------------------- ricochet

/** `_-bk` — ricochet round: bounces off the bubble wall (reflection about
 * the radial normal, `atan2(x,y)` swapped-arg form), up to 5 bounces
 * (docs 08 §3.1). */
export class RicochetBullet extends Bullet {
  private bounces = 0;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 8 });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (this.isOutsideOfBubble()) {
      if (this.bounces <= 5) {
        // reflection about the radial normal: 180 + 2·atan2(y,x) − rot
        this.rotation = wrapDeg(180 + 2 * atan2Deg(this.y, this.x) - this.rotation);
        this.setMovement(this.rotation);
        this.bounces++;
      } else {
        this.onWallExpire();
        return true;
      }
    }
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }
}

// ------------------------------------------------------------ apocalypse

/**
 * `_-6` — Apocalypse round (docs 08 §3.1). At the wall (BF width/2): 56-frame
 * fuse (field `blnApocalypse = true`), then the field death anim — shrink by
 * `scaleX/204` per frame with escalating shake + random flashes while the
 * player control is paused. Approximation: the fuse keeps the bullet moving;
 * the shrink lives on the field (see `BubbleField.beginApocalypse`).
 */
export class ApocalypseBullet extends Bullet {
  private fuse = -1;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 10 });
  }

  override isOutsideOfBubble(): boolean {
    if (!this.field) return false;
    // `_ -6` uses BF_BG width/2 (= field radius) instead of 415
    return this.x * this.x + this.y * this.y > this.field.fieldRadius ** 2;
  }

  protected override onWallExpire(): void {
    // first wall contact starts the fuse instead of removing the bullet
    if (this.fuse === -1) {
      this.fuse = 56;
      if (this.field) this.field.blnApocalypse = true;
    }
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (this.isOutsideOfBubble()) this.onWallExpire();
    if (this.fuse > 0) {
      this.fuse--;
      if (this.fuse === 0) {
        this.field.beginApocalypse();
        this.worldPauseControl?.();
        return true;
      }
    }
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }

  /** Wired by the weapon: `objWorld.PausePlayerControl()`. */
  worldPauseControl: (() => void) | null = null;
}

// ---------------------------------------------------------- fuse / split

/** `_-Hu` — star-burst cluster: 45-frame fuse → 36 × plain shots
 * (dmg 5, spd 7, every 10°), then removed (docs 08 §3.1). */
export class ClusterBomb extends Bullet {
  private fuse = 45;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 9 });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (this.isOutsideOfBubble()) {
      this.onWallExpire();
      return true;
    }
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    if (--this.fuse <= 0) {
      const field = this.field;
      if (field) {
        for (let angle = 0; angle < 360; angle += 10) {
          field.spawnBulletFromField(new ShellShot(this.x, this.y, angle, 1, 7, 5, false));
        }
      }
      return true;
    }
    return false;
  }
}

/** Generic plain shell with a configurable side (`_-U7` / `_-GV`). */
export class ShellShot extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, isEnemy: boolean) {
    super(x, y, rotation, speed, damage, { scale, isEnemy, bulletRadius: 8 });
  }
}

// ---------------------------------------------------------- life / status

/** `_-El` — leech shot: on hit, one auto-collected 1-life bubble
 * (docs 08 §3.1). */
export class LeechBullet extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 8 });
  }

  protected override onHitTank(tank: TankLike): void {
    super.onHitTank(tank);
    this.field?.spawnLifeBubbles(this.x, this.y, 1, true);
  }
}

/** `_-0L` — sticky pellet (Sticky Burst ring): applies `GetStuck` on hit
 * (docs 06 §4.2, 08 §3.1). */
export class StickyPellet extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 6 });
  }

  protected override onHitTank(tank: TankLike): void {
    tank.getStuck();
    this.spawnPuff(this.x, this.y);
    this.field?.sounds.play("hit");
  }
}

/** `_-aw` — enemy sticky shot: shield-checked sticky (avatar slows via the
 * HUD, AI tanks via `GetStuck`) (docs 07 §6.5). */
export class EnemyStickyShot extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: true, bulletRadius: 6 });
  }

  protected override onHitTank(tank: TankLike): void {
    if (!tank.shielded) tank.getStuck();
    this.spawnPuff(this.x, this.y);
  }
}

/** `_-Md` — enemy jam shot: `JammedMe()` on hit unless shielded (docs 07 §6.5). */
export class EnemyJamShot extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: true, bulletRadius: 6 });
  }

  protected override onHitTank(tank: TankLike): void {
    if (!tank.shielded) tank.jamMe();
    this.spawnPuff(this.x, this.y);
  }
}

/** `_-ar` — enemy ink shot: 120-frame screen ink on the avatar unless
 * shielded/forcefielded (docs 07 §6.5). */
export class EnemyInkShot extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: true, bulletRadius: 6 });
  }

  protected override onHitTank(tank: TankLike): void {
    if (!tank.shielded && !tank.hasForcefield) tank.inkMe(120);
    this.spawnPuff(this.x, this.y);
  }
}

// ------------------------------------------------------- anti-bullet guns

/** `_-c4` — Bullet Buster: converts enemy bullets to ghosts carrying the
 * buster's velocity; never touches tanks (docs 08 §3.1). */
export class BulletBuster extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 6 });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (this.isOutsideOfBubble()) {
      this.onWallExpire();
      return true;
    }
    void this.testForCollision(); // result ignored (like the original)
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }

  protected override testForCollision(): boolean {
    const field = this.field;
    if (!field) return false;
    for (const other of field.bullets) {
      if (!other.isEnemy || other.readyForDelete) continue;
      const r = 11.5 + other.bulletRadius * other.scale / 2;
      if ((this.x - other.x) ** 2 + (this.y - other.y) ** 2 < r * r) {
        (other as Bullet).makeGhost(this.moveX, this.moveY);
        return true;
      }
    }
    return false;
  }
}

/** `_-cW` — Seeker Flak puff: detonates enemy seeker bullets near its path
 * (docs 06 §5.4); short fused life. */
export class FlakPuff extends Bullet {
  private life = 30;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 5 });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (this.isOutsideOfBubble() || --this.life <= 0) {
      this.onWallExpire();
      return true;
    }
    // detonate enemy seekers we touch
    for (const other of this.field.bullets) {
      if (!other.isEnemy || !other.seeker || other.readyForDelete) continue;
      if (bulletsOverlap(this, other, 12 + other.bulletRadius * other.scale / 2)) {
        other.readyForDelete = true;
        this.field.areaDamageTest("r", null, other.x, other.y, 60, 2);
        this.spawnPuff(other.x, other.y);
      }
    }
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }
}

// ------------------------------------------------------------- repulsor

/** `_-OE` — repulsor wave: fades through enemies, knocking back any tank
 * within 70 px of its front by `(15 − 2·class)·alpha·2` along its heading
 * (docs 08 §3.1). */
export class RepulsorWave extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 10 });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    this.view.alpha -= 0.04;
    if (this.view.alpha <= 0) return true;
    if (this.isOutsideOfBubble()) {
      this.onWallExpire();
      return true;
    }
    // pass-through knockback (empty collision if in the original)
    const targets = this.field.targets;
    const pushTargets: TankLike[] = targets.avatar && targets.avatar.alive ? [targets.avatar, ...targets.allies] : [...targets.allies];
    for (const tank of pushTargets) {
      if (!tank.alive || this.isPierceImmune(tank)) continue;
      const d = Math.sqrt((tank.x - this.x) ** 2 + (tank.y - this.y) ** 2);
      if (d - tank.numRadius < 70) {
        this.markHit(tank);
        const mag = (15 - 2 * tank.data.numClass) * this.view.alpha * 2;
        const dir = atan2Deg(tank.y - this.y, tank.x - this.x);
        tank.push(Math.cos(dir * (Math.PI / 180)) * mag, Math.sin(dir * (Math.PI / 180)) * mag);
      }
    }
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }
}

// ----------------------------------------------------------- thrower etc

/** `_-dO` — bubble-thrower glob: grows, fades, heading jitters ±5°/frame,
 * dies at alpha ≤ 0 (docs 08 §3.1). */
export class ThrowerGlob extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 7 });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    this.scale += 0.05;
    this.view.alpha -= 0.05;
    if (this.view.alpha <= 0) return true;
    this.setMovement(this.rotation + (Math.random() * 10 - 5));
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    this.view.scaleX = this.scale;
    this.view.scaleY = this.scale;
    return false;
  }
}

/** `_-V3` — spin-fire hub: every 5 frames sprays 4 plain shots (dmg 1,
 * spd 10) at 90° spacing around a slowly rotating base (+6°/5f) (docs 07 §5). */
export class SpinFireHub extends Bullet {
  private sprayAngle = 45;
  private counter = 0;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: true, bulletRadius: 8 });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (this.isOutsideOfBubble()) {
      this.onWallExpire();
      return true;
    }
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    if (++this.counter % 5 === 0) {
      this.sprayAngle += 6;
      const field = this.field;
      if (field) {
        for (let k = 0; k < 4; k++) {
          const angle = this.sprayAngle + 45 + k * 90;
          const ox = Math.cos(angle * (Math.PI / 180)) * (this.bulletRadius * this.scale / 2);
          const oy = Math.sin(angle * (Math.PI / 180)) * (this.bulletRadius * this.scale / 2);
          field.spawnBulletFromField(new ShellShot(this.x + ox, this.y + oy, angle, 1, 10, 1, true));
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------- rockets

/**
 * `_-Kk` — rocket base: sinusoidal weave (`rot = sin(counter·mod1)·mod2 +
 * heading`, mod1 0.10–0.20, mod2 0.1–0.8, start offset 45°) with a fading
 * smoke trail every 3 frames (docs 07 §5, 08 §3.1). Skins: AvatarRocket /
 * EnemyRocket.
 */
export class RocketBullet extends Bullet {
  private readonly heading: number;
  private readonly mod1 = 0.1 + Math.random() * 0.1;
  private readonly mod2 = 0.1 + Math.random() * 0.7;
  private counter = 0;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, isEnemy: boolean) {
    super(x, y, rotation, speed, damage, { scale, isEnemy, bulletRadius: 6 });
    this.heading = rotation;
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    this.counter++;
    this.rotation = (Math.sin(this.counter * this.mod1) * this.mod2 * 180) / Math.PI + this.heading + 45 * Math.exp(-this.counter / 12);
    this.setMovement(this.rotation);
    if (this.counter % 3 === 0) this.spawnSmoke();
    if (this.isOutsideOfBubble()) {
      this.onWallExpire();
      return true;
    }
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }

  private trailTimer = 0;
  private spawnSmoke(): void {
    const field = this.field;
    if (!field) return;
    const smoke = new DisplayNode((ctx) => {
      ctx.fillStyle = "rgba(200,210,215,0.35)";
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }, "smoke");
    field.addEffect({ node: smoke, x: this.x, y: this.y, layer: "BottomEffectsLayer", randomRotation: false, frames: 20 });
    void this.trailTimer;
  }
}

// ------------------------------------------------------------- whip / beam

/** `_-Rx` — Bubble Whip: pinned to its emitter each frame; damage via
 * segment hit-tests along the blade; lifetime = its timeline
 * (ported as 24 frames) (docs 08 §3.1). */
export class WhipBullet extends Bullet {
  private readonly anchor: () => { x: number; y: number };
  private life = 24;
  constructor(
    x: number,
    y: number,
    rotation: number,
    scale: number,
    speed: number,
    damage: number,
    anchor: () => { x: number; y: number },
  ) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 8 });
    this.anchor = anchor;
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    const p = this.anchor();
    this.x = p.x;
    this.y = p.y;
    this.syncView();
    // segment sweep along the blade (three samples), one hit per tank
    const len = this.bulletRadius * this.scale * 3;
    for (const enemy of this.field.targets.enemies) {
      if (!enemy.alive || this.isPierceImmune(enemy)) continue;
      for (const t of [0.35, 0.65, 1]) {
        const px = this.x + Math.cos(this.rotation * (Math.PI / 180)) * len * t;
        const py = this.y + Math.sin(this.rotation * (Math.PI / 180)) * len * t;
        if (enemy.hitTestPoint(px, py, 8)) {
          this.markHit(enemy);
          enemy.damage(this.damage, this);
          this.spawnPuff(px, py);
          break;
        }
      }
    }
    return --this.life <= 0;
  }
}

/** `_-CO` — Beam Cannon segment: anchored at the muzzle (the weapon
 * repositions it every frame), culls enemies to the beam cone, damages every
 * 2nd frame of contact (docs 06 §4.1, 08 §3.1). */
export class BeamBullet extends Bullet {
  private damageCounter = 0;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: false, bulletRadius: 5 });
  }

  /** Weapon-side anchor update (the beam never travels on its own). */
  reposition(x: number, y: number, rotation: number): void {
    this.x = x;
    this.y = y;
    this.rotation = rotation;
    this.setMovement(rotation);
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    // repositioned by the weapon; sweep for enemies along the beam
    const len = this.field.fieldRadius;
    const step = 6;
    const dirX = Math.cos(this.rotation * (Math.PI / 180));
    const dirY = Math.sin(this.rotation * (Math.PI / 180));
    this.damageCounter++;
    for (const enemy of this.field.targets.enemies) {
      if (!enemy.alive || this.isPierceImmune(enemy)) continue;
      const relX = enemy.x - this.x;
      const relY = enemy.y - this.y;
      const along = relX * dirX + relY * dirY;
      if (along <= 0 || along > len) continue;
      const lateral = Math.abs(relX * dirY - relY * dirX);
      if (lateral > enemy.numRadius) continue;
      if (this.damageCounter % 2 === 0) {
        this.markHit(enemy);
        enemy.damage(this.damage, this);
      }
    }
    this.syncView();
    return false;
  }
}

// ---------------------------------------------------------- mines / turrets

/** `_-U9` / `_-M1` — stationary mines; die by contact or the completion
 * wipe; `_ -6j` poof on death (docs 07 §6.3). */
export class MineBullet extends Bullet {
  override isMineLike(): boolean {
    return true;
  }

  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, isEnemy: boolean) {
    super(x, y, rotation, speed, damage, { scale, isEnemy, bulletRadius: 9 });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    // never translates — contact only
    return this.testForCollision();
  }
}

/** `_-XK` — seeker mine: scatter at 2× speed, arms when the avatar is near,
 * then homes; destroyable once armed (docs 07 §6.3). */
export class SeekerMine extends Bullet {
  private armed = false;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, spread: number) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: true, bulletRadius: 8, seeker: true, specialData: { spread } });
  }

  override isMineLike(): boolean {
    return true;
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    const spread = this.specialData.spread ?? 0;
    if (!this.armed && spread > 0) {
      // scatter phase: 2× speed
      this.specialData.spread = spread - 1;
      if (this.testForCollision()) return true;
      this.x += this.moveX * 2;
      this.y += this.moveY * 2;
      this.syncView();
      return this.isOutsideOfBubble();
    }
    const avatar = this.field.avatar;
    if (!this.armed && avatar && avatar.alive) {
      const d = Math.sqrt((avatar.x - this.x) ** 2 + (avatar.y - this.y) ** 2);
      if (d < 75 + avatar.numRadius) {
        this.armed = true;
        this.setMovement(atan2Deg(avatar.y - this.y, avatar.x - this.x));
      }
    }
    if (this.armed) {
      if (this.seekerBulletScan()) return true;
      if (avatar && avatar.alive) this.setMovement(atan2Deg(avatar.y - this.y, avatar.x - this.x));
    }
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return this.isOutsideOfBubble();
  }
}

/** `EnemyTurret` — deployable turret: decelerates to a stop within 200 px,
 * absorbs player bullets (10 HP), removed only by damage (docs 07 §6.1). */
export class EnemyTurret extends Bullet {
  private startX = 0;
  private startY = 0;
  life = 10;
  builtFrames = 0;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, home: TankLike | null) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: true, bulletRadius: 12, homeTank: home });
    this.startX = x;
    this.startY = y;
  }

  override isMineLike(): boolean {
    return true;
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    const dist = Math.sqrt((this.x - this.startX) ** 2 + (this.y - this.startY) ** 2);
    const speed = 10 * (1 - dist / 200);
    if (speed < 0.4) {
      this.speed = 0;
      this.moveX = 0;
      this.moveY = 0;
    } else {
      this.speed = speed;
      this.setMovement(this.rotation);
    }
    // absorb player-side bullets
    for (const other of this.field.bullets) {
      if (other.isEnemy || other.readyForDelete) continue;
      const r = this.bulletRadius * this.scale + other.bulletRadius * other.scale / 2;
      if ((this.x - other.x) ** 2 + (this.y - other.y) ** 2 < r * r) {
        this.life -= other.damage;
        this.spawnPuff(other.x, other.y);
        if (other.damage > 0) other.readyForDelete = true; // beams pass through
        if (this.life <= 0) {
          this.spawnPuff(this.x, this.y);
          return true;
        }
      }
    }
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return false;
  }
}

/** `EnemyTurretBuilder` — construction projectile: eats any bullet it
 * touches; builds turrets one frame per contact (docs 07 §6.1). */
export class EnemyTurretBuilder extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, target: TankLike | null) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: true, bulletRadius: 6, target });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    for (const other of this.field.bullets) {
      if (other.readyForDelete || other === this) continue;
      const r = this.bulletRadius * this.scale + other.bulletRadius * other.scale / 2;
      if ((this.x - other.x) ** 2 + (this.y - other.y) ** 2 < r * r) {
        if (other instanceof EnemyTurret) other.builtFrames++;
        other.readyForDelete = true;
        this.spawnPuff(this.x, this.y);
        return true;
      }
    }
    if (this.rotateTowardTarget && this.target) {
      this.setMovement(this.rotateToward());
    }
    if (this.testForCollision()) return true;
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return this.isOutsideOfBubble();
  }
}

// -------------------------------------------------- sapper / healer beams

/** `_-Jp` — sapper orb: ping-pongs avatar ↔ master; steals 2 life per master
 * visit (capped); destroyed by any player bullet (docs 07 §6.6). */
export class SapperOrb extends Bullet {
  private targetState: 1 | 2 = 1;
  private maxMasterLife = -1;
  private readonly master: TankLike;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, master: TankLike, target: TankLike | null) {
    super(x, y, rotation, speed, damage, { scale, isEnemy: true, bulletRadius: 7, target, rotateTowardTarget: true });
    this.master = master;
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (!this.master.alive) return true; // master gone → self-destruct
    const goal = this.targetState === 1 ? this.target : this.master;
    if (!goal || !goal.alive) {
      this.targetState = this.targetState === 1 ? 2 : 1;
      return false;
    }
    this.rotation = atan2Deg(goal.y - this.y, goal.x - this.x);
    this.setMovement(this.rotation);
    if (this.seekerBulletScan()) return true;
    const d = Math.sqrt((goal.x - this.x) ** 2 + (goal.y - this.y) ** 2);
    if (d < 5 + goal.numRadius) {
      if (this.targetState === 1) {
        if (!goal.shielded) goal.damage(this.damage, this);
        this.targetState = 2;
      } else {
        if (this.maxMasterLife < 0) this.maxMasterLife = this.master.data.numLife;
        this.master.addLife(2);
        if (this.master.intTankLife > this.maxMasterLife) this.master.intTankLife = this.maxMasterLife;
        this.targetState = 1;
      }
    }
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return this.isOutsideOfBubble();
  }
}

/** `HealerBeam` — healer-behavior beam: extends to the wall, heals the
 * patient 1 HP per 10 frames of contact (docs 07 §4). */
export class HealerBeam extends Bullet {
  private healCounter = 0;
  private width = 0;
  private readonly owner: TankLike;
  constructor(x: number, y: number, rotation: number, scale: number, damage: number, owner: TankLike, target: TankLike | null) {
    super(x, y, rotation, 0, damage, { scale, isEnemy: false, bulletRadius: 4, target });
    this.owner = owner;
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (!this.owner.alive || !this.target || !this.target.alive) return true;
    // extend toward the target (3 px per step, capped at the field)
    this.width = Math.min(this.width + 3, this.field.fieldRadius);
    this.rotation = atan2Deg(this.target.y - this.y, this.target.x - this.x);
    const dist = Math.sqrt((this.target.x - this.x) ** 2 + (this.target.y - this.y) ** 2);
    const touching = this.width >= dist && dist - this.target.numRadius < this.width;
    if (touching && ++this.healCounter >= 10) {
      this.healCounter = 0;
      this.target.addLife(this.damage);
    }
    this.syncView();
    return false;
  }
}

// ---------------------------------------------------------------- seekers

/** `_-XV` — friendly seeker: nearest-enemy acquisition; no enemies → removes
 * itself with the seeker explosion (docs 08 §3.1). */
export class FriendlySeeker extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, target: TankLike | null) {
    super(x, y, rotation, speed, damage, {
      scale,
      isEnemy: false,
      bulletRadius: 7,
      target,
      seeker: true,
      destroyable: true,
      rotateTowardTarget: true,
    });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (!this.target || !this.target.alive) this.acquireNearestEnemy();
    if (!this.target) {
      this.readyForDelete = true;
      this.spawnPublicPuff();
      return true;
    }
    if (this.seekerBulletScan()) return true;
    return super.moveBullet();
  }

  private acquireNearestEnemy(): void {
    const field = this.field;
    if (!field) return;
    let best: TankLike | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const enemy of field.targets.enemies) {
      if (!enemy.alive) continue;
      const d = (enemy.x - this.x) ** 2 + (enemy.y - this.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = enemy;
      }
    }
    this.target = best;
  }
}

/** `_-U4` — infector seeker: infects the enemy it hits (DoT via the tank's
 * infection tick; infected death spawns 2 more via `Tank.die`) (docs 06 §4
 * table, 08 §2.3). */
export class InfectorSeeker extends Bullet {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, target: TankLike | null) {
    super(x, y, rotation, speed, damage, {
      scale,
      isEnemy: false,
      bulletRadius: 7,
      target,
      seeker: true,
      destroyable: true,
      rotateTowardTarget: true,
    });
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    if (!this.target || !this.target.alive) this.acquireNearestEnemy();
    if (!this.target) {
      this.readyForDelete = true;
      this.spawnPublicPuff();
      return true;
    }
    if (this.seekerBulletScan()) return true;
    return super.moveBullet();
  }

  private acquireNearestEnemy(): void {
    const field = this.field;
    if (!field) return;
    let best: TankLike | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const enemy of field.targets.enemies) {
      if (!enemy.alive) continue;
      const d = (enemy.x - this.x) ** 2 + (enemy.y - this.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = enemy;
      }
    }
    this.target = best;
  }

  protected override onHitTank(tank: TankLike): void {
    super.onHitTank(tank);
    tank.infectMe();
  }
}

/** `_-JX` — orbital seeker: orbits its owner (proportional steer outside the
 * ring, pin + 5°/frame spin inside), engages targets within 100 px, dies with
 * its owner (docs 08 §3.1). */
export class OrbitalSeeker extends Bullet {
  private readonly ringRadius: number;
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, home: TankLike | null, ringRadius: number) {
    super(x, y, rotation, speed, damage, {
      scale,
      isEnemy: !home?.isAvatar,
      bulletRadius: 6,
      homeTank: home,
      seeker: true,
      destroyable: true,
      rotateTowardTarget: true,
    });
    this.ringRadius = ringRadius;
  }

  protected override moveBullet(): boolean {
    if (!this.active || !this.field) return false;
    const home = this.homeTank;
    if (!home || !home.alive) {
      this.readyForDelete = true;
      this.spawnPublicPuff();
      return true;
    }
    // target acquisition `_ -26`: first opposing tank within 100 px of the rim
    if (!this.target || !this.target.alive) {
      const pool = home.isAvatar ? this.field.targets.enemies : [this.field.avatar, ...this.field.targets.allies];
      for (const t of pool) {
        if (!t || !t.alive) continue;
        const d = Math.sqrt((t.x - this.x) ** 2 + (t.y - this.y) ** 2);
        if (d - home.numRadius < 100) {
          this.target = t;
          break;
        }
      }
    }
    if (this.target && this.target.alive) {
      if (this.seekerBulletScan()) return true;
      this.rotation = atan2Deg(this.target.y - this.y, this.target.x - this.x);
      this.setMovement(this.rotation);
      if (this.testForCollision()) return true;
    } else {
      // orbit behavior
      const toHome = atan2Deg(home.y - this.y, home.x - this.x);
      const d = Math.sqrt((home.x - this.x) ** 2 + (home.y - this.y) ** 2);
      if (d > this.ringRadius + 20) {
        const delta = wrapDeg(toHome - this.rotation);
        this.rotation = wrapDeg(this.rotation + delta / 20);
      } else {
        // pinned to the ring: tangential spin
        this.rotation = wrapDeg(toHome + 90);
        const px = home.x + Math.cos(toHome * (Math.PI / 180)) * this.ringRadius;
        const py = home.y + Math.sin(toHome * (Math.PI / 180)) * this.ringRadius;
        this.x = px;
        this.y = py;
      }
      this.setMovement(this.rotation);
      if (this.seekerBulletScan()) return true;
    }
    this.x += this.moveX;
    this.y += this.moveY;
    this.syncView();
    return this.isOutsideOfBubble();
  }
}

// ---------------------------------------------------------- conversions

/** Drone-converter output shell (`_-XV` conversion spawn: spd 10, dmg 15). */
export class ConvertedSeeker extends FriendlySeeker {
  constructor(x: number, y: number, rotation: number, scale: number, speed: number, damage: number, target: TankLike | null, friendly: boolean) {
    super(x, y, rotation, scale, speed, damage, target);
    // side flips for the (dead-code) enemy-side conversion branch
    this.isEnemy = !friendly;
  }
}
