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
    // Sampled from the original's Bubblefield render (sprite 1551): the
    // interior is fully transparent — the stage's #142b2c shows through —
    // and only the outer ~28% of the radius carries a soft light-blue ring
    // that rises to near-white at the very edge.
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, "rgba(193,231,249,0)");
    grad.addColorStop(0.7, "rgba(193,231,249,0)");
    grad.addColorStop(0.75, "rgba(179,230,255,0.04)");
    grad.addColorStop(0.85, "rgba(191,228,248,0.44)");
    grad.addColorStop(0.92, "rgba(193,231,249,0.71)");
    grad.addColorStop(0.97, "rgba(193,231,251,0.9)");
    grad.addColorStop(1, "rgba(242,249,254,0.99)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
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
