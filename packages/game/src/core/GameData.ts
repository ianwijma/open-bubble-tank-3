/**
 * GameData — the settings/constants holder (port of `GameData.as` + the
 * persisted "BTA" SharedObject fields, docs 05 §4.1).
 *
 * M1 carries the fields gameplay reads: FPS option, sound/music toggles,
 * screenshake, hotkeys (stubbed fixed), and the allowed-directions list
 * `_ -6N` (["left","right","up","down"] — written at construction,
 * GameData.as:213-217; the `_-1E` permission check passes for all four).
 */

import { DEFAULT_FPS } from "./constants";

export type Direction = "left" | "right" | "up" | "down";

export interface SettingsState {
  quality: string;
  sounds: boolean;
  music: boolean;
  screenShake: boolean;
  fps: number;
}

export class GameData {
  versionTXT = "1.03.3";

  /** `_ -6N` — allowed jump directions (GameData.as:213-217). */
  readonly allowedDirections: Direction[] = ["left", "right", "up", "down"];

  /** Settings mirror of the "BTA" SharedObject. */
  settings: SettingsState = {
    quality: "HIGH",
    sounds: true,
    music: true,
    screenShake: true,
    fps: DEFAULT_FPS,
  };

  /** Hotkeys h1..h6 (W/S/A/D/P/Q); rebinding UI is M5. */
  hotkeys = { hot1: 87, hot2: 83, hot3: 65, hot4: 68, hot5: 80, hot6: 81 };
}
