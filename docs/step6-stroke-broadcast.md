# Step 6: stroke broadcast (plan before code)

**Status:** checked by dot 1791655825 with two corrections (rules 1 and 4 below, and the auto-bind scope); coding starts with them.

**Decided input:**
- bowen 1791650085: line width and stroke may differ per view; a button broadcasts them to the other views, so they need not be set nine times.
- bowen 1791650171: a plain assignment.
- bowen 1791650206: a batch edit.

It is separate from the shape broadcast (offsets, baselines; stage 2).

## Rules

1. **What is copied: the chosen lines' own strokes, plus the end strokes at their end points** (dot 1791655825). The edited view's values are assigned to every other **view** layer; expression and record layers are not written, since their owners decide later.
   - Each chosen line's own stroke (width, profile).
   - The end strokes at the chosen lines' end points, written **once per point** (deduplicated), *proposal*: bowen's "笔触" read as including the tapers. A point with no end stroke in the edited view clears it in the others, since an assignment makes them equal.
   - An end point may be shared with an unchosen line. That line's own width and profile stay, but the shared point's end stroke is assigned like any other: no promise that shared point attributes stay.
   - All source values are read before any write; the source view is not written.
2. **Not copied:** shapes (positions, handles), arc radii (*proposal*: a radius is a join's geometry, not 笔触), join modes, links, fills.
3. **Which lines:** the selected lines, or explicit `units` (as transforms and delete take them). Points or handles alone, or nothing, are refused (`select-lines-to-broadcast`), as delete refuses them.
4. **One edit:** one undo step, through the usual commit. A locked line whose stroke or free-end end stroke would change in any view refuses the whole edit (locks per view, existing comparison).
   - **An edit that only broadcasts strokes** (and selects) changes no position or topology, so it skips the settling that does: no auto-bind, no position solve. It keeps the same commit, checks, locks and undo (dot 1791655898). A legal coincidence left by edits in other views therefore stays.
   - Any other operation in the same edit gets the full flow as before. The test is "only broadcasts", never "a broadcast happened".
   - Whether auto-bind in general should only consider what an edit touched is **a separate later proposal**, not part of this step. Q2 decided only which view counts (dot 1791655898). An earlier version of this plan (579fec4) and commit 5f99f0a changed it globally; that is withdrawn.
5. **Mirror:** no pairing. It writes only the chosen lines in other views; a mirror link (front only) is not involved.
6. **Where:** module `views` (package 3), called by a thin `Editor.broadcastStroke(units?)`. `views` then depends on `network` and `joins`.

## Read paths

| What | Read from | When |
|---|---|---|
| chosen lines | the selection, or `units` (expanded as for delete) | at the operation |
| stroke | the edited view's layer of the draft (strokes are not settled by the pipeline, so draft = settled) | at the operation |
| end strokes at the lines' end points | the edited view's layer (joins / shapes) | at the operation |

## Write paths

| What | Written to |
|---|---|
| stroke | `net.setLineStroke` on each other view's handle |
| end stroke | `joins.setEndStroke` / `clearEndStroke` on each other view's handle |

## Tests

- Different strokes and end strokes per view; broadcasting from a side view makes every view equal to it for the chosen lines only.
- Other lines and the edited view are unchanged.
- Shapes and radii are unchanged.
- One undo restores every view's different values.
- A locked line refuses the whole broadcast and writes nothing.
- Nothing selected, or points only, is refused.
- An end stroke absent in the edited view is cleared elsewhere.
- A shared end point is written once.
- In a view with a legal coincidence (made from another view): a broadcast-only edit keeps the two points and their connections. A broadcast with a move in the same edit runs the full flow as before. A refused broadcast-only edit still goes through the lock check.
