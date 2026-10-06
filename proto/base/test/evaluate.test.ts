// Step-2 acceptance: one evaluated geometry for stroke / fill / hit-test / export; reference expansion.
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import { Editor } from '../src/editor'
import { cubicsToPath, evaluate, hitTest } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'

function setup() {
  const editor = new Editor(exampleRecords())
  return { editor, api: createApi(editor) }
}

describe('one evaluated geometry', () => {
  it('fill boundary reuses the exact stroke segments, before and after an edit', () => {
    const { editor, api } = setup()
    const check = () => {
      const ev = evaluate(editor.reader)
      const c1 = ev.curves.find((c) => c.address === ids.C1)!
      const fill = ev.fills.find((f) => f.address === ids.F)!
      expect(fill.cubics[1]).toEqual(c1.segments.find((s) => s.id === 's2')!.cubic)
      const c2 = ev.curves.find((c) => c.address === ids.C2)!
      const s4 = c2.segments.find((s) => s.id === 's4')!.cubic
      expect(fill.cubics[2]).toEqual([s4[3], s4[2], s4[1], s4[0]]) // reversed, same points
    }
    check()
    api.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    api.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a3' }], delta: { x: 7, y: 3 } })
    check()
    // the fill boundary closes on the moved chin point: s2 ends where reversed s4 starts
    const fill = evaluate(editor.reader).fills[0]
    expect(fill.cubics[1][3]).toEqual(fill.cubics[2][0])
    expect(fill.cubics[1][3]).toEqual({ x: 67, y: 103 })
  })

  it('export path and display path come from the same function', () => {
    const { editor } = setup()
    const fill = evaluate(editor.reader).fills[0]
    expect(cubicsToPath(fill.cubics, true)).toMatch(/^M 0 0 C .* Z$/)
  })
})

describe('reference expansion', () => {
  it('R1 places a mirrored copy of L3 with its own addresses; overrides apply only there', () => {
    const { editor, api } = setup()
    let ev = evaluate(editor.reader)
    const placed = ev.curves.find((c) => c.address === `${ids.R1}/${ids.E1}`)!
    expect(placed.anchors.e1.p).toEqual({ x: 80, y: 20 })
    api.apply({ type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.E1, anchorId: 'e2' }, delta: { x: 0, y: 4 } })
    ev = evaluate(editor.reader)
    expect(ev.curves.find((c) => c.address === `${ids.R1}/${ids.E1}`)!.anchors.e2.p).toEqual({ x: 90, y: 54 })
    expect(ev.curves.find((c) => c.address === ids.E1)!.anchors.e2.p).toEqual({ x: -30, y: 50 })
  })
})

describe('hit test on the evaluated geometry', () => {
  it('A mode picks anchor, then handle, then segment; locked layer is not hittable', () => {
    const { editor } = setup()
    const ev = evaluate(editor.reader)
    expect(hitTest(ev, { x: 11, y: 61 }, { mode: 'A', tolerance: 3 })).toMatchObject({ kind: 'anchor', address: `${ids.C1}#a2` })
    expect(hitTest(ev, { x: 10, y: 79 }, { mode: 'A', tolerance: 3 })).toMatchObject({ kind: 'handle', address: `${ids.C1}#a2.out` })
    expect(hitTest(ev, { x: 80, y: 51 }, { mode: 'A', tolerance: 3 })).toBeNull() // b2 is in locked L2
  })

  it('V mode hits the fill interior once its layer is unlocked; mirrored reference is hittable by its own address', () => {
    const { editor, api } = setup()
    expect(hitTest(evaluate(editor.reader), { x: 40, y: 50 }, { mode: 'V', tolerance: 2 })).toBeNull()
    api.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    const ev = evaluate(editor.reader)
    // fill containment is the browser's native isPointInPath (same fill rule as the drawing): the
    // unlocked-fill hit is checked in e2e/hit.spec.ts; without a canvas it refuses instead of guessing
    expect(() => hitTest(ev, { x: 40, y: 50 }, { mode: 'V', tolerance: 2 })).toThrow(/native path test/)
    expect(hitTest(ev, { x: 80, y: 20 }, { mode: 'A', tolerance: 2 })).toMatchObject({ kind: 'anchor', address: `${ids.R1}/${ids.E1}#e1` })
  })
})
