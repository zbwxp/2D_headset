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

## 2. Rules (revised after dot 1791878532)
- **Copied unchanged, or refused.** After writing, the edit is settled as its commit would settle it (a trial). Unless the chosen layers then show exactly the source's values — and no point merged, no shared structure (points, lines, join modes) changed, no other view (the source included) changed — the whole edit is refused (`apply-from-not-exact`, naming what differs). No deviation is ever recorded and committed.
- Nothing differs from the source already: no change, no undo step (history keeps only edits that change the state).
- **Locked lines in a chosen layer:** refused before anything is written (an explicit check). A lock reached through a link (a locked line in a layer not chosen) is refused by the commit's lock check; the whole edit rolls back.
- **Links — the one exception to "only the chosen layers":** a point of a layer not chosen, linked to a chosen point, follows it in this view, as after a move.
- **Mirror links, front:** a chosen layer's mirror partner follows (positions and handles by the mirror settling; widths, profile, end strokes, radius, zone written in pairs, as their own edits are) — when the partner's layer is not chosen. Both sides chosen from a view where they are not mirror images: the trial does not equal the source → refused; never averaged, never last-write-wins, never order-dependent.
- **Mirror links, off the front:** only the chosen layers are written, every value (positions, handles, widths, profiles, end strokes, radii, zones), the partner keeps its own; the same for all values, not widths alone (dot 1791878532). **Waiting for bowen** (dot asked him); built this way meanwhile.
- End stroke or manual zone absent in the source → cleared here. An arc's radius: only this view's value (`setRadiusHere`), never `setJoin`.
- From this view itself: nothing. A layer with no lines: nothing.
- Declared in src/document/effects.ts as an edit of the edited view (`reads: 'draft', intents: 'edited', shapes: 'edited'`, full settle).

## 3. Bench (bowen asked where to click)
- **"从视角应用…" button in the View section, beside the nine view buttons.** Click it → the nine buttons switch to picking (the current view greyed, a note "选一个视角，把它的形状应用到选中的图层"); click a view → applied to the selected layers (the layers panel selection, current layer included); Esc or the button again cancels. The status line names what was applied.
- The view stays where it is (you see the result in place).

## 4. Flows to run (tests, then 5199 with screenshots)
1. Layer L in the side view differs; apply from 0,0 → L's positions, handles, widths, profile, end strokes, arc radius, manual zone equal 0,0's exactly; other layers and views unchanged; undo restores. And the other way (absent end stroke / zone cleared).
2. Two layers at once.
3. A locked line in a chosen layer → refused before writing; a link reaching a locked line elsewhere → refused, nothing changes.
4. A link to another layer's point → the partner follows.
5. Front, one mirror side → the partner mirrored; both sides from an asymmetric view → refused in either order. Off the front → the partner keeps its values.
6. A source with two points of one layer on one spot (a diagonal draft) → the copy would merge them → refused.
7. Applying the values already there → no undo step. Empty layer / the view itself → nothing.
8. Bench: pick mode, the current view not pickable, Esc / the button again cancels.
