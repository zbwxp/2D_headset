# Two end widths per line — checklist before any code (for dot's review)

bowen 1791818995: a line no longer has one width but **a stroke width at each of its two ends**; equal → today's
uniform width, different → one end thick, one end thin (a pressure-pen stroke). "Do it first, then look at the effect."

## 1. Data (core)
- `Stroke` keeps `width` (= the width at the line's **a** end, 起点) and gains `widthB?` (the width at the **b** end,
  终点); absent = equal to `width`. One form per content: `widthB` is dropped when equal to `width`. Per view, like
  `width` today (a shape-layer value). `profile` unchanged (still 'uniform'; dot 1791818865: the existing fields are
  reused, no second set — `endStroke.taper` stays the free-end stroke, not touched here).
- `widthAt(stroke, 'a' | 'b')` in core; every reader of a line's width **at a point** uses it: the zones (derived
  `zones`, document 939 / 969 — the automatic zone from the two widths at the joint), the ink's joins.
- Archive VERSION 8 (dot 1791819678: an older program must refuse a file with end widths, not drop them); a version 7
  file is read as it is (it is an 8 file without end widths). `widthB` accepted when positive, finite and different
  from `width`. Clipboard carries it. Playback: strokes come whole from the dominant view, as today (`appearance`).
- `lineStroke(id, { width, widthB?, profile })` sets both; the bench's "Set width" sets a uniform width (drops `widthB`).

- **Split** (dot 1791819133 / 1791819173): both halves take the width at the cut — linear in arc length along each
  view's own curve — so the split line draws as before (`network.splitLine` copied one stroke to both halves).
- **Mirror apply** onto a line matched reversed: the two end widths swap with their ends (`apply` swapped the handles
  only); a coordinate-only mirror (Flip) swaps nothing.

## 2. Ink
- A joint's easing returns to the line's own tapered width at the zone's exit (dot 1791819133), not to an end value.
- A line's half-width along its arc length s ∈ [0, L]: **linear** from w_a / 2 to w_b / 2 (a pressure taper; easy to
  switch to a smooth curve after the look). The joins' easing and the cusp's flat ends work on top of it, from the
  width each line has **at the joint** (the S-curve blends the two lines' widths at the shared point when they differ).
- Non-ink drawing (switch off): the average of the two widths.

## 3. Panel / bench
- Properties of a line: 「起点宽」「终点宽」, two sliders (this view), each one edit.
- Layers list: `w2→4` when they differ, `w2` when equal.

## 4. Flows (5199 with images)
1. A single line 4 → 1: a clean taper, round free ends of the two radii.
2. The 125.json left eye as one pressure stroke: widths set so each joint's two ends match (2→4, 4→3, 3→2…), all bound.
3. Equal widths: identical to today (old files open the same).
4. Undo / redo, copy / paste, save / reopen, another view keeps its own widths.
