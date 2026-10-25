/**
 * Input — keyboard + mouse snapshot attached to the stage canvas.
 *
 * The original polls `stage.mouseX/mouseY` and key states each frame via the
 * AvatarInterface; hotkeys (h1..h6 = W/S/A/D/P/Q by default) come from
 * GameData. M1: fixed WASD + arrows for movement, mouse for aim/fire, P/Esc
 * for pause. Hotkey rebinding (the `_-Ay` binder) is M5.
 */

export interface InputSnapshot {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  space: boolean;
  pause: boolean;
  /** Stage-logical mouse coordinates (0..550, 0..450). */
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
}

export class Input {
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false };

  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly keyUp: (e: KeyboardEvent) => void;
  private readonly mouseMove: (e: MouseEvent) => void;
  private readonly mouseDown: (e: MouseEvent) => void;
  private readonly mouseUp: (e: MouseEvent) => void;
  private readonly contextMenu: (e: Event) => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.keyDown = (e) => {
      // The game never uses text input; keep scrolling shortcuts inert.
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      this.keys.add(e.key);
    };
    this.keyUp = (e) => this.keys.delete(e.key);
    this.mouseMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 550;
      this.mouse.y = ((e.clientY - rect.top) / rect.height) * 450;
    };
    this.mouseDown = (e) => {
      if (e.button === 0) this.mouse.down = true;
    };
    this.mouseUp = (e) => {
      if (e.button === 0) this.mouse.down = false;
    };
    this.contextMenu = (e) => e.preventDefault();

    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    this.canvas.addEventListener("mousemove", this.mouseMove);
    this.canvas.addEventListener("mousedown", this.mouseDown);
    window.addEventListener("mouseup", this.mouseUp);
    this.canvas.addEventListener("contextmenu", this.contextMenu);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    this.canvas.removeEventListener("mousemove", this.mouseMove);
    this.canvas.removeEventListener("mousedown", this.mouseDown);
    window.removeEventListener("mouseup", this.mouseUp);
    this.canvas.removeEventListener("contextmenu", this.contextMenu);
  }

  /** Edge-triggered pause: true exactly once per press. */
  private pauseWasDown = false;
  private pausePressedFlag = false;

  /** Consume the pause press (called once per frame). */
  consumePause(): boolean {
    const value = this.pausePressedFlag;
    this.pausePressedFlag = false;
    return value;
  }

  snapshot(): InputSnapshot {
    const k = this.keys;
    const pauseDown = k.has("p") || k.has("P") || k.has("Escape");
    if (pauseDown && !this.pauseWasDown) this.pausePressedFlag = true;
    this.pauseWasDown = pauseDown;
    return {
      up: k.has("w") || k.has("W") || k.has("ArrowUp"),
      down: k.has("s") || k.has("S") || k.has("ArrowDown"),
      left: k.has("a") || k.has("A") || k.has("ArrowLeft"),
      right: k.has("d") || k.has("D") || k.has("ArrowRight"),
      space: k.has(" ") || k.has("Spacebar"),
      pause: pauseDown,
      mouseX: this.mouse.x,
      mouseY: this.mouse.y,
      mouseDown: this.mouse.down,
    };
  }
}
