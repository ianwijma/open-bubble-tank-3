/**
 * Renderer — walks the DisplayNode tree and draws it to a Canvas2D context.
 *
 * Transform composition mirrors the display-list semantics the port relies
 * on: translate → rotate (degrees) → scale, with alpha multiplying down the
 * tree and invisible subtrees skipped. Leaves draw via their `draw` callback
 * in their own local space.
 */

import type { DisplayNode } from "../core/DisplayNode";

export function renderTree(ctx: CanvasRenderingContext2D, root: DisplayNode): void {
  drawNode(ctx, root);
}

function drawNode(ctx: CanvasRenderingContext2D, node: DisplayNode): void {
  if (!node.visible || node.alpha <= 0) return;
  ctx.save();
  if (node.x !== 0 || node.y !== 0) ctx.translate(node.x, node.y);
  if (node.rotation !== 0) ctx.rotate((node.rotation * Math.PI) / 180);
  if (node.scaleX !== 1 || node.scaleY !== 1) ctx.scale(node.scaleX, node.scaleY);
  if (node.alpha !== 1) ctx.globalAlpha *= node.alpha;
  node.draw?.(ctx);
  for (let i = 0; i < node.getChildCount(); i++) {
    const child = node.getChildAt(i);
    if (child) drawNode(ctx, child);
  }
  ctx.restore();
}
