# J1 — joins in the core: checklist before any code (for dot's review)

Principle: `docs/ink-joins-principle.md` §2 (6544641; dot 1791811126 cleared J1 — list and storage — to start). J1 changes the core's joins only; the ink (J2 / J3) and the bench panel (J1b) are later packages. Nothing in J1 changes what is drawn except through the archive migration (rows added to old files).

## 1. The 'bound' mode
- `JoinMode = 'bound' | 'smooth' | 'cusp' | 'arc'` (src/joins/index.ts:10) and every check of the mode list: `setJoin` (:63), `restore` (:322), document `join`, clipboard, interaction `Options.joinMode` (interaction/base.ts:11).
- No shape effect: derived reads only 'arc' (src/derived/index.ts:60); the smooth solve only 'smooth' (src/joins/index.ts:242). Links' own joins (src/links/index.ts:13) are not touched in J1.

## 2. Creation in the step that connects (principle §2.1)
- The network reports what an operation connected, without knowing joins: a new `Changes.connected: { point, lines: [Id, Id] }[]` (src/network/index.ts:75), pushed by
  - `addLine` (:781) — for each end given as an existing point id that carried exactly one line end before this line: `{ point, [that line, the new line] }` (the pen continuing from a free end, or ending on one);
  - `bind` (:876) — when `keep` and `remove` each carried exactly one line end before, and neither line collapsed: `{ keep, [line at keep, line from remove] }`;
  - `splitLine` (:839) — `{ mid, [first, second] }`.
- `joins.update` (called after every operation with that operation's changes, src/document/index.ts:927–930) adds a 'bound' row for each `connected` pair that has no row, **on top** of the point's list (§3), in the order reported.
- Nothing else creates a row: `insertLines` (paste) and `unbind` push no `connected`.

## 3. The join list (principle §2.2)
- The rows keep an explicit order — the stored array; a point's list = its rows in array order, top first. `sortRows` (src/joins/index.ts:35) is removed from every write; `restore` accepts the stored order (pairs still sorted within a row, no repeats) instead of requiring sorted rows.
- **New on top:** `setJoin` of a pair with no row inserts it before the point's first row; setting a pair that has a row changes its mode in place (its position stays — bowen asked new joins on top, not re-set ones; flagged for dot).
- **Reorder:** `orderJoins(point, keys)` — the point's rows in the given order (keys = row keys; must be exactly that point's rows); the document's `joinOrder(point, pairs)`; an edit like any other (undo, every view).
- **Reading:** `rowsAt(point)` returns the list top first (as stored); a new `governing(point, line)` = the topmost row at `point` containing `line`, or none.
- **The smooth solve does not depend on the list:** it iterates a sorted copy of the rows, so its result is the same whatever the order (the reason for the old canonical sort, src/joins/index.ts:35).

## 4. Bind keeps the removed point's rows (principle §2.1)
- In `update`, for each `merged {keep, remove}`: the rows at `remove` are re-pointed to `keep` and placed after the rows already at `keep`, before the dead-point filter drops what remained at `remove` (today they are dropped: :163–169, :189). Their per-view values (radius, zone) follow their new keys, as a split's do (:196–200).
- A row whose line collapsed is dropped (as today).

## 5. Per-view zone length (principle §2.4, §4)
- A slot 'zone' per shape layer under the row key, like 'radius': absent = automatic; a number = the manual length in that view. `setZoneHere(point, l1, l2, length | null)` writes the current view only; `JoinRow.zone?: number` in `rows` / `rowsAt`. Every place that moves, re-keys or drops 'radius' does the same for 'zone' (update, insert, removeJoin, setJoin's mode change).

## 6. Archive (principle §2.6)
- `VERSION = 7` (src/archive/index.ts:17), the list order and the 'zone' slots saved as stored.
- Opening version 6: after import, a 'bound' row at every point with exactly two line ends and no row (forks: none); version 5 converts through 6 as today, then the same. Gated on the version: a version 7 file is opened as stored. The header comment records the second approved exception (bowen 1791808493).

## 7. Flows to run before hand-in (tests: ordinary cases and everyday operations)
1. Pen: a chain of three segments → two 'bound' rows; continuing from a line's free end → a row; from a fork point → none; ending on another line's free end → a row.
2. Split → a row at the new point; split of a line in a bound chain → its old rows re-keyed to the pieces (as today) plus the new one.
3. Bind two free ends → a row; bind onto a point with two lines → no new row, the kept point's rows unchanged; bind of a point carrying a pair onto another → the pair moves, below the kept point's rows.
4. Unbind both lines of a pair → the row moves with them; unbind one → dropped; no row created.
5. Copy / paste a bound chain → rows copied in order; paste creates none.
6. setJoin on a fork: new pair on top; re-setting a pair's mode keeps its position; `orderJoins` reorders; `governing` follows the order; undo / redo restore order.
7. Every view: modes and order shared; zone set in one view leaves the others automatic.
8. Save / open: version 7 round trip keeps order and zones exactly; a version 6 file gains rows at two-line points only; a version 7 file with a two-line point and no row stays without one.
9. The smooth solve gives the same handles for two different list orders of the same rows.

## 8. Ledger
- docs/consolidation-ledger.md checked: row 9 (evaluate slot B — joins after the blend) and row 10 (`joins.EndStroke` type) touch joins; J1 changes neither end strokes nor playback blending, so neither is triggered. Any inelegance found in J1 is logged there with a trigger.
