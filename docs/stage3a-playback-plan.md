# Stage 3a: angle playback and interpolation, read only (plan before code)

**Status:** first draft, for dot's check (dot 1791682947: playback / interpolation reviewed on its own, separate from the in-between correction, which changes data and comes as stage 3b). Nothing is coded until this passes.

**Ledger check** (`docs/consolidation-ledger.md`):
- Row 1 (commit settling by name lists) is not triggered: playback writes nothing.
- **Row 6 is triggered** (dot 1791683214: the next new read API reviews all read entries together). 3a adds `Core.model()` / `Core.pose()`, so it includes that review; see "Read entries" below.

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
   - **arc radius and end-stroke lengths:** numbers, by rule 2;
   - **line width:** a number, by rule 2 (*question 2*);
   - **stroke profile** and anything else discrete: from the dominant view, i.e. the largest weight; ties go to the front, then the yaw view, then the pitch view (*question 2*);
   - **shared structure** (connections, names, order, fills, join modes, visibility, links): one copy, not blended.
4. **Links stay together.** Linked points coincide in every view after settling, and rule 2 uses the same weights for both, so they coincide at every pose. No extra step.
5. **Smooth joins** (*question 1*): the plain vector blend of two aligned handle pairs is in general not exactly aligned between views. Proposal: **no correction in 3a**. The blend is exact at every view and has no hidden rule. The bench measures the largest angle error at smooth joins on bowen's drawings; if it shows, 3b or a follow-up decides.
6. **Non-linear progress (place for 3b).** In 3a, u and v are used as they are (linear). 3b will add response curves that change the weights; `evaluate`'s input type will gain them then. 3a defines nothing about their keying, so it decides nothing for 3b.

## Modules and dependencies

- **`src/evaluate`** (new, pure):
  - its own input type `Model`: the view keys with yaw / pitch, and per view, per point its position; per line its two handle vectors, width, profile; per arc row its radius; per point its end strokes; plus the shared structure needed to draw (lines' end points);
  - `evaluate(model, pose) → Shapes` (plain data, the same shape as one view's read);
  - imports only `geometry` (vector maths). It does not import network, document or anything with state.
- **`document`:** one read, `Core.model()`, that builds `evaluate.Model` from the **published** state through the existing per-view reads. No edit, no transaction, no new state.
  - `Core.pose(p)` = `evaluate(this.model(), p)`, a read like `in(view).snapshot()`.
- **`bench`:** a playback mode: yaw and pitch sliders, drawing `core.pose(...)`; editing is off while posing; snapping a slider to a grid angle shows that view. Bench glue only.

## Read entries (ledger row 6, reviewed once here)

Today's reads on `Core`:
- **per view:** `in(view)` → `snapshot`, `geometry`, `copy`, `nearby`, `pickLoop`, `linesInRect`, `loopsAt`;
- **front shortcuts:** the same seven names on `Core` itself, each `in(FRONT).…`; the bench still uses `core.snapshot()` for view-independent data (ids, names, layers, groups);
- **whole document:** `views()`, `pendingLines()`, `lineByName()`.

Proposal for 3a:
- `model()` and `pose()` are **whole-document reads**: neither takes a view, and neither is a front shortcut.
- The front shortcuts stay for now, documented as "the front, for the single-view entry". Removing them changes every old test and is not needed for playback; the row stays open with that reason, and its next trigger is the next read API or a change to the compatibility entry.

## Read paths

| What | Read from | When |
|---|---|---|
| per-view positions, handles, numbers | the published state, every view | `Core.model()` |
| shared structure | the published state | `Core.model()` |
| the pose result | `evaluate`, from the model only | `Core.pose()` |

Nothing is written; there is no draft and no undo step.

## Tests

- **At each of the nine views,** `pose` equals that view's own snapshot (positions, handles, width, radius) exactly.
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
  - `pose` changes nothing: the state, undo history and every view snapshot are equal before and after;
  - `evaluate` given the same model twice returns equal results;
  - the model is a copy: changing it after `model()` does not change the document.
- **Smooth-join measure** (not a pass / fail): the largest angle error at smooth joins over a pose grid, reported for the bench demo drawings.
- **Bench:** the sliders draw the pose; at a grid angle the drawing equals that view; editing is off while posing.

## Questions

1. **Smooth joins between views** (rule 5): leave the plain blend (proposal), or re-align after the blend as v103 did (`simplexGeometry.ts:228`)? Re-aligning needs a rule for which side gives the direction; our views may also hold deliberately non-aligned smooth joins (both handles held), which a re-alignment would change.
2. **Width and profile between views** (rule 3): blend width as a number and take the profile from the dominant view (proposal), or take both from the dominant view as v103 did (`docs/architecture/fill-depth.md:24`)? This is a visual-intent question for bowen: a width that changes between views, should it grow gradually or switch at the halfway angle?
3. **Scheme** (rule 2): bilinear (proposal) or v103's triangles. dot's check of the reasoning.

## Not in 3a

The in-between correction and response curves (3b), expressions (stage 4), display intervals (not yet in core), matching.
