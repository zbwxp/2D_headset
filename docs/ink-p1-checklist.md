# Ink P1 — single-line outlines: checklist before any code (for dot's review)

Plan: `docs/ink-joins-plan.md` (passed for P0 + P1's single-line design, dot 1791789250); P0: `docs/ink-p0-measurements.md` (accepted, dot 1791790947); dependency `clipper2-ts` 2.0.1-18 added with bowen's approval (1791800851, 2f4ba56). This checklist is committed before the first P1 code commit; at hand-in the same flows are run and reported, and the counts (commits, review rounds, issues found per round) are compared with it.

**P1 scope:** ink for **single lines** only — every line drawn as today (round ends at both ends, no join constructions); the experimental switch; the diagnostics; the error verification. No join of any kind changes shape in P1 (cusp, smooth, arc all look as today).

## 1. Construction (one line)

- **Input:** the line's drawn centre curve from `reader.geometry().lines` (already trimmed by arcs where derived trims it) and its `stroke.width` from `reader.snapshot()`.
- **Outline = the stroke a round-capped SVG stroke paints:** the Minkowski sum of the centre curve with a disc of radius h = width / 2. Built with the library's own offsetter (mature choice): the centre curve is flattened to a polyline P, then `inflatePaths([P], h·s, JoinType.Round, EndType.Round, miterLimit, arcTolerance)` on integer coordinates at scale s (signature read from clipper2-ts's `Clipper.d.ts:31`), `arcTolerance` set from the budget. This yields the swept region of P with round joins and round caps — including self-overlap of a tightly curved line (where the inner offset folds) without our own fold handling.
- **Why this is the stroke:** for any centre curve C and polyline P, the Minkowski sums with the same disc differ by at most the Hausdorff distance between C and P; the library's offset differs from the exact sum of P by at most its arc tolerance (round joins and caps are arcs approximated by chords).

## 2. Error budget and its verification (§5, §10.1 of the plan; dot 1791790593 / 1791790774 / 1791790804)

- ε per line = clamp(1 % of the line's full width, ε_min, ε_max), split: flattening ε/2, arc tolerance ε/4, rounding ε/4.
- **Flattening, verified by a bound:** each cubic is subdivided until its control polygon lies within ε/2 of the chord of every piece (the convex-hull property bounds the curve's distance to the chord by the control points' distance) — a conservative bound, not a midpoint test. Termination: a parameter-length floor; a piece stopped there is "not verified" with the bound reached.
- **Arc tolerance:** passed to the library; *unverified here* — the library's documentation defines it as the maximum deviation of the arc approximation; P1 adds a test measuring it on our cases, and if a measured deviation exceeds the setting, the claim is dropped.
- **Rounding:** each input vertex moves ≤ √2 / (2s); s chosen per line so that this is ≤ ε/8. **New vertices made by the library** (where the offset overlaps itself) have no proven bound (dot's counterexample, 1791790659). They are checked **a posteriori, on the whole result**: every output vertex's distance to the true centre curve must lie in [h − ε, h + ε] (the distance to the cubic computed by subdivision to a stated tolerance). Because a vanished sliver or hole leaves no vertex (dot 1791790659), the area is compared too: the result's area against the analytic stroke area (length × 2h + πh² for a curve without self-overlap; a sanity check, not a proof). A line whose result fails, or cannot be checked, is reported **not verified**.
- **Lines without self-overlap** (no output vertex that is not an offset sample, cap or join arc point): verified by the bounds alone.

## 2b. Known library defects — the adapter checks every output (dot 1791800973)

- **Open upstream reports, confirmed in the port by its maintainer:** clipper2-ts #29 = Clipper2 #1083 ("UNION fails to output simple polygons" — non-adjacent self-intersections left in closed output paths) and clipper2-ts #30 = Clipper2 #1085 ("Unexpected bridges after union" — zero-width bridges). Not yet reproduced on our pinned 2.0.1-18. The WebAssembly build is the same upstream algorithm, so switching to it does **not** remove them.
- **Regression list (P1 tests):** the two reports' inputs, reproduced on the pinned version and kept as fixtures whatever they show.
- **Output checks in the adapter, on every result:** each output loop is simple (no two non-adjacent edges cross — segment test on integer coordinates, exact); no zero-width bridge (no edge that meets another edge of the same result collinearly with opposite direction over a shared stretch, and no vertex visited twice in one loop); plus the vertex-distance and area checks of §2.
- **When a check fails:** that line is drawn **as today** (its SVG stroke, so nothing goes missing) and its diagnostic says which check failed. Never silent, never blank.
- **The glue estimate** ("one or two hundred lines", Slack 1791800780) is a first guess only; the adapter also carries these output checks, the source information and the failure handling.

## 3. Ownership and reads (plan §2, §10)

- `ink/` package (sibling of `move/`): `build(geometry, snapshot, options) → Ink`; pure, no state, no writes.
- `Ink = { pieces: { source: { kind: 'line', id }, loops: number[][][] }[], diagnostics: { line: id, status: 'verified' | 'not-verified', reason?, bound? }[] }`.
- Core unchanged; no new read API (ledger row 6 not triggered).
- Tests in every flow below: `snapshot()` and `geometry()` byte-identical before / after `ink.build`; no edit issued.

## 4. Drawing — what changes and what does not

- **Switch off (default): the canvas is exactly today's** (SVG strokes, bench/src/app.tsx:1097–1103).
- **Switch on:** each line's ink is drawn as its own filled path **in today's order and with today's paint** (normal / selected / picked / mirror source / cut / locked, pose colours, app.tsx:1100); no merging across lines in P1 (no shared cuts exist without joins, and all paints are opaque, so per-line paths give no seam and no double colour).
- **Unchanged either way:** hidden lines' dashed decoration at 0.35 (app.tsx:1102), drawn from the centre line; arcs' own path (1104); halos (1090–1091); fills (1080–1082); edit-preview and drag ghosts (centre lines); thumbnails; hit-testing; name labels.
- **The switch:** a bench-only toggle, not saved with the drawing, not in core; its state never enters undo.

## 5. Flows to walk (each run by me before hand-in, with the switch on and off)

1. Open the bench drawing in every view: switch on looks like switch off within ε (pixel comparison of a rendered strip per line, and the ink's distance to the SVG stroke's analytic boundary).
2. Draw a new line (pen), move a point, move a handle, change width with the slider and by keyboard: ink follows every edit; no stale ink after undo / redo.
3. Select / pick / mirror source / cut / lock a line: paint changes as today; ink shape does not.
4. Hide and show a line: hidden → dashed decoration only, no ink; shown → ink back.
5. Arc join between two lines: the trimmed lines are inked as trimmed, the arc drawn as today.
6. Playback (`atPose`): ink rebuilt from the posed reader each frame; cost measured (below).
7. Save, reopen: nothing ink-related is saved; ink rebuilt on open.
8. Degenerate inputs: a zero-length line → a round dot of its width; a line with a collapsed handle (zero speed at an end) → drawn, with the one-sided direction rule of the plan §10.1 deciding whether anything is added; a very short line; a line folding back on itself (tight loop).
9. A tightly curved line (radius of curvature < h): ink equals the swept region (no gap where the inner offset folds), and the diagnostic says verified or not verified, never silent.

## 6. Cost (plan §5)

- Measured in the browser on the bench drawing: `ink.build` per frame in playback and per edit; reported before the switch can come on. No target is promised in P1 — the switch stays experimental.

## 7. Acceptance criteria for the hand-in

- All flows of §5 run and reported, with screenshots of switch on / off for each.
- Tests: the construction (sweep equals the analytic stroke for circles, lines, cubics within ε), the bounds (flattening bound ≥ measured deviation), the a-posteriori check (catches a planted outlier vertex; a planted vanished sliver changes the area check), degenerate inputs, no writes.
- The diagnostics list for the bench drawing, with how many lines are verified / not verified and why.
- Ledger: rows hit by this package checked (6 not triggered; 9 untouched — playback widths still switch at the dominant view).
