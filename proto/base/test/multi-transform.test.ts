// dot's UI finding as a core test: one selection transform over connected containers moves each anchor once.
import { expect, it } from 'vitest'
import { createApi } from '../src/api'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import type { CurveRecord } from '../src/schema'

it('transformContainers(L1, L2, +10/+5) moves the shared chin point once: (60,100) → (70,105)', () => {
  const e = new Editor(exampleRecords())
  const a = createApi(e)
  a.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
  const r = a.apply({ type: 'transformContainers', containerIds: [ids.L1, ids.L2], matrix: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 5 } })
  expect(r.ok && r.written).toBe(true)
  expect((e.reader.get(ids.C1) as CurveRecord).anchors.a3.p).toEqual({ x: 70, y: 105 })
  expect((e.reader.get(ids.C2) as CurveRecord).anchors.b3.p).toEqual({ x: 70, y: 105 })
  expect(e.history.undo).toEqual(['setContainerFlags', 'transformContainers'])
})
