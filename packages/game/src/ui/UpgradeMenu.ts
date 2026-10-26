/**
 * UpgradeMenu — the level-up "choose your next tank" screen (docs 04 §4).
 *
 * NOT a parts shop: the currency system is the Tank Creator's GP/BP budget
 * (M4). This screen offers 3 (2 at edge classes) avatar tanks for classes
 * class−1..class+1 within the target tier's GP budget; picking one REPLACES
 * the avatar (`ViewerUp` → `currentAvatar` → re-place with slot overwrite).
 *
 * Choice generation (`SecondSetup` + `_-96`, UpgradeMenu.as:611-642, 210-299):
 *   - target class c_i = avatarClass + i − 2 for i = 1..3, skipping <1 / >6
 *     (class 1 and 6 therefore get 2 offers, `intTanksToLoad` decremented);
 *   - per-slot GP budget = arrClassData[c−1].arrGP[intTankLevel];
 *   - coin flip toward saved-history "default tanks" (`GetDefaultTank`);
 *     with the profile's my-tanks flag off (port default) the flip always
 *     goes to the search path;
 *   - the server search is dead → the port searches the local avatar bank
 *     (`searchLocalAvatarOffers`, docs 05 §8), with `GetDefaultTank` as the
 *     `SearchFailed` fallback and the current avatar's code as the last
 *     resort so the menu can never soft-lock (offline deviation, ledger).
 *
 * Rendering is in-canvas; the world is NOT driven while this screen is up
 * (the original's Main state 4/5 runs nothing — Main.as:532 Run switch).
 *
 * M4/M5 stubs: Edit (TankCreatorScreen), Search (TankViewerScreen), parts
 * pack manager, blur-trail fade (the port uses a plain alpha fade).
 */

import { DisplayNode } from "../core/DisplayNode";
import { STAGE_CENTER_X, STAGE_HEIGHT, STAGE_WIDTH } from "../core/constants";
import { randInt } from "../core/math";
import { getPartName, getPartPluralName, getPartShortName } from "../data/parts";
import { CLASS_DATA } from "../data/parts";
import type { TankData, TankDetail } from "../tanks/TankData";
import { makePartView } from "../entities/Tank";

/** What the menu needs from the world — keeps this module import-cycle-free. */
export interface UpgradeMenuContext {
  /** Current avatar tank (class source). */
  readonly avatar: TankData;
  /** `intTankLevel` (0..6). */
  readonly level: number;
  /** Local offer search (dead-server replacement; see module doc). */
  searchOffer(classNum: number, gpBudget: number, exclude: ReadonlySet<string>): TankData | null;
  /** `GetDefaultTank` — saved progression history lookup. */
  defaultTank(classNum: number): TankData | null;
  /** `UpdateUnlocked` — grant every part from tiers below `level`. */
  grantTierUnlocks(level: number): void;
  /** `ViewerUp` apply: fade-out finished → replace the avatar (slot overwrite). */
  applyChoice(code: string): void;
  /** `EditTank` — open the TankCreatorScreen seeded with the current avatar. */
  editCurrentTank(): void;
}

interface MenuSlot {
  data: TankData;
  primary: string;
  secondary: string;
  passive: string;
  preview: DisplayNode;
}

/** `_-Wp` — label list formatter, verbatim including its two discarded-substr
 * quirks: the trailing ", " is never trimmed (the trim result is discarded)
 * and for >2 distinct types the short name is used even when amount is 1
 * (the singular trim is discarded too). Empty groups are "N/A". */
function formatLabelGroup(entries: Array<{ type: number; amount: number }>): string {
  if (entries.length === 0) return "N/A";
  const useShort = entries.length > 2;
  let out = "";
  for (const entry of entries) {
    let name: string;
    if (useShort) {
      name = getPartShortName(entry.type);
      if (entry.amount === 1) name.slice(0, name.length - 3); // discarded in the original
    } else if (entry.amount === 1) {
      name = getPartName(entry.type);
    } else {
      name = getPartPluralName(entry.type);
    }
    out += `${entry.amount} ${name}, `;
  }
  if (entries.length === 0) out = "N/A";
  else out.slice(0, out.length - 3); // discarded in the original — trailing ", " stays
  return out;
}

/** `_-Bz` — group tank details into primary/secondary/passive label strings. */
export function describeTankParts(details: TankDetail[]): { primary: string; secondary: string; passive: string } {
  const primary: Array<{ type: number; amount: number }> = [];
  const secondary: Array<{ type: number; amount: number }> = [];
  const passive: Array<{ type: number; amount: number }> = [];
  const bump = (list: Array<{ type: number; amount: number }>, type: number): void => {
    const found = list.find((e) => e.type === type);
    if (found) found.amount++;
    else list.push({ type, amount: 1 });
  };
  for (const detail of details) {
    const category = Math.floor(detail.type / 1000);
    if (category === 2) bump(primary, detail.type);
    else if (category === 3) bump(secondary, detail.type);
    else if (category === 5) bump(passive, detail.type);
  }
  primary.sort((a, b) => a.type - b.type);
  secondary.sort((a, b) => a.type - b.type);
  passive.sort((a, b) => a.type - b.type);
  return {
    primary: formatLabelGroup(primary),
    secondary: formatLabelGroup(secondary),
    passive: formatLabelGroup(passive),
  };
}

/** Preview DisplayNode: the tank's parts laid out at their detail positions,
 * scaled to fit the 158×84 viewer box (`_-aG` fit rule). */
function makeTankPreview(data: TankData): DisplayNode {
  const container = new DisplayNode(undefined, "tankPreview");
  for (const detail of data.details) {
    container.addChild(makePartView(detail));
  }
  const size = data.getRadius() * 2;
  if (size > 0) {
    const scale = Math.min(158 / size, 84 / size, 1);
    container.scaleX = scale;
    container.scaleY = scale;
  }
  return container;
}

const CARD_W = 158;
const CARD_H = 84;
const CARD_SPACING = CARD_W + 23.6; // re-centering steps are 90.5 px per half-slot

export class UpgradeMenu {
  readonly view = new DisplayNode((ctx) => this.drawMenu(ctx), "upgradeMenu");

  private context: UpgradeMenuContext | null = null;
  private slots: MenuSlot[] = [];
  private hoverIndex = -1;
  private alpha = 1;
  private chosenIndex = -1;
  private prevMouseDown = false;
  private firstFrame = true;
  private closed = false;

  /** `Setup(false,false)` — generate choices + grant tier unlocks. */
  setup(context: UpgradeMenuContext): void {
    this.context = context;
    this.closed = false;
    this.chosenIndex = -1;
    this.alpha = 1;
    this.hoverIndex = -1;
    this.firstFrame = true;
    this.prevMouseDown = false;
    this.slots = [];
    context.grantTierUnlocks(context.level);

    const avatarClass = context.avatar.numClass;
    // target classes class−1..class+1 clamped to 1..6 (`_-96` step 2)
    const classes: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const c = avatarClass + i - 2;
      if (c >= 1 && c <= 6) classes.push(c);
    }
    const exclude = new Set<string>();
    for (const c of classes) {
      // 0 budget = class not buildable at this tier (docs 04 §4.5 table)
      const classData = CLASS_DATA[c - 1];
      const gp = classData ? classData.arrGP[context.level] ?? 0 : 0;
      if (gp <= 0) continue;
      // coin flip toward saved-history defaults (`_-96` step 4); the port
      // profile's my-tanks flag is off, so the flip always searches.
      const picked =
        randInt(1, 1) === 0
          ? (context.defaultTank(c) ?? context.searchOffer(c, gp, exclude))
          : context.searchOffer(c, gp, exclude);
      if (!picked) continue; // SearchFailed: empty slots are dropped
      exclude.add(picked.strTankCode);
      const labels = describeTankParts(picked.details);
      this.slots.push({
        data: picked,
        primary: labels.primary,
        secondary: labels.secondary,
        passive: labels.passive,
        preview: makeTankPreview(picked),
      });
    }
    // Offline guarantee (see module doc): offer the current avatar as the
    // last resort when nothing else fits.
    if (this.slots.length === 0) {
      const labels = describeTankParts(context.avatar.details);
      this.slots.push({
        data: context.avatar,
        primary: labels.primary,
        secondary: labels.secondary,
        passive: labels.passive,
        preview: makeTankPreview(context.avatar),
      });
    }
    this.layoutSlots();
  }

  /** Remaining slots re-centered by half-slot steps (`_-aG` step). */
  private layoutSlots(): void {
    const n = this.slots.length;
    for (let i = 0; i < n; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      const x = STAGE_CENTER_X + (i - (n - 1) / 2) * CARD_SPACING;
      slot.preview.x = x;
      slot.preview.y = 130;
    }
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Per-frame: hover, release-to-choose, fade-out. The world does not run.
   * The first frame only syncs the mouse state so a button that was already
   * held (the player was shooting when the level-up fired) cannot choose. */
  run(input: { mouseX: number; mouseY: number; mouseDown: boolean }): void {
    if (this.closed) return;
    if (this.firstFrame) {
      this.firstFrame = false;
      this.prevMouseDown = input.mouseDown;
      return;
    }
    const released = !input.mouseDown && this.prevMouseDown;
    this.prevMouseDown = input.mouseDown;

    // footer "Edit" hit region (TankCreatorScreen path, docs 04 §4.4)
    if (released && this.chosenIndex === -1) {
      const editX0 = STAGE_WIDTH / 2 - 158;
      if (input.mouseY >= STAGE_HEIGHT - 34 && input.mouseY <= STAGE_HEIGHT - 12 && input.mouseX >= editX0 && input.mouseX <= editX0 + 30) {
        this.context?.editCurrentTank();
        this.closed = true;
        return;
      }
    }

    if (this.chosenIndex === -1) {
      // clickable region: the viewer box plus its label column
      const y0 = 88 - CARD_H / 2;
      const y1 = 88 + CARD_H / 2 + 110;
      this.hoverIndex = -1;
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i]!;
        const within =
          Math.abs(input.mouseX - slot.preview.x) <= CARD_W / 2 &&
          input.mouseY >= y0 &&
          input.mouseY <= y1;
        if (within) {
          this.hoverIndex = i;
          break;
        }
      }
      if (released && this.hoverIndex !== -1) {
        this.chosenIndex = this.hoverIndex;
      }
    }
    if (this.chosenIndex !== -1) {
      // fade-out (`alpha -= 0.025`/frame; blur trail is an M5 stub)
      this.alpha -= 0.025;
      if (this.alpha <= 0) {
        const code = this.slots[this.chosenIndex]!.data.strTankCode;
        this.closed = true;
        this.context?.applyChoice(code);
      }
    }
  }

  // ------------------------------------------------------------------ draw

  private drawMenu(ctx: CanvasRenderingContext2D): void {
    if (this.closed) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    // dim the frozen world behind the screen
    ctx.fillStyle = "rgba(6,14,16,0.78)";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    ctx.textAlign = "center";
    ctx.fillStyle = "#dff3f5";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillText("Choose your next tank", STAGE_WIDTH / 2, 58);
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(223,243,245,0.7)";
    ctx.fillText("Pick the tank to grow into — full life triggers the next level-up", STAGE_WIDTH / 2, 80);

    const n = this.slots.length;
    for (let i = 0; i < n; i++) {
      const slot = this.slots[i]!;
      const x = slot.preview.x;
      const y = 88; // preview box center
      const hovered = this.hoverIndex === i && this.chosenIndex === -1;
      const chosen = this.chosenIndex === i;

      // viewer frame
      ctx.strokeStyle = chosen ? "#7fe3ee" : hovered ? "rgba(127,227,238,0.8)" : "rgba(127,227,238,0.35)";
      ctx.lineWidth = chosen ? 2.5 : 1.5;
      ctx.strokeRect(x - CARD_W / 2, y - CARD_H / 2, CARD_W, CARD_H);
      ctx.fillStyle = "rgba(12,26,28,0.85)";
      ctx.fillRect(x - CARD_W / 2, y - CARD_H / 2, CARD_W, CARD_H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - CARD_W / 2, y - CARD_H / 2, CARD_W, CARD_H);
      ctx.clip();
      ctx.translate(x, y);
      if (hovered) {
        const s = 1 + 0.04 * Math.sin(performance.now() / 120);
        ctx.scale(s, s);
      }
      this.drawPreviewTree(ctx, slot.preview);
      ctx.restore();

      // labels (`_-aG`: name / creator / class / primary / secondary / passive)
      const lx = x - CARD_W / 2;
      let ly = y + CARD_H / 2 + 18;
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf7f8";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.fillText(slot.data.tankName, lx, ly);
      ly += 16;
      ctx.fillStyle = "rgba(223,243,245,0.65)";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(`by ${slot.data.author}`, lx, ly);
      ly += 15;
      ctx.fillStyle = "#9fd8de";
      ctx.fillText(`Class: ${slot.data.numClass}`, lx, ly);
      ly += 15;
      ctx.fillStyle = "rgba(223,243,245,0.85)";
      ctx.fillText(`Primary: ${slot.primary}`, lx, ly, CARD_W);
      ly += 14;
      ctx.fillText(`Secondary: ${slot.secondary}`, lx, ly, CARD_W);
      ly += 14;
      ctx.fillText(`Passive: ${slot.passive}`, lx, ly, CARD_W);
    }

    // footer: Edit is live (opens the TankCreatorScreen); Search / Parts
    // Pack remain M4/M5 stubs (stubs ledger)
    ctx.textAlign = "center";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "#9fe8f0";
    ctx.fillText("Edit", STAGE_WIDTH / 2 - 143, STAGE_HEIGHT - 24);
    ctx.fillStyle = "rgba(223,243,245,0.4)";
    ctx.fillText("· Search · Parts Pack — arriving with M4/M5", STAGE_WIDTH / 2 + 46, STAGE_HEIGHT - 24);

    ctx.textAlign = "left";
    ctx.restore();
  }

  /** Render a preview DisplayNode tree (translation-only nodes) directly. */
  private drawPreviewTree(ctx: CanvasRenderingContext2D, node: DisplayNode): void {
    ctx.save();
    ctx.translate(node.x, node.y);
    if (node.rotation !== 0) ctx.rotate((node.rotation * Math.PI) / 180);
    ctx.scale(node.scaleX, node.scaleY);
    node.draw?.(ctx);
    for (let i = 0; i < node.getChildCount(); i++) {
      const child = node.getChildAt(i);
      if (child) this.drawPreviewTree(ctx, child);
    }
    ctx.restore();
  }
}
