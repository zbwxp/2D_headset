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

  // KF-4 (dot, review of S1): V-mode picking ignores paint order — segments always beat fills — so a line
  // completely hidden under a fill in front is still picked. Picking must agree with what is visible
  // (principle 4); picking hidden lines, if wanted, is an explicit mode. Fix after S2.
  it.fails('KF-4 V-mode picking selects a line fully hidden under a fill in front', () => {
    const e = new Editor(paintCases['P2-fill-layer-in-front'].records())
    const hit = hitTest(e.derived.evaluated(), { x: 40, y: 30 }, { mode: 'V', tolerance: 2 })
    expect(hit).toMatchObject({ kind: 'fill', address: 'fill:F' })
  })
})
