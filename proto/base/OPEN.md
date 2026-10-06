# Open items — proto/base

Status words: **verified** = passed dot's independent re-review at the named commit; **implemented** =
done and tested by Claude only; **open** = not done. Keep claims scoped to what was verified.

## Stage conclusion (dot, 2026-10-06, re-review of 6cbdfed)

Known state-corruption issues (relation rules, locks, observer/handler failures, rollback and history
consistency) are fixed and **verified** within the reviewed scope. The base as a whole and the
recording capability are **not accepted**.

## Open

1. **Unified result contract — implemented, awaiting dot's re-review.** `api.applyBatch` returns
   the whole batch's `{ ok, written, revision, results | error+failedAt, warnings? }` (results only
   when the batch committed); `api.undo`/`api.redo` return `{ ok, written, revision, warnings?,
   error? }`. `Editor.undo/redo/batch` keep their UI-convenience signatures.
2. **fb3b84a and the result-contract commit not yet re-reviewed.** It restructures batch (one transaction, cleanup in `finally`,
   single `report`) after the verified 6cbdfed. dot agreed to the two `[CHANGED]` assertions.
3. **UI not re-run independently since 8875a57** (dot's 14 browser checks passed there).
4. Not covered by tests yet: fill picking and save/reopen through the UI, containers nested deeper
   than 2 in UI flows, V transforms with locked children, undo granularity across layers, delete
   commands (incoming-relation checks will then need a reverse index or declared relations).
5. Product capability not started on this base: snapshots with identity/topology correspondence,
   full recording and in-between angle inference, mirror seams, curved deformation domains,
   continuous visibility and stroke ends, three-way jaw route switching by angle, onion-skin
   performance on a real face (renderer rewrite paused until the base is accepted).
