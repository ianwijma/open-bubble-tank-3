/**
 * TankCreatorScreen — the in-canvas tank editor (docs 04 §4.5 + the
 * decompiled creator flow). M4 scope:
 *
 *   - part palette of UNLOCKED parts (grouped: primary / secondary /
 *     interface / body), each showing its GP/BP costs,
 *   - placement canvas: click to drop the selected part at the snapped
 *     cursor; mirror toggle places the symmetric twin (cross-referenced),
 *   - click a placed part to select; Delete removes it (+ twin),
 *   - class selector 1..6 (gated by maxClass + 0-budget tiers),
 *   - live budget bars (GP used/cap, BP used/100) + derived stats
 *     (life / returned / speed from the verbatim formulas),
 *   - Save (exports through the tank-code envelope) / Cancel.
 *
 * Text input is M5 (the name/author fields use fixed defaults until the
 * in-canvas keyboard lands — stubs ledger).
 */

import { DisplayNode, type DrawFn } from "../core/DisplayNode";
import { STAGE_HEIGHT, STAGE_WIDTH } from "../core/constants";
import {
  CLASS_DATA,
  getBubbleCost,
  getGunCost,
  getPartName,
  getPartsByBucket,
  isWeapon,
  type PartRow,
} from "../data/parts";
import { TankCreator, type CreatorPart } from "../tanks/creator";
import { makePartView } from "../entities/Tank";
import { TankData } from "../tanks/TankData";

export interface TankCreatorOptions {
  isAvatar: boolean;
  maxClass: number;
  unlockedObjects: ReadonlySet<number>;
  alwaysUnlocked: ReadonlySet<number>;
  tier: number;
  /** Seed parts (editing an existing tank). */
  seed?: TankData | null;
  onDone: (saved: TankData | null) => void;
}

interface PaletteEntry {
  part: PartRow;
  label: string;
  gun: number;
  bubble: number;
}

const PALETTE_GROUPS: Array<{ bucket: Parameters<typeof getPartsByBucket>[0]; title: string }> = [
  { bucket: "avatarPrimary", title: "Primary" },
  { bucket: "avatarSecondary", title: "Secondary" },
  { bucket: "interfaces", title: "Interface" },
  { bucket: "bodies", title: "Body" },
];

export class TankCreatorScreen {
  readonly view = new DisplayNode((ctx) => this.draw(ctx), "tankCreator");

  private readonly creator: TankCreator;
  private readonly opts: TankCreatorOptions;
  private palette: PaletteEntry[] = [];
  private selectedIndex = -1;
  private mirror = false;
  private hoverPart: string | null = null;
  private mouse = { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2, down: false, prevDown: false };
  private dragName: string | null = null;
  private tankName = "My Tank";
  private author = "Player";
  private closed = false;

  constructor(opts: TankCreatorOptions) {
    this.opts = opts;
    this.creator = new TankCreator(opts.isAvatar, opts.maxClass, opts.unlockedObjects, opts.alwaysUnlocked);
    if (opts.seed) {
      // import path: part rows straight into the editor (names regenerated)
      this.creator.importParts(
        opts.seed.details.map((d) => ({
          name: `s${d.type}_${Math.random().toString(36).slice(2, 7)}`,
          type: d.type,
          twin: "",
          x: d.x,
          y: d.y,
          rotation: d.rotation,
          scale: d.scale,
          radius: d.radius,
        })),
      );
      this.tankName = opts.seed.tankName;
      this.author = opts.seed.author;
    }
    this.buildPalette();
  }

  private buildPalette(): void {
    this.palette = [];
    for (const group of PALETTE_GROUPS) {
      for (const part of getPartsByBucket(group.bucket)) {
        if (!this.opts.unlockedObjects.has(part.intObjID) && !this.opts.alwaysUnlocked.has(part.intObjID)) continue;
        this.palette.push({
          part,
          label: `${getPartName(part.intObjID)} (${getGunCost(part.intObjID)}GP/${getBubbleCost(part.intObjID)}BP)`,
          gun: getGunCost(part.intObjID),
          bubble: getBubbleCost(part.intObjID),
        });
      }
    }
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Per-frame input (mouse). The world does not run while the creator is up. */
  run(input: { mouseX: number; mouseY: number; mouseDown: boolean; space?: boolean; deleteKey?: boolean }): void {
    if (this.closed) return;
    this.mouse.prevDown = this.mouse.down;
    this.mouse.down = input.mouseDown;
    this.mouse.x = input.mouseX;
    this.mouse.y = input.mouseY;
    const clicked = this.mouse.down && !this.mouse.prevDown;

    // layout regions (stage space)
    const paletteX = 12;
    const paletteW = 168;
    const canvasX0 = paletteX + paletteW + 12;
    const canvasW = 236;
    const canvasCX = canvasX0 + canvasW / 2; // tank registration center
    const canvasCY = STAGE_HEIGHT / 2 - 30;

    if (clicked) {
      // 1. palette pick
      if (input.mouseX >= paletteX && input.mouseX <= paletteX + paletteW && input.mouseY >= 60 && input.mouseY <= STAGE_HEIGHT - 60) {
        const row = Math.floor((input.mouseY - 60) / 18);
        const entry = this.palette[row];
        if (entry) {
          this.selectedIndex = this.palette.indexOf(entry);
          this.mirror = entry.part.intObjID >= 1000 && entry.part.intObjID < 2000; // bodies mirror by default
        }
        return;
      }
      // 2. class selector (top-right)
      if (input.mouseY >= 60 && input.mouseY <= 84 && input.mouseX >= STAGE_WIDTH - 150) {
        const classIndex = Math.floor((input.mouseX - (STAGE_WIDTH - 150)) / 24);
        const classNum = classIndex + 1;
        if (classNum >= 1 && classNum <= 6) this.creator.setClass(classNum);
        return;
      }
      // 3. save / cancel (bottom-right)
      if (input.mouseY >= STAGE_HEIGHT - 52 && input.mouseY <= STAGE_HEIGHT - 30) {
        if (input.mouseX >= STAGE_WIDTH - 150 && input.mouseX <= STAGE_WIDTH - 88) {
          this.finish(true);
          return;
        }
        if (input.mouseX >= STAGE_WIDTH - 80 && input.mouseX <= STAGE_WIDTH - 18) {
          this.finish(false);
          return;
        }
      }
      // 4. placement / part pick on the canvas
      if (input.mouseX >= canvasX0 && input.mouseX <= canvasX0 + canvasW && input.mouseY >= 96 && input.mouseY <= STAGE_HEIGHT - 60) {
        const snapX = Math.round((input.mouseX - canvasCX) / 7) * 7;
        const snapY = Math.round((input.mouseY - canvasCY) / 7) * 7;
        const hit = this.creator.partList.find(
          (p) => Math.hypot(p.x - (input.mouseX - canvasCX), p.y - (input.mouseY - canvasCY)) < p.radius * p.scale + 3,
        );
        if (hit) {
          this.dragName = hit.name;
          return;
        }
        if (this.selectedIndex !== -1) {
          const entry = this.palette[this.selectedIndex]!;
          this.creator.addPart(entry.part.intObjID, snapX, snapY, this.mirror);
        }
      }
    }

    // drag a picked part (and its mirror twin) with the mouse held
    if (this.mouse.down && this.dragName) {
      const snapX = Math.round((input.mouseX - canvasCX) / 7) * 7;
      const snapY = Math.round((input.mouseY - canvasCY) / 7) * 7;
      this.creator.movePart(this.dragName, snapX, snapY);
    }
    if (!this.mouse.down && this.dragName) this.dragName = null;

    if (input.deleteKey && this.dragName) {
      this.creator.removePart(this.dragName);
      this.dragName = null;
    }
  }

  private finish(save: boolean): void {
    this.closed = true;
    if (!save) {
      this.opts.onDone(null);
      return;
    }
    const data = this.creator.build(this.tankName, this.author);
    this.opts.onDone(data);
  }

  // ------------------------------------------------------------------ draw

  private draw(ctx: CanvasRenderingContext2D): void {
    if (this.closed) return;
    ctx.save();
    // full-screen plate
    ctx.fillStyle = "rgba(8,18,20,0.94)";
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    ctx.fillStyle = "#dff3f5";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(this.opts.isAvatar ? "Tank Creator — Avatar" : "Tank Creator — Enemy", 12, 34);

    // --- palette ---
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(223,243,245,0.8)";
    ctx.fillText("Parts (unlocked)", 12, 52);
    const rows = Math.floor((STAGE_HEIGHT - 120) / 18);
    this.palette.slice(0, rows).forEach((entry, i) => {
      const y = 60 + i * 18;
      const selected = this.selectedIndex === i;
      ctx.fillStyle = selected ? "rgba(127,227,238,0.25)" : "rgba(255,255,255,0.05)";
      ctx.fillRect(12, y - 12, 168, 16);
      ctx.fillStyle = selected ? "#9fe8f0" : "rgba(223,243,245,0.85)";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(entry.label.slice(0, 26), 16, y);
    });

    // --- canvas plate ---
    const canvasX0 = 192;
    const canvasW = 236;
    ctx.fillStyle = "rgba(16,34,38,0.9)";
    ctx.fillRect(canvasX0, 96, canvasW, STAGE_HEIGHT - 156);
    ctx.strokeStyle = "rgba(127,227,238,0.3)";
    ctx.strokeRect(canvasX0, 96, canvasW, STAGE_HEIGHT - 156);
    // registration cross + mirror axis
    const canvasCX = canvasX0 + canvasW / 2;
    const canvasCY = STAGE_HEIGHT / 2 - 30;
    ctx.strokeStyle = "rgba(127,227,238,0.2)";
    ctx.beginPath();
    ctx.moveTo(canvasCX, 100);
    ctx.lineTo(canvasCX, STAGE_HEIGHT - 64);
    ctx.stroke();

    // placed parts (procedural bubbles at snapped positions)
    const partNodes = new Map<string, DisplayNode>();
    for (const part of this.creator.partList) {
      let node = partNodes.get(part.name) ?? null;
      if (!node) {
        node = makePartView({ name: part.name, type: part.type, twin: part.twin, x: 0, y: 0, rotation: part.rotation, scale: part.scale, radius: part.radius });
        partNodes.set(part.name, node);
      }
      node.x = canvasCX + part.x;
      node.y = canvasCY + part.y;
      this.drawNode(ctx, node);
    }
    // hover part highlight
    if (this.dragName) {
      const p = this.creator.partList.find((x) => x.name === this.dragName);
      if (p) {
        ctx.strokeStyle = "#7fe3ee";
        ctx.beginPath();
        ctx.arc(canvasCX + p.x, canvasCY + p.y, p.radius * p.scale + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // --- right panel: class + budgets + stats ---
    const panelX = STAGE_WIDTH - 150;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(223,243,245,0.8)";
    ctx.fillText("Class", panelX, 52);
    for (let c = 1; c <= 6; c++) {
      const x = panelX + (c - 1) * 24;
      const available = this.creator.classAvailable(c);
      ctx.fillStyle = this.creator.currentClass === c ? "#7fe3ee" : available ? "rgba(223,243,245,0.75)" : "rgba(223,243,245,0.2)";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.fillText(String(c), x, 78);
    }
    const budget = this.creator.budget;
    const stats = this.creator.derivedStats();
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(223,243,245,0.85)";
    ctx.fillText(`GP: ${budget.usedGunPoints}/${budget.gunPointsMax}`, panelX, 110);
    this.bar(ctx, panelX, 116, 132, Math.min(1, budget.gunPointsMax > 0 ? budget.usedGunPoints / budget.gunPointsMax : 1), "rgba(255,180,80,0.85)");
    ctx.fillText(`BP: ${budget.usedBubblePoints}/100`, panelX, 146);
    this.bar(ctx, panelX, 152, 132, budget.usedBubblePoints / 100, "rgba(140,220,140,0.85)");
    ctx.fillText(`Life: ${stats.life}`, panelX, 186);
    ctx.fillText(`Bubbles: ${stats.bubblesReturned}`, panelX, 204);
    ctx.fillText(`Speed: ${stats.speed.toFixed(2)}`, panelX, 222);
    ctx.fillStyle = "rgba(223,243,245,0.55)";
    ctx.fillText(this.mirror ? "Mirror: ON (bodies)" : "Mirror: off", panelX, 246);

    // save / cancel
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(140,220,140,0.9)";
    ctx.fillText("Save", STAGE_WIDTH - 146, STAGE_HEIGHT - 36);
    ctx.fillStyle = "rgba(255,120,100,0.9)";
    ctx.fillText("Cancel", STAGE_WIDTH - 78, STAGE_HEIGHT - 36);

    ctx.restore();
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, color: string): void {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(2, w * Math.min(1, Math.max(0, frac))), 8);
  }

  /** Draw a DisplayNode subtree directly (same walk the renderer uses). */
  private drawNode(ctx: CanvasRenderingContext2D, node: DisplayNode): void {
    ctx.save();
    ctx.translate(node.x, node.y);
    if (node.rotation !== 0) ctx.rotate((node.rotation * Math.PI) / 180);
    ctx.scale(node.scaleX, node.scaleY);
    node.draw?.(ctx);
    for (let i = 0; i < node.getChildCount(); i++) {
      const child = node.getChildAt(i);
      if (child) this.drawNode(ctx, child);
    }
    ctx.restore();
  }
}

// re-export for app-layer typing convenience
export type { CreatorPart };
export type { DrawFn };
