# Editing in playback: checklist before any code, for dot's review

Asked by bowen 1791968760 (30° / 60° correction exists in core, but the UI has almost no way to use it) and 1791969415:
- playback takes reference pictures;
- Z hides every point mark (zoom only); A and V should move things;
- a move shows in the UI which data it changed;
- the layer eye and the fill switch should work in playback.

Then:
- my plan 1791969590, items 1–5: bowen 1791970279 "其他没意见";
- the pictures: bowen 1791970202 — plain pictures he places and drags himself, not tied to any view or pose.

**Where a drag writes** (bowen 1791976386):
- **Corrections:** only at yaw ±30 and ±60 on the rows pitch 0 and ±45. These are 12 poses, all on lines core already corrects (`views.EDGES`; answered 1791970345).
- **The views** (yaw 0 / ±90 × pitch 0 / ±45): a drag edits that view itself (§2).
- **Anywhere else:** preview only, at any angle (bowen 1791970497). A press there writes nothing, and the status line says 「这里只能看；修正点在 yaw ±30 / ±60、pitch 0 / ±45」.
- **Assumption:** pitch ±45 both count; to be confirmed by bowen (asked 1791976469).
- **Later, set aside (bowen 1791976739):** corrections inside a cell. The default is the same blend-weight approach as on the lines (v103 stored interior samples as weights), not a displacement. See the experiments 1791972504 / 1791972880 and my answer 1791976763.

What playback is today (stage 3a / 3b, `bench/src/app.tsx`):
- the drawing at the pose is `core.atPose(pose)`, read only;
- the logged wrapper lets an edit through only if it calls `correct` exactly once;
- one `<fieldset disabled>` greys every panel: tools, layers, properties, fills, pictures, Open;
- pictures are drawn only outside playback;
- on a line, a press near a visible line's end point drags it and the release makes one `correct` (points only; no marks since 1791908866).

## 1. Layer eye, fill switch, 蒙版 switch work in playback
- **The gate:** in playback the wrapper also lets through an edit made only of these calls:
  - `layerState(id, { visible })` (the eye, «hide all», Option-click);
  - `fillState` / `fillVisible` with `visible` only (the fill on/off);
  - the playback pictures' calls (§5), only on a picture whose `view` is `playback` (dot 1791976669: the check is the target, not the call name);
  - `uncorrect` (§4).
  These are the same data at every angle (`shared: structure / fills / reference`), so nothing is pose dependent.
- **At a view** (§2), the ordinary edits of that view are let through, bound to the view the press started in.
- **A picture read that returns later** (a file chosen for a playback picture) writes only if the drawing, the App's counter and the mode (playback) are still the ones it started with; otherwise it is dropped and the log says why (as reference-images-plan §7.1).
- **Still refused:** everything else, e.g. a lock, a rename, a colour, a new layer, Open, undo / redo. It is refused as today, and the status line names the call.
- **The panels:** the layers panel and the fill list are no longer inside the disabled fieldset. Their other controls stay and are refused by the gate (bench glue, not a design).
- The 蒙版 and ink switches are bench display options, never written: on in every mode.

## 2. Z / A / V in playback
- **Z:** zoom, as in every mode. No point marks, no handle marks; a press only zooms (as today).
- **A at a correction pose:**
  - **What shows:** the end points of the visible lines are marked (the pre-1791908866 marks, shown only with A). The two handles of the line under the pointer are marked as well, as v103 shows the hovered line's handles.
  - **A point:** dragging it gives one `correct(pose, { points: [{ id, position }] })` on release, as today.
  - **A handle:** dragging it gives one `correct(pose, { handles: [{ line, end, vector }] })`, where the vector is the handle's new end minus its point at the pose.
- **V at a correction pose:** pressing a line takes its whole curve, by the same rule V uses in editing (the curve it belongs to, else the line alone). The drag moves every end point of those lines by the pointer's displacement. The release makes one `correct` with all those points; handle vectors are unchanged.
- **Ghost and cancel:** the ghost is start + displacement. The press binds the frame, the drawing and the pose; every cancel path is today's (Esc, a right click, a pose change, leaving playback, a changed drawing).
- **At a view** (yaw and pitch both on views): A and V edit that view itself, as editing in that view does. Concretely:
  - the press goes to interaction with `view` set to that view's key;
  - the commit is interaction's ordinary `translate` / `moveHandle`, with the 手柄跟随 switch as in editing (dot 1791976669);
  - the ghost is interaction's own preview (`core.preview`), as in editing;
  - the press binds that view: a pose change during the drag cancels it;
  - the gate lets these edits through only while the pose is that view.
- **Elsewhere** (neither a correction pose nor a view): no marks; a press does nothing; the status line says where corrections can be made (above).

## 3. What a move changed, shown
- **After each playback write**, the bench diffs `core.model()` taken before and after the write. A panel 「刚才改了什么」 lists in plain words:
  - for each control (a point, or a handle of a line), which line of the grid and which t got a correction, per axis x / y: 「点 a · yaw 0→90 · t 0.333 · x、y 加修正」;
  - for each view whose positions or handles moved (the outer view, when core moved it): 「侧面 view:90,0 的点 a 被移动了 (dx, dy)」;
  - nothing else is expected. Any other difference is listed raw: a check, never hidden.
- **Marks at this pose:** while A shows the points, a point that has a correction at exactly this pose (a knot at this edge and this t, either axis) gets a ring. A line whose handle has one gets a mark at that handle.
- **「本角度的修正」 list:** every control with a knot at this edge and t: its name, the axes, and a delete button (§4).

## 4. Deleting a correction: `Editor.uncorrect` (new, core)
- `uncorrect(pose, control)`: on the pose's edge, it removes that control's knots at the pose's t, both axes. It does this for each member of the control's link component, because linked points keep identical response sets.
- **Refusals:**
  - `correction-at-view` and `correction-off-edge`, exactly as `correct` gives them;
  - `uncorrect-none` when there is no knot there.
- **What it does not undo:** a view that core moved when the correction was made stays where it is; undo, not delete, reverses that.
- **The button** is labelled 「删除修正拐点」, not 「撤销」, so it is not mistaken for undoing that drag (dot 1791976669). A note beside the list says that a moved view stays.
- One edit, one undo step, declared in effects (`reads: draft`, `shared: animation`), settle `none`.
- **Tests:** knots removed on both axes; the linked members too; a knot of another t kept; the refusals; one undo step; evaluate at the pose falls back to the line's linear value when no knot is left.

## 5. Playback pictures
- **Data:** the pictures keep their own place key `playback` beside the nine views. This is `reference`'s one change: a picture's `view` is a view key or `'playback'`; everything else is the same (library, opacity, visibility, slots, flip). They are shown in playback only, whatever the pose, and never in a view.
- **API:** `Core.playbackReferences()`, and `placeReference` / `setReference` / `removeReference` accepting `view: 'playback'`.
- **The file** (dot 1791976669): saved with the drawing like the others.
  - **Archive version 10 → 11:** a v10 reader refuses `view: 'playback'`, so a file with a playback picture is not a v10 file.
  - **Older files:** `src/legacy` reads v10 unchanged, through an identity step `fromV10` (disposable, as the other legacy steps; bowen 1791907735).
  - An old file never has `playback`.
- **The bench:**
  - in playback the 参考图 panel lists and places the playback pictures;
  - Move picture works there, by drag and by arrows, as in a view;
  - pictures are drawn under the lines in playback.

## 6. Evidence
- **interaction / core:** the `uncorrect` cases (§4); `reference` accepting `playback` and refusing other keys; a clip and an Open round trip with a playback picture.
- **bench:**
  - the eye and the fill switch toggle in playback, while a lock and a rename are refused;
  - Z shows no marks and A does;
  - an A point drag and an A handle drag at yaw 30 / pitch 0 each make one correction, and the 「刚才改了什么」 text names them;
  - a V curve drag makes one correction with all its points;
  - at view 90,0, A edits the view;
  - at yaw 20 / pitch 0 and at yaw 30 / pitch 20 the press does nothing and the message shows;
  - the list's delete removes the knot and the ring;
  - a playback picture is placed, moved, saved and reopened;
  - a picture call on a view's picture is refused in playback;
  - a view drag is cancelled by a pose change;
  - a v10 file opens, and a saved file is v11.
- **Screenshots (5199):**
  - 211.json at yaw 30 with A marks and a handle drag, before and after;
  - the 「刚才改了什么」 panel;
  - a playback picture under the lines.

## 7. Not in this round
- corrections inside a cell;
- undo during playback (still ⌘Z after leaving);
- pose-bound pictures;
- handle follow in correction drags (a corrected point's lines keep their handle vectors). At a view the editing switch applies (§2).
