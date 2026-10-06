// Fabric object for a fill that leaves out its own stroke ink (PAINT-ORDER.md §4 S2).
// INTERNAL EXTENSION DEPENDENCY (dot): overrides `Path._render` of fabric 7.4.0 (MIT) — not a public
// drawing hook. Relies on: `_render(ctx)` receives the context transformed to the object's local space,
// and `Path` draws its data translated by `-pathOffset` (so `translate(-pathOffset)` gives world
// coordinates). Rejected public routes, checked: `clipPath` (drawObject(ctx, forClipping) draws clip
// objects with fill 'black', stroke '' — no stroke mask) and the object cache (cut shifted ~1 px).
// Regression check: e2e/paint-order.spec.ts P6 cases in A (also at fractional pan and DPR 2).
import { Path } from 'fabric'
import type { EvalCurve, EvalFill } from '../evaluate'
import { paintFillLeavingOwnInk } from './ownInk'

export class OwnInkFill extends Path {
  constructor(
    d: string,
    private readonly fill_: EvalFill,
    private readonly fillPath: Path2D,
    private readonly own: { curve: EvalCurve; path: Path2D }[],
  ) {
    super(d, { fill: fill_.color, stroke: '', selectable: false, evented: false, objectCaching: false })
  }
  _render(ctx: CanvasRenderingContext2D) {
    ctx.save()
    ctx.translate(-this.pathOffset.x, -this.pathOffset.y) // world coordinates
    paintFillLeavingOwnInk(ctx, this.fill_, this.fillPath, this.own)
    ctx.restore()
  }
}
