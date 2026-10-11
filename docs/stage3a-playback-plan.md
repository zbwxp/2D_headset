# Stage 3a: angle playback and interpolation, read only (plan before code)

**Status:** first draft, for dot's check (dot 1791682947: playback / interpolation reviewed on its own, separate from the in-between correction, which changes data and comes as stage 3b). Nothing is coded until this passes.

**Ledger check** (`docs/consolidation-ledger.md`):
- Row 1 (commit settling by name lists) is not triggered: playback writes nothing.
- **Row 8 is triggered** (dot 1791684079): the bench's Open must not replace the document during playback. 3a fixes it with request order and a mode check (bench playback flow below), and closes the row.
- **Row 6 is triggered** (dot 1791683214: the next new read API reviews all read entries together). 3a adds `Core.model()` / `Core.atPose()`, so it includes that review; see "Read entries" below.

## Inputs

- **bowen:**
  - interpolate is its own package ("interpolate也应该是一个独立模块"; recorded as package 5 in `docs/architecture-multiview.md`);
  - the change between views can be made non-linear at any angle bowen moves to (§6 of `docs/architecture-multiview.md`); that is stage 3b, but 3a must leave a place for it;
  - 0° never moves.
- **Architecture:** package 5 `evaluate`: pure, `evaluate(model, pose) → shapes`, plain data in a type it defines itself, no edit transaction, no UI (`docs/architecture-multiview.md` §3, `docs/meta-views-plan.md` item 5). The angle scheme was left open: "v103 triangulated the domain; piecewise bilinear over the 3 × 3 grid is a candidate. … Decided before stage 3."
- **v103 for reference** (7205381; read with `git show`, not run):
  - nine vertices yaw {−90, 0, 90} × pitch {−90, 0, 90}; the pitch ±90 rows were automatic placeholders, not drawn poses (`automaticSnapshotEdits.ts:94-108`);
  - a stored triangulation, exact barycentric weights (`triangulation.ts:332-355`); the diagonals depend on the order views were made and are never flipped (`triangulation.ts:1-11, 230-232`);
  - default linear; response curves per control (node / handle), per axis (x / y), per edge, piecewise linear in progress (`triangularResponses.ts:80-127`), plus interior samples per triangle;
  - points: absolute positions; handles: vectors from their point (`model.ts:147`, `simplexGeometry.ts:84-85`); smooth joins re-projected after the blend (`simplexGeometry.ts:228`);
  - arc radius: linear; width, profile, ink ends, visibility: from the dominant view, no blend (`simplexGeometry.ts:196, 212-223`);
  - outside the domain: refused, not clamped (`evaluation.ts:474`);
  - the +90 side was derived by mirroring −90 (`viewMirrorMath.ts:51-61`).

## What differs from v103 here

- **The four corners are real drawn views** (stage 2: drafted, then adjusted by hand), not placeholders. Every cell of the 3 × 3 grid has all four of its corners drawn.
- **Pitch is ±45**, the nine `view:Y,P` keys.
- **Both sides are drawn**; nothing is derived by mirroring (mirror is an editing tool at 0,0 only). So v103's mirror-seam rule does not carry over, but continuity across 0° is still checked (dot 1791683851).

## Rules

1. **Pose.** `pose = { yaw, pitch }` in degrees, yaw ∈ [−90, 90], pitch ∈ [−45, 45]. Outside is refused (`pose-out-of-range`), never clamped (as v103).
2. **Scheme: bilinear in each quadrant** (*proposal*, the architecture's candidate). For a pose in the quadrant with corners front F, yaw view Y, pitch view P, corner C, with u = |yaw| / 90 and v = |pitch| / 45:
   `value = (1−u)(1−v)·F + u(1−v)·Y + (1−u)v·P + uv·C`
   - **Why bilinear rather than v103's triangles** (wording corrected, dot 1791683851): a triangle using its three vertices is simply its definition; the whole mesh still passes exactly through all nine views, so no drawing is lost. Bilinear's advantages here are two: there is no diagonal to choose, and an unadjusted (drafted) corner gives back exactly yaw change + pitch change.
   - **On the axes** (u = 0 or v = 0) it is the plain linear blend of two views. At a view it is exactly that view.
   - **A corner exactly as drafted** (C = Y + P − F) gives `F + u(Y−F) + v(P−F)`: yaw and pitch changes add independently. A hand-adjusted corner bends the middle of the cell towards it.
   - **Across quadrant borders, including 0°,** numeric values are continuous (C0) but not smooth (C1), as v103: the speed of change can have a kink there (dot 1791683851). Continuous does not mean the turning speed is smooth.
3. **What is blended, per element:**
   - **point positions:** absolute 2D, by rule 2;
   - **handles:** as vectors from their point (as broadcast and draft treat them), by rule 2; the tip is point + vector;
   - **arc radius:** a number present in every view for an arc row (step 4 gives every view a radius when an arc is made), by rule 2;
   - **end strokes:** see rule 3a;
   - **line width:** a number, by rule 2 (*question 2*);
   - **stroke profile** and anything else discrete: from the dominant view, i.e. the largest weight; ties go to the front, then the yaw view, then the pitch view (*question 2*);
   - **shared structure** (connections, names, order, fills, join modes, visibility, links): one copy, not blended.
4. **Links stay together.** Linked points coincide in every view after settling, and rule 2 uses the same weights for both, so they coincide at every pose. No extra step.
5. **Smooth joins** (*question 1*): the plain vector blend of two aligned handle pairs is in general not exactly aligned between views. Proposal: **no correction in 3a, as an explicit experiment, not a solution** (dot 1791684152). The blend is exact at every view and has no hidden rule, but the size of the bend is **not yet measured**: with handles near zero length, or views that differ a lot, it can be clearly visible. 3a reports the measured bends with examples; the smooth transition between views stays an open question until bowen decides on that report.
6. **Non-linear progress (place for 3b).** In 3a, u and v are used as they are (linear). 3b will add response curves that change the weights; `evaluate`'s input type will gain them then. 3a defines nothing about their keying, so it decides nothing for 3b.

3a. **End strokes, key by key** (dot 1791683897). An end stroke is an open dictionary `{ taper?: number; [key]: number | string }` per point per view, and a view may have none. Only views with weight > 0 at the pose ("contributing views") are looked at.
   - **A key with the same value in every contributing view** (any type): that value.
   - **`taper`, a number in every contributing view:** blended by rule 2. It is the only key this plan treats as continuous; no other number is assumed to be a length or blendable.
   - **Everything else:** the key is taken from the **dominant view** as a whole: present with its value if the dominant view has it, absent if not. This covers: a key missing in some contributing view, a type mismatch, different strings, and different values of any key other than `taper`. A missing value is never treated as 0.
   - So a taper drawn only at the front appears or disappears at the halfway angle, never fades through 0. Whether bowen wants it to grow gradually instead is part of question 2.
   - No combination is refused: every case above has one defined result. A new key that should blend has to be added to this rule by name.

## From pose values to drawn geometry (dot 1791683897)

`evaluate` gives parameters only. The drawn geometry (arc trimming, the inserted arc, fill boundaries) comes from `derived`, the same code every view uses; playback re-derives nothing of its own and never borrows a key view's arcs or fills.

**The read path** (`Core.atPose(p)`, inside `document`):
1. `evaluate(this.model(), p)` → the posed parameters.
2. A **private scratch copy** of the published state (`structuredClone`, as every read already does). In it, a scratch shape layer is added from the front (`net.addShapeLayer`). Its key is chosen to differ from every layer key in the copy (`pose`, then `pose~1`, `pose~2`, … until free), so it can never collide with a layer a file brought in (dot 1791684079).
3. The posed parameters are written into that scratch layer with the existing network / joins writers: positions (`net.setPositions`), handles (`net.setHandles`), width and profile, each arc row's radius, and **every** point's end stroke: set to the posed value, or **cleared** where the posed result has none. Nothing copied from the front is left standing (dot 1791684079).
4. A `LayerReader` over the scratch copy and the scratch layer gives `snapshot()` and `geometry()` exactly as `in(view)` does: `geometry()` is `derived.derive(layer, joins, fills)`.
5. The copy is dropped. Nothing is published, no settle runs on it, and there is no undo step.

**What `derived` reads, and where it comes from at a pose:**
- connections (lines' end points), join modes, fills (routes, colour, visibility, order): shared, one copy, as in every view;
- positions and handles: posed (rule 2);
- arc radii: posed (rule 3), read by `derived` through `joins.rows` on the scratch layer;
- end strokes and width: posed, but `derived` does not read them (its header: "Stroke width, taper, blur and show/hide never change it"); they reach the drawing through `snapshot()`.

**What `atPose` offers:** `snapshot()` and `geometry()` only. Editing reads (`copy`, `nearby`, `pickLoop`, `linesInRect`, `loopsAt`) are not offered while posing; the bench turns editing off.

## Modules and dependencies

- **`src/evaluate`** (new, pure):
  - its own input type `Model`: the views with their yaw / pitch, and per view: per point its position and end stroke (or none); per line its two handle vectors, width, profile; per arc row its radius;
  - `evaluate(model, pose) → Posed` (plain data: the same parameter kinds, one set). It knows nothing of drawing; geometry comes from the read path above;
  - imports only `geometry` (vector maths). It does not import network, document or anything with state.
- **`document`:** one read, `Core.model()`, that builds `evaluate.Model` from the **published** state through the existing per-view reads. No edit, no transaction, no new state.
  - `Core.atPose(p)` → a reader with `snapshot()` and `geometry()`, by the read path above.
- **`bench`:** a playback mode: yaw and pitch sliders, drawing `core.atPose(...)`; snapping a slider to a grid angle shows that view. Bench glue only; its flow is below.


## Bench playback mode: the full flow (dot 1791683911)

Playback promises to change nothing, so every write entry is closed while it is on, not only canvas drags.
- **Entering:**
  - the bench's own pointer gesture, if any, is cancelled (the same path as Esc / lost capture), and its window listeners (`pointermove`, `pointerup`, `pointercancel`, `blur`) are removed;
  - interaction cancels everything in progress, at every level: drag, box selection, a two-step tool's first click (stronger than `viewChanged()`, which keeps level 3);
  - the canvas stops taking pointer input.
- **While posing, every write entry is refused or hidden:**
  - canvas pointer input;
  - keyboard: delete, paste, cut, undo / redo, tool keys, every interaction key. Today's key handler lets keys through when an `<input type="range">` has focus (`bench/src/app.tsx`, the `typing` check), so the playback check comes **first** in that handler, before the typing check: no key reaches interaction or undo while posing, whatever has focus (arrow keys still move the focused slider, natively);
  - buttons and panels that write: layers panel, properties (stroke, end stroke, join), Broadcast stroke / shape, Fit, Draft corners, Open, the demo builders. Save stays (it reads only).
  - **a file read already in flight** (dot 1791684079; ledger row 8, triggered here): disabling Open does not stop a read started before playback from returning during it. Each Open takes a request number and records the bench's mode at the start. When the read returns, it replaces the document only if it is still the latest request **and** playback has not been entered since; otherwise it is dropped (a status message says so). This also closes ledger row 8's original case, an earlier slow read replacing a later one.
- **Leaving:** the view picker shows the last chosen view; editing works as before; no gesture, selection change or undo step came from playback.
- **Not touched:** the edit transaction. These are read-only promises kept by the bench, as dot noted.


## Read entries (ledger row 6, reviewed once here)

Today's reads on `Core`:
- **per view:** `in(view)` → `snapshot`, `geometry`, `copy`, `nearby`, `pickLoop`, `linesInRect`, `loopsAt`;
- **front shortcuts:** the same seven names on `Core` itself, each `in(FRONT).…`; the bench still uses `core.snapshot()` for view-independent data (ids, names, layers, groups);
- **whole document:** `views()`, `pendingLines()`, `lineByName()`.

Proposal for 3a:
- `model()` and `atPose()` are **whole-document reads**: neither takes a view, and neither is a front shortcut.
- The front shortcuts stay for now, documented as "the front, for the single-view entry". Removing them changes every old test and is not needed for playback; the row stays open with that reason, and its next trigger is the next read API or a change to the compatibility entry.

## Read paths

| What | Read from | When |
|---|---|---|
| per-view positions, handles, numbers | the published state, every view | `Core.model()` |
| shared structure | the published state | `Core.model()` |
| the posed parameters | `evaluate`, from the model only | `Core.atPose()` |
| the posed drawn geometry | `derived`, on a scratch layer in a private copy | `Core.atPose().geometry()` |

Nothing is written; there is no draft and no undo step.

## Tests

- **At each of the nine views,** `atPose` equals that view **in both parameters and drawn geometry**: `atPose(v).snapshot()` = `in(v).snapshot()` and `atPose(v).geometry()` = `in(v).geometry()`, exactly. The test drawing has at least one arc join (radius different per view) and one fill (dot 1791683897).
- **Between views, geometry follows the posed parameters:** at a non-view pose, `geometry()` equals `derived.derive` run on a layer holding exactly `evaluate`'s parameters; an arc's trim and a fill's boundary move with the pose (they differ from every key view's).
- **End strokes, each case of rule 3a:** equal in all → kept; `taper` in all → blended; missing in one, type mismatch, different strings, an unknown number that differs → the dominant view's, key present or absent with it; never 0 by default.
- **On an axis** (e.g. yaw 30, pitch 0), every value is the linear blend of the two views on it; the other views have no effect (changing them changes nothing there).
- **Bilinear:**
  - in a cell, with hand-chosen corners, the value equals the formula;
  - with a corner exactly as drafted, `F + u(Y−F) + v(P−F)`.
- **Continuity of numeric values only:** positions, handle vectors, radii, end strokes and width just either side of a quadrant border, 0° included (yaw ±ε, pitch ±ε), differ by O(ε). Discrete values (the profile from the dominant view) are expected to jump and are not part of this test (dot 1791683851).
- **Speed kink, measured:** the one-sided rates of change at 0° and at the pitch-0 border are reported for the bench demo drawings (not pass / fail).
- **Links:** two linked points coincide at sampled poses.
- **Discrete values:** the profile at a pose is the dominant view's; ties resolve as stated.
- **Refusals:** yaw 91, pitch −46, NaN → `pose-out-of-range`.
- **Purity:**
  - `atPose` changes nothing: the saved file, undo history and every view snapshot are equal before and after; the scratch layer never appears in `views()` or in a save;
  - `evaluate` given the same model twice returns equal results;
  - the model is a copy: changing it after `model()` does not change the document.
- **Smooth-join measure** (not a pass / fail; the experiment of rule 5): over a pose grid, the bend angle at every smooth join, reported as the largest and typical values with the worst examples drawn. Cases include handles near zero length and views that differ strongly at the join. The report goes to bowen; it does not close the question.
- **Bench:**
  - the sliders draw the pose; at a grid angle the drawing equals that view;
  - **entering playback during a drag, then a late pointer release:** nothing is committed, no undo step, the drag's preview is gone (dot 1791683911);
  - **with a playback slider focused, Delete / ⌘V / ⌘Z / ⇧⌘Z / a tool key:** nothing changes (state, undo history, tool);
  - the write buttons and panels are disabled while posing;
  - **leaving playback, then a normal edit** (draw a line, drag, undo): works as before;
  - **late file read:** Open starts, playback is entered, the read returns → the document is unchanged and playback goes on; two Opens whose reads return out of order → only the later request opens;
  - **scratch layer:** a file holding a layer keyed `pose` poses correctly and its own `pose` layer is untouched; a point with an end stroke at the front and none in the posed result shows none at that pose.

## Questions

1. **Smooth joins between views** (rule 5): leave the plain blend (proposal), or re-align after the blend as v103 did (`simplexGeometry.ts:228`)? Re-aligning needs a rule for which side gives the direction; our views may also hold deliberately non-aligned smooth joins (both handles held), which a re-alignment would change.
2. **Width and profile between views** (rule 3): blend width as a number and take the profile from the dominant view (proposal), or take both from the dominant view as v103 did (`docs/architecture/fill-depth.md:24`)? This is a visual-intent question for bowen: a width that changes between views, should it grow gradually or switch at the halfway angle? The same question covers a taper drawn in some views only (rule 3a: it switches at the halfway angle).
3. **Scheme** (rule 2): bilinear (proposal) or v103's triangles. dot's check of the reasoning.

## Not in 3a

The in-between correction and response curves (3b), expressions (stage 4), display intervals (not yet in core), matching.
