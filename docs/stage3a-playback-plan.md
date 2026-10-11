# Stage 3a: angle playback and interpolation, read only (plan before code)

**Status:** direction accepted by dot 1791684410 (packages: evaluate + slots; model / atPose; minimal bench). Earlier: first draft, for dot's check (dot 1791682947: playback / interpolation reviewed on its own, separate from the in-between correction, which changes data and comes as stage 3b). Nothing is coded until this passes.

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
2. **Scheme: bilinear in each quadrant** (decided for the current 3 × 3 grid, dot 1791684410; one workable scheme, not claimed to be the only right one; turning speed is not promised to be smooth). For a pose in the quadrant with corners front F, yaw view Y, pitch view P, corner C, with u = |yaw| / 90 and v = |pitch| / 45:
   `value = (1−u)(1−v)·F + u(1−v)·Y + (1−u)v·P + uv·C`
   - **Why bilinear rather than v103's triangles** (wording corrected, dot 1791683851): a triangle using its three vertices is simply its definition; the whole mesh still passes exactly through all nine views, so no drawing is lost. Bilinear's advantages here are two: there is no diagonal to choose, and an unadjusted (drafted) corner gives back exactly yaw change + pitch change.
   - **On the axes** (u = 0 or v = 0) it is the plain linear blend of two views. At a view it is exactly that view.
   - **A corner exactly as drafted** (C = Y + P − F) gives `F + u(Y−F) + v(P−F)`: yaw and pitch changes add independently. A hand-adjusted corner bends the middle of the cell towards it.
   - **Across quadrant borders, including 0°,** numeric values are continuous (C0) but not smooth (C1), as v103: the speed of change can have a kink there (dot 1791683851). Continuous does not mean the turning speed is smooth.
3. **What is blended (geometry), per element, by rule 2:**
   - **point positions:** absolute 2D;
   - **handles:** as vectors from their point (as broadcast and draft treat them); the tip is point + vector;
   - **arc radius:** a number present in every view for an arc row (step 4 gives every view a radius when an arc is made);
   - **shared structure** (connections, names, order, fills, join modes, visibility, links): one copy, not blended.
4. **Links stay together.** Linked points coincide in every view after settling, and rule 2 uses the same weights for both, so they coincide at every pose. No extra step.
5. **Two slots, filled later** (bowen 1791684302: «这些都是交互和渲染的问题 留出slot即可之后再添加»). How appearance changes between views and how smooth joins are treated are interaction / rendering questions. 3a decides neither: it gives each a named place in `evaluate`, a pure function with a fixed signature, and fills it with a **placeholder** that invents nothing. Filling a slot later is meant to stay local to that function, but its inputs may have to grow; that is not guaranteed to touch only one function (dot 1791684410).
   - **Slot A, appearance at a pose:** `appearance(views, weights) → per line width and profile, per point end stroke`. *Placeholder:* everything from the **dominant view** (the largest weight; ties go to the front, then the yaw view, then the pitch view), the end stroke as a whole, present or absent as there. Nothing is blended, and a missing value is never turned into 0. The questions bowen deferred (width growing gradually or switching, a taper drawn in some views only) are answered by filling this slot; dot's requirements for any future rule stand (no silent 0 for a missing value, no number assumed to be a length; dot 1791683897).
   - **Slot B, joins after the blend:** `afterBlend(posed, joins) → posed`. *Placeholder:* nothing changes. The plain vector blend of two aligned smooth pairs is in general not aligned between views, and the bend has **not been measured**; it can be clearly visible with very short handles or views that differ a lot (dot 1791684152). Leaving it is the placeholder, not a solution: smooth transitions stay open until this slot is filled.
6. **Non-linear progress (place for 3b).** In 3a, u and v are used as they are (linear). 3b will add response curves that change the weights; `evaluate`'s input type will gain them then. 3a defines nothing about their keying, so it decides nothing for 3b.

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
- **Slot A placeholder:** at a pose, every line's width and profile and every point's end stroke equal the dominant view's (an end stroke absent there is absent at the pose, even if other views have one); ties resolve as stated.
- **Slot B placeholder:** the posed handles are exactly the blended vectors (nothing re-aligned).
- **On an axis** (e.g. yaw 30, pitch 0), every **geometric** value (positions, handle vectors, radii) is the linear blend of the two views on it; the other views have no effect on them (changing them changes nothing there). Appearance comes from slot A and is not linear (dot 1791684410).
- **Bilinear:**
  - in a cell, with hand-chosen corners, the value equals the formula;
  - with a corner exactly as drafted, `F + u(Y−F) + v(P−F)`.
- **Continuity of blended geometry only:** positions, handle vectors and radii just either side of a quadrant border, 0° included (yaw ±ε, pitch ±ε), differ by O(ε). Appearance from slot A's placeholder is expected to jump and is not part of this test (dot 1791683851).
- **Speed kink, measured:** the one-sided rates of change at 0° and at the pitch-0 border are reported for the bench demo drawings (not pass / fail).
- **Links:** two linked points coincide at sampled poses.
- **Refusals:** yaw 91, pitch −46, NaN → `pose-out-of-range`.
- **Purity:**
  - `atPose` changes nothing: the saved file, undo history and every view snapshot are equal before and after; the scratch layer never appears in `views()` or in a save;
  - `evaluate` given the same model twice returns equal results;
  - the model is a copy: changing it after `model()` does not change the document.
- **Bench:**
  - the sliders draw the pose; at a grid angle the drawing equals that view;
  - **entering playback during a drag, then a late pointer release:** nothing is committed, no undo step, the drag's preview is gone (dot 1791683911);
  - **with a playback slider focused, Delete / ⌘V / ⌘Z / ⇧⌘Z / a tool key:** nothing changes (state, undo history, tool);
  - the write buttons and panels are disabled while posing;
  - **leaving playback, then a normal edit** (draw a line, drag, undo): works as before;
  - **late file read:** Open starts, playback is entered, the read returns → the document is unchanged and playback goes on; two Opens whose reads return out of order → only the later request opens;
  - **scratch layer:** a file holding a layer keyed `pose` poses correctly and its own `pose` layer is untouched; a point with an end stroke at the front and none in the posed result shows none at that pose.

## Questions

1. ~~Smooth joins between views~~ and 2. ~~width / taper between views~~: bowen 1791684302, interaction and rendering, left as slots B and A (rule 5), filled later.
3. ~~Scheme~~: bilinear, dot 1791684410.

## Not in 3a

The in-between correction and response curves (3b), expressions (stage 4), display intervals (not yet in core), matching.
