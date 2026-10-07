// Creating fills (editor skeleton, doc 18 §30.11) — Illustrator's Live Paint Bucket (K): click inside an area the lines
// enclose and it is filled; click an area already filled and its colour changes.
// Adaptation (stated): our fill is bounded by whole segments that meet at anchors (the same anchor, connected anchors,
// or anchors at the same place — joined by a zero-length bridge step), so the areas found here are the faces of the
// network of segments meeting at anchors. Lines that only CROSS (no anchor at the crossing) do not close an area yet:
// add an anchor there (+) or connect the ends (⌘J). Faces with holes are not made (a fill has one boundary).
// Face search: the usual planar-map walk — at every node the outgoing segment ends are sorted by angle; following
// "the next one clockwise after the way back" walks each face once; the smallest bounded face containing the click wins.
import type { EvalCurve, Evaluated } from './evaluate'
import { anchorKey, linkedAnchors, type AnchorRef } from './model'
import type { BaseReader, BoundaryStep, Vec } from './schema'

type Cubic = [Vec, Vec, Vec, Vec]
type Half = { curve: EvalCurve; segmentId: string; dir: 1 | -1; from: AnchorRef; to: AnchorRef; fromNode: string; toNode: string; angle: number; pts: Vec[] }

const at = (c: Cubic, t: number): Vec => {
  const u = 1 - t
  return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y }
}
const SAMPLES = 24
const sampled = (c: Cubic): Vec[] => Array.from({ length: SAMPLES + 1 }, (_, k) => at(c, k / SAMPLES))
/** the direction a segment leaves its start (the first control point that differs from it) */
const leaving = (c: Cubic): number => {
  for (const q of [c[1], c[2], c[3]]) if (Math.hypot(q.x - c[0].x, q.y - c[0].y) > 1e-9) return Math.atan2(q.y - c[0].y, q.x - c[0].x)
  return 0
}
const area = (pts: Vec[]) => pts.reduce((s, p, i) => s + (p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y), 0) / 2
const contains = (pts: Vec[], p: Vec) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export type Face = { boundary: BoundaryStep[]; curves: string[]; area: number }

/**
 * The smallest enclosed area at `p` among the drawn (visible, directly placed) curves, as a fill boundary; or why none.
 */
export function faceAt(reader: BaseReader, ev: Evaluated, p: Vec): Face | { error: string } {
  return walk(reader, ev.curves.filter((c) => c.visible && !c.referenceId), p)
}

/**
 * The OUTLINE the selected curves form (v103 `createFill(curveIds)`: select the boundary lines, make their fill): the
 * largest bounded face of the network of just these curves — one closed curve, or several meeting at anchors.
 */
export function outlineOf(reader: BaseReader, ev: Evaluated, curveIds: readonly string[]): Face | { error: string } {
  const ids = new Set(curveIds)
  const curves = ev.curves.filter((c) => !c.referenceId && ids.has(c.curveId))
  if (!curves.length) return { error: '先选中围成轮廓的线（一条闭合线，或几条首尾相接的线）' }
  return walk(reader, curves, null)
}

function walk(reader: BaseReader, curves: EvalCurve[], p: Vec | null): Face | { error: string } {
  // nodes: an anchor, joined with its connected anchors and with anchors at the same place
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(k, r)
    return r
  }
  const union = (a: string, b: string) => parent.set(find(a), find(b))
  const where = new Map<string, string>()
  for (const c of curves)
    for (const a of Object.values(c.anchors)) {
      const k = anchorKey({ curveId: c.curveId, anchorId: a.id })
      if (!parent.has(k)) parent.set(k, k)
      const spot = `${Math.round(a.p.x * 1e6)},${Math.round(a.p.y * 1e6)}`
      if (where.has(spot)) union(k, where.get(spot)!)
      else where.set(spot, k)
    }
  for (const c of curves)
    for (const a of Object.values(c.anchors))
      for (const m of linkedAnchors(reader, [{ curveId: c.curveId, anchorId: a.id }])) {
        const k = anchorKey(m.ref)
        if (parent.has(k)) union(anchorKey({ curveId: c.curveId, anchorId: a.id }), k)
      }
  // half-edges: every segment both ways
  const halves: Half[] = []
  for (const c of curves)
    for (const s of c.segments) {
      const fwd = s.cubic as Cubic
      const back = [fwd[3], fwd[2], fwd[1], fwd[0]] as Cubic
      const A = { curveId: c.curveId, anchorId: s.from }, B = { curveId: c.curveId, anchorId: s.to }
      const nA = find(anchorKey(A)), nB = find(anchorKey(B))
      halves.push({ curve: c, segmentId: s.id, dir: 1, from: A, to: B, fromNode: nA, toNode: nB, angle: leaving(fwd), pts: sampled(fwd) })
      halves.push({ curve: c, segmentId: s.id, dir: -1, from: B, to: A, fromNode: nB, toNode: nA, angle: leaving(back), pts: sampled(back) })
    }
  const out = new Map<string, Half[]>()
  for (const h of halves) out.set(h.fromNode, [...(out.get(h.fromNode) ?? []), h])
  for (const list of out.values()) list.sort((a, b) => a.angle - b.angle)
  const twin = (h: Half) => halves.find((x) => x.curve === h.curve && x.segmentId === h.segmentId && x.dir === -h.dir)!
  // next half on the same face: at the end node, the outgoing half just before the way back in angle order
  const next = (h: Half): Half => {
    const list = out.get(h.toNode)!
    const back = twin(h)
    const i = list.indexOf(back)
    return list[(i - 1 + list.length) % list.length]
  }
  const seen = new Set<Half>()
  let best: { face: Half[]; pts: Vec[]; area: number } | null = null
  for (const h0 of halves) {
    if (seen.has(h0)) continue
    const face: Half[] = []
    for (let h = h0, n = 0; !seen.has(h) && n < halves.length + 1; h = next(h), n++) {
      seen.add(h)
      face.push(h)
    }
    const pts = face.flatMap((h) => h.pts.slice(0, -1))
    if (pts.length < 3) continue
    const a = area(pts)
    // at a click: the smallest BOUNDED face (one orientation) containing it. For an outline (no click): the face of
    // largest size in either orientation — the outer face of the selected lines is their outline (with lines inside
    // it, e.g. a diagonal, the bounded faces are only the pieces)
    if (p) {
      if (a <= 1e-9 || !contains(pts, p)) continue
      if (!best || a < best.area) best = { face, pts, area: a }
    } else if (Math.abs(a) > 1e-9 && (!best || Math.abs(a) > best.area)) best = { face, pts, area: Math.abs(a) }
  }
  if (!best)
    return { error: p ? '这里没有被线围起来的区域（线要在锚点处相接；只是交叉不算：用 + 在交点加点，或 ⌘J 连接端点）' : '选中的线没有围成闭合轮廓（要首尾相接：钢笔点回起点、⌘J，或吸附到端点）' }
  // the boundary: the face's segments in order; a zero-length bridge where two of them meet at different anchors that
  // are only at the same place (connected or identical anchors need none)
  const boundary: BoundaryStep[] = []
  best.face.forEach((h, i) => {
    boundary.push({ curveId: h.curve.curveId as any, segmentId: h.segmentId, dir: h.dir })
    const n = best!.face[(i + 1) % best!.face.length]
    const joined = anchorKey(h.to) === anchorKey(n.from) || linkedAnchors(reader, [h.to]).some((m) => anchorKey(m.ref) === anchorKey(n.from))
    if (!joined) boundary.push({ bridge: { from: { ...h.to } as any, to: { ...n.from } as any } })
  })
  return { boundary, curves: [...new Set(best.face.map((h) => h.curve.curveId as string))], area: best.area }
}

/** an existing fill with exactly this boundary (the same segments and bridges, any starting point / direction) */
export function sameFill(reader: BaseReader, boundary: BoundaryStep[]): string | null {
  const key = (b: BoundaryStep) => ('bridge' in b ? `b:${[anchorKey(b.bridge.from as any), anchorKey(b.bridge.to as any)].sort().join('|')}` : `s:${b.curveId}/${b.segmentId}`)
  const want = boundary.map(key).sort().join(',')
  for (const f of reader.allRecords().filter((r: any) => r.typeName === 'fill') as any[]) if ((f.boundary as BoundaryStep[]).map(key).sort().join(',') === want) return f.id
  return null
}
