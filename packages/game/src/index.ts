/**
 * @open-bt3/game — public API.
 *
 * Layering (dependencies point downward only):
 *   core    — constants, math, FixedLoop, Input, DisplayNode, GameData
 *   data    — vendored part/tank/wave databases with typed accessors
 *   tanks   — TankData + the AES tank-code codec (ported from the game's own
 *             as3crypto stack)
 *   entities— Tank / EnemyAI / Weapon / guns / bullets / life bubbles
 *   world   — GameWorld (transit + store + waves), BubbleField, FieldStore
 *   ui      — AvatarInterface (in-canvas HUD + input controller)
 *   render  — Canvas2D display-list renderer + field art
 *   assets  — SWF parser + asset bundle (user-supplied SWF at runtime)
 *
 * All re-exports are enumerated explicitly (no `export *`) so bundlers with
 * strict static analysis (Turbopack) resolve every name.
 */

// ---------------------------------------------------------------- core
export {
  ACCEL,
  AREA_RANGE_MULT,
  AVATAR_FRICTION,
  BUBBLE_COLLECT_DIST,
  BUBBLE_DRIFT_MAX,
  BUBBLE_DRIFT_MIN,
  BUBBLE_MAGNET_BASE_RADIUS,
  BUBBLE_MAGNET_FORCED_SPEED,
  BUBBLE_MAGNET_MAX_SPEED,
  BUBBLE_PICKUP_RADIUS_SQ,
  BULLET_WALL_RADIUS,
  BULLET_WALL_RADIUS_SQ,
  DEFAULT_FPS,
  ENEMY_FORCE_DECAY,
  ENEMY_RIM_FRACTION,
  ENEMY_TURN_CHANCE_PER_FRAME,
  ENEMY_TURN_RATE,
  FPS_OPTIONS,
  FIELD_RADIUS,
  FORCEFIELD_BREAK_DAMAGE,
  FORCEFIELD_CAPACITY,
  FORCEFIELD_REGEN_PERIOD,
  FRICTION_SNAP,
  HUD_SLIDE_FRAMES,
  INFECT_PERIOD,
  INK_FRAMES,
  JAM_FRAMES,
  LEVELUP_SPAWN_DIVISOR,
  LIFE_BUBBLE_LARGE,
  LIFE_BUBBLE_MEDIUM,
  LIFE_BUBBLE_SMALL,
  LOCAL_ID_START,
  MAX_VELOCITY,
  PROFILE_FIELD,
  SECONDARY_COOLDOWN_DEFAULT,
  STAGE_CENTER_X,
  STAGE_CENTER_Y,
  STAGE_COLOR,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  STICKY_FRAMES,
  STICKY_SPEED_MULT,
  STORAGE_KEY_PROFILE,
  STORAGE_KEY_SETTINGS,
  TANK_LEVEL_LIFE,
  TANK_WALL_RADIUS,
  TRANSIT_ARRIVE_DIST_SQ,
  TRANSIT_STEP_DIVISOR,
  TRANSIT_STEP_FACTOR,
  VERSION_TEXT,
  WEAKEN_FRAMES,
} from "./core/constants";
export {
  DEG,
  angleDelta,
  areaInRange,
  atan2Deg,
  cosDeg,
  distSqrd,
  lengthDeg,
  pointInCircle,
  randFloat,
  randInt,
  rotateToward,
  sinDeg,
  wrapDeg,
} from "./core/math";
export type { Vec } from "./core/math";
export { FixedLoop } from "./core/FixedLoop";
export type { FixedLoopOptions } from "./core/FixedLoop";
export { Input } from "./core/Input";
export type { InputSnapshot } from "./core/Input";
export { DisplayNode } from "./core/DisplayNode";
export type { DrawFn } from "./core/DisplayNode";
export { GameData } from "./core/GameData";
export type { Direction, SettingsState } from "./core/GameData";

// ---------------------------------------------------------------- data
export {
  CLASS_DATA,
  PART_BUCKETS,
  TIER_UNLOCKS,
  getBubbleCost,
  getClassCost,
  getClassData,
  getDefaultUnlockedObjects,
  getGunCost,
  getPartShortName,
  getLower,
  getPart,
  getPartName,
  getPartPluralName,
  getPartsByBucket,
  getTier,
  isWeapon,
} from "./data/parts";
export type { ClassData, PartRow } from "./data/parts";
export {
  ARCHETYPE_RULES,
  RULE_FIELD,
  clauseMatches,
  effectiveRule,
  matchesRule,
  parseRule,
} from "./data/rules";
export type { RuleClause, TankStats } from "./data/rules";
export {
  AVATAR_PRESETS,
  BOSSES,
  ENEMY_BANK,
  ENEMY_BANK_STATS,
  getStartingAvatar,
  searchLocalAvatarOffers,
  statRecord,
} from "./data/tanks";
export {
  WAVE_TABLES,
  UnitTable,
  chooseWaveOption,
  generateBossWave,
  generateWave,
  gridDistance,
} from "./data/waves";
export type { Wave, WaveInstruction, WaveOption, WaveUnit } from "./data/waves";

// ---------------------------------------------------------------- tanks
export { TankData, computeDifficultyRating, deriveClassFromArea } from "./tanks/TankData";
export type { TankDetail } from "./tanks/TankData";
export {
  KEY_SUFFIX,
  decryptTankCode,
  deriveKey,
  encryptTankCode,
  fromHex,
  hexToUtf8,
  randomKeyCap,
  toHex,
  utf8ToHex,
} from "./tanks/tank-code";
export { aesEcbDecrypt, aesEcbEncrypt, pkcs5Pad, pkcs5Unpad } from "./tanks/crypto/aes";

// ---------------------------------------------------------------- entities
export type {
  DamageTargets,
  EffectLayer,
  FieldBullet,
  FieldContext,
  SoundCue,
  TankLike,
} from "./entities/field-context";
export type { EffectRequest } from "./entities/field-context";
export { TANK_TYPE, Tank, makePartView } from "./entities/Tank";
export type { TankOwnerType } from "./entities/Tank";
export { EnemyAI } from "./entities/EnemyAI";
export { LifeBubble } from "./entities/LifeBubble";
export { Bullet, angleToTarget, drawShellBullet } from "./entities/bullets/Bullet";
export type { BulletOptions } from "./entities/bullets/Bullet";
export { Weapon } from "./entities/weapons/Weapon";
export type { WeaponMaster } from "./entities/weapons/Weapon";
export {
  BehaviorPart,
  EnemySeekerBullet,
  EnemyShellBullet,
  ShellBullet,
  createBehaviorForPart,
  createWeaponForPart,
  wallRadius,
} from "./entities/weapons/guns";

// ---------------------------------------------------------------- world
export { WORLD_MODE, GameWorld } from "./world/GameWorld";
export type { JumpDirection, WorldMode } from "./world/GameWorld";
export { BubbleField } from "./world/BubbleField";
export type { FieldOptions } from "./world/BubbleField";
export { DESTROYED, FieldStore } from "./world/FieldStore";
export type { FieldRecord, StoredEnemy } from "./world/FieldStore";

// ---------------------------------------------------------------- ui
export { AvatarInterface, roundRect } from "./ui/AvatarInterface";
export type { AdjustWorldFn } from "./ui/AvatarInterface";
export { UpgradeMenu, describeTankParts } from "./ui/UpgradeMenu";
export type { UpgradeMenuContext } from "./ui/UpgradeMenu";

// ---------------------------------------------------------------- render
export { renderTree } from "./render/Renderer";
export { makeExitMarkers, makeFieldBackground } from "./render/art/FieldArt";

// ---------------------------------------------------------------- assets
export {
  BitReader,
  TAG_NAMES,
  buildJPEG,
  buildShapeLayers,
  characterByClassName,
  decodeJPEG3,
  decodeLossless,
  decompressSWF,
  drawShapeLayers,
  expandLossless,
  imageFromJPEG,
  iterTags,
  loadSwfAssets,
  parseButtonTag,
  parseEditTextTag,
  parseExportAssets,
  parseFontNameTag,
  parseFontTag,
  parseMorphShapeTag,
  parsePlace,
  parseShapeRecords,
  parseShapeTag,
  parseSound,
  parseSpriteTag,
  parseSymbolClass,
  parseTextTag,
  pathForLayer,
  readHeader,
  resolvePaint,
} from "./assets/swf/index";
export type {
  FillStyle,
  GradientStop,
  LineStyle,
  MorphLerp,
  ParsedButton,
  ParsedEditText,
  ParsedFont,
  ParsedMorph,
  ParsedShape,
  ParsedShapeRecords,
  ParsedSprite,
  ParsedText,
  PxOp,
  PxRun,
  ResolvedPaint,
  ShapeLayer,
  ShapeOp,
  ShapeRun,
  SpritePlacement,
  SwfAssetBundle,
  SwfCensusEntry,
  SwfCharacter,
  SwfColor,
  SwfCounts,
  SwfCxform,
  SwfHeaderInfo,
  SwfImage,
  SwfMatrix,
  SwfRect,
  SwfSound,
  SwfTag,
  TextRecord,
} from "./assets/swf/index";
