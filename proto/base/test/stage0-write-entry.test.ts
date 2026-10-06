// Stage 0 of the unified implementation (doc 18 §23.2 / §22): removals in plans, tombstone previews,
// prepared operations with fixed identities and a non-rewinding edit generation. dot 1791306076's three
// points are the three describe blocks below.
import { react } from '@tldraw/state'
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import { childrenOf, connectionsAt, fillsUsing, referencesOf } from '../src/indexes'
import { plainReader } from '../src/runtime'
import { overlayConflict, type Command } from '../src/commands'
import { overlayReader } from '../src/derived'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import { deepFreeze, poseIdOf, type FillRecord } from '../src/schema'

const unlocked = () => exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r))
const addresses = (e: { paint: { item: { address: string } }[] }) => e.paint.map((p) => p.item.address).sort()
const boundary = () => (exampleRecords().find((r) => r.id === ids.F) as FillRecord).boundary
const state = (e: Editor) => JSON.stringify({ recs: e.reader.allRecords(), history: e.history, revision: e.revision, generation: e.generation })

describe('1. removals: one final overlay, locks and incoming dependencies, tombstones everywhere', () => {
  it('delete → preview (get / enumeration / evaluation agree) → commit → undo → redo → save / reopen', () => {
    const e = new Editor(exampleRecords())
    const before = evaluate(e.reader)
    const cmd: Command = deepFreeze({ type: 'deleteRecords', ids: [ids.E1] })
    const pv = e.preview(cmd)
    expect(pv.ok).toBe(true)
    if (!pv.ok) return
    expect(pv.removals).toEqual([ids.E1])
    const view = overlayReader(e.reader, pv.puts, pv.removals)
    expect(view.get(ids.E1)).toBeUndefined()
    expect(view.allRecords().some((r) => r.id === ids.E1)).toBe(false)
    const shown = e.derived.preview(pv.puts, e.derived.previewChanges(pv.puts, pv.removals))
    expect(addresses(shown)).toEqual(addresses(evaluate(view)))
    expect(addresses(shown).some((a) => a.includes(ids.E1))).toBe(false) // the curve and its reference instance are gone
    expect(e.reader.get(ids.E1)).toBeTruthy() // preview wrote nothing
    const r = e.apply(cmd)
    expect(r.ok && r.written).toBe(true)
    expect(e.reader.get(ids.E1)).toBeUndefined()
    expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
    expect(addresses(e.derived.evaluated())).toEqual(addresses(shown)) // what the preview showed is what was committed
    const saved = e.save()
    expect(addresses(evaluate(Editor.open(saved).reader))).toEqual(addresses(shown))
    expect(e.undo()).toBe(true)
    expect(e.reader.get(ids.E1)).toEqual(exampleRecords().find((x) => x.id === ids.E1))
    expect(e.derived.evaluated()).toEqual(before)
    expect(e.redo()).toBe(true)
    expect(e.reader.get(ids.E1)).toBeUndefined()
  })

  it('a removed record that something still depends on is refused as a whole, naming the dependants', () => {
    const e = new Editor(unlocked())
    const at = state(e)
    const curve = e.apply({ type: 'deleteRecords', ids: [ids.C1] }) // connections J, J0 and fill F read C1
    expect(curve.ok).toBe(false)
    if (!curve.ok) {
      expect(curve.error.code).toBe('BAD_REFERENCE')
      for (const d of [ids.J, ids.J0, ids.F]) expect(curve.error.message).toContain(d)
    }
    const partial = e.apply({ type: 'deleteRecords', ids: [ids.C1, ids.J, ids.J0] })
    expect(partial.ok === false && partial.error.message).toContain(ids.F)
    const container = e.apply({ type: 'deleteRecords', ids: [ids.L3] }) // E1 lives in it, R1 shows it
    expect(container.ok === false && container.error.code).toBe('BAD_REFERENCE')
    if (!container.ok) for (const d of [ids.E1, ids.R1]) expect(container.error.message).toContain(d)
    expect(state(e)).toBe(at) // nothing written, no history, no generation bump
    const whole = e.apply({ type: 'deleteRecords', ids: [ids.C1, ids.J, ids.J0, ids.F] })
    expect(whole.ok && whole.written).toBe(true)
    expect(e.undo()).toBe(true)
    expect(JSON.stringify(e.reader.allRecords())).toBe(JSON.stringify(JSON.parse(at).recs))
  })

  it('locks: a record in a locked container, or a locked container itself, is not removed', () => {
    const e = new Editor(exampleRecords()) // L2 locked
    const at = state(e)
    const inLocked = e.apply({ type: 'deleteRecords', ids: [ids.F] })
    expect(inLocked.ok === false && inLocked.error.code).toBe('LOCKED')
    const itself = e.apply({ type: 'deleteRecords', ids: [ids.L2, ids.C2, ids.F, ids.J, ids.J0] })
    expect(itself.ok === false && itself.error.code).toBe('LOCKED')
    expect(state(e)).toBe(at)
  })

  it('one overlay: duplicate or conflicting ids, missing ids and empty commands are refused', () => {
    const e = new Editor(exampleRecords())
    const dup = e.preview({ type: 'deleteRecords', ids: [ids.E1, ids.E1] })
    expect(dup.ok === false && dup.error.code).toBe('ID_CONFLICT')
    const missing = e.preview({ type: 'deleteRecords', ids: ['curve:nope'] })
    expect(missing.ok === false && missing.error.code).toBe('NOT_FOUND')
    const empty = e.preview({ type: 'deleteRecords', ids: [] })
    expect(empty.ok === false && empty.error.code).toBe('INVALID')
    const c1 = e.reader.get(ids.C1)!
    const both = overlayConflict([c1], [ids.C1])
    expect(both?.ok === false && both.error.code).toBe('ID_CONFLICT')
    const twice = overlayConflict([c1, c1], [])
    expect(twice?.ok === false && twice.error.code).toBe('ID_CONFLICT')
    expect(overlayConflict([c1], [ids.E1])).toBeNull()
  })
})

describe('2. a prepared operation uses the non-rewinding edit generation', () => {
  it('an edit made and undone after the start still makes the operation stale; nothing is written', () => {
    const e = new Editor(exampleRecords())
    const op = e.prepare()
    const move: Command = { type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e1' }], delta: { x: 2, y: 0 } }
    expect(op.preview(move).ok).toBe(true)
    const rev0 = e.revision
    expect(e.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 1, y: 1 } }).ok).toBe(true)
    expect(e.undo()).toBe(true)
    expect(e.revision).toBe(rev0) // the history revision went back …
    expect(e.generation).toBeGreaterThan(op.startGeneration) // … the generation did not
    const before = state(e)
    const pv = op.preview(move)
    expect(pv.ok === false && pv.error.code).toBe('STALE')
    const r = op.commit(move)
    expect(r.ok === false && r.error.code).toBe('STALE')
    expect(state(e)).toBe(before)
  })

  it('without changes in between, the commit plans again on the current document and writes once', () => {
    const e = new Editor(exampleRecords())
    const op = e.prepare()
    const at = (dx: number): Command => ({ type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e1' }], delta: { x: dx, y: 0 } })
    expect(op.preview(at(1)).ok).toBe(true)
    expect(op.preview(at(5)).ok).toBe(true) // latest input re-planned
    const e1 = (e.reader.get(ids.E1) as any).anchors.e1.p
    const r = op.commit() // the latest previewed command
    expect(r.ok && r.written).toBe(true)
    expect((e.reader.get(ids.E1) as any).anchors.e1.p).toEqual({ x: e1.x + 5, y: e1.y })
    expect(e.history.undo).toEqual(['moveAnchors'])
  })
})

describe('3. prepared identities: preview and commit share new ids; independent creates never do', () => {
  it('KF-1 fixed through a prepared operation: re-planned previews and the commit give the same new id; the command is not modified', () => {
    const e = new Editor(exampleRecords())
    const cmd: Command = deepFreeze({ type: 'createFill', parentId: ids.L1, boundary: boundary() })
    const copy = JSON.stringify(cmd)
    const op = e.prepare()
    const a = op.preview(cmd)
    const b = op.preview(cmd)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.affected).toEqual(a.affected)
    const r = op.commit()
    expect(r.ok && r.written).toBe(true)
    expect(r.ok && r.affected).toEqual(a.affected)
    expect(e.reader.get(a.affected[0] as any)).toBeTruthy()
    expect(JSON.stringify(cmd)).toBe(copy)
  })

  it('two independent operations (and two plain applies) create two records, never one', () => {
    const e = new Editor(exampleRecords())
    const cmd: Command = { type: 'createFill', parentId: ids.L1, boundary: boundary() }
    const o1 = e.prepare()
    const p1 = o1.preview(cmd)
    const r1 = o1.commit()
    const o2 = e.prepare()
    const p2 = o2.preview(cmd)
    const r2 = o2.commit()
    expect(p1.ok && p2.ok && r1.ok && r2.ok).toBe(true)
    if (!p1.ok || !p2.ok) return
    expect(p1.affected[0]).not.toBe(p2.affected[0])
    const a1 = e.apply(cmd)
    const a2 = e.apply(cmd)
    expect(a1.ok && a2.ok && a1.affected[0] !== a2.affected[0]).toBe(true)
    // a plain preview followed by a plain apply are independent too (use `prepare` to share ids)
    const pv = e.preview(cmd)
    const ap = e.apply(cmd)
    expect(pv.ok && ap.ok && pv.affected[0] !== ap.affected[0]).toBe(true)
  })

  it('cancel writes nothing; an operation ends once: a second commit, or commit after cancel, writes nothing', () => {
    const e = new Editor(exampleRecords())
    const cmd: Command = { type: 'createFill', parentId: ids.L1, boundary: boundary() }
    const c = e.prepare()
    expect(c.preview(cmd).ok).toBe(true)
    const before = state(e)
    c.cancel()
    expect(c.state).toBe('cancelled')
    const afterCancel = c.commit(cmd)
    expect(afterCancel.ok).toBe(false)
    expect(state(e)).toBe(before)
    const o = e.prepare()
    expect(o.preview(cmd).ok).toBe(true)
    expect(o.commit().ok).toBe(true)
    const once = state(e)
    const again = o.commit()
    expect(again.ok === false && again.error.message).toContain('already ended')
    expect(state(e)).toBe(once)
    expect(e.history.undo).toEqual(['createFill'])
  })

  it('a refused commit ends the operation too and writes nothing', () => {
    const e = new Editor(exampleRecords())
    const o = e.prepare()
    const locked: Command = { type: 'moveAnchors', targets: [{ curveId: ids.C2, anchorId: 'b2' }], delta: { x: 1, y: 0 } }
    expect(o.preview(locked).ok).toBe(false)
    const before = state(e)
    expect(o.commit(locked).ok).toBe(false)
    expect(o.state).toBe('ended')
    expect(state(e)).toBe(before)
  })
})

describe('4. after review of 3729d27: public API, generation timing on undo / redo, pose and connection deletion', () => {
  it('public API: prepare shares new ids between preview and commit; plain preview + apply are independent plans', () => {
    const e = new Editor(exampleRecords())
    const api = createApi(e)
    const cmd: Command = { type: 'createFill', parentId: ids.L1, boundary: boundary() }
    const op = api.prepare()
    const pv = op.preview(cmd)
    const r = op.commit()
    expect(pv.ok && r.ok && r.written).toBe(true)
    if (!pv.ok || !r.ok) return
    expect(r.affected).toEqual(pv.affected)
    expect(op.state).toBe('ended')
    const other = api.prepare().preview(cmd)
    expect(other.ok && other.affected[0] !== pv.affected[0]).toBe(true)
    const plain = api.preview(cmd)
    const applied = api.apply(cmd)
    expect(plain.ok && applied.ok && plain.affected[0] !== applied.affected[0]).toBe(true) // the stated boundary
  })

  it('undo and redo bump the generation before subscribers run: a waiting operation is already stale there', () => {
    for (const step of ['undo', 'redo'] as const) {
      const e = new Editor(exampleRecords())
      expect(e.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 1, y: 0 } }).ok).toBe(true)
      if (step === 'redo') e.undo()
      const op = e.prepare()
      op.preview({ type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e1' }], delta: { x: 3, y: 0 } })
      let armed = false
      let nested: ReturnType<typeof op.commit> | undefined
      const stop = react(`stage0-${step}`, () => {
        e.reader.get(ids.C1)
        if (armed) {
          armed = false
          nested = op.commit()
        }
      })
      armed = true
      expect(step === 'undo' ? e.undo() : e.redo()).toBe(true)
      stop()
      expect(nested?.ok === false && nested.error.code).toBe('STALE')
    }
  })

  it('deleting BOTH linked poses together is legal; deleting one is refused (no silent cascade)', () => {
    const e = new Editor(unlocked())
    expect(e.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 30, offsets: { a3: { x: 10, y: 0 } } }).ok).toBe(true)
    const one = e.apply({ type: 'deleteRecords', ids: [poseIdOf(ids.C1)] })
    expect(one.ok === false && one.error.code).toBe('BAD_REFERENCE')
    const both = e.apply({ type: 'deleteRecords', ids: [poseIdOf(ids.C1), poseIdOf(ids.C2)] })
    expect(both.ok && both.written).toBe(true)
    expect(() => Editor.open(e.save())).not.toThrow()
  })

  it('a connection with an end in a locked container is not removed; with every end unlocked it is', () => {
    const locked = new Editor(exampleRecords())
    const r = locked.apply({ type: 'deleteRecords', ids: [ids.J] })
    expect(r.ok === false && r.error.code).toBe('LOCKED')
    const free = new Editor(unlocked())
    expect(free.apply({ type: 'deleteRecords', ids: [ids.J] }).ok).toBe(true)
  })

  it('a plain runtime reader (no indexes) answers membership by scanning its records', () => {
    const rd = plainReader(exampleRecords())
    expect(childrenOf(rd, ids.L3, 'curve')).toEqual([ids.E1])
    expect(connectionsAt(rd, `${ids.C1}#a3`)).toEqual([ids.J])
    expect(fillsUsing(rd, ids.C2)).toEqual([ids.F])
    expect(referencesOf(rd, ids.L3)).toEqual([ids.R1])
  })
})
