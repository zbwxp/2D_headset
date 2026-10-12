# Ink joins — the principle (bowen's distillation, 2026-10-12), for dot's review before any code

Replaces the per-piece patches of the first ink joins (P1 + arcs + smooth + the sharp scaffold, all behind the 墨迹轮廓 switch): those kept each line's round-capped ink and added pieces on top, which let a wide line's end show at a joint (the bulge and the half-disc, Slack 1791805745 figures ①②) and switched method at hard thresholds (③). Sources: bowen 1791807339 (the distillation), 1791807630 (free ends; the join stroke replaces the line), 1791808196 / 1791808359 / 1791808493 (binding is a join; pen and bind create it; old drawings; agreed), dot 1791807641 / 1791808553 / 1791808765 (layering, zone length, B+E, F's scope), my restatements 1791807658 / 1791807685 / 1791808784.

## 1. The principle

1. **A line's body has no end cap.** At an end it is cut flat, perpendicular to the centre line's direction there (the handle's direction); the cut's two corners lie half a width from the centre. The boundary at each end comes from one of two rules:
   - **a free end** (no join there) — the end-stroke rule; until end strokes are designed (bowen: later), today's round cap. An end at a shared point that has no join is a free end.
   - **a joined end** — the join rule (§1.3).
2. **Every join has a transition zone**, and inside it **the join stroke replaces the lines' own ink** (nothing of the lines' ends is kept there). Outside the zones the lines' bodies are unchanged.
3. **Join rules.**
   - **Bound only (仅绑定), smooth, arc — a circle swept along the connected path.** The circle's diameter follows one width transition across the zone: from one line's width to the other's along one S-curve (smoothstep) centred on the joint (an arc: centred on the arc's midpoint), the average at the centre. Equal widths: no change. What is seen is the swept result — a thick circle may cover a thinner one nearby, a tight turn may overlap itself; that is the result, not a defect (dot 1791807641).
   - **Sharp (cusp) — F**: the lines' bodies outside the zone are kept; inside it the boundary is rebuilt from the actual outer and inner edges (§3).
4. **The shape changes continuously** with the angle and the widths — no sudden switch of method at a threshold. Where the current construction still switches (F's added cases, the 0° fold-back), it is recorded as a known jump until replaced.
5. **Colour is separate**: it must not decide the ink's shape. Until the colour question is settled, the interim of the first version stays (a group drawn as one path when its lines share a paint; otherwise each line in its paint, arcs / tips in the base colour) — recorded, not part of the principle.

## 2. Binding is a join (a core change — a graph principle, approved by bowen 1791808493)

Today "no join row" means 仅绑定 (src/joins/index.ts:1–3) and lines that only share a point are drawn separately. New:

- **'bound' is a join mode** beside smooth / cusp / arc, stored like them per pair of lines at a point. It constrains nothing in the shape (as 仅绑定 today); its effect is in the ink (merged, swept).
- **No row = only sharing the point.** Such lines are drawn separately; their ends there are free ends.
- **Created automatically** (one rule): when an edit makes a point carry exactly two line ends and that point had at most one before — the pen continuing from a free end, binding two free ends (bowen 1791808359 / 1791808493), and splitting a line (my addition for consistency — the two halves were one line; flagged for review) — the two get a 'bound' row. A later bind onto a point that already has two or more lines creates no row and changes no existing row (bowen 1791808359: "后来的仅绑定不破坏原有仅绑定设置的效果"); a pair is changed by setting its join (Join tool), and a pair can be broken by unbinding.
- **Which pairs merge in the ink: exactly the pairs with a row** — at a fork, the existing rows decide (bowen 1791808196; only the pairing is stored, not a binding history — dot 1791808553).
- **Old drawings:** a new archive version; opening the previous version adds a 'bound' row at every point with exactly two line ends and no row; forks get none. Gated on the version, so a drawing saved in the new format never gains rows on reopening (a point left with two lines and no row after deleting a fork's third line stays without one). The archive refuses older versions without migration (src/archive/index.ts:8–14) — this is a second, approved exception for the previous version only.
- Unchanged: smooth's spring, arc's trims and fillet, cusp's freedom; rows dropped when their lines no longer meet at the point (existing pruning); copy / paste carries rows (clipboard), undo / redo, every view sharing the modes.

## 3. Sharp joins — F, and what is not settled

F (docs/sharp-join-F.md) as the geometric idea (dot 1791806880): a zone around the joint; each line flat-ended at p; the two outer edges extended along their **actual** edge directions at p to meet at M (the tip), the inner edges meeting at Q; only the outermost outline kept; a tip longer than 5 × the average width pulled back with its sides bent onto the shortened tip (the curved style of the sheets — the style is bowen's to choose). The handling added around F on the sheets — trimming or narrowing a wide line's exposed inner corner (I2b-i / I2b-ii-w), easing to the average when the outer edges do not meet (O3-w), the 0° pinch — are candidate implementations, not the principle; their thresholds are the known jumps of §1.4.

**To try, not assumed (dot 1791808765):** easing a sharp joint's two widths to one width inside the zone before F. It removes the end-width difference at p, but not necessarily every crossing of the edges inside the zone, and with an S-curve the width is still changing at p, so the edges are not parallel to the centre lines there. Delivered with pictures against the sheets' cases, both with and without it.

## 4. The transition zone

- **Desired length** Z from the two widths a, b: **√(a² + b²)** as the default (bowen 1791808196 — an example "slightly larger than both"; a look parameter, not a principle — dot 1791808765). Figure A (Slack, F0C9DE41WP2) compares it with "wider + 3 × |a − b|" and today's "3 × wider" for bowen's choice.
- **Placement:** centred on the joint (Z/2 on each side), on an arc centred on its midpoint — the zone covers the arc and, when longer, (Z − arc length)/2 of each line.
- **Limited by the available length, both ends of a line together** (dot 1791807641): each side's half-zone is at most a share of the line's length so a line's two zones never overlap (default: a third of the line each); the transition stays centred (both sides shortened to the shorter half).
- Width at a zone's boundary = the line's own width there (with later width profiles / tapers: the profile's width at that point).

## 5. Packages (one at a time, each accepted by dot)

1. **J1 — 'bound' joins in the core:** the mode; automatic creation (pen, split, bind of two free ends); no change on later binds; the archive version and its migration; the Join tool offering it. Flows: pen chains, split, bind onto a free end / onto a fork, unbind, undo / redo, copy / paste, save / reopen (old file → rows added; new file → never), multi-view.
2. **J2 — swept joins in the ink:** groups only through rows; bound / smooth / arc as one sweep along the connected path with the zone's S-curve; free-end and unjoined ends round; the current smooth easing (each side to the average, flat at p) replaced. Flows: equal and unequal widths, a chain with joins at both ends of a short line, an arc, a fork with one joined pair, hide a line, width / radius edits, undo.
3. **J3 — sharp joins by F:** flat ends, M and Q from the actual edges, the tip limit; the equal-width simplification tried and shown with pictures; known jumps recorded.

Tests: ordinary cases and everyday operations only (bowen 1791801468); the real-drawing checks on 5199 with images (dot 1791783670).
