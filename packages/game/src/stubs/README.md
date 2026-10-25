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
| UpgradeMenu Edit / Search / Parts Pack | `ui/UpgradeMenu.ts` footer note | `EditTank` opens `TankCreatorScreen(true,"Avatar",…)` seeded with the slot's/current tank (M4); `OpenTankSearch` opens `TankViewerScreen` (M4/M5); `partsPack_mc` opens the parts-pack manager with the `UpdateUnlocked` refresh callback (M5). |
| Blur-trail transitions | `ui/UpgradeMenu.ts` fade | The original fades with `alpha -= 0.025`/frame plus a 30-step `_ -US` snapshot blur trail (docs 04 §5.2); the port uses the alpha fade only. |
| Inter-level screen (`_-Fb`) | choice generation coin flip | The inter-level screen (symbol 1975) hosts the HI/featured/rating>4 checkboxes and "my tanks" toggle feeding the offer coin flip (docs 04 §5.9, §4.3 step 4); the port flips with the profile flags off → always searches. M5. |
| PlayerProfile persistence | `world/GameWorld.ts` `currentAvatarCode`/`savedTanks` | `PlayerProfile.currentAvatar`, `_ -ch` saved-tanks history (searched by `GetDefaultTank` with the verbatim `arrGP[level−1]` off-by-one), and the `_-p` progression restore from `strPreviousTankProgression` arrive with M4 storage work. |
| Secondary-weapons info popup (`_-ND`) | `world/GameWorld.ts` `placeAvatar` | `PlaceAvatar` opens an info popup the first time the avatar has secondary weapons (`_-bP` gate, M5). |
| Offline offer guarantee | `ui/UpgradeMenu.ts` | Deviation: when the local bank search and saved history both come up empty for every slot, the current avatar's own tank is offered so the menu cannot soft-lock (the dead server made the original show an empty menu). |
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
| Death↔upgrade menu interplay | `world/GameWorld.ts` | `_-dI` and the level-up choice screen are implemented (M2). What remains: the "Edit" path into the TankCreatorScreen (M4) and the win/lose screens around it (M5). |

## Deliberate deviations (documented, not bugs)

- ~~`intTankLevel` lives on the avatar `Tank`~~ **fixed in M2** — it lives on
  the `AvatarInterface` exactly as in the original (it must survive avatar
  replacement via `PlaceAvatar`).
- Enemy hit-testing uses circle-vs-part tests instead of Flash pixel-perfect
  `hitTestPoint` (port note, docs 08 §6).
- Bullet anti-tunneling uses the half-step sample (`pos − move/2`) as in the
  original, but with the numeric radii rather than art bitmaps.
- "Layer hit, no tank hit" destroys the bullet without damage — recovered
  semantics from obfuscated p-code (docs 08 §2.3 port note).
