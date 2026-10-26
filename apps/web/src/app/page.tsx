"use client";

/**
 * Bubble Tanks 3 — open re-implementation. M5 app shell.
 *
 * The game core owns every in-canvas screen (main menu, pause, settings,
 * creator, upgrade menu, win screen). The app mounts the 550×450 stage,
 * feeds the FixedLoop, loads the user's SWF for art/sounds, and applies the
 * persisted settings (fps, shake, sounds) to the loop + screen-fx sink.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_FPS,
  FixedLoop,
  GameData,
  GameWorld,
  Input,
  STAGE_COLOR,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  SwfArtStore,
  loadSwfAssets,
  renderTree,
  setArtStore,
  type SoundCue,
  type SwfAssetBundle,
} from "@open-bt3/game";

/** Sound cue → ExportAssets name (docs 09-audio-effects.md §6). */
const CUE_SYMBOLS: Partial<Record<SoundCue, string>> = {
  shoot: "_ -dH",
  hit: "_ -49",
  avatarHit: "_ -JV",
  collect: "_ -Fe",
  enemyDeath: "_ -AH",
  allyDeath: "_ -9w",
  pop: "_ -6j",
};

/** WebAudio sink — resolves cues through the SWF's ExportAssets map. */
class SwfSoundSink {
  private buffers = new Map<SoundCue, AudioBuffer>();
  private ctx: AudioContext | null = null;
  enabled = true;

  async load(bundle: SwfAssetBundle): Promise<void> {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    for (const [cue, name] of Object.entries(CUE_SYMBOLS) as [SoundCue, string][]) {
      const cid = bundle.exportedNames.get(name) ?? bundle.exportedNames.get(name.replace(" ", ""));
      if (cid === undefined) continue;
      const sound = bundle.sounds.get(cid);
      if (!sound?.blob || sound.unsupported) continue;
      try {
        this.buffers.set(cue, await this.ctx.decodeAudioData(await sound.blob.arrayBuffer()));
      } catch {
        /* undecodable sound — skip the cue */
      }
    }
  }

  play(cue: SoundCue): void {
    if (!this.enabled) return;
    const buffer = this.buffers.get(cue);
    const ctx = this.ctx;
    if (!buffer || !ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  }
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<"boot" | "running">("boot");
  const [bundleName, setBundleName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const gameRef = useRef<{
    world: GameWorld;
    loop: FixedLoop;
    input: Input;
    data: GameData;
    sink: SwfSoundSink;
  } | null>(null);

  const startGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || gameRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = new GameData();
    const sink = new SwfSoundSink();
    const world = new GameWorld();
    world.soundSink = { play: (cue) => sink.play(cue) };
    world.onQuit = () => {
      // Quit Playing (docs 04 §5.1): tear down and return to the main menu.
      gameRef.current?.loop.stop();
      gameRef.current = null;
      startGame();
    };
    world.setup();
    void world.loadProfile();
    world.showMainMenu();
    world.maybeShowStartNotification();

    const input = new Input(canvas);
    const loop = new FixedLoop({
      fps: data.settings.fps ?? world.settings.value.f,
      update: () => {
        world.run(input.snapshot());
        // settings live-apply (fps + audio)
        loop.setFps(world.settings.value.f);
        sink.enabled = world.settings.value.s;
        // screen-fx decay (shake consumed by the render below)
        world.screenFx.shake = Math.max(0, world.screenFx.shake - 0.8);
        world.screenFx.flash = Math.max(0, world.screenFx.flash - 0.06);
      },
      render: () => {
        // The backing store is 2× (crisp text on hidpi); the stage draws in
        // 550×450 coordinates, so the 2× device scale must be applied.
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.fillStyle = STAGE_COLOR;
        ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        const fx = world.screenFx;
        ctx.save();
        if (fx.shake > 0 && world.settings.value.ss) {
          ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
        }
        renderTree(ctx, world.view);
        ctx.restore();
        if (fx.flash > 0) {
          ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, fx.flash)})`;
          ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        }
      },
    });
    loop.start();
    gameRef.current = { world, loop, input, data, sink };
    setPhase("running");
  }, []);

  // Teardown on unmount (dev strict-mode double mount).
  useEffect(
    () => () => {
      gameRef.current?.loop.stop();
      gameRef.current = null;
    },
    [],
  );

  const loadSwf = useCallback(async (file: File) => {
    setBusy(true);
    setLoadError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bundle = await loadSwfAssets(bytes, (line) => console.log(`[swf] ${line}`));
      // Install the parsed art: parts/fields/bullets rebuild through the
      // SymbolClass map on the next world construction.
      setArtStore(new SwfArtStore(bundle));
      if (gameRef.current) {
        // A mid-game load restarts the world so every view rebuilds with
        // the real art (the boot flow loads before Start, so this is the
        // rare path).
        gameRef.current.loop.stop();
        gameRef.current = null;
        startGame();
      }
      await gameRef.current?.sink.load(bundle);
      setBundleName(file.name);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [startGame]);

  // Drag & drop on the whole window.
  useEffect(() => {
    const prevent = (e: DragEvent): void => e.preventDefault();
    const drop = (e: DragEvent): void => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) void loadSwf(file);
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", drop);
    };
  }, [loadSwf]);

  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-[#0b1516]">
      <div className="relative w-full max-w-[1100px]" style={{ aspectRatio: `${STAGE_WIDTH} / ${STAGE_HEIGHT}` }}>
        <canvas
          ref={canvasRef}
          width={STAGE_WIDTH * 2}
          height={STAGE_HEIGHT * 2}
          className="h-full w-full rounded-lg shadow-[0_0_60px_rgba(0,0,0,0.6)]"
          style={{ imageRendering: "auto", touchAction: "none" }}
        />
        {phase === "boot" ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-lg border border-white/10 bg-[#142b2c] text-center text-slate-200"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) void loadSwf(file);
            }}
          >
            <h1 className="text-3xl font-bold tracking-wide text-cyan-100">Bubble Tanks 3</h1>
            <p className="max-w-sm text-sm text-slate-300/80">
              Open re-implementation. Drop your own <code>Bubble Tanks 3.swf</code> here to load the
              original art &amp; sounds, or start without it (procedural art).
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded bg-cyan-700/60 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-600/70"
              >
                {busy ? "Loading…" : "Choose SWF…"}
              </button>
              <button
                type="button"
                onClick={startGame}
                className="rounded bg-slate-700/60 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-600/70"
              >
                Start without SWF
              </button>
            </div>
            {loadError ? <p className="text-sm text-rose-300">SWF load failed: {loadError}</p> : null}
            {bundleName ? <p className="text-xs text-emerald-300/80">loaded: {bundleName}</p> : null}
            <p className="text-xs text-slate-400/60">WASD move · mouse aim · click shoot · Space secondaries · P pause</p>
          </div>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".swf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadSwf(file);
        }}
      />
    </main>
  );
}
