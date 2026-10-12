# Sharp joins — summary of the experiment phase (2026-10-12)

bowen asked for joins (1777083), sharp joins whose tip is ≤ 5 × the line width (1777446, 1777482), one layer first, the tip meeting the line and no lopsided tip when widths differ (1780683); he asked for this phase to be closed quickly (1791801422). Full definitions: `docs/sharp-join-F.md`; product plan: `docs/ink-joins-plan.md`; experiment code (reference only, not imported): `bench/experiments/`.

## What is settled — each with sample sheets that dot reviewed and passed

| Situation | Construction | Where it was checked |
|---|---|---|
| Two lines meeting in a tip, the outer edges meet in front (O1), inner edges cross near the joint (I1) | each line keeps its own width; near the joint the ink is rebuilt: outer edges extended to the tip M, inner edges meeting at Q | straight bands and curves (F-bands, F-curves, F-union) |
| The tip longer than the limit (O2) | the tip shortened to 5 × the average of the two local widths (5× is bowen's; "average" is v103's); its sides leave the lines' edges tangentially and curve to the apex (style B) | straight and curved sheets; equal-width comparison with v103 (identical except when the tip is shortened: ours ≈ 20 % fuller at 8°) |
| Small angles, no square end showing (I2a) | the two lines' end pieces and the tip, united | F-union, curves |
| Small angles, the wide line's square end sticks out within the joint zone (I2b-i) | the wide line's end piece trimmed to the thin line's side | F-union, curves |
| The square end sticks out beyond the zone (I2b-ii) | **I2b-ii-w**: only the wide line's inner side narrows within the zone (a cubic in width, tangent to the thin line's edge at J, back to full width at the zone's edge) — no step, no corner; the remaining cost is a smooth hump | straight (20 cells) and curved (28 cells) |
| Very different widths at a blunt angle (O3) | **O3-w**: widths eased to the average at the joint (v103's smoothstep), the corner kept sharp | straight and curved (50 cells) |
| Folding back (0°) | v103's pinch: the width eases to zero at the joint | 16 cells incl. arms touching only at the joint |
| Straight on (180°) | equal widths: one line; unequal: the widths ease | in the O3-w sheet |

Comparison variants kept, **never defaults**: trimming out to R1 for I2b-ii (reaches far along the line), the rounded bridge for O3 (rounds the corner off).

## What the phase established beyond shapes

- **Checks that make a sample count:** one closed outline (holes counted against the plain lines), no crossings, no exposed square-end corner, the tip within the limit, 12 rotations, mutations that must fail, rendered images — all on sampled outlines, so each result is stated for its samples only.
- **The outline extractor** of the experiments has a known defect on slivers thinner than its side offset; the product uses `clipper2-ts` (measured, accepted by dot; installed by bowen's approval) behind an adapter that checks every result for the library's two known upstream defects.

## What is not done

- **Boundaries between situations:** the shape must not jump when an angle or width moves a joint from one situation to another (e.g. I2b-i ↔ I2b-ii-w, O2 ↔ O3-w, small angle ↔ 0°, any construction ↔ the plain fallback). Joining rules are still to be defined and swept.
- **The product module:** not on the canvas yet. Order (bowen 1791801422): the shared ink base (single-line outlines, P1 — checklist under dot's review), then arcs (ink through the arc at the line's width, as v103), smooth joins (widths eased where they differ), then sharp joins on that base — all behind a test switch first.
- **For bowen, later:** the shortened-tip style (curved B or v103's straight sides), the common width at blunt unequal corners, the joint-zone length.
- **Out of this phase:** degenerate inputs (zero-length lines, unusable tangents) beyond falling back to today's drawing; more than two lines at one point; link joins.
