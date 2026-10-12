# Ink P1 — single-line outlines: checklist before any code (for dot's review)

Plan: `docs/ink-joins-plan.md` (passed for P0 + P1's single-line design, dot 1791789250); P0: `docs/ink-p0-measurements.md` (accepted, dot 1791790947); dependency `clipper2-ts` 2.0.1-18 added with bowen's approval (1791800851, 2f4ba56). This checklist is committed before the first P1 code commit; at hand-in the same flows are run and reported, and the counts (commits, review rounds, issues found per round) are compared with it.

**P1 scope:** ink for **single lines** only — every line drawn as today (round ends at both ends, no join constructions); the experimental switch; the diagnostics; the error verification. No join of any kind changes shape in P1 (cusp, smooth, arc all look as today).

## 1. Construction (one line)

- **Input:** the line's drawn centre curve from `reader.geometry().lines` (already trimmed by arcs where derived trims it) and its `stroke.width` from `reader.snapshot()`.
- **Outline = the stroke a round-capped SVG stroke paints:** the Minkowski sum of the centre curve with a disc of radius h = width / 2. Built with the library's own offsetter (mature choice): the centre curve is flattened to a polyline P, then `inflatePaths([P], h·s, JoinType.Round, EndType.Round, miterLimit, arcTolerance)` on integer coordinates at scale s (signature read from clipper2-ts's `Clipper.d.ts:31`), `arcTolerance` set from the budget. This yields the swept region of P with round joins and round caps — including self-overlap of a tightly curved line (where the inner offset folds) without our own fold handling.
- **What the construction argument covers (dot 1791801420):** for a centre curve C and a polyline P, the swept *regions* (Minkowski sums with the same disc) differ by at most the Hausdorff distance between C and P — a statement about the filled sets; it does not by itself bound the distance between the two boundaries pointwise, nor preserve holes' topology. It motivates the construction; it is not the verification.
- **Zero-length line (dot 1791801420):** defined separately as a disc of radius h centred on the point, built by us as a polygon within the arc budget — never left to the library's handling of a one-point input; its own test.

## 2. Error budget and the evidence recorded per line (§5, §10.1 of the plan; dot 1791790593 / 1791790774 / 1791790804 / 1791801420)

- ε per line = clamp(1 % of the line's full width, ε_min, ε_max), split: flattening ε/2, arc approximation ε/4, rounding ε/4.
- **Each kind of error is recorded separately**, with its own status (bounded / measured / not established):
  - **Flattening — bounded:** each cubic piece is subdivided until every control point lies within ε/2 of the **finite chord segment** of that piece (distance to the segment, not to the infinite line — a curve folding back along its chord is otherwise flattened wrongly); a zero-length chord is treated as a point (distance to that point). Termination: a parameter-length floor; a piece stopped there records the bound reached. Tests include a cubic folding back collinearly.
  - **Arc approximation — a configuration to be checked, not a proven bound:** `arcTolerance` is passed to the library; P1's tests measure the actual deviation of round joins and caps on our cases; the record says "configured / measured", never "proven".
  - **Rounding:** our input vertices move ≤ √2 / (2s); **every vertex the library outputs is rounded too** — offset points as well as self-crossings — so rounding is recorded as measured on the result, not assumed from the inputs.
  - **The boolean result:** the adapter's checks of §2b (simple loops, no bridge) and the per-vertex distance check (every output vertex within [h − ε, h + ε] of the true centre curve, the distance to the cubic computed by subdivision to a stated tolerance). These checks **do not certify the whole outline**: deviations in the middle of edges, vanished slivers and holes can escape them. The area comparison (length × 2h + πh²) applies **only** to curves whose sweep does not overlap itself, as a sanity check.
- **No result is called verified unless every part has a complete bound.** "Verified when there is no new crossing" is withdrawn.
- **What is drawn (revised after bowen 1791801560 / 1791801629 and dot 1791801801 — rare defects are shown, not hidden):** a **detected defect** (a check of §2b fails, a vertex out of the band, the area check off where it applies) → the ink is **still drawn** and marked on the canvas (a red dashed outline, the reason on hover), status 'defect'; **checks passed but no complete bound** → drawn, 'unproven'; **complete bound** → 'verified'; **nothing to draw** (no usable width, no outline from the library) → today's stroke, 'fallback', so the line is never blank. Only crashes, hangs and damage to the drawing are blocked up front.
- **Acceptance (bowen 1791801468, dot 1791801503):** real drawings compared switch on / off, the known failure cases (the upstream reports, the slivers and counterexamples from P0) and the everyday operations of §5 — no general mathematical proof is required before P1 ships behind the switch.

## 2b. Known library defects — the adapter checks every output (dot 1791800973)

- **Open upstream reports, confirmed in the port by its maintainer:** clipper2-ts #29 = Clipper2 #1083 ("UNION fails to output simple polygons" — non-adjacent self-intersections left in closed output paths) and clipper2-ts #30 = Clipper2 #1085 ("Unexpected bridges after union" — zero-width bridges). Not yet reproduced on our pinned 2.0.1-18. The WebAssembly build is the same upstream algorithm, so switching to it does **not** remove them.
- **Regression list (P1 tests):** the two reports' inputs, reproduced on the pinned version and kept as fixtures whatever they show.
- **Output checks in the adapter, on every result (dot 1791801420):** each output loop is simple — no two non-adjacent edges cross, touch at an endpoint, or overlap collinearly; the orientation and cross products computed **exactly with BigInt** (coordinates that fit in a Number do not make their products exact); no zero-width bridge (no edge meeting another edge of the same result collinearly in the opposite direction over a shared stretch, no vertex visited twice in one loop). Holes keep their orientation, and a legitimate point contact **between different loops** (as at a 0° touch) is allowed, not reported as a defect. Plus the vertex-distance check and, where it applies, the area check of §2.
- **When a check fails:** the ink is drawn as built and marked (red dashed outline, reason on hover) — the defect stays visible and reproducible (dot 1791801801); never silent, never blank.
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
