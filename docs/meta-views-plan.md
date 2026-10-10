# 元线条, nine views, broadcast: flow checklist (written before code)

**Spec:** the graph tables "Models and 元组件", "Views", "Expressions", "Room, modes and broadcast", "Matching" and the changed row "Names", in headset-design `docs/design/review/2026-10-07-architecture-walkthrough.md` (written on bowen 1791648678, names 1791649036; commits f2e6d9f, f4292ae, cff966e). Process per the fill retrospective §9: this list is committed before the first code commit, dot reviews it once, bowen sees the plain summary, then code.

**This file holds only the current plan.** Earlier versions (an 8-package list, undo in a "model file", "core untouched", an older Q1) are withdrawn; see the git history of this file and the Slack thread (Claude 1791649255 → dot 1791649350, 1791649845).

**Undecided items are marked *待定*.** Nothing marked 待定 is coded until decided.

## 1. Packages (bowen 1791649203; boundaries per dot 1791649350)

Dependencies point downward only.

1. **Drawing core:** single-view geometry, constraints and basic editing; reused as far as possible.
2. **Meta structure:** 元线条 / 元组件 / model, type, names, cross-view correspondence. No playback.
3. **Multi-view editing:** decides which views an operation affects; makes one consistent structural decision and applies it; each view computes its own shape.
4. **Animation making:** angle data, expression data, the two front baselines, broadcast / fit. It may be split inside (angle, expression, broadcast) without each being its own published package.
5. **Evaluation / interpolation:** independent pure maths; model data + parameters → shapes. Shared by playback and runtime; depends on no edit transaction or UI.
6. **Document and edit transaction:** composes the whole state; one commit, rollback and undo.
7. **File read / write:** separate; reads and restores a document through the document interface. Undo is not here.

Matching joins later. Interaction holds the current mode and the current view and gives explicit targets to the packages above.

**Rules for any implementation:**
- The edited view runs in a revocable trial state. The nine views and the meta structure are committed once.
- What is unified across views is targets, ids and relation decisions, not copied coordinates. Split, merge and links may need each view's shape recomputed.

## 2. How the views relate to the drawing core: two candidates, not yet chosen

Both are still compared. Which is cheaper is **not** claimed here (dot 1791649845). The comparison waits for the 待定 answers in §4 and §6, which change it.

- **A. Nine 画稿 with the same ids.** One drawing per view; structural decisions made once in the edited view and applied to the other eight.
- **B. Shared topology, per-view geometry.** One drawing whose points and handles have a position per view; modules read a view's geometry through network's accessors. The accessor names **which state and which view** explicitly; there is no process-wide "current view" switch, so trial, undo comparisons and lock baselines never read different views (dot 1791649915).

### After bowen's answers (Q1–Q4, bowen 1791650085, 1791650171, 1791650206, 1791650323)

**Per view:**
- point position;
- handles;
- arc radius;
- line width / profile;
- end strokes.

**Shared by all views:**
- connections, binds, endpoint links, closed-curve boundary references;
- join mode;
- names, continuous curves, order (layers, groups, fills);
- fills (colour, state);
- visibility / lock;
- mirror pairs;
- selection.

**Auto-bind:** judged only in the edited view; open checks positions without auto-bind. **Mirror apply / link:** at 0,0 only. **Stroke broadcast:** a plain assignment, a batch edit.

What this means for each candidate (to be checked by dot):
- **A. Nine 画稿.** All shared items above must stay equal in nine copies after every edit.
  - Structural decisions are made in the edited copy and replayed in eight, with their auto-bind off.
  - The mirror runs only in the front copy, but its paired structural edits (paired split / delete) must reach all copies.
  - An outer transaction and undo over nine histories.
  - Open: positions checked without auto-bind in every copy.
- **B. Shared topology.**
  - `network` stores position, handles and stroke per view.
  - `joins` stores arc radius and end strokes per view.
  - Accessors name the state and the view; `Changes` separates structural records (shared) from targets and handle tips (edited view).
  - Settle runs: the full loop in the edited view; positions only (links, springs, tips) in other changed views, without auto-bind.
  - The lock check compares each view's protected content (shape, stroke, end strokes).
  - The clipboard carries all views.
  - `afterApply`, commit and open use the same rule.
  - Mirror apply / link read and write the 0,0 view.

### Facts about the current core (da31397), checked by dot 1791649528

1. Ids are given by the caller (line, split, unbind, copyLayer, paste).
2. `Core.edit` trials, commits and keeps its own undo (`document/index.ts:440-469`); there is no entry for an outer transaction. Save / open can clone a trial copy but loses selection and history.
3. `net.Changes` is a partial record for updating references, not a replayable structural log. Copy and paired split have derived-id rules.
4. Auto-bind (`net.overlaps`, `network/index.ts:636-652`) binds end points at exactly the same position **in one layer**, on every commit.
5. Settle is a loop: align → find coincidences → bind → clean up → align again; binding can end links and change the next round (`document/index.ts:614-624`).
6. Opening a file runs settle and requires that nothing changes (`document/index.ts:566-568`).
7. Mirror apply copies look and state as well as shape: stroke, lock / visibility, end strokes, joins, fill state (`apply/index.ts:195-222`).
8. The network state is opaque outside `network`, and reads return frozen copies (`network/index.ts:5-8`). Outside it, geometry is read through `net.point`, `net.line`, `net.curve(s)`, `net.points`, `net.lines`. Calls by module: apply 10, derived 10, document 12, editing 5, joins 3, links 3, locks 3, names 2, groups 1. Writes go through network functions; the main ones are move, setPositions, moveHandle, setHandles, aimHandle, resolveHandleTips, addLine, splitLine, unbind, bind, insertLines (direction checked by dot 1791649915; not yet an exhaustive enumeration of exports).
9. Names scope (bowen 1791649036) and layer type need core changes in either candidate.

**Interface changes candidate B needs beyond `network`** (dot 1791649873; "other modules unchanged" withdrawn):
- **`Changes` mixes scopes:** structural records (splits, merges, deletions) are shared, but target positions and absolute handle tips belong to the edited view. They cannot be handed unchanged to nine views; the scopes must be separated.
- **Clipboard format** holds one position and handle set; copying all views needs a format and routing change.
- **`Editor.afterApply`** runs settle on a scratch copy to compute lock baselines; it must follow the same multi-view rule as commit and open.

### Core's three boundaries (Claude's reading; dot 1791649593)

1. **Geometry computation:** link alignment, springs, aimed handles, mirrored handles, outlines / picking, transform plans, and the shape part of the lock comparison.
2. **Automatic structural decisions:**
   - (a) **From geometry:** auto-bind (the whole settle loop until stable), and the mirror correspondence (least change on control points, `apply/index.ts:64-72`).
   - (b) **Not from geometry, but from all non-geometric state plus this edit's change record:** isolated points, group reconcile, fill validity, default names, selection clean-up, dropped joins.
3. **Commit and history:** `Core.edit`, the Editor lifecycle, archive export / import.

### What each candidate must build (a list of changes, not a verdict)

| Item | A. Nine 画稿 | B. Shared topology |
|---|---|---|
| Per-view geometry | nine full states | per-view position / handles in `network`; accessors return the active view |
| Structural decision once, whole settle loop | record every structural change until stable; replay in eight with given ids; their own auto-bind off | decisions act on the one topology |
| Per-view shape for structural ops (split at t, bind, unbind, new line copy) | in the replay | inside network's split / bind / unbind / addLine, per view |
| Non-geometric state (names, groups, order, selection, fills, joins, links, mirror pairs, change record) | kept equal in nine copies, or moved to one copy | stored once |
| One transaction, one undo | outer layer over nine histories; new core interface | the existing whole-state `Core.edit` |
| Settle after edits that change other views (broadcast, paste, new line) | per changed copy, auto-bind coordinated | per changed view; a bind there changes the shared topology (scope 待定, §4 Q2) |
| Lock check | across nine copies | over every view |
| Mirror apply | shape part split from attribute part | the same split |
| Save / reopen | nine states; same auto-bind rule at open | one state; settle per view at open with the same rule |
| Topology-equality check | every step | not needed |
| Main risk | divergence; replaying a partial record | `network` grows; every geometry write names its view |

## 3. Data

- **Layer** gets a `type` (e.g. 眼睛). Layer = 元组件.
- **Names:** layer names unique in the document; line names unique within their layer. Continuous-curve names likewise (*待定*, bowen to confirm).
- **Per view:** point positions and line handles.
- **Shared:** points, lines, which line ends at which point; line names; continuous curves; endpoint links; closed-curve boundary references (subject to Q1).
- **Other attributes:** see §6. Some are *待定*.
- **Front baselines:** per line, two copies of its front geometry (angle, expression). Making-file data, saved; not runtime.
- **Current view:** interaction state, not document data.

## 4. Questions for bowen

- **Q1: decided 甲 (bowen 1791650323), bound in all views.** Two points are bound in a side view but are apart in the front view.
  - 甲: bound in all nine views. In each other view the merged point sits where the first-clicked point is (existing rule "the first point is kept"); lines that ended at the other point move to it. Connections and closed-curve boundary references are shared by all views. A loop may collapse or self-cross in some view, so display and geometric validity are checked per view (dot 1791649528).
  - 乙: bound only in that view. Connections may differ per view; a closed curve may exist in some views only.
- **Q2: decided 甲 (bowen 1791650323: coincidence is defined exactly, so chance contact in other views is very unlikely; ignore it).** Only the view being edited is judged. Opening a file keeps legal coincident separate points in other views (no auto-bind there), while structure and reference checks still run in full; the two are separate (dot 1791650402). Which coincidences trigger auto-bind (dot 1791649845: two different behaviours):
  - 甲: only coincidences in the view the user is editing.
    - Coincidences caused in other views (by broadcast, or by a bind moving lines there) are left alone.
    - Opening a file must then not bind them either: the invariant "no two end points in one layer coincide" holds in the edited view at commit, not in every view.
  - 乙: coincidences in any view the edit changed, broadcast included. A broadcast that makes two side-view points coincide would bind them in all views.
    - Only under 乙: settle loops over all changed views, and newly affected views join the check. The number of binds is bounded (finite points, binds only remove), but that alone does not prove the result is independent of view order, nor that every lock and constraint check passes (dot 1791649915). An order rule and tests would be needed.
- **Q3. Drawing order: decided (bowen 1791650085).** Shared and synced, like adding / removing lines and layer order. Whether to allow per-view order is left for later.
- **Q4. Line width and end strokes: decided (bowen 1791650085).** Per view, with a button that broadcasts them to the other views so they need not be set nine times. The button is a plain assignment of the current view's values (bowen 1791650171), unlike shape broadcast's offset.
- **Q5. Mirror** (bowen 1791649795, 1791649821, 1791650323: mirror apply is a batch-editing tool; mirror apply and mirror link act only at 0,0, a view-limited operation). Still open from 1791649837:
  - ~~Does mirror link also act only at the front?~~ Yes (bowen 1791650323).
  - The graph row "right-side views can be drafted from the left by mirror apply": withdrawn (甲), or a separate whole-view mirror draft (乙)?

## 5. Stages

1. **Nine-view editing.**
   - Layer type; names scope; per-view geometry.
   - Edits act on the current view; structural edits are synced.
   - Undo; save / open.
   - Bench: a 3 × 3 view picker; draw and edit in any view.
2. **Broadcast and fit** (angle baseline):
   - the "front has an unbroadcast change" mark;
   - the diagonal draft (front + yaw change + pitch change).
3. **Angle playback:** interpolate between the nine views for any yaw / pitch; a playback mode in the bench.
4. **Expressions:** a 0 → 1 change of chosen lines at the front; the expression baseline; broadcast / fit to expressions; combining expressions.
5. **Later, separate:** matching; the right-side mirror draft if Q5 keeps it.

Each stage: code, run every listed flow myself including after-states, push, dot reviews once, one batch of fixes.

## 6. Operations and attributes per view

| Operation / attribute | Current view | Other views | Status |
|---|---|---|---|
| Draw a new line | as drawn | the same shape, copied | graph "Adding a line" |
| Move / rotate / scale / deform; drag a point or handle | changed | unchanged | graph "Adding a line" |
| Delete lines | deleted | deleted | graph |
| Split a line at t | split at t | split at the same t | proposal |
| Bind two points | merged | merged; the merged point sits where the first-clicked point is in that view | bowen 1791650323 (Q1 甲) |
| Auto-bind | judged here only | follows the bind; their own coincidences are ignored | bowen 1791650323 (Q2 甲) |
| Unbind | new point + offset | new point at the old position + the same offset | proposal |
| Endpoint link: create | second point moved to the first | the same, in every view | proposal |
| Endpoint link: keep together | averaging the points acted on, in each changed view | — | existing rule, per view |
| Join mode (smooth / cusp / arc) | shared | shared; springs solved per view | proposal |
| Arc radius | per view | per view | proposal (geometry) |
| Element visibility / lock | shared | shared | proposal (editing switches) |
| Show / hide intervals | — | — | *待定* (v103 keyed the ends per view; reference only, dot 1791649820; no data model yet) |
| Line width, end strokes | per view | per view; a button copies the current view's value to the other views | bowen 1791650085, 1791650171, 1791650206 (Q4): the button is a plain assignment, a batch edit (one undo step; a locked line refuses it) |
| Drawing order (layers, groups, fills) | shared | shared (reordering in any view applies to all) | bowen 1791650085 (Q3); per-view order maybe later |
| Fill colour | shared | shared | proposal |
| Whether a fill shows in a view | — | — | follows Q1 (order shared, Q3); geometric validity per view |
| Copy / paste | all views copied; paste offset in all views | — | proposal |
| Cut and paste keeping ids | all views | — | existing row, per view |
| Copy a whole 元组件 | all views + baselines; names kept | — | graph "Copying", "Names" |
| Mirror flip | current view only | unchanged | proposal (a shape edit) |
| Mirror apply / mirror link | at 0,0 only (view-limited) | — | bowen 1791649795, 1791650323 |
| Broadcast (stage 2) | — (front is the source) | + (front − angle baseline) on every chosen line; then baseline = front | graph "Broadcast" |
| Fit (stage 2) | angle baseline = front | unchanged | graph "Fit" |

## 7. Checks in every view

- **Locks:** a locked line protects its shape in all views. A broadcast or paste that would change a locked line in any view is refused whole (graph "Apply": a locked target refuses).
- **Selection:** by id; it survives switching views.
- **Undo:** one history for all views; switching views is not a step.
- **Save / open:** every view, layer types, baselines; reopening gives equal geometry in every view; the auto-bind rule at open equals the one in editing.

## 8. Flows to run (including after-states)

From dot (1791645801, 1791647948) and the worked examples:

1. **Draw at the front, then switch to 90,0:** the line is at the same place; move it there; the front is unchanged.
2. **Draw a side nose line at 90,0:** it appears in all nine views at the same place; adjust it at the front; 90,0 is unchanged.
3. **Delete a line in any view:** gone in all nine; undo brings back every view's shape.
4. **Split in a side view:** every view is split at the same t; each view's drawing is unchanged.
5. **Copy a 元组件 with an unbroadcast front change:** the copy has the same views and baselines, with names kept; editing the copy never changes the original. (Baselines: stage 2.)
6. **Broadcast angles** (stage 2):
   - every other view moves by front − baseline;
   - broadcast again with no new change: nothing moves;
   - undo restores views and baseline together.
7. **Fit** (stage 2): the picture is unchanged and the offset is zero; undo restores the pending offset.
8. **Broadcast angles and expressions separately** (stage 4): one does not clear the other's baseline.
9. **Save, reopen, continue:** geometry in all views, baselines and pending offsets are equal; a broadcast after reopening gives the same result as before saving.
10. **Locked line:** editing it in any view is refused; a broadcast touching it is refused whole.
11. **Endpoint link across layers:** dragging one end in view X keeps both together in X; other views are unchanged.
12. **Fuzz:** random edits in random views keep every invariant in every view.

## Not in this plan

Runtime shaping, publishing, matching, autosave / crash recovery (suggested, not decided), and the show / hide interval data model.
