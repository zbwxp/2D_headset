// The same author data through the maker (Editor + cached Derived + drag preview) and through the
// read-only entry (runtime.ts: saved records + parameters, no editor) must give the same geometry AND
// appearance; playing must not change author state or undo history (dot; docs 16 §1).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { evaluateSaved } from '../src/runtime'

const YAWS = [-90, -30, 0, 22.5, 60, 90]
function authored() {
  const e = new Editor(exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r)))
  const api = createApi(e)
  api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: -90, offsets: { a1: { x: -8, y: 0 }, a2: { x: -12, y: 2 }, a3: { x: -6, y: 0 } } })
  api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a1: { x: 8, y: 0 }, a2: { x: 12, y: -2 }, a3: { x: 6, y: 0 } } })
  api.apply({ type: 'setPoseKey', curveId: ids.C2, yaw: 90, offsets: { b3: { x: 6, y: 0 }, b2: { x: 4, y: 1 } } })
  api.apply({ type: 'setPoseKey', curveId: ids.E1, yaw: 90, offsets: { e1: { x: 5, y: 1 } } })
  api.apply({ type: 'setContainerFlags', containerId: ids.L3, visible: false }) // appearance: hidden source, visible reference
  return { e, api }
}
const file = (e: Editor) => JSON.parse(JSON.stringify(e.save())) // what an exported file carries
const state = (e: Editor) => ({ doc: JSON.stringify(e.reader.serialize('document')), hist: JSON.stringify(e.history), rev: e.revision, saved: e.savedRevision })

describe('maker and read-only entry agree', () => {
  it('base and every yaw: geometry and appearance (stroke, colour, visibility, lock, depth)', () => {
    const { e } = authored()
    const saved = file(e)
    expect(evaluateSaved(saved)).toEqual(e.derived.evaluated())
    for (const yaw of YAWS) expect(evaluateSaved(saved, { yaw }), `yaw ${yaw}`).toEqual(e.derived.atYaw(yaw))
  })

  it('what a drag preview showed at each yaw is what the runtime computes from the saved result', () => {
    const { e, api } = authored()
    const cmds: Command[] = [
      { type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a3' }], delta: { x: 2, y: 3 } }, // connected to C2.b3, fill boundary
      { type: 'transformContainer', containerId: ids.L3, matrix: { a: 1, b: 0, c: 0, d: 1, e: -4, f: 1 } }, // reference source
    ]
    for (const cmd of cmds) {
      const pv = e.preview(cmd)
      if (!pv.ok) throw new Error(pv.error.message)
      const ch = e.derived.previewChanges(pv.puts)
      const shown = YAWS.map((y) => e.derived.previewAtYaw(pv.puts, y, ch))
      const base = e.derived.preview(pv.puts, ch)
      api.apply(cmd)
      const saved = file(e)
      expect(evaluateSaved(saved)).toEqual(base)
      YAWS.forEach((yaw, i) => expect(evaluateSaved(saved, { yaw }), `${cmd.type} @${yaw}`).toEqual(shown[i]))
    }
  })

  it('playing (maker cache, drag preview at yaws, runtime entry) changes no author state or history', () => {
    const { e } = authored()
    const before = state(e)
    const saved = file(e)
    const afterSave = state(e) // save itself only moves savedRevision
    for (let y = -90; y <= 90; y += 7.5) {
      e.derived.atYaw(y)
      evaluateSaved(saved, { yaw: y })
      const pv = e.preview({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 1, y: 0 } })
      if (pv.ok) e.derived.previewAtYaw(pv.puts, y)
    }
    expect(state(e)).toEqual(afterSave)
    expect(afterSave.doc).toBe(before.doc)
    expect(afterSave.hist).toBe(before.hist)
  })

  it('the read-only entry rejects invalid data explicitly', () => {
    const { e } = authored()
    const bad = file(e)
    bad.store[ids.R1].sourceId = ids.C1
    expect(() => evaluateSaved(bad)).toThrow(/invalid document/)
  })

  // Scope (dot): this checks the FIRST-level imports only — no editor, commands, derived cache, view
  // or API. It does NOT mean "no store library": schema.ts builds its record types with @tldraw/store,
  // so a bundle of runtime.ts still contains store/state modules (dot measured 16 + 15). Open item.
  it('the read-only entry imports no editor, command, cache, view or API module (first level only)', () => {
    const src = readFileSync(new URL('../src/runtime.ts', import.meta.url), 'utf8')
    const imports = [...src.matchAll(/from '(\.[^']+)'/g)].map((m) => m[1])
    expect(imports.sort()).toEqual(['./evaluate', './model', './pose', './schema'])
    for (const banned of ['editor', 'commands', 'derived', 'view', 'api']) expect(imports.join(' ')).not.toContain(banned)
  })
})
