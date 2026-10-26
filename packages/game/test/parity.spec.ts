/**
 * M6 — parity & tests (docs 11 §5.6): the constant audit against the
 * dossier's decompiled values, a performance smoke at the documented entity
 * counts, and the save-file compatibility golden.
 */

import { describe, expect, it } from "vitest";
import * as C from "../src/core/constants.js";
import { BubbleField } from "../src/world/BubbleField.js";
import { GameWorld } from "../src/world/GameWorld.js";
import { Tank, TANK_TYPE } from "../src/entities/Tank.js";
import { TankData } from "../src/tanks/TankData.js";
import { PlayerProfile, compressToBase64, decompressFromBase64 } from "../src/data/profile.js";
import { AVATAR_PRESETS, ENEMY_BANK } from "../src/data/tanks.js";
import { EnemySeekerBullet, ShellBullet } from "../src/entities/bullets/Bullet.js";

describe("constant audit (docs 03/06/07/08 decompiled values)", () => {
  it("stage + timing", () => {
    expect(C.STAGE_WIDTH).toBe(550);
    expect(C.STAGE_HEIGHT).toBe(450);
    expect(C.STAGE_CENTER_X).toBe(275);
    expect(C.STAGE_CENTER_Y).toBe(225);
    expect(C.FPS_OPTIONS).toEqual([35, 50, 65]);
    expect(C.DEFAULT_FPS).toBe(50);
    expect(C.STAGE_COLOR).toBe("#142b2c");
  });

  it("avatar velocity model (docs 03 §4b)", () => {
    expect(C.ACCEL).toBe(0.6); // _-Zp
    expect(C.MAX_VELOCITY).toBe(6); // _-KR
    expect(C.AVATAR_FRICTION).toBe(0.09);
    expect(C.FRICTION_SNAP).toBe(0.5);
    expect(C.STICKY_SPEED_MULT).toBe(0.3);
    expect(C.STICKY_FRAMES).toBe(80);
  });

  it("field + wall radii (docs 03 §2, 08 §2.4)", () => {
    expect(C.FIELD_RADIUS).toBe(423.75);
    expect(C.TANK_WALL_RADIUS).toBe(423.75);
    expect(C.BULLET_WALL_RADIUS).toBe(415);
    expect(C.BULLET_WALL_RADIUS_SQ).toBe(172225); // 415²
  });

  it("transit geometry (docs 03 §2, BTAGameWorld.as)", () => {
    expect(C.TRANSIT_STEP_DIVISOR).toBe(10);
    expect(C.TRANSIT_STEP_FACTOR).toBe(0.9); // step = dist/10*0.9
    expect(C.TRANSIT_ARRIVE_DIST_SQ).toBe(25); // arrival < 5 px
  });

  it("status effects (docs 03 §4, 07 §6.5)", () => {
    expect(C.JAM_FRAMES).toBe(80);
    expect(C.WEAKEN_FRAMES).toBe(80);
    expect(C.INK_FRAMES).toBe(120);
    expect(C.INFECT_PERIOD).toBe(12); // 1 dmg / 12 frames
    expect(C.FORCEFIELD_CAPACITY).toBe(40);
    expect(C.FORCEFIELD_BREAK_DAMAGE).toBe(55);
    expect(C.FORCEFIELD_REGEN_PERIOD).toBe(20);
  });

  it("progression (docs 04 §4.6, AvatarInterface.as:1059-1086)", () => {
    expect(C.TANK_LEVEL_LIFE).toEqual([50, 100, 170, 250, 400, 800, 2000]);
    expect(C.LEVELUP_SPAWN_DIVISOR).toBe(75); // numLife/75 + 1 sliver
  });

  it("enemy steering (docs 07 §3.3)", () => {
    expect(C.ENEMY_TURN_CHANCE_PER_FRAME).toBe(20);
    expect(C.ENEMY_TURN_RATE).toBe(1.5);
    expect(C.ENEMY_RIM_FRACTION).toBe(0.75);
    expect(C.ENEMY_FORCE_DECAY).toBe(0.9);
  });

  it("life bubbles (docs 08 §5)", () => {
    expect(C.LIFE_BUBBLE_SMALL).toBe(1);
    expect(C.LIFE_BUBBLE_MEDIUM).toBe(5);
    expect(C.LIFE_BUBBLE_LARGE).toBe(50);
    expect(C.BUBBLE_MAGNET_BASE_RADIUS).toBe(100);
    expect(C.BUBBLE_MAGNET_MAX_SPEED).toBe(7);
    expect(C.BUBBLE_MAGNET_FORCED_SPEED).toBe(14);
    expect(C.BUBBLE_COLLECT_DIST).toBe(10);
    expect(C.BUBBLE_PICKUP_RADIUS_SQ).toBe(10000);
  });

  it("identity + storage keys (docs 05 §4)", () => {
    expect(C.STORAGE_KEY_SETTINGS).toBe("BTA");
    expect(C.STORAGE_KEY_PROFILE).toBe("Player1Profile");
    expect(C.PROFILE_FIELD).toBe("strCompressed");
    expect(C.LOCAL_ID_START).toBe(10000001);
    expect(C.VERSION_TEXT).toBe("1.03.3");
  });

  it("built-in bank sizes (docs 05 §2: 31 avatars, 43 enemies, 1 boss)", () => {
    expect(AVATAR_PRESETS.length).toBe(31);
    expect(ENEMY_BANK.length).toBe(43);
  });
});

describe("save-file compatibility golden (docs 05 §4.2)", () => {
  it("serializes the exact 9-field ~-joined payload shape", () => {
    const p = new PlayerProfile(AVATAR_PRESETS, ENEMY_BANK, null);
    const fields = p.serialize().split("~");
    expect(fields).toHaveLength(9);
    // fields 3-7 are the fixed bookkeeping literals; field 8 = progression
    expect(fields.slice(3, 8)).toEqual(["false", "false", "0", "false", "false"]);
    expect(fields[8]).toBe("");
  });

  it("the zlib+base64 envelope survives a real compress/uncompress cycle", async () => {
    const p = new PlayerProfile(AVATAR_PRESETS, ENEMY_BANK, null);
    p.previousTankProgression = "deadheadcode123";
    const envelope = await compressToBase64(p.serialize());
    // base64 alphabet check (standard A-Za-z0-9+/ — docs 05 §4.2)
    expect(envelope).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const back = await decompressFromBase64(envelope);
    expect(back.split("~")[8]).toBe("deadheadcode123");
  });
});

describe("performance smoke (docs 11 §5.6: 50 fps with 40+ entities)", () => {
  it("a dense field (40+ enemies + 60 bullets) simulates 300 frames well under budget", () => {
    const field = new BubbleField({ scale: 1, col: 0, row: 0 });
    const avatar = new Tank(new TankData(), TANK_TYPE.AVATAR, field);
    field.avatar = avatar;
    // 44 enemies (the full built-in bank, thrice reused) + a wall of bullets
    for (let i = 0; i < 44; i++) {
      const data = new TankData();
      data.importTankCode(ENEMY_BANK[i % ENEMY_BANK.length]!.strTankCode);
      const enemy = new Tank(data, TANK_TYPE.ENEMY, field);
      enemy.x = Math.cos((i / 44) * Math.PI * 2) * 200;
      enemy.y = Math.sin((i / 44) * Math.PI * 2) * 200;
      field.addEnemy(enemy);
    }
    for (let i = 0; i < 30; i++) {
      field.spawnBulletFromField(new ShellBullet(i % 200 - 100, (i * 7) % 200 - 100, i * 12, 1, 10, 1));
      field.spawnBulletFromField(new EnemySeekerBullet(i % 200 - 100, (i * 11) % 200 - 100, i * 7, 1, 5, 2, avatar));
    }
    expect(field.enemies.length).toBe(44);
    expect(field.bullets.length).toBe(60);

    const start = performance.now();
    for (let i = 0; i < 300; i++) field.run();
    const ms = performance.now() - start;
    // 300 frames = 6 s of sim at 50 fps; the loop must simulate faster than
    // real time with headroom (budget: 3 s for 6 s of simulation)
    expect(ms).toBeLessThan(3000);
  });
});
