// A failing warning handler must not turn a committed write into an exception or a false result
// (dot's re-review focus for 8875a57: "报错通知自身出错时是否还能如实返回结果").
import { react } from '@tldraw/state'
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'

const cmd: Command = { type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 10, y: 5 } }
const doc = (e: Editor) => JSON.stringify(e.reader.serialize('document'))

function throwingSetup() {
  const e = new Editor(exampleRecords())
  let armed = false
  const stop = react('throwing subscriber', () => {
    e.reader.allRecords()
    e.history // also observe history, so undo/redo/batch commits notify it too
    if (armed) throw new Error('subscriber failure')
  })
  armed = true
  e.onWarning = () => {
    throw new Error('warning handler failure')
  }
  return { e, api: createApi(e), stop }
}

describe('subscriber AND warning handler both throw', () => {
  it('apply still returns the truth: written, one undo step, both failures reported', () => {
    const { e, api, stop } = throwingSetup()
    const before = doc(e)
    let r: ReturnType<typeof api.apply> | undefined
    expect(() => (r = api.apply(cmd))).not.toThrow()
    stop()
    expect(r).toMatchObject({ ok: true, written: true })
    expect(r!.ok && r!.written && r!.warnings?.map((w) => w.code)).toEqual(['OBSERVER_FAILED', 'WARNING_HANDLER_FAILED'])
    expect(doc(e)).not.toBe(before)
    expect(e.history.undo).toEqual(['moveAnchors'])
  })

  it('undo, redo and applyBatch do not throw and leave document and history consistent', () => {
    const { e, api, stop } = throwingSetup()
    const before = doc(e)
    expect(() => api.apply(cmd)).not.toThrow()
    const after = doc(e)
    expect(() => e.undo()).not.toThrow()
    expect(doc(e)).toBe(before)
    expect(e.history).toEqual({ undo: [], redo: ['moveAnchors'] })
    expect(() => e.redo()).not.toThrow()
    expect(doc(e)).toBe(after)
    let b: unknown
    expect(() => (b = api.applyBatch('two', [cmd, cmd]))).not.toThrow()
    stop()
    // the whole batch's outcome, including the notification failures of its final commit
    expect(b).toMatchObject({ ok: true, written: true, warnings: [{ code: 'OBSERVER_FAILED' }, { code: 'WARNING_HANDLER_FAILED' }] })
    expect(e.history.undo).toEqual(['moveAnchors', 'two'])
  })
})
