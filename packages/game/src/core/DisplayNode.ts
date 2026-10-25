/**
 * Micro display list — the Canvas2D counterpart of the AS3 DisplayObject tree.
 *
 * Mirrors the semantics the game relies on (docs 11 §3 architecture table):
 * containers with x/y/scale/rotation(deg)/alpha/visible, children in z-order
 * via addChild/addChildAt/removeChild, and a draw callback for leaves.
 *
 * The renderer (render/Renderer.ts) walks this tree and composes transforms.
 * Keeping rotation in degrees internally matches the original (`_-KM` is
 * degree-based everywhere; conversion to radians happens only at draw time).
 */

export type DrawFn = (ctx: CanvasRenderingContext2D) => void;

export class DisplayNode {
  x = 0;
  y = 0;
  /** Uniform scale; per-axis when needed via scaleX/scaleY. */
  scaleX = 1;
  scaleY = 1;
  /** Degrees, Flash convention (clockwise, y-down). */
  rotation = 0;
  alpha = 1;
  visible = true;
  /** Draw callback for leaf nodes (containers leave this unset). */
  draw: DrawFn | null = null;

  private children: DisplayNode[] = [];
  private parent: DisplayNode | null = null;
  private name = "";

  constructor(draw?: DrawFn, name = "") {
    if (draw) this.draw = draw;
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  getParent(): DisplayNode | null {
    return this.parent;
  }

  getChildCount(): number {
    return this.children.length;
  }

  getChildAt(index: number): DisplayNode | null {
    return this.children[index] ?? null;
  }

  /** Index of this node within its parent, or −1. */
  getIndex(): number {
    return this.parent ? this.parent.children.indexOf(this) : -1;
  }

  addChild(child: DisplayNode): DisplayNode {
    return this.addChildAt(child, this.children.length);
  }

  addChildAt(child: DisplayNode, index: number): DisplayNode {
    if (child.parent) child.parent.removeChild(child);
    if (index < 0) index = 0;
    if (index > this.children.length) index = this.children.length;
    this.children.splice(index, 0, child);
    child.parent = this;
    return child;
  }

  removeChild(child: DisplayNode): DisplayNode | null {
    const i = this.children.indexOf(child);
    if (i === -1) return null;
    this.children.splice(i, 1);
    child.parent = null;
    return child;
  }

  removeFromParent(): void {
    if (this.parent) this.parent.removeChild(this);
  }

  removeAllChildren(): void {
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
  }

  /** Topmost-child convenience (forcefield keeps itself as last child). */
  makeTopmost(): void {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i !== -1 && i !== this.parent.children.length - 1) {
      this.parent.children.splice(i, 1);
      this.parent.children.push(this);
    }
  }

  /**
   * Local point → parent-space point (AS3 localToGlobal for a single hop).
   * The Renderer composes full chains itself; this is for gameplay math.
   */
  toParentSpace(px: number, py: number): { x: number; y: number } {
    // Apply this node's transform: translate → rotate → scale (Flash order).
    const cos = Math.cos(this.rotation * (Math.PI / 180));
    const sin = Math.sin(this.rotation * (Math.PI / 180));
    const sx = px * this.scaleX;
    const sy = py * this.scaleY;
    return {
      x: this.x + sx * cos - sy * sin,
      y: this.y + sx * sin + sy * cos,
    };
  }

  /** Walk the subtree (depth-first, parents first) applying `fn`. */
  forEachDepthFirst(fn: (node: DisplayNode) => void): void {
    fn(this);
    for (const c of this.children) c.forEachDepthFirst(fn);
  }
}
