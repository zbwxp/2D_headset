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
import { isBridge, type Affine, type BaseReader, type BoundaryStep, type ContainerRecord, type CurveRecord, type BaseReader as DocStore, type FillRecord, type MaskRecord, type ReferenceRecord, type Vec } from './schema'

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
/** `boundaryRefs`: per curve, the segments the fill's boundary actually references (its OWN strokes,
 *  R4/D3) — only these, never the whole curve (dot: an unreferenced inner extension is not own ink). */
export type BoundaryRef = { curve: string; segments: string[] }
export type EvalFill = { address: string; color: string; cubics: Cubic[]; boundaryRefs: BoundaryRef[]; visible: boolean; locked: boolean; depth: number }

/**
 * The cubics of a fill boundary — THE one reading every consumer uses (full, cached, at a yaw, picking):
 * a segment step reads the curve's evaluated segment (reversed for dir −1); a bridge is the straight line
 * between its two anchors' current evaluated positions.
 */
export function fillCubics(boundary: BoundaryStep[], curveOf: (id: string) => Pick<EvalCurve, 'anchors' | 'segments'> | undefined): Cubic[] {
  return boundary.map((step) => {
    if (isBridge(step)) {
      const P = curveOf(step.bridge.from.curveId)!.anchors[step.bridge.from.anchorId].p
      const Q = curveOf(step.bridge.to.curveId)!.anchors[step.bridge.to.anchorId].p
      const at = (t: number): Vec => ({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t })
      return [P, at(1 / 3), at(2 / 3), Q] as Cubic
    }
    const seg = curveOf(step.curveId)!.segments.find((s) => s.id === step.segmentId)!
    const [p0, c1, c2, p3] = seg.cubic
    return step.dir === 1 ? seg.cubic : ([p3, c2, c1, p0] as Cubic)
  })
}

/** A fill's boundary references grouped by curve (curve order of first use; segment ids as referenced).
 *  Bridges are not strokes: they are never own ink. */
export function boundaryRefsOf(boundary: BoundaryStep[]): BoundaryRef[] {
  const by = new Map<string, Set<string>>()
  for (const step of boundary) {
    if (isBridge(step)) continue
    if (!by.has(step.curveId)) by.set(step.curveId, new Set())
    by.get(step.curveId)!.add(step.segmentId)
  }
  return [...by].map(([curve, segs]) => ({ curve, segments: [...segs] }))
}

/**
 * The drawn ink of only some segments of a curve: maximal runs of consecutive referenced segments in
 * the curve's own chain order, each a separate open sub-path. Inside a run the joins are the drawn
 * joins; at a run's end the stroke ends butt (the join to an unreferenced neighbour belongs to neither
 * side). The drawn path is open (no join from the last segment back to the first), so runs never wrap.
 */
export function inkRuns(c: Pick<EvalCurve, 'segments'>, segmentIds: string[]): Cubic[][] {
  const want = new Set(segmentIds)
  const runs: Cubic[][] = []
  let cur: Cubic[] | null = null
  for (const s of c.segments) {
    if (want.has(s.id)) (cur ??= []).push(s.cubic)
    else if (cur) runs.push(cur), (cur = null)
  }
  if (cur) runs.push(cur)
  return runs
}
/** One entry of the paint list: lines and fills interleaved, back to front (PAINT-ORDER.md §4 S1).
 *  A fill carries `ownInk` (S2): its referenced segments of own visible boundary curves painted BEFORE
 *  it — the ink it must leave out. Decided here, once, so renderers never judge it. */
export type PaintItem = { kind: 'curve'; item: EvalCurve } | { kind: 'fill'; item: EvalFill; ownInk: BoundaryRef[] }
export type PaintInput = { kind: 'curve'; item: EvalCurve } | { kind: 'fill'; item: EvalFill }

/** How a line is drawn — ONE definition for Fabric, B, the own-ink cut and picking (R9: lines opaque). */
export const inkStyle = (c: Pick<EvalCurve, 'stroke'>) => ({ width: c.stroke.width / 3, cap: 'butt' as const, join: 'miter' as const, miterLimit: 4 })
/** `paint` is THE order every renderer draws in; `curves` / `fills` are the same items split by kind
 *  (same relative order), for hit testing, onion skins and dots. */
/**
 * Masks (doc 18 §1.7b / §29.2b). A definition names paint addresses: the source fills and stroked curves (their
 * region = union of the fill areas and the strokes' actual ink) and the targets it acts on. Geometry is resolved from
 * the SAME paint list (so a yaw / character / preview evaluation masks with its own source geometry), before any mask
 * applies; a hidden source still masks. Several masks on one target all apply (AND).
 */
export type MaskDef = { id: string; mode: 'inside' | 'outside'; fills: string[]; strokes: string[]; targets: string[] }
export type EvalMask = { id: string; mode: 'inside' | 'outside'; fills: EvalFill[]; strokes: EvalCurve[] }
/** `maskDefs` / `masks` are present only when the document has enabled masks (an evaluation without masks is unchanged) */
export type Evaluated = { curves: EvalCurve[]; fills: EvalFill[]; paint: PaintItem[]; maskDefs?: MaskDef[]; masks?: Map<string, EvalMask[]> }

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const tp = (m: Affine, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })

/** Separators of paint keys, both below every character of fractional indexes (`0-9A-Za-z`) and of
 *  record ids: LEVEL between path levels, TIE between a level's index and its stable identity. */
export const KEY_SEP = '\u0000'
const KEY_TIE = '\u0001'
/**
 * Paint key (PAINT-ORDER.md R1/R2): for every level of the WHOLE container path from the root, then the
 * object itself: its fractional index, then its id. Compared by code unit (`<`), never `localeCompare`
 * (P4). The id breaks ties AT EACH LEVEL (dot): two siblings with the same index are still ordered as
 * whole subtrees, so a container's content stays contiguous. `stopAt` (exclusive) gives the key
 * relative to a referenced source container. Depth offsets are NOT applied (D1; `unappliedDepthOffsets`).
 */
export function paintKey(store: Pick<DocStore, 'get'>, rec: { id: string; typeName?: string; parentId: RecordId<ContainerRecord> | null; index: string }, stopAt?: string) {
  let parent = rec.parentId ? (store.get(rec.parentId) as ContainerRecord | undefined) : undefined
  const parts = [levelPart(parent, rec)]
  while (parent && parent.id !== stopAt) {
    const up = parent.parentId ? (store.get(parent.parentId) as ContainerRecord | undefined) : undefined
    parts.push(levelPart(up, parent))
    parent = up
  }
  return parts.reverse().join(KEY_SEP)
}
/**
 * One level of a paint key. Inside a shape group (doc 18 §30.22) the faces are drawn below every other child: a class
 * digit (faces 0, the rest 1) comes before the index, so the rule holds whatever the indexes are; elsewhere the index
 * alone orders (R1).
 */
const levelPart = (parent: ContainerRecord | undefined, r: { id: string; typeName?: string; index: string }) =>
  (parent?.shape ? (r.typeName === 'fill' ? '0' : '1') : '') + r.index + KEY_TIE + r.id
export const byKey = (a: { key: string; address: string }, b: { key: string; address: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : a.address < b.address ? -1 : a.address > b.address ? 1 : 0 // address: stable tie-break

/** The list split by kind; one place, so `curves` / `fills` can never disagree with `paint`. */
export function fromPaint(input: PaintInput[], maskDefs: MaskDef[] = []): Evaluated {
  const curves: EvalCurve[] = []
  const fills: EvalFill[] = []
  const before = new Map<string, EvalCurve>() // curves painted so far (only base curves can bound a fill)
  const paint: PaintItem[] = input.map((p) => {
    if (p.kind === 'curve') {
      curves.push(p.item)
      if (!p.item.referenceId) before.set(p.item.address, p.item)
      return p
    }
    fills.push(p.item)
    const ownInk = p.item.boundaryRefs.filter((r) => before.get(r.curve)?.visible)
    return { kind: 'fill', item: p.item, ownInk }
  })
  const masks = new Map<string, EvalMask[]>()
  if (maskDefs.length) {
    const fillBy = new Map(fills.map((f) => [f.address, f]))
    const curveBy = new Map(curves.filter((c) => !c.referenceId).map((c) => [c.address, c]))
    for (const d of maskDefs) {
      const m: EvalMask = { id: d.id, mode: d.mode, fills: d.fills.map((a) => fillBy.get(a)!).filter(Boolean), strokes: d.strokes.map((a) => curveBy.get(a)!).filter(Boolean) }
      for (const t of d.targets) masks.set(t, [...(masks.get(t) ?? []), m])
    }
  }
  return maskDefs.length ? { curves, fills, paint, maskDefs, masks } : { curves, fills, paint }
}

/**
 * The enabled masks of a document as definitions over the given paint addresses. A target that is a container covers
 * every curve and fill drawn inside it (and reference instances placed inside it); a curve covers its own stroke; a
 * fill its own area. Reads the mask records through the reactive id index when the reader has one.
 */
export function maskDefsOf(store: BaseReader & { query?: any }, addresses: string[]): MaskDef[] {
  const ids: string[] = store.query ? [...store.query.ids('mask').get()] : store.allRecords().filter((r) => r.typeName === 'mask').map((r) => r.id)
  if (!ids.length) return []
  const recs = ids.map((id) => store.get(id as any) as MaskRecord).filter((m) => m && m.enabled).sort((a, b) => (a.id < b.id ? -1 : 1))
  if (!recs.length) return []
  // the chain of an address: the item itself (or its reference), then every container above it
  const chainOf = (address: string): string[] => {
    const slash = address.indexOf('/')
    const own = slash < 0 ? address : address.slice(0, slash)
    const out = [own]
    let r = store.get(own as any) as { parentId?: string | null } | undefined
    for (let n = 0; r?.parentId && n < 1000; n++) {
      out.push(r.parentId)
      r = store.get(r.parentId as any) as { parentId?: string | null } | undefined
    }
    return out
  }
  const chains = new Map(addresses.map((a) => [a, chainOf(a)]))
  return recs.map((m) => {
    const t = new Set(m.targets as string[])
    return { id: m.id, mode: m.mode, fills: [...m.sources.fills], strokes: [...m.sources.strokes], targets: addresses.filter((a) => chains.get(a)!.some((x) => t.has(x))) }
  })
}

/** Is the point `p` of the item at `address` left visible by its masks (true when it has none)? */
export function visibleThroughMasks(ev: Evaluated, address: string, p: Vec): boolean {
  for (const m of ev.masks?.get(address) ?? []) {
    const inRegion = m.fills.some((f) => fillContains(f, p)) || m.strokes.some((c) => inkContains(c, c.segments.map((s) => s.id), p))
    if (m.mode === 'inside' ? !inRegion : inRegion) return false
  }
  return true
}

/** Container opacity is stored but not applied in the current base (scope limit, PAINT-ORDER.md D7 —
 *  NOT a product decision): reported, never silently ignored. Reads containers only. */
export function unappliedContainerOpacity(store: BaseReader): string[] {
  return (all(store, 'container') as ContainerRecord[]).filter((c) => c.opacity !== 1).map((c) => String(c.id))
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
    cubics: fillCubics(f.boundary, (id) => byCurveId.get(id)),
    boundaryRefs: boundaryRefsOf(f.boundary),
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
      return paintKey(store, rec)
    }
    const r = store.get(address.slice(0, slash) as any) as ReferenceRecord
    const c = store.get(address.slice(slash + 1) as any) as CurveRecord
    return paintKey(store, r) + KEY_SEP + paintKey(store, c, r.sourceId)
  }
  const entries = [
    ...curves.map((item) => ({ key: keyOf(item.address), address: item.address, p: { kind: 'curve', item } as PaintInput })),
    ...fills.map((item) => ({ key: keyOf(item.address), address: item.address, p: { kind: 'fill', item } as PaintInput })),
  ].sort(byKey)
  return fromPaint(entries.map((e) => e.p), maskDefsOf(store, entries.map((e) => e.address)))
}

function inside(store: DocStore, parentId: RecordId<ContainerRecord> | null, containerId: RecordId<ContainerRecord>) {
  let cur = parentId ? (store.get(parentId) as ContainerRecord | undefined) : undefined
  while (cur) {
    if (cur.id === containerId) return true
    cur = cur.parentId ? (store.get(cur.parentId) as ContainerRecord | undefined) : undefined
  }
  return false
}

/** The fill rule every renderer AND picking use (one definition: Canvas `fill`, Fabric `fillRule`,
 *  native `isPointInPath`). */
export const FILL_RULE: CanvasFillRule = 'nonzero'

/** Path commands for Fabric (its public `TComplexPathData`): full precision, no string round trip (dot). */
export type PathCommand = ['M', number, number] | ['C', number, number, number, number, number, number] | ['Z']
export function cubicsToCommands(cubics: Cubic[], close = false): PathCommand[] {
  if (!cubics.length) return []
  const out: PathCommand[] = [['M', cubics[0][0].x, cubics[0][0].y]]
  for (const [, c1, c2, p3] of cubics) out.push(['C', c1.x, c1.y, c2.x, c2.y, p3.x, p3.y])
  if (close) out.push(['Z'])
  return out
}

/** Native path for canvas drawing and native picking (world coordinates). */
export function cubicsPath2D(cubics: Cubic[], close = false) {
  const p = new Path2D()
  if (!cubics.length) return p
  p.moveTo(cubics[0][0].x, cubics[0][0].y)
  for (const [, c1, c2, p3] of cubics) p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y)
  if (close) p.closePath()
  return p
}

/** SVG path data from cubics — for EXPORT (Fabric gets commands, not strings). */
export function cubicsToPath(cubics: Cubic[], close = false) {
  counters.pathStrings++
  if (!cubics.length) return ''
  const f = (v: Vec) => `${+v.x.toFixed(3)} ${+v.y.toFixed(3)}`
  let d = `M ${f(cubics[0][0])}`
  for (const [, c1, c2, p3] of cubics) d += ` C ${f(c1)} ${f(c2)} ${f(p3)}`
  return close ? d + ' Z' : d
}

/**
 * Is `p` (world) on the drawn ink of `c`? The browser's native stroke test (`isPointInStroke`) with the
 * SAME parameters the renderers draw with (`inkStyle`: width, butt ends, mitre joins, mitre limit), so
 * picking and display agree. Where no canvas exists (node), it fails loudly instead of approximating.
 */
let probe: OffscreenCanvasRenderingContext2D | null = null
function nativeProbe(what: string) {
  if (typeof OffscreenCanvas === 'undefined') throw new Error(`${what}: no native path test in this environment (needs a canvas)`)
  return (probe ??= new OffscreenCanvas(1, 1).getContext('2d')!)
}
/** Is `p` (world) inside the fill as drawn — native `isPointInPath` with `FILL_RULE` (dot: the old
 *  polyline sampling could disagree with the drawing, even on the fill rule). */
export function fillContains(f: EvalFill, p: Vec): boolean {
  return nativeProbe('fillContains').isPointInPath(cubicsPath2D(f.cubics, true), p.x, p.y, FILL_RULE)
}
export function inkContains(c: EvalCurve, segmentIds: string[], p: Vec): boolean {
  const probe = nativeProbe('inkContains')
  const st = inkStyle(c)
  probe.lineWidth = st.width
  probe.lineCap = st.cap
  probe.lineJoin = st.join
  probe.miterLimit = st.miterLimit
  const path = new Path2D()
  for (const run of inkRuns(c, segmentIds)) {
    path.moveTo(run[0][0].x, run[0][0].y)
    for (const [, c1, c2, p3] of run) path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y)
  }
  return probe.isPointInStroke(path, p.x, p.y)
}

export type Hit =
  | { kind: 'anchor'; address: string; curveId: RecordId<CurveRecord>; referenceId?: RecordId<ReferenceRecord>; anchorId: string; d: number }
  | { kind: 'handle'; address: string; curveId: RecordId<CurveRecord>; referenceId?: RecordId<ReferenceRecord>; anchorId: string; handle: 'in' | 'out'; d: number }
  | { kind: 'segment'; address: string; curveId: RecordId<CurveRecord>; referenceId?: RecordId<ReferenceRecord>; segmentId: string; t: number; d: number }
  | { kind: 'fill'; address: string; d: 0 }

/**
 * Hit test against the evaluated geometry (precision risk of route B is decided here, not by
 * Fabric's bounding-box hit test). A mode: anchors > handles (nearest) > the topmost drawn item; V mode: the topmost
 * drawn item (`hitStack`, paint order — a line hidden under a fill in front is not picked: KF-4).
 * Locked or hidden objects are not hittable.
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
  return hitStack(ev, p, opts.tolerance)[0] ?? null
}

/**
 * Everything drawn under `p`, FRONT to back in the paint order (doc 18 KF-4; Illustrator / Figma: a click picks the
 * topmost object under the cursor, Cmd / Ctrl+click goes behind it): a line within `tolerance` of its ink where no
 * mask hides it, a fill containing `p` where no mask hides it and not on its own visible ink (S2). One entry per drawn
 * item (its nearest segment). Hidden and locked items are not hittable.
 */
export function hitStack(ev: Evaluated, p: Vec, tolerance: number): Extract<Hit, { kind: 'segment' | 'fill' }>[] {
  const out: Extract<Hit, { kind: 'segment' | 'fill' }>[] = []
  const byAddress = new Map(ev.curves.map((c) => [c.address, c]))
  for (const entry of [...ev.paint].reverse()) {
    if (!entry.item.visible || entry.item.locked) continue
    if (entry.kind === 'curve') {
      const c = entry.item
      const masked = !!ev.masks?.get(c.address)?.length
      let best: Extract<Hit, { kind: 'segment' }> | null = null
      for (const s of c.segments) {
        const bz = new Bezier(...s.cubic.flatMap((v) => [v.x, v.y]))
        const pr = bz.project(p)
        if (pr.d! > tolerance) continue
        // picking follows what is drawn (§1.7): under masks the line counts only where a VISIBLE point of it lies within
        // the tolerance — the nearest point, else the nearest visible sample (dot, review of ce2736c M4: the pointer
        // being outside the mask said nothing about the line near it)
        let hit: { t: number; d: number } | null = !masked || visibleThroughMasks(ev, c.address, { x: pr.x, y: pr.y }) ? { t: pr.t!, d: pr.d! } : null
        if (!hit)
          for (let k = 0; k <= 64; k++) {
            const q = bz.get(k / 64)
            const d = Math.hypot(q.x - p.x, q.y - p.y)
            if (d <= tolerance && (!hit || d < hit.d) && visibleThroughMasks(ev, c.address, q)) hit = { t: k / 64, d }
          }
        if (hit && (!best || hit.d < best.d)) best = { kind: 'segment', address: `${c.address}/${s.id}`, curveId: c.curveId, referenceId: c.referenceId, segmentId: s.id, t: hit.t, d: hit.d }
      }
      if (best) out.push(best)
      continue
    }
    const f = entry.item
    if (!fillContains(f, p)) continue
    if (!visibleThroughMasks(ev, f.address, p)) continue
    // the same protected area as the drawing (S2): a point on the fill's own visible ink is not the
    // fill. "Ink" = the browser's own stroke geometry with the drawn parameters (inkContains), not an
    // approximation (dot). A distance bound only skips the call where no ink can be.
    const onOwnInk = entry.ownInk.some((ref) => {
      const c = byAddress.get(ref.curve)!
      // ink a mask hides is not drawn, so the fill is not cut there either (review of ce2736c M2)
      if (!visibleThroughMasks(ev, ref.curve, p)) return false
      const st = inkStyle(c)
      const reach = (st.width / 2) * Math.max(1, st.miterLimit) // a mitre reaches at most miterLimit × half width
      const segs = c.segments.filter((s) => ref.segments.includes(s.id))
      if (!segs.some((s) => new Bezier(...s.cubic.flatMap((v) => [v.x, v.y])).project(p).d! <= reach)) return false
      return inkContains(c, ref.segments, p)
    })
    if (!onOwnInk) out.push({ kind: 'fill', address: f.address, d: 0 })
  }
  return out
}

