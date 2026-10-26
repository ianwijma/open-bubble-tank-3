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
  /** Play-button glow pulse state (the original's PlayButtonEffect). */
  private glow = 0;
  private glowDir: 1 | -1 = 1;
  /** One-line stub notice (Parts Packs / Credits / PMG). */
  private note: string | null = null;

  constructor(
    private readonly hasSavedData: boolean,
    private readonly onPlay: () => void,
    private readonly settingsStore: SettingsStore,
  ) {
    super();
    this.view.draw = (ctx) => this.draw(ctx);
  }

  protected tick(input: ScreenInput, released: boolean): void {
    // Play-button glow pulse (the original's PlayButtonEffect: _-SA bounces
    // in [0,2] driving a white GlowFilter — ported as a shadowBlur pulse).
    this.glow = Math.min(2, Math.max(0, this.glow + 0.05 * (this.glowDir === 1 ? 1 : -1)));
    if (this.glow >= 2) this.glowDir = -1;
    if (this.glow <= 0) this.glowDir = 1;

    if (this.settings) {
      this.settings.run(input);
      if (this.settings.closed) this.settings = null;
      return;
    }
    if (!released) return;
    if (this.hit(STAGE_CENTER_X - 90, 190, 180, 44)) {
      this.closed = true;
      this.onPlay();
    } else if (this.hit(STAGE_CENTER_X - 90, 246, 180, 44)) {
      this.settings = new SettingsPanel(this.settingsStore);
      this.showSettings = true;
    } else if (this.hit(STAGE_CENTER_X - 90, 302, 180, 44)) {
      this.note = "Parts Packs Manager is not implemented yet.";
    } else if (this.hit(STAGE_CENTER_X - 90, 358, 180, 44)) {
      this.note = "Credits: an open re-implementation of Bubble Tanks 3 by Hero Interactive.";
    } else if (this.hit(STAGE_CENTER_X - 90, 414, 180, 30)) {
      this.note = "Play More Games! — not wired in the open port.";
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
    ctx.fillText("Bubble Tanks 3", STAGE_CENTER_X, 110);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(223,243,245,0.6)";
    ctx.fillText(`open re-implementation · v${VERSION_TEXT}`, STAGE_CENTER_X, 136);

    if (this.settings) {
      this.settings.draw(ctx);
    } else {
      // Play with the original's white glow pulse
      const hovered = this.hit(STAGE_CENTER_X - 90, 190, 180, 44);
      ctx.save();
      ctx.shadowColor = "rgba(255,255,255,0.9)";
      ctx.shadowBlur = 6 + this.glow * 4 + (hovered ? 4 : 0);
      this.button(ctx, STAGE_CENTER_X - 90, 190, 180, 44, this.hasSavedData ? "Continue" : "Play", hovered);
      ctx.restore();
      this.button(ctx, STAGE_CENTER_X - 90, 246, 180, 44, "Settings", this.hit(STAGE_CENTER_X - 90, 246, 180, 44));
      this.button(ctx, STAGE_CENTER_X - 90, 302, 180, 44, "Parts Packs", this.hit(STAGE_CENTER_X - 90, 302, 180, 44));
      this.button(ctx, STAGE_CENTER_X - 90, 358, 180, 44, "Credits", this.hit(STAGE_CENTER_X - 90, 358, 180, 44));
      ctx.font = "12px system-ui, sans-serif";
      this.button(ctx, STAGE_CENTER_X - 90, 414, 180, 30, "Play More Games!", this.hit(STAGE_CENTER_X - 90, 414, 180, 30));
      if (this.note) {
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillStyle = "rgba(223,243,245,0.75)";
        ctx.fillText(this.note, STAGE_CENTER_X, 168);
      }
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

/**
 * SettingsPanel (docs 04 §3.4, symbol 645): frame rate 35/50/65 (gs1-3),
 * quality Low/Medium/High (g1-3), music/sounds/screen-shake/efficiency
 * toggles (m/s/v/e pairs), a hotkeys page (h1-h6 display; rebinding is a
 * stub), and Back. Every change persists through the `BTA` mirror.
 * Efficiency = the original's `_-UF(true)` preset: music/sounds off,
 * quality LOW, fps 90, shake off.
 */
const QUALITY_OPTIONS = ["LOW", "MEDIUM", "HIGH"] as const;

export class SettingsPanel extends MenuScreen {
  private showHotkeys = false;

  constructor(private readonly settings: SettingsStore) {
    super();
    this.view.draw = (ctx) => this.draw(ctx);
  }

  private static readonly ROW_Y = [110, 154, 198, 242, 286, 330] as const;
  private static readonly LABEL_RIGHT = 210;
  private static readonly WIDGET_X = 240;

  protected tick(_input: ScreenInput, released: boolean): void {
    if (!released) return;
    const v = this.settings.value;
    const [fpsY, qY, musicY, soundsY, shakeY, effY] = SettingsPanel.ROW_Y;
    if (this.showHotkeys) {
      // hotkeys page: back to settings (rebinding is a stub — ledger)
      if (this.hit(230, 380, 90, 30)) this.showHotkeys = false;
      return;
    }
    // fps radios
    FPS_OPTIONS.forEach((fps, i) => {
      if (this.hit(SettingsPanel.WIDGET_X + i * 60, fpsY, 52, 26)) this.settings.save({ f: fps });
    });
    // quality radios
    QUALITY_OPTIONS.forEach((q, i) => {
      if (this.hit(SettingsPanel.WIDGET_X + i * 76, qY, 68, 26)) this.settings.save({ q });
    });
    // toggles
    if (this.hit(SettingsPanel.WIDGET_X, musicY, 110, 26)) this.settings.save({ m: !v.m });
    else if (this.hit(SettingsPanel.WIDGET_X, soundsY, 110, 26)) this.settings.save({ s: !v.s });
    else if (this.hit(SettingsPanel.WIDGET_X, shakeY, 110, 26)) this.settings.save({ ss: !v.ss });
    // efficiency: on = the original's preset; off = restore the defaults
    else if (this.hit(SettingsPanel.WIDGET_X, effY, 110, 26)) {
      const efficiencyOn = v.m === false && v.s === false && v.q === "LOW" && v.f === 90;
      if (efficiencyOn) this.settings.save({ m: true, s: true, q: "HIGH", f: 50, ss: true });
      else this.settings.save({ m: false, s: false, q: "LOW", f: 90, ss: false });
    }
    // hotkeys page
    else if (this.hit(SettingsPanel.WIDGET_X, 374, 110, 26)) this.showHotkeys = true;
    // back
    if (this.hit(360, 374, 100, 30)) this.closed = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.closed) return;
    ctx.save();
    ctx.fillStyle = "#142b2c";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    ctx.textAlign = "center";
    ctx.fillStyle = "#dff3f5";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText(this.showHotkeys ? "Hotkeys" : "Settings", STAGE_CENTER_X, 64);

    const label = (text: string, y: number): void => {
      ctx.fillStyle = "rgba(223,243,245,0.85)";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(text, SettingsPanel.LABEL_RIGHT, y + 18);
      ctx.textAlign = "center";
    };
    const radio = (options: string[], y: number, activeIndex: number, w: number): void => {
      options.forEach((opt, i) => {
        const x = SettingsPanel.WIDGET_X + i * (w + 8);
        const active = i === activeIndex;
        const hovered = this.hit(x, y, w, 26);
        ctx.fillStyle = active ? "rgba(127,227,238,0.3)" : hovered ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.roundRect(x, y, w, 26, 6);
        ctx.fill();
        ctx.strokeStyle = active ? "#7fe3ee" : "rgba(127,227,238,0.25)";
        ctx.stroke();
        ctx.fillStyle = active ? "#dff9fc" : "rgba(223,243,245,0.8)";
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillText(opt, x + w / 2, y + 17);
      });
    };
    const toggle = (labelText: string, y: number, on: boolean): void => {
      label(labelText, y);
      const x = SettingsPanel.WIDGET_X;
      const hovered = this.hit(x, y, 110, 26);
      ctx.fillStyle = on ? "rgba(140,220,140,0.3)" : "rgba(255,120,100,0.22)";
      ctx.beginPath();
      ctx.roundRect(x, y, 110, 26, 6);
      ctx.fill();
      ctx.strokeStyle = on ? "rgba(140,220,140,0.8)" : "rgba(255,120,100,0.55)";
      ctx.stroke();
      ctx.fillStyle = "#dff9fc";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(on ? "On" : "Off", x + 55, y + 17);
      if (hovered) {
        ctx.strokeStyle = "rgba(127,227,238,0.5)";
        ctx.stroke();
      }
    };

    const v = this.settings.value;
    const [fpsY, qY, musicY, soundsY, shakeY, effY] = SettingsPanel.ROW_Y;
    if (this.showHotkeys) {
      // hotkeys display (h1..h6; rebinding is a stub — ledger)
      const names = ["Up", "Down", "Left", "Right", "Pause", "Lock"];
      names.forEach((name, i) => {
        const y = 110 + i * 40;
        label(name, y);
        const key = String.fromCharCode((v as unknown as Record<string, number>)[`h${i + 1}`] ?? 0);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.roundRect(SettingsPanel.WIDGET_X, y, 110, 26, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(127,227,238,0.25)";
        ctx.stroke();
        ctx.fillStyle = "#dff9fc";
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillText(key, SettingsPanel.WIDGET_X + 55, y + 17);
      });
      this.button(ctx, 230, 380, 90, 30, "Back", this.hit(230, 380, 90, 30));
      ctx.textAlign = "left";
      ctx.restore();
      return;
    }

    label("Frame Rate", fpsY);
    radio(FPS_OPTIONS.map(String), fpsY, FPS_OPTIONS.indexOf(v.f as (typeof FPS_OPTIONS)[number]), 52);
    label("Quality", qY);
    radio([...QUALITY_OPTIONS], qY, QUALITY_OPTIONS.indexOf(v.q), 68);
    toggle("Music", musicY, v.m);
    toggle("Sounds", soundsY, v.s);
    toggle("Screen Shake", shakeY, v.ss);
    const efficiencyOn = v.m === false && v.s === false && v.q === "LOW" && v.f === 90;
    toggle("Efficiency", effY, efficiencyOn);
    // bottom row: Hotkeys (opens the key display) + Done
    ctx.fillStyle = "rgba(223,243,245,0.85)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("Hotkeys", SettingsPanel.LABEL_RIGHT, 374 + 18);
    ctx.textAlign = "center";
    const hotHover = this.hit(SettingsPanel.WIDGET_X, 374, 110, 26);
    ctx.fillStyle = hotHover ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(SettingsPanel.WIDGET_X, 374, 110, 26, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(127,227,238,0.25)";
    ctx.stroke();
    ctx.fillStyle = "#dff9fc";
    ctx.fillText("Configure", SettingsPanel.WIDGET_X + 55, 374 + 17);
    this.button(ctx, 360, 374, 100, 30, "Done", this.hit(360, 374, 100, 30));
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
