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
  // KF-5 (connected ends computed through different key sets differed in the last float digit between keys; gate
  // properties-19, 2026-10-07, seed -457595632) — FIXED: setPoseKey gives every curve joined to the keyed one (with a
  // track) the same key yaws; now test/pose-connections.test.ts 'KF-5'.
  it.todo('(no known failure open)')
})
