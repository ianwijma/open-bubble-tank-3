/**
 * Bubblefield controller — the port of `_ -0D` (docs 03 §2, 08 §2.5).
 *
 * One arena: a circular field (radius 423.75 × wave SCALE) holding enemies,
 * bullets, allies and life bubbles, updated once per frame in the original's
 * documented order. Completion is tested after the last enemy dies, with a
 * 70-frame delay; leftover bubbles then force-collect (`_-K2`).
 */

import { AREA_RANGE_MULT, FIELD_RADIUS } from "../core/constants";
import { DisplayNode } from "../core/DisplayNode";
import { randInt } from "../core/math";
import { makeExitMarkers, makeFieldBackground } from "../render/art/FieldArt";
import type { EffectRequest, FieldContext, SoundCue, TankLike } from "../entities/field-context";
import type { FieldBullet } from "../entities/field-context";
import { LifeBubble } from "../entities/LifeBubble";
import { Bullet } from "../entities/bullets/Bullet";
import { ConvertedSeeker, InfectorSeeker } from "../entities/bullets/specials";
import { Tank, TANK_TYPE } from "../entities/Tank";
import { EnemyAI } from "../entities/EnemyAI";
import { TankData } from "../tanks/TankData";

const COMPLETION_DELAY_FRAMES = 70;

export interface FieldOptions {
  scale: number;
  col: number;
  row: number;
}

export class BubbleField implements FieldContext {
  readonly view: DisplayNode;
  readonly scale: number;
  readonly col: number;
  readonly row: number;
  frameCount = 0;

  readonly enemies: Tank[] = [];
  readonly allies: Tank[] = [];
  readonly bullets: Bullet[] = [];
  readonly lifeBubbles: LifeBubble[] = [];

  /** `blnBossBubblefield`. */
  isBossField = false;
  /** Set when the field has been cleared forever (["destroyed"] store). */
  destroyed = false;
  completed = false;

  private completionCounter = -1;
  private enemyDeleteQueue: Tank[] = [];
  private allyDeleteQueue: Tank[] = [];
  private bulletRemoveQueue: Bullet[] = [];
  private effects: Array<{ node: DisplayNode; frames: number; onEnd?: () => void; layer: DisplayNode }> = [];
  private shootSoundTimer = -1;
  private collectSoundTimer = -1;
  /** Avatar aim point in field-local space (HUD updates it). */
  avatarAimPoint: { x: number; y: number } | null = null;
  /** Set when the world needs per-frame completion notice. */
  onCompleted: ((field: BubbleField) => void) | null = null;

  // Layer containers (z-order mirrors the original's child ordering).
  readonly bgLayer: DisplayNode;
  private bottomEffectLayer: DisplayNode;
  private lifeBubbleLayer: DisplayNode;
  private enemyLayer: DisplayNode;
  private bulletLayer: DisplayNode;
  private topEffectLayer: DisplayNode;

  /** Back-reference to the avatar (set by the world; may be null mid-jump). */
  avatar: TankLike | null = null;
  /** Sound sink (world wires the real SoundPlayer; tests use a noop). */
  sounds: { play(cue: SoundCue): void } = { play: () => {} };
  /** Screen effects sink (docs 08 §6): shake/flash consumed by the renderer. */
  readonly screen = {
    shake: (_magnitude: number): void => {},
    flash: (): void => {},
  };
  /** World mode mirror (docs 08 §6) — health-readout hides bars in mode 3. */
  worldMode = 0;

  /** `blnApocalypse` (docs 08 §3.1) — active while the death-shrink runs. */
  blnApocalypse = false;
  private apocalypseTimer = 0;
  /** Fired when the death-shrink completes (the world attaches a new field). */
  onApocalypseEnd: (() => void) | null = null;

  constructor(options: FieldOptions) {
    this.scale = options.scale;
    this.col = options.col;
    this.row = options.row;
    this.view = new DisplayNode(undefined, `field_${options.col}_${options.row}`);

    this.bgLayer = new DisplayNode(undefined, "BF_BG");
    this.bottomEffectLayer = new DisplayNode(undefined, "BottomEffectsLayer");
    this.lifeBubbleLayer = new DisplayNode(undefined, "lifeBubbleLayer");
    this.enemyLayer = new DisplayNode(undefined, "enemyLayer");
    this.bulletLayer = new DisplayNode(undefined, "bulletLayer");
    this.topEffectLayer = new DisplayNode(undefined, "TopEffectsLayer");

    this.view.addChild(this.bgLayer);
    this.view.addChild(this.bottomEffectLayer);
    this.view.addChild(this.lifeBubbleLayer);
    this.view.addChild(this.enemyLayer);
    this.view.addChild(this.bulletLayer);
    this.view.addChild(this.topEffectLayer);

    this.bgLayer.addChild(makeFieldBackground(this.scale));
    this.bgLayer.addChild(makeExitMarkers(this.scale));
    this.sounds = { play: () => {} };
  }

  get fieldRadius(): number {
    return FIELD_RADIUS * this.scale;
  }

  get targets(): { avatar: TankLike | null; allies: TankLike[]; enemies: TankLike[] } {
    return { avatar: this.avatar, allies: this.allies, enemies: this.enemies };
  }

  get jumping(): boolean {
    return this.jumpingFlag;
  }
  private jumpingFlag = false;
  setJumping(v: boolean): void {
    this.jumpingFlag = v;
  }

  /** The avatar's tank level (synced by the world; see FieldContext). */
  avatarLevel = 0;

  get frame(): number {
    return this.frameCount;
  }

  // ----------------------------------------------------------------- spawn

  /** `SpawnNewBullet` (docs 08 §2.5) — bookkeeping shared by all gun spawns. */
  spawnBulletFromField(bullet: FieldBullet): void {
    if (this.jumpingFlag) return; // refused mid-jump (`_-5d`)
    (bullet as Bullet).setup(this);
    (bullet as Bullet).active = true;
    this.bulletLayer.addChild(bullet.view);
    this.bullets.push(bullet as Bullet);
    if (!(bullet as Bullet).isEnemy) {
      this.sounds.play("shoot"); // throttled to once per 5 frames (docs 08 §2.5)
      this.shootSoundTimer = 5;
    }
  }

  /** `SpawnLifeBubbles` with the exact denomination split (docs 08 §5.1). */
  spawnLifeBubbles(x: number, y: number, amount: number, autoCollect = false): void {
    const spawn = (value: number): void => {
      const bubble = new LifeBubble(x, y, value, autoCollect);
      bubble.attach(this);
      this.lifeBubbleLayer.addChild(bubble.view);
      this.lifeBubbles.push(bubble);
    };
    let remaining = Math.max(0, Math.round(amount));
    while (remaining >= 50) {
      spawn(50);
      remaining -= 50;
    }
    while (remaining >= 5) {
      spawn(5);
      remaining -= 5;
    }
    while (remaining > 0) {
      spawn(1);
      remaining--;
    }
  }

  /**
   * STUB (M2→M3 implemented): `_ -U4` infector seeker spawns — infected tank
   * death releases `count` seekers in random directions. Verbatim source call
   * (`_-Zx.as:1001-1003`): `SpawnNewBullet(new _-U4, x, y, 1, rand(0,360),
   * 6, 1, false, null, null)` — scale 1, speed 6, damage 1, isEnemy=false
   * (it hunts the dead tank's own kind, spreading infection). Wired to the
   * real `_ -U4` class in M3.
   */
  spawnInfectorSeekers(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = randInt(0, 360);
      this.spawnBulletFromField(new InfectorSeeker(x, y, angle, 1, 6, 1, null));
    }
  }

  /** `SpawnNewAlly` (docs 07 §7.1): code import, `numLife = 15` forced. */
  spawnNewAlly(code: string, x: number, y: number): void {
    const data = new TankData();
    if (!data.importTankCode(code)) return;
    data.numLife = 15;
    const ally = new Tank(data, TANK_TYPE.ALLY, this);
    ally.x = x;
    ally.y = y;
    ally.intState = 1;
    this.addAlly(ally);
  }

  // ------------------------------------------------------------- apocalypse

  /** `beginApocalypse` (docs 08 §3.1) — starts the field death-shrink.
   * The flag is already true during the fuse (set at wall contact), so the
   * guard keys on the shrink timer, not the flag. */
  beginApocalypse(): void {
    if (this.apocalypseTimer > 0) return; // already shrinking
    this.blnApocalypse = true;
    this.apocalypseTimer = 204;
  }

  /** `endApocalypse` — Neutralizer: cancel the shrink, restore the field. */
  endApocalypse(): void {
    this.blnApocalypse = false;
    this.apocalypseTimer = 0;
    this.view.scaleX = 1;
    this.view.scaleY = 1;
  }

  /** `SpawnNewEnemy` (docs 07 §6.4) — Enemy Spawner tank creation. */
  spawnNewEnemy(code: string, x: number, y: number): void {
    const data = new TankData();
    if (!data.importTankCode(code)) return;
    const enemy = new EnemyAI(data, TANK_TYPE.ENEMY, this);
    enemy.x = x;
    enemy.y = y;
    enemy.rotation = randInt(-180, 180);
    this.addEnemy(enemy);
  }

  /** Ticks the 204-frame shrink with escalating shake + random flashes.
   * Runs only while the shrink timer is active — the fuse phase (flag set,
   * timer 0) must not trip the end branch. */
  private runApocalypse(): void {
    if (this.apocalypseTimer <= 0) return;
    this.apocalypseTimer--;
    const t = 1 - this.apocalypseTimer / 204;
    this.view.scaleX = Math.max(0.01, 1 - t);
    this.view.scaleY = this.view.scaleX;
    this.screen.shake(t * 8);
    if (Math.random() < 0.08) this.screen.flash();
    if (this.apocalypseTimer <= 0) {
      this.view.visible = false;
      this.blnApocalypse = false;
      this.onApocalypseEnd?.();
    }
  }

  // ------------------------------------------------------ area-effect API

  /** `_-E6` — IsWithinRange with the ×1.15 slack. */
  private withinRange(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
    return (ax - bx) ** 2 + (ay - by) ** 2 < (radius * AREA_RANGE_MULT) ** 2;
  }

  /**
   * `AreaDamageTest` (docs 08 §4.2). `source` = the excluded tank (the
   * exploding bullet's owner side); origin coordinates are field-local.
   */
  areaDamageTest(
    mode: "r" | "e" | "t",
    source: TankLike | null,
    x: number,
    y: number,
    radius: number,
    damage: number,
    push = false,
  ): void {
    if (mode === "r") {
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy === source) continue;
        if (this.withinRange(enemy.x, enemy.y, x, y, radius)) enemy.damage(damage);
      }
      for (const bullet of this.bullets) {
        // enemy destroyable bullets in radius, measured from the origin
        if (bullet.isEnemy && bullet.destroyable && !bullet.readyForDelete) {
          if (this.withinRange(bullet.x, bullet.y, x, y, radius)) bullet.readyForDelete = true;
        }
      }
      return;
    }
    // "e" / "t": avatar + allies
    const avatar = this.avatar;
    if (avatar && avatar.alive && this.withinRange(avatar.x, avatar.y, x, y, radius)) {
      avatar.damage(damage);
      if (push) {
        const d = Math.sqrt((avatar.x - x) ** 2 + (avatar.y - y) ** 2) || 1;
        const mag = (5 * radius) / (d * d);
        avatar.push(((avatar.x - x) / d) * mag, ((avatar.y - y) / d) * mag);
      }
    }
    for (const ally of this.allies) {
      if (!ally.alive) continue;
      if (!this.withinRange(ally.x, ally.y, x, y, radius)) continue;
      ally.damage(damage);
      if (push) {
        const d = Math.sqrt((ally.x - x) ** 2 + (ally.y - y) ** 2) || 1;
        const mag = ((5 * radius) / (d * d)) * 2; // non-avatar targets at 2×
        ally.push(((ally.x - x) / d) * mag, ((ally.y - y) / d) * mag);
      }
    }
    for (const bullet of this.bullets) {
      if (!bullet.isEnemy && bullet.destroyable && !bullet.readyForDelete) {
        if (this.withinRange(bullet.x, bullet.y, x, y, radius)) bullet.readyForDelete = true;
      }
    }
  }

  /** `AreaStunTest` — stun enemies in radius + burst flash + stun marks. */
  areaStunTest(x: number, y: number, radius: number, duration: number): void {
    this.spawnBurstEffect(x, y, radius);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (this.withinRange(enemy.x, enemy.y, x, y, radius)) enemy.stunMe(duration);
    }
  }

  /** `AreaBurstTest` — plain radius (no slack) vs enemies + enemy bullets. */
  areaBurstTest(x: number, y: number, radius: number, damage: number): void {
    this.spawnBurstEffect(x, y, radius);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if ((enemy.x - x) ** 2 + (enemy.y - y) ** 2 <= radius * radius) enemy.damage(damage);
    }
    for (const bullet of this.bullets) {
      if (bullet.isEnemy && bullet.destroyable && !bullet.readyForDelete) {
        if ((bullet.x - x) ** 2 + (bullet.y - y) ** 2 <= radius * radius) bullet.readyForDelete = true;
      }
    }
  }

  /** Burst flash effect sized to the radius (the original's `_ -5`). */
  private spawnBurstEffect(x: number, y: number, radius: number): void {
    const node = new DisplayNode((ctx) => {
      const grad = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
      grad.addColorStop(0, "rgba(210,245,255,0.55)");
      grad.addColorStop(0.7, "rgba(120,200,235,0.25)");
      grad.addColorStop(1, "rgba(120,200,235,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
    }, "burstFlash");
    this.addEffect({ node, x, y, layer: "TopEffectsLayer", randomRotation: false, frames: 10 });
  }

  /**
   * `DroneConversionTest` (docs 08 §4.5) — every seeker-family bullet of the
   * opposite side is removed and replaced by a homing shell aimed at a random
   * enemy (quirk preserved: the index roll can never pick the last enemy).
   */
  droneConversionTest(x: number, y: number, toEnemySide: boolean): void {
    // snapshot: the converted replacements spawn into `bullets` mid-loop —
    // iterating the live array would convert the conversions forever.
    for (const bullet of [...this.bullets]) {
      if (bullet.isEnemy !== toEnemySide || !bullet.destroyable) continue;
      if (!bullet.rotateTowardTarget) continue;
      if (bullet.readyForDelete) continue;
      bullet.readyForDelete = true;
      const enemies = this.enemies.filter((e) => e.alive);
      // original quirk: floor(random*(len-1)) never selects the last enemy
      const idx = enemies.length > 0 ? Math.floor(Math.random() * (enemies.length - 1)) : -1;
      const target = idx >= 0 ? enemies[idx] ?? null : null;
      const replacement = new ConvertedSeeker(x, y, bullet.rotation, 1, toEnemySide ? 5 : 10, toEnemySide ? 1 : 15, target, !toEnemySide);
      this.spawnBulletFromField(replacement);
    }
  }

  /** `AddEffectToQueue` — timed effect node on a layer. */
  addEffect(request: EffectRequest): void {
    const layerNode =
      request.layer === "BottomEffectsLayer"
        ? this.bottomEffectLayer
        : request.layer === "TopEffectsLayer"
          ? this.topEffectLayer
          : this.topEffectLayer; // ScreenEffectsLayer attaches at world level (M2)
    layerNode.addChild(request.node);
    this.effects.push({
      node: request.node,
      frames: request.frames ?? 30,
      onEnd: request.onEnd,
      layer: layerNode,
    });
  }

  // ------------------------------------------------------------------- run

  /** `_-0D.Run` (docs 08 §2.5). */
  run(): void {
    this.frameCount++;
    // 1. Drain death queues.
    for (const enemy of this.enemyDeleteQueue) this.removeEnemy(enemy);
    this.enemyDeleteQueue.length = 0;
    for (const ally of this.allyDeleteQueue) this.removeAlly(ally);
    this.allyDeleteQueue.length = 0;

    // 2. Tanks.
    for (const enemy of this.enemies) {
      if (enemy.alive) enemy.run();
    }
    for (const ally of this.allies) {
      if (ally.alive) ally.run();
    }

    // 3. Bullets (remove queue or run returns true).
    for (const bullet of this.bullets) {
      if (bullet.readyForDelete || bullet.run()) this.bulletRemoveQueue.push(bullet);
    }
    // 4. Drain.
    for (const bullet of this.bulletRemoveQueue) this.removeBullet(bullet);
    this.bulletRemoveQueue.length = 0;

    // 5. Life bubbles + completion + effects + timers.
    this.lifeBubbleCollisionDetection();
    for (const bubble of this.lifeBubbles) bubble.run();
    this.testForCompletion();
    this.runApocalypse();
    this.tickEffects();
    if (this.shootSoundTimer > 0) this.shootSoundTimer--;
    if (this.collectSoundTimer > 0) this.collectSoundTimer--;
  }

  private tickEffects(): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      if (!effect) continue;
      if (--effect.frames <= 0) {
        effect.onEnd?.();
        effect.layer.removeChild(effect.node);
        this.effects.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------- collection

  /** `LifeBubbleCollisionDetection` + `_-PL` (docs 08 §5.3). */
  private lifeBubbleCollisionDetection(): void {
    const avatar = this.avatar;
    for (let i = this.lifeBubbles.length - 1; i >= 0; i--) {
      const bubble = this.lifeBubbles[i];
      if (!bubble) continue;
      if (bubble.lost) {
        this.lifeBubbleLayer.removeChild(bubble.view);
        this.lifeBubbles.splice(i, 1);
        continue;
      }
      const near =
        bubble.blnCollected ||
        (avatar !== null &&
          avatar.alive &&
          Math.sqrt((avatar.x - bubble.x) ** 2 + (avatar.y - bubble.y) ** 2) < avatar.numRadius);
      if (near && avatar) {
        if (this.collectSoundTimer <= 0) {
          this.sounds.play("collect");
          this.collectSoundTimer = 4;
        }
        avatar.addLife(bubble.amount); // capped at numLife for the avatar
        this.lifeBubbleLayer.removeChild(bubble.view);
        this.lifeBubbles.splice(i, 1);
      }
    }
  }

  /** `_-K2` — force-collect all outstanding bubbles (field completed). */
  forceCollectBubbles(): void {
    for (const bubble of this.lifeBubbles) bubble.blnCollect = true;
  }

  // ------------------------------------------------------------ completion

  /** `TestForCompletion` — last enemy dies → 70-frame delay → completed. */
  private testForCompletion(): void {
    if (this.completed) return;
    if (this.enemies.length === 0) {
      if (this.completionCounter < 0) this.completionCounter = COMPLETION_DELAY_FRAMES;
      if (--this.completionCounter <= 0) {
        this.completed = true;
        this.destroyed = true;
        // Wipe enemy mines + seekers (docs 08 §2.5 TestForCompletion).
        for (const bullet of this.bullets) {
          if (bullet.isEnemy && (bullet.seeker || bullet.isMineLike())) bullet.readyForDelete = true;
        }
        this.forceCollectBubbles();
        this.onCompleted?.(this);
      }
    }
  }

  // ---------------------------------------------------------------- mutate

  addEnemy(enemy: Tank): void {
    this.enemyLayer.addChild(enemy.view);
    this.enemies.push(enemy);
    enemy.onDeath = (tank) => this.enemyDeleteQueue.push(tank);
  }

  addAlly(ally: Tank): void {
    this.enemyLayer.addChild(ally.view);
    this.allies.push(ally);
    ally.onDeath = (tank) => this.allyDeleteQueue.push(tank);
  }

  private removeEnemy(enemy: Tank): void {
    const i = this.enemies.indexOf(enemy);
    if (i !== -1) this.enemies.splice(i, 1);
    enemy.deactivate();
    this.enemyLayer.removeChild(enemy.view);
  }

  private removeAlly(ally: Tank): void {
    const i = this.allies.indexOf(ally);
    if (i !== -1) this.allies.splice(i, 1);
    ally.deactivate();
    this.enemyLayer.removeChild(ally.view);
  }

  removeBullet(bullet: Bullet): void {
    const i = this.bullets.indexOf(bullet);
    if (i !== -1) this.bullets.splice(i, 1);
    bullet.deactivate();
    this.bulletLayer.removeChild(bullet.view);
  }

  /** Snapshot enemy states for the visited-fields store (docs 03 §2). */
  snapshotEnemies(): Array<{ x: number; y: number; rot: number }> {
    return this.enemies.map((e) => ({ x: e.x, y: e.y, rot: e.rotation }));
  }

  /** Remove everything (death reload / teardown). */
  clear(): void {
    for (const enemy of [...this.enemies]) this.removeEnemy(enemy);
    for (const ally of [...this.allies]) this.removeAlly(ally);
    for (const bullet of [...this.bullets]) this.removeBullet(bullet);
    for (const bubble of [...this.lifeBubbles]) {
      this.lifeBubbleLayer.removeChild(bubble.view);
    }
    this.lifeBubbles.length = 0;
    this.effects.length = 0;
  }
}
