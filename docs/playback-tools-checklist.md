# Editing tools at a correction pose: checklist before any code, for dot's review

Asked by bowen 1791980073 (at yaw −60: move the whole eye, maybe squeeze it sideways; box select, scaling, 四角 / 曲边 are missing, the A / V buttons are grey). Proposed in 1791980144 (approved by bowen 1791980604): the editing tools as they are, on a working copy of the drawing at this pose, each release written back as one correction.

**Builds on:** `docs/playback-edit-checklist.md`, accepted by dot 1791979065 at cb26949.
- Corrections are only at yaw ±30 / ±60 × pitch 0 / ±45 (bowen 1791976386, 1791976935).
- Views are edited directly.
- Elsewhere playback is preview only.

## 1. The working copy
- **On entering a correction pose** (and after every write to the drawing while there), the bench builds a copy:
  - `open(save(core))`, then in its front view every point moved to its position at the pose and every handle set to its vector at the pose (`move`, `moveHandle`);
  - its settle may move a smooth join's handles slightly, so the copy is what the tools act on, not a claim to equal the pose.
- **The canvas at a correction pose** draws the copy, so the selection, its box, the handles and the ghosts are the editing ones.
- **The copy is never saved, autosaved or undone.** It is dropped when:
  - the pose changes;
  - playback is left;
  - the drawing changes.

## 2. The tools on it
- **Interaction runs on the copy** at a correction pose (`core: () => copy`, view `view:0,0`):
  - V / A picking, the box, Shift adding, the arrows, drag, the selection box's scale and rotate, 四角 / 曲边, handle follow — all as in editing;
  - the left panel's tool buttons for these (V, A, 四角/曲边, the handle-follow switch) are enabled in playback.
- **Only these operations reach the copy:** `select`, `selectGroup`, `translate`, `rotate`, `scale`, `transform`, `move`, `moveHandle`.
  - Anything else (a pen, a split, a join, delete, paste…) is refused, and the status line names it.
- **The selection is the copy's:** it is not written to the drawing.

## 3. Each write → one correction
- **When an edit commits on the copy**, the bench reads the copy before and after it and computes the deltas:
  - every point whose position changed: `posed + (after − before)`;
  - every handle whose vector changed: `posed vector + (after − before)`.
- **These targets become one `correct(pose, { points, handles })` on the drawing**, through the logged wrapper (one undo step after leaving playback, as today).
- **A selection-only edit** writes nothing to the drawing.
- **If core refuses the correction**, the copy is rebuilt from the drawing (the edit is dropped). The refusal shows in the status line, as a playback drag's does.
- **「刚才改了什么」 shows the correction**, as today (fed from the wrapper).

## 4. Unchanged
- The A / V single drags of cb26949 are replaced by the editing ones at a correction pose: the same picks, plus selection.
- Views and in-between poses behave as before.

## 5. Evidence
- **bench at yaw −60:**
  - a box selection of an eye's curves;
  - a drag of the selection: one correct with all their points;
  - the box's side handle squeezing it sideways: one correct, points and handles;
  - 四角 on it: one correct;
  - the drawing's other poses: the corrections only at their knots;
  - a pen key does nothing; a refused correction rebuilds the copy and writes nothing;
  - nothing in the drawing's selection changes.
- **A screenshot** of 211.json at −60 with the eye selected and squeezed.

## 6. Not in this round
- Corrections inside a cell (set aside, bowen 1791976739).
- Undo inside playback.
