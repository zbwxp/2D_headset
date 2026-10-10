# Step 6: stroke broadcast (plan before code)

**Status:** for dot's check (dot 1791655678 asked for rules and read / write paths). Nothing is coded until dot has checked it.

**Decided input:**
- bowen 1791650085: line width and stroke may differ per view; a button broadcasts them to the other views, so they need not be set nine times.
- bowen 1791650171: a plain assignment.
- bowen 1791650206: a batch edit.

It is separate from the shape broadcast (offsets, baselines; stage 2).

## Rules

1. **What is copied.** For each chosen line, the edited view's values are assigned to every other **view** layer. Expression and record layers are not written; their owners decide later.
   - its stroke (width, profile);
   - the end strokes at its two end points (*proposal*: bowen's "笔触" read as including the tapers). A point with no end stroke in the edited view clears it in the others, since an assignment makes them equal.
2. **Not copied:** shapes (positions, handles), arc radii (*proposal*: a radius is a join's geometry, not 笔触), join modes, links, fills.
3. **Which lines:** the selected lines, or explicit `units` (as transforms and delete take them). Points or handles alone, or nothing, are refused (`select-lines-to-broadcast`), as delete refuses them.
4. **One edit:** one undo step. The usual commit runs, so a locked line whose stroke or free-end end stroke would change in any view refuses the whole edit (locks per view, existing comparison). Nothing is settled differently, since no geometry changes.
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
