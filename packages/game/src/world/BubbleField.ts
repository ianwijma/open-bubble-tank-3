/**
 * Bubblefield controller — the port of `_ -0D` (docs 03 §2, 08 §2.5).
 *
 * One arena: a circular field (radius 423.75 × wave SCALE) holding enemies,
 * bullets, allies and life bubbles, updated once per frame in the original's
 * documented order. Completion is tested after the last enemy dies, with a
 * 70-frame delay; leftover bubbles then force-collect (`_-K2`).
 */

import { FIELD_RADIUS } from "../core/constants";
import { DisplayNode } from "../core/DisplayNode";
import { makeExitMarkers, makeFieldBackground } from "../render/art/FieldArt";
import type { EffectRequest, FieldContext, SoundCue, TankLike } from "../entities/field-context";
import type { FieldBullet } from "../entities/field-context";
import { LifeBubble } from "../entities/LifeBubble";
import { Bullet } from "../entities/bullets/Bullet";
import { Tank } from "../entities/Tank";

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
   * STUB (M2): `_ -U4` infector seeker spawns — infected tank death releases
   * `count` seekers in random directions. Verbatim source call
   * (`_-Zx.as:1001-1003`): `SpawnNewBullet(new _-U4, x, y, 1, rand(0,360),
   * 6, 1, false, null, null)` — scale 1, speed 6, damage 1, isEnemy=false
   * (it hunts the dead tank's own kind, spreading infection). The real
   * `_ -U4` bullet class (DoT + re-infection) arrives with the M2 weapon
   * wave; until then this records the intent without spawning a
   * wrong-behaving placeholder.
   */
  spawnInfectorSeekers(_x: number, _y: number, _count: number): void {}

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
