// Named operations shared by the UI and the AI API (docs/design/architecture/11 §6).
// Each command is *planned* first (pure, no writes) and only then applied by the editor's single
// write entry. Pattern: Blender operators (poll → execute, report) —
//   https://docs.blender.org/api/current/bpy.types.Operator.html
// Expected failures (LOCKED, FILL_NOT_CLOSED, …) are detected while planning, before anything is
// written, as required for the store-based route (docs/design/architecture/12 §5).
import type { RecordId } from '@tldraw/store'
import { counters } from './counters'
import { planCharacter, type CharacterCommand } from './characterCommands'
import { planDuplicate, type DuplicateCommand } from './duplicate'
import { planMask, type MaskCommand } from './masks'
import { planStructure, type StructureCommand } from './structure'
import { legacy3Keys, legacyKeys, offset3At, offsetAt } from './pose'
import { childrenOf, connectionsAt, familiesOf, fillsUsing, referencesOf, within } from './indexes'
import { actualKind, anchorKey, boundaryGap, overlayReader, getAs, isWithin, linkedAnchors, lockedBy, recordProblems, type AnchorRef } from './model'
import {
  Container,
  Curve,
  Fill,
  Forms,
  poseIdOf,
  Reference,
  type Affine,
  type BoundaryStep,
  type ContainerRecord,
  type CurveRecord,
  type DocRecord,
  type BaseReader as DocStore,
  type FillRecord,
  type FormsRecord,
  type PointDelta,
  type ReferenceRecord,
  type Vec,
  validateRecord,
} from './schema'

export type ErrorCode =
  | 'LOCKED'
  | 'FILL_NOT_CLOSED'
  | 'NOT_FOUND' // missing, or not of the expected type (the message says which)
  | 'INVALID'
  | 'ID_CONFLICT'
  | 'BAD_REFERENCE' // the result would break a relation rule (same rules as open)
  | 'STALE' // a prepared operation's document changed since it started (edit generation moved on)
  | 'INTERNAL' // unexpected exception while planning — a bug; nothing was written
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
  /** Several containers under ONE selection transform: each anchor moves exactly once (dot: L1+L2 double move). */
  | { type: 'transformContainers'; containerIds: RecordId<ContainerRecord>[]; matrix: Affine }
  | { type: 'createFill'; id?: RecordId<FillRecord>; parentId: RecordId<ContainerRecord>; boundary: BoundaryStep[] }
  | { type: 'setContainerFlags'; containerId: RecordId<ContainerRecord>; locked?: boolean; visible?: boolean }
  /** Record (or replace) a curve's form at one angle: per-anchor offsets from the base drawing. */
  | { type: 'setPoseKey'; curveId: RecordId<CurveRecord>; yaw: number; offsets: Record<string, Vec> }
  /**
   * Remove records. Generic: nothing is removed implicitly — a record that something still depends on
   * (a curve with a connection, fill or pose; a container with children or references) is refused
   * unless the dependants are removed in the same command (doc 18 §22.1).
   */
  | { type: 'deleteRecords'; ids: string[] }
  /** structure commands (stage 2b, structure.ts) */
  | StructureCommand
  /** preset author and character commands (stage 3b, characterCommands.ts) */
  | CharacterCommand
  /** independent copy (stage 4, duplicate.ts) */
  | DuplicateCommand
  | MaskCommand

/**
 * A plan's final state = the store with `puts` layered over it and `removals` taken out. One overlay:
 * an id appears at most once in puts, at most once in removals, never in both (doc 18 §22.1).
 */
export type Plan =
  /** notices: what the edit leaves to be completed, e.g. characters that cannot be prepared until a preset draws a
   *  new curve (dot 1791315660: normal authoring is not blocked; the result says what is affected) */
  | { ok: true; label: string; puts: DocRecord[]; removals?: string[]; affected: string[]; creates?: string[]; notices?: string[] }
  | { ok: false; error: EditError }

/**
 * Where new record ids come from while planning. The default allocates a fresh id every time (two
 * independent creates never share an id). A prepared operation passes its own source so that every
 * re-plan of the same operation reuses the same ids (KF-1; dot: an explicit prepared identity, the
 * caller's command is never rewritten).
 */
export type IdSource = { take: (kind: string, fresh: () => string) => string }
export const freshIds: IdSource = { take: (_kind, fresh) => fresh() }

const fail = (code: ErrorCode, message: string, objects: string[], fixes: string[] = []): Plan => ({
  ok: false,
  error: { code, message, objects, fixes },
})

const notFound = (store: DocStore, id: unknown, type: string, address = String(id)): Plan =>
  fail('NOT_FOUND', `${address}: no ${type} with id ${String(id)} (${actualKind(store, id)})`, [address])

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
    const curve = getAs(store, m.ref.curveId, 'curve')
    if (!curve) return notFound(store, m.ref.curveId, 'curve', anchorKey(m.ref))
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
export function plan(store: DocStore, cmd: Command, ids: IdSource = freshIds): Plan {
  try {
    return planChecked(store, cmd, ids)
  } catch (e) {
    // The API never throws at its caller (UI or AI). An exception here is a bug, reported as such.
    return fail('INTERNAL', `unexpected error while planning ${String((cmd as { type?: unknown })?.type)}: ${String((e as Error)?.message ?? e)}`, [])
  }
}

function planChecked(store: DocStore, cmd: Command, ids: IdSource): Plan {
  counters.plans++
  const p = planRaw(store, cmd, ids)
  if (!p.ok) return p
  const removals = p.removals ?? []
  const unique = overlayConflict(p.puts, removals)
  if (unique) return unique
  const removal = removalGuard(store, removals)
  if (removal) return removal
  const guard = writeGuard(store, cmd, p.puts, new Set(p.creates ?? []))
  if (guard) return guard
  for (const r of p.puts) {
    try {
      validateRecord(r)
    } catch (e) {
      return fail('INVALID', String((e as Error).message ?? e), [r.id])
    }
  }
  const broken = relationCheck(store, p.puts, removals)
  if (broken.length)
    return fail('BAD_REFERENCE', broken.map((b) => b.message).join('; '), [...new Set(broken.flatMap((b) => [b.object, b.target]))], ['pass an id of the expected type'])
  return p
}

/**
 * Relation rules (model.recordProblems — the same ones `Editor.open` applies) on the state as it
 * would be after the write: puts layered over the store. Only affected relations are checked:
 * each written record's outgoing references, plus incoming ones when a written record could
 * invalidate them (a curve losing anchors/segments, or a container changing parent). A drag that
 * only moves anchors therefore costs O(written records), not a whole-document scan (dot).
 */
function relationCheck(store: DocStore, puts: DocRecord[], removals: string[] = []) {
  const overlay = new Map<string, DocRecord>(puts.map((r) => [r.id, r]))
  const gone = new Set(removals)
  // Checks that need other records of a type (rules of a family, presets sharing a node, connected groups) run
  // on the FULL final overlay whenever the plan could affect them: removals, any stage-1 record other than the
  // legacy head-turn track, or a connection. Otherwise (drags, legacy pose keys) a get-only view keeps the
  // per-move cost independent of document size. Nothing that open would refuse can be committed (dot
  // 1791308648: deleting the rule committed and reopen then failed).
  const structural = (r: DocRecord) => {
    if (r.typeName === 'fill' || r.typeName === 'connection') return true
    const old = store.get(r.id as any) as DocRecord | undefined
    if (r.typeName !== 'curve' || old?.typeName !== 'curve') return false
    const ids = (c: CurveRecord) => Object.keys(c.anchors).sort().join() + '|' + JSON.stringify(c.segments) + '|' + c.closed
    return ids(old) !== ids(r) // same anchors, segments and closure: geometry only (drags)
  }
  const full = removals.length > 0 || puts.some((r) => structural(r) || (NEW_TYPES.has(r.typeName) && !(r.typeName === 'forms' && (r.encoding === 'legacy-delta' || r.encoding === 'legacy-delta3'))))
  const next = full ? overlayReader(store, puts, removals) : ({ get: (id: string) => (gone.has(id) ? undefined : (overlay.get(id) ?? store.get(id as any))) } as Pick<DocStore, 'get'>)
  const problems = puts.flatMap((r) => recordProblems(next, r))
  // Incoming relations, looked up through the indexes (not by scanning a type): connections at an
  // anchor a curve loses, fills reading a curve that loses a segment. A container changing parent
  // needs no incoming check: a cycle through it is found on the container itself (outgoing rule).
  const incoming = new Set<string>()
  for (const r of puts) {
    const old = store.get(r.id as any) as DocRecord | undefined
    if (old?.typeName === 'curve' && r.typeName === 'curve') {
      for (const k of Object.keys(old.anchors)) if (!r.anchors[k]) for (const c of connectionsAt(store, anchorKey({ curveId: r.id, anchorId: k }))) incoming.add(c)
      // stage-1 records name a curve's anchors (forms shapes, rule correspondence, fine-tune): re-check them too
      if (Object.keys(old.anchors).some((k) => !r.anchors[k]) || Object.keys(r.anchors).some((k) => !old.anchors[k])) for (const m of mentioning(store, r.id)) incoming.add(m)
      if (Object.keys(old.anchors).some((k) => !r.anchors[k]) && store.get(poseIdOf(r.id) as any)) incoming.add(poseIdOf(r.id)) // offsets name anchors
      if (old.segments.some((s) => !r.segments.some((t) => t.id === s.id)) || Object.keys(old.anchors).some((k) => !r.anchors[k])) for (const f of fillsUsing(store, r.id)) incoming.add(f) // segments, or bridge ends
    }
    // a head-turn track change re-checks the connections at its curve's anchors (ends must agree at every yaw)
    if (r.typeName === 'forms') {
      const c = getAs(store, r.curveId, 'curve')
      if (c) for (const a of Object.keys(c.anchors)) for (const cn of connectionsAt(store, anchorKey({ curveId: c.id, anchorId: a }))) incoming.add(cn)
    }
  }
  // Incoming relations of removed records: everything that may still point at them (indexes, no scan).
  for (const id of removals) for (const d of dependantsOf(store, id)) incoming.add(d)
  for (const id of incoming) if (!overlay.has(id) && !gone.has(id)) problems.push(...recordProblems(next, store.get(id as any) as DocRecord))
  return problems
}

/** Records that may refer to `id` (found through the dependency indexes). */
function dependantsOf(store: DocStore, id: string): string[] {
  const r = store.get(id as any) as DocRecord | undefined
  if (!r) return []
  if (r.typeName === 'container')
    return [...(['container', 'curve', 'fill', 'reference'] as const).flatMap((t) => childrenOf(store, r.id, t)), ...referencesOf(store, r.id)]
  if (r.typeName === 'curve') {
    const out: string[] = [...fillsUsing(store, r.id)]
    for (const a of Object.keys(r.anchors)) out.push(...connectionsAt(store, anchorKey({ curveId: r.id, anchorId: a })))
    if (store.get(poseIdOf(r.id) as any)) out.push(poseIdOf(r.id))
    return [...out, ...mentioning(store, r.id)]
  }
  // a head-turn track: the connections at its curve's anchors must still agree at every yaw without it (as when
  // it is written; dot, review of 3729d27: deleting one side's pose separated the ends and broke reopen); a
  // preset's forms: also the preset (it must hold one per family curve)
  if (r.typeName === 'forms') {
    const c = getAs(store, r.curveId, 'curve')
    const out = c ? Object.keys(c.anchors).flatMap((a) => connectionsAt(store, anchorKey({ curveId: c.id, anchorId: a }))) : []
    return r.owner.kind === 'preset' ? [...out, r.owner.id] : out
  }
  // an expression parameter is found by (family, name), not by id: the forms of that family's presets and its
  // characters (expression keyframes name it), and the shared nodes compared in its states, depend on it
  if (r.typeName === 'expressionParam') {
    const presets = new Set(store.allRecords().filter((x) => x.typeName === 'preset' && x.familyId === r.familyId).map((x) => x.id as string))
    const forms = store.allRecords().filter((x): x is FormsRecord => x.typeName === 'forms' && x.owner.kind === 'preset' && presets.has(x.owner.id))
    const chars = store.allRecords().filter((x) => x.typeName === 'character' && x.familyId === r.familyId).map((x) => x.id)
    const conns = [...new Set(forms.map((f) => f.curveId))].flatMap((cid) => {
      const c = getAs(store, cid, 'curve')
      return c ? Object.keys(c.anchors).flatMap((a) => connectionsAt(store, anchorKey({ curveId: c.id, anchorId: a }))) : []
    })
    return [...mentioning(store, r.id), ...forms.map((f) => f.id), ...chars, ...conns]
  }
  return mentioning(store, r.id)
}

const NEW_TYPES = new Set(['forms', 'family', 'preset', 'expressionParam', 'helperDomain', 'character', 'visibility', 'mask'])
/**
 * Stage-1 records that mention `id` anywhere (family curves, preset family, parameter curves, character weights /
 * takeovers, visibility owner …). No index exists for them yet, so this scans — only removal plans call it,
 * never the drag path.
 */
function mentioning(store: DocStore, id: string): string[] {
  const needle = JSON.stringify(id)
  return store.allRecords().filter((x) => NEW_TYPES.has(x.typeName) && x.id !== id && JSON.stringify(x).includes(needle)).map((x) => x.id)
}

/** One final overlay: no id twice in puts or removals, none in both (dot 1791306076). */
export function overlayConflict(puts: DocRecord[], removals: string[]): Plan | null {
  const seen = new Set<string>()
  for (const r of puts) {
    if (seen.has(r.id)) return fail('ID_CONFLICT', `${r.id} is written twice in one plan`, [r.id])
    seen.add(r.id)
  }
  const removed = new Set<string>()
  for (const id of removals) {
    if (removed.has(id)) return fail('ID_CONFLICT', `${id} is removed twice in one plan`, [id])
    if (seen.has(id)) return fail('ID_CONFLICT', `${id} is both written and removed in one plan`, [id])
    removed.add(id)
  }
  return null
}

/**
 * Removals: the record must exist, and neither its place nor (for a container) itself may be locked.
 * Dependants still present are checked by `relationCheck` on the final overlay.
 */
function removalGuard(store: DocStore, removals: string[]): Plan | null {
  for (const id of removals) {
    const old = store.get(id as any) as DocRecord | undefined
    if (!old) return fail('NOT_FOUND', `${id} does not exist`, [id])
    const ends = connectionLock(store, old)
    if (ends) return ends
    const place = placeOf(store, old)
    const locker = place ? lockedBy(store, place as RecordId<ContainerRecord>) : undefined
    if (locker) return fail('LOCKED', `${id} is in locked container ${locker.id}`, [id, locker.id], [`unlock ${locker.id}`])
    if (old.typeName === 'container' && old.locked) return fail('LOCKED', `${id} is locked`, [id], [`unlock ${id}`])
  }
  return null
}

/**
 * Generic write-scope check applied to EVERY planned record, whatever the command (dot: createFill
 * with an existing id overwrote the locked fill). Creating requires a fresh id; updating requires an
 * existing record of the same type, and neither its old nor its new place may be locked. A record's
 * place is its PARENT, so a container's own lock never blocks changing its own flags (that is how it
 * gets unlocked), while a locked ancestor blocks everything below it, flags included (11 §3; dot's
 * review of 90692ad: a child's visibility could be changed under a locked parent).
 */
/**
 * Where a record lives for locking: its parent container; forms and visibility live where their curve lives;
 * family / preset / expression parameter / helper domain / character are document-level (no container lock applies).
 */
function placeOf(store: DocStore, x: DocRecord): string | null {
  if (x.typeName === 'connection') return null
  if (x.typeName === 'forms' || x.typeName === 'visibility') return (getAs(store, x.curveId, 'curve')?.parentId as string | undefined) ?? null
  if (x.typeName === 'family' || x.typeName === 'preset' || x.typeName === 'expressionParam' || x.typeName === 'helperDomain' || x.typeName === 'character') return null
  // a mask changes how its targets look: its place is a LOCKED target's place if there is one (so the lock check
  // refuses it), else none (document-level)
  if (x.typeName === 'mask') {
    for (const t of x.targets) {
      const r = store.get(t as any) as DocRecord | undefined
      const place = r && 'parentId' in r ? (r.typeName === 'container' ? r.id : r.parentId) : null
      if (place && (lockedBy(store, place as RecordId<ContainerRecord>) || (r?.typeName === 'container' && r.locked))) return place as string
    }
    return null
  }
  return x.parentId
}

/**
 * A connection belongs to all its ends: creating, changing or removing one is refused when any end's
 * curve is in a locked container (dot, review of 3729d27: deleting J freed the end in locked L2).
 */
function connectionLock(store: DocStore, r: DocRecord): Plan | null {
  if (r.typeName !== 'connection') return null
  for (const e of r.ends) {
    const curve = getAs(store, e.curveId, 'curve')
    const locker = curve ? lockedBy(store, curve.parentId) : undefined
    if (locker) return fail('LOCKED', `${r.id} joins ${anchorKey(e)} in locked container ${locker.id}`, [r.id, anchorKey(e), locker.id], [`unlock ${locker.id}`])
  }
  return null
}

function writeGuard(store: DocStore, cmd: Command, puts: DocRecord[], creates: Set<string>): Plan | null {
  for (const r of puts) {
    const old = store.get(r.id as any) as DocRecord | undefined
    if (creates.has(r.id)) {
      if (old) return fail('ID_CONFLICT', `${r.id} already exists`, [r.id], ['omit the id to get a fresh one'])
      // a NEW record may not be placed under a lock either (generic, not left to each command)
      const ends = connectionLock(store, r)
      if (ends) return ends
      const place = placeOf(store, r)
      const locker = place ? lockedBy(store, place as RecordId<ContainerRecord>) : undefined
      if (locker) return fail('LOCKED', `${r.id} would be created in locked container ${locker.id}`, [r.id, locker.id], [`unlock ${locker.id}`])
      continue
    }
    if (!old) return fail('NOT_FOUND', `${r.id} does not exist`, [r.id])
    if (old.typeName !== r.typeName) return fail('INVALID', `${r.id} changes type`, [r.id])
    const ends = connectionLock(store, old) ?? connectionLock(store, r)
    if (ends) return ends
    const places = new Set<string | null>()
    places.add(placeOf(store, old))
    places.add(placeOf(store, r))
    for (const place of places) {
      const locker = place ? lockedBy(store, place as RecordId<ContainerRecord>) : undefined
      if (locker)
        return fail('LOCKED', `${r.id} is in locked container ${locker.id}`, [r.id, locker.id], [`unlock ${locker.id}`])
    }
  }
  return null
}

function planRaw(store: DocStore, cmd: Command, ids: IdSource): Plan {
  switch (cmd.type) {
    case 'moveAnchors': {
      const moved = linkedAnchors(store, cmd.targets)
      const locked = lockCheck(store, moved)
      if (locked) return locked
      const moves = new Map<string, { ref: AnchorRef; p: Vec }>()
      for (const m of moved) {
        const a = getAs(store, m.ref.curveId, 'curve')!.anchors[m.ref.anchorId] // curve checked by lockCheck
        if (!a) return fail('NOT_FOUND', `anchor ${anchorKey(m.ref)} not found`, [anchorKey(m.ref)])
        moves.set(anchorKey(m.ref), { ref: m.ref, p: add(a.p, cmd.delta) })
      }
      return { ok: true, label: 'moveAnchors', puts: writeAnchors(store, moves), affected: [...moves.keys()] }
    }
    case 'moveHandle': {
      const curve = getAs(store, cmd.target.curveId, 'curve')
      const a = curve?.anchors[cmd.target.anchorId]
      if (!curve || !a) return notFound(store, cmd.target.curveId, curve ? 'anchor' : 'curve', anchorKey(cmd.target))
      const locked = lockCheck(store, [{ ref: cmd.target }])
      if (locked) return locked
      const next = structuredClone(curve)
      const key = cmd.handle === 'in' ? 'hIn' : 'hOut'
      next.anchors[a.id] = { ...a, [key]: add(a[key], cmd.delta) }
      return { ok: true, label: 'moveHandle', puts: [next], affected: [`${anchorKey(cmd.target)}.${key}`] }
    }
    case 'moveOverride': {
      const ref = getAs(store, cmd.referenceId, 'reference')
      if (!ref) return notFound(store, cmd.referenceId, 'reference')
      const locker = lockedBy(store, ref.parentId)
      if (locker) return fail('LOCKED', `reference ${ref.id} is in locked container ${locker.id}`, [ref.id, locker.id], [`unlock ${locker.id}`])
      const curve = getAs(store, cmd.target.curveId, 'curve')
      const a = curve?.anchors[cmd.target.anchorId]
      if (!curve || !a) return notFound(store, cmd.target.curveId, curve ? 'anchor' : 'curve', anchorKey(cmd.target))
      if (!isWithin(store, curve.parentId, ref.sourceId))
        return fail('INVALID', `${anchorKey(cmd.target)} is not part of ${ref.id}'s source ${ref.sourceId}`, [ref.id, anchorKey(cmd.target)])
      // A reference override is defined for legacy curves only (samples §4.5). On a family curve (preset forms) its
      // meaning is undefined: refused, never written as an old-style absolute position (dot, review of 2c92206).
      const fam = familiesOf(store, curve.id)
      if (fam.length) return fail('INVALID', `${anchorKey(cmd.target)} belongs to ${fam.join(', ')}: reference overrides on preset-form curves are not supported`, [ref.id, anchorKey(cmd.target), ...fam])
      const key = anchorKey(cmd.target)
      const current = ref.overrides[key] ?? a.p
      const next = { ...ref, overrides: { ...ref.overrides, [key]: add(current, cmd.delta) } }
      return { ok: true, label: 'moveOverride', puts: [next], affected: [`${ref.id}/${key}`] }
    }
    case 'transformContainer':
      return planRaw(store, { type: 'transformContainers', containerIds: [cmd.containerId], matrix: cmd.matrix }, ids)
    case 'transformContainers': {
      // Container transform is undecided (11 〔待定 5〕); this slice bakes it into anchors
      // (Illustrator behaviour) so the comparison can be made later with real numbers.
      if (!cmd.containerIds.length) return fail('INVALID', 'no containers', [])
      for (const id of cmd.containerIds) if (!getAs(store, id, 'container')) return notFound(store, id, 'container')
      // Content of the containers via the parent index (no scan of the whole document); a container
      // nested inside another selected one is visited once.
      const uniq = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.id, x])).values()]
      const curves = uniq(cmd.containerIds.flatMap((id) => within(store, id, 'curve')).map((id) => store.get(id) as CurveRecord))
      // References placed inside the containers move with them: compose their placement transform.
      const refs = uniq(cmd.containerIds.flatMap((id) => within(store, id, 'reference')).map((id) => store.get(id) as ReferenceRecord))
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
      const label = cmd.containerIds.length === 1 ? 'transformContainer' : 'transformContainers'
      return { ok: true, label, puts: [...writeAnchors(store, moves), ...movedRefs], affected: [...moves.keys(), ...movedRefs.map((r) => r.id)] }
    }
    case 'createFill': {
      if (!getAs(store, cmd.parentId, 'container')) return notFound(store, cmd.parentId, 'container')
      const locker = lockedBy(store, cmd.parentId)
      if (locker) return fail('LOCKED', `container ${cmd.parentId} is locked by ${locker.id}`, [cmd.parentId, locker.id], [`unlock ${locker.id}`])
      if (!Array.isArray(cmd.boundary) || !cmd.boundary.length) return fail('FILL_NOT_CLOSED', 'boundary is empty', [cmd.parentId])
      // structure first: a malformed step is the caller's INVALID input, never an internal error (review of 71f36d3)
      try {
        validateRecord(Fill.create({ id: Fill.createId('probe'), name: '填充', parentId: cmd.parentId, boundary: cmd.boundary }))
      } catch (e) {
        return fail('INVALID', String((e as Error).message ?? e), [cmd.parentId])
      }
      const gap = findGap(store, cmd.boundary)
      if (gap) return fail('FILL_NOT_CLOSED', `boundary is not closed between ${gap[0]} and ${gap[1]}`, gap, ['connect the two anchors', 'add a fill-only closing edge'])
      const fill = Fill.create({ id: cmd.id ?? (ids.take('fill', () => Fill.createId()) as RecordId<FillRecord>), name: '填充', parentId: cmd.parentId, boundary: cmd.boundary })
      return { ok: true, label: 'createFill', puts: [fill], affected: [fill.id], creates: [fill.id] }
    }
    case 'setPoseKey': {
      // Option A (dot, review of 2a48719): keep the hard-connection semantics. The edit computes its
      // whole linked range, checks locks once and commits once; evaluation never pulls the other end.
      // - Anchors not named in `offsets` keep their current form at this yaw (new key: the current
      //   interpolated offset; existing key: its stored offset). An explicit {0,0} sets zero.
      // - Every anchor connected to a named anchor gets the same offset at the same yaw. Equal offsets
      //   give equal positions ONLY because connected anchors share one coordinate frame and coincide
      //   in the base drawing (invariant I3); this does not carry over to future local frames.
      // - So that equal offsets at one yaw mean equal offsets at EVERY yaw, the linked curves first
      //   get each other's key yaws (inserted with their current interpolated values — shapes do not
      //   change). This relies on per-curve piecewise-linear interpolation over a common yaw domain.
      const curve = getAs(store, cmd.curveId, 'curve')
      if (!curve) return notFound(store, cmd.curveId, 'curve')
      if (typeof cmd.yaw !== 'number' || !Number.isFinite(cmd.yaw)) return fail('INVALID', `yaw ${cmd.yaw} is not a finite number`, [curve.id])
      for (const a of Object.keys(cmd.offsets ?? {})) if (!curve.anchors[a]) return notFound(store, `${curve.id}#${a}`, 'anchor')
      const named = Object.keys(cmd.offsets ?? {}).map((anchorId) => ({ curveId: curve.id, anchorId }))
      const linked = linkedAnchors(store, named)
      const locked = lockCheck(store, linked)
      if (locked) return locked
      // the offset each linked anchor receives: that of the named anchor it is connected to
      const want = new Map<string, Vec>()
      for (const n of named) for (const m of linkedAnchors(store, [n])) want.set(anchorKey(m.ref), cmd.offsets[n.anchorId])
      const curveIds = [...new Set([curve.id as string, ...linked.map((m) => m.ref.curveId as string)])]
      const poseOf = (cid: string) => getAs(store, poseIdOf(cid), 'forms')
      const yaws = new Set<number>([cmd.yaw])
      const keyYaws = (f: FormsRecord | undefined) => [...legacyKeys(f), ...legacy3Keys(f)].map((k) => k.yaw)
      if (linked.length > named.length || curveIds.length > 1) for (const cid of curveIds) for (const y of keyYaws(poseOf(cid))) yaws.add(y)
      const puts: DocRecord[] = []
      const creates: string[] = []
      for (const cid of curveIds) {
        const c = getAs(store, cid, 'curve')!
        const old = poseOf(cid)
        if (old?.encoding === 'legacy-delta3') {
          // a promoted track: the same rule per control point — a named anchor's point AND handles get the offset
          // (anchors and handles move together, as before), other anchors keep / capture their own three offsets
          const old3 = legacy3Keys(old)
          const own = cid === curve.id && curveIds.length === 1 ? new Set([...old3.map((k) => k.yaw), cmd.yaw]) : new Set([...old3.map((k) => k.yaw), ...yaws])
          const keys3 = [...own]
            .sort((a, b) => a - b)
            .map((yaw) => {
              const existing = old3.find((k) => k.yaw === yaw)
              const at = (a: string) => ({ dp: offset3At(old3, a, 'dp', yaw), dIn: offset3At(old3, a, 'dIn', yaw), dOut: offset3At(old3, a, 'dOut', yaw) })
              const offsets: Record<string, PointDelta> = existing ? { ...existing.offsets } : Object.fromEntries(Object.keys(c.anchors).map((a) => [a, at(a)]))
              if (yaw === cmd.yaw) for (const a of Object.keys(c.anchors)) {
                const v = want.get(anchorKey({ curveId: c.id, anchorId: a }))
                if (!v) continue
                // the command sets the ANCHOR's offset; its handles move with it and keep their own offsets relative
                // to it (review of 71f36d3: resetting them lost independent handle shapes)
                const cur = offsets[a] ?? at(a)
                const shift = { x: v.x - cur.dp.x, y: v.y - cur.dp.y }
                // a handle whose offset equals the anchor's gets the new value itself (bit-identical to the old track)
                const move = (h: Vec) => (h.x === cur.dp.x && h.y === cur.dp.y ? { ...v } : { x: h.x + shift.x, y: h.y + shift.y })
                offsets[a] = { dp: { ...v }, dIn: move(cur.dIn), dOut: move(cur.dOut) }
              }
              return { yaw, offsets }
            })
          puts.push({ ...old, yaw: keys3 })
          continue
        }
        const oldKeys = legacyKeys(old)
        const ownYaws = cid === curve.id && curveIds.length === 1 ? new Set([...oldKeys.map((k) => k.yaw), cmd.yaw]) : new Set([...oldKeys.map((k) => k.yaw), ...yaws])
        const keys = [...ownYaws]
          .sort((a, b) => a - b)
          .map((yaw) => {
            const existing = oldKeys.find((k) => k.yaw === yaw)
            // keep the stored form, or capture the current interpolated form for a NEW key
            const offsets: Record<string, Vec> = existing ? { ...existing.offsets } : Object.fromEntries(Object.keys(c.anchors).map((a) => [a, offsetAt(oldKeys, a, yaw)]))
            if (yaw === cmd.yaw) for (const a of Object.keys(c.anchors)) {
              const v = want.get(anchorKey({ curveId: c.id, anchorId: a }))
              if (v) offsets[a] = { ...v }
            }
            return { yaw, offsets }
          })
        const id = poseIdOf(cid)
        // the legacy head-turn track (migrated pose): same keys, same meaning
        puts.push(old ? { ...old, yaw: keys } : Forms.create({ id, curveId: c.id, owner: { kind: 'document' }, encoding: 'legacy-delta', original: 'curve', yaw: keys, expr: {} }))
        if (!old) creates.push(id)
      }
      return { ok: true, label: 'setPoseKey', puts, affected: puts.map((r) => r.id), ...(creates.length ? { creates } : {}) }
    }
    case 'setContainerFlags': {
      const c = getAs(store, cmd.containerId, 'container')
      if (!c) return notFound(store, cmd.containerId, 'container')
      const next = { ...c, ...(cmd.locked !== undefined && { locked: cmd.locked }), ...(cmd.visible !== undefined && { visible: cmd.visible }) }
      return { ok: true, label: 'setContainerFlags', puts: [next], affected: [c.id] }
    }
    case 'insertPoint':
    case 'removeAnchorJoin':
    case 'deleteAnchorWithSegments':
    case 'breakAt':
    case 'addClosingSegment':
    case 'removeClosingSegment':
    case 'mergeEnds':
    case 'bind':
    case 'unbind':
    case 'createCurve':
      return planStructure(store, cmd, ids)
    case 'setPresetWeights':
    case 'setFineTune':
    case 'fixLine':
    case 'fixNode':
    case 'fixExpression':
    case 'clearFix':
    case 'setPresetKey':
    case 'setVisibilityKey':
      return planCharacter(store, cmd, ids)
    case 'duplicate':
      return planDuplicate(store, cmd, ids)
    case 'setMask':
      return planMask(store, cmd, ids)
    case 'deleteRecords': {
      if (!Array.isArray(cmd.ids) || !cmd.ids.length) return fail('INVALID', 'no records to delete', [])
      // existence, duplicates, locks and dependants are checked generically on the final overlay
      return { ok: true, label: 'deleteRecords', puts: [], removals: [...cmd.ids], affected: [...cmd.ids] }
    }
  }
}

/**
 * A boundary is closed when each step's end anchor is the next step's start anchor (same curve),
 * or the two anchors are joined by a connection. Gaps are never silently bridged (11 §1).
 */
/** The boundary closure rule (one definition, model.boundaryGap — also applied on open and on structural writes). */
export const findGap = (store: DocStore, boundary: BoundaryStep[]) => boundaryGap(store, boundary)

// Re-exported so callers can build records without importing the schema module separately.
export { Container, Curve, Reference }
