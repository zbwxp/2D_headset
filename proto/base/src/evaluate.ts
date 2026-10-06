// Evaluation: author data → ONE evaluated geometry that stroke, fill, hit-test and export all read
// (docs/design/architecture/11 §2 join principle, 08 §2½ guarantee 2). Evaluated data is never saved.
// - Original vs evaluated split: Blender depsgraph design docs (behaviour only, no code read)
//   https://developer.blender.org/docs/features/core/depsgraph/
// - Curve math: bezier-js 6.1.4 (MIT) `project` / `getLUT` — https://github.com/Pomax/bezierjs
// - Reference expansion with per-instance sub-element addresses `${referenceId}/${curveId}`:
//   Figma instance sublayer ids (I<instance>;<child>) / SVG <use> — behaviour only.
import { Bezier } from 'bezier-js'
import type { RecordId } from '@tldraw/store'
import { counters } from './counters'
import { all, effectivelyVisible, lockedBy } from './model'
import type { Affine, ContainerRecord, CurveRecord, DocReader as DocStore, FillRecord, ReferenceRecord, Vec } from './schema'

export type Cubic = [Vec, Vec, Vec, Vec]
export type EvalSegment = { id: string; from: string; to: string; cubic: Cubic }
export type EvalAnchor = { id: string; p: Vec; hIn: Vec; hOut: Vec } // handles in absolute coords
export type EvalCurve = {
  address: string // `curve:C1` or `reference:R1/curve:E1`
  curveId: RecordId<CurveRecord>
  referenceId?: RecordId<ReferenceRecord>
  name: string
  anchors: Record<string, EvalAnchor>
  segments: EvalSegment[]
  stroke: { color: string; width: number }
  visible: boolean
  locked: boolean
  depth: number
}
export type EvalFill = { address: string; color: string; cubics: Cubic[]; visible: boolean; locked: boolean; depth: number }
/** One entry of the paint list: lines and fills interleaved, back to front (PAINT-ORDER.md §4 S1). */
export type PaintItem = { kind: 'curve'; item: EvalCurve } | { kind: 'fill'; item: EvalFill }
/** `paint` is THE order every renderer draws in; `curves` / `fills` are the same items split by kind
 *  (same relative order), for hit testing, onion skins and dots. */
export type Evaluated = { curves: EvalCurve[]; fills: EvalFill[]; paint: PaintItem[] }

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const tp = (m: Affine, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })

/** Separator of paint keys: below every fractional-index character (`0-9A-Za-z`), so a container's
 *  key is a prefix of its children's keys and sorts before any later sibling's key. */
export const KEY_SEP = ' '
/**
 * Paint key (PAINT-ORDER.md R1/R2): the fractional indexes of the WHOLE container path from the root,
 * then the object's own index. Compared by code unit (`<`), never `localeCompare` (P4). `stopAt`
 * (exclusive) gives the key relative to a referenced source container. Depth offsets are NOT applied
 * (D1 is not agreed; see `unappliedDepthOffsets`).
 */
export function paintKey(store: Pick<DocStore, 'get'>, parentId: RecordId<ContainerRecord> | null, index: string, stopAt?: string) {
  const parts = [index]
  let cur = parentId ? (store.get(parentId) as ContainerRecord | undefined) : undefined
  while (cur && cur.id !== stopAt) {
    parts.push(cur.index)
    cur = cur.parentId ? (store.get(cur.parentId) as ContainerRecord | undefined) : undefined
  }
  return parts.reverse().join(KEY_SEP)
}
export const byKey = (a: { key: string; address: string }, b: { key: string; address: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : a.address < b.address ? -1 : a.address > b.address ? 1 : 0 // address: stable tie-break

/** The list split by kind; one place, so `curves` / `fills` can never disagree with `paint`. */
export function fromPaint(paint: PaintItem[]): Evaluated {
  const curves: EvalCurve[] = []
  const fills: EvalFill[] = []
  for (const p of paint) p.kind === 'curve' ? curves.push(p.item) : fills.push(p.item)
  return { curves, fills, paint }
}

/** Depth offsets are stored but not applied to the paint order yet (D1 open): reported, never silent. */
export function unappliedDepthOffsets(ev: Evaluated): string[] {
  return ev.paint.filter((p) => p.item.depth !== 0).map((p) => p.item.address)
}

export function evalCurve(curve: CurveRecord, m: Affine, overrides: Record<string, Vec>, address: string): Pick<EvalCurve, 'anchors' | 'segments'> {
  const anchors: Record<string, EvalAnchor> = {}
  for (const a of Object.values(curve.anchors)) {
    const local = overrides[`${curve.id}#${a.id}`] ?? a.p
    const p = tp(m, local)
    anchors[a.id] = { id: a.id, p, hIn: tp(m, { x: local.x + a.hIn.x, y: local.y + a.hIn.y }), hOut: tp(m, { x: local.x + a.hOut.x, y: local.y + a.hOut.y }) }
  }
  const segments = curve.segments.map((s) => {
    const A = anchors[s.from]
    const B = anchors[s.to]
    return { id: s.id, from: s.from, to: s.to, cubic: [A.p, A.hOut, B.hIn, B.p] as Cubic }
  })
  void address
  return { anchors, segments }
}

/**
 * Full, uncached evaluation of the whole document. Kept as the independent reference that the
 * incremental evaluation (derived.ts) is compared against (dot: final results are checked against
 * an independent full recompute).
 */
export function evaluate(store: DocStore): Evaluated {
  counters.fullEvals++
  const curves: EvalCurve[] = []
  const byCurveId = new Map<string, EvalCurve>()
  for (const c of all(store, 'curve') as CurveRecord[]) {
    const ev: EvalCurve = {
      address: c.id,
      curveId: c.id,
      name: c.name,
      ...evalCurve(c, IDENTITY, {}, c.id),
      stroke: c.stroke,
      visible: effectivelyVisible(store, c.parentId),
      locked: !!lockedBy(store, c.parentId),
      depth: c.depthOffset,
    }
    curves.push(ev)
    byCurveId.set(c.id, ev)
  }
  // Reference expansion: each placement gets its own addresses; the source is not duplicated in data.
  for (const r of all(store, 'reference') as ReferenceRecord[]) {
    for (const c of (all(store, 'curve') as CurveRecord[]).filter((c) => inside(store, c.parentId, r.sourceId))) {
      curves.push({
        address: `${r.id}/${c.id}`,
        curveId: c.id,
        referenceId: r.id,
        name: c.name,
        ...evalCurve(c, r.transform, r.overrides, `${r.id}/${c.id}`),
        stroke: c.stroke,
        visible: effectivelyVisible(store, r.parentId),
        locked: !!lockedBy(store, r.parentId),
        depth: c.depthOffset,
      })
    }
  }
  const fills: EvalFill[] = (all(store, 'fill') as FillRecord[]).map((f) => ({
    address: f.id,
    color: f.color,
    // The fill reads the SAME evaluated segments the strokes use — never its own copy of anchors.
    cubics: f.boundary.map((step) => {
      const seg = byCurveId.get(step.curveId)!.segments.find((s) => s.id === step.segmentId)!
      const [p0, c1, c2, p3] = seg.cubic
      return step.dir === 1 ? seg.cubic : ([p3, c2, c1, p0] as Cubic)
    }),
    visible: effectivelyVisible(store, f.parentId),
    locked: !!lockedBy(store, f.parentId),
    depth: f.depthOffset,
  }))
  // one interleaved paint list; a reference instance sits at the reference's own position, the source's
  // internal order kept (D6)
  const keyOf = (address: string) => {
    const slash = address.indexOf('/')
    if (slash < 0) {
      const rec = store.get(address as any) as CurveRecord | FillRecord
      return paintKey(store, rec.parentId, rec.index)
    }
    const r = store.get(address.slice(0, slash) as any) as ReferenceRecord
    const c = store.get(address.slice(slash + 1) as any) as CurveRecord
    return paintKey(store, r.parentId, r.index) + KEY_SEP + paintKey(store, c.parentId, c.index, r.sourceId)
  }
  const entries = [
    ...curves.map((item) => ({ key: keyOf(item.address), address: item.address, p: { kind: 'curve', item } as PaintItem })),
    ...fills.map((item) => ({ key: keyOf(item.address), address: item.address, p: { kind: 'fill', item } as PaintItem })),
  ].sort(byKey)
  return fromPaint(entries.map((e) => e.p))
}

function inside(store: DocStore, parentId: RecordId<ContainerRecord> | null, containerId: RecordId<ContainerRecord>) {
  let cur = parentId ? (store.get(parentId) as ContainerRecord | undefined) : undefined
  while (cur) {
    if (cur.id === containerId) return true
    cur = cur.parentId ? (store.get(cur.parentId) as ContainerRecord | undefined) : undefined
  }
  return false
}

/** SVG path data from cubics — used by display AND export, so they cannot disagree. */
export function cubicsToPath(cubics: Cubic[], close = false) {
  counters.pathStrings++
  if (!cubics.length) return ''
  const f = (v: Vec) => `${+v.x.toFixed(3)} ${+v.y.toFixed(3)}`
  let d = `M ${f(cubics[0][0])}`
  for (const [, c1, c2, p3] of cubics) d += ` C ${f(c1)} ${f(c2)} ${f(p3)}`
  return close ? d + ' Z' : d
}

export type Hit =
  | { kind: 'anchor'; address: string; curveId: RecordId<CurveRecord>; referenceId?: RecordId<ReferenceRecord>; anchorId: string; d: number }
  | { kind: 'handle'; address: string; curveId: RecordId<CurveRecord>; referenceId?: RecordId<ReferenceRecord>; anchorId: string; handle: 'in' | 'out'; d: number }
  | { kind: 'segment'; address: string; curveId: RecordId<CurveRecord>; referenceId?: RecordId<ReferenceRecord>; segmentId: string; t: number; d: number }
  | { kind: 'fill'; address: string; d: 0 }

/**
 * Hit test against the evaluated geometry (precision risk of route B is decided here, not by
 * Fabric's bounding-box hit test). A mode: anchors > handles > segments; V mode: segments > fills.
 * Locked or hidden objects are not hittable. Topmost (last painted) wins ties.
 */
export function hitTest(ev: Evaluated, p: Vec, opts: { mode: 'A' | 'V'; tolerance: number }): Hit | null {
  const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
  const live = ev.curves.filter((c) => c.visible && !c.locked)
  const top = [...live].reverse()
  const pick = <T extends { d: number }>(xs: T[]) => xs.sort((a, b) => a.d - b.d)[0] ?? null
  if (opts.mode === 'A') {
    const anchors = top.flatMap((c) =>
      Object.values(c.anchors).map((a) => ({ kind: 'anchor' as const, address: `${c.address}#${a.id}`, curveId: c.curveId, referenceId: c.referenceId, anchorId: a.id, d: dist(a.p, p) })),
    )
    const a = pick(anchors.filter((h) => h.d <= opts.tolerance))
    if (a) return a
    const handles = top.flatMap((c) =>
      Object.values(c.anchors).flatMap((a) => [
        { kind: 'handle' as const, address: `${c.address}#${a.id}.in`, curveId: c.curveId, referenceId: c.referenceId, anchorId: a.id, handle: 'in' as const, d: dist(a.hIn, p) },
        { kind: 'handle' as const, address: `${c.address}#${a.id}.out`, curveId: c.curveId, referenceId: c.referenceId, anchorId: a.id, handle: 'out' as const, d: dist(a.hOut, p) },
      ]),
    )
    const h = pick(handles.filter((x) => x.d <= opts.tolerance))
    if (h) return h
  }
  const segs = top.flatMap((c) =>
    c.segments.map((s) => {
      const pr = new Bezier(...s.cubic.flatMap((v) => [v.x, v.y])).project(p)
      return { kind: 'segment' as const, address: `${c.address}/${s.id}`, curveId: c.curveId, referenceId: c.referenceId, segmentId: s.id, t: pr.t, d: pr.d }
    }),
  )
  const s = pick(segs.filter((x) => x.d <= opts.tolerance))
  if (s) return s
  for (const f of [...ev.fills].reverse()) {
    if (!f.visible || f.locked) continue
    const poly = f.cubics.flatMap((c) => new Bezier(...c.flatMap((v) => [v.x, v.y])).getLUT(16))
    if (pointInPolygon(p, poly)) return { kind: 'fill', address: f.address, d: 0 }
  }
  return null
}

function pointInPolygon(p: Vec, poly: Vec[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
