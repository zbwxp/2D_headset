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
- **The tip lands on the end point** (dot 1791853983 / 1791854038 — judged on the final ink, not the end radius): the
  ink is swept by discs, so within a tip's taper the half-width is at most 0.8 × the **straight** distance to the end
  point (`TIP`; the arc length on a curve is longer and would not hold) — no disc reaches past the end point and the
  outline meets there in a point of at most ≈ 106°.
- **Only within the taper** (dot 1791854575: the body and the joints keep their widths). The taper joins the body when,
  **at its actual exit**, the body's own half-width there (the line's width changes along it) is at most 0.8 × the
  straight distance from there to the end point (dot 1791854667 — 0.625 × the width is only the straight, equal-width
  answer). The taper starts from max(taper × width, 0.625 × width) and is lengthened by 1.25 × until its exit joins, up
  to half the line; then the limit meets the body without a step and the body's discs do not reach the end.
- **Lines too short for that** (no exit joins up to half the line): both ends free → the whole line is narrowed
  (a short line cannot be both thick and pointed; shown in the picture); the other end joined → nothing is narrowed —
  the joint keeps the point's shared width, and the tip may be covered by the line's own body or a neighbour:
  **a recorded limit**, not forced.

## 3. Panel
- A point that is a free end: 「收尖」 slider — the multiple of its width (0 = none), this view.

## 4. Flows (5199 with images)
1. Pen one line: both ends pointed. Continue it: the joined end is no longer pointed. Undo: pointed again.
2. A short line (shorter than 6 × width): both ends meet in the middle.
3. Hide the neighbour of a joined end: still not pointed.
4. Set 收尖 to 0, to 6: round end / longer tip; another view keeps its own.
5. The 125.json eye: the two outer ends pointed.
- Checked on the final ink: a free line 2 long, 4 wide spans exactly 0 … 2 (was −1.12 … 3.13, dot 1791854183), its
  middle narrowed to about 1.6 — a visible change, marked in the picture; 60 long with taper 0.1: exactly 0 … 60; the
  125.json eye's left free end lies on the outline within the grid (0.0009; was 0.047 inside); a line 1 long joined to a
  long one keeps width 4 at the joint (its tip covered — the recorded limit).
