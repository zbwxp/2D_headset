// Property-based tests (fast-check 4, MIT — https://fast-check.dev). Random sequences of edits, bad
// inputs, batches, undo/redo and save/open are generated; after every step the invariants below must
// hold. Failures shrink to a minimal counterexample. (dot: test properties, not hand-picked examples.)
//
// Invariants
//  I0 any input, however wrong, gets a structured result — never an exception or INTERNAL error
//  I1 a rejected edit writes nothing: document and history unchanged
//  I2 nothing below a locked container changes unless that container is itself a flag target of the
//     same edit (lock state computed by the test from raw records, not by src/model.lockedBy)
//  I3 every connection's ends stay coincident
//  I4 undo after a written edit restores the exact previous document; redo restores the edit
//  I5 a successful no-op (written=false) leaves history unchanged; written=true means the document changed
//  I6 save → open round-trips exactly and the opened document has no structural problems
//  I6' after EVERY step (not only explicit saves) the current state reopens
//  I7 every stored record passes its validator, AND an oracle written independently of src/ (finite
//     numbers, typed references, no dangling ends, no container cycles, fills closed by position)
//  I8 dirty state: clean right after save; dirty after a new write
//  I9 a subscriber that throws cannot make the result lie: written ⇔ document changed ⇔ one new
//     undo step (and undo restores); rejected/no-op ⇔ nothing changed (dot's review of 90692ad)
//  I10 an outer transaction that rolls back restores document, history, revision and dirty state
//  I11 after every step the incremental evaluation (caches) equals the full uncached recompute —
//      including after undo/redo, rollbacks, outer aborts, throwing subscribers and reopen
//  I12 after every step each index answer equals a brute-force scan of the raw records
import { react, transaction } from '@tldraw/state'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { evaluate } from '../src/evaluate'
import { childrenOf, connectionsAt, fillsUsing } from '../src/indexes'
import { graphProblems } from '../src/model'
import { Container, validateRecord, type ConnectionRecord, type CurveRecord, type DocRecord } from '../src/schema'

// The example drawing plus a child layer under the locked L2 (dot: ancestor locks were bypassable).
const L2a = Container.createId('L2a')
const initial = () => [...exampleRecords(), Container.create({ id: L2a, parentId: ids.L2, name: '阴影·子层', index: 'a9' })]

const curves = [ids.C1, ids.C2, ids.E1]
const anchorsOf: Record<string, string[]> = { [ids.C1]: ['a1', 'a2', 'a3'], [ids.C2]: ['b1', 'b2', 'b3'], [ids.E1]: ['e1', 'e2'] }
// wrong-TYPE ids too (dot: a curve or fill passed where a container is expected), not only missing ones
const containers = [ids.L1, ids.L2, ids.L3, L2a, 'container:missing' as any, ids.C1 as any, ids.F as any]
const num = fc.oneof(fc.integer({ min: -20, max: 20 }), fc.constantFrom(0, Infinity, -Infinity, NaN, Number.MAX_VALUE))
const vec = fc.record({ x: num, y: num })
const anchorRef = fc.constantFrom(...curves, ids.L1 as any, ids.F as any).chain((curveId) => fc.constantFrom(...(anchorsOf[curveId] ?? ['a1']), 'zz').map((anchorId) => ({ curveId, anchorId })))
const wrongTypeSegs = [
  { curveId: ids.L1 as any, segmentId: 's1' },
  { curveId: ids.F as any, segmentId: 's1' },
]
const segs = [
  { curveId: ids.C1, segmentId: 's1' },
  { curveId: ids.C1, segmentId: 's2' },
  { curveId: ids.C2, segmentId: 's3' },
  { curveId: ids.C2, segmentId: 's4' },
  { curveId: ids.E1, segmentId: 's5' },
]
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({ type: fc.constant('moveAnchors' as const), targets: fc.array(anchorRef, { minLength: 1, maxLength: 2 }), delta: vec }),
  fc.record({ type: fc.constant('moveHandle' as const), target: anchorRef, handle: fc.constantFrom('in' as const, 'out' as const), delta: vec }),
  fc.record({ type: fc.constant('moveOverride' as const), referenceId: fc.constant(ids.R1), target: anchorRef, delta: vec }),
  fc.record({
    type: fc.constant('transformContainer' as const),
    containerId: fc.constantFrom(...containers),
    matrix: fc.record({ a: fc.constantFrom(1, 2, -1, 0.5), b: fc.constant(0), c: fc.constant(0), d: fc.constantFrom(1, 0.5), e: num, f: num }),
  }),
  fc.record({
    type: fc.constant('transformContainers' as const),
    containerIds: fc.subarray(containers, { minLength: 1 }),
    matrix: fc.record({ a: fc.constant(1), b: fc.constant(0), c: fc.constant(0), d: fc.constant(1), e: num, f: num }),
  }),
  fc.record({
    type: fc.constant('createFill' as const),
    id: fc.option(fc.constantFrom(ids.F, 'fill:new' as any), { nil: undefined }),
    parentId: fc.constantFrom(...containers),
    boundary: fc.array(fc.constantFrom(...segs, ...wrongTypeSegs).chain((s) => fc.constantFrom(1 as const, -1 as const).map((dir) => ({ ...s, dir }))), { maxLength: 5 }),
  }),
  fc.record({ type: fc.constant('setContainerFlags' as const), containerId: fc.constantFrom(...containers), locked: fc.option(fc.boolean(), { nil: undefined }), visible: fc.option(fc.boolean(), { nil: undefined }) }),
) as fc.Arbitrary<Command>

// The closed loop s1,s2 → J → s4⁻,s3⁻ → J0, rotated and/or reversed: closed in every variant.
// Parent is sometimes a curve (dot: wrong-typed parent with an otherwise valid boundary).
const closedFill: fc.Arbitrary<Command> = fc
  .record({ type: fc.constant('createFill' as const), parentId: fc.constantFrom(ids.L1, ids.L3, ids.C1 as any), rot: fc.integer({ min: 0, max: 3 }), rev: fc.boolean() })
  .map(({ rot, rev, ...c }) => {
    const loop = [segs[0], segs[1], { ...segs[3], dir: -1 as const }, { ...segs[2], dir: -1 as const }].map((x) => ({ dir: 1 as const, ...x }))
    let b = [...loop.slice(rot), ...loop.slice(0, rot)]
    if (rev) b = b.reverse().map((x) => ({ ...x, dir: (x.dir === 1 ? -1 : 1) as 1 | -1 }))
    return { ...c, boundary: b }
  }) as fc.Arbitrary<Command>

// Commands that usually succeed, so batches also reach the "whole batch written" branch (not only rejections).
const small = fc.record({ x: fc.integer({ min: -20, max: 20 }), y: fc.integer({ min: -20, max: 20 }) })
const likelyOk: fc.Arbitrary<Command> = fc.oneof(
  fc.record({ type: fc.constant('moveAnchors' as const), targets: fc.constantFrom([{ curveId: ids.C1, anchorId: 'a2' }], [{ curveId: ids.E1, anchorId: 'e1' }]), delta: small }),
  fc.record({ type: fc.constant('moveHandle' as const), target: fc.constantFrom({ curveId: ids.C1, anchorId: 'a2' }, { curveId: ids.E1, anchorId: 'e2' }), handle: fc.constantFrom('in' as const, 'out' as const), delta: small }),
  fc.record({ type: fc.constant('setContainerFlags' as const), containerId: fc.constant(ids.L2), locked: fc.boolean() }),
  closedFill,
  fc.record({ type: fc.constant('transformContainer' as const), containerId: fc.constant(ids.L3), matrix: fc.record({ a: fc.constant(1), b: fc.constant(0), c: fc.constant(0), d: fc.constant(1), e: fc.integer({ min: -9, max: 9 }), f: fc.integer({ min: -9, max: 9 }) }) }),
) as fc.Arbitrary<Command>

type Action =
  | { kind: 'observerThrow'; inner: { kind: 'apply'; cmd: Command } | { kind: 'batch'; cmds: Command[] } | { kind: 'undo' } | { kind: 'redo' }; handlerThrows: boolean }
  | { kind: 'outerAbort'; inner: { kind: 'apply'; cmd: Command } | { kind: 'batch'; cmds: Command[] } | { kind: 'undo' } | { kind: 'redo' } }
  | { kind: 'apply'; cmd: Command } | { kind: 'batch'; cmds: Command[] } | { kind: 'undo' } | { kind: 'redo' } | { kind: 'saveOpen' }
const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: command.map((cmd) => ({ kind: 'apply' as const, cmd })) },
  { weight: 2, arbitrary: fc.array(command, { minLength: 1, maxLength: 3 }).map((cmds) => ({ kind: 'batch' as const, cmds })) },
  { weight: 1, arbitrary: fc.array(likelyOk, { minLength: 1, maxLength: 3 }).map((cmds) => ({ kind: 'batch' as const, cmds })) },
  { weight: 1, arbitrary: likelyOk.map((cmd) => ({ kind: 'apply' as const, cmd })) },
  { weight: 1, arbitrary: closedFill.map((cmd) => ({ kind: 'apply' as const, cmd })) },
  { weight: 2, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'redo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'saveOpen' as const }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('observerThrow' as const),
      inner: fc.oneof(
        fc.oneof(command, likelyOk).map((cmd) => ({ kind: 'apply' as const, cmd })),
        fc.array(fc.oneof(command, likelyOk), { minLength: 1, maxLength: 3 }).map((cmds) => ({ kind: 'batch' as const, cmds })),
        fc.constant({ kind: 'undo' as const }),
        fc.constant({ kind: 'redo' as const }),
      ),
      handlerThrows: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc
      .oneof(
        fc.oneof(command, likelyOk).map((cmd) => ({ kind: 'apply' as const, cmd })),
        fc.array(likelyOk, { minLength: 1, maxLength: 3 }).map((cmds) => ({ kind: 'batch' as const, cmds })),
        fc.constant({ kind: 'undo' as const }),
        fc.constant({ kind: 'redo' as const }),
      )
      .map((inner) => ({ kind: 'outerAbort' as const, inner })),
  },
)

// Lossless comparison key: plain JSON would map NaN, Infinity and -Infinity all to null (dot).
const key = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `#num:${v}` : v))
const doc = (e: Editor) => key(e.reader.serialize('document'))
const records = (e: Editor) => e.reader.allRecords() as DocRecord[]

/** Locked containers at or above `place`, computed from raw records (independent of src/model). */
function lockersOf(byId: Map<string, any>, place: string | null) {
  const out: string[] = []
  const seen = new Set<string>()
  for (let c = place ? byId.get(place) : undefined; c && c.typeName === 'container' && !seen.has(c.id); c = c.parentId ? byId.get(c.parentId) : undefined) {
    seen.add(c.id)
    if (c.locked) out.push(c.id)
  }
  return out
}

function lockedSnapshot(e: Editor) {
  // every record whose place (parent) is under a lock → its serialized form and the lockers
  const rs = records(e) as any[]
  const byId = new Map(rs.map((r) => [r.id, r]))
  const out = new Map<string, { json: string; lockers: string[] }>()
  for (const r of rs) {
    if (r.typeName === 'connection') continue
    const lockers = lockersOf(byId, r.parentId ?? null)
    if (lockers.length) out.set(r.id, { json: key(r), lockers })
  }
  return out
}

/** I2: a locked record may only change if one of its lockers was the target of an unlock in this edit. */
function checkLocks(e: Editor, locked: ReturnType<typeof lockedSnapshot>, cmds: Command[]) {
  // only an UNLOCK attempt can release a lock (dot: visibility-only or locked:true flags must not exempt)
  const targets = new Set(cmds.flatMap((c) => (c.type === 'setContainerFlags' && c.locked === false ? [c.containerId as string] : [])))
  for (const [id, { json, lockers }] of locked) if (!lockers.some((l) => targets.has(l))) expect(key(e.reader.get(id as any)), id).toBe(json)
}

// ---- Oracles written independently of src/ (dot: the judge must not be the implementation itself) ----
type Raw = Record<string, any>
function allFinite(x: unknown): boolean {
  if (typeof x === 'number') return Number.isFinite(x)
  if (x && typeof x === 'object') return Object.values(x).every(allFinite)
  return true
}
// Field-level: these MUST be finite numbers (a null/string/NaN here is a bad value, not "no number").
const finiteNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const finiteVec = (v: unknown) => !!v && typeof v === 'object' && finiteNum((v as Raw).x) && finiteNum((v as Raw).y)
function coordinateProblems(r: Raw): string[] {
  const out: string[] = []
  if (r.typeName === 'curve')
    for (const [k, a] of Object.entries(r.anchors as Record<string, Raw>))
      for (const f of ['p', 'hIn', 'hOut']) if (!finiteVec(a[f])) out.push(`${r.id}#${k}.${f}: not a finite point`)
  if (r.typeName === 'reference') {
    for (const f of ['a', 'b', 'c', 'd', 'e', 'f']) if (!finiteNum(r.transform?.[f])) out.push(`${r.id}.transform.${f}: not finite`)
    for (const [k, v] of Object.entries((r.overrides ?? {}) as Record<string, unknown>)) if (!finiteVec(v)) out.push(`${r.id}.overrides[${k}]: not a finite point`)
  }
  return out
}
/** Structural integrity by direct lookup in the raw snapshot: every reference points at a record of the right type, no cycles. */
function integrityProblems(rs: Raw[]): string[] {
  const byId = new Map<string, Raw>(rs.map((r) => [r.id, r]))
  const is = (id: unknown, type: string) => typeof id === 'string' && byId.get(id)?.typeName === type
  const out: string[] = []
  for (const r of rs) {
    if (!allFinite(r)) out.push(`${r.id}: non-finite number`)
    out.push(...coordinateProblems(r))
    if (r.typeName === 'container' && r.parentId != null && !is(r.parentId, 'container')) out.push(`${r.id}: bad parent`)
    if (['curve', 'fill', 'reference'].includes(r.typeName) && !is(r.parentId, 'container')) out.push(`${r.id}: bad parent`)
    if (r.typeName === 'reference' && !is(r.sourceId, 'container')) out.push(`${r.id}: bad source`)
    if (r.typeName === 'curve') for (const s of r.segments) if (!r.anchors[s.from] || !r.anchors[s.to]) out.push(`${r.id}/${s.id}: dangling segment`)
    if (r.typeName === 'connection') for (const end of r.ends) if (!is(end.curveId, 'curve') || !byId.get(end.curveId)!.anchors[end.anchorId]) out.push(`${r.id}: dangling end`)
    if (r.typeName === 'fill') {
      // closed = non-empty, every step exists, and each step ends where the next one starts (by position)
      const ends = r.boundary.map((st: Raw) => {
        const c = byId.get(st.curveId)
        const seg = c?.typeName === 'curve' ? c.segments.find((x: Raw) => x.id === st.segmentId) : undefined
        if (!c || !seg) return null
        const [a, b] = st.dir === 1 ? [seg.from, seg.to] : [seg.to, seg.from]
        return { start: c.anchors[a].p, end: c.anchors[b].p }
      })
      if (!ends.length) out.push(`${r.id}: empty boundary`)
      else if (ends.some((x: unknown) => !x)) out.push(`${r.id}: boundary step missing`)
      else ends.forEach((x: Raw, i: number) => {
        const y = ends[(i + 1) % ends.length]
        if (x.end.x !== y.start.x || x.end.y !== y.start.y) out.push(`${r.id}: boundary open after step ${i}`)
      })
    }
  }
  for (const r of rs.filter((r) => r.typeName === 'container')) {
    const seen = new Set<string>()
    for (let cur: Raw | undefined = r; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (seen.has(cur.id)) {
        out.push(`${r.id}: container cycle`)
        break
      }
      seen.add(cur.id)
    }
  }
  return out
}

function checkStatic(e: Editor) {
  // I3
  for (const c of records(e).filter((r) => r.typeName === 'connection') as ConnectionRecord[]) {
    const ps = c.ends.map((end) => (e.reader.get(end.curveId) as CurveRecord).anchors[end.anchorId].p)
    for (const p of ps) expect(p).toEqual(ps[0])
  }
  // I7 (own validators) and I7' (independent oracle above)
  for (const r of records(e)) validateRecord(r)
  // raw records, NOT a JSON round trip: JSON turns NaN/±Infinity into null and would hide them (dot)
  expect(integrityProblems(records(e) as unknown as Raw[])).toEqual([])
  // I6' every accepted state reopens — not only at explicit save points (dot: "written OK, then can't open")
  // I11 incremental evaluation (caches + indexes) equals the independent full recompute, every step
  expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
  // I12 every index answer equals a brute-force scan of the raw records (independent of src/indexes)
  const rs = records(e) as any[]
  const expectSame = (got: string[], want: string[]) => expect([...got].sort()).toEqual([...want].sort())
  for (const c of rs.filter((r) => r.typeName === 'connection'))
    for (const end of c.ends) {
      const k = `${end.curveId}#${end.anchorId}`
      expectSame(connectionsAt(e.reader, k), rs.filter((x) => x.typeName === 'connection' && x.ends.some((y: any) => `${y.curveId}#${y.anchorId}` === k)).map((x) => x.id))
    }
  for (const p of rs.filter((r) => r.typeName === 'container'))
    for (const t of ['container', 'curve', 'fill', 'reference'] as const) expectSame(childrenOf(e.reader, p.id, t), rs.filter((x) => x.typeName === t && x.parentId === p.id).map((x) => x.id))
  for (const c of rs.filter((r) => r.typeName === 'curve')) expectSame(fillsUsing(e.reader, c.id), rs.filter((x) => x.typeName === 'fill' && x.boundary.some((b: any) => b.curveId === c.id)).map((x) => x.id))
  // JSON round trip on purpose here: that is what a saved file goes through
  const snap = JSON.parse(JSON.stringify(e.reader.getStoreSnapshot('document')))
  expect(() => Editor.open(snap)).not.toThrow()
}

describe('properties of the single write entry', () => {
  it('hold for random sequences of edits, bad inputs, batches, undo/redo and save/open', () => {
    const seen = { rejected: 0, written: 0, noop: 0, batchOk: 0, batchFail: 0, saveOpen: 0, unlocked: 0, fillCreated: 0, observerWarned: 0, observerFiredNonApply: 0, handlerThrew: 0, outerAborted: 0 }
    fc.assert(
      fc.property(fc.array(action, { maxLength: 25 }), (actions) => {
        let e = new Editor(initial())
        let api = createApi(e)
        checkStatic(e)
        for (const act of actions) {
          const before = doc(e)
          const hist = JSON.stringify(e.history)
          const locked = lockedSnapshot(e)
          if (act.kind === 'apply') {
            const r = api.apply(act.cmd)
            if (act.cmd.type === 'setContainerFlags' && act.cmd.locked === false && r.ok && r.written) seen.unlocked++
            if (act.cmd.type === 'createFill' && r.ok && r.written) seen.fillCreated++
            if (!r.ok) seen.rejected++
            else if (!r.written) seen.noop++
            else seen.written++
            if (!r.ok) {
              expect(r.error.code, r.error.message).not.toBe('INTERNAL') // I0 bad input → structured error, never a crash
              expect(doc(e)).toBe(before) // I1
              expect(JSON.stringify(e.history)).toBe(hist)
            } else if (!r.written) {
              expect(JSON.stringify(e.history)).toBe(hist) // I5
              expect(doc(e)).toBe(before)
            } else {
              expect(e.isDirty).toBe(true) // I8
              const after = doc(e)
              expect(after).not.toBe(before) // I5 judged from outside: "written" must mean the document changed
              e.undo()
              expect(doc(e)).toBe(before) // I4
              e.redo()
              expect(doc(e)).toBe(after)
            }
            checkLocks(e, locked, [act.cmd]) // I2
          } else if (act.kind === 'batch') {
            const r = api.applyBatch('b', act.cmds)
            if (r.ok) seen.batchOk++
            else seen.batchFail++
            expect(r.revision).toBe(e.revision) // the result's revision is the document's
            if (r.ok) expect(r.results.length).toBe(act.cmds.length)
            else expect(r.failedAt).toBeGreaterThanOrEqual(0) // I0: failures come from a command, never INTERNAL
            if (r.ok) expect(r.written).toBe(doc(e) !== before) // written ⇔ the whole batch changed the document
            if (!r.ok) {
              expect(r.error.code, r.error.message).not.toBe('INTERNAL') // I0
              expect(doc(e)).toBe(before) // I1 for batches
              expect(JSON.stringify(e.history)).toBe(hist)
            } else if (doc(e) === before) {
              expect(JSON.stringify(e.history)).toBe(hist) // I5 for batches: net-zero batch adds no step
            } else {
              const after = doc(e)
              e.undo()
              expect(doc(e)).toBe(before) // I4 for batches: one undo step undoes the whole batch
              e.redo()
              expect(doc(e)).toBe(after)
            }
            checkLocks(e, locked, act.cmds) // I2
          } else if (act.kind === 'observerThrow') {
            // I9: a subscriber (of document AND history) throws on every change after its first run;
            // sometimes the warning handler throws as well. Nothing may escape, results must not lie.
            let armed = false
            const stop = react('throwing subscriber', () => {
              e.reader.allRecords()
              void e.history
              if (armed) throw new Error('subscriber failure')
            })
            armed = true
            const undoLen = e.history.undo.length
            const warn = e.onWarning
            e.onWarning = act.handlerThrows
              ? () => {
                  throw new Error('handler failure')
                }
              : () => {}
            const inner = act.inner
            let out: unknown
            try {
              expect(() => {
                if (inner.kind === 'apply') out = api.apply(inner.cmd)
                else if (inner.kind === 'batch') out = api.applyBatch('b', inner.cmds)
                else if (inner.kind === 'undo') out = api.undo()
                else out = api.redo()
              }).not.toThrow()
            } finally {
              stop()
              e.onWarning = warn
            }
            const changed = doc(e) !== before
            if (changed && inner.kind !== 'apply') seen.observerFiredNonApply++
            if (changed && act.handlerThrows) seen.handlerThrew++
            if (inner.kind === 'apply' || inner.kind === 'batch') {
              const r = out as any
              const ok = r.ok
              const written = ok && r.written
              expect(r.revision).toBe(e.revision)
              if (inner.kind === 'apply' && ok && r.written && r.warnings?.length) seen.observerWarned++
              if (!ok) expect(r.error.code, r.error.message).not.toBe('INTERNAL')
              if (written) {
                expect(changed).toBe(true)
                expect(e.history.undo.length).toBe(undoLen + 1)
                const after = doc(e)
                e.undo()
                expect(doc(e)).toBe(before)
                e.redo()
                expect(doc(e)).toBe(after)
              } else {
                expect(changed).toBe(false)
                expect(JSON.stringify(e.history)).toBe(hist)
              }
              checkLocks(e, locked, inner.kind === 'apply' ? [inner.cmd] : inner.cmds)
            } else {
              // undo/redo: returned true ⇔ exactly one step moved between the stacks, and it reverses
              const res = out as ReturnType<typeof api.undo>
              expect(res.ok).toBe(true)
              expect(res.revision).toBe(e.revision)
              if (res.ok && res.written && act.handlerThrows) expect(res.warnings?.map((w) => w.code)).toEqual(['OBSERVER_FAILED', 'WARNING_HANDLER_FAILED'])
              const moved = res.ok && res.written
              expect(e.history.undo.length).toBe(inner.kind === 'undo' ? undoLen - (moved ? 1 : 0) : undoLen + (moved ? 1 : 0))
              if (!moved) expect(changed).toBe(false)
              else {
                if (inner.kind === 'undo') e.redo()
                else e.undo()
                expect(doc(e)).toBe(before)
                expect(JSON.stringify(e.history)).toBe(hist)
                if (inner.kind === 'undo') e.undo()
                else e.redo()
              }
            }
          } else if (act.kind === 'outerAbort') {
            // I10: the caller wraps us in its own transaction and rolls it back
            const rev = e.revision
            const dirty = e.isDirty
            const inner = act.inner
            expect(() =>
              transaction(() => {
                if (inner.kind === 'apply') api.apply(inner.cmd)
                else if (inner.kind === 'batch') api.applyBatch('b', inner.cmds)
                else if (inner.kind === 'undo') e.undo()
                else e.redo()
                throw new Error('outer abort')
              }),
            ).toThrow('outer abort')
            seen.outerAborted++
            expect(doc(e)).toBe(before)
            expect(JSON.stringify(e.history)).toBe(hist)
            expect(e.revision).toBe(rev)
            expect(e.isDirty).toBe(dirty)
          } else if (act.kind === 'undo' || act.kind === 'redo') {
            const len = e.history.undo.length
            const res = act.kind === 'undo' ? api.undo() : api.redo()
            expect(res).toMatchObject({ ok: true, revision: e.revision })
            // written ⇔ one step moved between the stacks
            expect(e.history.undo.length).toBe(len + (res.written ? (act.kind === 'undo' ? -1 : 1) : 0))
            if (!res.written) expect(doc(e)).toBe(before)
          } else {
            seen.saveOpen++
            const saved = JSON.parse(JSON.stringify(e.save())) // as written to a file
            expect(e.isDirty).toBe(false) // I8
            const opened = Editor.open(saved)
            expect(doc(opened)).toBe(doc(e)) // I6
            expect(graphProblems(opened.reader)).toEqual([])
            e = opened
            api = createApi(e)
          }
          checkStatic(e)
        }
      }),
      { numRuns: 400 },
    )
    console.log('[properties] coverage of outcomes', JSON.stringify(seen))
    // the generator must actually exercise every branch, otherwise passing proves little
    // Floor of 5 per branch. Re-measured over 40 runs after the I9 extension (2026-10-06): lowest
    // branch minimum 11 (unlocked, median 19), then observerWarned min 23; all others ≥ 24. A floor
    // at typical counts made the test fail by chance (946e816, a3bf7a0) — re-measure on any
    // generator change.
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThanOrEqual(5)
  })
})
