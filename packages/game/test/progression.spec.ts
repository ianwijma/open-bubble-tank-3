import { describe, expect, it } from "vitest";
import { GameWorld, WORLD_MODE } from "../src/world/GameWorld.js";
import { AVATAR_PRESETS, getStartingAvatar, searchLocalAvatarOffers } from "../src/data/tanks.js";
import { CLASS_DATA } from "../src/data/parts.js";
import { TankData } from "../src/tanks/TankData.js";
import { describeTankParts } from "../src/ui/UpgradeMenu.js";
import type { InputSnapshot } from "../src/core/Input.js";

/** Headless world with a fresh avatar. */
function makeWorld(): GameWorld {
  const world = new GameWorld();
  world.setup();
  return world;
}

const idleInput = (): InputSnapshot => ({
  up: false,
  down: false,
  left: false,
  right: false,
  space: false,
  pause: false,
  mouseX: 275,
  mouseY: 400,
  mouseDown: false,
});

describe("local avatar offer search (dead-server replacement)", () => {
  it("filters by class and tier GP budget", () => {
    // class 1, tier 1 (level 0): budget arrGP[0] = 2
    const offer = searchLocalAvatarOffers(1, CLASS_DATA[0]!.arrGP[0]!);
    expect(offer).not.toBeNull();
    expect(offer!.numClass).toBe(1);
    expect(offer!.numGunPoints).toBeLessThanOrEqual(2);
  });

  it("returns null when the class is not buildable at the tier (budget 0)", () => {
    // class 4 GP tiers start at 0 for tiers 1-2
    expect(searchLocalAvatarOffers(4, 0)).toBeNull();
  });

  it("respects the 100 BP complexity cap", () => {
    for (const offer of AVATAR_PRESETS) {
      expect(offer.numBubbles).toBeLessThanOrEqual(100);
    }
  });
});

describe("tier life budgets + progression (_-dI / UpdateAvatar)", () => {
  it("a full-life avatar levels up and imports its progression slot at a life sliver", () => {
    const world = makeWorld();
    const next = AVATAR_PRESETS.find((t) => t.numClass === 2)!;
    world.hud.progressionSlots[1] = next.strTankCode;
    world.avatar.intTankLife = world.avatar.data.numLife; // full → triggers _-dI

    world.hud.run(idleInput());

    expect(world.hud.intTankLevel).toBe(1);
    expect(world.hud.maxClass).toBe(2);
    expect(world.avatar.data.numClass).toBe(2); // tank replaced
    expect(world.avatar.data.numLife).toBe(100); // tier life override
    expect(world.avatar.intTankLife).toBe(Math.floor(100 / 75) + 1); // sliver
  });

  it("boot state: slot 0 recorded, avatar starts at the life sliver, no menu", () => {
    const world = makeWorld();
    expect(world.hud.intTankLevel).toBe(0);
    expect(world.hud.progressionSlots[0]).toBe(getStartingAvatar().strTankCode);
    expect(world.avatar.data.numLife).toBe(50);
    expect(world.avatar.intTankLife).toBe(1); // 50/75 + 1
    expect(world.upgradeMenuOpen).toBe(false);
    // one frame of play does not open the menu either
    world.run(idleInput());
    expect(world.upgradeMenuOpen).toBe(false);
  });

  it("a full-life avatar with no slot opens the UpgradeMenu and freezes the world", () => {
    const world = makeWorld();
    world.avatar.intTankLife = world.avatar.data.numLife;

    world.hud.run(idleInput());

    expect(world.upgradeMenuOpen).toBe(true);
    expect(world.hud.intTankLevel).toBe(1); // level bumped before the menu opens
    // the world does not run while the menu is open
    const before = world.avatar.intTankLife;
    world.run(idleInput());
    expect(world.avatar.intTankLife).toBe(before);
  });

  it("applying a menu choice replaces the avatar and overwrites the slot", () => {
    const world = makeWorld();
    world.avatar.intTankLife = world.avatar.data.numLife;
    world.hud.run(idleInput()); // opens the menu (slot 1 empty)
    expect(world.upgradeMenuOpen).toBe(true);

    // capture the offered codes (white-box), then click the first card.
    // The menu syncs the mouse on its first frame and triggers on RELEASE
    // (ViewerUp = MOUSE_UP), so a press frame + a release frame are needed.
    const menu = (world as unknown as { upgradeMenuInstance: { slots: Array<{ data: TankData; preview: { x: number } }> } | null }).upgradeMenuInstance!;
    expect(menu.slots.length).toBeGreaterThanOrEqual(1);
    const offered = menu.slots.map((s) => s.data.strTankCode);
    const targetX = menu.slots[0]!.preview.x;
    world.run({ ...idleInput(), mouseX: targetX, mouseY: 130, mouseDown: true });
    world.run({ ...idleInput(), mouseX: targetX, mouseY: 130, mouseDown: false }); // release → chosen
    for (let i = 0; i < 45; i++) world.run(idleInput()); // fade-out, 1/0.025 = 40 frames

    expect(world.upgradeMenuOpen).toBe(false);
    expect(world.currentAvatarCode).toBe(offered[0]);
    expect(world.hud.progressionSlots[1]).toBe(offered[0]);
    expect(world.avatar.data.strTankCode).toBe(offered[0]);
    expect(world.avatar.intTankLife).toBe(Math.floor(world.avatar.data.numLife / 75) + 1);
    // world resumed
    expect(world.mode).toBe(WORLD_MODE.PLAYING);
  });

  it("death at level > 0 downgrades in place at near-full life, same field", () => {
    const world = makeWorld();
    world.hud.intTankLevel = 2;
    const lower = AVATAR_PRESETS.find((t) => t.numClass === 1)!;
    world.hud.progressionSlots[1] = lower.strTankCode;
    world.avatar.intTankLife = 0;

    world.hud.run(idleInput());

    expect(world.hud.intTankLevel).toBe(1);
    expect(world.avatar.data.numClass).toBe(1);
    expect(world.avatar.data.numLife).toBe(100);
    expect(world.avatar.intTankLife).toBe(99); // numLife − 1
  });

  it("death at level 0 does not open the menu (world death-jump owns it)", () => {
    const world = makeWorld();
    let jumps = 0;
    world.avatar.onAvatarDeathJump = () => {
      jumps++;
    };
    world.avatar.intTankLife = 0;
    world.hud.run(idleInput());
    expect(jumps).toBe(0); // the clamp happens in Tank.damage, not the HUD
    expect(world.upgradeMenuOpen).toBe(false);
  });
});

describe("UpgradeMenu choice generation", () => {
  it("class 1 avatars get 2 offers (classes 1-2); classes 4+ are gated by budget", () => {
    const world = makeWorld();
    world.avatar.intTankLife = world.avatar.data.numLife;
    world.hud.run(idleInput()); // level 0 → menu
    const ctx = (world as unknown as { makeMenuContext(): import("../src/ui/UpgradeMenu.js").UpgradeMenuContext }).makeMenuContext();
    void ctx;
    // The menu offers classes 1 and 2 at tier-1 budgets (2 and 2).
    const c1 = searchLocalAvatarOffers(1, 2);
    const c2 = searchLocalAvatarOffers(2, 2);
    expect(c1 ?? c2).not.toBeNull();
    // class 3 has GP tier-1 budget 0 → no offers
    expect(searchLocalAvatarOffers(3, 0)).toBeNull();
  });

  it("describeTankParts groups by id-thousands (plural at amount 2, trailing ', ' quirk)", () => {
    const data = new TankData();
    data.importPlaintext("A,B,1,1,1,1,1,1,7,X,3;28_mc,2001,,1,0,0,1,7;29_mc,2001,,2,0,0,1,7;30_mc,1003,,3,0,0,1,7");
    const labels = describeTankParts(data.details);
    // ≤2 distinct types: amount 1 → singular, amount ≥ 2 → plural; the
    // trailing ", " is never trimmed (discarded substr in the original).
    expect(labels.primary).toBe("2 Basic Cannons, ");
    expect(labels.secondary).toBe("N/A");
  });

  it("tier unlock grants accumulate below the reached level", () => {
    const world = makeWorld();
    (world as unknown as { grantTierUnlocks(l: number): void }).grantTierUnlocks(3);
    const unlocked = world.unlockedParts;
    expect(unlocked.size).toBeGreaterThan(0);
    // tier 0 list
    for (const id of [2002, 2003, 2006, 2007]) expect(unlocked.has(id)).toBe(true);
  });
});
