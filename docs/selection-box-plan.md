# The selection box — rules before code (moving, package 2 of 2)

Asked by bowen 1791733125 (a box after selecting: scale, rotate, width or height alone; grab the whole selection anywhere in it); the feel confirmed by bowen 1791734097: corners scale proportionally, edge midpoints stretch one axis, **rotation by a small handle above the box (PowerPoint style)**, Option scales about the centre, Shift rotates in 15° steps. Package 1 (`docs/move-plan.md`, accepted dot 1791734961) gave the move sessions; this package adds the box. Later stages stay tracked there (the playback correction and the view's pan by keyboard).

## 1. The box

- Shown with **V or A** when the scoped selection (`ix.selection()`) holds lines or points, in the view being edited; not in playback, not while restoring, not with Move picture on.
- It is the axis-aligned bounds of what the selection moves, in this view: the selected lines' curves (handles included as the curves bend) and the selected points. After a rotation it is the bounds of the result (it does not stay turned).
- A side shorter than a few screen pixels (one point, a straight horizontal line) has no handles on that axis; the box can still be grabbed and the selection still rotated if the other side has length.

## 2. What a press does (picking stays interaction's)

In this order, so a handle always wins (dot 1791733296):
1. **A box handle** within its reach, measured in **screen pixels** (the same feel at any zoom): the rotation handle, a corner, an edge midpoint.
2. **Something the tool picks** (as today): a press on another line, point or handle selects it, as now.
3. **Inside the box, or within a margin around it** (in screen pixels): grabs the **whole selection** — a `move/` drag session of the selection, exactly what is selected (a marquee's lines stay those lines; dot 1791733296).
4. Otherwise a marquee, as today.

## 3. The handles

Each handle drag is a `move/` drag session: the module gives the pointer's offset; the box's target turns it into a scale or a rotation, previews it as a ghost, and commits **one** core operation on release (one undo step) — `scale(centre, sx, sy, units)` or `rotate(centre, angle, units)`, which core already has. The selection is taken when the drag begins and the drawing re-checked at commit, as for a move.

- **Corners:** proportional scale (sx = sy), about the opposite corner; with **Option**, about the box's centre.
- **Edge midpoints:** one axis only (the other factor 1), about the opposite edge; with Option, about the centre.
- **Rotation:** a short stem and a round handle above the top edge's middle (PowerPoint); the angle follows the pointer around the box's centre; with **Shift**, in 15° steps.
- **Crossing over:** dragging a side past its anchor mirrors the selection (a negative factor), as Illustrator and PowerPoint do; a factor that would be exactly 0 is held at the size of one screen pixel, so nothing collapses to a line.
- Locks and refusals: core decides; a refused commit is shown as any refusal is and writes nothing.

## 4. Drawing

The box and its handles are drawn from interaction's preview (a new `selectionBox`: the bounds, which handles exist, which one is hot); the bench draws them at a constant screen size; the cursor follows (`cursor/` gains rows for the box: move over the inside, resize arrows over corners and edges, a rotate cursor over the rotation handle).

## Not now

- A box that stays turned after a rotation; keyboard scaling or rotation; scaling a single point or handle by the box; snapping.

## Tests

- Interaction: the box's bounds for a selection (lines, points, curved handles); handles absent on a zero-length axis; the press order — a handle wins over the inside, a picked item over the inside, the inside over a marquee, the margin in screen pixels the same at two zooms; a corner drag scales proportionally about the opposite corner, Option about the centre; an edge drag scales one axis; the rotation handle rotates about the centre, Shift in 15° steps; crossing over mirrors; a factor near 0 is held; each drag one operation and one undo step, nothing written before release; Esc / a tool change / undo during a handle drag write nothing; a marquee-selected part moves as selected, never grown.
- Bench: the box and handles drawn with V / A and a selection, not in playback or with Move picture; the cursor over each handle; dragging the inside of the box moves the selection in one undo step; feature-off: without the inside rule, the inside-drag test fails.
