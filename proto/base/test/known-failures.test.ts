// KNOWN FAILURES — real, unfixed problems kept as executable reproductions (dot). Each uses `it.fails`:
// it passes ONLY while the problem still reproduces, and turns red the moment the problem is fixed, so
// the entry must then be moved to a normal test. scripts/gate.sh lists these separately in its report.
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import type { FillRecord } from '../src/schema'
import { onionYaws } from '../src/synthetic'

describe('KNOWN FAILURE', () => {
  // KF-1 (found by property I13, 8373b9b): a create without an explicit id gets a fresh random id on
  // every plan, so the previewed record and the committed record have DIFFERENT ids. API callers who
  // preview then apply see an id that never exists. Fix direction (dot): a prepared create reuses its
  // allocated identity and the commit re-validates it — not by rewriting ids when comparing.
  it.fails('KF-1 preview and commit of a create give the same new id', () => {
    const e = new Editor(exampleRecords())
    const boundary = (exampleRecords().find((r) => r.id === ids.F) as FillRecord).boundary
    const cmd: Command = { type: 'createFill', parentId: ids.L1, boundary }
    const pv = e.preview(cmd)
    expect(pv.ok).toBe(true)
    const previewed = pv.ok ? pv.affected[0] : undefined
    const r = e.apply(cmd)
    expect(r.ok && r.written).toBe(true)
    const committed = r.ok ? r.affected[0] : undefined
    expect(committed).toBe(previewed) // fails today: two different fresh ids
  })

  // KF-2 (found by dot, review of 2a48719): a pose key on ONE end of a connection is accepted and the
  // ends separate at that yaw (C1.a3 vs C2.b3), so the fill boundary is open there. Design not chosen
  // yet (dot): the edit may be REJECTED (nothing written), or the ends must stay JOINED at every yaw —
  // never silently patched by the fill. This check accepts either outcome.
  it.fails('KF-2 a pose key never leaves connected ends apart (rejected, or joined at every yaw)', () => {
    const e = new Editor(exampleRecords())
    const before = JSON.stringify(e.reader.serialize('document'))
    const r = e.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a3: { x: 10, y: 5 } } })
    if (!r.ok) {
      expect(JSON.stringify(e.reader.serialize('document'))).toBe(before)
      return
    }
    for (const y of onionYaws(19)) {
      const ev = e.derived.atYaw(y)
      const a = ev.curves.find((c) => c.address === ids.C1)!.anchors.a3.p
      const b = ev.curves.find((c) => c.address === ids.C2)!.anchors.b3.p
      expect(a, `yaw ${y}`).toEqual(b)
    }
  })
})
