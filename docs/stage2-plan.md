# Stage 2: shape broadcast from the front, fit, diagonal draft (plan before code)

**Status:** for dot's check (dot 1791679983: rules and flows first). Nothing is coded until dot has checked it.

**Decided inputs (graph "Room, modes and broadcast"):**
- Only the front keeps a hidden baseline: two copies, one for angles and one for expressions. In every other view the shape itself is the bone (bowen 1791647843).
- **Broadcast** is an explicit batch edit for fine-tuning. It adds "front − baseline" to every other view, hand-adjusted ones included, then sets the baseline to the front (offset zero). One undo step (bowen 1791640535, 1791642539, 1791647843; dot 1791647948).
- **Fit** sets the baseline to the front without changing any view; one undo step.
- The baseline changes only by broadcast or fit; hand-adjusting another view never touches it.
- Angle and expression baselines are kept separately (bowen 1791642767). Stage 2 is the **angle** one only; the expression baseline comes with expressions (stage 4).
- Diagonal views are drafted as front + yaw change + pitch change, then adjusted by hand (bowen 1791639688).
- Shared end points move once in a broadcast, and all differences are read before anything is written (dot 1791651293).

## Rules

1. **The record layer.** Every document gets `base:angle`, kind `record`, from creation: a copy of the front. It is not a view: never edited directly, never settled, and checked at open for integrity only (architecture §1).
2. **Owner: the `animation` module** (package 4). It defines `base:angle` and, as its owner, the rules that differ by role:
   - **A new line** (pen) gets the drawn shape in `base:angle` too. Since the front also gets the drawn shape, its baseline starts equal to its front: no unbroadcast change. This lifts step 2's `new-line-needs-owner` refusal for this layer only, through an explicit owner rule passed to network; other non-view layers stay refused.
   - **Paste:** the clip's `base:angle` when it has one, so a copied unbroadcast change is carried, as the candidate "copy keeps baselines as they are". Otherwise the clip's front, so the baseline starts equal to the front. The layer correspondence names it explicitly; nothing is filled silently.
   - **Split, delete, bind, unbind** follow the kind-independent rules of step 2. A split re-expresses the old baseline at the same t; it never updates it to the current front.
   - **An arc's radius** in `base:angle` is not used by broadcast (rule 3 moves points and handles only). The owner rule gives a new arc the front's radius there, which lifts `arc-needs-owner` for this layer.
3. **Broadcast** (`Editor.broadcastShape(units?)`, *name a proposal*).
   - It runs only in a **front edit**, since the front is the source. Elsewhere it is refused (`broadcast-from-front`).
   - **For the chosen lines** (selection or `units`; none: refused, *proposal*), all values read before any write:
     - for each of their points, **once per point**: `d = front(p) − base(p)`;
     - for each of their line ends: the handle difference `front(h) − base(h)`.
   - **In every other view** (8 views, diagonals included), each point moves by its `d` and each handle by its handle difference. An unchosen line that shares a moved point moves with it at that end; its handles stay.
   - **Then** `base:angle := front` for those points and handles.
   - **Strokes, radii and end strokes are not touched;** the stroke broadcast is separate (step 6).
   - **One edit.** Other views are settled by positions only (links, springs), as after any structural change. The front is the edited view and gets its usual settle. A locked line that would change in any view refuses the whole broadcast.
4. **Fit** (`Editor.fit(units?)`): `base:angle := front` for the chosen lines' points and handles. No view changes. One edit and one undo; undo restores the pending difference. Fit on a locked line is allowed (*proposal*): it changes only a record.
5. **"Unbroadcast change" mark:** `core.pendingLines()` lists lines whose points or handles differ between the front and `base:angle`. It is a read; the bench shows it.
6. **Diagonal draft** (`Editor.draftCorners(units?)`, module `views`).
   - For the chosen lines, each corner view (±90, ±45) gets `front + (yaw view − front) + (pitch view − front)`, per point and per handle.
   - It is an explicit edit that overwrites those corners' shapes for those lines (they are then adjusted by hand).
   - Positions-only settle there; a locked line refuses.
   - The baseline is not touched.

## Read paths

| What | Read from | When |
|---|---|---|
| front points / handles (broadcast, fit, mark, draft) | the front of the edit's settled trial (view(): every view settled by positions) | at the operation |
| baseline points / handles | `base:angle` of the draft (records are never settled) | at the operation |
| yaw / pitch views (draft) | the settled trial of those views | at the operation |
| lock check | every view (existing comparison); not records | commit |
| open | `base:angle`: integrity only (every point and line, finite values) | open |

## Write paths

| What | Written to |
|---|---|
| broadcast | every other view's points and handles (`net.setPositions` / `setHandles` on each view handle), then `base:angle` |
| fit | `base:angle` points and handles |
| draft | the corner views' points and handles |
| new line / paste / split / bind / unbind / delete | `base:angle` through the owner rule and the kind-independent rules |

## Tests

- A new line has no unbroadcast change.
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
