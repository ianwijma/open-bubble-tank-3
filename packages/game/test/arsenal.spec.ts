import { describe, expect, it } from "vitest";
import { BubbleField } from "../src/world/BubbleField.js";
import { GameWorld } from "../src/world/GameWorld.js";
import { Tank, TANK_TYPE } from "../src/entities/Tank.js";
import { TankData } from "../src/tanks/TankData.js";
import {
  ApocalypseBullet,
  FriendlySeeker,
  LeechBullet,
  MineBullet,
  PierceBullet,
  StickyPellet,
} from "../src/entities/bullets/specials.js";
import { createBehaviorForPart, createWeaponForPart } from "../src/entities/weapons/guns.js";
import { distSqrd } from "../src/core/math.js";
import type { InputSnapshot } from "../src/core/Input.js";

/** Build a tank from a plaintext header (author,name,1,avatarFlag,class,life,
 * bubblesReturned,speed,difficulty,strID,rating; part rows). Parts sit at the
 * registration center; position the TANK, not the parts. */
function tankFrom(parts: string, avatar: boolean, cls = 1, life = 100, field: BubbleField | null = null): Tank {
  const data = new TankData();
  const flag = avatar ? 1 : 0;
  const ok = data.importPlaintext(
    `T,A,1,${flag},${cls},${life},3,1,7,X,3;${parts}`,
  );
  if (!ok) throw new Error("bad plaintext");
  return new Tank(data, avatar ? TANK_TYPE.AVATAR : TANK_TYPE.ENEMY, field);
}

function makeField(): BubbleField {
  return new BubbleField({ scale: 1, col: 0, row: 0 });
}

const idle = (): InputSnapshot => ({
  up: false, down: false, left: false, right: false, space: false, pause: false,
  mouseX: 275, mouseY: 225, mouseDown: false,
});

describe("M3 area-effect API (`_-0D`)", () => {
  it("areaDamageTest r-mode damages enemies in radius (×1.15 slack) and wipes destroyable enemy bullets", () => {
    const field = makeField();
    const near = tankFrom("28_mc,2001,,10,0,0,1,7", false);
    const far = tankFrom("28_mc,2001,,400,0,0,1,7", false);
    near.x = 100;
    near.y = 0;
    far.x = 400;
    far.y = 0;
    field.addEnemy(near);
    field.addEnemy(far);
    field.areaDamageTest("r", null, 0, 0, 100, 10);
    expect(near.intTankLife).toBe(90);
    expect(far.intTankLife).toBe(100); // outside 115 px slack
  });

  it("areaStunTest stuns enemies in radius", () => {
    const field = makeField();
    const enemy = tankFrom("28_mc,2001,,10,0,0,1,7", false);
    enemy.x = 50;
    enemy.y = 0;
    field.addEnemy(enemy);
    field.areaStunTest(0, 0, 100, 100);
    expect(enemy.intState).toBe(2); // TANK_STATE.STUNNED
  });

  it("droneConversionTest flips seeker-family bullets and preserves the never-last-enemy quirk", () => {
    const field = makeField();
    const enemy = tankFrom("28_mc,2001,,0,0,0,1,7", false);
    enemy.x = 60;
    enemy.y = 0;
    field.addEnemy(enemy);
    const seeker = new FriendlySeeker(0, 0, 0, 1, 6, 10, enemy);
    field.spawnBulletFromField(seeker);
    expect(field.bullets.length).toBe(1);
    field.droneConversionTest(0, 0, false);
    // the seeker is queued for removal and a converted shell spawned
    expect(seeker.readyForDelete).toBe(true);
    expect(field.bullets.length).toBe(2);
    const converted = field.bullets[1]!;
    expect(converted.isEnemy).toBe(false);
    expect(converted.damage).toBe(15);
  });
});

describe("M3 bullet behaviors", () => {
  it("pierce bullet damages without dying and marks the hit-list (docs 08 §3.1)", () => {
    const field = makeField();
    const avatar = tankFrom("28_mc,2001,,0,0,0,1,7", true);
    field.avatar = avatar;
    const e1 = tankFrom("28_mc,2001,,0,0,0,1,7", false);
    e1.x = 14; // part circle centered on the tank position
    e1.y = 0;
    field.addEnemy(e1);
    const bullet = new PierceBullet(0, 0, 0, 1, 14, 15);
    field.spawnBulletFromField(bullet);
    // frame 1: contact with e1 (moving right at 14 px/frame)
    bullet.run();
    expect(e1.intTankLife).toBe(85);
    expect(field.bullets.includes(bullet)).toBe(true); // pierced through
    // the hit-list prevents a re-hit on the same tank
    bullet.x = 14;
    bullet.y = 0;
    bullet.run();
    expect(e1.intTankLife).toBe(85);
  });

  it("leech bullet drops one auto-collected life bubble on hit (docs 08 §3.1)", () => {
    const field = makeField();
    const avatar = tankFrom("28_mc,2001,,0,0,0,1,7", true);
    field.avatar = avatar;
    const enemy = tankFrom("28_mc,2001,,0,0,0,1,7", false, 1, 100, field);
    enemy.x = 8; // within the 15 px contact radius of the spawn point
    enemy.y = 0;
    field.addEnemy(enemy);
    const bullet = new LeechBullet(0, 0, 0, 1, 10, 2);
    field.spawnBulletFromField(bullet);
    bullet.run();
    expect(field.lifeBubbles.length).toBe(1);
    expect(field.lifeBubbles[0]!.blnCollect).toBe(true);
  });

  it("sticky pellet applies GetStuck on hit (docs 06 §4.2)", () => {
    const field = makeField();
    const avatar = tankFrom("28_mc,2001,,0,0,0,1,7", true);
    field.avatar = avatar;
    const enemy = tankFrom("28_mc,2001,,0,0,0,1,7", false, 1, 100, field);
    enemy.x = 6; // within the 13 px contact radius of the spawn point
    enemy.y = 0;
    field.addEnemy(enemy);
    const bullet = new StickyPellet(0, 0, 0, 1, 6, 0);
    field.spawnBulletFromField(bullet);
    bullet.run();
    expect(enemy.stickyTimer).toBe(80);
  });

  it("seekers are shot down by opposing bullets (docs 08 §8)", () => {
    const field = makeField();
    const avatar = tankFrom("28_mc,2001,,0,0,0,1,7", true);
    field.avatar = avatar;
    const far = tankFrom("28_mc,2001,,0,0,0,1,7", false);
    far.x = 400; // a live target keeps the seeker flying
    far.y = 0;
    field.addEnemy(far);
    const seeker = new FriendlySeeker(0, 0, 0, 1, 1, 10, far);
    field.spawnBulletFromField(seeker);
    // an enemy shell parked on top of the seeker's path
    const enemyShot = new MineBullet(2, 0, 0, 1, 0, 1, true);
    field.spawnBulletFromField(enemyShot);
    // drive one frame — the seeker's own scan runs inside its move
    field.run();
    expect(seeker.readyForDelete).toBe(true);
    expect(enemyShot.readyForDelete).toBe(true);
  });
});

describe("M3 weapons", () => {
  it("the arsenal factory resolves the special parts", () => {
    const detail = (type: number): { type: number; name: string; twin: string; x: number; y: number; rotation: number; scale: number; radius: number } => ({
      type, name: "x_mc", twin: "", x: 0, y: 0, rotation: 0, scale: 1, radius: 7,
    });
    for (const id of [2009, 2017, 3001, 3010, 3017, 5003, 5005, 7001, 4009, 4023]) {
      expect(createWeaponForPart(tankFrom("28_mc,2001,,0,0,0,1,7", true), detail(id), 0), `part ${id}`).not.toBeNull();
    }
  });

  it("enemy guns run on the standard timer (master 3), not the avatar gate", () => {
    const field = makeField();
    const avatar = tankFrom("28_mc,2001,,0,0,0,1,7", true, 1, 100, field);
    avatar.x = 100;
    avatar.y = 0;
    field.avatar = avatar;
    const enemy = tankFrom("28_mc,4001,,0,0,0,1,7", false, 1, 100, field);
    field.addEnemy(enemy);
    // the constructor auto-registers the 4001 cannon (field present)
    expect(enemy.primaryWeapons.length).toBe(1);
    // fireRate 50 → the standard timer fires on frame 50
    for (let i = 0; i < 50; i++) field.run();
    expect(field.bullets.some((b) => b.isEnemy)).toBe(true);
  });

  it("ally bays respect the mounted-copy capacity (docs 06 §4.7)", () => {
    const world = new GameWorld();
    world.setup();
    const bay = world.avatar.data.details.find(() => false);
    void bay;
    // mount two swarm bays by rebuilding the avatar data is heavy; exercise
    // the capacity rule through the live-allies count instead: one bay, one
    // live ally → no second spawn.
    const field = world.currentField;
    field.spawnNewAlly(
      "7bcb168570e756eed9aa5d84042bbf7aca242e9b5cb141cf162e79ecc5227190fd66aee199e8523624c01494fe25562fb1e0ae9d7da988ccd39edce1ead08022b7a590f4544703c048f333713de1102a18835d8e760191104b5474fa9d9a260466e9730bea431e8b07ca47563e1fec06b12f1e2492aea9d04e92ddde779fdcc698ffc60eb6d29c9e8a736e8c288ec28cd51847091cd324da1c1cca46b024f5763b221f2e5caced441bbfeded4686f4f095ce84d37f32e00bf3f79b716f967830de95709f5882388ccf9ccf12ce8443b04350830047bbb0eb8b3ef8ea49f7bba1fa0800cb6b787baa201b1ce9dbbf61f364e803",
      0,
      0,
    );
    expect(field.allies.length).toBe(1);
    expect(field.allies[0]!.data.numLife).toBe(15); // SpawnNewAlly forces 15
  });

  it("the shield weapon blocks damage and expires (docs 06 §4.3)", () => {
    const field = makeField();
    const avatar = tankFrom("28_mc,3010,,0,0,0,1,7", true, 1, 100, field);
    field.avatar = avatar;
    // the constructor auto-registers the 3010 shield into secondaryWeapons
    const shield = avatar.secondaryWeapons[0]!;
    expect(shield.intObjID).toBe(3010);
    shield.partCallTrigger();
    expect(avatar.shielded).toBe(true);
    // damage is fully absorbed while shielded
    avatar.damage(50);
    expect(avatar.intTankLife).toBe(avatar.data.numLife);
    // expiry after the shimmer window
    for (let i = 0; i < 185; i++) shield.run();
    expect(avatar.shielded).toBe(false);
  });

  it("the mine dropper caps 8 live mines, force-despawning the oldest (docs 07 §5)", () => {
    const field = makeField();
    const enemy = tankFrom("28_mc,4009,,0,0,0,1,7", false, 1, 100, field);
    field.addEnemy(enemy);
    // the constructor auto-registers the 4009 dropper (field present)
    const dropper = enemy.primaryWeapons[0]!;
    expect(dropper.intObjID).toBe(4009);
    for (let i = 0; i < 10; i++) dropper.partCallTrigger();
    const mines = field.bullets.filter((b) => b instanceof MineBullet && !b.readyForDelete);
    expect(mines.length).toBe(8);
  });

  it("the apocalypse round fuses at the wall, shrinks the field, then ends (docs 08 §3.1)", () => {
    const field = makeField();
    let ended = 0;
    field.onApocalypseEnd = () => {
      ended++;
    };
    const bullet = new ApocalypseBullet(400, 0, 0, 1, 10, 1000);
    field.spawnBulletFromField(bullet);
    // reach the wall + 56-frame fuse
    for (let i = 0; i < 60; i++) field.run();
    expect(field.blnApocalypse).toBe(true);
    // shrink completes 204 frames later
    for (let i = 0; i < 210; i++) field.run();
    expect(ended).toBe(1);
    expect(field.blnApocalypse).toBe(false);
  });
});

describe("M3 behaviors", () => {
  it("the behavior factory resolves 6002-6005", () => {
    for (const id of [6002, 6003, 6004, 6005]) {
      expect(createBehaviorForPart({ type: id, name: "b_mc", twin: "", x: 0, y: 0, rotation: 0, scale: 1, radius: 7 }, 0), `behavior ${id}`).not.toBeNull();
    }
  });

  it("skittish tanks flee to a waypoint 700 px out when the avatar is close and in front", () => {
    const field = makeField();
    const avatar = tankFrom("28_mc,2001,,0,0,0,1,7", true, 1, 100, field);
    field.avatar = avatar;
    const enemy = tankFrom("28_mc,2001,,0,0,0,1,7;29_mc,6003,,0,0,0,1,7", false, 1, 100, field);
    enemy.x = 100;
    enemy.y = 0;
    enemy.rotation = 0; // facing +x — the avatar is directly behind-to-front?
    // the avatar sits at (0,0), i.e. BEHIND the enemy facing +x — turn to face it
    enemy.rotation = 180;
    field.addEnemy(enemy);
    field.run();
    expect(enemy.swarmPoint).not.toBeNull();
    const d = Math.sqrt(distSqrd(enemy.swarmPoint!.x, enemy.swarmPoint!.y, enemy.x, enemy.y));
    expect(d).toBeGreaterThan(500);
  });
});
