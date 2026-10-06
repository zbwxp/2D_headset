// Reference drawing path "B" (dot): draws the SAME picture as FabricView's A-mode scene with plain
// Canvas2D, so the cost of repainting can be compared with Fabric's renderAll on the same workload.
// Same canvas size and device-pixel ratio, same viewport transform, same order (onion yaws → fills →
// curves → anchor dots of unlocked curves), same styles as FabricView (stroke colours / widths, onion
// stroke, fill colours, dot radii) and Fabric's defaults (butt caps, miter joins, miter limit 4,
// non-zero fill, no stroke on dots). Path2D objects are built straight from the evaluated cubics (no
// SVG string) and cached per evaluated item, which is the same object while unchanged; every item is
// still REPAINTED each frame, like renderAll. Not a cost floor (dot): a reference with the same output.
import type { EvalCurve, EvalFill, Evaluated } from '../evaluate'

export class Canvas2DRef {
  private readonly paths = new WeakMap<object, Path2D>()
  pathsBuilt = 0

  constructor(readonly el: HTMLCanvasElement) {}

  private curvePath(c: EvalCurve) {
    let p = this.paths.get(c)
    if (!p) {
      p = new Path2D()
      const segs = c.segments
      if (segs.length) {
        p.moveTo(segs[0].cubic[0].x, segs[0].cubic[0].y)
        for (const s of segs) p.bezierCurveTo(s.cubic[1].x, s.cubic[1].y, s.cubic[2].x, s.cubic[2].y, s.cubic[3].x, s.cubic[3].y)
      }
      this.paths.set(c, p)
      this.pathsBuilt++
    }
    return p
  }

  private fillPath(f: EvalFill) {
    let p = this.paths.get(f)
    if (!p) {
      p = new Path2D()
      if (f.cubics.length) {
        p.moveTo(f.cubics[0][0].x, f.cubics[0][0].y)
        for (const [, c1, c2, p3] of f.cubics) p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y)
        p.closePath()
      }
      this.paths.set(f, p)
      this.pathsBuilt++
    }
    return p
  }

  /** Repaint the whole frame. `vpt` is Fabric's viewport transform, `dpr` its retina scaling. */
  draw(vpt: number[], dpr: number, ev: Evaluated, onions: Evaluated[]) {
    const ctx = this.el.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.el.width, this.el.height)
    ctx.setTransform(dpr * vpt[0], dpr * vpt[1], dpr * vpt[2], dpr * vpt[3], dpr * vpt[4], dpr * vpt[5])
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'miter'
    ctx.miterLimit = 4
    ctx.strokeStyle = 'rgba(120,120,200,0.25)'
    ctx.lineWidth = 0.4
    for (const o of onions) for (const c of o.curves) if (c.visible) ctx.stroke(this.curvePath(c))
    for (const f of ev.fills) {
      if (!f.visible) continue
      ctx.fillStyle = f.color
      ctx.fill(this.fillPath(f))
    }
    const curves = ev.curves.filter((c) => c.visible)
    for (const c of curves) {
      ctx.strokeStyle = c.locked ? '#999' : c.stroke.color
      ctx.lineWidth = c.stroke.width / 3
      ctx.stroke(this.curvePath(c))
    }
    const dot = (x: number, y: number, r: number, color: string) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const c of curves) {
      if (c.locked) continue
      for (const a of Object.values(c.anchors)) {
        dot(a.p.x, a.p.y, 1.4, '#1565c0')
        dot(a.hIn.x, a.hIn.y, 0.9, '#90caf9')
        dot(a.hOut.x, a.hOut.y, 0.9, '#90caf9')
      }
    }
  }
}
