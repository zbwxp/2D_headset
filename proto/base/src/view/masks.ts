// Drawing an item under masks (doc 18 §1.7b / §29.2b) — ONE routine for B (Canvas2DRef) and Fabric (MaskedPath).
// The item is painted into a scratch layer under the SAME transform as the target; the mask region (the union of the
// source fills' areas and the source curves' strokes, drawn with the same stroke parameters as the drawn lines,
// `inkStyle`) is painted into a second scratch layer; the item layer keeps only the region (`destination-in`, mode
// `inside`) or loses it (`destination-out`, mode `outside`), mask after mask (AND); only the item's device bounding
// box is composited back, so nothing already on the target is touched. Same technique as the fill's own-ink cut
// (ownInk.ts). Why not Fabric's `clipPath`: fabric 7.4.0 draws a clip object with fill only (stroke ''), so a stroke
// could not be a mask source (see ownInkFill.ts). Known, as for the own-ink cut: anti-aliased edges are composited,
// not exact geometry.
import { Path } from 'fabric'
import { cubicsPath2D, FILL_RULE, inkRuns, inkStyle, type EvalMask } from '../evaluate'
import type { Vec } from '../schema'

let itemLayer: HTMLCanvasElement | null = null
let maskLayer: HTMLCanvasElement | null = null
const layer = (c: HTMLCanvasElement | null, W: number, H: number) => {
  const l = c ?? document.createElement('canvas')
  if (l.width < W || l.height < H) {
    l.width = Math.max(l.width, W)
    l.height = Math.max(l.height, H)
  }
  return l
}

/** the region of one mask (world coordinates) drawn opaque on `l` */
export function paintRegion(l: CanvasRenderingContext2D, m: EvalMask) {
  l.fillStyle = '#000'
  l.strokeStyle = '#000'
  for (const f of m.fills) if (f.cubics.length) l.fill(cubicsPath2D(f.cubics, true), FILL_RULE)
  for (const c of m.strokes) {
    const st = inkStyle(c)
    l.lineWidth = st.width
    l.lineCap = st.cap
    l.lineJoin = st.join
    l.miterLimit = st.miterLimit
    const p = new Path2D()
    for (const run of inkRuns(c, c.segments.map((s) => s.id))) p.addPath(cubicsPath2D(run))
    l.stroke(p)
  }
}

/**
 * Paint an item through its masks on `ctx` (current transform = world → device). `worldPts` bound the item
 * (control points), `pad` (world units) covers its stroke; `draw` paints the item on a context in world coordinates.
 */
export function paintMasked(ctx: CanvasRenderingContext2D, masks: EvalMask[], worldPts: Vec[], pad: number, draw: (l: CanvasRenderingContext2D) => void) {
  const m = ctx.getTransform()
  const s = Math.hypot(m.a, m.b) + Math.hypot(m.c, m.d)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const v of worldPts) {
    const x = m.a * v.x + m.c * v.y + m.e, y = m.b * v.x + m.d * v.y + m.f
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  const W = ctx.canvas.width, H = ctx.canvas.height
  const padD = pad * s + 2
  const bx = Math.max(0, Math.floor(x0 - padD)), by = Math.max(0, Math.floor(y0 - padD))
  const bw = Math.min(W, Math.ceil(x1 + padD)) - bx, bh = Math.min(H, Math.ceil(y1 + padD)) - by
  if (bw <= 0 || bh <= 0) return
  itemLayer = layer(itemLayer, W, H)
  maskLayer = layer(maskLayer, W, H)
  const li = itemLayer.getContext('2d')!
  const lm = maskLayer.getContext('2d')!
  li.setTransform(1, 0, 0, 1, 0, 0)
  li.globalCompositeOperation = 'source-over'
  li.clearRect(bx, by, bw, bh)
  li.setTransform(m)
  draw(li)
  for (const mk of masks) {
    lm.setTransform(1, 0, 0, 1, 0, 0)
    lm.globalCompositeOperation = 'source-over'
    lm.clearRect(bx, by, bw, bh)
    lm.setTransform(m)
    paintRegion(lm, mk)
    li.setTransform(1, 0, 0, 1, 0, 0)
    li.globalCompositeOperation = mk.mode === 'inside' ? 'destination-in' : 'destination-out'
    li.drawImage(maskLayer, bx, by, bw, bh, bx, by, bw, bh)
    li.globalCompositeOperation = 'source-over'
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(itemLayer, bx, by, bw, bh, bx, by, bw, bh)
  ctx.restore()
}

/** A Fabric object for a masked curve or fill: its `_render` paints through `paintMasked` (world coordinates). */
export class MaskedPath extends Path {
  constructor(
    d: ConstructorParameters<typeof Path>[0],
    private readonly masks: EvalMask[],
    private readonly worldPts: Vec[],
    private readonly pad: number,
    private readonly drawWorld: (l: CanvasRenderingContext2D) => void,
  ) {
    super(d, { fill: '', stroke: '', selectable: false, evented: false, objectCaching: false })
  }
  _render(ctx: CanvasRenderingContext2D) {
    ctx.save()
    ctx.translate(-this.pathOffset.x, -this.pathOffset.y) // world coordinates
    paintMasked(ctx, this.masks, this.worldPts, this.pad, this.drawWorld)
    ctx.restore()
  }
}
