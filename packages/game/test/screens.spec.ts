import { describe, expect, it } from "vitest";
import { GameWorld, WORLD_MODE } from "../src/world/GameWorld.js";
import type { InputSnapshot } from "../src/core/Input.js";

const idle = (): InputSnapshot => ({
  up: false, down: false, left: false, right: false, space: false, pause: false,
  mouseX: 275, mouseY: 225, mouseDown: false,
});
const click = (x: number, y: number): InputSnapshot => ({ ...idle(), mouseX: x, mouseY: y, mouseDown: true });
const release = (x: number, y: number): InputSnapshot => ({ ...idle(), mouseX: x, mouseY: y });

describe("M5 screens flow", () => {
  it("the main menu blocks the world until Play is clicked", () => {
    const world = new GameWorld();
    world.setup();
    world.showMainMenu();
    expect(world.menu).not.toBeNull();
    const lifeBefore = world.avatar.intTankLife;
    world.run(idle()); // the world does not tick behind the menu
    expect(world.avatar.intTankLife).toBe(lifeBefore);
    // click Play (button at stage center ±90, y 210-254)
    world.run(click(275, 232));
    world.run(release(275, 232));
    expect(world.menu).toBeNull();
    expect(world.mode).toBe(WORLD_MODE.PLAYING);
  });

  it("the pause hotkey toggles on each rising edge (key-down model)", () => {
    const world = new GameWorld();
    world.setup();
    world.run({ ...idle(), pause: true }); // edge → open
    expect(world.pauseMenu).not.toBeNull();
    world.run({ ...idle(), pause: false }); // release — no edge, stays open
    expect(world.pauseMenu).not.toBeNull();
    world.run({ ...idle(), pause: true }); // edge → close
    expect(world.pauseMenu).toBeNull();
    world.run({ ...idle(), pause: false });
    world.run({ ...idle(), pause: true }); // edge → open again
    expect(world.pauseMenu).not.toBeNull();
    world.run({ ...idle(), pause: false });
    world.run({ ...idle(), pause: true }); // edge → close
    expect(world.pauseMenu).toBeNull();
  });

  it("beating the boss field opens the win screen with stats", () => {
    const world = new GameWorld();
    world.setup();
    world.tanksDefeated = 7;
    // complete the current field as a boss field
    world.currentField.isBossField = true;
    world.currentField.onCompleted?.(world.currentField);
    expect(world.winScreen).not.toBeNull();
    world.run(idle()); // the world freezes behind the win screen
    expect(world.winScreen).not.toBeNull();
  });

  it("the first launch shows the start notification, saved launches skip it", () => {
    const world = new GameWorld();
    world.setup();
    world.maybeShowStartNotification();
    expect(world.notification).not.toBeNull();
    world.run(click(275, 225));
    world.run(release(275, 225));
    expect(world.notification).toBeNull();
    expect(world.settings.value.SavedData).toBe(true);
    world.maybeShowStartNotification();
    expect(world.notification).toBeNull(); // seen → skipped
  });

  it("the tank information page lists the avatar's parts", () => {
    const world = new GameWorld();
    world.setup();
    world.run({ ...idle(), pause: true });
    world.run({ ...idle(), pause: false });
    expect(world.pauseMenu).not.toBeNull();
    // open Tank Information (button 4: y 264-304)
    world.run(click(275, 284));
    world.run(release(275, 284));
    expect(world.pauseMenu!.showTankInfo).toBe(true);
  });
});
