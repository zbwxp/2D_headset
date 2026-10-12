# Widths belong to points — checklist before any code (for dot's review)

bowen 1791820157 / 1791820285 / 1791820396: there is no line width; a stroke's width is defined at its points. A point
has **one width**, shared by every line that ends there, so two lines meeting at a point are always equally wide there
and the stroke runs through smoothly; a line tapers between its two points' widths (as 8eca56d). Unequal widths on two
sides of one point are not supported ("how to define both sides is the hard part"); this is for simple strokes —
complex shapes (an upper eyelid) are an outline + fill. Replaces the per-line two end widths of 8eca56d / a95746d
(accepted by dot 1791820172) as the stored form.

## 1. Data (core)
- **Storage:** each shape layer keeps a width for every point (`widths: { [point]: number }`, per view like positions;
  a new point gets 1). A line's stored stroke keeps only `profile`.
- **Reads unchanged in shape:** a line's `stroke` in snapshots and readers stays `{ width, widthB?, profile }`, derived
  from its two points (`width` = point a's, `widthB` = point b's when different) — the ink, zones, panel, playback and
  clipboard keep reading what they read today.
- **Writes:** `pointWidth(point, w)` sets a point's width in this view. `lineStroke(id, { width, widthB?, profile })`
  stays as the line-level write: it sets point a to `width`, point b to `widthB ?? width` (so it also changes every
  other line at those points — stated, intended) and the profile.
- **Operations:** new point → 1 (a pen line continuing from a point keeps that point's width); split → the new point
  gets the width at the cut (arc length, per view, as a95746d); bind / merge → the kept point keeps its width; delete →
  the width goes with the point; paste → pasted points carry their widths; mirror apply → each target point takes its
  source point's width (points are matched, so reversal needs no special case); broadcast stroke → the line's two points'
  widths copied to the other views.
- **Archive VERSION 9:** `widths` per layer, required, positive. Versions 8 / 7 (and 6 / 5 through their conversions)
  convert once: a point's width = the largest width any line had at that point in that layer (1 for a point with no
  line); lines lose `width` / `widthB`. Stated as the third approved conversion? — **asked of bowen** (the archive rule
  allows conversions only with approval; without it his v8 drawings would not open).

## 2. Ink / zones
- Unchanged code path: widths at a joint are now always equal, so the bound / smooth easing never runs; cusp tips use
  the shared width; free ends round with the point's width.
- The transition zone (过渡区) no longer affects widths; it stays in the data (arcs use it for nothing either) — the
  panel hides it for now; removing it from the core is left to a later clean-up (ledger row).

## 3. Panel / bench
- A line's properties: 「起点宽」「终点宽」 edit its two **points'** widths (noted: 「这个点上的线一起变」).
- A point's properties: 「宽度」.
- The bench's "Set width": every point of the selected lines.

## 4. Flows (5199 with images)
1. Pen a chain, set a middle point's width → both lines taper into it, one smooth stroke.
2. The 125.json left eye as one stroke by point widths.
3. Split / bind / delete / paste / mirror apply / broadcast stroke; undo / redo; save / reopen; a v8 file opens.
