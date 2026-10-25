/**
 * Procedural field art (M1). The original field background is a big soft
 * radial-gradient bubble (BF_BG_mc, 847.5px wide) with four exit markers.
 * The symbol-art pipeline (M2) will swap this for the real exported art.
 */

import { FIELD_RADIUS } from "../../core/constants";
import { DisplayNode } from "../../core/DisplayNode";

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
