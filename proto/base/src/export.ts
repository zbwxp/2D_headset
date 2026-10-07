// Export (editor skeleton, doc 18 §30.15): the drawing as a PNG or an SVG — Illustrator File › Export (PNG / SVG).
// - the area: the drawing's bounds (every visible item's exact path bounds, strokes with their ink — `strokeBox`), plus a margin; no
//   artboard yet (a document-level size is a separate item);
// - PNG: drawn by the reference renderer B (view/canvas2dRef.ts — the same output as the screen: paint order, masks,
//   a fill leaving its own lines' ink) without editor aids, on an offscreen canvas at `scale`, transparent background;
// - SVG: the same paint list as paths in order; strokes as on screen (inkStyle: width, butt caps, mitre joins, limit
//   4); a fill that leaves out its own lines' ink gets an SVG mask cutting those strokes; masks become SVG masks
//   (inside: the region white; outside: everything white, the region black), several on one item nested (AND).
import { Bezier } from 'bezier-js'
import { inkRuns, inkStyle, type Cubic, type EvalCurve, type EvalFill, type EvalMask, type Evaluated } from './evaluate'
import type { Vec } from './schema'

export type Box = { x: number; y: number; w: number; h: number }

/** a cubic's exact bounds: its end points and the roots of its derivative (bezier-js `bbox`, not sampling) */
const cubicBox = (c: Cubic) => new Bezier(c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y).bbox()
const same = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y
const unit = (a: Vec, b: Vec): Vec | null => {
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  return d > 0 ? { x: (b.x - a.x) / d, y: (b.y - a.y) / d } : null
}
/** the direction a cubic leaves its start / arrives at its end (the first control point that differs) */
const startDir = (c: Cubic) => unit(c[0], [c[1], c[2], c[3]].find((q) => !same(q, c[0])) ?? c[3])
const endDir = (c: Cubic) => unit([c[2], c[1], c[0]].find((q) => !same(q, c[3])) ?? c[0], c[3])

/**
 * Where a stroke's ink reaches (review of 9291848, dot 1791365700: 16 samples missed a cubic's real extreme). Every point
 * of a stroke lies within half the ink width of its centre line, except at a mitred join, where the ink reaches the
 * miter tip. So: each cubic's EXACT bounds grown by half the ink width, plus the miter tip of every join inside a drawn
 * run (`inkStyle`: butt caps, miter joins, limit 4 — a join beyond the limit is bevelled and stays within half the
 * width). Exact where the curve's extreme is not an end (the tangent is then perpendicular to the axis); at a butt-capped
 * end it may exceed the ink by up to half the width, never fall short.
 */
function strokeBox(c: EvalCurve, grow: (x: number, y: number) => void) {
  const st = inkStyle(c)
  const half = st.width / 2
  for (const run of inkRuns(c, c.segments.map((s) => s.id))) {
    for (const cub of run) {
      const b = cubicBox(cub)
      grow(b.x.min - half, b.y.min - half)
      grow(b.x.max + half, b.y.max + half)
    }
    for (let i = 0; i + 1 < run.length; i++) {
      const t1 = endDir(run[i]), t2 = startDir(run[i + 1])
      if (!t1 || !t2) continue
      const cos = t1.x * t2.x + t1.y * t2.y
      if (cos >= 1 - 1e-12) continue // straight on: no corner
      const ratio = 1 / Math.sqrt((1 + cos) / 2) // miter length / width = 1 / sin(θ / 2), θ the angle between the segments
      if (!(ratio <= st.miterLimit)) continue // bevelled: within half the width
      // the outer side: the normal of the incoming direction that points away from the outgoing one
      const n1 = { x: -t1.y, y: t1.x }
      const s = n1.x * t2.x + n1.y * t2.y > 0 ? -1 : 1
      const a = { x: s * n1.x, y: s * n1.y }, b2 = { x: s * -t2.y, y: s * t2.x }
      const u = unit({ x: 0, y: 0 }, { x: a.x + b2.x, y: a.y + b2.y })
      if (!u) continue
      const p = run[i][3]
      grow(p.x + u.x * half * ratio, p.y + u.y * half * ratio)
    }
  }
}

/** the drawing's bounds: every visible item's exact path bounds — strokes with their ink (`strokeBox`) — plus a margin */
export function drawingBounds(ev: Evaluated, margin = 4): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  for (const e of ev.paint) {
    if (!e.item.visible) continue
    if (e.kind === 'curve') strokeBox(e.item, grow)
    else
      for (const c of e.item.cubics) {
        const b = cubicBox(c)
        grow(b.x.min, b.y.min)
        grow(b.x.max, b.y.max)
      }
  }
  if (!Number.isFinite(x0)) return null
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin }
}

const num = (n: number) => String(Math.round(n * 1000) / 1000)
/** SVG path data of a cubic chain (the same chain cubicsToCommands gives Fabric) */
const d = (cubics: Cubic[], close = false) => {
  if (!cubics.length) return ''
  const P = (q: Vec) => `${num(q.x)} ${num(q.y)}`
  return `M ${P(cubics[0][0])}` + cubics.map((c) => ` C ${P(c[1])} ${P(c[2])} ${P(c[3])}`).join('') + (close ? ' Z' : '')
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const strokeAttrs = (c: Pick<EvalCurve, 'stroke'>, color: string) => {
  const st = inkStyle(c)
  return `fill="none" stroke="${esc(color)}" stroke-width="${num(st.width)}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}" stroke-miterlimit="${st.miterLimit}"`
}
const curvePaths = (c: EvalCurve, segmentIds: string[], color: string) => inkRuns(c, segmentIds).map((run) => `<path d="${d(run)}" ${strokeAttrs(c, color)}/>`).join('')

/** The drawing as an SVG document (the area: `box`, in drawing units). */
export function toSVG(ev: Evaluated, box: Box): string {
  const defs: string[] = []
  const body: string[] = []
  const byAddress = new Map(ev.curves.map((c) => [c.address, c]))
  let n = 0
  const area = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" fill="white"/>`
  const region = (m: EvalMask, color: string) =>
    [...m.fills.filter((f) => f.cubics.length).map((f) => `<path d="${d(f.cubics, true)}" fill="${color}" fill-rule="nonzero"/>`), ...m.strokes.map((c) => curvePaths(c, c.segments.map((s) => s.id), color))].join('')
  const masked = (inner: string, masks: EvalMask[] | undefined) => {
    let out = inner
    for (const m of masks ?? []) {
      const id = `m${++n}`
      defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}">${m.mode === 'inside' ? region(m, 'white') : area + region(m, 'black')}</mask>`)
      out = `<g mask="url(#${id})">${out}</g>`
    }
    return out
  }
  for (const e of ev.paint) {
    if (!e.item.visible) continue
    const masks = ev.masks?.get(e.item.address)
    if (e.kind === 'curve') {
      const c = e.item
      body.push(masked(curvePaths(c, c.segments.map((s) => s.id), c.stroke.color), masks))
      continue
    }
    const f: EvalFill = e.item
    if (!f.cubics.length) continue
    let path = `<path d="${d(f.cubics, true)}" fill="${esc(f.color)}" fill-rule="nonzero"/>`
    if (e.ownInk.length) {
      // the fill leaves out its own visible lines' ink (as on screen) — those strokes, with their own masks, cut it
      const id = `o${++n}`
      const cut = e.ownInk.map((r) => {
        const c = byAddress.get(r.curve)!
        return masked(curvePaths(c, r.segments, 'black'), ev.masks?.get(r.curve))
      })
      defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}">${area}${cut.join('')}</mask>`)
      path = `<g mask="url(#${id})">${path}</g>`
    }
    body.push(masked(path, masks))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(box.x)} ${num(box.y)} ${num(box.w)} ${num(box.h)}" width="${num(box.w)}" height="${num(box.h)}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`
}
