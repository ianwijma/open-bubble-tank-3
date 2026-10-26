/**
 * SwfArtStore — turns a parsed SWF bundle into DisplayNode art.
 *
 * Resolution rule (verified against the dossier's symbol_map.json): the
 * game's class names appear in SymbolClass either top-level (`_-7E`,
 * `_-U7`) or packaged (`_-ct.AGunBasicCannon`, `_-14._-QM`) — so a lookup
 * by exact name or by `.${claType}` suffix resolves both naming layers.
 *
 * Instantiation walks the DefineSprite frame-1 placement graph (depth
 * ordered, `move` records updating prior depths) and renders shapes via
 * the Canvas2D layer builder (canvas.ts). Frame timelines stay static:
 * the game drives all motion in code (docs 11 §2).
 */

import { DisplayNode } from "../../core/DisplayNode";
import { drawShapeLayers, buildShapeLayers } from "./canvas";
import type { SwfAssetBundle, SwfImage, ParsedShape, ParsedMorph, SpritePlacement, SwfMatrix, SwfCxform } from "./index";

export class SwfArtStore {
  private readonly shapeCache = new Map<number, ReturnType<typeof buildShapeLayers>>();

  constructor(readonly bundle: SwfAssetBundle) {}

  /** Resolve a character id from a game class name (exact or suffix match). */
  cidForClass(name: string): number | null {
    const exact = this.bundle.symbolByName.get(name);
    if (exact !== undefined) return exact;
    for (const [cid, className] of this.bundle.symbolNames) {
      if (className === name || className.endsWith(`.${name}`)) return cid;
    }
    return null;
  }

  cidForClaType(claType: string | undefined): number | null {
    return claType ? this.cidForClass(claType) : null;
  }

  /** Build a fresh DisplayNode for a character (null = no renderable art).
   * A malformed symbol never takes the world build down — it degrades to
   * null and the caller falls back to procedural art. */
  instantiate(cid: number): DisplayNode | null {
    const character = this.bundle.characters.get(cid);
    if (!character) return null;
    try {
      switch (character.type) {
        case "sprite":
          return this.instantiateSprite(character.sprite);
        case "shape":
          return this.instantiateShapeNode(character.shape);
        case "morph":
          return this.instantiateShapeNode(character.morph);
        case "image":
          return this.instantiateImage(character.image);
        default:
          return null; // text/button/binary: not needed for gameplay art
      }
    } catch {
      return null;
    }
  }

  /** Frame-1 placement graph → DisplayNode tree. */
  private instantiateSprite(sprite: { id: number; placements: SpritePlacement[] }): DisplayNode {
    const node = new DisplayNode(undefined, `sprite${sprite.id}`);
    // depth → latest placement (a `move` record updates the prior depth)
    const byDepth = new Map<number, SpritePlacement>();
    for (const p of sprite.placements) {
      if (p.frame !== 1) continue; // static instantiation = frame 1
      if (p.charId === undefined) continue; // move-only record
      byDepth.set(p.depth, p);
    }
    const ordered = [...byDepth.values()].sort((a, b) => a.depth - b.depth);
    for (const p of ordered) {
      const child = this.instantiate(p.charId!);
      if (!child) continue;
      applyMatrix(child, p.matrix);
      applyCxform(child, p.colorTransform);
      if (p.name) child.setName(p.name);
      node.addChild(child);
    }
    return node;
  }

  private instantiateShapeNode(shape: ParsedShape | ParsedMorph): DisplayNode {
    let layers = this.shapeCache.get(shape.id);
    if (!layers) {
      layers = buildShapeLayers(shape);
      this.shapeCache.set(shape.id, layers);
    }
    const images = this.bundle.images;
    return new DisplayNode((ctx) => drawShapeLayers(ctx, layers!, images), `shape${shape.id}`);
  }

  private instantiateImage(image: SwfImage): DisplayNode | null {
    const source = image.source;
    if (!source) return null;
    return new DisplayNode((ctx) => {
      ctx.drawImage(source, 0, 0);
    }, `image${image.id}`);
  }
}

/** Apply a SWF MATRIX (unitless a..d, twips tx/ty) to a DisplayNode. */
function applyMatrix(node: DisplayNode, m: SwfMatrix | undefined): void {
  if (!m) return;
  node.scaleX = m.a;
  node.scaleY = m.d;
  node.rotation = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  node.x = m.tx / 20;
  node.y = m.ty / 20;
}

/** Apply a CXFORMWITHALPHA (multipliers ÷256, offsets raw): alpha scales
 * now; channel tints are retained for the renderer (tintedCss, ledger). */
function applyCxform(node: DisplayNode, cx: SwfCxform | undefined): void {
  if (!cx) return;
  node.cxform = cx;
  node.alpha *= cx.aM;
}

// ------------------------------------------------------------ global store

let current: SwfArtStore | null = null;

/** Install the loaded bundle's art (call after `loadSwfAssets`). */
export function setArtStore(store: SwfArtStore | null): void {
  current = store;
}

export function getArtStore(): SwfArtStore | null {
  return current;
}

/** Convenience: instantiate by game class name (null when absent). */
export function instantiateClass(name: string): DisplayNode | null {
  if (!current) return null;
  const cid = current.cidForClass(name);
  return cid === null ? null : current.instantiate(cid);
}
