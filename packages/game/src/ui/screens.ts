/**
 * Game screens — the in-canvas menu layer (docs 04 §2-§5):
 *
 *   - MainMenu (`_-FF = 2`): title, Play, Settings, version stamp,
 *   - PauseMenu (symbol 1559): Continue / Settings / Quit / Tank Info with
 *     hover captions (docs 04 §5.3 table),
 *   - SettingsPanel: 35/50/65 fps, sounds, music, screen shake (docs 04
 *     §5.5 — quality is render-side and fixed HIGH in the port),
 *   - WinScreen: the boss-beaten screen (docs 03 §3 — win + Boss Badge),
 *   - start notification ("What's New", `_-7W` flag; shown once).
 *
 * All screens are DisplayNode-driven and run from mouse input only.
 */

import { DisplayNode } from "../core/DisplayNode";
import { FPS_OPTIONS, STAGE_CENTER_X, STAGE_CENTER_Y, STAGE_HEIGHT, STAGE_WIDTH, VERSION_TEXT } from "../core/constants";
import type { SettingsStore } from "../data/profile";
import type { InputSnapshot } from "../core/Input";

export interface ScreenInput {
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
}

/** Shared button hit + release-edge bookkeeping. */
abstract class MenuScreen {
  readonly view = new DisplayNode(undefined, "menuScreen");
  protected mouse = { x: 0, y: 0, down: false, prevDown: false };
  closed = false;

  run(input: ScreenInput): void {
    this.mouse.prevDown = this.mouse.down;
    this.mouse.down = input.mouseDown;
    this.mouse.x = input.mouseX;
    this.mouse.y = input.mouseY;
    if (this.closed) return;
    this.tick(input, !input.mouseDown && this.mouse.prevDown);
  }

  protected abstract tick(input: ScreenInput, released: boolean): void;
  abstract draw(ctx: CanvasRenderingContext2D): void;

  protected hit(x: number, y: number, w: number, h: number): boolean {
    return this.mouse.x >= x && this.mouse.x <= x + w && this.mouse.y >= y && this.mouse.y <= y + h;
  }

  protected button(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, hovered: boolean): void {
    ctx.fillStyle = hovered ? "rgba(127,227,238,0.22)" : "rgba(255,255,255,0.08)";
    ctx.beginPath();
    const r = 10;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hovered ? "rgba(127,227,238,0.8)" : "rgba(127,227,238,0.3)";
    ctx.stroke();
    ctx.fillStyle = hovered ? "#dff9fc" : "rgba(223,243,245,0.9)";
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w / 2, y + h / 2 + 6);
    ctx.textAlign = "left";
  }
}

// ---------------------------------------------------------------- main menu

export class MainMenu extends MenuScreen {
  showSettings = false;
  private settings: SettingsPanel | null = null;

  constructor(
    private readonly hasSavedData: boolean,
    private readonly onPlay: () => void,
    private readonly settingsStore: SettingsStore,
  ) {
    super();
    this.view.draw = (ctx) => this.draw(ctx);
  }

  protected tick(input: ScreenInput, released: boolean): void {
    if (this.settings) {
      this.settings.run(input);
      if (this.settings.closed) this.settings = null;
      return;
    }
    if (!released) return;
    if (this.hit(STAGE_CENTER_X - 90, 210, 180, 44)) {
      this.closed = true;
      this.onPlay();
    } else if (this.hit(STAGE_CENTER_X - 90, 266, 180, 44)) {
      this.settings = new SettingsPanel(this.settingsStore);
      this.showSettings = true;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.closed) return;
    ctx.save();
    ctx.fillStyle = "#142b2c";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    // drifting bubble backdrop
    const t = performance.now() / 1000;
    for (let i = 0; i < 14; i++) {
      const x = ((i * 97) % 520) + Math.sin(t * 0.4 + i) * 22;
      const y = ((i * 151) % 430) - ((t * (8 + (i % 5) * 4)) % 480) + 480;
      const r = 6 + (i % 4) * 5;
      ctx.fillStyle = `rgba(120,200,235,${0.05 + (i % 3) * 0.03})`;
      ctx.beginPath();
      ctx.arc(x, ((y % 500) + 500) % 500 - 20, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#dff3f5";
    ctx.font = "bold 46px system-ui, sans-serif";
    ctx.fillText("Bubble Tanks 3", STAGE_CENTER_X, 130);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(223,243,245,0.6)";
    ctx.fillText(`open re-implementation · v${VERSION_TEXT}`, STAGE_CENTER_X, 156);

    if (this.settings) {
      this.settings.draw(ctx);
    } else {
      const pulse = (Math.sin(performance.now() / 400) + 1) / 2;
      ctx.globalAlpha = 0.75 + 0.25 * pulse;
      this.button(ctx, STAGE_CENTER_X - 90, 210, 180, 44, this.hasSavedData ? "Continue" : "Play", this.hit(STAGE_CENTER_X - 90, 210, 180, 44));
      ctx.globalAlpha = 1;
      this.button(ctx, STAGE_CENTER_X - 90, 266, 180, 44, "Settings", this.hit(STAGE_CENTER_X - 90, 266, 180, 44));
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = "rgba(223,243,245,0.45)";
      ctx.fillText("WASD move · mouse aim · click shoot · Space secondaries · P pause", STAGE_CENTER_X, STAGE_HEIGHT - 26);
    }
    ctx.textAlign = "left";
    ctx.restore();
  }
}

// --------------------------------------------------------------- pause menu

export type PauseAction = "resume" | "settings" | "quit" | "tankInfo";

/** PauseMenu (docs 04 §5): the five documented buttons; intState 0 = main
 * buttons, 2 = settings panel. */
export class PauseMenu extends MenuScreen {
  private settings: SettingsPanel | null = null;
  showTankInfo = false;

  constructor(
    private readonly onAction: (action: PauseAction) => void,
    private readonly settingsStore: SettingsStore,
    private readonly tankInfo: string[],
  ) {
    super();
    this.view.draw = (ctx) => this.draw(ctx);
  }

  protected tick(input: ScreenInput, released: boolean): void {
    if (this.settings) {
      this.settings.run(input);
      if (this.settings.closed) this.settings = null;
      return;
    }
    if (this.showTankInfo) {
      if (released && this.hit(STAGE_WIDTH / 2 - 60, STAGE_HEIGHT - 70, 120, 36)) this.showTankInfo = false;
      return;
    }
    if (!released) return;
    const bx = STAGE_CENTER_X - 90;
    if (this.hit(bx, 120, 180, 40)) this.onAction("resume");
    else if (this.hit(bx, 168, 180, 40)) this.settings = new SettingsPanel(this.settingsStore);
    else if (this.hit(bx, 216, 180, 40)) this.onAction("quit");
    else if (this.hit(bx, 264, 180, 40)) this.showTankInfo = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = "rgba(6,14,16,0.8)";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    if (this.settings) {
      this.settings.draw(ctx);
      ctx.restore();
      return;
    }
    if (this.showTankInfo) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#dff3f5";
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.fillText("Tank Information", STAGE_CENTER_X, 110);
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(223,243,245,0.85)";
      this.tankInfo.slice(0, 14).forEach((line, i) => ctx.fillText(line, STAGE_CENTER_X, 145 + i * 17));
      this.button(ctx, STAGE_WIDTH / 2 - 60, STAGE_HEIGHT - 70, 120, 36, "Back", this.hit(STAGE_WIDTH / 2 - 60, STAGE_HEIGHT - 70, 120, 36));
      ctx.textAlign = "left";
      ctx.restore();
      return;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#dff3f5";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText("Paused", STAGE_CENTER_X, 92);
    const bx = STAGE_CENTER_X - 90;
    this.button(ctx, bx, 120, 180, 40, "Continue Playing", this.hit(bx, 120, 180, 40));
    this.button(ctx, bx, 168, 180, 40, "Settings", this.hit(bx, 168, 180, 40));
    this.button(ctx, bx, 216, 180, 40, "Quit Playing", this.hit(bx, 216, 180, 40));
    this.button(ctx, bx, 264, 180, 40, "Tank Information", this.hit(bx, 264, 180, 40));
    ctx.textAlign = "left";
    ctx.restore();
  }
}

// ----------------------------------------------------------- settings panel

/** SettingsPanel (docs 04 §5.5): fps 35/50/65, sounds/music/shake toggles;
 * every change persists through the `BTA` mirror. */
export class SettingsPanel extends MenuScreen {
  constructor(private readonly settings: SettingsStore) {
    super();
    this.view.draw = (ctx) => this.draw(ctx);
  }

  protected tick(_input: ScreenInput, released: boolean): void {
    if (!released) return;
    const v = this.settings.value;
    const row = (y: number): boolean => this.mouse.y >= y - 16 && this.mouse.y <= y + 6;
    // fps radios
    if (row(140)) {
      FPS_OPTIONS.forEach((fps, i) => {
        if (this.hit(240 + i * 70, 124, 50, 24)) this.settings.save({ f: fps });
      });
      return;
    }
    // toggles
    if (row(196) && this.hit(240, 180, 120, 24)) this.settings.save({ s: !v.s });
    else if (row(236) && this.hit(240, 220, 120, 24)) this.settings.save({ m: !v.m });
    else if (row(276) && this.hit(240, 260, 120, 24)) this.settings.save({ ss: !v.ss });
    // back
    if (this.hit(STAGE_WIDTH / 2 - 60, STAGE_HEIGHT - 70, 120, 36)) this.closed = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#dff3f5";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.fillText("Settings", STAGE_CENTER_X, 96);
    const v = this.settings.value;
    ctx.font = "13px system-ui, sans-serif";
    // frame rate radios (35/50/65 — docs 04 §5.5)
    ctx.fillStyle = "rgba(223,243,245,0.85)";
    ctx.fillText("Frame Rate", STAGE_CENTER_X, 132);
    FPS_OPTIONS.forEach((fps, i) => {
      const x = 240 + i * 70;
      const active = v.f === fps;
      ctx.fillStyle = active ? "rgba(127,227,238,0.3)" : "rgba(255,255,255,0.08)";
      ctx.fillRect(x, 124, 50, 24);
      ctx.strokeStyle = active ? "#7fe3ee" : "rgba(127,227,238,0.25)";
      ctx.strokeRect(x, 124, 50, 24);
      ctx.fillStyle = active ? "#dff9fc" : "rgba(223,243,245,0.8)";
      ctx.fillText(String(fps), x + 25, 141);
    });
    // toggles
    const toggle = (label: string, y: number, on: boolean): void => {
      ctx.fillStyle = "rgba(223,243,245,0.85)";
      ctx.textAlign = "right";
      ctx.fillText(label, 230, y + 16);
      ctx.textAlign = "center";
      ctx.fillStyle = on ? "rgba(140,220,140,0.35)" : "rgba(255,120,100,0.25)";
      ctx.fillRect(240, y, 120, 24);
      ctx.strokeStyle = on ? "rgba(140,220,140,0.8)" : "rgba(255,120,100,0.6)";
      ctx.strokeRect(240, y, 120, 24);
      ctx.fillStyle = "#dff9fc";
      ctx.fillText(on ? "On" : "Off", 300, y + 16);
    };
    toggle("Sounds", 180, v.s);
    toggle("Music", 220, v.m);
    toggle("Screen Shake", 260, v.ss);
    this.button(ctx, STAGE_WIDTH / 2 - 60, STAGE_HEIGHT - 70, 120, 36, "Back", this.hit(STAGE_WIDTH / 2 - 60, STAGE_HEIGHT - 70, 120, 36));
    ctx.textAlign = "left";
    ctx.restore();
  }
}

// ----------------------------------------------------------------- win screen

/** The boss-beaten win screen (docs 03 §3: win + Boss Badge). */
export class WinScreen extends MenuScreen {
  constructor(
    private readonly onRestart: () => void,
    private readonly stats: { fieldsVisited: number; tanksDefeated: number },
  ) {
    super();
    this.view.draw = (ctx) => this.draw(ctx);
  }

  protected tick(_input: ScreenInput, released: boolean): void {
    if (released && this.hit(STAGE_CENTER_X - 90, 280, 180, 44)) {
      this.closed = true;
      this.onRestart();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.closed) return; // dismissed — stop painting the overlay
    ctx.save();
    ctx.fillStyle = "rgba(8,18,20,0.92)";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe9a8";
    ctx.font = "bold 42px system-ui, sans-serif";
    ctx.fillText("You beat the Boss!", STAGE_CENTER_X, 150);
    ctx.fillStyle = "#dff3f5";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Boss Badge earned", STAGE_CENTER_X, 186);
    ctx.fillStyle = "rgba(223,243,245,0.75)";
    ctx.fillText(`Bubblefields visited: ${this.stats.fieldsVisited}`, STAGE_CENTER_X, 224);
    ctx.fillText(`Tanks defeated: ${this.stats.tanksDefeated}`, STAGE_CENTER_X, 246);
    this.button(ctx, STAGE_CENTER_X - 90, 280, 180, 44, "Keep Playing", this.hit(STAGE_CENTER_X - 90, 280, 180, 44));
    ctx.textAlign = "left";
    ctx.restore();
  }
}

// ------------------------------------------------------- start notification

/** "What's New" start notification — shown once per profile (`_-7W`). */
export class StartNotification extends MenuScreen {
  constructor(private readonly onDismiss: () => void) {
    super();
    this.view.draw = (ctx) => this.draw(ctx);
  }

  protected tick(_input: ScreenInput, released: boolean): void {
    if (released) {
      this.closed = true;
      this.onDismiss();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.closed) return; // dismissed — stop painting the overlay
    ctx.save();
    ctx.fillStyle = "rgba(6,14,16,0.85)";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    ctx.textAlign = "center";
    ctx.fillStyle = "#dff3f5";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText(`What's New — v${VERSION_TEXT}`, STAGE_CENTER_X, 170);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(223,243,245,0.8)";
    ctx.fillText("An open, faithful re-implementation of Bubble Tanks 3.", STAGE_CENTER_X, 205);
    ctx.fillText("Grow by collecting bubbles, level up, and beat the Boss.", STAGE_CENTER_X, 226);
    const pulse = (Math.sin(performance.now() / 350) + 1) / 2;
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    ctx.fillStyle = "#9fe8f0";
    ctx.fillText("click to continue", STAGE_CENTER_X, 280);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.restore();
  }
}
