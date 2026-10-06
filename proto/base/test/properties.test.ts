// Property-based tests (fast-check 4, MIT — https://fast-check.dev). Random sequences of edits, bad
// inputs, batches, undo/redo and save/open are generated; after every step the invariants below must
// hold. Failures shrink to a minimal counterexample. (dot: test properties, not hand-picked examples.)
//
// Invariants
//  I0 any input, however wrong, gets a structured result — never an exception or INTERNAL error
//  I1 a rejected edit writes nothing: document and history unchanged
//  I2 nothing inside a locked container changes, except by unlocking it
//  I3 every connection's ends stay coincident
//  I4 undo after a written edit restores the exact previous document; redo restores the edit
//  I5 a successful no-op (written=false) leaves history unchanged; written=true means the document changed
//  I6 save → open round-trips exactly and the opened document has no structural problems
//  I6' after EVERY step (not only explicit saves) the current state reopens
//  I7 every stored record passes its validator, AND an oracle written independently of src/ (finite
//     numbers, typed references, no dangling ends, no container cycles, fills closed by position)
//  I8 dirty state: clean right after save; dirty after a new write
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { graphProblems, lockedBy } from '../src/model'
import { validateRecord, type ConnectionRecord, type CurveRecord, type DocRecord } from '../src/schema'

const curves = [ids.C1, ids.C2, ids.E1]
const anchorsOf: Record<string, string[]> = { [ids.C1]: ['a1', 'a2', 'a3'], [ids.C2]: ['b1', 'b2', 'b3'], [ids.E1]: ['e1', 'e2'] }
// wrong-TYPE ids too (dot: a curve or fill passed where a container is expected), not only missing ones
const containers = [ids.L1, ids.L2, ids.L3, 'container:missing' as any, ids.C1 as any, ids.F as any]
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

// Commands that usually succeed, so batches also reach the "whole batch written" branch (not only rejections).
const small = fc.record({ x: fc.integer({ min: -20, max: 20 }), y: fc.integer({ min: -20, max: 20 }) })
const likelyOk: fc.Arbitrary<Command> = fc.oneof(
  fc.record({ type: fc.constant('moveAnchors' as const), targets: fc.constantFrom([{ curveId: ids.C1, anchorId: 'a2' }], [{ curveId: ids.E1, anchorId: 'e1' }]), delta: small }),
  fc.record({ type: fc.constant('moveHandle' as const), target: fc.constantFrom({ curveId: ids.C1, anchorId: 'a2' }, { curveId: ids.E1, anchorId: 'e2' }), handle: fc.constantFrom('in' as const, 'out' as const), delta: small }),
  fc.record({ type: fc.constant('setContainerFlags' as const), containerId: fc.constant(ids.L2), locked: fc.boolean() }),
  // the closed loop s1,s2 → J → s4⁻,s3⁻ → J0, rotated and/or reversed: closed in every variant
  fc.record({ type: fc.constant('createFill' as const), parentId: fc.constantFrom(ids.L1, ids.L3, ids.C1 as any), rot: fc.integer({ min: 0, max: 3 }), rev: fc.boolean() }).map(({ rot, rev, ...c }) => {
    const loop = [segs[0], segs[1], { ...segs[3], dir: -1 as const }, { ...segs[2], dir: -1 as const }].map((x) => ({ dir: 1 as const, ...x }))
    let b = [...loop.slice(rot), ...loop.slice(0, rot)]
    if (rev) b = b.reverse().map((x) => ({ ...x, dir: (x.dir === 1 ? -1 : 1) as 1 | -1 }))
    return { ...c, boundary: b }
  }),
  fc.record({ type: fc.constant('transformContainer' as const), containerId: fc.constant(ids.L3), matrix: fc.record({ a: fc.constant(1), b: fc.constant(0), c: fc.constant(0), d: fc.constant(1), e: fc.integer({ min: -9, max: 9 }), f: fc.integer({ min: -9, max: 9 }) }) }),
) as fc.Arbitrary<Command>

type Action = { kind: 'apply'; cmd: Command } | { kind: 'batch'; cmds: Command[] } | { kind: 'undo' } | { kind: 'redo' } | { kind: 'saveOpen' }
const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: command.map((cmd) => ({ kind: 'apply' as const, cmd })) },
  { weight: 2, arbitrary: fc.array(command, { minLength: 1, maxLength: 3 }).map((cmds) => ({ kind: 'batch' as const, cmds })) },
  { weight: 1, arbitrary: fc.array(likelyOk, { minLength: 1, maxLength: 3 }).map((cmds) => ({ kind: 'batch' as const, cmds })) },
  { weight: 1, arbitrary: likelyOk.map((cmd) => ({ kind: 'apply' as const, cmd })) },
  { weight: 2, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'redo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'saveOpen' as const }) },
)

const doc = (e: Editor) => JSON.stringify(e.reader.serialize('document'))
const records = (e: Editor) => e.reader.allRecords() as DocRecord[]

function lockedSnapshot(e: Editor) {
  // every record whose place is locked → its serialized form
  const out = new Map<string, string>()
  for (const r of records(e)) {
    const place = r.typeName === 'connection' ? null : r.typeName === 'container' ? r.parentId : r.parentId
    if (place && lockedBy(e.reader, place)) out.set(r.id, JSON.stringify(r))
  }
  return out
}

// ---- Oracles written independently of src/ (dot: the judge must not be the implementation itself) ----
type Raw = Record<string, any>
function allFinite(x: unknown): boolean {
  if (typeof x === 'number') return Number.isFinite(x)
  if (x && typeof x === 'object') return Object.values(x).every(allFinite)
  return true
}
/** Structural integrity by direct lookup in the raw snapshot: every reference points at a record of the right type, no cycles. */
function integrityProblems(rs: Raw[]): string[] {
  const byId = new Map<string, Raw>(rs.map((r) => [r.id, r]))
  const is = (id: unknown, type: string) => typeof id === 'string' && byId.get(id)?.typeName === type
  const out: string[] = []
  for (const r of rs) {
    if (!allFinite(r)) out.push(`${r.id}: non-finite number`)
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
  expect(integrityProblems(JSON.parse(JSON.stringify(records(e))))).toEqual([])
  // I6' every accepted state reopens — not only at explicit save points (dot: "written OK, then can't open")
  const snap = JSON.parse(JSON.stringify(e.reader.getStoreSnapshot('document')))
  expect(() => Editor.open(snap)).not.toThrow()
}

describe('properties of the single write entry', () => {
  it('hold for random sequences of edits, bad inputs, batches, undo/redo and save/open', () => {
    const seen = { rejected: 0, written: 0, noop: 0, batchOk: 0, batchFail: 0, saveOpen: 0, unlocked: 0, fillCreated: 0 }
    fc.assert(
      fc.property(fc.array(action, { maxLength: 25 }), (actions) => {
        let e = new Editor(exampleRecords())
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
            if (act.cmd.type !== 'setContainerFlags') for (const [id, json] of locked) expect(JSON.stringify(e.reader.get(id as any))).toBe(json) // I2
          } else if (act.kind === 'batch') {
            const r = api.applyBatch('b', act.cmds)
            if (Array.isArray(r)) seen.batchOk++
            else seen.batchFail++
            if (!Array.isArray(r)) {
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
            if (!act.cmds.some((c) => c.type === 'setContainerFlags')) for (const [id, json] of locked) expect(JSON.stringify(e.reader.get(id as any))).toBe(json) // I2
          } else if (act.kind === 'undo') e.undo()
          else if (act.kind === 'redo') e.redo()
          else {
            seen.saveOpen++
            const saved = JSON.parse(JSON.stringify(e.save()))
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
    // (floor of 10 per branch; typical counts are 25–700, see the log line)
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThanOrEqual(10)
  })
})
