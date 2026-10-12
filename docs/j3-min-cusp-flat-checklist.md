# J3-min — a cusp hides the line's round end: checklist before any code (for dot's review)

bowen 1791816534: fix the round end showing inside a cusp, then stop the ink-join work (complex shapes → outline + fill;
unequal widths need no special care). The real case: 125.json / 124.json, the left eye's corner (widths 3 / 2, ~100°) —
reproduced by dot 1791815914: the tip and the round bulge both show.

## 1. The cause
Today a cusp keeps each line's own round-capped ink and adds the tip [p, A0, M, A1] on top (ink/index.ts `cuspTip`,
the scaffold 1ac07f7). The wider line's cap (radius h_w around p) reaches past the tip's side when the tip is short
(3 / 2 at 100°: the miter is 1.67 from p, the cap 1.5 — the cap's round shows beside the tip).

## 2. The change (principle §1.1: a joined end has no cap — cut flat, perpendicular to the end's direction)
- At every **cusp** end (kinds tip / ease / none of `cuspTip`), the line's ink is cut flat at p: the cap region — a box
  on the far side of p, from p outward by R and ±R across, R = the end's half-width at p (after any easing) × 1.05 — is
  removed from that line's piece (clipper `difference`, on the piece's own grid).
- The tip polygon is unchanged: its side p–A0 / p–A1 is exactly the cut face, so the union has no seam; the inner side
  is covered by the two bodies (both run past p's inner bisector for any angle under 180°).
- 'ease' (the outer edges do not meet ahead, or straight on with unequal widths): as today, widths ease to the average,
  then the tip at equal widths; the ends are cut flat too. 'pinch' (fold back): unchanged (the width is 0 at p).
- Smooth / arc / bound ends: unchanged (paused J2). Free ends: round, as today.
- The cut enters the line's cache key; a cut piece's diagnostic is 'unproven' with the reason "end cut flat at a cusp"
  (a defect found by the output check stays a defect).
- I2b (the wider line's inner corner showing past the thinner line at acute angles) stays as today: flagged on the tip,
  not handled — only built if a real drawing shows it (principle §3).

## 3. Flows (5199, with images; then bowen's 5190)
1. The eye corner of 125.json (3 / 2, ~100°): no round bulge, one tip.
2. The left eye's other cusp (4 / 4 and 1 / 4 at ~50°): tip, no bulge.
3. Equal widths at 90° / 30° / 150°; straight on equal widths (no visible change); fold back (pinch unchanged).
4. Hide one of the two lines: the other's end is round again (no cusp drawn); undo.
5. Set the join to smooth / bound: the ends go back to today's look.

Tests: one bench-level ink test per row of §2 (cut present at a cusp end, absent at a free end and at smooth / bound),
the 125.json corner as a real-drawing sample (its tip + no point of the ink beyond the cut box).
