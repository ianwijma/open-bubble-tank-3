/**
 * Tuning constants transcribed from the reverse-engineered game
 * (re/bt3/docs/03-game-mechanics.md, 06-weapons-avatar.md, 07-enemy-ai.md, 08-projectiles.md).
 *
 * All timers count FRAMES at the configured FPS (default 50). All angles are
 * degrees in Flash's screen convention (0° = +x, y-down, clockwise positive).
 * All speeds are px/frame.
 */

/** Logical stage size (SWF [SWF(width="550", height="450"...)]). */
export const STAGE_WIDTH = 550;
export const STAGE_HEIGHT = 450;
/** Half-extents hardcoded throughout the original's aim/HUD math. */
export const STAGE_CENTER_X = STAGE_WIDTH / 2; // 275
export const STAGE_CENTER_Y = STAGE_HEIGHT / 2; // 225

export const FPS_OPTIONS = [35, 50, 65] as const;
export const DEFAULT_FPS = 50;

/** Background color of the original stage (Main.as metadata). */
export const STAGE_COLOR = "#142b2c";

// --- Avatar movement (docs 03 §4b; AvatarInterface._-Km) ---
/** Acceleration per frame while a movement key is held: 0.6 × numSpeed. */
export const ACCEL = 0.6;
/** Max velocity per axis: 6 × numSpeed. */
export const MAX_VELOCITY = 6;
/** Friction per frame toward 0 when no key is held (snaps below 0.5). */
export const AVATAR_FRICTION = 0.09;
export const FRICTION_SNAP = 0.5;
/** Sticky status multiplier/duration (AvatarSticky, 80 frames). */
export const STICKY_SPEED_MULT = 0.3;
export const STICKY_FRAMES = 80;

// --- Bubblefields (docs 03 §2, 07 header) ---
/** Field radius at scale 1 = half the 847.5px BF_BG_mc background. */
export const FIELD_RADIUS = 423.75;
/** Tanks die (drop bubbles) beyond this radius × field scale (_-Zx.IsOutside). */
export const TANK_WALL_RADIUS = 423.75;
/** Bullets despawn beyond this radius × field scale (_-BL wall; 415² = 172225). */
export const BULLET_WALL_RADIUS = 415;
export const BULLET_WALL_RADIUS_SQ = BULLET_WALL_RADIUS * BULLET_WALL_RADIUS; // 172225

// --- Jump transit (docs 03 §2) ---
/** Per-frame step during a field jump: dist/10*0.9 (the "5" arg is overwritten). */
export const TRANSIT_STEP_DIVISOR = 10;
export const TRANSIT_STEP_FACTOR = 0.9;
/** Arrival test: dx²+dy² < 25 (≤5px). */
export const TRANSIT_ARRIVE_DIST_SQ = 25;

// --- Collision / area effects (doc 08) ---
/** Area-effect range test multiplies radius by 1.15 (_-E6). */
export const AREA_RANGE_MULT = 1.15;
/** Half-step-back anti-tunneling sample: pos − move/2. */

// --- Life bubbles (doc 08 §5) ---
/** Bubble denominations: amount<5 → 1s; <50 → 5s; ≥50 → 50s + 5s + 1s. */
export const LIFE_BUBBLE_SMALL = 1;
export const LIFE_BUBBLE_MEDIUM = 5;
export const LIFE_BUBBLE_LARGE = 50;
/** Initial drift speed range px/frame (_-Wq(4,22)), decayed ×0.9/frame. */
export const BUBBLE_DRIFT_MIN = 4;
export const BUBBLE_DRIFT_MAX = 22;
/** Magnet: homing speed ×(1 − dist/(100×class³)); full speed (forced) = 14. */
export const BUBBLE_MAGNET_BASE_RADIUS = 100;
export const BUBBLE_MAGNET_MAX_SPEED = 7;
export const BUBBLE_MAGNET_FORCED_SPEED = 14;
/** Collected when within 10px. */
export const BUBBLE_COLLECT_DIST = 10;
/** Free pickup radius around the avatar (dist² < 10000 = 100px). */
export const BUBBLE_PICKUP_RADIUS_SQ = 10000;

// --- Status effects (doc 03 §4, 07 §6.5) ---
export const JAM_FRAMES = 80;
export const WEAKEN_FRAMES = 80;
export const INK_FRAMES = 120;
export const INFECT_PERIOD = 12; // 1 dmg every 12 frames

// --- Forcefield (passive 5005; doc 06 §5.5) ---
export const FORCEFIELD_CAPACITY = 40;
export const FORCEFIELD_BREAK_DAMAGE = 55;
export const FORCEFIELD_REGEN_PERIOD = 20; // 1 point / 20 frames

// --- HUD (docs 04 §6.2) ---
/** Max life per tank level 0..6 (AvatarInterface.UpdateAvatar). */
export const TANK_LEVEL_LIFE = [50, 100, 170, 250, 400, 800, 2000];
/** Spawn health after a level-up: numLife/75 + 1. */
export const LEVELUP_SPAWN_DIVISOR = 75;
/** Health bar slide: in after change, out after 75 idle frames (0.8/0.2 lerp). */
export const HUD_SLIDE_FRAMES = 75;

// --- Fire model (docs 06) ---
/** Primaries fire every intFireRate + 1 frames (counter −1 = ready). */
/** Secondaries share one cooldown = max intFireRate among secondaries (default 40). */
export const SECONDARY_COOLDOWN_DEFAULT = 40;

// --- Enemy AI (docs 07 §3.3) ---
export const ENEMY_TURN_CHANCE_PER_FRAME = 20; // out of 1000 (~2%)
export const ENEMY_TURN_RATE = 1.5; // deg/frame per speed unit
export const ENEMY_RIM_FRACTION = 0.75; // near-rim threshold of field radius
export const ENEMY_FORCE_DECAY = 0.9;

// --- Class table lives in data/class-data.ts (parts_database.json classData). ---

// --- Save keys (doc 05 §4) ---
export const STORAGE_KEY_SETTINGS = "BTA";
export const STORAGE_KEY_PROFILE = "Player1Profile";
export const PROFILE_FIELD = "strCompressed";
export const LOCAL_ID_START = 10000001;

/** Version stamp shown on the menu, mirroring gData.versionTXT. */
export const VERSION_TEXT = "1.03.3";
