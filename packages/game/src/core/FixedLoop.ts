/**
 * Fixed-timestep game loop replicating the Flash ENTER_FRAME model.
 *
 * The original is frame-based: every gameplay timer counts frames at the
 * configured FPS (35/50/65). This loop steps the update callback a fixed
 * number of times per second, accumulating leftover real time (capped to
 * avoid spiral-of-death after tab suspends), then renders once per rAF.
 */

export interface FixedLoopOptions {
  fps: number;
  update: (frame: number) => void;
  render: (interp: number) => void;
}

export class FixedLoop {
  private fps: number;
  private readonly frameMs: number;
  private readonly update: (frame: number) => void;
  private readonly render: (interp: number) => void;

  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private running = false;
  private frameCounter = 0;

  /** Longest wall-clock slice simulated per rAF tick (prevents catch-up spirals). */
  private static readonly MAX_FRAME_MS = 250;

  constructor(options: FixedLoopOptions) {
    this.fps = options.fps;
    this.frameMs = 1000 / options.fps;
    this.update = options.update;
    this.render = options.render;
  }

  /** Change the frame rate (settings screen swaps 35/50/65). */
  setFps(fps: number): void {
    this.fps = fps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const elapsed = Math.min(now - this.last, FixedLoop.MAX_FRAME_MS);
      this.last = now;
      this.accumulator += elapsed;
      while (this.accumulator >= this.frameMs) {
        this.accumulator -= this.frameMs;
        this.frameCounter++;
        this.update(this.frameCounter);
      }
      // Interpolation fraction between the last two simulated frames.
      this.render(this.accumulator / this.frameMs);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get isRunning(): boolean {
    return this.running;
  }
}
