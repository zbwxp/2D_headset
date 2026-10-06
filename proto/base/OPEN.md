# Open items — proto/base

Status words: **verified** = passed dot's independent re-review at the named commit; **implemented** =
done and tested by Claude only; **open** = not done. Keep claims scoped to what was verified.

## Stage conclusion (dot, 2026-10-06, independent re-review of 3f697ca)

**The limited editing-transaction sample may proceed to the next validation stage.** Verified at
`3f697ca` (first run, normal and production mode): 84/84 unit tests, 14/14 browser checks, dot's 8
independent whole-operation result/state checks, typecheck. Within scope: relation rules, locks,
batch cancel/failure, net-zero batches, undo/redo, observer and warning-handler failures, cleanup
and follow-up edits, the unified result contract (`api.applyBatch` / `api.undo` / `api.redo`).
Report: `/Users/bowen/Documents/Codex/2026-10-06/task/evidence-3f697ca/REVIEW.md` (on bowen's Mac).

**Not accepted:** the base as a whole, recording, snapshots, real-face onion-skin performance,
renderer changes, the product. Passing this sample does not prove the architecture; each new
capability is verified again against the same rules.

## Next stage (agreed with dot; not started)

Goal: prove that unrelated content is not recomputed. "Only what changed" means: the changed objects
and the objects that really depend on them (e.g. a jaw point → its connections, fills, references
and affected angles); unrelated layers are not touched. Acceptance criteria (dot):

1. **Dependency indexes**: dragging does not rescan the whole project; indexes update only when a
   relation changes.
2. **Cache invalidation**: caches notice changes of geometry, connections and angle rules; undo and
   reopen never return stale results; onion skin keeps updating during a drag.
3. **Counting and comparison**: every operation is run both incrementally and as a full recompute and
   compared; with many unrelated lines added, the counts of visits / evaluations / rebuilds and the
   time grow mainly with the affected range.

Then, verified together with a few recorded angles: incremental = full recompute. Only after that,
decide from measurements how the drawing layer changes (no renderer rewrite is presumed).

### Step 1 — indexes, per-record caches, counters (implemented, not yet reviewed by dot)

- `src/indexes.ts`: connections by anchor, children by parent, fills by curve, references by source;
  incremental from the store's change history (port of tldraw `StoreQueries.index`, public APIs only).
  Used by `linkedAnchors`, container transforms and the incoming-relation check (no type scans left
  on the edit path).
- `src/derived.ts`: one cached result per curve, per fill, per (reference × source curve) —
  tldraw `createComputedCache` / `computed`; bounded `KeyedComputedCache` (capacity, LRU).
- `src/counters.ts`: plans, index builds/steps/queries, curve/fill/instance evaluations, assembled
  items, full evaluations, rebuilt canvas objects.
- Tests: `test/derived.test.ts` (undo/redo, reopen = new store, same id → new record, flag and
  relation changes, first build vs continuous drag), `test/scaling.test.ts`, property I11 (incremental
  = full recompute every step) and I12 (every index answer = brute-force scan) — mutations M13–M17
  caught.
- Measured (`test/scaling.test.ts`, synthetic, node, informational): a continuous drag of one free
  anchor costs the same with 121 and 3000 curves — 1 plan, 1 index query, 1 curve evaluation, 0 index
  rebuilds. Per-item reader ≈ 0.04–0.08 ms per drag. A WHOLE-LIST reader (what the current Fabric view
  does) still re-collects every item: 3000 curves ≈ 12.4 ms per drag vs ≈ 14.5 ms for the full
  uncached evaluation — so the drawing layer only benefits if it consumes changed items.
- **Batch-edit** full-change workload (`test/full-change.test.ts`: a whole-scene transform through the
  write entry every frame — NOT runtime playback, which is an evaluation input and never goes through
  edit history; medians, node, informational; heap growth includes undo history, no forced GC): 3000 curves — edit through the
  write entry ≈ 53.6 ms, cached evaluation ≈ 19.4 ms, uncached full recompute ≈ 13.3 ms; 1000 —
  19.1 / 6.0 / 4.2 ms. When everything changes, the per-item caches cost ≈1.5× a full recompute, and
  the edit path (plan, validation, history) dominates.
- Still to add (dot): a **parameter-driven** full-evaluation workload (angle / expression as inputs,
  no edits), with memory reported separately. Runtime caching is not decided from the batch-edit numbers.
- Gaps: no current command changes an index key by UPDATE (parent, connection ends, fill boundary),
  so that index path is untested by commands; the drag preview (`withPuts`) still copies the whole
  store per move; onion skin / angle caching not started (pose track is not in the store yet).

## Open

1. Not covered by tests yet: fill picking and save/reopen through the UI (the slice has no save/open
   buttons), containers nested deeper than 2 in UI flows, V transforms with locked children, undo
   granularity across layers, delete commands (incoming-relation checks will then need a reverse
   index or declared relations), arbitrary observer re-entrancy / callback side effects.
2. Browser evidence is Playwright Chromium only (no Safari/Firefox, no deployed build).
3. Product capability not started on this base: snapshots with identity/topology correspondence,
   full recording and in-between angle inference, mirror seams, curved deformation domains,
   continuous visibility and stroke ends, three-way jaw route switching by angle, onion-skin
   performance on a real face.

## Closed in this stage (verified at 3f697ca)

- Unified result contract for `applyBatch` / `undo` / `redo` (was open after 6cbdfed).
- Batch as one transaction with cleanup in `finally` and a single guarded `report` (fb3b84a).
- dot's two `[CHANGED]` test assertions (agreed).
