# Stubs ledger — functionality deliberately not yet (re-)implemented

Everything listed here is **present in the original SWF** but is stubbed in
this port, either because it is out of the current milestone (M1 = world +
one field + move/shoot + basic enemies + death/jump) or because the original
itself never used it (vestigial code). Each entry says where the stub lives
and what the faithful re-implementation needs. When a stub gets implemented,
delete its entry here.

## M2+ stubs (real features, scheduled by `re/bt3/docs/11-port-plan.md`)

| Stub | Location | Original behavior (doc refs) |
| --- | --- | --- |
| `_ -U4` infector seekers | `world/BubbleField.ts` `spawnInfectorSeekers()` | Infected-tank death spawns 2 infector seekers: `SpawnNewBullet(new _-U4, x, y, 1, rand(0,360), 6, 1, false, null, null)` (`_-Zx.as:1001-1003`). Needs the DoT bullet class + infection spread. |
| SWF symbol art | all of `render/art/`, `entities/Tank.ts` `makePartView` | Parts/fields render as procedural radial-gradient bubbles. The SWF asset pipeline (`assets/swf/`) parses real shape layers; wiring SymbolClass ids into part views lands in M2/M3. |
| Placed-clip color transforms | `assets/swf/canvas.ts` `tintedCss()` | `CXFORMWITHALPHA` on PlaceObject2/3 records is parsed and retained but not applied at paint time. |
| Gradient spread modes | `assets/swf/canvas.ts` `resolvePaint()` | Canvas2D has no reflect/repeat gradient spread; `pad` is used for all. BT3 art is verified pad-only so far. |
| Bitmap-fill smoothing | `assets/swf/canvas.ts` | `smooth=false` bitmap fills should render pixelated; patterns are always smoothed. |
| Flash static-text glyphs | `assets/swf/symbols.ts` `parseFontTag` | Font glyph shape outlines are skipped (code tables only, for string decoding). In-canvas HUD draws with system fonts; Flash glyph rendering only matters for menu art fidelity (M5). |
| Sound streaming | `assets/swf/index.ts` | `SoundStreamHead/Block` tags are counted, not assembled. DefineSounds carry all gameplay cues. |
| Morph playback | `assets/swf/canvas.ts` `buildShapeLayers(morph)` | Morph shape interpolation implemented at parse level (run/color lerp); playback timeline (which placement morphs at which ratio) is M3. |
| `ScreenEffectsLayer` | `world/BubbleField.ts` `addEffect()` | Screen-level effect layer attaches to `TopEffectsLayer` until the world-level layer exists (M2). |
| Ink screen effect | `entities/Tank.ts` `inkTimer` | Timer ticks; no screen-ink overlay drawn yet (M3). |
| Forcefield rebuild cycle | `entities/Tank.ts` `blnForcefielded` | Break at 40 works; the rebuild (decay 1/20 frames → re-arm, `gotoAndPlay(36)`) is M3 (docs 03 §4). |
| Charge mechanics | — | **Vestigial in the original** (`docs 07 §9`): charge meter code exists but no part sets it. Not ported. |
| `blnHardened` | `entities/Tank.ts` damage chain | **Never set in the original** (docs 07 §9); damage chain keeps the check position for fidelity. |
| Enemy mine layers | `entities/Tank.ts` `blnMineLayer` | Mine-layer bookkeeping stubbed for M2 (Seeker Mine Dropper 4004 family). |
| Sponsor/preload frames | `world/GameWorld.ts` tutorial captions | The `ag` sponsor frame is stripped (open-source port; licensing-safe). |
| Death↔upgrade menu interplay | `world/GameWorld.ts` | `_-dI` upgrade/downgrade menu is a HUD stub until M4 (docs 04 §6). |

## Deliberate deviations (documented, not bugs)

- `intTankLevel` lives on the avatar `Tank` instead of `AvatarInterface`
  (the original stores it on the HUD clip; the port keeps HUD stateless of
  simulation). `entities/Tank.ts` field comment.
- Enemy hit-testing uses circle-vs-part tests instead of Flash pixel-perfect
  `hitTestPoint` (port note, docs 08 §6).
- Bullet anti-tunneling uses the half-step sample (`pos − move/2`) as in the
  original, but with the numeric radii rather than art bitmaps.
- "Layer hit, no tank hit" destroys the bullet without damage — recovered
  semantics from obfuscated p-code (docs 08 §2.3 port note).
