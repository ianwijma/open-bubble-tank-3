/**
 * Tank entity — the port of `_-Zx` (tank entity base; docs 03 §4, 07 §3).
 * Avatar (intType 1), ally (2) and enemy (3) tanks all wrap a TankData and
 * own Weapon children; categories register by owner type (docs 05 §2.5).
 *
 * Movement: the avatar does not self-move — the HUD drives world-shift
 * (docs 03 §4b). Allies/enemies wander/steer (EnemyAI subclass).
 *
 * Damage chain (docs 08 §2.3 `_-Zx.Damage`): weaken ×2 → shield absorb →
 * forcefield absorb → life −= dmg → death handling (enemies drop life
 * bubbles). Non-avatar tanks DegradeTank(dmg) — parts visibly pop off.
 */

import { DisplayNode } from "../core/DisplayNode";
import {
  ENEMY_FORCE_DECAY,
  FIELD_RADIUS,
  INFECT_PERIOD,
  JAM_FRAMES,
  STICKY_FRAMES,
  STICKY_SPEED_MULT,
  TANK_WALL_RADIUS,
  WEAKEN_FRAMES,
} from "../core/constants";
import { distSqrd } from "../core/math";
import { getCategory, getClassData, getPart } from "../data/parts";
import { getArtStore } from "../assets/swf/art";
import type { TankData, TankDetail } from "../tanks/TankData";
import type { EffectRequest, FieldContext, TankLike } from "./field-context";
import type { BehaviorPart } from "./weapons/guns";
import { createBehaviorForPart, createWeaponForPart } from "./weapons/guns";
import type { Weapon } from "./weapons/Weapon";

export const TANK_TYPE = { EMPTY: 0, AVATAR: 1, ALLY: 2, ENEMY: 3, PREVIEW: 4 } as const;
export type TankOwnerType = (typeof TANK_TYPE)[keyof typeof TANK_TYPE];

let nextTankId = 1;

export class Tank implements TankLike {
  readonly id = nextTankId++;
  readonly isAvatar: boolean;
  /** `_ -Zx.intType` owner class (1 avatar / 2 ally / 3 enemy). */
  readonly tankType: TankOwnerType;
  readonly data: TankData;

  /** Field-local position (field origin = registration center). */
  x = 0;
  y = 0;
  rotation = 0;
  numRadius = 0;
  intTankLife: number;
  /** 0 idle · 1 active · 2 stunned · 3 dead (docs 07 §3.2). */
  intState = 1;

  /** Knobble movement state (docs 07 §3.3). */
  vecForce = { x: 0, y: 0 };
  swarmPoint: { x: number; y: number } | null = null;
  numSpeed = 1;
  blnSkittish = false;
  blnWallFlower = false;
  blnStationary = false;
  /**
   * Level-0 death: the original clamps life to 1 and forces a deadhead jump.
   * (The avatar's tank level lives on the AvatarInterface and reaches the
   * damage chain via `FieldContext.avatarLevel`.)
   */
  onAvatarDeathJump: (() => void) | null = null;

  // --- Status effects ---
  blnJammed = false;
  protected jamTimer = 0;
  protected stunTimer = 0;
  weakenTimer = 0;
  inkTimer = 0;
  infected = false;
  stickyTimer = -1;
  intHitTimer = -1;
  /** Single-teleport-per-frame flag (`blnOkToTeleport`, docs 06 §4.5). */
  blnOkToTeleport = true;
  /** Forcefield state (passive 5005; re-added in M3). */
  blnForcefielded = false;
  protected forcefieldDamageCount = 0;
  blnShieled = false;

  /** `TankLike.shielded` — the shield bubble blocks all damage/status. */
  get shielded(): boolean {
    return this.blnShieled;
  }
  /** `TankLike.hasForcefield` — the forcefield is currently absorbing. */
  get hasForcefield(): boolean {
    return this.blnForcefielded;
  }

  // --- Weapon arrays (registration mirrors `_-Zx.Register*`) ---
  readonly primaryWeapons: Weapon[] = [];
  readonly secondaryWeapons: Weapon[] = [];
  readonly interfaceParts: Weapon[] = [];
  readonly behaviorParts: BehaviorPart[] = [];

  readonly view: DisplayNode;
  /** Field context (public: the HUD reads the avatar aim point through it). */
  readonly field: FieldContext | null;
  protected readonly partNodes: DisplayNode[] = [];
  /** Death callback (`SetCallback(TankCallback)`). */
  onDeath: ((tank: Tank, bubblesDropped: number) => void) | null = null;
  /** EnemySpawner bookkeeping (mine-layer refs, M2+). */
  blnMineLayer = false;

  private partHidden: boolean[] = [];

  constructor(data: TankData, ownerType: TankOwnerType, field: FieldContext | null = null) {
    this.data = data;
    this.tankType = ownerType;
    this.isAvatar = ownerType === TANK_TYPE.AVATAR;
    this.intTankLife = data.numLife;
    this.numSpeed = data.numSpeed;
    this.field = field;
    this.numRadius = data.getRadius();
    this.view = new DisplayNode(undefined, `tank${this.id}`);
    this.buildParts(data.details);
    if (field) this.registerWeapons(ownerType);
    if (this.isAvatar) this.refreshAvatarStats();
  }

  /**
   * Avatar speed is the class speed multiplier itself, not the tank code's
   * raw speed (docs 05 §2.4: "numSpeed = arrClassData[numClass-1].intSpeed").
   * Enemies keep their creator-slider speed.
   */
  refreshAvatarStats(): void {
    if (!this.isAvatar) return;
    this.numSpeed = getClassData(this.data.numClass).intSpeed;
  }

  get alive(): boolean {
    return this.intState !== TANK_STATE.DEAD;
  }

  /** `_ -ZD()` — the tank's bounding radius (max over mounted parts). */
  get radius(): number {
    return this.numRadius;
  }

  // ------------------------------------------------------------------ build

  private buildParts(details: TankDetail[]): void {
    for (const detail of details) {
      const node = makePartView(detail);
      this.view.addChild(node);
      this.partNodes.push(node);
      this.partHidden.push(false);
    }
    this.refreshPartVisibility();
  }

  /** Register weapons by category + owner type (docs 05 §2.5 `_-Tr` step 3). */
  protected registerWeapons(ownerType: TankOwnerType): void {
    this.data.details.forEach((detail, index) => {
      const category = getCategory(detail.type);
      let slot: Weapon[] | null = null;
      switch (ownerType) {
        case TANK_TYPE.AVATAR:
          if (category === 2) slot = this.primaryWeapons;
          else if (category === 3) slot = this.secondaryWeapons;
          else if (category === 5) slot = this.interfaceParts;
          break;
        case TANK_TYPE.ALLY:
          if (category === 7 || category === 4) slot = this.primaryWeapons;
          break;
        case TANK_TYPE.ENEMY:
          if (category === 4) slot = this.primaryWeapons;
          break;
        default:
          break;
      }
      if (slot) {
        const weapon = createWeaponForPart(this, detail, index);
        if (weapon) {
          slot.push(weapon);
          // Timer model by owner (docs 06 §2.7): 1 avatar / 2 ally / 3 enemy.
          weapon.setup(this, ownerType === TANK_TYPE.AVATAR ? 1 : ownerType === TANK_TYPE.ALLY ? 2 : 3);
          return;
        }
      }
      // Behaviors (category 6) for ally/enemy owner types.
      if (category === 6 && (ownerType === TANK_TYPE.ALLY || ownerType === TANK_TYPE.ENEMY)) {
        const behavior = createBehaviorForPart(detail, index);
        if (behavior) {
          this.behaviorParts.push(behavior);
          behavior.setup(this);
        }
      }
    });
  }

  // -------------------------------------------------------------------- run

  /** `_-Zx.Run` state machine (docs 07 §3.2). */
  run(): void {
    switch (this.intState) {
      case 0: // idle — hit timer tick only
        this.tickHitTimer();
        return;
      case 1:
        this.blnOkToTeleport = true;
        this.move();
        this.tickJam();
        this.runParts();
        this.tickStatusEffects();
        this.tickHitTimer();
        if (!this.isAvatar) this.checkOutside();
        this.syncView();
        return;
      case 2: // stunned — timers only
        this.tickStatusEffects();
        if (--this.stunTimer <= 0) this.intState = 1;
        this.syncView();
        return;
      default:
        return; // dead
    }
  }

  /** Mirror entity state onto the display node. The avatar's clip stays
   * pinned at the stage center (docs 03 §4b: the world slides, the avatar
   * clip does not) — its logical x/y is field-local hit-test bookkeeping
   * only, so only enemies mirror position onto the view. */
  protected syncView(): void {
    if (!this.isAvatar) {
      this.view.x = this.x;
      this.view.y = this.y;
    }
    this.view.rotation = this.rotation;
  }

  /** Movement (allies/enemies); the avatar's movement is HUD/world-driven. */
  protected move(): void {
    // Base class only decays knockback (allies wander via EnemyAI.Move).
    this.decayForce();
  }

  protected decayForce(): void {
    this.vecForce.x *= ENEMY_FORCE_DECAY;
    this.vecForce.y *= ENEMY_FORCE_DECAY;
    if (Math.abs(this.vecForce.x) < 0.1) this.vecForce.x = 0;
    if (Math.abs(this.vecForce.y) < 0.1) this.vecForce.y = 0;
  }

  /** `_-Ta` — run all registered parts (skipped while jammed). */
  protected runParts(): void {
    if (this.blnJammed) return;
    for (const w of this.primaryWeapons) w.run();
    for (const b of this.behaviorParts) b.runBehavior();
    for (const w of this.secondaryWeapons) w.run();
    for (const w of this.interfaceParts) w.run();
  }

  private tickStatusEffects(): void {
    if (this.weakenTimer > 0) this.weakenTimer--;
    if (this.inkTimer > 0) this.inkTimer--;
    // Infection DOT: 1 dmg every 12 frames (docs 08 §2.3 #8).
    if (this.infected && this.frameCount() % INFECT_PERIOD === 0) this.damage(1);
    if (this.stickyTimer > 0) this.stickyTimer--;
    // Forcefield recharge (5005): 1 point / 20 frames once broken (docs 06 §5.5).
    if (!this.blnForcefielded && this.forcefieldDamageCount > 0 && this.frameCount() % 20 === 0) {
      this.forcefieldDamageCount--;
      if (this.forcefieldDamageCount < 40) {
        this.forcefieldDamageCount = 0;
        this.blnForcefielded = true;
      }
    }
  }

  private tickJam(): void {
    if (this.blnJammed && --this.jamTimer <= 0) this.blnJammed = false;
  }

  private tickHitTimer(): void {
    if (this.intHitTimer > 0) this.intHitTimer--;
  }

  /** Frame parity helper (infection/etc. run on the field's frame counter). */
  protected frameCount(): number {
    return this.field?.frameCount ?? 0;
  }

  // ----------------------------------------------------------------- combat

  /** `_-Zx.Damage` — full chain (docs 08 §2.3). */
  damage(dmg: number, _source?: unknown): void {
    if (this.intState === TANK_STATE.DEAD) return;
    // 1. Weakened → ×2
    if (this.weakenTimer > 0) dmg *= 2;
    // 2. Shield (3010) — all damage blocked while the shield clip lives.
    if (this.blnShieled) return;
    // 3. Forcefield (5005) — absorb up to 40, overflow passes through.
    if (this.blnForcefielded) {
      if (this.forcefieldDamageCount + dmg <= 40) {
        this.forcefieldDamageCount += dmg;
        return;
      }
      const overflow = this.forcefieldDamageCount + dmg - 40;
      this.blnForcefielded = false;
      this.forcefieldDamageCount = 55;
      dmg = overflow;
    }
    // 4. Hardened is vestigial in this build (never set; docs 07 §9).
    this.intTankLife -= dmg;
    if (this.intTankLife <= 0) {
      if (this.isAvatar) {
        // `_-Zx.Damage` avatar branch: at tank level 0 the avatar cannot die —
        // life clamps to 1 and the world is forced into a deadhead-field jump
        // (`_-1E(true)`). At level ≥ 1 life stays ≤ 0 and the HUD's `_-dI`
        // downgrades the tank in place next frame (docs 08 §2.3, 04 §6.2).
        if ((this.field?.avatarLevel ?? 0) === 0) {
          this.intTankLife = 1;
          this.onAvatarDeathJump?.();
        }
        return;
      }
      this.die();
      return;
    }
    if (this.isAvatar) {
      if (this.intHitTimer === -1) {
        this.field?.sounds.play("avatarHit");
        this.intHitTimer = 7;
      }
    } else {
      this.degradeTank(dmg);
    }
  }

  addLife(amount: number): void {
    this.intTankLife = Math.min(this.data.numLife, this.intTankLife + amount);
    this.refreshPartVisibility();
  }

  protected die(): void {
    this.intState = TANK_STATE.DEAD;
    const bubbles = this.data.numBubblesReturned;
    if (this.isAvatar) {
      // Avatar death flow is owned by the world (docs 03 §5).
      this.onDeath?.(this, bubbles);
      return;
    }
    if (this.field) {
      // Death branch by intType (docs 08 §2.3 `_-Zx.as:992–1003`):
      //   ally (2)  → sound `_-9w` only — the source plays the "enemy tank
      //               destroyed" sample for allies (verbatim quirk);
      //   enemy (3) → sound `_-AH` + SpawnLifeBubbles; infected enemies also
      //               spawn 2 × `_ -U4` infector seekers in random directions.
      if (this.tankType === TANK_TYPE.ALLY) {
        this.field.sounds.play("allyDeath");
      } else {
        this.field.sounds.play("enemyDeath");
        this.field.spawnLifeBubbles(this.x, this.y, bubbles);
        if (this.infected) this.field.spawnInfectorSeekers(this.x, this.y, 2);
      }
    }
    this.onDeath?.(this, bubbles);
    this.deactivate();
  }

  /** `DegradeTank` — parts visibly pop as HP drops (docs 03 §4). */
  degradeTank(dmg: number): void {
    void dmg;
    this.refreshPartVisibility();
  }

  /**
   * Part visibility = f(life fraction). The original pops individual bubbles;
   * the exact per-part selection isn't in the dossier — the port pops
   * outermost parts first (largest distance from registration), which matches
   * the documented "bubbles vanish as HP drops" behavior.
   */
  protected refreshPartVisibility(): void {
    const count = this.partNodes.length;
    if (count === 0) return;
    const maxLife = Math.max(1, this.data.numLife);
    const fraction = Math.max(0, Math.min(1, this.intTankLife / maxLife));
    const hideCount = Math.min(count - 1, Math.ceil(count * (1 - fraction)));
    // Sort indices by distance from center, descending (outermost first).
    const order = this.data.details
      .map((d, i) => ({ i, d2: d.x * d.x + d.y * d.y }))
      .sort((a, b) => b.d2 - a.d2);
    for (let k = 0; k < count; k++) {
      const entry = order[k];
      if (!entry) continue;
      const hide = k < hideCount;
      this.partHidden[entry.i] = hide;
      const node = this.partNodes[entry.i];
      if (node) node.visible = !hide;
    }
  }

  /**
   * Circle-based port of `hitTestPoint(x, y, true)` (docs 08 §6 port note):
   * any part whose scaled circle contains the point (or overlaps a testing
   * circle of `otherRadius`) is a hit.
   */
  hitTestPoint(px: number, py: number, otherRadius = 0): boolean {
    for (let i = 0; i < this.data.details.length; i++) {
      const d = this.data.details[i];
      const hidden = this.partHidden[i];
      if (!d || hidden) continue;
      // Part position in field-local space: rotate the part offset by the hull.
      const cos = Math.cos(this.rotation * (Math.PI / 180));
      const sin = Math.sin(this.rotation * (Math.PI / 180));
      const ox = d.x * cos - d.y * sin;
      const oy = d.x * sin + d.y * cos;
      const cx = this.x + ox;
      const cy = this.y + oy;
      const r = d.radius * d.scale + otherRadius;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  /**
   * `IsOutside` (base): wall at 423.75 × field scale (`_-Zx.IsOutside`) —
   * tanks pushed past the wall pop and drop their bubbles (docs 07 §3.3).
   */
  protected checkOutside(): void {
    const field = this.field;
    if (!field) return;
    const wall = (field.fieldRadius / FIELD_RADIUS) * TANK_WALL_RADIUS;
    const dist = Math.sqrt(this.x * this.x + this.y * this.y);
    if (dist + this.numRadius / 2 > wall) {
      field.spawnLifeBubbles(this.x, this.y, this.data.numBubblesReturned);
      this.die();
    }
  }

  // ---------------------------------------------------------------- status

  getStuck(frames = STICKY_FRAMES): void {
    this.stickyTimer = frames;
  }

  /**
   * `TankLike.push` — knockback impulse (Ripple Generator / Spike / area
   * push, docs 07 §6.7): applied through `vecForce`, which the movement
   * integrator adds and decays each frame. The avatar routes through the
   * HUD instead (see `AvatarInterface.pushAvatar`).
   */
  push(fx: number, fy: number): void {
    this.vecForce.x += fx;
    this.vecForce.y += fy;
  }

  jamMe(frames = JAM_FRAMES): void {
    if (this.blnForcefielded) return; // jam is a no-op with a forcefield
    this.blnJammed = true;
    this.jamTimer = frames;
    // Avatar weapons get a full re-cooldown; others restart their cycle.
    for (const w of this.primaryWeapons) w.onJammed(this.isAvatar);
    for (const w of this.secondaryWeapons) w.onJammed(this.isAvatar);
    for (const b of this.behaviorParts) b.onJammed(this.isAvatar);
  }

  inkMe(frames = 120): void {
    this.inkTimer = frames;
  }

  stunMe(frames: number): void {
    this.stunTimer = frames;
    this.intState = TANK_STATE.STUNNED;
  }

  weakMe(frames = WEAKEN_FRAMES): void {
    this.weakenTimer = frames;
  }

  infectMe(): void {
    this.infected = true;
  }

  /** `PredictTargetLocation(frames)` — pos + heading·speed·frames (docs 06 §5.3). */
  predictTargetLocation(frames: number): { x: number; y: number } | null {
    if (this.intState === TANK_STATE.DEAD) return null;
    if (this.intState === TANK_STATE.STUNNED) return { x: this.x, y: this.y };
    const rad = this.rotation * (Math.PI / 180);
    return { x: this.x + Math.cos(rad) * this.numSpeed * frames, y: this.y + Math.sin(rad) * this.numSpeed * frames };
  }

  /** `GetClosestDetailToCenterPoint` — part mount closest to registration. */
  getClosestDetailToCenterPoint(): { x: number; y: number } {
    let best = this.data.details[0];
    let bestD2 = best ? distSqrd(best.x, best.y, 0, 0) : 0;
    for (const d of this.data.details) {
      const d2 = distSqrd(d.x, d.y, 0, 0);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = d;
      }
    }
    if (!best) return { x: this.x, y: this.y };
    const cos = Math.cos(this.rotation * (Math.PI / 180));
    const sin = Math.sin(this.rotation * (Math.PI / 180));
    return {
      x: this.x + best.x * cos - best.y * sin,
      y: this.y + best.x * sin + best.y * cos,
    };
  }

  /** Spawn point of a mounted weapon's muzzle, in field-local coordinates. */
  weaponMuzzle(index: number): { x: number; y: number } {
    const detail = this.data.details[index];
    if (!detail) return { x: this.x, y: this.y };
    const cos = Math.cos(this.rotation * (Math.PI / 180));
    const sin = Math.sin(this.rotation * (Math.PI / 180));
    return {
      x: this.x + detail.x * cos - detail.y * sin,
      y: this.y + detail.x * sin + detail.y * cos,
    };
  }

  /** Muzzle effect helper (`AddEffectToQueue`). */
  addEffectAt(node: DisplayNode, x: number, y: number, layer: EffectRequest["layer"], frames: number): void {
    this.field?.addEffect({ node, x, y, layer, randomRotation: false, frames });
  }

  deactivate(): void {
    this.intState = TANK_STATE.DEAD;
    for (const w of [...this.primaryWeapons, ...this.secondaryWeapons, ...this.interfaceParts]) {
      w.finalPartCall();
      w.deactivate();
    }
    for (const b of this.behaviorParts) b.deactivate();
  }
}

export const TANK_STATE = { IDLE: 0, ACTIVE: 1, STUNNED: 2, DEAD: 3 } as const;

/**
 * Part view — real symbol art from the loaded SWF when available
 * (SymbolClass `claType` → character id), else the procedural
 * radial-gradient bubble fallback.
 */
export function makePartView(detail: TankDetail): DisplayNode {
  try {
    const art = getArtStore();
    if (art) {
      const claType = getPart(detail.type)?.claType;
      const cid = art.cidForClaType(claType);
      if (cid !== null) {
        const symbol = art.instantiate(cid);
        if (symbol) {
          // the art is authored at the part's nominal size; scale to the row's
          // scale, and keep the detail's mounting transform
          symbol.scaleX *= detail.scale;
          symbol.scaleY *= detail.scale;
          symbol.x = detail.x;
          symbol.y = detail.y;
          symbol.rotation = detail.rotation;
          symbol.setName(detail.name);
          return symbol;
        }
      }
    }
  } catch {
    // malformed symbol data must never take the world build down — the
    // procedural fallback keeps the game playable (ledger note)
  }
  return proceduralPartView(detail);
}

/**
 * Procedural part view — a bubble shaded with the original's sampled part
 * palette (center colors read from the exported sprite renders):
 * standard bodies #0781b4, dark #05638b, light #32aae4, guns #d2a800.
 */
function proceduralPartView(detail: TankDetail): DisplayNode {
  const node = new DisplayNode((ctx) => {
    const r = Math.max(2, detail.radius * detail.scale);
    const { type } = detail;
    // per-family base/edge colors
    let base = "#0781b4";
    let edge = "#05638b";
    if (type >= 1100 && type <= 1199) {
      base = "#05638b";
      edge = "#034a68";
    } else if (type >= 1200 && type <= 1299) {
      base = "#32aae4";
      edge = "#1d7db3";
    } else if (type >= 1500 && type <= 1599) {
      base = "#05638b";
      edge = "#034a68";
    } else if (type >= 2000 && type <= 4999) {
      // Guns (avatar 2xxx/3xxx, enemy 4xxx): sampled gold #d2a800.
      base = "#d2a800";
      edge = "#9a7a00";
    }
    const grad = ctx.createRadialGradient(-r * 0.32, -r * 0.38, r * 0.12, 0, 0, r);
    grad.addColorStop(0, "rgba(255,255,255,0.8)");
    grad.addColorStop(0.35, base);
    grad.addColorStop(1, edge);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // The bubbles' light rim (reads against the dark water).
    ctx.strokeStyle = "rgba(235,248,252,0.45)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }, `part${detail.type}`);
  node.x = detail.x;
  node.y = detail.y;
  node.scaleX = detail.scale;
  node.scaleY = detail.scale;
  node.rotation = detail.rotation;
  return node;
}
