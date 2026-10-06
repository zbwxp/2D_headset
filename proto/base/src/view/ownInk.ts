// A fill painted after its own boundary strokes leaves out their ink (PAINT-ORDER.md R4, §4 S2, C1).
// ONE drawing routine for B and Fabric: the fill is painted into a scratch layer under the SAME
// transform as the target, the own strokes are stroked with `destination-out` using the SAME stroke
// parameters as the drawn lines (`inkStyle`), and only the fill's device bounding box is composited
// back. `destination-out` therefore only ever touches the fill's own scratch pixels, never third-party
// objects already on the target (dot). Which strokes are "own" is decided by the core (`ownInk`).
// Checked first on small pictures (ownink.html, e2e/own-ink-check.spec.ts): butt ends, mitres, the
// mitre limit, curved joints, fractional pan / zoom, DPR 1 and 2. Known: the exact cut leaves a faint
// see-through seam along the stroke's inner anti-aliased edge (alpha ≥ 0.75) — open with dot.
import { inkRuns, inkStyle, type Cubic, type EvalCurve, type EvalFill } from '../evaluate'

export function cubicsPath2D(cubics: Cubic[], close = false) {
  const p = new Path2D()
  if (!cubics.length) return p
  p.moveTo(cubics[0][0].x, cubics[0][0].y)
  for (const [, c1, c2, p3] of cubics) p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y)
  if (close) p.closePath()
  return p
}
/** The own ink of a fill on one curve: only the referenced segments, as the core's runs (`inkRuns`). */
export function ownInkPath2D(c: EvalCurve, segmentIds: string[]) {
  const p = new Path2D()
  for (const run of inkRuns(c, segmentIds)) p.addPath(cubicsPath2D(run))
  return p
}

let scratch: HTMLCanvasElement | null = null

/**
 * Paint `fill` on `ctx` (current transform = world → device) without the ink of `own`.
 * `fillPath` / `ownPaths` are in world coordinates.
 */
export function paintFillLeavingOwnInk(ctx: CanvasRenderingContext2D, fill: EvalFill, fillPath: Path2D, own: { curve: EvalCurve; path: Path2D }[]) {
  const m = ctx.getTransform()
  // device bounding box of the fill (control points bound the curve), padded for anti-aliasing; ink
  // outside the fill does not matter, so the box need not include stroke ends beyond the fill
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const c of fill.cubics)
    for (const v of c) {
      const x = m.a * v.x + m.c * v.y + m.e
      const y = m.b * v.x + m.d * v.y + m.f
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const bx = Math.max(0, Math.floor(x0) - 2)
  const by = Math.max(0, Math.floor(y0) - 2)
  const bw = Math.min(W, Math.ceil(x1) + 2) - bx
  const bh = Math.min(H, Math.ceil(y1) + 2) - by
  if (bw <= 0 || bh <= 0) return
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width < W || scratch.height < H) {
    scratch.width = Math.max(scratch.width, W)
    scratch.height = Math.max(scratch.height, H)
  }
  const l = scratch.getContext('2d')!
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.globalCompositeOperation = 'source-over'
  l.clearRect(bx, by, bw, bh)
  l.setTransform(m)
  l.fillStyle = fill.color
  l.fill(fillPath)
  l.globalCompositeOperation = 'destination-out'
  l.strokeStyle = '#000'
  for (const o of own) {
    const st = inkStyle(o.curve)
    l.lineWidth = st.width
    l.lineCap = st.cap
    l.lineJoin = st.join
    l.miterLimit = st.miterLimit
    l.stroke(o.path)
  }
  l.globalCompositeOperation = 'source-over'
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(scratch, bx, by, bw, bh, bx, by, bw, bh)
  ctx.restore()
}
