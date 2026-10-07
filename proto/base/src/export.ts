// Export (editor skeleton, doc 18 §30.15): the drawing as a PNG or an SVG — Illustrator File › Export (PNG / SVG).
// - the area: the drawing's bounds (every visible item's path, strokes padded by their ink), plus a margin; no
//   artboard yet (a document-level size is a separate item);
// - PNG: drawn by the reference renderer B (view/canvas2dRef.ts — the same output as the screen: paint order, masks,
//   a fill leaving its own lines' ink) without editor aids, on an offscreen canvas at `scale`, transparent background;
// - SVG: the same paint list as paths in order; strokes as on screen (inkStyle: width, butt caps, mitre joins, limit
//   4); a fill that leaves out its own lines' ink gets an SVG mask cutting those strokes; masks become SVG masks
//   (inside: the region white; outside: everything white, the region black), several on one item nested (AND).
import { inkRuns, inkStyle, type Cubic, type EvalCurve, type EvalFill, type EvalMask, type Evaluated } from './evaluate'
import type { Vec } from './schema'

export type Box = { x: number; y: number; w: number; h: number }

const sample = (c: Cubic, n = 16): Vec[] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n, u = 1 - t
    return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y }
  })

/** the drawing's bounds: every visible item's path, strokes padded by half their ink (mitres by the limit), + margin */
export function drawingBounds(ev: Evaluated, margin = 4): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const e of ev.paint) {
    if (!e.item.visible) continue
    const cubics = e.kind === 'curve' ? e.item.segments.map((s) => s.cubic) : e.item.cubics
    const pad = e.kind === 'curve' ? (inkStyle(e.item).width / 2) * inkStyle(e.item).miterLimit : 0
    for (const c of cubics)
      for (const q of sample(c)) {
        x0 = Math.min(x0, q.x - pad)
        y0 = Math.min(y0, q.y - pad)
        x1 = Math.max(x1, q.x + pad)
        y1 = Math.max(y1, q.y + pad)
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
