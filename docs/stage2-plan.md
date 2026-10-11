# Stage 2: shape broadcast from the front, fit, diagonal draft (plan before code)

**Status:** revised after dot 1791680111, 1791680149, 1791680195 (rules 0, 2, 3, 6 and the read paths). For dot's next check; nothing is coded until it passes.

**Decided inputs (graph "Room, modes and broadcast"):**
- Only the front keeps a hidden baseline: two copies, one for angles and one for expressions. In every other view the shape itself is the bone (bowen 1791647843).
- **Broadcast** is an explicit batch edit for fine-tuning. It adds "front − baseline" to every other view, hand-adjusted ones included, then sets the baseline to the front (offset zero). One undo step (bowen 1791640535, 1791642539, 1791647843; dot 1791647948).
- **Fit** sets the baseline to the front without changing any view; one undo step.
- The baseline changes only by broadcast or fit; hand-adjusting another view never touches it.
- Angle and expression baselines are kept separately (bowen 1791642767). Stage 2 is the **angle** one only; the expression baseline comes with expressions (stage 4).
- Diagonal views are drafted as front + yaw change + pitch change, then adjusted by hand (bowen 1791639688).
- Shared end points move once in a broadcast, and all differences are read before anything is written (dot 1791651293).

## Rules

0. **Stage boundary: these operations stand alone in their edit** (dot 1791680149, 1791680195).
   - Broadcast, fit and the diagonal draft each run **when called**, on the version they read then; nothing is moved to the end of the edit.
   - An edit may hold **one** of them, plus only selections (`select`, `selectGroup`) and stroke broadcasts.
   - Any other geometric or structural operation in the same edit, or two of them, refuses the whole edit (`stage2-alone`). This is a stated boundary of this stage, not a silent reordering.
   - **Consequence for reads:** nothing before them in the edit can change geometry, so they read the **draft** directly. It equals the published, settled state, and the front is not settled again. There is no "settled trial front" that differs from what is committed (dot 1791680195).
   - **Consequence for settling:** the front is not settled (no auto-bind, so fit keeps every legal coincidence). Only the views these operations wrote are settled, by positions only.

1. **The record layer.** Every document gets `base:angle`, kind `record`, from creation: a copy of the front. It is not a view: never edited directly, never settled, and checked at open for integrity only (architecture §1).
2. **Owner: the `animation` module** (package 4). It defines `base:angle` and, as its owner, the rules that differ by role:
   - **A new line** (pen): only what is **new** is initialised in `base:angle`, its new end points and its handles, with the drawn shape. An **existing** end point keeps its baseline, so its own pending change is not swallowed (dot 1791680195). Its baseline starts at those initial values. A pending change can then appear in two ways: inherited from an existing end point, or its own, once the front's settling (springs, links, mirror at the front) changes its shape after it is drawn (dot 1791680315). This lifts step 2's `new-line-needs-owner` refusal for this layer only, through an explicit owner rule passed to network; other non-view layers stay refused.
   - **Paste:** the clip's `base:angle` when it has one, so a copied unbroadcast change is carried, as the candidate "copy keeps baselines as they are". Otherwise the clip's front, so the baseline starts equal to the front. The layer correspondence names it explicitly; nothing is filled silently.
   - **Split, delete, bind, unbind** follow the kind-independent rules of step 2. A split re-expresses the old baseline at the same t; it never updates it to the current front.
   - **An arc's radius** in `base:angle` is not used by broadcast (rule 3 moves points and handles only). The owner rule gives a new arc the front's radius there, which lifts `arc-needs-owner` for this layer.
3. **Broadcast** (`Editor.broadcastShape(units?)`, *name a proposal*).
   - It runs only in a **front edit**, since the front is the source. Elsewhere it is refused (`broadcast-from-front`).
   - **For the chosen lines** (selection or `units`; none: refused, *proposal*), all values are read from the draft before any write:
     - for each of their points, **once per point**: `d = front(p) − base(p)`;
     - for each of their line ends: `front(h) − base(h)`, where a handle is the **vector from its end point**, not its absolute tip.
   - **Linked end points** (endpoint links across layers) must be broadcast together (dot 1791680195).
     - If a chosen point has a link partner that is not an end of a chosen line, the broadcast is refused (`broadcast-link-incomplete`). Broadcasting one side would let the link pull the other side along in the targets, and a later broadcast of the other side would push it twice.
     - If linked points' differences are not equal, it is refused too (`broadcast-link-mismatch`).
     - Then both sides move by the same `d`, and both baselines are consumed together. There is no rule yet for consuming another line's pending change through a link, so it is refused, never cleared silently.
   - **In every other view** (8 views, diagonals included), the writes go through the same entries as a user's edit there, so links and springs see them:
     - each point by `net.move` on that view's handle, which records a target in that layer;
     - each handle by `net.moveHandle` with its old vector + its difference, which records it as held in that layer.

     No handle tips exist in such an edit (rule 0). An unchosen line sharing a moved point follows at that end with its handle vector kept, then springs settle it as after any move.
   - **Zero differences write nothing** (dot 1791680326): a point whose `d` is 0, or a handle whose difference is 0, gets no `move` / `moveHandle` (which would mark it held and could turn an unchosen smooth neighbour). If every difference is 0, the broadcast writes nothing, runs no settling in the targets and adds no undo step.
   - **Then** `base:angle := front` for exactly those points and handles.
   - **Strokes, radii and end strokes are not touched;** the stroke broadcast is separate (step 6).
   - **One edit.** Only the views it wrote are settled, by positions only (links, springs); the front is not settled (rule 0). A locked line that would change in any view refuses the whole broadcast.
4. **Fit** (`Editor.fit(units?)`): `base:angle := front` for the chosen lines' points and handles. No view changes. One edit and one undo; undo restores the pending difference. Fit on a locked line is allowed (*proposal*): it changes only a record.
   - **Fit needs the complete link scope too** (dot 1791680315). A fit of one linked side alone would leave the two baselines different, and a later broadcast of both would be refused with no clear reason. So a fit where a chosen point's link partner is not an end of a chosen line is refused (`fit-link-incomplete`), with the partner named in the refusal.
5. **"Unbroadcast change" mark:** `core.pendingLines()` lists lines whose points or handles differ between the front and `base:angle`. It is a read; the bench shows it.
6. **Diagonal draft** (`Editor.draftCorners(units?)`, module `views`).
   - For the chosen lines, each corner view (±90, ±45) gets `front + (yaw view − front) + (pitch view − front)`, per point and per handle.
   - It is an explicit edit that overwrites those corners' shapes for those lines (they are then adjusted by hand).
   - It writes through `net.move` / `net.moveHandle` on each corner's handle, so each corner records its own targets and held handles (dot 1791680195). Positions-only settle there; a locked line refuses.
   - It stands alone in its edit (rule 0), so no earlier target or tip in the same edit can overwrite the draft at settling.
   - The baseline is not touched.

## Read paths

| What | Read from | When |
|---|---|---|
| front points / handles (broadcast, fit, draft) | the draft's front: equal to the published, settled front, since nothing earlier in the edit changes geometry (rule 0) | at the operation |
| baseline points / handles | `base:angle` of the draft (records are never settled) | at the operation |
| yaw / pitch views (draft) | the draft's views (same reason) | at the operation |
| mark | the published front and `base:angle` | read |
| lock check | every view (existing comparison); not records | commit |
| open | `base:angle`: integrity only (every point and line, finite values) | open |

## Write paths

| What | Written to |
|---|---|
| broadcast | every other view's points (`net.move`) and handles (`net.moveHandle`, handle vectors) on that view's handle, recording intents there; then `base:angle` |
| fit | `base:angle` points and handles |
| draft | the corner views' points (`net.move`) and handles (`net.moveHandle`) on each corner's handle |
| new line / paste / split / bind / unbind / delete | `base:angle` through the owner rule and the kind-independent rules |

## Tests

- A new line's baseline equals its initial values. Drawn from an existing end point with a pending change, that point keeps it and the new line shows it. A front spring that turns the new line's handle afterwards gives it its own pending change.
- Fit of one linked side alone is refused, naming the partner (`fit-link-incomplete`); both sides together are fitted together.
- Every refusal of this stage names its reason and objects: `stage2-alone`, `broadcast-link-incomplete`, `broadcast-link-mismatch`, `fit-link-incomplete`, `broadcast-from-front`.
- Stage boundary: broadcast / fit / draft together with a move or a structural edit, or with each other, is refused whole; with selections or a stroke broadcast, it is allowed.
- Links: broadcasting one of two linked lines alone is refused. Both together move both by the same difference in every view, consume both baselines, and a second broadcast moves nothing ("two separate broadcasts of two linked lines" from dot 1791680195 → the first is refused).
- Springs: a broadcast of one line whose end has a smooth join with an unchosen line settles that join in each target view.
- Zero difference (dot 1791680326): a target view keeps a non-aligned smooth join whose two handles were both held when set; after a fit at the front, broadcasting one of those lines changes no view and adds no undo step.
- **Broadcast:**
  - moving a front point then broadcasting moves it by the same difference in all eight other views, hand-adjusted ones included;
  - a second broadcast moves nothing;
  - undo restores the views and the baseline together;
  - a shared end point of two chosen lines moves once;
  - an unchosen neighbour's end follows its point;
  - it is refused off the front, and refused for a locked line in any view.
- **Fit:** the picture is unchanged, the mark clears, and undo brings back the pending difference.
- **Records:** a split re-expresses the baseline (no change appears); copy / paste carries the baseline as is; save / open keeps it.
- **Draft:** the corner equals front + yaw change + pitch change; other views and the baseline are unchanged.
- **Mark:** lists exactly the lines whose front differs from the baseline.

## Not in stage 2

The expression baseline (stage 4), angle playback and in-between corrections (stage 3), matching.
