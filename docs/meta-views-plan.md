# 元线条, nine views, broadcast: flow checklist (written before code)

**Spec:** the graph tables "Models and 元组件", "Views", "Expressions", "Room, modes and broadcast", "Matching" and the changed row "Names", in headset-design `docs/design/review/2026-10-07-architecture-walkthrough.md` (written on bowen 1791648678, names 1791649036; commits f2e6d9f, f4292ae, cff966e). Process per the fill retrospective §9: this list is committed before the first code commit, dot reviews it once, bowen sees the plain summary, then code.

## Packages (bowen 1791649203: many modules, not one; Claude 1791649255, for dot's attack)

Dependencies point downward only.

1. **Drawing core** (existing `core`, accepted): one view's points, lines, joins, links, fills, layers, locks, editing, apply, clipboard. Rules unchanged.
2. **Meta structure** (new, horizontal): 元线条, 元组件, model.
   - Type and name.
   - Identity = 元组件 + name, kept through renames.
   - Copying a 元组件.
   - Model = a combination of 元组件.
3. **Views** (new):
   - the current view;
   - syncing structural edits (add, delete, split, bind) across the nine views;
   - shape edits in the current view only;
   - diagonal drafts.
4. **Broadcast** (new):
   - the two front baselines;
   - broadcast and fit;
   - the "unbroadcast change" mark.
5. **Expressions** (new): per-line 0 → 1 changes; combining expressions.
6. **Interpolate** (new, independent, pure maths): nine view shapes + expression values → the shape at any yaw / pitch / expression. It knows nothing of editing or undo. Used by playback and, later, runtime.
7. **Model file** (new, top): composes the above into one making file.
   - The one undo history and the one save / open live here.
   - One operation spanning several packages is one step.
8. **Matching** (later).

Existing interaction / visual / bench stay; the modes (draw / angle / expression / playback) live in interaction.

**Open structural choice (for bowen):**
- **甲 (recommended):** core stays single-view, untouched. The views package holds nine cores with the same ids. Structural edits run in all nine; shape edits in one. Topology equality is checked after every operation. A small core switch may be needed, e.g. auto-bind judged only in the edited view.
- **乙:** split core into topology + per-view geometry. Data is stored once, but this rewrites the accepted core.

### Revised boundaries (dot 1791649350; Claude 1791649403)

Packages:
1. drawing core (single view);
2. meta structure (元线条 / 元组件 / model, type, names, cross-view correspondence; no playback);
3. multi-view editing (decides which views an operation affects; produces and applies one consistent structural change; each view computes its own shape);
4. animation making (angle data, expression data, two front baselines, broadcast / fit);
5. evaluation / interpolation (pure);
6. document and edit transaction (commit, rollback, undo across everything);
7. file read / write (separate, depends on the document interface).

Matching joins later. Interaction holds the current mode and current view.

Boundaries:
- The edited view runs in a revocable trial state. The nine views and the meta structure are committed once.
- What is unified is targets, ids and relation decisions, not copied coordinates; split, merge and links may need each view's shape recomputed.
- Whether binds, locks and fills must be equal in all nine views is a behaviour question (Q1) decided first.

**Facts about the current core (da31397):**
1. Ids are given by the caller (line, split, unbind, copyLayer, paste). ✔
2. No outer transaction: each Core commits and keeps undo itself (`document/index.ts:440`); no trial-only entry, no formal state hand-back (only archive's exportState / importState). Needs an interface.
3. `net.Changes` records splits (with t), deletions, merges, unbinds, relocations; not new lines, joins, links, fills or names.
4. Auto-bind (`net.overlaps`, `network/index.ts:636`) scans every point on every commit: replay in another view would bind that view's chance coincidences. Needs a switch or a scope.
5. Names scope (bowen 1791649036) and layer type change core anyway; "core untouched" is withdrawn.

Rough cost:
- **Nine cores:** core gains interfaces (trial / outer transaction, auto-bind scope, complete change record); complexity sits in the multi-view package.
- **Shared topology:** the modules that read positions (links, springs, fill outlines, lock comparison, transforms, mirror, clipboard) need the view's geometry, either as a parameter or through one "current view geometry" accessor that reuses the existing algorithms (dot 1791649422). Cost not fixed yet.

Claude leans to nine cores pending dot.

### Core's three boundaries (dot 1791649528 asked for them; Claude's reading of da31397)

1. **Geometry computation** (positions and handles only; no topology change):
   - links.align (`links`);
   - springs, joins.solve (`joins`);
   - aimed handle tips (`net.resolveHandleTips`);
   - mirrored handles (`apply.mirroredHandles`);
   - outlines, picking, loopsAt (`derived`);
   - transform plans (`editing.transformPlan`);
   - the shape part of the lock comparison (`locks.changed`).

   Can run per view in either approach.
2. **Automatic structural decisions:**
   - (a) **Decided from geometry; must be made once, in the edited view, then applied to all:**
     - auto-bind of coincident end points in one layer (`net.overlaps` + bind loop in `settle`, `document/index.ts:611-623`);
     - the mirror-apply / mirror-link correspondence, a least-change search on control points (`apply/index.ts:64-72`).
   - (b) **Not decided from geometry; equal everywhere only if all non-geometric state and this edit's change record are equal** (topology, name use, group state and order, selection, prefer / owner records; dot 1791649593, 1791649657):
     - removing isolated points;
     - group reconcile (`groups.reconcile`, components + edit preferences);
     - fill validity (`fills.validate`, `net.closedWalk`: connectivity only);
     - default names (`names.update`);
     - selection clean-up;
     - dropping joins on a removed point.
3. **Commit and history:** `Core.edit` (draft clone, `commit` = settle + names check + lock check, then past / future; `document/index.ts:440-469`), the Editor transaction lifecycle, archive export / import. No outer-transaction entry.

More found by dot (1791649657):
- **Mirror apply also copies look and state** (stroke, lock / visibility, end strokes, joins, fill state; `apply/index.ts:195-222`). Its shape part is per view, its attribute part is shared; the two must be split.
- **Opening a file runs settle too** and requires that nothing changes (`document/index.ts:566-568`). The auto-bind rule must be the same in editing and in open, or a reopened view could merge chance coincidences and refuse the file.

- **Settle is a loop** (align → find coincidences → bind → clean up → align again; binding can end links and change the next round; `document/index.ts:614-624`). "Decide once" must record every structural change up to the stable end, not only the first coincident pairs (dot 1791649668).

**A cost comparison must include, for both approaches:** the structural-decision interface, non-geometric shared state, the one transaction, and save / reopen. Comparing "nine copies vs one topology" alone misses the main work.

Consequence for either approach: only 2(a) needs a "decide once" path; 1 needs per-view geometry; 3 needs an outer owner. Derived-id rules (copy `newId/old`, paste prefix, paired splits) must be applied identically (dot 1791649528).

### Cost comparison (Claude 1791649709 promised; for dot)

**Fact used below:** outside `network`, every module reads geometry through network's accessors: `net.point`, `net.line`, `net.curve(s)`, `net.points`, `net.lines`. Direct `.position` / `.ha` / `.hb` reads are on records those accessors return. Count of accessor calls by module: apply 10, derived 10, document 12, editing 5, joins 3, links 3, locks 3, names 2, groups 1. So a per-view geometry can be served by network alone ("current view geometry accessor", dot 1791649422).

| Item | Nine 画稿 (same ids) | Shared topology, per-view geometry inside `network` |
|---|---|---|
| Geometry per view | nine full states | network stores position / handles per view; accessors return the active view's; other modules unchanged |
| Structural decision once (whole settle loop, mirror correspondence) | record every structural change of the edited view's settle until stable, then replay in eight with given ids and their own auto-bind off | made once on the shared topology, applied to all views by construction; nothing to replay |
| Per-view shape for structural ops | replay computes it (split at t, bind keep position, unbind offset, new line copy) | the same rules inside network's split / bind / unbind / addLine, once per view |
| Non-geometric shared state (names, groups, order, selection, fills, joins, links, mirror pairs, change record) | kept equal in nine copies, or moved out to one copy (then core changes anyway) | stored once |
| Mirror apply: shape vs attributes | split: shape per view, attributes synced to eight | shape in the active view; attributes are shared state already |
| One transaction, one undo | outer layer over nine `Core.edit` histories; new interface | one `Core.edit` already covers everything (whole-state draft, past / future) |
| Settle in other views (broadcast, paste, new line) | run per changed copy, with auto-bind decisions coordinated | run settle positions per changed view; a coincidence found in any changed view binds in the shared topology once |
| Lock check | across nine copies | `locks.changed` compares every view (a loop) |
| Save / reopen | nine states + equality check; auto-bind rule identical at open | one state; open runs settle for each view with the same rule |
| Topology-equality check | needed every step | not needed (one topology) |
| Main risk | divergence; replay of a non-replayable change record | network module grows; every geometry write must name its view |

**Split per dot 1791649729** ("saved sync" apart from "behaviour still to change"):

- **Saved by shared topology** (no longer needed): replaying structural changes in eight copies; keeping names, groups, order, selection, fills, joins, links and mirror pairs equal in nine copies; an outer history over nine histories; the topology-equality check.
- **Still to change in both approaches:**
  - settle depends on connections *and* each view's geometry, so it runs per changed view;
  - auto-bind's rule (which views' coincidences count) is the same in editing and in open;
  - the lock check covers every view;
  - mirror apply is split into a per-view shape part and its attribute part;
  - the file holds the complete multi-view state;
  - every attribute is classified shared or per view (table below).

### Which attributes are shared and which per view (to be decided item by item; dot 1791649729)

| Attribute | Proposal | Basis / status |
|---|---|---|
| Point position, handles | per view | graph row "元线条 has one shape in each view" |
| Arc join radius | per view (it is geometry) | proposal |
| Join mode (smooth / cusp / arc) | shared | proposal (a relation, like connections) |
| Line names, groups, connections, links, closed-curve boundaries | shared | graph rows (structure synced across views); Q1 |
| Show / hide intervals (along-line [start, end]) | per view: the ends are keyed per view and interpolated over angle | v103 behaviour (bowen 1791337313); no data model yet |
| Element visibility / lock (editing state) | shared | proposal: they are editing switches; per-view hiding is what the intervals are for |
| Line width, end strokes (taper) | **ask bowen** | could change with foreshortening |
| Drawing order (layers, groups, fills: who covers whom) | **ask bowen** | e.g. at 90° the far ear goes behind the head |
| Fill colour | shared | proposal |
| Whether a fill shows in a view | follows the order / interval answers; geometric validity checked per view | dot 1791649422, 1791649528 |

**Claude's reading:** shared topology with the geometry accessor in `network` looks cheaper. Its changes concentrate in `network` (per-view storage, active view, per-view rules in addLine / split / bind / unbind / insertLines), plus loops over views in `document` (settle, import) and `locks`. Nine 画稿 adds three systems: replay, synced shared state, outer history. For dot to check before bowen decides.

**Rule this needs (both approaches), for bowen with Q1:** "no two end points in one layer coincide" holds in every view; a coincidence found in any view an edit changed binds in all views.

## Data: what changes in core

- **Topology is shared by all nine views:** points, lines, which line ends at which point, joins (mode), endpoint links, closed curves and fills, groups, names, layer order, strokes, element state (visible / lock).
- **Geometry is per view:** each point's position and each line's two handles, in each of the nine views. One id per point and per line across views ("元线条 has one shape in each view").
- **Layer** gets a `type` (string, e.g. 眼睛). Layer = 元组件.
- **Names:** layer names unique in the document; curve and line names unique within their layer (row "Names").
- **Front baselines:** per line, two copies of its front geometry (angle, expression). Making-file data, saved; not part of runtime.
- **Current view:** which view is being edited. Interaction / UI state, not document data (like the current tool).

Not data now: expressions (stage 4), runtime interpolation (stage 3).

## Stages

1. **Nine-view core.** Layer type; names scope; per-view geometry; edits act on the current view; structural edits sync; undo; save / open. Bench: a 3 × 3 view picker; draw / edit in any view.
2. **Broadcast and fit** (angle baseline). "Front has unbroadcast change" mark. Diagonal draft (front + yaw change + pitch change).
3. **Angle playback.** Interpolate the shape between the nine views for any yaw / pitch; a playback mode in the bench.
4. **Expressions.** A 0 → 1 change of chosen lines at the front; expression baseline; broadcast / fit to expressions; combining expressions; carried by the angle level.
5. **Later, separate experiments:** right side drafted from the left by mirror apply across views (needs left / right pairing); matching and deriving views from a match.

Each stage: code, run every listed flow myself including after-states, push, dot reviews once, one batch of fixes.

## Operation table: which views each operation touches

| Operation | Current view | Other eight views | Source / note |
|---|---|---|---|
| Draw a new line (pen) | as drawn | **the same shape, copied** | row "Adding a line" |
| Move / rotate / scale / deform a selection; drag a point or handle | changed | unchanged | row "Adding a line": editing a shape changes only the edited view |
| Delete lines | deleted | deleted | same row |
| Split a line at t | split at t | split at the **same t** | *proposed*: keeps every view's shape; t is per line |
| Bind two points (merge) | merged at the first-clicked point | merged; see question Q1 | Q1 |
| Auto-bind coincident end points in one layer | judged in the current view at commit | follows the bind | *proposed*; Q1 decides positions |
| Unbind | new point + offset | new point at the old position + the same offset | *proposed* |
| Set join mode (smooth / cusp / arc) | shared | shared; springs solved per view | *proposed*: joins are topology |
| Endpoint link: create | second point moved to the first | the same, in every view | *proposed*: a link keeps the points together in all views |
| Endpoint link: keep together | averaging over the points acted on, in the views that changed | — | existing rule, per view |
| Fill: create / clear / colour | shared | shared; outline per view | fills are topology + look |
| Stroke, visibility, lock, order, rename | shared | shared | look and state are on the line |
| Copy / paste | all nine views copied; paste offset in all views | — | *proposed* |
| Cut and paste keeping ids (move to another layer) | all nine views | — | existing row, per view |
| Copy a whole layer (元组件) | all views + baselines; names kept | — | rows "Copying", "Names" |
| Mirror flip | current view only (it is a shape edit) | unchanged | *proposed* |
| Mirror apply (same view) | current view of the target | unchanged | *proposed*; cross-view mirror is stage 5 |
| Mirror link | pairs change together **in the edited view**; structural changes in all | — | *proposed* |
| Broadcast (stage 2) | — (front is the source) | + (front − angle baseline) on every line chosen; then angle baseline = front | rows "Broadcast", "Baseline" |
| Fit (stage 2) | angle baseline = front | unchanged | row "Fit" |
| Commit pipeline (springs, links, overlap bind, fills, locks) | runs on every view the edit changed | | *proposed* |

## Checks that apply in every view

- **Locks:** a locked line protects its shape in **all nine views** (it owns them all). A broadcast or paste that would change a locked line in any view is refused whole (row "Apply": a locked target refuses).
- **Selection:** by id, so it survives switching views.
- **Undo:** one history for all views; switching view is not a step.
- **Save / open:** every view, layer types, baselines; reopening gives equal geometry in every view.

## Flows to run (including after-states)

From dot (1791645801, 1791647948) and the worked examples:
1. Draw at the front, switch to 90,0: the line is there at the same place; move it there; the front is unchanged.
2. Draw a side nose line at 90,0; it appears in all nine views at the same place; adjust it at the front; 90,0 unchanged.
3. Delete a line in any view: gone in all nine; undo brings back every view's shape.
4. Split in a side view: every view split at the same t; each view's drawing unchanged.
5. Copy a 元组件 that has an unbroadcast front change: the copy has the same views and baselines; names kept; editing the copy never changes the original (stage 2 for baselines).
6. Broadcast angles (stage 2): every other view moves by front − baseline; broadcast again with no new change: nothing moves; undo restores views and baseline together.
7. Fit (stage 2): picture unchanged, offset zero; undo restores the pending offset.
8. Broadcast angles and expressions separately (stage 4): the one does not clear the other's baseline.
9. Save, reopen, continue: geometry in all views, baselines and pending offsets are equal; a broadcast after reopening gives the same result as before saving.
10. Locked line: editing it in any view is refused; broadcast touching it is refused whole.
11. Endpoint link across layers: dragging one end in view X keeps both together in X; other views unchanged.
12. Fuzz: random edits in random views keep every invariant in every view; topology identical across views after every commit.

## Questions for bowen (visual results; recommendations marked)

- **Q1 (widened, 1791649403). Binding when the two points are apart in other views.** 甲 bind in all nine (front: merged at the first-clicked point; connections and closed-curve boundary references shared by all views (a loop may collapse or self-cross in some view; display and geometric validity are checked separately, dot 1791649528); whether a fill shows may still differ per view, dot 1791649422); 乙 bind only in the edited view (relations may differ per view; a fill may exist in some views only).
- *Earlier wording:* In view 90 two end points are bound (merged); at the front they are 2 cm apart. After binding, what does the front show?
  - 甲 (recommended): in every view the merged point sits where the **first-clicked** point is in that view (the existing rule "the first point is kept"). Lines that ended at the other point jump to it in the other views; shown, not blocked.
  - 乙: in each other view, the midpoint of the two.
- The other *proposed* rows above are our filled-in defaults; bowen is asked only if he disagrees.

## Not in this plan

Runtime shaping, publishing, matching, autosave / crash recovery (requirement suggested, not decided), show/hide intervals (no data model yet).
