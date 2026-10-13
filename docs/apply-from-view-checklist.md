# Apply from another view — checklist before any code (for dot's review)

bowen 1791878160: in one view, select a layer, click "apply from", pick another view → that view's shapes of the same layer are copied unchanged into the current view. Why: in some views the lines get badly distorted; starting from a nearby view is better.

A layer is the same layer in every view (one structure, nine shape layers; docs/architecture-multiview.md §1), so "the same-named layer" is the layer itself.

## 1. What it copies (core: `applyFromView(layers, from)`)
For every line whose points are in the given layers, from view `from` into the edited view, read before anything is written:
- each point's position and width;
- each line's two handles and its profile;
- each end stroke at those points (absent in `from` → cleared here);
- each join at those points: an arc's radius, and the manual zone (automatic in `from` → automatic here).

Not copied (they are the same in every view already): which lines and points exist, joins' modes and order, names, fills, lock / visible, links, mirror pairs. Other views, the baseline record and in-between responses are not written.

## 2. Rules
- One edit, one undo step; the source view is unchanged. Choosing the view you are in: not offered.
- A layer with no lines: nothing happens, no edit.
- Locked lines in a chosen layer: refused, nothing changes (the commit's lock check, as for a move).
- The commit settles the edited view as after a move: a point linked to a point in a layer that is not chosen pulls that point along (links); coincident points in one layer bind. So the result equals the source exactly unless links or binding act — recorded, not chased.
- Mirror links: in the front, mirror partners follow (positions and handles by the commit's mirror settling; widths, profile, end strokes, radius, zone written in pairs, as their own edits are). Off the front, only the chosen layers are written (as the diagonal draft writes corner views directly). **Question for bowen/dot:** off the front, a width edit on a mirror-linked point is refused today (`mirror-front-only`); the apply writes the chosen layer only. Is that right, or should it be refused there too?
- Declared in src/document/effects.ts as an edit of the edited view (`reads: 'draft', intents: 'edited', shapes: 'edited'`, full settle).

## 3. Bench (bowen asked where to click)
- **"从视角应用…" button in the View section, beside the nine view buttons.** Click it → the nine buttons switch to picking (the current view greyed, a note "选一个视角，把它的形状应用到选中的图层"); click a view → applied to the selected layers (the layers panel selection, current layer included); Esc or the button again cancels. The status line names what was applied.
- The view stays where it is (you see the result in place).

## 4. Flows to run (tests, then 5199 with screenshots)
1. Layer L in view −90,0 distorted; apply from 0,0 → L's positions, handles, widths, profile, end strokes, arc radius, manual zone equal 0,0's exactly; other layers and other views unchanged; undo restores.
2. Two layers selected → both applied, one undo step.
3. A layer with a locked line → refused, nothing changes.
4. A point linked to another layer's point → the partner follows; stated in the hand-in.
5. Front target with a mirror-linked layer → the partner mirrored.
6. Empty layer → no edit. Pick mode: Esc cancels; the current view cannot be picked.
