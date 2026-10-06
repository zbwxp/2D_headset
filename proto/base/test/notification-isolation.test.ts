// Notification isolation (dot's review of 8875a57): onWarning runs once per warning, only after the
// operation's state is final, and nothing it does can change commit, rollback or cleanup.
import { react } from '@tldraw/state'
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'

const cmd: Command = { type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 10, y: 5 } }
const doc = (e: Editor) => JSON.stringify(e.reader.serialize('document'))

function watch(e: Editor, what: 'doc' | 'history') {
  let armed = false
  const stop = react('throwing subscriber', () => {
    if (what === 'doc') e.reader.allRecords()
    else void e.history
    if (armed) throw new Error('observer failed')
  })
  armed = true
  return stop
}

describe('notification isolation', () => {
  for (const what of ['doc', 'history'] as const)
    it(`the handler sees the FINAL state (subscriber on ${what}): apply, batch, undo, redo`, () => {
      const e = new Editor(exampleRecords())
      const seen: string[] = []
      e.onWarning = () => {
        seen.push(`${e.history.undo.join(',')}|${e.history.redo.join(',')}|${e.revision}`)
        throw new Error('sink failed')
      }
      const stop = watch(e, what)
      try {
        e.apply(cmd)
        createApi(e).applyBatch('group', [cmd, cmd])
        e.undo()
        e.redo()
      } finally {
        stop()
      }
      expect(seen).toEqual(['moveAnchors||1', 'moveAnchors,group||2', 'moveAnchors|group|1', 'moveAnchors,group||2'])
    })

  it('a batch is one transaction: subscribers see no intermediate state', () => {
    const e = new Editor(exampleRecords())
    const points: unknown[] = []
    const stop = react('watch a2', () => points.push((e.reader.get(ids.C1) as any).anchors.a2.p))
    try {
      createApi(e).applyBatch('three', [cmd, cmd, cmd])
    } finally {
      stop()
    }
    expect(points).toEqual([{ x: 10, y: 60 }, { x: 40, y: 75 }])
  })

  it('a failing nested batch rolls back only its level; the outer batch commits one step', () => {
    const e = new Editor(exampleRecords())
    e.batch('outer', () => {
      e.apply(cmd)
      try {
        e.batch('inner', () => {
          e.apply(cmd)
          throw new Error('inner failed')
        })
      } catch {}
      e.apply(cmd)
    })
    expect((e.reader.get(ids.C1) as any).anchors.a2.p).toEqual({ x: 30, y: 70 })
    expect(e.history).toEqual({ undo: ['outer'], redo: [] })
    const after = doc(e)
    e.undo()
    expect((e.reader.get(ids.C1) as any).anchors.a2.p).toEqual({ x: 10, y: 60 })
    e.redo()
    expect(doc(e)).toBe(after)
  })
})
