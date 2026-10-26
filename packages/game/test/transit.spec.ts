/**
 * Transit (world state 2) regression — docs 03 §2 + BTAGameWorld.as.
 *
 * Covers the jump-start/arrival handoff: the world disables the HUD's
 * MoveAvatar at jump start (`_-4v = false`, BTAGameWorld.as:678) and
 * restores it with the game mode on arrival (`_-4v = true` +
 * `_-Up = intCurrentGameMode`, BTAGameWorld.as:1212-1214). Before that
 * handoff was ported, the HUD kept applying a frozen velocity during
 * transit, the fields never converged on the entry marker, and the world
 * stayed in mode 2 forever — controls dead after every jump.
 */

import { describe, expect, it } from "vitest";
import { GameWorld, WORLD_MODE } from "../src/world/GameWorld.js";
import type { InputSnapshot } from "../src/core/Input.js";

const idle = (): InputSnapshot => ({
  up: false, down: false, left: false, right: false, space: false, pause: false,
  mouseX: 275, mouseY: 225, mouseDown: false,
});

/** Drive the world through the main menu into PLAYING. */
function startPlaying(): GameWorld {
  const world = new GameWorld();
  world.setup();
  world.showMainMenu();
  world.run(idle());
  world.run({ ...idle(), mouseX: 275, mouseY: 232, mouseDown: true }); // Play down
  world.run({ ...idle(), mouseX: 275, mouseY: 232 }); // release
  expect(world.menu).toBeNull();
  expect(world.mode).toBe(WORLD_MODE.PLAYING);
  return world;
}

describe("transit: jump start → arrival handoff", () => {
  it("swimming across the wall enters transit and arrival restores PLAYING", () => {
    const world = startPlaying();

    // swim right until the exit trigger fires (the wall is at 423.75px)
    let transitFrame = -1;
    for (let i = 0; i < 600 && transitFrame < 0; i++) {
      world.run({ ...idle(), right: true });
      if (world.mode === WORLD_MODE.TRANSIT) transitFrame = i;
    }
    expect(transitFrame).toBeGreaterThanOrEqual(0);

    // the HUD's motion is gated off during transit (blnMoveAvatar = false):
    // the avatar's field-local position must freeze while the input is held
    const hud = (world as unknown as { hud: { blnMoveAvatar: boolean; vx: number } }).hud;
    expect(hud.blnMoveAvatar).toBe(false);
    const frozenAt = world.avatar.x;
    world.run({ ...idle(), right: true });
    world.run({ ...idle(), right: true });
    expect(world.avatar.x).toBe(frozenAt);

    // release and settle: the transit converges on the entry marker and
    // hands control back within a few dozen frames
    let arrivalFrame = -1;
    for (let i = 0; i < 300 && arrivalFrame < 0; i++) {
      world.run(idle());
      if (world.mode === WORLD_MODE.PLAYING) arrivalFrame = i;
    }
    expect(arrivalFrame).toBeGreaterThanOrEqual(0);
    expect(world.jumping).toBe(false);
    expect((world as unknown as { nextField: unknown }).nextField).toBeNull();
    expect(hud.blnMoveAvatar).toBe(true);

    // the avatar now sits at the new field's entry rim (field-local ∓r)
    expect(Math.abs(Math.abs(world.avatar.x) - world.currentField.fieldRadius)).toBeLessThan(12);

    // controls alive again: input moves the avatar's field-local position
    const x0 = world.avatar.x;
    for (let i = 0; i < 20; i++) world.run({ ...idle(), right: true });
    expect(world.avatar.x).toBeGreaterThan(x0);
  });

  it("the new field's enemies open fire after arrival", () => {
    const world = startPlaying();

    let transitFrame = -1;
    for (let i = 0; i < 600 && transitFrame < 0; i++) {
      world.run({ ...idle(), right: true });
      if (world.mode === WORLD_MODE.TRANSIT) transitFrame = i;
    }
    expect(transitFrame).toBeGreaterThanOrEqual(0);

    let arrivalFrame = -1;
    for (let i = 0; i < 300 && arrivalFrame < 0; i++) {
      world.run(idle());
      if (world.mode === WORLD_MODE.PLAYING) arrivalFrame = i;
    }
    expect(arrivalFrame).toBeGreaterThanOrEqual(0);

    // the generated wave populated the field; give the AI time to engage
    const field = world.currentField;
    expect(field.enemies.length).toBeGreaterThan(0);
    const bullets = field as unknown as { bullets: unknown[] };
    let fired = bullets.bullets.length;
    for (let i = 0; i < 400 && fired === 0; i++) {
      world.run(idle());
      fired = bullets.bullets.length;
    }
    expect(fired).toBeGreaterThan(0);
  });
});
