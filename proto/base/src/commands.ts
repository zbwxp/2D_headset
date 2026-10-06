// Named operations shared by the UI and the AI API (docs/design/architecture/11 §6).
// Each command is *planned* first (pure, no writes) and only then applied by the editor's single
// write entry. Pattern: Blender operators (poll → execute, report) —
//   https://docs.blender.org/api/current/bpy.types.Operator.html
// Expected failures (LOCKED, FILL_NOT_CLOSED, …) are detected while planning, before anything is
// written, as required for the store-based route (docs/design/architecture/12 §5).
import type { RecordId } from '@tldraw/store'
import { anchorKey, isWithin, linkedAnchors, lockedBy, type AnchorRef } from './model'
import {
  Container,
  Curve,
  Fill,
  Reference,
  type Affine,
  type BoundaryStep,
  type ContainerRecord,
  type CurveRecord,
  type DocRecord,
  type DocReader as DocStore,
  type FillRecord,
  type ReferenceRecord,
  type Vec,
  validateRecord,
} from './schema'

export type ErrorCode = 'LOCKED' | 'FILL_NOT_CLOSED' | 'NOT_FOUND' | 'INVALID'
export type EditError = {
  code: ErrorCode
  message: string
  /** Addresses of the objects involved, e.g. `curve:C2#b3`. */
  objects: string[]
  fixes: string[]
}

export type Command =
  | { type: 'moveAnchors'; targets: AnchorRef[]; delta: Vec }
  | { type: 'moveHandle'; target: AnchorRef; handle: 'in' | 'out'; delta: Vec }
  | { type: 'moveOverride'; referenceId: RecordId<ReferenceRecord>; target: AnchorRef; delta: Vec }
  | { type: 'transformContainer'; containerId: RecordId<ContainerRecord>; matrix: Affine }
  | { type: 'createFill'; id?: RecordId<FillRecord>; parentId: RecordId<ContainerRecord>; boundary: BoundaryStep[] }
  | { type: 'setContainerFlags'; containerId: RecordId<ContainerRecord>; locked?: boolean; visible?: boolean }

export type Plan =
  | { ok: true; label: string; puts: DocRecord[]; affected: string[] }
  | { ok: false; error: EditError }

const fail = (code: ErrorCode, message: string, objects: string[], fixes: string[] = []): Plan => ({
  ok: false,
  error: { code, message, objects, fixes },
})

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
const applyAffine = (m: Affine, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })
const applyLinear = (m: Affine, v: Vec): Vec => ({ x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y })
/** m ∘ n: apply n first, then m. */
const compose = (m: Affine, n: Affine): Affine => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
})

/** Collect the curves an anchor set touches and reject the whole command if any is locked. */
function lockCheck(store: DocStore, moved: ReturnType<typeof linkedAnchors>): Plan | null {
  for (const m of moved) {
    const curve = store.get(m.ref.curveId) as CurveRecord | undefined
    if (!curve) return fail('NOT_FOUND', `curve ${m.ref.curveId} not found`, [m.ref.curveId])
    const locker = lockedBy(store, curve.parentId)
    if (locker) {
      const via = m.via ? ` (linked via ${m.via})` : ''
      return fail('LOCKED', `${anchorKey(m.ref)} is in locked container ${locker.id}${via}`, [anchorKey(m.ref), locker.id, ...(m.via ? [m.via] : [])], [
        `unlock ${locker.id}`,
        ...(m.via ? [`disconnect ${m.via}`] : []),
      ])
    }
  }
  return null
}

/** Write new anchor positions (and optionally transform handles) into cloned curve records. */
function writeAnchors(store: DocStore, moves: Map<string, { ref: AnchorRef; p: Vec; linear?: Affine }>) {
  const byCurve = new Map<string, CurveRecord>()
  for (const { ref, p, linear } of moves.values()) {
    const base = byCurve.get(ref.curveId) ?? structuredClone(store.get(ref.curveId) as CurveRecord)
    const a = base.anchors[ref.anchorId]
    base.anchors[ref.anchorId] = linear ? { ...a, p, hIn: applyLinear(linear, a.hIn), hOut: applyLinear(linear, a.hOut) } : { ...a, p }
    byCurve.set(ref.curveId, base)
  }
  return [...byCurve.values()]
}

/**
 * Plan a command: everything is checked here (targets, locks, closure, record validators), so
 * `preview` and `apply` share exactly the same validation (dot's review of 11ca75d).
 */
export function plan(store: DocStore, cmd: Command): Plan {
  const p = planRaw(store, cmd)
  if (!p.ok) return p
  for (const r of p.puts) {
    try {
      validateRecord(r)
    } catch (e) {
      return fail('INVALID', String((e as Error).message ?? e), [r.id])
    }
  }
  return p
}

function planRaw(store: DocStore, cmd: Command): Plan {
  switch (cmd.type) {
    case 'moveAnchors': {
      const moved = linkedAnchors(store, cmd.targets)
      const locked = lockCheck(store, moved)
      if (locked) return locked
      const moves = new Map<string, { ref: AnchorRef; p: Vec }>()
      for (const m of moved) {
        const curve = store.get(m.ref.curveId) as CurveRecord
        const a = curve.anchors[m.ref.anchorId]
        if (!a) return fail('NOT_FOUND', `anchor ${anchorKey(m.ref)} not found`, [anchorKey(m.ref)])
        moves.set(anchorKey(m.ref), { ref: m.ref, p: add(a.p, cmd.delta) })
      }
      return { ok: true, label: 'moveAnchors', puts: writeAnchors(store, moves), affected: [...moves.keys()] }
    }
    case 'moveHandle': {
      const curve = store.get(cmd.target.curveId) as CurveRecord | undefined
      const a = curve?.anchors[cmd.target.anchorId]
      if (!curve || !a) return fail('NOT_FOUND', `anchor ${anchorKey(cmd.target)} not found`, [anchorKey(cmd.target)])
      const locked = lockCheck(store, [{ ref: cmd.target }])
      if (locked) return locked
      const next = structuredClone(curve)
      const key = cmd.handle === 'in' ? 'hIn' : 'hOut'
      next.anchors[a.id] = { ...a, [key]: add(a[key], cmd.delta) }
      return { ok: true, label: 'moveHandle', puts: [next], affected: [`${anchorKey(cmd.target)}.${key}`] }
    }
    case 'moveOverride': {
      const ref = store.get(cmd.referenceId) as ReferenceRecord | undefined
      if (!ref) return fail('NOT_FOUND', `reference ${cmd.referenceId} not found`, [cmd.referenceId])
      const locker = lockedBy(store, ref.parentId)
      if (locker) return fail('LOCKED', `reference ${ref.id} is in locked container ${locker.id}`, [ref.id, locker.id], [`unlock ${locker.id}`])
      const curve = store.get(cmd.target.curveId) as CurveRecord | undefined
      const a = curve?.anchors[cmd.target.anchorId]
      if (!curve || !a) return fail('NOT_FOUND', `anchor ${anchorKey(cmd.target)} not found`, [anchorKey(cmd.target)])
      if (!isWithin(store, curve.parentId, ref.sourceId))
        return fail('INVALID', `${anchorKey(cmd.target)} is not part of ${ref.id}'s source ${ref.sourceId}`, [ref.id, anchorKey(cmd.target)])
      const key = anchorKey(cmd.target)
      const current = ref.overrides[key] ?? a.p
      const next = { ...ref, overrides: { ...ref.overrides, [key]: add(current, cmd.delta) } }
      return { ok: true, label: 'moveOverride', puts: [next], affected: [`${ref.id}/${key}`] }
    }
    case 'transformContainer': {
      // Container transform is undecided (11 〔待定 5〕); this slice bakes it into anchors
      // (Illustrator behaviour) so the comparison can be made later with real numbers.
      if (!store.get(cmd.containerId)) return fail('NOT_FOUND', `container ${cmd.containerId} not found`, [cmd.containerId])
      const curves = (store.allRecords().filter((r) => r.typeName === 'curve') as CurveRecord[]).filter((c) => inContainer(store, c, cmd.containerId))
      // References placed inside the container move with it: compose their placement transform.
      const refs = (store.allRecords().filter((r) => r.typeName === 'reference') as ReferenceRecord[]).filter((r) => isWithin(store, r.parentId, cmd.containerId))
      for (const r of refs) {
        const locker = lockedBy(store, r.parentId)
        if (locker) return fail('LOCKED', `reference ${r.id} is in locked container ${locker.id}`, [r.id, locker.id], [`unlock ${locker.id}`])
      }
      const movedRefs = refs.map((r) => ({ ...r, transform: compose(cmd.matrix, r.transform) }))
      const seeds: AnchorRef[] = curves.flatMap((c) => Object.keys(c.anchors).map((anchorId) => ({ curveId: c.id, anchorId })))
      const moved = linkedAnchors(store, seeds)
      const locked = lockCheck(store, moved)
      if (locked) return locked
      const moves = new Map<string, { ref: AnchorRef; p: Vec; linear?: Affine }>()
      // Anchors inside the container are transformed; anchors linked from outside follow their partner.
      for (const s of seeds) {
        const a = (store.get(s.curveId) as CurveRecord).anchors[s.anchorId]
        moves.set(anchorKey(s), { ref: s, p: applyAffine(cmd.matrix, a.p), linear: cmd.matrix })
      }
      for (const m of moved) {
        if (moves.has(anchorKey(m.ref))) continue
        const a = (store.get(m.ref.curveId) as CurveRecord).anchors[m.ref.anchorId]
        moves.set(anchorKey(m.ref), { ref: m.ref, p: applyAffine(cmd.matrix, a.p) })
      }
      return { ok: true, label: 'transformContainer', puts: [...writeAnchors(store, moves), ...movedRefs], affected: [...moves.keys(), ...movedRefs.map((r) => r.id)] }
    }
    case 'createFill': {
      const parent = store.get(cmd.parentId) as ContainerRecord | undefined
      if (!parent) return fail('NOT_FOUND', `container ${cmd.parentId} not found`, [cmd.parentId])
      const locker = lockedBy(store, cmd.parentId)
      if (locker) return fail('LOCKED', `container ${cmd.parentId} is locked by ${locker.id}`, [cmd.parentId, locker.id], [`unlock ${locker.id}`])
      if (!cmd.boundary.length) return fail('FILL_NOT_CLOSED', 'boundary is empty', [cmd.parentId])
      const gap = findGap(store, cmd.boundary)
      if (gap) return fail('FILL_NOT_CLOSED', `boundary is not closed between ${gap[0]} and ${gap[1]}`, gap, ['connect the two anchors', 'add a fill-only closing edge'])
      const fill = Fill.create({ id: cmd.id ?? Fill.createId(), name: '填充', parentId: cmd.parentId, boundary: cmd.boundary })
      return { ok: true, label: 'createFill', puts: [fill], affected: [fill.id] }
    }
    case 'setContainerFlags': {
      const c = store.get(cmd.containerId) as ContainerRecord | undefined
      if (!c) return fail('NOT_FOUND', `container ${cmd.containerId} not found`, [cmd.containerId])
      const next = { ...c, ...(cmd.locked !== undefined && { locked: cmd.locked }), ...(cmd.visible !== undefined && { visible: cmd.visible }) }
      return { ok: true, label: 'setContainerFlags', puts: [next], affected: [c.id] }
    }
  }
}

function inContainer(store: DocStore, curve: CurveRecord, containerId: RecordId<ContainerRecord>) {
  let cur: ContainerRecord | undefined = store.get(curve.parentId) as ContainerRecord | undefined
  while (cur) {
    if (cur.id === containerId) return true
    cur = cur.parentId ? (store.get(cur.parentId) as ContainerRecord | undefined) : undefined
  }
  return false
}

/**
 * A boundary is closed when each step's end anchor is the next step's start anchor (same curve),
 * or the two anchors are joined by a connection. Gaps are never silently bridged (11 §1).
 */
export function findGap(store: DocStore, boundary: BoundaryStep[]): [string, string] | null {
  const ends = boundary.map((step) => {
    const c = store.get(step.curveId) as CurveRecord | undefined
    const seg = c?.segments.find((s) => s.id === step.segmentId)
    if (!seg) return null
    const [from, to] = step.dir === 1 ? [seg.from, seg.to] : [seg.to, seg.from]
    return { start: { curveId: step.curveId, anchorId: from }, end: { curveId: step.curveId, anchorId: to } }
  })
  for (let i = 0; i < ends.length; i++) {
    const a = ends[i]
    const b = ends[(i + 1) % ends.length]
    if (!a || !b) return [String(boundary[i]?.segmentId), String(boundary[(i + 1) % ends.length]?.segmentId)]
    if (anchorKey(a.end) === anchorKey(b.start)) continue
    const joined = linkedAnchors(store, [a.end]).some((m) => anchorKey(m.ref) === anchorKey(b.start))
    if (!joined) return [anchorKey(a.end), anchorKey(b.start)]
  }
  return null
}

// Re-exported so callers can build records without importing the schema module separately.
export { Container, Curve, Reference }
