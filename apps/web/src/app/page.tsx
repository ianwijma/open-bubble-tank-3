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

/** Sound cue → sound-class name (docs 09 §2.2). The original binds its
 * MP3s to AS3 Sound classes via SymbolClass (`_-dH` → cid 561 etc.) — the
 * file has NO ExportAssets entries. Names are stored space-stripped. */
const CUE_SYMBOLS: Partial<Record<SoundCue, string>> = {
  shoot: "_-dH", // enemy weapon fire (the avatar's cannon is silent)
  hit: "_-49",
  avatarHit: "_-JV",
  collect: "_-Fe",
  enemyDeath: "_-AH", // intType 3 destroyed (_-Zx.as:997)
  allyDeath: "_-9w", // intType 2 destroyed (_-Zx.as:992)
  pop: "_-aa", // no `_-6j` class exists; the heavy hit sample stands in
};

const MUSIC_SYMBOLS = { menu: "_-Sr", game: "_-BY" } as const;
const MUSIC_VOLUME = 0.8; // Main._-RO(_, 0.8)

/** WebAudio sink — resolves cues through the SWF's SymbolClass map, falls
 * back to tiny synthesized cues when no SWF is loaded, and loops the game's
 * two music tracks. */
class SwfSoundSink {
  private buffers = new Map<SoundCue, AudioBuffer>();
  private musicBuffers = new Map<"menu" | "game", AudioBuffer>();
  private ctx: AudioContext | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private currentTrack: "menu" | "game" | null = null;
  /** The track the world wants; resumed when music is re-enabled. */
  pendingTrack: "menu" | "game" | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  musicEnabled = true;

  async load(bundle: SwfAssetBundle): Promise<void> {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const resolve = (name: string): number | undefined =>
      bundle.exportedNames.get(name) ?? bundle.symbolByName.get(name);
    for (const [cue, name] of Object.entries(CUE_SYMBOLS) as [SoundCue, string][]) {
      const cid = resolve(name);
      if (cid === undefined) continue;
      const sound = bundle.sounds.get(cid);
      if (!sound?.blob || sound.unsupported) continue;
      try {
        this.buffers.set(cue, await this.ctx.decodeAudioData(await sound.blob.arrayBuffer()));
      } catch {
        /* undecodable sound — the synth fallback covers the cue */
      }
    }
    for (const [track, name] of Object.entries(MUSIC_SYMBOLS) as ["menu" | "game", string][]) {
      const cid = resolve(name);
      if (cid === undefined) continue;
      const sound = bundle.sounds.get(cid);
      if (!sound?.blob || sound.unsupported) continue;
      try {
        this.musicBuffers.set(track, await this.ctx.decodeAudioData(await sound.blob.arrayBuffer()));
      } catch {
        /* no music for this track */
      }
    }
    // the world may have requested a track while the decodes were still
    // running (the menu music races this whole async load) — start it now
    if (this.pendingTrack && this.musicEnabled) {
      this.currentTrack = null;
      this.music(this.pendingTrack);
    }
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    return this.ctx;
  }

  play(cue: SoundCue): void {
    if (!this.enabled) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const buffer = this.buffers.get(cue);
    if (buffer) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      return;
    }
    this.synth(ctx, cue); // no-asset fallback: a basic synthesized cue
  }

  /** `MusicPlayer` stand-in: loop the menu/game track at 0.8 (docs 09 §2.3). */
  music(track: "menu" | "game" | null): void {
    this.pendingTrack = track;
    if (this.currentTrack === track) return;
    this.currentTrack = track;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    this.musicSource?.stop();
    this.musicSource = null;
    if (!track || !this.musicEnabled) return;
    if (ctx.state === "suspended") void ctx.resume();
    const buffer = this.musicBuffers.get(track);
    if (!buffer) return; // no-asset path: no synthesized music (cues only)
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = MUSIC_VOLUME;
    source.connect(gain).connect(ctx.destination);
    source.start();
    this.musicSource = source;
    this.musicGain = gain;
  }

  /** Tiny synthesized stand-ins so the no-asset build still has sound. */
  private synth(ctx: AudioContext, cue: SoundCue): void {
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + dur);
    };
    const burst = (dur: number, vol: number): void => {
      if (!this.noise) {
        const len = Math.floor(ctx.sampleRate * 0.5);
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(gain);
      src.start(t);
      src.stop(t + dur);
    };
    switch (cue) {
      case "shoot":
        tone("square", 620, 180, 0.08, 0.05);
        break;
      case "hit":
        burst(0.05, 0.07);
        break;
      case "avatarHit":
        tone("sawtooth", 160, 60, 0.18, 0.1);
        break;
      case "collect":
        tone("sine", 520, 1040, 0.12, 0.07);
        break;
      case "enemyDeath":
        burst(0.35, 0.16);
        tone("sine", 110, 40, 0.35, 0.12);
        break;
      case "allyDeath":
        burst(0.6, 0.2);
        tone("sine", 80, 30, 0.6, 0.14);
        break;
      case "pop":
        tone("sine", 300, 90, 0.06, 0.08);
        break;
      default:
        tone("sine", 400, 200, 0.1, 0.05);
    }
  }
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<"boot" | "running">("boot");
  const [bundleName, setBundleName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  type GameHandle = {
    world: GameWorld;
    loop: FixedLoop;
    input: Input;
    data: GameData;
    sink: SwfSoundSink;
  };
  const gameRef = useRef<GameHandle | null>(null);
  // The loaded SWF bundle, retained so a sink created later (Start click)
  // still picks up the sounds from a boot-phase load.
  const bundleRef = useRef<SwfAssetBundle | null>(null);

  const startGame = useCallback((): GameHandle | null => {
    const canvas = canvasRef.current;
    if (!canvas || gameRef.current) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const data = new GameData();
    const sink = new SwfSoundSink();
    // Sounds from a SWF loaded before Start (boot phase) or reloaded
    // mid-game land here via the retained bundle ref.
    if (bundleRef.current) void sink.load(bundleRef.current);
    const world = new GameWorld();
    world.soundSink = {
      play: (cue) => sink.play(cue),
      music: (track) => sink.music(track),
    };
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
        const musicWanted = world.settings.value.m;
        if (sink.musicEnabled !== musicWanted) {
          sink.musicEnabled = musicWanted;
          if (!musicWanted) sink.music(null);
          else sink.music(sink.pendingTrack);
        }
        // screen-fx decay (shake consumed by the render below)
        world.screenFx.shake = Math.max(0, world.screenFx.shake - 0.8);
        world.screenFx.flash = Math.max(0, world.screenFx.flash - 0.06);
      },
      render: () => {
        // The backing store is 2× (crisp text on hidpi); the stage draws in
        // 550×450 coordinates, so the 2× device scale must be applied.
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        // stage.quality (LOW/MEDIUM/HIGH) maps to canvas smoothing.
        ctx.imageSmoothingEnabled = world.settings.value.q !== "LOW";
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
    return gameRef.current;
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
      // Install the parsed art + retain the bundle: parts/fields/bullets
      // rebuild through the SymbolClass map on the next world construction,
      // and the (new) sink picks the sounds up from the retained bundle.
      setArtStore(new SwfArtStore(bundle));
      bundleRef.current = bundle;
      if (gameRef.current) {
        // A mid-game load restarts the world so every view rebuilds with
        // the real art (the boot flow loads before Start, so this is the
        // rare path). startGame wires the fresh sink to the bundle.
        gameRef.current.loop.stop();
        gameRef.current = null;
        startGame();
      }
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
                {bundleName ? "Start (original art loaded)" : "Start without SWF"}
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
