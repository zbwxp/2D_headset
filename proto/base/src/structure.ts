// Stage 2b (doc 18 §19, §23.2 stage 2): structure commands on the REAL records. One rule for every holder of
// per-anchor geometry of a curve — the curve record, its legacy head-turn track, every preset's forms, the
// characters' data on it, reference overrides, fills, connections: a structure edit is ONE operation on a shape
// (absolute control points per anchor), applied to each holder in the same commit. Anchors the operation does
// not touch are copied unchanged (never re-derived), so untouched data stays bit-identical.
// - Linear operations (split, subset, copy, straight join, end merge) apply to stored offsets directly.
// - keepShape join is not linear: an offset track gets join(base + offset) − join(base) at the changed handles.
// - Legacy tracks are promoted to one offset per control point (legacy-delta3) in the same commit.
// What is refused (bounded scope, dot 1791310412 / 1791310505): new-mode bind / merge (stage 3), structure edits
// that change the anchor set of a rule role curve, joins / merges / cuts / deletions on curves with character
// data, insert / join / merge on curves with reference overrides, deleting on closed loops.
// The math is the reviewed experiment code (experiments/deletePoint.ts joinCubic, insertPoint de Casteljau).
import type { RecordId } from '@tldraw/store'
import type { EditError, IdSource, Plan } from './commands'
import { deviation, joinCubic, type JoinMode } from './experiments/deletePoint'
import { playabilityNotices } from './characterCommands'
import { paramFor, presetFormsIdOf } from './forms'
import { connectionsAt, familiesOf, fillsUsing, referencesOf } from './indexes'
import { anchorKey, containerChain, getAs, overlayReader, type AnchorRef } from './model'
import { legacy3Keys, promoteLegacy } from './pose'
import {
  Curve,
  Forms,
  Visibility,
  isBridge,
  poseIdOf,
  type Anchor,
  type BaseReader,
  type BoundaryStep,
  type CharacterRecord,
  type ConnectionRecord,
  type AbsoluteYawKey,
  type CurveRecord,
  type DocRecord,
  type FamilyRecord,
  type FillRecord,
  type FormsRecord,
  type Legacy3YawKey,
  type PointDelta,
  type PresetRecord,
  type ReferenceRecord,
  type Segment,
  type Shape,
  type Vec,
  type VisibilityRecord,
} from './schema'

type Store = BaseReader
type Pt = Shape[string]
type Cubic = [Vec, Vec, Vec, Vec]
export type StructureCommand =
  | { type: 'insertPoint'; curveId: RecordId<CurveRecord>; segmentId: string; u: number }
  | { type: 'removeAnchorJoin'; curveId: RecordId<CurveRecord>; anchorId: string; mode: JoinMode }
  | { type: 'deleteAnchorWithSegments'; curveId: RecordId<CurveRecord>; anchorId: string }
  | { type: 'breakAt'; curveId: RecordId<CurveRecord>; anchorId: string }
  | { type: 'addClosingSegment'; curveId: RecordId<CurveRecord> }
  | { type: 'removeClosingSegment'; curveId: RecordId<CurveRecord>; segmentId: string }
  | { type: 'mergeEnds'; curveId: RecordId<CurveRecord>; keep: 'mid' | 'first' | 'last' }
  | { type: 'bind'; a: AnchorRef; b: AnchorRef; keep: 'mid' | 'first' | 'second'; id?: RecordId<ConnectionRecord> }
  | { type: 'unbind'; connectionId: RecordId<ConnectionRecord> }
  /**
   * Continue an open path from one end (Illustrator: the Pen on an end point). `anchors` are the new anchors in the
   * CURVE's order (appended after the last anchor for 'end'; put before the first for 'start'), handles relative as
   * stored; `endHandle` = the end anchor's new outer handle (hOut at the end, hIn at the start) when the continuing drag
   * set one. Refused while the curve carries per-anchor data elsewhere (a head-turn track, preset forms, character
   * data): a new anchor has no offset there yet — stated, not guessed.
   */
  | { type: 'extendCurve'; curveId: RecordId<CurveRecord>; end: 'start' | 'end'; anchors: Anchor[]; endHandle?: Vec }
  | {
      type: 'createCurve'
      id?: RecordId<CurveRecord>
      parentId: CurveRecord['parentId']
      name?: string
      /** place among the siblings (fractional index); default: the record default */
      index?: string
      anchors: Record<string, Anchor>
      segments: Segment[]
      closed?: boolean
      /** preset author mode: register in the preset's family; this preset gets the drawing as its original */
      preset?: RecordId<PresetRecord>
    }

const fail = (code: EditError['code'], message: string, objects: string[], fixes: string[] = []): Plan => ({ ok: false, error: { code, message, objects, fixes } })
const v = (x: number, y: number): Vec => ({ x, y })
const add = (a: Vec, b: Vec) => v(a.x + b.x, a.y + b.y)
const sub = (a: Vec, b: Vec) => v(a.x - b.x, a.y - b.y)
const lerp = (a: Vec, b: Vec, t: number) => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
const samePt = (a: Pt, b: Pt) => a.p.x === b.p.x && a.p.y === b.p.y && a.hIn.x === b.hIn.x && a.hIn.y === b.hIn.y && a.hOut.x === b.hOut.x && a.hOut.y === b.hOut.y

// ---------- shapes of the holders ----------
const absOf = (c: CurveRecord): Shape => Object.fromEntries(Object.values(c.anchors).map((a) => [a.id, { p: a.p, hIn: add(a.p, a.hIn), hOut: add(a.p, a.hOut) }]))
/** back to the curve record's relative handles; anchors whose control points did not change keep their record entry */
function relOf(old: CurveRecord, before: Shape, after: Shape): Record<string, Anchor> {
  return Object.fromEntries(
    Object.entries(after).map(([id, a]) => (before[id] && samePt(before[id], a) ? [id, old.anchors[id]] : [id, { id, p: a.p, hIn: sub(a.hIn, a.p), hOut: sub(a.hOut, a.p) }])),
  )
}
const deltaShape = (o: Record<string, PointDelta>): Shape => Object.fromEntries(Object.entries(o).map(([a, d]) => [a, { p: d.dp, hIn: d.dIn, hOut: d.dOut }]))
const fromDeltaShape = (sh: Shape): Record<string, PointDelta> => Object.fromEntries(Object.entries(sh).map(([a, q]) => [a, { dp: q.p, dIn: q.hIn, dOut: q.hOut }]))

/** An operation on one shape (absolute points, or offsets when `linear`). */
type Op = { linear: boolean; apply: (sh: Shape) => Shape }

/** de Casteljau split of A → B at u: A.hOut and B.hIn change, M is new (the reviewed insertPoint math). */
const splitOp = (A: string, B: string, M: string, u: number): Op => ({
  linear: true,
  apply(sh) {
    const a = sh[A], b = sh[B]
    const p01 = lerp(a.p, a.hOut, u), p12 = lerp(a.hOut, b.hIn, u), p23 = lerp(b.hIn, b.p, u)
    const p012 = lerp(p01, p12, u), p123 = lerp(p12, p23, u)
    const out: Shape = {}
    for (const [id, q] of Object.entries(sh)) {
      out[id] = id === A ? { ...q, hOut: p01 } : id === B ? { ...q, hIn: p23 } : q
      if (id === A) out[M] = { hIn: p012, p: lerp(p012, p123, u), hOut: p123 }
    }
    return out
  },
})
/**
 * The joined handles for one shape — exactly the reviewed experiment's rule (deletePoint removeAnchorJoin, 0e29fb3):
 * keepHandles / straight as named; keepShape = the smallest measured deviation among the least-squares fit, the old
 * handles and the inverse de Casteljau split (exact when M came from a split).
 */
function joinHandles(a: Pt, m: Pt, c: Pt, mode: JoinMode): { hOut: Vec; hIn: Vec } {
  const A = { id: 'A', ...a }, M = { id: 'M', ...m }, C = { id: 'C', ...c }
  let j = joinCubic(A, M, C, mode)
  if (mode !== 'keepShape') return j
  const old: Cubic[] = [[a.p, a.hOut, m.hIn, m.p], [m.p, m.hOut, c.hIn, c.p]]
  let err = deviation(old, [a.p, j.hOut, j.hIn, c.p])
  const len = (q: Vec) => Math.hypot(q.x, q.y)
  const hi = len(sub(m.p, m.hIn)), ho = len(sub(m.hOut, m.p))
  const u = hi / (hi + ho)
  const cands = [
    { hOut: { ...a.hOut }, hIn: { ...c.hIn } },
    { hOut: v(a.p.x + (a.hOut.x - a.p.x) / u, a.p.y + (a.hOut.y - a.p.y) / u), hIn: v(c.p.x + (c.hIn.x - c.p.x) / (1 - u), c.p.y + (c.hIn.y - c.p.y) / (1 - u)) },
  ]
  for (const k of cands) {
    if (![k.hOut.x, k.hOut.y, k.hIn.x, k.hIn.y].every(Number.isFinite)) continue
    const e = deviation(old, [a.p, k.hOut, k.hIn, c.p])
    if (e < err) [j, err] = [k, e]
  }
  return j
}
const joinOp = (A: string, M: string, C: string, mode: JoinMode): Op => ({
  linear: mode !== 'keepShape',
  apply(sh) {
    const j = joinHandles(sh[A], sh[M], sh[C], mode)
    const out: Shape = {}
    for (const [id, q] of Object.entries(sh)) {
      if (id === M) continue
      out[id] = id === A ? { ...q, hOut: j.hOut } : id === C ? { ...q, hIn: j.hIn } : q
    }
    return out
  },
})
const subsetOp = (keep: Set<string>): Op => ({ linear: true, apply: (sh) => Object.fromEntries(Object.entries(sh).filter(([id]) => keep.has(id))) })
/** cut at X: the copy X' ends the incoming segment (keeps hIn), X starts the outgoing one; the unused handles retract */
const copyOp = (X: string, copy: string): Op => ({
  linear: true,
  apply(sh) {
    const x = sh[X]
    const out: Shape = {}
    for (const [id, q] of Object.entries(sh)) out[id] = id === X ? { ...q, hIn: q.p } : q
    out[copy] = { p: x.p, hIn: x.hIn, hOut: x.p }
    return out
  },
})

/** the curve record after an op (relative handles; untouched anchors copied) */
const curveAfter = (c: CurveRecord, op: Op, segments: Segment[], extra: Partial<CurveRecord> = {}): CurveRecord => {
  const before = absOf(c)
  return { ...c, ...extra, anchors: relOf(c, before, op.apply(before)), segments }
}

/** a legacy track after an op: promoted, then its offsets transformed (directly when linear) */
function legacyAfter(f: FormsRecord, curve: CurveRecord, op: Op): FormsRecord {
  // a promoted track may be sparse (missing anchor = 0 offsets): complete it, so the op sees every anchor
  // (dot, review of 56ede93: a sparse delta3 insert read an undefined end)
  const zero = () => ({ dp: v(0, 0), dIn: v(0, 0), dOut: v(0, 0) })
  const promoted = promoteLegacy(f, Object.keys(curve.anchors))
  const p: FormsRecord = { ...promoted, yaw: legacy3Keys(promoted).map((k) => ({ yaw: k.yaw, offsets: Object.fromEntries(Object.keys(curve.anchors).map((a) => [a, k.offsets[a] ?? zero()])) })) }
  const base = absOf(curve)
  const opBase = op.linear ? undefined : op.apply(base)
  const yaw = legacy3Keys(p).map((k): Legacy3YawKey => {
    const d = deltaShape(k.offsets)
    if (op.linear) return { yaw: k.yaw, offsets: fromDeltaShape(op.apply(d)) }
    // non-linear: only the control points the op changes get join(base + offset) − join(base)
    const moved: Shape = Object.fromEntries(Object.entries(base).map(([a, q]) => [a, { p: add(q.p, d[a].p), hIn: add(q.hIn, d[a].hIn), hOut: add(q.hOut, d[a].hOut) }]))
    const after = op.apply(moved)
    const out: Shape = {}
    for (const a of Object.keys(after)) {
      const same = base[a] && samePt(base[a], opBase![a]) && samePt(moved[a], after[a])
      out[a] = same ? d[a] : { p: sub(after[a].p, opBase![a].p), hIn: sub(after[a].hIn, opBase![a].hIn), hOut: sub(after[a].hOut, opBase![a].hOut) }
    }
    return { yaw: k.yaw, offsets: fromDeltaShape(out) }
  })
  return { ...p, yaw }
}
/** a preset's forms after an op: every stored shape (original, yaw keys, expression keyframes) */
function presetFormsAfter(f: FormsRecord, op: Op): FormsRecord {
  if (f.encoding !== 'absolute') return f
  return {
    ...f,
    original: f.original && f.original !== 'curve' ? op.apply(f.original) : f.original,
    yaw: f.yaw.map((k) => ({ yaw: k.yaw, shape: op.apply((k as { shape: Shape }).shape) })),
    expr: Object.fromEntries(Object.entries(f.expr).map(([param, keys]) => [param, keys.map((k) => ({ yaw: k.yaw, shape: op.apply(k.shape) }))])),
  }
}

// ---------- what depends on a curve ----------
type CurveData = {
  curve: CurveRecord
  legacy?: FormsRecord
  families: FamilyRecord[]
  presets: PresetRecord[]
  presetForms: FormsRecord[]
  characters: CharacterRecord[] // with data ON this curve
  visibility: VisibilityRecord[]
  refs: ReferenceRecord[] // references whose source shows the curve
  overrides: ReferenceRecord[] // … with an override on one of its anchors
}
function curveData(store: Store, curve: CurveRecord): CurveData {
  const all = store.allRecords()
  const families = familiesOf(store, curve.id).map((id) => getAs(store, id, 'family')!).filter(Boolean)
  const famIds = new Set(families.map((f) => f.id as string))
  const presets = all.filter((r): r is PresetRecord => r.typeName === 'preset' && famIds.has(r.familyId))
  const presetForms = presets.map((p) => getAs(store, presetFormsIdOf(p.id, curve.id), 'forms')).filter((f): f is FormsRecord => !!f)
  const conns = new Set(Object.keys(curve.anchors).flatMap((a) => connectionsAt(store, anchorKey({ curveId: curve.id, anchorId: a }))))
  const characters = all.filter(
    (r): r is CharacterRecord =>
      r.typeName === 'character' &&
      (!!r.fineTune[curve.id] || r.takeovers.some((t) => (t.kind === 'line' ? t.curveId === curve.id : conns.has(t.connectionId))) || r.exprFixes.some((f) => f.curveId === curve.id)),
  )
  const visibility = all.filter((r): r is VisibilityRecord => r.typeName === 'visibility' && r.curveId === curve.id)
  const refs = containerChain(store, curve.parentId).flatMap((k) => referencesOf(store, k.id).map((id) => getAs(store, id, 'reference')!))
  const overrides = refs.filter((r) => Object.keys(r.overrides).some((k) => k.startsWith(`${curve.id}#`)))
  return { curve, legacy: getAs(store, poseIdOf(curve.id), 'forms'), families, presets, presetForms, characters, visibility, refs, overrides }
}

class Collision extends Error {}
/**
 * A new id from the operation's identity source, re-checked against the CURRENT target: a prepared operation may
 * reuse an id it allocated earlier, but never one that is taken here (dot, review of 56ede93: a re-targeted
 * prepared insert reused 'm' on a curve that already had an 'm' and wrote an m → m segment).
 */
function take(ids: IdSource, kind: string, fresh: () => string, taken: (id: string) => boolean): string {
  const id = ids.take(kind, fresh)
  if (taken(id)) throw new Collision(`the prepared new id ${id} is already used in the target: prepare a new operation`)
  return id
}
const unique = (base: string, taken: (id: string) => boolean) => {
  let id = base
  for (let k = 1; taken(id); k++) id = `${base}~${k}`
  return id
}
const isClosedLoop = (c: CurveRecord) => c.closed || (c.segments.length > 0 && c.segments[c.segments.length - 1].to === c.segments[0].from)

function refuse(d: CurveData, what: string, checks: ('characters' | 'overrides' | 'family')[]): Plan | null {
  const c = d.curve.id
  if (checks.includes('characters') && d.characters.length)
    return fail('INVALID', `${what} on ${c}: characters ${d.characters.map((r) => r.id).join(', ')} hold data on it (fine-tune / takeovers / expression fixes) — not supported for this edit`, [c, ...d.characters.map((r) => r.id)])
  if (checks.includes('overrides') && d.overrides.length)
    return fail('INVALID', `${what} on ${c}: references ${d.overrides.map((r) => r.id).join(', ')} override its anchors — they cannot be carried over exactly`, [c, ...d.overrides.map((r) => r.id)])
  if (checks.includes('family') && d.families.length)
    return fail('INVALID', `${what} on ${c} (preset forms of ${d.families.map((f) => f.id).join(', ')}): needs the node basis of stage 3`, [c, ...d.families.map((f) => f.id)])
  return null
}

/** every holder of the curve's per-anchor geometry, after one op (+ the record's own segment change) */
function applyEverywhere(d: CurveData, op: Op, segments: Segment[], extra: Partial<CurveRecord> = {}): DocRecord[] {
  const puts: DocRecord[] = [curveAfter(d.curve, op, segments, extra)]
  if (d.legacy) puts.push(legacyAfter(d.legacy, d.curve, op))
  for (const f of d.presetForms) puts.push(presetFormsAfter(f, op))
  return puts
}

const fillStepsOf = (store: Store, curveId: string) => fillsUsing(store, curveId).map((id) => getAs(store, id, 'fill')!).filter(Boolean)

// ---------- the commands ----------
export function planStructure(store: Store, cmd: StructureCommand, ids: IdSource): Plan {
  try {
    return planStructureChecked(store, cmd, ids)
  } catch (e) {
    if (e instanceof Collision) return fail('ID_CONFLICT', e.message, [])
    throw e
  }
}

function planStructureChecked(store: Store, cmd: StructureCommand, ids: IdSource): Plan {
  switch (cmd.type) {
    case 'insertPoint': {
      const c = getAs(store, cmd.curveId, 'curve')
      if (!c) return fail('NOT_FOUND', `no curve ${cmd.curveId}`, [String(cmd.curveId)])
      const seg = c.segments.find((s) => s.id === cmd.segmentId)
      if (!seg) return fail('NOT_FOUND', `${c.id} has no segment ${cmd.segmentId}`, [c.id])
      if (typeof cmd.u !== 'number' || !(cmd.u > 0 && cmd.u < 1)) return fail('INVALID', `u must be a number strictly between 0 and 1 (got ${cmd.u})`, [c.id])
      const d = curveData(store, c)
      const no = refuse(d, 'inserting a point', ['overrides'])
      if (no) return no
      const M = take(ids, 'anchor', () => unique('m', (x) => !!c.anchors[x]), (x) => !!c.anchors[x])
      const sa = take(ids, 'segment', () => unique(`${seg.id}a`, (x) => c.segments.some((s) => s.id === x)), (x) => c.segments.some((s) => s.id === x))
      const sb = take(ids, 'segment', () => unique(`${seg.id}b`, (x) => x === sa || c.segments.some((s) => s.id === x)), (x) => x === sa || c.segments.some((s) => s.id === x))
      const op = splitOp(seg.from, seg.to, M, cmd.u)
      const segments = c.segments.flatMap((s) => (s.id === seg.id ? [{ id: sa, from: s.from, to: M }, { id: sb, from: M, to: s.to }] : [s]))
      const puts = applyEverywhere(d, op, segments)
      // characters (linear data): fine-tune offsets, line takeovers' frozen shapes and expression fixes split too;
      // frozen L kept as stored (insertPoint experiment, dot 1791302010-5)
      for (const ch of d.characters) {
        const ft = ch.fineTune[c.id]
        let fineTune = ch.fineTune
        if (ft) {
          const zero = { dp: v(0, 0), dIn: v(0, 0), dOut: v(0, 0) }
          const full = Object.fromEntries(Object.keys(c.anchors).map((a) => [a, ft[a] ?? zero]))
          const split = fromDeltaShape(op.apply(deltaShape(full)))
          const keep = (a: string) => a in ft || ((a === M || a === seg.from || a === seg.to) && (seg.from in ft || seg.to in ft))
          fineTune = { ...ch.fineTune, [c.id]: Object.fromEntries(Object.entries(split).filter(([a]) => keep(a))) }
        }
        puts.push({
          ...ch,
          fineTune,
          takeovers: ch.takeovers.map((t) => (t.kind === 'line' && t.curveId === c.id ? { ...t, target: op.apply(t.target), basisFront: op.apply(t.basisFront) } : t)),
          exprFixes: ch.exprFixes.map((f) => (f.curveId === c.id ? { ...f, shape: op.apply(f.shape) } : f)),
        })
      }
      for (const f of fillStepsOf(store, c.id)) {
        const boundary = f.boundary.flatMap((st): BoundaryStep[] =>
          isBridge(st) || st.curveId !== c.id || st.segmentId !== seg.id ? [st] : st.dir === 1 ? [{ ...st, segmentId: sa }, { ...st, segmentId: sb }] : [{ ...st, segmentId: sb }, { ...st, segmentId: sa }],
        )
        if (JSON.stringify(boundary) !== JSON.stringify(f.boundary)) puts.push({ ...f, boundary })
      }
      return { ok: true, label: 'insertPoint', puts, affected: [c.id, `${c.id}#${M}`] }
    }

    case 'removeAnchorJoin': {
      const c = getAs(store, cmd.curveId, 'curve')
      if (!c) return fail('NOT_FOUND', `no curve ${cmd.curveId}`, [String(cmd.curveId)])
      if (!['keepHandles', 'keepShape', 'straight'].includes(cmd.mode)) return fail('INVALID', `mode must be keepHandles, keepShape or straight (got ${cmd.mode})`, [c.id])
      if (!c.anchors[cmd.anchorId]) return fail('NOT_FOUND', `${c.id} has no anchor ${cmd.anchorId}`, [c.id])
      if (isClosedLoop(c)) return fail('INVALID', `${c.id} is a closed loop: deleting on closed curves is not supported yet`, [c.id])
      const sIn = c.segments.find((s) => s.to === cmd.anchorId), sOut = c.segments.find((s) => s.from === cmd.anchorId)
      if (!sIn || !sOut) return fail('INVALID', `${cmd.anchorId} is an end node: use deleteAnchorWithSegments`, [c.id])
      const key = anchorKey({ curveId: c.id, anchorId: cmd.anchorId })
      const conn = connectionsAt(store, key)
      if (conn.length) return fail('INVALID', `connection ${conn.join(', ')} uses ${key}: unbind it first`, [key, ...conn])
      const d = curveData(store, c)
      const no = refuse(d, 'removing an anchor', ['characters', 'overrides'])
      if (no) return no
      const seg = take(ids, 'segment', () => unique(`${sIn.id}+${sOut.id}`, (x) => c.segments.some((s) => s.id === x)), (x) => c.segments.some((s) => s.id === x && s.id !== sIn.id && s.id !== sOut.id))
      const op = joinOp(sIn.from, cmd.anchorId, sOut.to, cmd.mode)
      const segments = c.segments.flatMap((s) => (s.id === sIn.id ? [{ id: seg, from: sIn.from, to: sOut.to }] : s.id === sOut.id ? [] : [s]))
      const puts = applyEverywhere(d, op, segments)
      for (const f of fillStepsOf(store, c.id)) {
        const pair = (st: BoundaryStep) => !isBridge(st) && st.curveId === c.id && (st.segmentId === sIn.id || st.segmentId === sOut.id)
        if (f.boundary.some((st) => isBridge(st) && [st.bridge.from, st.bridge.to].some((e) => e.curveId === c.id && e.anchorId === cmd.anchorId)))
          return fail('INVALID', `fill ${f.id} has a bridge at ${key}: repair the fill first`, [f.id, key])
        const idx = f.boundary.map((st, i) => (pair(st) ? i : -1)).filter((i) => i >= 0)
        if (!idx.length) continue
        const n = f.boundary.length
        if (!(idx.length === 2 && (idx[1] - idx[0] === 1 || (idx[0] === 0 && idx[1] === n - 1))))
          return fail('INVALID', `fill ${f.id} uses only part of ${sIn.id} / ${sOut.id}: repair or remove the fill first`, [f.id])
        const dir = (f.boundary[idx[0]] as { dir: 1 | -1 }).dir
        const kept = f.boundary.filter((st) => !pair(st))
        const at = idx[0] === 0 && idx[1] === n - 1 ? kept.length : idx[0]
        kept.splice(at, 0, { curveId: c.id, segmentId: seg, dir })
        puts.push({ ...f, boundary: kept })
      }
      return { ok: true, label: 'removeAnchorJoin', puts, affected: [c.id], removals: [] }
    }

    case 'deleteAnchorWithSegments':
    case 'breakAt': {
      const c = getAs(store, cmd.curveId, 'curve')
      if (!c) return fail('NOT_FOUND', `no curve ${cmd.curveId}`, [String(cmd.curveId)])
      const X = cmd.anchorId
      if (!c.anchors[X]) return fail('NOT_FOUND', `${c.id} has no anchor ${X}`, [c.id])
      const closed = isClosedLoop(c)
      const iIn = c.segments.findIndex((s) => s.to === X), iOut = c.segments.findIndex((s) => s.from === X)
      const d = curveData(store, c)
      const key = anchorKey({ curveId: c.id, anchorId: X })
      const isCut = cmd.type === 'breakAt'
      if (isCut && (iIn < 0 || iOut < 0)) return fail('INVALID', `${key} is an end node: cutting there changes nothing`, [key])
      if (!isCut && closed) return fail('INVALID', `${c.id} is a closed loop: deleting on closed curves is not supported yet`, [c.id])
      const no = refuse(d, isCut ? 'cutting' : 'deleting an anchor', ['characters'])
      if (no) return no
      if (isCut) {
        const conn = connectionsAt(store, key)
        if (conn.length) return fail('INVALID', `connection ${conn.join(', ')} uses ${key}: unbind it before cutting there`, [key, ...conn])
      }
      // the parts after the edit
      const removed = isCut ? [] : [iIn, iOut].filter((i) => i >= 0).map((i) => c.segments[i].id)
      const copy = isCut ? take(ids, 'anchor', () => unique(`${X}'`, (x) => !!c.anchors[x]), (x) => !!c.anchors[x]) : ''
      let first: Segment[], second: Segment[]
      if (isCut && closed) {
        // closed loop: ONE open chain starting at the cut; the incoming segment now ends at the copy
        first = [...c.segments.slice(iOut), ...c.segments.slice(0, iOut)].map((s) => (s.id === c.segments[iIn].id ? { ...s, to: copy } : s))
        second = []
      } else if (isCut) {
        first = [...c.segments.slice(0, iIn), { ...c.segments[iIn], to: copy }]
        second = c.segments.slice(iOut)
      } else {
        const i = iIn >= 0 ? iIn : iOut
        ;[first, second] = [c.segments.slice(0, i), c.segments.slice(i + removed.length)]
        if (!first.length) [first, second] = [second, []]
      }
      if (!first.length) return fail('INVALID', `deleting ${key} would leave ${c.id} without segments: delete the curve instead`, [c.id])
      const anchorsOf = (segs: Segment[]) => new Set(segs.flatMap((s) => [s.from, s.to]))
      const keep1 = anchorsOf(first), keep2 = anchorsOf(second)
      const gone = Object.keys(c.anchors).filter((a) => !keep1.has(a) && !keep2.has(a) && a !== copy)
      // nothing may still point at a removed anchor or segment
      for (const a of gone) {
        const k = anchorKey({ curveId: c.id, anchorId: a })
        const cs = connectionsAt(store, k)
        if (cs.length) return fail('INVALID', `connection ${cs.join(', ')} uses ${k}, which would be left without segments: unbind it first`, [k, ...cs])
      }
      for (const f of fillStepsOf(store, c.id))
        if (f.boundary.some((st) => (isBridge(st) ? [st.bridge.from, st.bridge.to].some((e) => e.curveId === c.id && gone.includes(e.anchorId)) : st.curveId === c.id && removed.includes(st.segmentId))))
          return fail('INVALID', `fill ${f.id} uses a removed segment or anchor of ${c.id}: repair or remove it first`, [f.id])
      const newId = second.length ? (take(ids, 'curve', () => unique(`${c.id}~part`, (x) => !!store.get(x as any)), (x) => !!store.get(x as any)) as RecordId<CurveRecord>) : undefined
      const opCut = isCut ? copyOp(X, copy) : { linear: true, apply: (sh: Shape) => sh }
      const opFirst: Op = { linear: true, apply: (sh) => subsetOp(keep1).apply(opCut.apply(sh)) }
      const opSecond: Op = { linear: true, apply: (sh) => subsetOp(keep2).apply(opCut.apply(sh)) }
      const puts: DocRecord[] = []
      const creates: string[] = []
      puts.push(...applyEverywhere(d, opFirst, first, isCut && closed ? { closed: false } : {}))
      if (newId) {
        const right = { ...curveAfter(d.curve, opSecond, second, { closed: false }), id: newId }
        puts.push(right)
        creates.push(newId)
        if (d.legacy) {
          const lf = { ...legacyAfter(d.legacy, d.curve, opSecond), id: poseIdOf(newId), curveId: newId }
          puts.push(lf)
          creates.push(lf.id)
        }
        // a family curve stays registered as two family curves: every preset gets forms for the new part
        for (const fam of d.families) puts.push({ ...fam, curves: [...fam.curves, newId] })
        for (const f of d.presetForms) {
          const nf = { ...presetFormsAfter(f, opSecond), id: presetFormsIdOf((f.owner as { id: string }).id, newId), curveId: newId }
          puts.push(nf)
          creates.push(nf.id)
        }
        for (const vis of d.visibility) {
          const nv = { ...vis, id: Visibility.createId(`${vis.id.replace(/^visibility:/, '')}~${newId}`), curveId: newId }
          puts.push(nv)
          creates.push(nv.id)
        }
      }
      const owner = (a: string) => (newId && keep2.has(a) && !keep1.has(a) ? newId : c.id)
      const segOwner = (s: string) => (newId && second.some((x) => x.id === s) ? newId : c.id)
      // reference overrides follow their anchor (renamed with it), the copy gets the cut anchor's override,
      // a removed anchor's override goes with it — exact
      for (const r of d.refs) {
        const ov: Record<string, Vec> = {}
        for (const [k, p] of Object.entries(r.overrides)) {
          if (!k.startsWith(`${c.id}#`)) {
            ov[k] = p
            continue
          }
          const a = k.slice(c.id.length + 1)
          if (gone.includes(a)) continue
          ov[`${owner(a)}#${a}`] = p
          if (isCut && a === X) ov[`${owner(copy)}#${copy}`] = p
        }
        if (JSON.stringify(ov) !== JSON.stringify(r.overrides)) puts.push({ ...r, overrides: ov })
      }
      for (const cn of new Set(Object.keys(c.anchors).flatMap((a) => connectionsAt(store, anchorKey({ curveId: c.id, anchorId: a }))))) {
        const conn = getAs(store, cn, 'connection')!
        const ends = conn.ends.map((e) => (e.curveId === c.id ? { ...e, curveId: owner(e.anchorId) as RecordId<CurveRecord> } : e))
        if (JSON.stringify(ends) !== JSON.stringify(conn.ends)) puts.push({ ...conn, ends })
      }
      for (const f of fillStepsOf(store, c.id)) {
        const boundary = remapBoundary(f, c.id, newId, segOwner, owner, isCut ? { X, copy } : undefined, puts)
        if (JSON.stringify(boundary) !== JSON.stringify(f.boundary)) puts.push({ ...f, boundary })
      }
      return { ok: true, label: cmd.type, puts, affected: [c.id, ...(newId ? [newId] : [])], ...(creates.length ? { creates } : {}) }
    }

    case 'addClosingSegment': {
      const c = getAs(store, cmd.curveId, 'curve')
      if (!c) return fail('NOT_FOUND', `no curve ${cmd.curveId}`, [String(cmd.curveId)])
      if (isClosedLoop(c)) return fail('INVALID', `${c.id} is already closed`, [c.id])
      if (!c.segments.length) return fail('INVALID', `${c.id} has no segments`, [c.id])
      const s = take(ids, 'segment', () => unique('close', (x) => c.segments.some((q) => q.id === x)), (x) => c.segments.some((q) => q.id === x))
      // our command semantics: the new segment uses the ends' stored outer handles; nothing else changes
      return { ok: true, label: 'addClosingSegment', puts: [{ ...c, closed: true, segments: [...c.segments, { id: s, from: c.segments[c.segments.length - 1].to, to: c.segments[0].from }] }], affected: [c.id] }
    }

    case 'extendCurve': {
      const c = getAs(store, cmd.curveId, 'curve')
      if (!c) return fail('NOT_FOUND', `no curve ${cmd.curveId}`, [String(cmd.curveId)])
      if (isClosedLoop(c)) return fail('INVALID', `${c.id} is closed: it has no end to continue from`, [c.id])
      if (cmd.end !== 'start' && cmd.end !== 'end') return fail('INVALID', `end must be start or end (got ${cmd.end})`, [c.id])
      if (!Array.isArray(cmd.anchors) || !cmd.anchors.length) return fail('INVALID', 'no anchors to add', [c.id])
      const fin = (q: unknown) => !!q && Number.isFinite((q as Vec).x) && Number.isFinite((q as Vec).y)
      if (!cmd.anchors.every((a) => a && fin(a.p) && fin(a.hIn) && fin(a.hOut)) || (cmd.endHandle !== undefined && !fin(cmd.endHandle))) return fail('INVALID', 'anchors and handles must be finite', [c.id])
      const d = curveData(store, c)
      const no = refuse(d, 'continuing the path', ['characters', 'family'])
      if (no) return no
      if (d.legacy) return fail('INVALID', `continuing the path on ${c.id}: it has a head-turn track — the new anchors would have no offsets there`, [c.id, d.legacy.id])
      const taken = new Set(Object.keys(c.anchors))
      const segTaken = new Set(c.segments.map((x) => x.id))
      const added: Anchor[] = []
      for (const a of cmd.anchors) {
        const id = take(ids, 'anchor', () => unique('p', (x) => taken.has(x)), (x) => taken.has(x))
        taken.add(id)
        added.push({ id, p: { ...a.p }, hIn: { ...a.hIn }, hOut: { ...a.hOut } })
      }
      const E = cmd.end === 'end' ? c.segments[c.segments.length - 1].to : c.segments[0].from
      const chain = cmd.end === 'end' ? [E, ...added.map((a) => a.id)] : [...added.map((a) => a.id), E]
      const segs: Segment[] = []
      for (let i = 1; i < chain.length; i++) {
        const id = take(ids, 'segment', () => unique('s', (x) => segTaken.has(x)), (x) => segTaken.has(x))
        segTaken.add(id)
        segs.push({ id, from: chain[i - 1], to: chain[i] })
      }
      const endA = c.anchors[E]
      const anchors = { ...c.anchors, ...Object.fromEntries(added.map((a) => [a.id, a])), ...(cmd.endHandle ? { [E]: { ...endA, [cmd.end === 'end' ? 'hOut' : 'hIn']: { ...cmd.endHandle } } } : {}) }
      const segments = cmd.end === 'end' ? [...c.segments, ...segs] : [...segs, ...c.segments]
      return { ok: true, label: 'extendCurve', puts: [{ ...c, anchors, segments }], affected: [c.id, ...added.map((a) => `${c.id}#${a.id}`)] }
    }

    case 'removeClosingSegment': {
      const c = getAs(store, cmd.curveId, 'curve')
      if (!c) return fail('NOT_FOUND', `no curve ${cmd.curveId}`, [String(cmd.curveId)])
      if (!isClosedLoop(c)) return fail('INVALID', `${c.id} is not closed`, [c.id])
      const i = c.segments.findIndex((s) => s.id === cmd.segmentId)
      if (i < 0) return fail('NOT_FOUND', `${c.id} has no segment ${cmd.segmentId}`, [c.id])
      if (c.segments.length < 2) return fail('INVALID', `${c.id} would be left without segments`, [c.id])
      const used = fillStepsOf(store, c.id).filter((f) => f.boundary.some((st) => !isBridge(st) && st.curveId === c.id && st.segmentId === cmd.segmentId))
      if (used.length) return fail('INVALID', `fill ${used.map((f) => f.id).join(', ')} uses ${cmd.segmentId}: repair or remove it first`, used.map((f) => f.id))
      // one open chain starting at the removed segment's end
      return { ok: true, label: 'removeClosingSegment', puts: [{ ...c, closed: false, segments: [...c.segments.slice(i + 1), ...c.segments.slice(0, i)] }], affected: [c.id] }
    }

    case 'mergeEnds': {
      const c = getAs(store, cmd.curveId, 'curve')
      if (!c) return fail('NOT_FOUND', `no curve ${cmd.curveId}`, [String(cmd.curveId)])
      if (isClosedLoop(c)) return fail('INVALID', `${c.id} is already closed`, [c.id])
      if (c.segments.length < 2) return fail('INVALID', `${c.id} has one segment: merging its ends would make a degenerate loop`, [c.id])
      if (!['mid', 'first', 'last'].includes(cmd.keep)) return fail('INVALID', `keep must be mid, first or last (got ${cmd.keep})`, [c.id])
      const F = c.segments[0].from, L = c.segments[c.segments.length - 1].to
      const d = curveData(store, c)
      const no = refuse(d, 'merging the ends', ['characters', 'overrides'])
      if (d.legacy && d.families.length) return fail('INVALID', `${c.id} has both a legacy track and preset forms: merging mixed modes is not supported`, [c.id])
      if (no) return no
      for (const a of [F, L]) {
        const cs = connectionsAt(store, anchorKey({ curveId: c.id, anchorId: a }))
        if (cs.length) return fail('INVALID', `connection ${cs.join(', ')} uses an end of ${c.id}: merging would move or remove it — unbind it first`, [c.id, ...cs])
      }
      const op: Op = {
        linear: true,
        apply(sh) {
          const f = sh[F], l = sh[L]
          const at = cmd.keep === 'first' ? f.p : cmd.keep === 'last' ? l.p : v((f.p.x + l.p.x) / 2, (f.p.y + l.p.y) / 2)
          const out: Shape = {}
          for (const [id, q] of Object.entries(sh)) if (id !== L) out[id] = id === F ? { p: at, hIn: add(l.hIn, sub(at, l.p)), hOut: add(f.hOut, sub(at, f.p)) } : q
          return out
        },
      }
      const segments = c.segments.map((s, i) => (i === c.segments.length - 1 ? { ...s, to: F } : s))
      const puts = applyEverywhere(d, op, segments, { closed: true })
      const notices = d.families.flatMap((fam) => familyNotices(store, puts, fam.id))
      return { ok: true, label: 'mergeEnds', puts, affected: [c.id], ...(notices.length ? { notices } : {}) }
    }

    case 'bind': {
      const [ca, cb] = [getAs(store, cmd.a.curveId, 'curve'), getAs(store, cmd.b.curveId, 'curve')]
      if (!ca || !cb) return fail('NOT_FOUND', 'both ends must be curves', [anchorKey(cmd.a), anchorKey(cmd.b)])
      if (ca.id === cb.id) return fail('INVALID', 'both ends on one curve: use mergeEnds or addClosingSegment', [ca.id])
      if (!['mid', 'first', 'second'].includes(cmd.keep)) return fail('INVALID', `keep must be mid, first or second (got ${cmd.keep})`, [ca.id])
      for (const [c, e] of [[ca, cmd.a], [cb, cmd.b]] as const) {
        if (isClosedLoop(c)) return fail('INVALID', `${c.id} is closed: no end node`, [c.id])
        if (e.anchorId !== c.segments[0]?.from && e.anchorId !== c.segments[c.segments.length - 1]?.to) return fail('INVALID', `${anchorKey(e)} is not an end node`, [anchorKey(e)])
        const cs = connectionsAt(store, anchorKey(e))
        if (cs.length) return fail('INVALID', `${anchorKey(e)} is already in connection ${cs.join(', ')}: adding to a connection group is not supported`, [anchorKey(e), ...cs])
        const no = refuse(curveData(store, c), 'binding', ['overrides'])
        if (no) return no
      }
      const [da, db] = [curveData(store, ca), curveData(store, cb)]
      if (da.families.length || db.families.length) return bindFamily(store, cmd, da, db, ids)
      const id = (cmd.id ?? take(ids, 'connection', () => unique('connection:bind', (x) => !!store.get(x as any)), (x) => !!store.get(x as any))) as RecordId<ConnectionRecord>
      const pa = ca.anchors[cmd.a.anchorId].p, pb = cb.anchors[cmd.b.anchorId].p
      const at = cmd.keep === 'first' ? pa : cmd.keep === 'second' ? pb : v((pa.x + pb.x) / 2, (pa.y + pb.y) / 2)
      const moved = (c: CurveRecord, a: string): CurveRecord => ({ ...c, anchors: { ...c.anchors, [a]: { ...c.anchors[a], p: at } } }) // relative handles move with it
      const puts: DocRecord[] = [moved(ca, cmd.a.anchorId), moved(cb, cmd.b.anchorId)]
      // legacy head-turn tracks: the two ends must agree at every yaw (the connection rule) — at the union of key
      // yaws both get the same offset (their mid, or the kept side's), keys inserted at the current interpolated forms
      const tracks = [ca, cb].map((c) => getAs(store, poseIdOf(c.id), 'forms'))
      if (tracks.some((t) => t)) {
        const yawsOf = (t?: FormsRecord) => (t ? t.yaw.map((k) => k.yaw) : [])
        const yaws = [...new Set([...yawsOf(tracks[0]), ...yawsOf(tracks[1])])].sort((x, y) => x - y)
        const ends = [cmd.a, cmd.b]
        const promoted = [ca, cb].map((c, i) => (tracks[i] ? promoteLegacy(tracks[i]!, Object.keys(c.anchors)) : undefined))
        const at3 = (i: number, yaw: number, part: 'dp' | 'dIn' | 'dOut', a: string) => {
          const ks = promoted[i] ? legacy3Keys(promoted[i]) : []
          if (!ks.length) return v(0, 0)
          const val = (k: Legacy3YawKey) => k.offsets[a]?.[part] ?? v(0, 0)
          if (yaw <= ks[0].yaw) return val(ks[0])
          if (yaw >= ks[ks.length - 1].yaw) return val(ks[ks.length - 1])
          const j = ks.findIndex((k) => k.yaw >= yaw)
          const t = (yaw - ks[j - 1].yaw) / (ks[j].yaw - ks[j - 1].yaw)
          return lerp(val(ks[j - 1]), val(ks[j]), t)
        }
        for (const [i, c] of [ca, cb].entries()) {
          const keys = yaws.map((yaw): Legacy3YawKey => {
            const existing = promoted[i] ? legacy3Keys(promoted[i]).find((k) => k.yaw === yaw) : undefined
            const offsets: Record<string, PointDelta> = existing ? { ...existing.offsets } : Object.fromEntries(Object.keys(c.anchors).map((a) => [a, { dp: at3(i, yaw, 'dp', a), dIn: at3(i, yaw, 'dIn', a), dOut: at3(i, yaw, 'dOut', a) }]))
            const oa = at3(0, yaw, 'dp', ends[0].anchorId), ob = at3(1, yaw, 'dp', ends[1].anchorId)
            const o = cmd.keep === 'first' ? oa : cmd.keep === 'second' ? ob : v((oa.x + ob.x) / 2, (oa.y + ob.y) / 2)
            const own = offsets[ends[i].anchorId] ?? { dp: v(0, 0), dIn: v(0, 0), dOut: v(0, 0) }
            const shift = sub(o, own.dp) // the handles move with the anchor
            offsets[ends[i].anchorId] = { dp: o, dIn: add(own.dIn, shift), dOut: add(own.dOut, shift) }
            return { yaw, offsets }
          })
          const base = promoted[i] ?? Forms.create({ id: poseIdOf(c.id), curveId: c.id, owner: { kind: 'document' }, encoding: 'legacy-delta3', original: 'curve', yaw: [], expr: {} })
          puts.push({ ...base, encoding: 'legacy-delta3', yaw: keys })
        }
      }
      puts.push({ typeName: 'connection', id, ends: [{ ...cmd.a }, { ...cmd.b }], geometricJoin: 'corner' } as ConnectionRecord)
      const creates = [id as string, ...[ca, cb].filter((c, i) => tracks.some((t) => t) && !tracks[i]).map((c) => poseIdOf(c.id) as string)]
      return { ok: true, label: 'bind', puts, affected: [anchorKey(cmd.a), anchorKey(cmd.b), id], creates }
    }

    case 'unbind': {
      const conn = getAs(store, cmd.connectionId, 'connection')
      if (!conn) return fail('NOT_FOUND', `no connection ${cmd.connectionId}`, [String(cmd.connectionId)])
      const takers = store.allRecords().filter((r) => r.typeName === 'character' && r.takeovers.some((t) => t.kind === 'node' && t.connectionId === conn.id))
      if (takers.length) return fail('INVALID', `${takers.map((r) => r.id).join(', ')} hold a node takeover on ${conn.id}: unbinding is not supported then`, [conn.id])
      return { ok: true, label: 'unbind', puts: [], removals: [conn.id], affected: [conn.id] }
    }

    case 'createCurve': {
      const id = (cmd.id ?? ids.take('curve', () => Curve.createId())) as RecordId<CurveRecord>
      if (!getAs(store, cmd.parentId, 'container')) return fail('NOT_FOUND', `no container ${cmd.parentId}`, [String(cmd.parentId)])
      const anchors = cmd.anchors ?? {}
      const segs = cmd.segments ?? []
      if (!segs.length) return fail('INVALID', 'a new curve needs at least one segment', [id])
      for (const [k, a] of Object.entries(anchors)) if (!a || a.id !== k) return fail('INVALID', `anchor ${k} must carry its own id`, [id])
      for (let i = 1; i < segs.length; i++) if (segs[i].from !== segs[i - 1].to) return fail('INVALID', `segments must form one chain (${segs[i - 1].id} → ${segs[i].id})`, [id])
      if (new Set(segs.map((q) => q.id)).size !== segs.length) return fail('INVALID', 'segment ids must be unique within the curve', [id])
      const used = new Set(segs.flatMap((s) => [s.from, s.to]))
      if ([...used].some((a) => !anchors[a]) || Object.keys(anchors).some((a) => !used.has(a))) return fail('INVALID', 'every segment end must be an anchor and every anchor on a segment', [id])
      const closed = !!cmd.closed
      if (closed !== (segs[segs.length - 1].to === segs[0].from)) return fail('INVALID', 'closed must match the chain (last segment ends at the first anchor)', [id])
      if (cmd.index !== undefined && (typeof cmd.index !== 'string' || !cmd.index)) return fail('INVALID', 'index must be a fractional index string', [id])
      const curve = Curve.create({ id, name: cmd.name ?? '线', parentId: cmd.parentId, ...(cmd.index ? { index: cmd.index } : {}), anchors: structuredClone(anchors), segments: structuredClone(segs), closed })
      const puts: DocRecord[] = [curve]
      const creates: string[] = [id]
      if (cmd.preset) {
        // preset author mode: the curve is registered in the preset's family; THIS preset's forms hold the drawing as
        // its original, every other preset of the family registers the identity only (missing until drawn, §20.4)
        const preset = getAs(store, cmd.preset, 'preset')
        if (!preset) return fail('NOT_FOUND', `no preset ${cmd.preset}`, [String(cmd.preset)])
        const fam = getAs(store, preset.familyId, 'family')
        if (!fam) return fail('NOT_FOUND', `no family ${preset.familyId}`, [String(preset.familyId)])
        puts.push({ ...fam, curves: [...fam.curves, id] })
        const drawing = absOf(curve)
        for (const p of store.allRecords().filter((r): r is PresetRecord => r.typeName === 'preset' && r.familyId === fam.id)) {
          const f = Forms.create({ id: presetFormsIdOf(p.id, id), curveId: id, owner: { kind: 'preset', id: p.id }, encoding: 'absolute', original: p.id === preset.id ? drawing : null, yaw: [], expr: {} })
          puts.push(f)
          creates.push(f.id)
        }
      }
      // characters of the family that will report this curve missing until their presets draw it (§20.4: allowed)
      const notices = cmd.preset ? familyNotices(store, puts, (getAs(store, (getAs(store, cmd.preset, 'preset') as PresetRecord).familyId, 'family') as FamilyRecord).id) : []
      return { ok: true, label: 'createCurve', puts, affected: [id], creates, ...(notices.length ? { notices } : {}) }
    }
  }
}

/**
 * Stage 3c: bind two FAMILY curves (new mode). Every preset of the family moves both ends to one position at every
 * state it stores — the original, every key of the union of the two curves' yaw tracks (missing keys inserted with
 * their existing evaluated form), and every expression author key (target and base shifted alike, so corrections are
 * kept) — handles moving with their end; the curve records likewise. Refused: mixed family / non-family or legacy
 * tracks; characters with takeovers or expression fixes on these curves, or with different fine-tune at the two ends
 * (binding never edits character data). The final document is checked by the usual relation checks (shared nodes at
 * the union of key yaws, closed states included).
 */
function bindFamily(store: Store, cmd: Extract<StructureCommand, { type: 'bind' }>, da: CurveData, db: CurveData, ids: IdSource): Plan {
  const fa = da.families.map((f) => f.id).sort().join(), fb = db.families.map((f) => f.id).sort().join()
  if (fa !== fb || da.families.length !== 1) return fail('INVALID', `${da.curve.id} and ${db.curve.id} are not curves of one family: binding across modes is not supported`, [da.curve.id, db.curve.id])
  if (da.legacy || db.legacy) return fail('INVALID', 'a family curve with a legacy head-turn track: binding mixed modes is not supported', [da.curve.id, db.curve.id])
  const fam = da.families[0]
  for (const k of store.allRecords().filter((r): r is CharacterRecord => r.typeName === 'character' && r.familyId === fam.id)) {
    if (k.takeovers.some((t) => t.kind === 'line' && (t.curveId === da.curve.id || t.curveId === db.curve.id)) || k.exprFixes.some((x) => x.curveId === da.curve.id || x.curveId === db.curve.id))
      return fail('INVALID', `${k.id} holds takeovers / expression fixes on these curves: binding is not supported then`, [k.id])
    const fta = k.fineTune[da.curve.id]?.[cmd.a.anchorId]?.dp ?? v(0, 0), ftb = k.fineTune[db.curve.id]?.[cmd.b.anchorId]?.dp ?? v(0, 0)
    if (fta.x !== ftb.x || fta.y !== ftb.y) return fail('INVALID', `${k.id} fine-tunes the two ends differently: binding would edit character data (not done)`, [k.id])
  }
  const id = (cmd.id ?? take(ids, 'connection', () => unique('connection:bind', (x) => !!store.get(x as any)), (x) => !!store.get(x as any))) as RecordId<ConnectionRecord>
  const target = (pa: Vec, pb: Vec) => (cmd.keep === 'first' ? pa : cmd.keep === 'second' ? pb : v((pa.x + pb.x) / 2, (pa.y + pb.y) / 2))
  const moveEnd = (sh: Shape, a: string, to: Vec): Shape => {
    const q = sh[a]
    const dx = to.x - q.p.x, dy = to.y - q.p.y
    return { ...sh, [a]: { p: { ...to }, hIn: v(q.hIn.x + dx, q.hIn.y + dy), hOut: v(q.hOut.x + dx, q.hOut.y + dy) } }
  }
  const sampleS = (keys: { yaw: number; shape: Shape }[], yaw: number): Shape => {
    if (yaw <= keys[0].yaw) return keys[0].shape
    const last = keys[keys.length - 1]
    if (yaw >= last.yaw) return last.shape
    const i = keys.findIndex((k) => k.yaw >= yaw)
    const a = keys[i - 1].shape, b = keys[i].shape, t = (yaw - keys[i - 1].yaw) / (keys[i].yaw - keys[i - 1].yaw)
    return Object.fromEntries(Object.keys(a).map((k) => [k, Object.fromEntries((['p', 'hIn', 'hOut'] as const).map((h) => [h, v(a[k][h].x + (b[k][h].x - a[k][h].x) * t, a[k][h].y + (b[k][h].y - a[k][h].y) * t)]))])) as Shape
  }
  const puts: DocRecord[] = []
  // the curve records (the drawing): both ends to one position, relative handles move with them
  const pa0 = da.curve.anchors[cmd.a.anchorId].p, pb0 = db.curve.anchors[cmd.b.anchorId].p
  const at0 = target(pa0, pb0)
  puts.push({ ...da.curve, anchors: { ...da.curve.anchors, [cmd.a.anchorId]: { ...da.curve.anchors[cmd.a.anchorId], p: at0 } } })
  puts.push({ ...db.curve, anchors: { ...db.curve.anchors, [cmd.b.anchorId]: { ...db.curve.anchors[cmd.b.anchorId], p: at0 } } })
  for (const pr of da.presets) {
    const A = da.presetForms.find((f) => f.owner.kind === 'preset' && f.owner.id === pr.id)
    const B = db.presetForms.find((f) => f.owner.kind === 'preset' && f.owner.id === pr.id)
    if (!A || !B || A.encoding !== 'absolute' || B.encoding !== 'absolute') continue
    const ka = A.yaw as AbsoluteYawKey[], kb = B.yaw as AbsoluteYawKey[]
    const origA = A.original && A.original !== 'curve' ? A.original : null, origB = B.original && B.original !== 'curve' ? B.original : null
    const stateA = (y: number) => (ka.length ? sampleS(ka, y) : origA), stateB = (y: number) => (kb.length ? sampleS(kb, y) : origB)
    const yaws = [...new Set([...ka, ...kb].map((k) => k.yaw))].sort((x, y) => x - y)
    const keysA: AbsoluteYawKey[] = [], keysB: AbsoluteYawKey[] = []
    for (const y of yaws) {
      const sa = stateA(y), sb = stateB(y)
      // one side drawn, the other missing here: refused — never drop the drawn side's keys (dot 1791317098)
      if (!sa || !sb) return fail('INVALID', `${pr.id} has no shape for ${!sa ? da.curve.id : db.curve.id} at yaw ${y}: draw it first (binding would otherwise drop the other curve's keys)`, [pr.id, !sa ? da.curve.id : db.curve.id])
      const to = target(sa[cmd.a.anchorId].p, sb[cmd.b.anchorId].p)
      keysA.push({ yaw: y, shape: moveEnd(sa, cmd.a.anchorId, to) })
      keysB.push({ yaw: y, shape: moveEnd(sb, cmd.b.anchorId, to) })
    }
    const orig = origA && origB ? target(origA[cmd.a.anchorId].p, origB[cmd.b.anchorId].p) : null
    // expression keyframes (the author's full shapes): in each parameter's states the two ends meet too. A curve the
    // parameter names takes its keyframe (sampled); one it does not name stays in its (bound) neutral form there.
    const bound = (keys: AbsoluteYawKey[], orig0: Shape | null) => (y: number) => (keys.length ? sampleS(keys, y) : orig0)
    const nA = bound(keysA.length ? keysA : ka, orig && origA ? moveEnd(origA, cmd.a.anchorId, orig) : origA), nB = bound(keysB.length ? keysB : kb, orig && origB ? moveEnd(origB, cmd.b.anchorId, orig) : origB)
    const exprA: FormsRecord['expr'] = { ...A.expr }, exprB: FormsRecord['expr'] = { ...B.expr }
    for (const name of [...new Set([...Object.keys(A.expr), ...Object.keys(B.expr)])]) {
      const ep = paramFor(store, fam.id, name)
      const inA = !!ep?.curves.includes(da.curve.id), inB = !!ep?.curves.includes(db.curve.id)
      const ea = A.expr[name] ?? [], eb = B.expr[name] ?? []
      if ((inA && !ea.length && eb.length && inB) || (inB && !eb.length && ea.length && inA))
        return fail('INVALID', `${pr.id} has ${name} keyframes for only one of ${da.curve.id} / ${db.curve.id}: draw the other first (binding would otherwise leave the ends apart in ${name})`, [pr.id])
      const ys = [...new Set([...ea, ...eb].map((k) => k.yaw))].sort((x, y) => x - y)
      const outA: { yaw: number; shape: Shape }[] = [], outB: { yaw: number; shape: Shape }[] = []
      for (const y of ys) {
        const sa = inA && ea.length ? sampleS(ea as AbsoluteYawKey[], y) : nA(y)
        const sb = inB && eb.length ? sampleS(eb as AbsoluteYawKey[], y) : nB(y)
        if (!sa || !sb) return fail('INVALID', `${pr.id} has no shape for ${!sa ? da.curve.id : db.curve.id} at yaw ${y} (${name})`, [pr.id])
        // a curve the parameter does not move keeps its end; otherwise the bind choice (mid / first / second)
        const to = !(inA && ea.length) ? sa[cmd.a.anchorId].p : !(inB && eb.length) ? sb[cmd.b.anchorId].p : target(sa[cmd.a.anchorId].p, sb[cmd.b.anchorId].p)
        if (inA && ea.length) outA.push({ yaw: y, shape: moveEnd(sa, cmd.a.anchorId, to) })
        if (inB && eb.length) outB.push({ yaw: y, shape: moveEnd(sb, cmd.b.anchorId, to) })
      }
      if (inA && ea.length) exprA[name] = outA
      if (inB && eb.length) exprB[name] = outB
    }
    puts.push({ ...A, original: orig && origA ? moveEnd(origA, cmd.a.anchorId, orig) : A.original, yaw: ka.length || keysA.length ? keysA : A.yaw, expr: exprA })
    puts.push({ ...B, original: orig && origB ? moveEnd(origB, cmd.b.anchorId, orig) : B.original, yaw: kb.length || keysB.length ? keysB : B.yaw, expr: exprB })
  }
  puts.push({ typeName: 'connection', id, ends: [{ ...cmd.a }, { ...cmd.b }], geometricJoin: 'corner' } as ConnectionRecord)
  const notices = familyNotices(store, puts, fam.id)
  return { ok: true, label: 'bind', puts, affected: [anchorKey(cmd.a), anchorKey(cmd.b), id], creates: [id], ...(notices.length ? { notices } : {}) }
}

/** characters of the family that prepared before and would not after: notices (stage 3c; authoring is not blocked) */
function familyNotices(store: Store, puts: DocRecord[], familyId: string): string[] {
  return playabilityNotices(store, puts, store.allRecords().filter((r): r is CharacterRecord => r.typeName === 'character' && r.familyId === familyId).map((k) => k.id))
}

/**
 * A fill boundary after a curve was cut or split: segment and bridge owners follow the part that holds them; where
 * the boundary passed through the cut anchor {X, copy} a bridge is inserted, or an existing neighbouring bridge is
 * re-pointed to the side its neighbour uses (the reviewed fillBridge adjacency pass, curve-aware).
 */
function remapBoundary(f: FillRecord, curveId: string, newId: string | undefined, segOwner: (s: string) => string, owner: (a: string) => string, cut: { X: string; copy: string } | undefined, puts: DocRecord[]): BoundaryStep[] {
  const end = (e: AnchorRef): AnchorRef => (e.curveId === curveId ? { curveId: owner(e.anchorId) as RecordId<CurveRecord>, anchorId: e.anchorId } : e)
  const steps: BoundaryStep[] = f.boundary.map((st) => (isBridge(st) ? { bridge: { from: end(st.bridge.from), to: end(st.bridge.to) } } : st.curveId === curveId ? { ...st, curveId: segOwner(st.segmentId) as RecordId<CurveRecord> } : st))
  if (!cut) return steps
  const curveOf = (id: string) => (puts.find((r) => r.id === id) as CurveRecord | undefined)!
  const segOf = (st: Extract<BoundaryStep, { segmentId: string }>) => curveOf(st.curveId)?.segments.find((q) => q.id === st.segmentId)
  const startOf = (st: BoundaryStep): AnchorRef | undefined => {
    if (isBridge(st)) return st.bridge.from
    const sg = segOf(st)
    return sg && { curveId: st.curveId, anchorId: st.dir === 1 ? sg.from : sg.to }
  }
  const endOf = (st: BoundaryStep): AnchorRef | undefined => {
    if (isBridge(st)) return st.bridge.to
    const sg = segOf(st)
    return sg && { curveId: st.curveId, anchorId: st.dir === 1 ? sg.to : sg.from }
  }
  const parts = new Set([curveId, ...(newId ? [newId] : [])])
  const atCut = (e?: AnchorRef) => !!e && parts.has(e.curveId) && (e.anchorId === cut.X || e.anchorId === cut.copy)
  const out: BoundaryStep[] = []
  const work = steps.map((st) => (isBridge(st) ? { bridge: { from: { ...st.bridge.from }, to: { ...st.bridge.to } } } : st))
  const insertAfter = new Set<number>()
  for (let i = 0; i < work.length; i++) {
    const cur = work[i], nx = work[(i + 1) % work.length]
    const e = endOf(cur), s0 = startOf(nx)
    if (!atCut(e) || !atCut(s0) || (e!.curveId === s0!.curveId && e!.anchorId === s0!.anchorId)) continue
    if (isBridge(cur)) cur.bridge.to = { ...s0! }
    else if (isBridge(nx)) nx.bridge.from = { ...e! }
    else insertAfter.add(i)
  }
  work.forEach((st, i) => {
    out.push(st)
    if (insertAfter.has(i)) out.push({ bridge: { from: endOf(st)!, to: startOf(work[(i + 1) % work.length])! } })
  })
  return out
}
