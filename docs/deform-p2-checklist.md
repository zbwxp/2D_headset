# 四角 / 曲边 deform — package 2: the edit (checklist before any code, for dot's review)

Package 1 (deform/, accepted by dot 1791892496 at 4443291) gives the field and the one-cubic fit. Package 2 turns them into one edit of the drawing in the current view, with nothing new in core. Package 3 (the frame, its handles, the gesture) follows.

## 1. The pieces
- **`deformPlan(lines, field)` in `deform/`** (plain data, no imports): `lines` = `{ id, a, b, curve }[]` (the lines' ids, their end point ids, their cubics as drawn in the view). For each line, `fitDeformedCubic(curve, field)`; out come
  - `points`: one target per end point id, `field.map(position)` — **a point shared by several given lines is mapped once**; every given line whose end is that point has its fitted end exactly there (the fit's end points are `field.map` of the same position — checked, an error if not);
  - `handles`: per line and end, the fitted handle as an offset from its end point (`shape[1] − shape[0]`, `shape[2] − shape[3]`);
  - `maxError`: the largest of the lines' (package 1's sampled diagnostic, input units) — for package 3's readout.
- **`deformOp(lines, rect, quad, bend)` in `interaction/`**: reads the given lines' curves from the view's geometry, builds the field (`deformField`), the plan, and returns one `(e: Editor) => void` that writes `e.move(points)` then `e.moveHandle(line, end, offset)` for every handle. **The same function is what package 3 previews (`core.preview(view, op)`) and what it commits (`core.editIn(view, op)`)**, as select-transform does with its scale and rotate (dot 1791735216 §3) — the preview is the commit's own pipeline, so they cannot differ.
- Core: unchanged. `move` and `moveHandle` are declared edits of the edited view (src/document/effects.ts); no new operation, no effects row.

## 2. Rules (all from the existing move / handle edit; stated so the tests can hold them)
- **Which lines:** the ids given (package 3 passes the selected lines). Hidden lines in the list are deformed like the others (v103 did). An empty list or an unknown id: refused before anything is written.
- **One edit, one undo step**, in the current view only; the other views, the baseline and the shared structure are untouched (no line, point or join is added or removed).
- **Shared end points:** between two given lines — one mapped position, both lines' fitted ends on it. Between a given line and a line not given — the point moves (it is the given line's end); the other line keeps its own handle offsets and its far end, so its shape follows its moved end, as after any move of that point.
- **Handle directions:** each given line's handles are its fit's (tangent rays from the field's derivative). At a smooth join with **both** lines given, the two tangents stay collinear: the field's derivative is linear in the direction, so opposite handles stay opposite. With only one line given, the join's spring settles at commit as after any handle edit — and the preview shows exactly that.
- **Locks:** a locked line among the given ones, or a locked line that a moved point would change, is refused by the commit's lock check; nothing changes (the preview reports the same refusal).
- **Links:** a point of another layer linked to a moved point follows it in this view, as after a move.
- **Mirror links (front):** the commit's mirror settling acts as after any move or handle edit (partners mirrored). Not chased further in this package; recorded.
- **Auto-bind:** a moved end landing on another point of its layer binds at commit, as after a move — in the preview too.

## 3. Tests (interaction/test, a real Core; plus `deformPlan` in deform/test)
1. Two lines sharing a point, both given, a perspective quad: the shared point at `map(p)` in the result; each line's handles equal its fit's; an affine quad → control points mapped exactly.
2. A curved field: each line's committed curve equals `fitDeformedCubic(curve, field).shape` (lines with no constraint acting).
3. Preview = commit: `core.preview(view, op)`'s snapshot equals the snapshot after `core.editIn(view, op)`; one undo step restores the drawing; the other views unchanged.
4. A line not given sharing a point: its far end and its handle offsets unchanged, the shared point moved.
5. Smooth join, both sides given: still collinear after the commit.
6. A locked line given, or locked and sharing a moved point: refused, nothing changes; the preview refused alike.
7. A linked point in another layer follows.
8. Empty list / unknown id: refused.

## 4. Not in package 2
The frame, its corners, edge handles and midpoints, the gesture, reset, the readout — package 3. Display intervals riding on t (`sourceParameter`) — later.
