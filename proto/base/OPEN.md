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
- **Reviewed by dot at 375f9e5**: index/cache correctness passed (92 tests per mode + dot's
  independent index-key migration, rollback, same-id reuse, multi-level visibility, eviction past
  10,000). Interaction performance NOT accepted: preview copied the store (272 → 6,030 rows per move
  at 121 → 3000 curves, uncounted), the view and hit tests used the uncached full evaluation, and the
  whole-list sort re-read records in its comparator.

### Step 2 — real drag preview without a store copy (implemented, not yet reviewed by dot)

- `Derived.previewChanges(puts)`: re-evaluates only the changed curves, the fills reading them (fill
  index), the reference instances showing them (references of each container in the curve's chain)
  and all instances of a changed reference, through an overlay `get` (`overlayReader`); everything
  else stays cached. Falls back (counted) to a full overlay evaluation if a plan could change paint
  order or touches other record kinds. Item evaluation is ONE set of functions shared by caches and
  preview. `Derived.preview(puts)` merges into the cached list for the current whole-list view.
- FabricView: drag preview, hit tests and default render use `editor.derived`; `withPuts` (store copy)
  is no longer on the drag path and is counted (`snapshotRows`) where still used (bench, breakdown).
- Whole-list sort: each item's order key computed once (decorate-sort), parents looked up once.
- Tests: `test/preview.test.ts` (8 drag kinds incl. connected anchors, fills, overrides, reference
  sources, V moves of one/two containers: preview == full recompute after commit; cancel and rejected
  plans change nothing; container plan → counted fallback, still equal; 121 vs 3000 curves: identical
  per-move counts, 0 snapshot rows), property I13 (preview == full recompute after commit, every
  apply), `e2e/preview-counts.spec.ts` (real mouse drag in Chromium: 8 previews, 0 snapshot rows,
  0 full evaluations during the drag, 0 fallbacks). Mutations M18–M20 caught.
- **Reviewed by dot at 8373b9b**: drag scope passed (104 tests per mode, 15 browser checks, dot's
  independent preview checks; no store copy during drags, confirmed with Store method spies). Found:
  a reference `sourceId` change kept the old instances in `Derived.preview` (no current command does
  this). Fixed after review: the fast path is now an ALLOW-list of geometry/appearance fields
  (curve: name, tags, anchors, segments with unchanged ids, closed, stroke; reference: name, tags,
  transform, overrides) — anything else falls back. `test/preview-relations.test.ts` (dot's case +
  random relationship-field replacements vs an independently built document); M21–M22 caught.
- Still full per render (drawing layer, not changed by design): the view assembles the whole preview
  list (`previewItems` = list length per move) and rebuilds every canvas object (`canvasObjects`).
- Found by I13: a plan that CREATES a record without an explicit id gets a fresh random id per plan,
  so preview and commit ids differ (and equal-key paint order among such items follows the random
  ids). Not on the drag path; matters for API callers who preview then apply. **Open contract
  problem** (dot): property I13 does not compare creating plans at all rather than masking the
  difference with an id-mapping or order-insensitive comparison. Reproduced by **KF-1** in `test/known-failures.test.ts`
  (`it.fails`: green only while the bug reproduces; listed separately by `gate.sh`). Fix direction
  (dot): a prepared create reuses its allocated identity and the commit re-validates it.
- Gaps: no current command changes an index key by UPDATE (parent, connection ends, fill boundary),
  so that index path is untested by commands; the drag preview (`withPuts`) still copies the whole
  store per move; onion skin / angle caching not started (pose track is not in the store yet).

### Step 3 — head-turn forms in the document, bounded angle caches (implemented, not yet reviewed by dot)

- `PoseRecord` (one per curve, id derived from the curve id): keys `{ yaw, offsets }`, interpolated
  per curve; edited with `setPoseKey` through the write entry (undoable; lock = the curve's layer;
  validated; relation rule: offsets name existing anchors). The old global `PoseTrack` is gone —
  synthetic data, bench, view onion and tests all use pose records (one system, not two).
- Playing an angle is an evaluation input: `Derived.atYaw(yaw)`, `curveAt`, `fillAt` — bounded
  LRU caches (`yawCapacity`, `yawListCapacity`; evictions counted); each entry reads only its base
  item and its curve's pose. `previewAtYaw(puts, yaw, ch)` re-does only the plan's changed items at
  that yaw; the view computes the plan's changes ONCE per move and shares them across onion yaws.
  `pose.evaluateAtYaw` is the uncached full reference.
- Stroke width is never changed by a form (16 §3.0), tested at every yaw. Shape vs stroke drawing
  separation (dot) is a requirement for the drawing layer; not implemented there yet.
- Generic fix found on the way: `writeGuard` skipped the lock check for CREATED records (createFill
  had its own check); creates are now lock-checked generically (a pose cannot be created in a
  locked layer).
- Tests: `test/yaw.test.ts` (equality with the full recompute after edits / pose edits / undo /
  redo / reopen; same pose id re-created after undo; playing writes nothing; stroke width; 1000-angle
  sweep with capacity 50 never exceeds it and stays exact; drag preview at yaws == full after
  commit), `test/pose.test.ts` (forms, 0° form, base edits propagate, pose keys are author edits),
  property I14 (cached angle evaluation == full at 4 yaws, every step; generator now edits poses).
  Mutations M23–M25 caught.
- Measured (node, synthetic, informational):
  - maker onion (19 yaws), drag one free anchor: 19 curve-at-yaw evaluations + 1 curve evaluation
    per drag, identical for 121 and 3000 curves (≈0.09–0.14 ms per drag, per-item consumer).
  - runtime, parameter-driven sweep over 60 NEW angles (every curve changes every frame, no edits):
    3000 curves — cached path ≈10.8 ms/frame on first visit vs ≈3.7 ms uncached; replaying cached
    angles ≈0; heap growth with a large cache 89–133 MB (noisy, no forced GC). 1000 curves — 2.7 vs
    1.2 ms. **For full-change playback the per-item caches cost ~3× a plain recompute and a lot of
    memory**: runtime caching must be decided from such numbers (16 §3), not assumed.

## Scenario E experiments — gaps (dot's review of ebb7ff8; experiments closed, not extended)

`src/experiments/scenarioE*.ts` are framework tests only. They do **not** verify the common
evaluation interface. Registered gaps:

- **Bug (confirmed by dot, not fixed):** `closePresetTarget` always applies the turn to its preset
  line, so in order O2 (close → turn) the target is turned twice. Closure metrics still read 0 — the
  checks test closure, not world position. O2 preset-target results at non-zero angles are invalid.
- Declared reads (`part:turn`, `rule:close`, `rule:surprise`) are never actually read; the
  "declared = actual reads" check covers character keys only. `writesTo` is metadata — no writer,
  invalidation or ownership enforcement.
- `generatedTarget` is a current-shape rule (midline of the current lids), not a character-data
  target. T1 rebuilds from PART + character data and ignores its input (a named baseline only).
- Surprise compared at 0° only; the "30° turn" is an affine squeeze + 10° rotation + shift, not a 3D
  yaw, perspective or occlusion. "wide/narrow" vary middle anchors only; one topology in ebb7ff8.
- Metrics are sampled (129 points per lid): maxGap is not an analytic maximum; crossings miss
  tangencies, collinear overlap, near-corner and single-lid self-intersections; area is not
  transform-invariant; strokeOverlap is a one-sided proximity proxy, not rendered coverage. No
  rendering, so nothing about stroke darkening/thickening is established.
- No costs measured. Default + reusable specialist family is not demonstrated (8570f8f's range
  experiment is not reviewed and will not be extended).

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
