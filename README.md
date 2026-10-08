# Point / line / face core (`core/v1`)

A clean, history-free branch that turns the point / line / face relationship graph into code (bowen 1791425592, 1791425798).

- **Spec:** the relationship graph in headset-design `docs/design/review/2026-10-07-architecture-walkthrough.md` (as of `5a6d95c`), and the package plan `docs/design/architecture/20-packages.md` (`633984e`).
- **Nothing is copied** from v103 or the proto. Old code is only read for comparison; any borrowed algorithm is rewritten here and its source noted.
- **No UI.** Pure data in, data out.
- **Module list and acceptance tests** start from dot's draft (dot 1791426280; `Documents/Codex/2026-10-08/task/core-v1`, read-only).
- **Who:** Claude writes; dot re-runs everything on its own machine and reviews the interfaces (bowen 1791426506).

## Modules

Each module is a folder with one `index.ts`. Code outside a module may import **only** that `index.ts`, and only in the allowed dependency direction. `test/boundaries.test.ts` fails on deep imports or wrong-direction imports.

| Module | Owns (data) | Rules it owns |
|---|---|---|
| `geometry` | nothing | Cubic Bézier maths (wraps `bezier-js`), arc fillet, flattening, area, point in polygon |
| `network` | points (position, layer), lines (two point ids + two handles, each relative to its point) | One-time edits on points and lines: add, move, drag handle, split, delete (lines only), **bind** (the only way a point is removed), unbind. Queries: lines at a point, connected groups, simple loops |
| `groups` | continuous-curve identity, per-layer order of groups, line stroke per group | Reconcile identity after topology changes; the merged group keeps the first-clicked group's slot and stroke; a split-off group goes right after the original |
| `joins` | join table per point (pairs of lines with mode smooth / cusp / arc), end stroke per point | Clean rows on topology changes; **solve smooth springs** |
| `links` | cross-layer endpoint links (one relation per pair) | Cross-layer only; on creation the second point moves to the first; **align** = average of the directly acted-on targets |
| `fills` | filled loops (identity, boundary lines, colour, visibility) and fill order | Keep identity through split and bind; drop a fill when its loop stops being one closed walk in one layer; discover unfilled loops on demand. Reordering is within the fill's own group |
| `derived` | nothing (computed) | The **final geometric outline**: centre lines after joins. An arc trims both lines and inserts an arc tangent to both, using the real tangents at the trim points. Lines, fills and picking read the same result. Stroke width, taper and blur never change it. Loop size for picking adds the lobes of a loop that passes a point twice |
| `document` | the whole state, undo / redo | One atomic transaction per edit and the fixed pipeline (below). A thin `Editor` that only calls module operations |

Dependency direction (lower never imports higher):

```
geometry ← network ← groups / joins / links / fills ← derived ← document
```

## Encapsulation (dot 1791427188)

- **Opaque state:** every module's state is opaque to other modules (a branded type). Other modules read it only through query functions.
- **Copies out:** queries return copies; network reads are frozen.
- **Copies in:** inputs are copied before they are stored, and non-finite coordinates are refused.
- **Tests:**
  - `test/encapsulation.typecheck.ts` must fail to compile wherever outside code tries to write. `test/typecheck.test.ts` runs `tsc` inside `vitest run`, so this is part of the test suite.
  - `test/encapsulation.test.ts` checks the same at runtime.

## Transactions (dot 1791427515)

- **Scope:** an `Editor` is valid only inside its own `edit`; afterwards every call throws.
- **No re-entry:** `edit`, `undo` and `redo` are refused while an edit runs.
- **Atomic:** the edit works on a private copy, published only after the pipeline succeeds. A throw or `cancel()` publishes nothing.

## Ids (dot 1791427637)

- **Never reused:** point and line ids are never reused within a document, deleted ones included. So a filled loop's identity can never be taken over by a new loop.
- **Boundary keys** use a JSON encoding, so no id can collide through a separator.
- **Order** lists are arrays of entries, so any string is a safe id.

## The pipeline (every edit)

1. Each operation is applied to a private copy of the state. The network reports what changed (lines replaced by a split, collapsed or deleted lines, merged or deleted points, directly moved points, held handles), and each attribute module updates its own references.
2. Before commit, in a fixed order:
   1. `links.align`
   2. `joins.solve`
   3. `fills.validate`
   4. `groups.reconcile`
3. If anything throws, or the edit is cancelled, nothing is published. One edit is one undo step.

## Conventions

- Handles are offsets from their own point, so moving a point carries its handles.
- **Loop enumeration** stops at `LOOP_LIMIT` (10 000) per document (bowen: a layer never holds very complex networks). Past that, unfilled loops beyond the limit are not offered.
- **Open (asked bowen 1791427416):** should a point left with no line after a delete stay? Until bowen decides, it stays; only binding removes points.
- Every order list is bottom-to-top: index 0 is drawn first.
- **Smooth springs** use an angle-based energy, so 3 mutually smooth lines settle at 120° and 4 at 90°. A handle dragged in this edit is held. The stiffness is one global constant (bowen 1791421988).
- **Not in v1:**
  - **Later by bowen:** deformation, mirror editing, show/hide intervals, views / snapshots, and cut-and-paste between recordings that keeps line ids (bowen 1791392233).
  - **Implementation staged (not yet written):**
    - copy in drawing;
    - joins across a link (stored on the link);
    - stroke rendering;
    - how a fill joins at a fork with an arc on another pair (left open, dot 1791425335). For now, such a fill keeps that line end untrimmed.
