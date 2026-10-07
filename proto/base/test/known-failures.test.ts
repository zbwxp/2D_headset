// KNOWN FAILURES — real, unfixed problems kept as executable reproductions (dot). Each uses `it.fails`:
// it passes ONLY while the problem still reproduces, and turns red the moment the problem is fixed, so
// the entry must then be moved to a normal test. scripts/gate.sh lists these separately in its report.
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { Derived } from '../src/derived'
import { createDocStore, Reference, type FillRecord } from '../src/schema'
import { hitTest } from '../src/evaluate'
import { paintCases } from '../src/paintCases'

describe('KNOWN FAILURE', () => {
  // KF-1 (preview / commit ids of a create) — FIXED in stage 0 through prepared operations with an explicit
  // identity (dot's fix direction); now test/stage0-write-entry.test.ts block 3. Plain `preview` and `apply`
  // stay independent on purpose (two independent creates never share an id).

  // KF-2 (connected ends separated under a pose key) — FIXED with option A; now test/pose-connections.test.ts

  // KF-3 (base reference membership was lazy: entries pruned only by a whole-table read) — FIXED by the membership
  // table `src/instanceLifecycle.ts` wired into `Derived` (doc 18 §26.1; experiment 15deba2 → ff25632, reviewed by
  // dot); dot's original scenario is now a normal test in test/kf3-lifecycle.test.ts ('product Derived').

  // KF-4 (dot, review of S1: V-mode picking ignored paint order — segments always beat fills) — FIXED in the editor
  // skeleton block 1: picking walks the paint list front to back (`hitStack`); now e2e/selection.spec.ts. Note: this
  // reproduction ran in node, where the fill test has no canvas and throws — it "reproduced" by throwing, not by
  // picking the line; the replacement runs in Chromium.
  // KF-5 (gate properties-19, 2026-10-07, seed -457595632 path "144:8:6:6:6:6:6:7:8:8:8:9:9:10:7:9"; reproduces on
  // caf3cde and later): connected ends separate in the LAST float digit between keys. C1's a1 is connected to C2's
  // b3 (J0). Keys on C1 at -90 / +90 reach C2 too (same offsets, same yaws); a key on C2 alone at yaw 0 stores C2's
  // interpolated offset there (exactly 3.5) but gives C1 no key at 0. At yaw 12.5 the same logical point is then
  // computed by two different interpolations — C1: 7 + (0 − 7)·(102.5 / 180), C2: 3.5 + (0 − 3.5)·(12.5 / 90) —
  // equal in exact arithmetic, 3.013888888888889 vs 3.0138888888888893 in floats. The relation check is exact only
  // AT key yaws (model.recordProblems), so the write is accepted. Not a tolerance question (dot 1791362280): the fix
  // must make a logically single point evaluate one way.
  it.fails('KF-5 connected ends computed by different key sets differ between keys (float)', () => {
    const e = new Editor(exampleRecords())
    e.batch('kf5', () => {
      e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
      e.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a1: { x: 0, y: 0 } } })
      e.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: -90, offsets: { a1: { x: 0, y: 7 } } })
    })
    expect(e.apply({ type: 'setPoseKey', curveId: ids.C2, yaw: 0, offsets: {} }).ok).toBe(true)
    const at = e.derived.atYaw(12.5)
    const p = (curveId: string, anchorId: string) => at.curves.find((c) => c.address === curveId)!.anchors[anchorId].p
    const j0 = e.reader.allRecords().find((r) => r.id === 'connection:J0') as any
    const ps = j0.ends.map((end: any) => p(end.curveId, end.anchorId))
    expect(ps[1]).toEqual(ps[0])
  })
})
