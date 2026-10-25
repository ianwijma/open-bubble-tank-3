"use client";

/**
 * Bubble Tanks 3 — open re-implementation. M1 shell.
 *
 * A full-bleed 550×450 stage canvas mounts the game core (`@open-bt3/game`):
 * FixedLoop drives GameWorld at the configured fps, Input feeds the snapshot,
 * renderTree draws the DisplayNode tree. All gameplay UI is in-canvas; the
 * only DOM chrome is the asset picker (a user-supplied SWF — the repo ships
 * no Hero Interactive art) and the initial drop zone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_FPS,
  FixedLoop,
  GameData,
  GameWorld,
  Input,
  loadSwfAssets,
  renderTree,
  STAGE_COLOR,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type InputSnapshot,
  type SoundCue,
  type SwfAssetBundle,
} from "@open-bt3/game";

type Phase = "boot" | "menu" | "playing" | "paused";

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
  const [phase, setPhase] = useState<Phase>("boot");
  const [bundleName, setBundleName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Everything the loop needs lives in one ref cell so React re-renders
  // never touch the running game.
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
    world.setup();

    const input = new Input(canvas);
    const loop = new FixedLoop({
      fps: data.settings.fps ?? DEFAULT_FPS,
      update: () => {
        const snapshot: InputSnapshot = input.snapshot();
        world.run(snapshot);
      },
      render: () => {
        ctx.fillStyle = STAGE_COLOR;
        ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
        renderTree(ctx, world.view);
      },
    });
    loop.start();
    gameRef.current = { world, loop, input, data, sink };
    setPhase("menu");
  }, []);

  // Menu/pause keyboard + click handling lives outside Input (which is for
  // gameplay only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const game = gameRef.current;
      if (!game) return;
      setPhase((phase) => {
        if (phase === "menu" && (e.key === " " || e.key === "Enter")) return "playing";
        if (phase === "playing" && !game.world.upgradeMenuOpen && (e.key === "p" || e.key === "P" || e.key === "Escape")) {
          game.world.pause();
          return "paused";
        }
        if (phase === "paused" && (e.key === "p" || e.key === "P" || e.key === "Escape")) {
          game.world.resume();
          return "playing";
        }
        return phase;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (): void => {
      const game = gameRef.current;
      if (!game) return;
      setPhase((phase) => (phase === "menu" ? "playing" : phase));
    };
    const canvas = canvasRef.current;
    canvas?.addEventListener("click", onClick);
    return () => canvas?.removeEventListener("click", onClick);
  }, [phase]);

  // Pause the simulation when the tab hides (rAF already stops; resume clean).
  useEffect(() => {
    const onVisibility = (): void => {
      const game = gameRef.current;
      if (!game) return;
      if (document.hidden && phase === "playing") {
        game.world.pause();
        setPhase("paused");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase]);

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
      if (gameRef.current) await gameRef.current.sink.load(bundle);
      setBundleName(file.name);
      setPhase((phase) => (phase === "boot" ? "menu" : phase));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

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

  // In-canvas menu/pause overlays: drawn on top of the game tree each frame
  // the phase calls for it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || phase === "playing" || phase === "boot") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "rgba(8,16,18,0.72)";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    ctx.textAlign = "center";
    ctx.fillStyle = "#dff3f5";
    if (phase === "menu") {
      ctx.font = "bold 44px system-ui, sans-serif";
      ctx.fillText("Bubble Tanks 3", STAGE_WIDTH / 2, 170);
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillStyle = "rgba(223,243,245,0.75)";
      ctx.fillText(bundleName ? `assets: ${bundleName}` : "no SWF loaded — procedural art", STAGE_WIDTH / 2, 205);
      ctx.fillStyle = "#9fd8de";
      ctx.font = "bold 20px system-ui, sans-serif";
      const pulse = (Math.sin(performance.now() / 400) + 1) / 2;
      ctx.globalAlpha = 0.55 + 0.45 * pulse;
      ctx.fillText("click or press Space to play", STAGE_WIDTH / 2, 270);
      ctx.globalAlpha = 1;
    } else {
      ctx.font = "bold 34px system-ui, sans-serif";
      ctx.fillText("Paused", STAGE_WIDTH / 2, 210);
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillStyle = "rgba(223,243,245,0.7)";
      ctx.fillText("P or Esc to resume", STAGE_WIDTH / 2, 245);
    }
    ctx.textAlign = "left";
  }, [phase, bundleName]);

  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-[#0b1516]">
      <div
        className="relative w-full max-w-[1100px]"
        style={{ aspectRatio: `${STAGE_WIDTH} / ${STAGE_HEIGHT}` }}
      >
        <canvas
          ref={canvasRef}
          width={STAGE_WIDTH * 2}
          height={STAGE_HEIGHT * 2}
          onClick={() => {
            const game = gameRef.current;
            if (game && phase === "paused") {
              game.world.resume();
              setPhase("playing");
            }
          }}
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
              Open re-implementation. Drop your own <code>Bubble Tanks 3.swf</code> here to load
              the original art &amp; sounds, or start without it (procedural art).
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
            <p className="text-xs text-slate-400/60">WASD move · mouse aim · click shoot · P pause</p>
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
