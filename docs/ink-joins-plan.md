# Ink outlines and sharp joins — plan for the product module (for dot's review before any code)

bowen 1791777083 (joins are the visual area), 1791777446 (sharp and smooth joins; the outer lash and outer liner joined in a point), 1791777482 (the tip ≤ 5 × the line width), 1791780683 (one layer first; the tip must meet the line; unequal widths must not make a lopsided tip). The constructions come from the experiments in `docs/sharp-join-F.md`, passed by dot sample by sample; the experiment code (`bench/experiments/`) is a reference and is **not** imported — the module is written again from the definitions, with its own tests. dot 1791788158 asked for this plan with five points made concrete (§3–§7); 1791788184 / 1791788305 / 1791788321 for the boundary table (§4).

## 1. What exists today (read from the code)

- **Width** is one number per line per view: `Stroke { width, profile }` on `Line.stroke` (src/network/index.ts:35–39, src/shapes/index.ts:17–18). `profile` is a free string that nothing interprets; the end stroke's `taper` (src/joins/index.ts:13) is stored and never drawn. Width never enters geometry (src/derived/index.ts:3–4; test/acceptance.test.ts:145–153, 268–273).
- **Joins** at one point: `JoinMode = 'smooth' | 'cusp' | 'arc'` (src/joins/index.ts:10); a row is `{ point, lines: [Id, Id], mode }`, the ends found from `line.a === point` (src/derived/index.ts:59). `smooth` aligns handles (spring solver), `arc` trims and inserts a fillet (src/derived/index.ts:60–93); **`cusp` (尖角) has no geometry at all** (test/acceptance.test.ts:200). Link joins (across layers) are smooth only (src/links/index.ts:55–61).
- **Drawing** (bench/src/app.tsx:1097–1103): each line is its own SVG `<path>` with `stroke-width = width` and round caps; no outline is built; joins are overlapping round caps. Fills are drawn from the centre-line loops (`Geometry.fills`, src/derived/index.ts:21, bench 1080–1082).
- **One source of drawn centre lines:** `LayerReader.geometry()` → `derived.derive` (src/document/index.ts:738) — every view, `atPose` (playback, src/document/index.ts:704–708) and `preview` reach it. Hit-testing, picking and fills use derived's centre-line `outline()` and never width (src/derived/index.ts:143–218).
- **Playback appearance:** `evaluate.appearance` takes width from the dominant view, no blend (src/evaluate/index.ts:237–249) — ledger row 9.

## 2. Ownership and reach — ink never writes the drawing

- **A new package `ink/`** (a sibling like `move/`, `slider/`): pure functions, no state, no writes. Input: one view's `Geometry` (the drawn centre lines after arc trims) + each line's `stroke` + the `cusp` join rows + the options (k, the limit factor 5). Output: `Ink` — closed loops (outer loops and holes, touch points kept as shared vertices, §5) per layer, plus a **diagnostic per join** (its class, the construction used, any fallback and why — §6).
- **Core is not changed and no read API is added** (so ledger row 6's trigger, "the next read API", is not hit): consumers call `ink.build(reader.geometry(), reader.snapshot())` themselves.
- **Who reads what:**

| Consumer | Reads | Change in this plan |
|---|---|---|
| Canvas (editing, every view) | `ink.build` loops, filled | replaces the SVG strokes for lines (P1) |
| Playback (`atPose`) | the same `ink.build` on the posed reader | same code path as editing |
| Edit preview ghosts, drag ghosts | centre lines (dashed) | unchanged |
| Fills | centre-line loops (`Geometry.fills`) | unchanged (pinned by test/acceptance.test.ts:268–273) |
| Hit-testing, selection, name labels | centre lines | unchanged |
| Layer thumbnails | centre lines at a fixed width | unchanged in this plan; listed for later |

- **Guarantees, tested in every package:** `snapshot()` and `geometry()` are byte-identical before and after `ink.build`; no edit is issued; no network / shape / join data is read except through those two values.
- **Out of scope** (no settled principle — scope rule): `profile`, end-stroke tapers, smooth / arc joins' ink beyond today's union of round-capped strokes, link joins, more than two lines in one join point.
- **Ledger row 9** (playback appearance switches at the dominant view): its trigger is "when bowen takes up playback rendering". This plan draws whatever width the posed snapshot carries and **does not** decide how widths blend across views — that is an appearance rule without a settled principle (bowen's call). It waits, with this reason; the ink module is built continuous in width (§4) so that once slot A blends widths, the ink follows without change.

## 3. The default construction per class — and what stays a comparison only

| Class (sharp-join-F.md §4) | Product default | Comparison only (not in the product) | bowen later (look) |
|---|---|---|---|
| O1 × I1 | F: zone rebuilt E0o → M → E1o … Q … | — | — |
| O2 | shortened with curved sides, apex on the 5 × average-width circle (as B) | A / D / E styles | fullness style |
| I2a | union of the end pieces and the tip | — | — |
| I2b-i | W's end piece trimmed to T's side | — | — |
| I2b-ii | **I2b-ii-w**: W's inner side narrowed within ℓ (Hermite, tangent at J) | trim-to-R1 (`sharp-join-I2bii.mjs`) — **never a default** | — |
| O3 (unequal, blunt) | **O3-w**: widths eased to h_p at p, corner kept | the bridged O3 (rounds the corner off) | h_p (average / thin / wide) |
| 0° (exact reversal) | v103's pinch: width × smoothstep(s/ρ) | — | — |
| 180°, equal / unequal | plain union / O3-w easing | — | — |
| degenerate input | §6 | — | — |

ℓ = k × the wider full width, k = 3 to start (experiment parameter; bowen later). Tip limit 5 × average full width (bowen 1791777482, v103 `cuspCorner`).

## 4. Class boundaries — no switch may make the outline jump

An experiment class is **not** a product branch (dot 1791788184). Each boundary is a place where two constructions must give the same outline on both sides; what is established so far is only which of today's constructions do or do not meet there (dot 1791788305: a change of tangent direction does not by itself mean the outline jumps).

| # | Boundary | Status | What has to be decided |
|---|---|---|---|
| B1 | I1 ↔ I2 (Q reaches a zone cut) | expected continuous (Q on the cut gives the same inner edges) — unverified | — |
| B2 | I2a ↔ I2b-i (the protrusion appears) | expected continuous (the trim removes nothing at zero protrusion) — unverified | — |
| B3 | I2b-i ↔ I2b-ii-w (d1 = ℓ) | **do not meet**: at d1 → ℓ⁺ the Hermite hump stays ≈ (4/27)·ℓ·tan θ (0.57 at 6°, ℓ = 36) while I2b-i's top is flat | a joining rule |
| B4 | O1 ↔ O2 (M on the limit circle) | expected continuous (B's control point equals M there, the sides become straight) — unverified | — |
| B5 | O1 ↔ O3 (a forward extension's parameter passes zero: M at A or B) | **unknown**; O3-w changes widths at once | a joining rule |
| B6 | O2 ↔ O3-w | **unknown** | a joining rule |
| B7 | small θ ↔ 0° (O2 tip ↔ pinch) | **do not meet**: a 5×-limit tip on one side, zero width on the other | a joining rule |
| B8 | 180° ↔ near 180° (unequal widths) | expected continuous (O3-w at both) — unverified | — |

- **A joining rule** is a definition first (to dot), then code. Interpolating one "strength" is only a candidate (dot 1791788305): each rule must keep, at once, the end widths at the cut, the tangent at the junction, no step, and the tip limit — each checked.
- **Verification is a sweep, not a grid:** angle, width ratio and ℓ swept finely across each boundary; for every step record the outline distance to the previous step (Hausdorff, sampled on both outlines), the topology (loops, holes, touch points), the turn at the junction, the construction used and any fallback (dot 1791788321). Passing = the distance shrinks with the step size, and topology / construction do not flicker. Static sheets are not this check.
- **Until a boundary has a passed rule**, the region beyond it is not enabled. **What is drawn there:** the two lines exactly as today — each its own constant-width ink with round ends at p (the current look), overlapping at the joint — plus the join's diagnostic (§6). The lines are always drawn; a notice never replaces them (dot 1791788305). The jump between the enabled region and this fallback is a known, listed jump, shown in the sweep, not hidden.

## 5. Outline extraction and sampling error

- **The experiments' extractor has a known defect:** it decides a sub-edge's sides by testing points 1e-5 off it, so a sliver thinner than that is misjudged (seen twice: a free-end cap, and the narrowing strip at the cut). The product must not inherit it.
- **Proposal (mature choice first):** union and trim by **Clipper2** (Angus Johnson's polygon clipper, integer coordinates, built for touching and coincident edges). *Unverified here:* which JavaScript port exists, its licence and its maintenance — to be checked and stated before bowen is asked. Installing a dependency is a download — **bowen's permission is needed first**; until then nothing is installed.
- **Fallback if not permitted:** our own extractor with an exact side rule — a sub-edge on piece q's boundary takes q's inside from q's orientation, other pieces are tested at the midpoint (never on their boundary after the vertex registry) — no offset. Its tests: every sliver case the experiments hit, kept as fixtures.
- **Sampling error:** each cubic is flattened adaptively until the polyline's distance to the curve is ≤ ε, and offsets are taken at those samples; ε is fixed in document units relative to the thinnest width in view (start: 1 % of it), so the error is known, not dependent on a sample count. A test measures the outline's distance to the true offset on sample curves against ε.
- **Touch points** (0°: two arms meeting at one point) are output as separate loops sharing the vertex, as in the experiments.
- **Cost:** playback rebuilds ink every frame; P1 measures ink for a drawing of the bench's size per frame and reports it before the canvas switches over.

## 6. Inputs the construction cannot handle — never silently blank

- **Short lines:** the zone ℓ is capped at a share of each line's length (v103 caps its pinch radius at a third of the part, appearance.ts:125); the cap is continuous in the length, so shortening a line does not switch the construction. Two joins on one short line: each zone at most half its length.
- **Degenerate input** (a zero-length line, no usable end tangent): the line is drawn as its own ink (a round dot of its width for zero length); the join is reported as degenerate.
- **No legal construction** (a check fails: J not found, a fold, the narrowed edge would cross, an unenabled region): the fallback drawing of §4; the diagnostic names the failed condition.
- **How it is shown:** the diagnostics come out of `ink.build` with the ink; the bench marks such a join point on the canvas and lists the reason in the properties panel for that join. Nothing is hidden and nothing is left undrawn.

## 7. Packages (one at a time, each accepted by dot before the next)

| Package | Content | Done when |
|---|---|---|
| P0 | bowen: may we install Clipper2? (and §8's look questions only after P2) | answer recorded |
| P1 | `ink/`: single lines — outline at constant width with round ends (today's look), flattening with ε, the extractor (Clipper2 or the exact rule), diagnostics type; bench draws ink fills instead of SVG strokes; cost measured | the canvas looks as today within ε; snapshot / geometry untouched; tests |
| P2 | cusp joins in the region bounded by B1, B2, B4: O1 / O2 × I1 / I2a / I2b-i on curves; everything else the §4 fallback with a diagnostic; sweeps across B1, B2, B4 | sweeps pass; sample sheets as before |
| P3 | §6: short lines, degenerate input, the canvas marks and panel reasons | each case has a test and is visible |
| P4 … | one package per remaining boundary: B3 (I2b-ii-w), B5 / B6 (O3-w), B7 / 0° (pinch), B8 — definition to dot, then code, then its sweep | each boundary's sweep passes |

After P2, bowen sees the correct variants that differ only in look (O2 style, h_p, k) and chooses; until then the defaults of §3 stand.

## 8. For bowen (later, not now)

The O2 tip style, the common width h_p of O3-w, the zone factor k; and, separately, whether widths should blend between views during playback (ledger row 9).
