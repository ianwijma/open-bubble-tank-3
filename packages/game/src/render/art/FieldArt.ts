/**
 * Field art — the real `Bubblefield` symbol (cid 1551, containing BF_BG_mc
 * and the BFPoint_* exit markers) when a SWF is loaded, else the procedural
 * soft-gradient field (M1 fallback).
 */

import { FIELD_RADIUS } from "../../core/constants";
import { DisplayNode } from "../../core/DisplayNode";
import { getArtStore } from "../../assets/swf/art";

/** The Bubblefield symbol's frame-1 tree, scaled to the wave SCALE. */
export function makeBubblefieldArt(scale: number): DisplayNode | null {
  const art = getArtStore();
  if (!art) return null;
  const cid = art.cidForClass("Bubblefield");
  if (cid === null) return null;
  const node = art.instantiate(cid);
  if (!node) return null;
  node.scaleX = scale;
  node.scaleY = scale;
  return node;
}

export function makeFieldBackground(scale: number): DisplayNode {
  const r = FIELD_RADIUS * scale;
  const node = new DisplayNode((ctx) => {
    // Deep-water glow: light center → tinted rim (matches the original's blue field).
    const grad = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r);
    grad.addColorStop(0, "rgba(150,210,255,0.5)");
    grad.addColorStop(0.55, "rgba(90,160,230,0.38)");
    grad.addColorStop(0.92, "rgba(40,100,190,0.32)");
    grad.addColorStop(1, "rgba(20,60,140,0.05)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // Rim line.
    ctx.strokeStyle = "rgba(120,190,255,0.5)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }, "fieldBG");
  node.scaleX = scale;
  node.scaleY = scale;
  return node;
}

/** The 4 exit markers (`BFPoint_left/right/top/bottom_mc`). */
export function makeExitMarkers(scale: number): DisplayNode {
  const r = FIELD_RADIUS * scale;
  const holder = new DisplayNode(undefined, "exitMarkers");
  const positions: Array<[number, number]> = [
    [-r, 0],
    [r, 0],
    [0, -r],
    [0, r],
  ];
  for (const [x, y] of positions) {
    const marker = new DisplayNode((ctx) => {
      ctx.fillStyle = "rgba(190,230,255,0.75)";
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }, "exitMarker");
    marker.x = x;
    marker.y = y;
    holder.addChild(marker);
  }
  return holder;
}
