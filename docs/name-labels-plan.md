# Name labels on the canvas — rules before code

Asked by bowen 1791731823: selecting a line — with **A** on the canvas, or by clicking its row in the layers panel — shows the line's name beside it; selecting a whole continuous curve with **V** shows the curve's name.

## What decides line or curve names

The selection itself is only a list of lines (V selects every line of a curve), so a curve of one line selected with V and the same line selected with A are the same selection. bowen's rule is about **how** it was selected, so the bench records that with the selection:

- **line names** after: a press with A on the canvas; a click on a line row in the layers panel; finding a line by name.
- **curve names** after: a press with V on the canvas; a click on a continuous-curve row in the layers panel; finding a curve by name.
- Any other change of the selection (undo, redo, a marquee, an Open, a paste, a delete) keeps the last kind; it starts as line names.

## What is shown

- **Line names:** one label per selected line, at the middle of the line (its curve at t = ½), offset a little up-right so it does not cover the stroke.
- **Curve names:** one label per continuous curve that has a selected line, at the middle of its middle line (in the curve's line order).
- Text at a constant screen size (as the handles are, scaled by the view), dark with a white outline so it reads over a reference picture; it never takes a press (no pointer events), so picking is unchanged.
- Shown in the view being edited, for the lines drawn there; not in playback (nothing is selected there for editing).

## Where it lives

- A small package, **`name-labels/`**: one function, `labelsFor(lines, groups, selected, kind) → { text, at }[]`, taking plain data (each line's id, name and middle point; each curve's id, name and lines in order; the selected line ids) and the kind. No React, no imports. The bench gives it the data from the snapshot and geometry, records the kind, and draws the labels.

## Not now

- Labels on hover; labels for points or fills; avoiding overlaps between labels.

## Tests

- Package: line kind → one label per selected line, at its middle; curve kind → one per curve touched, at its middle line's middle, its name; a curve of one line gives the line's name with line kind and the curve's name with curve kind; nothing selected → none; a selected id with no line → ignored.
- Bench: A press on a line → its name shown beside it; V press → the curve's name; a click on a line row / a curve row in the layers panel → line / curve name; the label element takes no pointer events (a press where it is drawn still picks the line under it); in playback no labels; renaming a line updates its label. Feature-off: without the bench recording the kind, the V test fails.
