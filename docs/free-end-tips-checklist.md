# Free ends taper to a point — checklist before any code (for dot's review)

bowen 1791821612 / 1791853511: every free end tapers to a point by default; the length is adjustable. dot 1791821792 /
1791821836: the tip is at the end point (no extension); a free end is decided from the drawing's structure only.

## 1. What is a free end
- A point where exactly **one line end** lies, counting every line of the drawing — hidden lines included, join rows not
  consulted (dot 1791821836: hiding a neighbour does not make an end taper). A line from a point to itself counts twice.
- Decided by the ink each time it builds, from the current structure: an end joined later is no longer free; nothing
  about the tip is stored besides its length setting.

## 2. The taper
- Length = `taper` × the end point's width (`endStroke.taper`, per view, the existing placeholder — now defined as this
  multiple); absent → **3**; 0 → no taper (the round end of before). At most half the line's length, so a line tapering
  at both ends meets in the middle at most and the two never overlap.
- Shape (bowen left it open; changeable after a look): over the taper length the half-width goes from the line's own
  half-width to 0 as h · (2u − u²), u = distance from the end / length — it meets the body with slope 0 and ends in a
  pointed tip with a finite angle (a brush tip, not a needle). The width taken is the point's width (before tapering).
- Ink: a line's end profile gains a `tip` ease (its joint 0); the free end's round cap disappears (radius 0 at the end).

## 3. Panel
- A point that is a free end: 「收尖」 slider — the multiple of its width (0 = none), this view.

## 4. Flows (5199 with images)
1. Pen one line: both ends pointed. Continue it: the joined end is no longer pointed. Undo: pointed again.
2. A short line (shorter than 6 × width): both ends meet in the middle.
3. Hide the neighbour of a joined end: still not pointed.
4. Set 收尖 to 0, to 6: round end / longer tip; another view keeps its own.
5. The 125.json eye: the two outer ends pointed.
