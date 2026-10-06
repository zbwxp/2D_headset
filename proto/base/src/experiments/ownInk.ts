// S2 pre-check (PAINT-ORDER.md §4, dot): does "the SAME stroke operation used as an inverse mask on
// the fill" exclude exactly the stroke's own ink at butt ends, miter joins (miter limit reached and
// not reached) and curved joints? Experiment page only (ownink.html); not product code.
//
// For each case the boundary B (blue) is painted first (behind), then the fill F (red) in front with
// B's ink excluded. Reference: B stroked ALONE on its own canvas. Check, per pixel inside F's area:
//   alpha(B alone) = 255 → result must be blue (F did not eat B);
//   alpha(B alone) = 0   → result must be red  (no hole cut where B has no ink);
//   in between (anti-aliased edge) → counted, not asserted.
import { Path, StaticCanvas } from 'fabric'

type Pt = [number, number]
type Case = { name: string; boundary: string[]; fill: string; width: number }
const W = 360
const H = 260
const STYLE = { cap: 'butt' as CanvasLineCap, join: 'miter' as CanvasLineJoin, miter: 4 }

// boundary curves as SVG path data (several curves meet end to end: butt ends at the junctions)
const poly = (pts: Pt[]) => 'M ' + pts.map((p) => p.join(' ')).join(' L ')
const cases: Case[] = [
  { name: 'right angles + butt ends', width: 16, boundary: [poly([[60, 60], [300, 60], [300, 200], [60, 200]]), poly([[60, 200], [60, 60]])], fill: poly([[60, 60], [300, 60], [300, 200], [60, 200]]) + ' Z' },
  // tip angle ≈ 30°: miter ratio 1/sin(15°) ≈ 3.9 < 4 → a mitre is drawn
  { name: 'acute 30° (mitre drawn)', width: 14, boundary: [poly([[40, 220], [180, 30], [320, 220]]), poly([[320, 220], [40, 220]])], fill: poly([[40, 220], [180, 30], [320, 220]]) + ' Z' },
  // tip angle ≈ 18°: miter ratio ≈ 6.4 > 4 → falls back to a bevel
  { name: 'acute 18° (limit → bevel)', width: 14, boundary: [poly([[130, 230], [180, 20], [230, 230]]), poly([[230, 230], [130, 230]])], fill: poly([[130, 230], [180, 20], [230, 230]]) + ' Z' },
  {
    name: 'curved, smooth joint + kink',
    width: 12,
    boundary: ['M 60 130 C 60 40 180 40 180 130 C 180 220 300 220 300 130', 'M 300 130 C 260 20 120 240 60 130'],
    fill: 'M 60 130 C 60 40 180 40 180 130 C 180 220 300 220 300 130 C 260 20 120 240 60 130 Z',
  },
]

function ctxOf() {
  const el = document.createElement('canvas')
  el.width = W
  el.height = H
  return el.getContext('2d', { willReadFrequently: true })!
}
function stroke(ctx: CanvasRenderingContext2D, d: string, w: number, color: string) {
  ctx.lineCap = STYLE.cap
  ctx.lineJoin = STYLE.join
  ctx.miterLimit = STYLE.miter
  ctx.lineWidth = w
  ctx.strokeStyle = color
  ctx.stroke(new Path2D(d))
}

/** Canvas2D: fill into a scratch layer, cut B's ink with destination-out, composite. */
function canvas2d(c: Case, protect: boolean) {
  const ctx = ctxOf()
  for (const d of c.boundary) stroke(ctx, d, c.width, '#0000ff')
  const layer = ctxOf()
  layer.fillStyle = '#ff0000'
  layer.fill(new Path2D(c.fill))
  if (protect) {
    layer.globalCompositeOperation = 'destination-out'
    for (const d of c.boundary) stroke(layer, d, c.width, '#000')
  }
  ctx.drawImage(layer.canvas, 0, 0)
  return ctx
}

/**
 * Fabric, try 2: Fabric clip paths ignore stroke (fabric 7.4.0 `drawObject(ctx, forClipping)` sets
 * fill = 'black', stroke = ''), so the clipPath try below cannot work. Instead the fill object applies
 * the SAME Canvas2D cut inside its own cache canvas (objectCaching), where destination-out only
 * touches the fill's own pixels.
 */
class OwnInkFill extends Path {
  ownInk: { d: Path2D; width: number }[] = []
  _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx)
    if (!this.ownInk.length) return
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.translate(-this.pathOffset.x, -this.pathOffset.y) // world coordinates, as Path draws its own data
    for (const s of this.ownInk) {
      ctx.lineCap = STYLE.cap
      ctx.lineJoin = STYLE.join
      ctx.miterLimit = STYLE.miter
      ctx.lineWidth = s.width
      ctx.strokeStyle = '#000'
      ctx.stroke(s.d)
    }
    ctx.restore()
  }
}
/** Fabric, try 3: no object cache; the fill draws itself + the cut into a scratch layer that uses the
 *  main canvas transform, then composites it (the same operation as B). */
class OwnInkFillScratch extends OwnInkFill {
  _render(ctx: CanvasRenderingContext2D) {
    if (!this.ownInk.length) return super._render(ctx)
    const m = ctx.getTransform()
    const layer = document.createElement('canvas')
    layer.width = ctx.canvas.width
    layer.height = ctx.canvas.height
    const l = layer.getContext('2d')!
    l.setTransform(m)
    super._render(l) // fill, then destination-out of the own ink, in the same transform
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(layer, 0, 0)
    ctx.restore()
  }
}
function fabricScratch(c: Case) {
  const el = document.createElement('canvas')
  const canvas = new StaticCanvas(el, { width: W, height: H, enableRetinaScaling: false, renderOnAddRemove: false })
  for (const d of c.boundary)
    canvas.add(new Path(d, { fill: '', stroke: '#0000ff', strokeWidth: c.width, strokeLineCap: STYLE.cap, strokeLineJoin: STYLE.join, strokeMiterLimit: STYLE.miter, objectCaching: false }))
  const f = new OwnInkFillScratch(c.fill, { fill: '#ff0000', stroke: '', objectCaching: false })
  f.ownInk = c.boundary.map((d) => ({ d: new Path2D(d), width: c.width }))
  canvas.add(f)
  canvas.renderAll()
  return canvas.getContext() as CanvasRenderingContext2D
}
function fabricOwn(c: Case) {
  const el = document.createElement('canvas')
  const canvas = new StaticCanvas(el, { width: W, height: H, enableRetinaScaling: false, renderOnAddRemove: false })
  for (const d of c.boundary)
    canvas.add(new Path(d, { fill: '', stroke: '#0000ff', strokeWidth: c.width, strokeLineCap: STYLE.cap, strokeLineJoin: STYLE.join, strokeMiterLimit: STYLE.miter, objectCaching: false }))
  const f = new OwnInkFill(c.fill, { fill: '#ff0000', stroke: '', objectCaching: true })
  f.ownInk = c.boundary.map((d) => ({ d: new Path2D(d), width: c.width }))
  canvas.add(f)
  canvas.renderAll()
  return canvas.getContext() as CanvasRenderingContext2D
}

/** Fabric try 1: the fill's clipPath = B stroked with the same parameters, inverted. */
function fabric(c: Case, protect: boolean) {
  const el = document.createElement('canvas')
  const canvas = new StaticCanvas(el, { width: W, height: H, enableRetinaScaling: false, renderOnAddRemove: false })
  const strokeOpts = { fill: '', strokeWidth: c.width, strokeLineCap: STYLE.cap, strokeLineJoin: STYLE.join, strokeMiterLimit: STYLE.miter, objectCaching: false }
  for (const d of c.boundary) canvas.add(new Path(d, { ...strokeOpts, stroke: '#0000ff' }))
  const f = new Path(c.fill, { fill: '#ff0000', stroke: '', objectCaching: false })
  if (protect) {
    const clips = c.boundary.map((d) => new Path(d, { ...strokeOpts, stroke: '#000' }))
    // one clip object: several boundary curves as one path (their union of ink)
    const merged = new Path(c.boundary.join(' '), { ...strokeOpts, stroke: '#000', inverted: true, absolutePositioned: true })
    void clips
    f.clipPath = merged
  }
  canvas.add(f)
  canvas.renderAll()
  return canvas.getContext() as CanvasRenderingContext2D
}

function check(c: Case, result: CanvasRenderingContext2D) {
  const alone = ctxOf()
  for (const d of c.boundary) stroke(alone, d, c.width, '#0000ff')
  const a = alone.getImageData(0, 0, W, H).data
  const r = result.getImageData(0, 0, W, H).data
  const inside = ctxOf()
  const fp = new Path2D(c.fill)
  let ateStroke = 0
  let holes = 0
  let edges = 0
  let solid = 0
  let open = 0
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside.isPointInPath(fp, x + 0.5, y + 0.5)) continue
      const i = (y * W + x) * 4
      const alpha = a[i + 3]
      const px = [r[i], r[i + 1], r[i + 2], r[i + 3]]
      if (alpha === 255) {
        solid++
        if (!(px[0] <= 2 && px[1] <= 2 && px[2] >= 253 && px[3] >= 253)) ateStroke++
      } else if (alpha === 0) {
        open++
        if (!(px[0] >= 253 && px[1] <= 2 && px[2] <= 2 && px[3] >= 253)) holes++
      } else edges++
    }
  return { solid, open, edges, ateStroke, holes }
}

const results = cases.map((c) => ({
  case: c.name,
  canvas2d: check(c, canvas2d(c, true)),
  canvas2dUnprotected: check(c, canvas2d(c, false)),
  fabric: check(c, fabric(c, true)),
  fabricUnprotected: check(c, fabric(c, false)),
  fabricOwnInkCache: check(c, fabricOwn(c)),
  fabricOwnInkScratch: check(c, fabricScratch(c)),
}))

// Cost probe (informational): 100 protected fills on a 640×420 canvas, DPR 1. Scratch layer reused
// (cleared each time); "full" composites the whole canvas, "bbox" only the fill's bounding box.
function cost() {
  const main = document.createElement('canvas')
  main.width = 640
  main.height = 420
  const ctx = main.getContext('2d')!
  const scratch = document.createElement('canvas')
  scratch.width = 640
  scratch.height = 420
  const l = scratch.getContext('2d')!
  const fills = Array.from({ length: 100 }, (_, i) => {
    const x = 20 + (i % 10) * 60
    const y = 20 + Math.floor(i / 10) * 38
    const d = `M ${x} ${y} L ${x + 50} ${y} L ${x + 50} ${y + 30} L ${x} ${y + 30} Z`
    return { fill: new Path2D(d), ink: new Path2D(d), bbox: [x - 4, y - 4, 58, 38] as const }
  })
  const run = (bbox: boolean) => {
    const t = performance.now()
    for (let rep = 0; rep < 20; rep++)
      for (const f of fills) {
        const [x, y, w, h] = bbox ? f.bbox : [0, 0, 640, 420]
        l.globalCompositeOperation = 'source-over'
        l.clearRect(x, y, w, h)
        l.fillStyle = '#ff0000'
        l.fill(f.fill)
        l.globalCompositeOperation = 'destination-out'
        l.lineWidth = 4
        l.stroke(f.ink)
        ctx.drawImage(scratch, x, y, w, h, x, y, w, h)
      }
    ctx.getImageData(0, 0, 1, 1) // flush
    return +((performance.now() - t) / 20).toFixed(2)
  }
  const plain = () => {
    const t = performance.now()
    for (let rep = 0; rep < 20; rep++) for (const f of fills) (ctx.fillStyle = '#ff0000'), ctx.fill(f.fill)
    ctx.getImageData(0, 0, 1, 1)
    return +((performance.now() - t) / 20).toFixed(2)
  }
  run(false), run(true), plain() // warm-up
  return { msPerFrame100Fills: { unprotected: plain(), protectedFullCanvasScratch: run(false), protectedBboxScratch: run(true) } }
}

// Pan / zoom / DPR alignment (dot): the same checks under a viewport transform with fractional pan,
// at the page's devicePixelRatio (the spec runs DPR 1 and DPR 2). Canvas2D and the Fabric scratch
// object are drawn under the same view; Fabric's stroke is the reference for Fabric (Fabric applies
// the view through its own transforms).
const CW = 600
const CH = 440
type View = { z: number; tx: number; ty: number }
const views: View[] = [
  { z: 1.6, tx: 3.37, ty: -2.71 },
  { z: 1.15, tx: -0.5, ty: 20.25 },
]
function deviceCtx(v: View) {
  const dpr = window.devicePixelRatio
  const el = document.createElement('canvas')
  el.width = CW * dpr
  el.height = CH * dpr
  const ctx = el.getContext('2d', { willReadFrequently: true })!
  ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.tx, dpr * v.ty)
  return ctx
}
function canvas2dView(c: Case, v: View, protect: boolean) {
  const ctx = deviceCtx(v)
  for (const d of c.boundary) stroke(ctx, d, c.width, '#0000ff')
  const layer = deviceCtx(v)
  layer.fillStyle = '#ff0000'
  layer.fill(new Path2D(c.fill))
  if (protect) {
    layer.globalCompositeOperation = 'destination-out'
    for (const d of c.boundary) stroke(layer, d, c.width, '#000')
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(layer.canvas, 0, 0)
  ctx.restore()
  return ctx
}
function fabricView(c: Case, v: View, boundaryOnly: boolean) {
  const el = document.createElement('canvas')
  const canvas = new StaticCanvas(el, { width: CW, height: CH, enableRetinaScaling: true, renderOnAddRemove: false })
  canvas.setViewportTransform([v.z, 0, 0, v.z, v.tx, v.ty])
  for (const d of c.boundary)
    canvas.add(new Path(d, { fill: '', stroke: '#0000ff', strokeWidth: c.width, strokeLineCap: STYLE.cap, strokeLineJoin: STYLE.join, strokeMiterLimit: STYLE.miter, objectCaching: false }))
  if (!boundaryOnly) {
    const f = new OwnInkFillScratch(c.fill, { fill: '#ff0000', stroke: '', objectCaching: false })
    f.ownInk = c.boundary.map((d) => ({ d: new Path2D(d), width: c.width }))
    canvas.add(f)
  }
  canvas.renderAll()
  return canvas.getContext() as CanvasRenderingContext2D
}
function checkDevice(c: Case, v: View, alone: CanvasRenderingContext2D, result: CanvasRenderingContext2D) {
  const w = alone.canvas.width
  const h = alone.canvas.height
  const a = alone.getImageData(0, 0, w, h).data
  const r = result.getImageData(0, 0, w, h).data
  const inside = deviceCtx(v)
  const fp = new Path2D(c.fill)
  let ateStroke = 0
  let holes = 0
  let edges = 0
  let seams = 0
  let minAlpha = 255
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside.isPointInPath(fp, x + 0.5, y + 0.5)) continue
      const i = (y * w + x) * 4
      const px = [r[i], r[i + 1], r[i + 2], r[i + 3]]
      if (a[i + 3] === 255) {
        if (!(px[0] <= 2 && px[1] <= 2 && px[2] >= 253 && px[3] >= 253)) ateStroke++
      } else if (a[i + 3] === 0) {
        if (!(px[0] >= 253 && px[1] <= 2 && px[2] <= 2 && px[3] >= 253)) holes++
      } else {
        edges++
        // seam probe: an opaque stroke and an opaque fill should leave no see-through pixel
        if (px[3] < 250) seams++
        minAlpha = Math.min(minAlpha, px[3])
      }
    }
  return { ateStroke, holes, edges, seams, minAlpha }
}
const aloneCanvas2d = (c: Case, v: View) => {
  const ctx = deviceCtx(v)
  for (const d of c.boundary) stroke(ctx, d, c.width, '#0000ff')
  return ctx
}
;(window as any).__ownInkViews = {
  dpr: window.devicePixelRatio,
  results: views.flatMap((v) =>
    cases.map((c) => ({
      view: v,
      case: c.name,
      canvas2d: checkDevice(c, v, aloneCanvas2d(c, v), canvas2dView(c, v, true)),
      canvas2dUnprotected: checkDevice(c, v, aloneCanvas2d(c, v), canvas2dView(c, v, false)),
      fabricScratch: checkDevice(c, v, fabricView(c, v, true), fabricView(c, v, false)),
    })),
  ),
}
;(window as any).__ownInkCost = cost()
;(window as any).__ownInk = results
document.getElementById('out')!.textContent = JSON.stringify(results, null, 1)
