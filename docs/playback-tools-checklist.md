# Batch tools at a correction pose: checklist before any code, for dot's review

**Ask** (bowen 1791980073): at yaw −60, move the whole eye and maybe squeeze it sideways. Box select, scaling and 四角 / 曲边 are missing in playback.

**Constraint** (bowen 1791980816, 1791980832): these tools are only batch processing of what exists. They change no framework and must not break anything.

**Dropped:** the working-copy design of 88b3362. dot 1791980825 showed that it would run the front view's mirror, merge and join rules on a copy. It was never committed.

**Builds on** `docs/playback-edit-checklist.md` (accepted by dot 1791979065 at cb26949, plus 7dd73ca):
- corrections only at yaw ±30 / ±60 × pitch 0 / ±45;
- a view is edited directly;
- elsewhere playback is preview only.

**What changes:**
- The bench: the selection and the batch targets.
- Two read-only entries in core (§3), with no change to the correction algorithm or the file. Every write is the existing `correct(pose, { points, handles })`.

## 1. A selection that lives in playback
- **What it holds:** a set of point ids, kept by the bench, at a correction pose only. It is never written to the drawing; `select` is not called.
- **What picks:**
  - A: a click on a visible end point (of a selected layer) picks it; Shift adds or removes.
  - V: a click on a line picks every end point of its curve (its group, else the line); Shift adds or removes.
  - **A press on nothing starts a box, with editing's rules (dot 1791981083):**
    - dragged right, the lines wholly inside; dragged left, every line it touches;
    - Shift adds, Alt removes;
    - only visible lines of the selected layers.
  - **What a boxed line gives:**
    - with A, its end points;
    - with V, every end point of its curve (its group).
  - **The box reads the pose's geometry** through `PoseReader.linesInRect` (new, read-only, §3: the view reader's `linesInRect` on the posed layer).
  - The picks follow the rules of cb26949 / 79484d9 / cb26949: only selected layers; a masked line is picked by what is drawn of it.
- **What clears it:** Esc, a pose change, leaving playback, an Open, a layer-scope change.
- **What survives:** a write. The same point ids stay picked, so "move, then squeeze, then nudge" goes on (dot 1791980846).
- **How it shows:** picked points are filled blue. The box around them has the editing selection box's 8 handles (`handlesOf`). A single A pick still shows the hovered line's handles (cb26949).

## 2. The batch operations
Each one computes targets for the picked points, and for the handles of every line touching them. The release writes one `correct`.

**Where the targets come from:** always the pose's stored curves, `core.atPose(pose).snapshot()`: end points plus `ha` / `hb` (dot 1791981083). Never `geometry().lines`, which arc joins trim.
- **Move:** a drag on a picked point or inside the box, or the arrows with a selection (Shift ×10, Option ×0.1).
  - Points take start + offset.
  - A handle whose line has both ends picked keeps its vector. A line with one end picked keeps its other end's handle. With 手柄跟随 on, its handles follow the chord, as `followHandles` (the same pure function as editing).
  - Without a selection the arrows still turn the pose.
- **Scale:** a drag on one of the box's 8 handles. Points are scaled about the opposite side or corner (Option: about the centre; Shift: keep the ratio). This is the editing box's `startHandleDrag` / `opAt`.
  - Handle vectors are scaled by the same (sx, sy).
  - A side handle alone squeezes sideways.
- **Rotate:** the box's rotate handle, as editing (`opAt`). Points and handle vectors are rotated.
- **四角 / 曲边:** the deform tool with a selection.
  - Its frame is around the picked points' lines.
  - Their curves are rebuilt from the posed snapshot's end points and `ha` / `hb`, as `planLines` does from a view's snapshot.
  - `deformPlan` (the pure function editing uses) gives the point targets and handle offsets.
- **One handle:** A on the hovered line's handle, as cb26949.

## 3. Preview = the release (dot 1791980921, 1791981083)
- **New read-only entry `Core.previewAt(pose, fn)`:**
  - core's own edit pipeline on a copy of the state (`runEdit`, as `preview` does), with `fn` run in the front;
  - then the draft read at `pose` (`modelOf` → `evaluate` → `posedState`), returned as a `PoseReader`, or null if the edit is cancelled;
  - refusals throw as in `preview`; nothing is published.
- **Each preview frame calls `previewAt(pose, e => e.correct(pose, targets))`,** the same call the release makes.
  - The ghost is that reader's geometry: every line and arc that differs from the current pose's drawing (as editing's drag ghost diffs `core.preview`).
  - It includes the targets' link members, which `correct` moves with them, and the join arcs that change.
  - A refusal turns the ghost off and shows the reason in red; the release then writes nothing.
- **The release** calls the same `correct` with the same targets. Evidence: the ghost's lines and arcs equal the drawing at the pose after the release (as the handle-follow and deform tests do).
- **New read-only `PoseReader.linesInRect(a, b, whole)`,** for the box (§1).
- **What `correct` changes at the pose:** only the targets and their link members (dot 1791981083); its final check refuses anything else.

## 4. Cancel paths (dot 1791980846)
- **These end a drag or a key run without writing:** a pose change, leaving playback, an Open, a drawing changed under it, Esc, a right click, the window's blur. These are the cancel paths of today's playback drag.
- The selection is kept only through a write of its own.

## 5. Evidence
**bench, the steps bowen described (dot 1791980846):**
- At −60 (211.json, 左眼 + 左睫毛) the picture does not jump on entering.
- Box-select the eye. Move it: one correct, with all its points and the handles of their lines.
- Drag the box's left side to squeeze it: one correct, points and handle vectors scaled in x only.
- The arrows: one correct per key run. The selection is still there after each.
- Mirror-linked eyes: the other eye is not made symmetric. `correct` touches only the targets and their link components; no front mirror rule runs.
- Each preview equals the drawing after the release (every changed point and handle).
- **Cancel cases:** a pose change mid-drag writes nothing. A refused correction writes nothing and shows the refusal.
- **四角:** one corner dragged, one correct.

**Screenshots:** −60 before, then after the move and the squeeze.

## 6. Not in this round
- Corrections inside a cell (set aside, bowen 1791976739).
- Undo inside playback.
- Handle picking by box.
