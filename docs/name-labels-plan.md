# Name labels on the canvas — rules before code

**Accepted on dot's independent run** (dot 1791733152: root 830, bench 193, both tsc, 15/15 added; its own look in a browser kept apart). `lastPress()`'s reset on other tools' presses is ledger row 17.

**Coded** (for dot's check; plan passed dot 1791732208): `name-labels/index.ts` (`labelsFor`, `middleOf`), the bench (the display kind set by an A / V press that picked a **line** — read from interaction's new `lastPress()` (what the last V / A press picked: line, point, handle, fill or none), not guessed from "no box", which also counted points and handles (dot 1791732824) — by `LayersPanel`'s new `onPick` for a line or curve row, and by find-by-name; labels drawn from `ix.selection()`'s lines, not in playback, `pointer-events: none`). Tests `name-labels/test/labels.test.ts` (6), `bench/test/name-labels.test.tsx` (6). Checked in Chrome on bowen's drawing: A on 左颅 shows "左颅", V on it shows "连续曲线1副本" beside the curve's middle line. Note: V on a line already selected keeps the selection as it is (V's behaviour unchanged; dot 1791732110), and the label shows the curve's name.

Asked by bowen 1791731823: selecting a line — with **A** on the canvas, or by clicking its row in the layers panel — shows the line's name beside it; selecting a whole continuous curve with **V** shows the curve's name.

## What decides line or curve names

The selection itself is only a list of lines (V selects every line of a curve), so a curve of one line selected with V and the same line selected with A are the same selection. bowen's rule is about **how** it was selected, so the bench keeps one **current display kind** (dot 1791732110):

- It becomes **line** when a press with **A** actually hits a line, when a line row is clicked in the layers panel, or when a line is found by name; it becomes **curve** when a press with **V** actually hits a line, when a curve row is clicked, or when a curve is found by name. A press on a line already selected still sets the kind (the selection may not change, the kind does).
- A press that hits nothing (it starts a marquee, or clears the selection) does **not** change the kind; neither does any viewport gesture (Zoom, wheel, pan), undo, redo, Open, paste or delete. It starts as line.
- **This is one kind for the whole display, not a record per object** — a stated trade-off: after A selects X, V selects Y and an undo returns to X, X is labelled with its curve's name; a mixed multi-selection is labelled all with the last kind. The selection behaviour of A and V themselves is unchanged.

## What is shown

- **Which selection:** the labels read the selection **in the current scope** (`ix.selection()`: the selected units within the current layers), not the raw selection, which may still hold lines outside the scope (dot 1791732110).
- **Line names:** one label per selected line, at the middle of the line (its curve at t = ½), offset a little up-right so it does not cover the stroke.
- **Curve names:** one label per continuous curve that has a selected line, at the middle of its middle line: with the curve's lines in their stored order (`groups[].lines`), the line at index ⌊(n − 1) / 2⌋ — the single middle one for an odd count, the earlier of the two middle ones for an even count (dot 1791732110).
- Text at a constant screen size (as the handles are, scaled by the view), dark with a white outline so it reads over a reference picture; it never takes a press (no pointer events), so picking is unchanged.
- Shown in the view being edited, for the lines drawn there; not in playback (nothing is selected there for editing).

## Where it lives

- A small package, **`name-labels/`**: one function, `labelsFor(lines, groups, selected, kind) → { text, at }[]`, taking plain data (each line's id, name and middle point; each curve's id, name and lines in order; the selected line ids) and the kind. No React, no imports. The bench gives it the data from the snapshot and geometry, records the kind, and draws the labels.

## Not now

- Labels on hover; labels for points or fills; avoiding overlaps between labels.

## Tests

- Package: line kind → one label per selected line, at its middle; curve kind → one per curve touched, at its middle line's middle, its name; a curve of one line gives the line's name with line kind and the curve's name with curve kind; nothing selected → none; a selected id with no line → ignored.
- Bench: A press on a line → its name shown beside it; V press → the curve's name; A then V on the same, already selected line switches the label; a press on empty space (marquee) keeps the kind; a viewport gesture keeps it; a line outside the current layers, still in the raw selection, gets no label; A on X, V on Y, undo → X with its curve's name (the stated trade-off); a mixed selection takes the last kind; a curve of 4 lines labels its 2nd line's middle; a click on a line row / a curve row in the layers panel → line / curve name; the label element takes no pointer events (a press where it is drawn still picks the line under it); in playback no labels; renaming a line updates its label. Feature-off: without the bench recording the kind, the V test fails; reading the raw selection instead of the scoped one, the scope test fails.
