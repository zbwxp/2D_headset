# J3-min — a cusp hides the line's round end: checklist before any code (for dot's review)

bowen 1791816534: fix the round end showing inside a cusp, then stop the ink-join work (complex shapes → outline + fill;
unequal widths need no special care). The real case: 125.json / 124.json, the left eye's corner (widths 3 / 2, ~100°) —
reproduced by dot 1791815914: the tip and the round bulge both show.

## 1. The cause
Today a cusp keeps each line's own round-capped ink and adds the tip [p, A0, M, A1] on top (ink/index.ts `cuspTip`,
the scaffold 1ac07f7). The wider line's cap (radius h_w around p) reaches past the tip's side when the tip is short
(3 / 2 at 100°: the miter is 1.67 from p, the cap 1.5 — the cap's round shows beside the tip).

## 2. The change (principle §1.1: a joined end has no cap — cut flat, perpendicular to the end's direction)
- At every **cusp** end (kinds tip / ease / none of `cuspTip`), the line's end is **generated flat** — never cut out of
  the finished ink (dot 1791816797: a curve passing back through a cut box would be carved too). The line is built by
  the hull construction (the union of the convex hulls of consecutive discs, as the tapered sweep): the centre line is
  extended along the end's handle by 4 grid units, and only the hulls of the end's own last stretch (2 × its widest
  radius, by arc length) are cut by the face's box; the rest of the line is untouched. The face is exactly
  perpendicular to the handle — the direction `cuspTip` uses. (The library's butt end on that short extension left a
  0.15 dent on 125.json's right eye, so the equal-width line is not inflated with butt ends.)
- The 4-grid-unit extension makes the line overlap the tip (whose sides p–A lie on the face at p) by a sliver, so the
  union has no seam from rounding (an edge-only contact left the tip a separate loop on the eye corner).
- The tip polygon is unchanged: its side p–A0 / p–A1 is exactly the cut face, so the union has no seam; the inner side
  is covered by the two bodies (both run past p's inner bisector for any angle under 180°).
- 'ease' (the outer edges do not meet ahead, or straight on with unequal widths): as today, widths ease to the average,
  then the tip at equal widths; the ends are cut flat too. 'pinch' (fold back): unchanged (the width is 0 at p).
- Smooth / arc / bound ends: unchanged (paused J2). Free ends: round, as today.
- The flat ends enter the line's cache key; the band check leaves out the vertices on a face (the face is the
  construction, not the swept edge); the status stays 'unproven'.
- I2b (the wider line's inner corner showing past the thinner line at acute angles) stays as today: flagged on the tip,
  not handled — only built if a real drawing shows it (principle §3).

## 3. Flows (5199, with images; then bowen's 5190)
1. The eye corner of 125.json (3 / 2, ~100°): no round bulge, one tip.
2. The left eye's other cusp (4 / 4 and 1 / 4 at ~50°): tip, no bulge.
3. Equal widths at 90° / 30° / 150°; straight on equal widths (no visible change); fold back (pinch unchanged).
4. Hide one of the two lines: the other's end is round again (no cusp drawn); undo.
5. Set the join to smooth / bound: the ends go back to today's look.

Tests: one bench-level ink test per row of §2 (cut present at a cusp end, absent at a free end and at smooth / bound),
the 125.json corner as a real-drawing sample (its tip + no point of the ink beyond the cut box), and a line that passes
back beside its own flat end keeps its ink there (dot 1791816797).
