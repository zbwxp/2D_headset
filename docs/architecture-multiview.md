# Multi-view architecture (draft for dot's attack, before any code)

**Why this file exists:** bowen 1791650867 / 1791650882 — "现在还不能说代码框架可以建立起来了吧？要坚持住别再最关键的地方变成屎山了". My first stage-1 split (`meta-views-plan.md` §5a, e47c4bd) put the nine views into the existing `network` module, which already owns the most; that is withdrawn (Claude 1791650945). This file defines the packages, what data each owns, their interfaces and dependency direction, and walks every stage's flows on paper, so stage 1's data serves stages 2–4 without being torn up.

**Decided inputs:** graph tables "Models and 元组件" … "Matching" and row "Names" (headset-design); bowen 1791650085 (order shared, stroke per view + broadcast), 1791650171 / 1791650206 (stroke broadcast = assignment, a batch edit), 1791650323 (Q1 bind in all views, Q2 auto-bind judged only in the edited view, mirror at 0,0 only), 1791650828 (shared topology + per-view data). Items marked *proposal* are our filled-in defaults; *open* items are not coded.

## 1. The one idea: structure once, shapes in layers

Split the drawing into two kinds of data:

- **Structure (one copy):** layers, points, lines, which line ends at which point, element state, joins (mode), links, fills, continuous curves, names, order, mirror pairs.
- **Shapes (several copies, called shape layers / 形状层):** for every point its position, for every line its two handles and its stroke, for every point its end stroke, for every arc join its radius.

Shape layers, each covering the whole structure:

| Shape layer | What it is | Stage |
|---|---|---|
| `view:Y,P` × 9 | the shape in each of the nine views | 1 |
| `base:angle` | hidden front baseline for angle broadcast | 2 |
| `base:expr` | hidden front baseline for expression broadcast | 4 |
| `expr:<id>` | an expression's "1" shape, made at the front | 4 |

**Rule A (structure → every shape layer):** each structural change is decided once, on the structure, and then updates **every** shape layer by one fixed rule:
- a new line is copied from the layer it was drawn in;
- a split uses the same t in each layer;
- a bind keeps the first-clicked point's position in each layer (Q1);
- an unbind takes the old position + the same offset;
- a delete removes the line's entries;
- a paste writes the clip's layers, plus the offset.

Because baselines and expressions are shape layers too, they follow splits, binds and pastes with no extra code.

**Rule B (single-view algorithms stay single-view):**
- Springs, link alignment, overlap detection, outlines and picking, transforms, mirror correspondence and the lock comparison keep working on "the structure + one shape layer".
- They are not told that there are nine views.

## 2. Packages and modules

Dependencies point downward only; `test/boundaries.test.ts` is extended to enforce them.

**Package 1 — drawing core** (`src/`, single-view algorithms):

| Module | Owns | Change from today |
|---|---|---|
| `geometry` | nothing | unchanged |
| `topology` *(new, split out of `network`)* | layers (id, name, order), points (id, layer), lines (id, a, b, element state), used ids | the structural half of today's `network`: add / split / delete / bind / unbind / move-to-layer / insert, isolated removal, linesAt / components / closedWalk / closedLoops. Each operation returns a **complete structural record** (also new lines and inserts; dot 1791649528: today's `Changes` is partial). |
| `shapes` *(new)* | shape layers: position per point, handles + stroke per line, end stroke per point, radius per arc join | Storage, plus Rule A: how each structural record updates every layer. Knows nothing of views, baselines or expressions: a layer is just a key. |
| `network` *(becomes a façade)* | nothing of its own | `net.of(state, layer)` → a handle bound to **this state and this layer** (dot 1791649915: no global switch). Today's read API (`point`, `line`, `curve(s)`, `points`, `lines`) and geometry writes (`move`, `moveHandle`, `aimHandle`, `setPositions`, `setHandles`) act on that layer; structural calls go to `topology`, then `shapes` applies Rule A. Geometric intents (targets, held handles, tips) are recorded **per layer** (dot 1791650432). |
| `groups`, `joins`, `links`, `fills`, `derived`, `locks`, `editing`, `apply`, `names`, `clipboard` | as today | They take a layer-bound handle where they read geometry. `joins` keeps modes; radius and end strokes move to `shapes`. `locks` compares one layer; the caller loops. `clipboard` carries every layer. `names`: line (and, to confirm, group) names unique within their layer. |

**Package 2 — meta structure** (`src/meta`, new):
- **Owns the rules, not a second state** (dot 1791650999): types, names and copy results live in the one document state, under the same undo, rollback and save. `meta` keeps its part of that state, opaque like every module, and has no store outside the document transaction.
- **Its state:** the 元组件 type of each layer.
- **Rules:**
  - 元线条 identity = (layer, line name), kept through renames since ids do not change;
  - lookup by identity;
  - copying a whole 元组件 keeps the line names.
- **Depends on:** topology, names. Nothing in package 1 depends on it.

**Package 3 — multi-view editing** (`src/views`, new):
- **Owns:** the nine view keys and the front (`0,0`); which shape layer an edit writes; which layers an edit changed (from the per-layer intents and Rule A).
- **Settle orchestration:**
  - the **full** settle (with auto-bind, Q2) only on the edited layer;
  - **positions-only** settle (links, springs, tips) on every other changed view or expression layer;
  - none on baseline layers, which are records.
- **Also:** stroke broadcast (assign one layer's stroke values to the other views for chosen lines). Diagonal draft (stage 2: front + (yaw view − front) + (pitch view − front), written into a corner view).
- **Depends on:** network façade, shapes.

**Package 4 — animation making** (`src/animation`, new; stage 2 and 4):
- **Owns:** expression definitions (id, name, lines). The meaning of `base:*` and `expr:*` layers.
- **Rules:**
  - broadcast to views / expressions: `target += front − base`, then `base := front`;
  - fit: `base := front`;
  - the "unbroadcast change" mark: `front ≠ base`;
  - a new line's baselines start equal to its front.
- **Depends on:** views, shapes.

**Package 5 — evaluation** (`evaluate/`, a separate package like `interaction/`, stage 3):
- **Interface:** pure, `evaluate(model, { yaw, pitch, expressions }) → shapes`.
- **Input:** structure + view layers + expression layers as plain data, in a type the package defines itself.
- **Angle:** piecewise bilinear over the 3 × 3 grid.
- **Expressions:** the difference `expr:<id> − front`, carried by the angle level. *Open: the carry algorithm; verified by experiment.*
- **Depends on:** `geometry` only. Used by playback and, later, runtime.

**Package 6 — document and edit transaction** (`src/document`):
- **Owns:** the whole state (topology, shapes, groups, joins, links, fills, selection, apply, names, meta, animation) and undo / redo.
- **`Core.edit(fn, { layer })`:** the edit's target layer, explicit and given by interaction. **No default** (dot 1791650999): a multi-view call without a layer is refused, never silently the front. The old single-view entry used by today's tests is a separate, isolated compatibility layer that names `view:0,0` itself.
- **Pipeline:** structural ops → Rule A; `views` settle orchestration; names check; lock check for every view and expression layer (not baselines); publish; one undo step.
- **Reads per layer:** `snapshot(layer)`, `geometry(layer)`, `nearby(layer, …)`.
- **`afterApply`'s scratch settle** uses the same orchestration.

**Package 7 — file** (`src/archive`):
- Saves structure + every layer.
- Open checks structure, references and each layer's state (links coincide, positions-only settle changes nothing). It triggers **no new auto-bind** (Q2; dot 1791650402).

**Outside `src/`:** `interaction/` holds the current mode and current layer (view or expression), and passes the layer to every edit. `visual/` and `bench/` are throwaway glue.

```
geometry ← topology ← shapes ← network(façade) ← groups/joins/links/fills ← derived/locks/editing/apply/names ← clipboard
        ← views ← animation ← meta(names, topology) ← document ← archive
evaluate: geometry only
```

**What happens to today's `network` (809 lines):** it is split into `topology` (structure), `shapes` (layered geometry) and a thin façade. Its rules do not change; its tests are kept and rerun through the façade on `view:0,0`.

## 3. Flows on paper (all stages)

Each line: what acts → which layers change → which settle runs.

1. **Draw a line in view 90,0 (stage 1).** `topology.addLine` → Rule A copies the drawn geometry into every layer. Full settle on `view:90,0` (an end snapped onto a point binds; Rule A keeps the first point per layer). Positions-only settle on the other views. Locks: every view.
2. **Drag a point at the front.** The geometric intent is on `view:0,0` only. Full settle there. Other layers are untouched.
3. **Split in a side view.** `topology.split` → Rule A: the same t in every layer. No view's drawing changes.
4. **Manual bind in a side view (Q1).** `topology.bind` → in each layer the kept point keeps its position, and the removed point's lines now end there (their handles keep their offsets). Positions-only settle in the other views (springs at that point).
5. **Delete in any view.** `topology.delete` → entries leave every layer. Undo restores the whole state.
6. **Paste** (clip carries every layer). Insert writes every layer + offset. Full settle on the edited layer, positions-only on the others.
7. **Copy a whole 元组件.** As 6, plus `meta` keeps names and type.
8. **Stroke broadcast (stage 1).** `views` assigns the edited view's stroke to the other views for the chosen lines. One edit; a locked line refuses it.
9. **Mirror apply at 0,0.** `apply` runs on `view:0,0`. Its paired splits / deletes go through `topology` → Rule A reaches every layer. The stroke and end strokes it copies are front-layer values. Join modes and fill state are structure.
10. **Angle broadcast (stage 2).** `animation`: for the chosen lines' points and handles, every view ≠ front `+= front − base:angle`, then `base:angle := front`. Positions-only settle on the changed views. The lock check refuses if a locked line would change in any view. Repeating with no new change moves nothing.
11. **Fit (stage 2).** `base:angle := front` for the chosen lines. Views do not change. Undo restores the pending offset.
12. **Diagonal draft (stage 2).** `views` writes `front + (yaw view − front) + (pitch view − front)` into a corner view. Positions-only settle there.
13. **Make an expression (stage 4).** Create a definition → its `expr:<id>` layer starts equal to the front for its lines. Editing it is `Core.edit(fn, { layer: 'expr:<id>' })`: a full settle there (auto-bind there too, since it is the edited layer).
14. **Expression broadcast (stage 4).** Every expression layer `+= front − base:expr`, then `base:expr := front`. Angle and expression baselines never clear each other.
15. **Playback (stage 3, 4).** `evaluate(model, params)`: the angle interpolation of the view layers, plus the expression differences carried by the angle level (carry algorithm *open*).
16. **Save, reopen, continue.** Every layer is saved. Open checks without new auto-bind; a chance coincidence in a side view stays two points. Broadcast after reopening gives the same result.
17. **Undo of anything above.** The whole state is one draft, so every layer goes back together.

## 3a. Interpolation between views is adjustable (bowen 1791650951, 1791651008, 1791651097, 1791651109)

**Requirement:**
- Between two views (e.g. 0 → 90), the change need not be linear.
- bowen moves to any angle, not only 30° or 60°, and adjusts it there.
- 0,0 never moves.
- If needed, the 90° side may move minimally, which changes that view.

**What v103 did** (7205381: `src/domain/recordingSnapshot/surfaceTargets.ts`, `surfaceBasisFallback.ts`; dot 1791338157, 1791338275):
- **No new geometric key; a response curve instead.**
  - On each segment, every node and every handle vector has, **per axis (x, y)**, a response curve: progress along the segment → how close to the far view.
  - Linear = no knots.
  - Editing at an intermediate angle: drag to the wanted shape. Per node / handle / axis, the closest weights are solved (`solveClosestBarycentricWeights`) and stored as a knot at that progress (`edgeResponses`; triangles: interior samples).
- **Fallback when an axis cannot move** (`SURFACE_AXIS_UNAVAILABLE`: the two views have the same coordinate on that axis):
  - The "bounded basis adjustment" keeps the 0° view fixed and moves the ±90° view minimally, within a trust radius (`SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS`).
  - It is a coupled correction draft, to be saved or discarded.
  - It is supported only on the edge 0° → cardinal ±90°.
- **Arc radius and join / brush changes** are refused in a response correction ("edit … in a saved snapshot basis first").

**bowen's rules from 2026-10-03/04, found by dot (1791651254):**
- 30° / 60° are back-solved correction frames, not separate snapshots.
- 0° never moves.
- Keep 90° fixed and adjust the response first. Only if the target is still unreachable may 90° move, minimally.
- Moving end points is penalised more than moving handles: a weighting, not a ban.

The new request (1791651008) extends the correction position to any angle. So this is "edit at an in-between angle → back-solve the response, and the end views allowed to change". It is **not** "store one more in-between shape" (dot 1791651182).

**In this framework** (to confirm with bowen, asked 1791651207):
- **Response curves** are animation data owned by `animation` (package 4); `evaluate` reads them. They are not shape layers.
- **Editing at an in-between angle** is an edit:
  - it solves response knots;
  - where an axis is unavailable, it moves the 90° view layer minimally;
  - it goes through the lock check;
  - it is one undo step.
- **Structural changes need a rule for response curves** (*open*): a split's new point, a bind's kept point, a new line (linear by default?).
- **Grid** (*open*): v103 triangulated the angle domain (edges + triangles); §2 says bilinear over the 3 × 3 grid. Which one, and where response curves live (edges only, or interiors too), is decided before stage 3.

## 3b. Build constraints (dot 1791650999, written for the withdrawn §5a; they apply here)

1. **No intermediate version loses data.** Saving and the clipboard must carry every layer by the time any multi-view editing entry is public. Until then, no multi-view public entry, and the old entry never silently saves only the front.
2. **No second state:** see `meta` above.
3. **Every new interface names its layer;** the 0,0 compatibility entry is isolated, and trial, read and lock comparison are bound to a state and a layer.
4. **Proposals and acceptance are aligned:**
   - which proposals are adopted (split at the same t, unbind offset, per-view arc radius…) is stated before each step;
   - lifting old single-view files to nine views is a separate compatibility decision, not part of step 1;
   - "existing tests pass" means unchanged rules do not regress, and tests of intentionally changed rules (name scope, no auto-bind at open) are updated explicitly.

**First step, if this framework passes:**
- view definitions;
- isolated layered storage (`shapes`);
- the state + layer bound accessor.

Tests for it:
- the old front regression;
- different layers never share data;
- different documents and trial copies never share data;
- a failed edit rolls back whole.

No multi-view save or copy behaviour is exposed in this step. Passing step 1 does not accept the later steps.

## 4. What this needs from dot's attack

1. Is the `topology` / `shapes` / façade split right, or is a façade over two stores itself a hidden coupling?
2. Is Rule A complete? Are there structural changes whose per-layer rule is not mechanical: arc joins at a bind, links whose partner is removed, insert with offset on baseline layers?
3. Lock scope: views and expression layers are protected; baselines are not (fit on a locked line is allowed). *Proposal.*
4. Expression layers get a full settle when edited and positions-only after structural changes. Is that consistent with the view layers?
5. Undo cost: the whole state is cloned per edit, now with about 9–12 layers. Acceptable for one character, or not?

## 5. Still open for bowen (not blocking this framework)

- The right-side mirror draft row.
- Continuous-curve name scope.
