# Stubs ledger — functionality deliberately not yet (re-)implemented

Everything listed here is **present in the original SWF** but is stubbed in
this port, either because it is out of the current milestone or because the
original itself never used it (vestigial code). Each entry says where the
stub lives and what the faithful re-implementation needs. When a stub gets
implemented, delete its entry here.

## Current stubs (real features, scheduled by `re/bt3/docs/11-port-plan.md`)

| Stub | Location | Original behavior (doc refs) |
| --- | --- | --- |
| UpgradeMenu Edit / Search / Parts Pack | `ui/UpgradeMenu.ts` footer note | `EditTank` opens `TankCreatorScreen(true,"Avatar",…)` seeded with the slot's/current tank (M4); `OpenTankSearch` opens `TankViewerScreen` (M4/M5); `partsPack_mc` opens the parts-pack manager with the `UpdateUnlocked` refresh callback (M5). |
| Blur-trail transitions | `ui/UpgradeMenu.ts` fade | The original fades with `alpha -= 0.025`/frame plus a 30-step `_ -US` snapshot blur trail (docs 04 §5.2); the port uses the alpha fade only. |
| Inter-level screen (`_-Fb`) | choice generation coin flip | The inter-level screen (symbol 1975) hosts the HI/featured/rating>4 checkboxes and "my tanks" toggle feeding the offer coin flip (docs 04 §5.9, §4.3 step 4); the port flips with the profile flags off → always searches. M5. |
| PlayerProfile persistence | `world/GameWorld.ts` `currentAvatarCode`/`savedTanks` | `PlayerProfile.currentAvatar`, `_ -ch` saved-tanks history (searched by `GetDefaultTank` with the verbatim `arrGP[level−1]` off-by-one), and the `_-p` progression restore from `strPreviousTankProgression` arrive with M4 storage work. |
| Secondary-weapons info popup (`_-ND`) | `world/GameWorld.ts` `placeAvatar` | `PlaceAvatar` opens an info popup the first time the avatar has secondary weapons (`_-bP` gate, M5). |
| Offline offer guarantee | `ui/UpgradeMenu.ts` | Deviation: when the local bank search and saved history both come up empty for every slot, the current avatar's own tank is offered so the menu cannot soft-lock (the dead server made the original show an empty menu). |
| Seeker-carrier shot-to-release | `entities/weapons/arsenal.ts` `SeekerCarrierWeapon` | The original releases the carrier's 6 seekers when a player bullet lands ON the carrier gun (`_-BL.TestForCollision` block, docs 07 §6.2); the port releases on tank death only. Also: pure carrier-ball tanks (`intTankLife = 0; Damage(200)` once emptied) not implemented. |
| Shield lifetime | `arsenal.ts` `ShieldWeapon.SHIELD_FRAMES` | The shield lasts exactly as long as the `_ -YE` shimmer animation (art-driven length); the port uses 180 frames. |
| Massive-cannon charge timing | `arsenal.ts` `MassiveCannonWeapon` | The shot spawns when the `_ -5z` charge effect finishes (art-driven); the port defers 20 frames. |
| Rocket-launcher timer basis | `arsenal.ts` `RocketLauncherWeapon` | The original uses a real-time `Timer(100, 10)`; the port uses the equivalent 5-frame step at 50 fps (deterministic). |
| Radar/health art fidelity | `ui/AvatarInterface.drawEnemyOverlays` | Functional arrows/bars per docs 06 §5.1-5.2 (including the `>120 → 100` width-cap bug); exact original arrow/bar art is an M5 skin pass. |
| Enemy turret build visuals | `arsenal.ts` `ShieldTurretWeapon`/`EnemyTurret` | Functional build counter (4 frames) + shield install; the `_ -KJ`/`_ -bM` shield art and `turret_mc` rotation are M5 skins. |
| SWF symbol art coverage | `assets/swf/art.ts`, `entities/Tank.ts` `makePartView`, `entities/bullets/Bullet.ts`, `render/art/FieldArt.ts` | Symbol art is WIRED: `SwfArtStore` resolves part/bullet `claType` names and the `Bubblefield` symbol through SymbolClass (exact or `.`-suffix match) and instantiates frame-1 placement trees into DisplayNodes; every consumer falls back to the procedural art when no SWF is loaded or a symbol fails. Not yet art-driven: screens/menus (custom-drawn), fonts/texts, frame timelines (the game drives motion in code per docs 11 §2). |
| Placed-clip color transforms | `assets/swf/canvas.ts` `tintedCss()` | `CXFORMWITHALPHA` on PlaceObject2/3 records is parsed and retained but not applied at paint time. |
| Gradient spread modes | `assets/swf/canvas.ts` `resolvePaint()` | Canvas2D has no reflect/repeat gradient spread; `pad` is used for all. BT3 art is verified pad-only so far. |
| Bitmap-fill smoothing | `assets/swf/canvas.ts` | `smooth=false` bitmap fills should render pixelated; patterns are always smoothed. |
| Flash static-text glyphs | `assets/swf/symbols.ts` `parseFontTag` | Font glyph shape outlines are skipped (code tables only, for string decoding). In-canvas HUD draws with system fonts; Flash glyph rendering only matters for menu art fidelity (M5). |
| Sound streaming | `assets/swf/index.ts` | `SoundStreamHead/Block` tags are counted, not assembled. DefineSounds carry all gameplay cues. |
| Morph playback | `assets/swf/canvas.ts` `buildShapeLayers(morph)` | Morph shape interpolation implemented at parse level (run/color lerp); playback timeline is M3+. |
| `ScreenEffectsLayer` | `world/BubbleField.ts` `addEffect()` | Screen-level effect layer attaches to `TopEffectsLayer` until the world-level layer exists. |
| Ink screen effect | `entities/Tank.ts` `inkTimer` | Timer ticks; the full-screen ink overlay drawing is an M5 skin pass (the 120-frame status + forcefield suppression work). |
| Screen shake/flash | `world/BubbleField.ts` `screen` sink | The sink receives shake/flash calls (apocalypse, massive cannon, teleports) but the renderer does not consume them yet (M5). |
| Charge mechanics | — | **Vestigial in the original** (`docs 07 §9`): charge meter code exists but no part sets it. Not ported. |
| `blnHardened` | `entities/Tank.ts` damage chain | **Never set in the original** (docs 07 §9); damage chain keeps the check position for fidelity. |
| Sponsor/preload frames | `world/GameWorld.ts` tutorial captions | The `ag` sponsor frame is stripped (open-source port; licensing-safe). |
| Upgrade-menu win/lose screens | `world/GameWorld.ts` | The "Edit" path into the TankCreatorScreen (M4) and the win/lose screens around it (M5). |

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
- **M3 timing basis:** the Rocket Launcher's real-time `Timer(100,10)` and the
  art-driven charge/shimmer timelines (massive cannon 20 frames, shield 180
  frames) are ported as fixed frame counts at 50 fps — the frame-based game
  loop is deterministic where the original mixed real-time timers (docs 06
  §4.9, §4.3, §4.4).
