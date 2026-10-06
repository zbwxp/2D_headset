// One result contract for every API entry (dot): the return value describes the WHOLE operation —
// ok, written, revision, warnings, error — without needing onWarning.
import { react } from '@tldraw/state'
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'

const handle = (dx: number): Command => ({ type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: dx, y: 0 } })
const lockedViaJ: Command = { type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a3' }], delta: { x: 1, y: 0 } }
const setup = () => {
  const e = new Editor(exampleRecords())
  return { e, api: createApi(e) }
}

describe('applyBatch returns the whole batch outcome', () => {
  it('committed batch: written, revision, one result per command', () => {
    const { e, api } = setup()
    const r = api.applyBatch('two', [handle(1), handle(2)])
    expect(r).toMatchObject({ ok: true, written: true, revision: e.revision })
    expect(r.ok && r.results.map((x) => x.ok)).toEqual([true, true])
    expect(e.revision).toBeGreaterThan(0)
  })

  it('net-zero batch: ok but not written, revision unchanged', () => {
    const { e, api } = setup()
    const r = api.applyBatch('round trip', [handle(1), handle(-1)])
    expect(r).toMatchObject({ ok: true, written: false, revision: 0 })
    expect(e.history.undo).toEqual([])
  })

  it("a command's success inside a failed batch is not reported as success", () => {
    const { e, api } = setup()
    const r = api.applyBatch('then locked', [handle(1), lockedViaJ])
    expect(r).toMatchObject({ ok: false, written: false, revision: 0, failedAt: 1, error: { code: 'LOCKED' } })
    expect('results' in r).toBe(false)
    expect(e.history.undo).toEqual([])
  })

  it('notification failures of the final commit are in the returned result', () => {
    const { e, api } = setup()
    e.onWarning = () => {
      throw new Error('sink failed')
    }
    let armed = false
    const stop = react('history watcher', () => {
      void e.history
      if (armed) throw new Error('observer failed')
    })
    armed = true
    const r = api.applyBatch('two', [handle(1), handle(2)])
    stop()
    expect(r).toMatchObject({ ok: true, written: true, warnings: [{ code: 'OBSERVER_FAILED', message: 'observer failed' }, { code: 'WARNING_HANDLER_FAILED', message: 'sink failed' }] })
  })
})

describe('undo / redo return operation results', () => {
  it('written, revision; nothing to undo/redo is ok but not written', () => {
    const { e, api } = setup()
    expect(api.undo()).toEqual({ ok: true, written: false, revision: 0 })
    api.apply(handle(1))
    expect(api.undo()).toEqual({ ok: true, written: true, revision: 0 })
    expect(api.redo()).toEqual({ ok: true, written: true, revision: e.revision })
    expect(api.redo()).toEqual({ ok: true, written: false, revision: e.revision })
  })

  it('subscriber and handler failures are returned, the step still happened', () => {
    const { e, api } = setup()
    api.apply(handle(1))
    e.onWarning = () => {
      throw new Error('sink failed')
    }
    let armed = false
    const stop = react('doc watcher', () => {
      e.reader.allRecords()
      if (armed) throw new Error('observer failed')
    })
    armed = true
    const u = api.undo()
    const r = api.redo()
    stop()
    for (const x of [u, r]) expect(x).toMatchObject({ ok: true, written: true, warnings: [{ code: 'OBSERVER_FAILED' }, { code: 'WARNING_HANDLER_FAILED' }] })
    expect(e.history.undo).toEqual(['moveHandle'])
  })
})
