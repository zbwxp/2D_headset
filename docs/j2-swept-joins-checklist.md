# J2 — swept joins in the ink (bound / smooth / arc): checklist before any code (for dot's review)

Principle: docs/ink-joins-principle.md §1–§4 (bowen's distillation; generation and the arc fallback are **candidates**, to be judged with a three-line fork picture — dot 1791811223). J1 (778e955) and J1b (2d718c5) give the joins, their lists and the `zones()` read. J2 replaces the ink of bound / smooth / arc joins; cusp stays the scaffold until J3. Behind the 墨迹轮廓 switch, as before.

## 1. What changes in the ink (ink/index.ts)
- **Groups only through joins** — every row (bound included) merges its two lines' ink; lines that only share a point are separate (today: arcs, smooth, cusp only; bound rows are new since J1).
- **One width transition per governing join**, along the connected path: over the zone's **限长后长度** Z (from `zones()`), centred on the joint (an arc: on its midpoint), one S-curve from one line's width to the other's — on line A at distance d from the joint, h = h_A + (h_B − h_A)·S(½ − d/Z) for d ≤ Z/2 (S = smoothstep; the average at the joint). Replaces today's smooth easing (each side to the average, flat at p) and the arc's whole-arc easing.
  - **Arc:** Z ≤ A — the transition covers the middle Z of the arc, the lines keep their widths; Z > A — the whole arc and (Z − A)/2 of each line.
- **Ends and their governing join (§2.3):** a line's end is shaped by the topmost row at its point that contains it. **Candidate generation rule** (dot 1791811126 / 1791811223): rows are processed top-down; a row shapes only the ends it governs; an end already governed by a higher row is a fixed boundary — its width at the joint is what the higher row made it, and the lower row eases its own governed end to meet that width (not just to the average). A row that governs no end only merges.
- **An end with no join at a point that has joins** (§1.1 D): eases to the topmost join's width at the joint over that join's Z / 2 and merges; no end cap of its own shows (it lies in the merged ink).
- **Free ends:** round, as today (the end-stroke rule later).
- **The sweep:** each line's eased profile swept with the `Profile` machinery of 9781cf7 (the disc sweep, union of hulls); a group's pieces unioned (`merge`). With the joint's width continuous, the union of the pieces is the sweep of the whole path — a bound corner gives a round join (the swept circle), a thick circle may cover a thinner one nearby (§1.3, dot 1791807641).
- **Arc fallback candidate** (an arc that does not govern both its ends falls back to 'bound' — principle §2.3): judged with the fork picture; until then an arc always trims (as today) and logs where it does not govern an end.

## 2. The three-line fork picture first (dot 1791811223)
- One point p, lines a (width 4), b (8), c (12), meeting at 120° apart. Cases drawn with the candidate rule, side by side, each with its join list printed:
  1. a–c smooth on top, a–b bound below (a governed by a–c: eases to 8; c to 8; b meets a's 8 — no change);
  2. the same two rows reversed (a–b on top: a and b ease to 6; c meets a's 6);
  3. only a–b bound, c attached later (c taken over: eases to the a–b joint width);
  4. an arc a–c above a bound a–b (the arc-fallback question shown, both ways).
- Delivered as PNGs before the generation code is committed; bowen / dot judge which rule reads as intended.

## 3. Flows (after the picture is accepted)
1. A chain of equal widths: one outline, no change from today.
2. 4 / 8 bound and smooth: the S-curve over Z, the average at the joint, the zone's length from `zones()` (manual Z in one view changes only that view's ink).
3. An arc with Z < A and Z > A.
4. The fork cases of §2 on the canvas; reorder in the panel → the ink follows.
5. A short line between two joints: both transitions limited (L/3 each side), no overlap.
6. Hide a line in a group; width / radius / zone edits; undo.
7. Cost: playback on the bench drawing measured before / after.

## 4. Not in J2
- Cusp (J3): stays the scaffold, joined through its row.
- Colour: the interim of the first version (§1.5).
- The ledger rows 18 / 19 (mirror order).
