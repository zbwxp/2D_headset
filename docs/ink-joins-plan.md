# Ink outlines and sharp joins — plan for the product module (for dot's review before any code)

bowen 1791777083 (joins are the visual area), 1791777446 (sharp and smooth joins; the outer lash and outer liner joined in a point), 1791777482 (the tip ≤ 5 × the line width), 1791780683 (one layer first; the tip must meet the line; unequal widths must not make a lopsided tip). The constructions come from the experiments in `docs/sharp-join-F.md`, passed by dot sample by sample; the experiment code (`bench/experiments/`) is a reference and is **not** imported — the module is written again from the definitions, with its own tests. Asked for by dot 1791788158; boundary rules 1791788184 / 1791788305 / 1791788321. **Second version:** dot 1791788545 and 1791788609 did not pass the first (f1c39bb); their seven points are answered in place and listed in §9.

## 1. What exists today (read from the code)

- **Width** is one number per line per view: `Stroke { width, profile }` on `Line.stroke` (src/network/index.ts:35–39, src/shapes/index.ts:17–18). `profile` is a free string nothing interprets; the end stroke's `taper` (src/joins/index.ts:13) is stored, never drawn. Width never enters geometry (src/derived/index.ts:3–4; test/acceptance.test.ts:145–153, 268–273).
- **Joins** at one point: `JoinMode = 'smooth' | 'cusp' | 'arc'` (src/joins/index.ts:10); a row is `{ point, lines: [Id, Id], mode }`, its ends found from `line.a === point` (src/derived/index.ts:59). `smooth` aligns handles; `arc` trims both lines and inserts a fillet (src/derived/index.ts:60–93) — so **a line in `Geometry` may already be shortened at a point**; **`cusp` (尖角) has no geometry** (test/acceptance.test.ts:200). Link joins are smooth only (src/links/index.ts:55–61).
- **Drawing** (bench/src/app.tsx:1090–1104): each line its own SVG `<path>`, `stroke-width = width`, round caps; per-line display state (selection halo 1090–1091, pose colours 1100); arcs a separate path with their own colour and width (1104); fills from centre-line loops (1080–1082). Drag ghosts are built from points and handles (804–821, 1114); edit-preview ghosts are dashed centre lines (1116–1117).
- **One source of drawn centre lines:** `LayerReader.geometry()` → `derived.derive` (src/document/index.ts:738), reached by every view, `atPose` and `preview`. Hit-testing, picking, fills use centre lines only (src/derived/index.ts:143–218).
- **Playback appearance:** `evaluate.appearance` takes width from the dominant view (src/evaluate/index.ts:237–249) — ledger row 9.

## 2. Ownership and reach — ink never writes the drawing, and keeps each line's display rules

- **A new package `ink/`**: pure functions, no state, no writes. Input: one view's `Geometry`, each line's `stroke`, the `cusp` rows, the derived trim information (which end of a line is at its original point), options. Output: `Ink` (below) and one **diagnostic per join** (§6).
- **Core is not changed, no read API is added** (ledger row 6's trigger is not hit): consumers call `ink.build(reader.geometry(), reader.snapshot())`.
- **Ink stays attributed to its source (dot 1791788609 point 5).** `Ink` is a list of **pieces**, each with its source: a line's own ink (`line`), or a join group's ink (`join`, naming its lines and which part of each line it replaces). Nothing is merged across sources in the output; a join group's piece is the union of only that group's ink. Display rules stay per line:
  - **hidden** line: not an input — a join with it is not built, its partner keeps its plain end (the diagnostic says why);
  - **selection halo, pose colours**: drawn as today from the centre line, per line, under or over the ink; a join piece whose lines differ in display state is drawn in the base style, each line's own state shown by its halo;
  - **locked**: no effect on ink;
  - **arcs**: their fillet keeps its own path, colour and width as today (out of scope — arc ink is a later decision); a line trimmed by an arc is inked as trimmed.
- **Who reads what:**

| Consumer | Reads | In this plan |
|---|---|---|
| Canvas, every view | `Ink` pieces, filled; halos and states from centre lines as today | replaces the SVG strokes for lines only when the switch of §4 is on |
| Playback (`atPose`) | the same `ink.build` on the posed reader | same code path |
| Drag ghosts, edit-preview ghosts | centre lines (dashed) | **unchanged: a ghost does not show the final join**; the join appears on release |
| Fills | centre-line loops | unchanged (test/acceptance.test.ts:268–273) |
| Hit-testing, selection, name labels | centre lines | unchanged |
| Layer thumbnails | centre lines at a fixed width | unchanged; listed for later |

- **Tested in every package:** `snapshot()` and `geometry()` byte-identical before and after `ink.build`; no edit issued.
- **Out of scope** (no settled principle): `profile`, end-stroke tapers, ink of smooth / arc joins beyond today's round-capped union, link joins.
- **Ledger row 9 stays open, as a stated limit (dot 1791788609 point 7):** during playback the width still switches at the dominant view, exactly as today; ink draws the width it is given and does **not** fix that. Follow-up task: the appearance rule for slot A, its own package when playback rendering is taken up. No question to bowen now.

## 3. The default construction per class — and what stays a comparison only

| Class (sharp-join-F.md §4) | Default | Comparison only (never in the product) | bowen later (look) |
|---|---|---|---|
| O1 × I1 | F: zone rebuilt E0o → M → E1o … Q … | — | — |
| O2 | shortened, curved sides, apex on the 5 × average-width circle (as B) | A / D / E styles | fullness style |
| I2a | union of the end pieces and the tip | — | — |
| I2b-i | W's end piece trimmed to T's side | — | — |
| I2b-ii | **I2b-ii-w** (W's inner side narrowed within ℓ, Hermite, tangent at J) | trim-to-R1 (`sharp-join-I2bii.mjs`) — **never a default** | — |
| O3 | **O3-w** (widths eased to h_p at p, corner kept) | the bridged O3 (rounds the corner) | h_p |
| 0° (exact reversal) | v103's pinch | — | — |
| 180°, equal / unequal | plain union / O3-w easing | — | — |

ℓ = k × the wider full width, k = 3 to start (§6 caps it on short lines). Tip limit: **5 ×** is bowen's requirement (1791777482); **of the average of the two sides' local full widths** is v103's default, carried over (`cuspCorner`, inkJoin.ts) — not bowen's wording.

## 4. Class boundaries — and how nothing with a known jump reaches the canvas

An experiment class is not a product branch (dot 1791788184). What is established so far is only which of today's constructions do or do not meet at a boundary (dot 1791788305).

| # | Boundary | Status | Needs |
|---|---|---|---|
| B1 | I1 ↔ I2 (Q reaches a zone cut) | expected continuous — unverified | sweep |
| B2 | I2a ↔ I2b-i (the protrusion appears) | expected continuous — unverified | sweep |
| B3 | I2b-i ↔ I2b-ii-w (d1 = ℓ) | **do not meet** (hump ≈ (4/27)·ℓ·tan θ at d1 → ℓ⁺; 0.57 at 6°, ℓ = 36) | a joining rule + sweep |
| B4 | O1 ↔ O2 (M on the limit circle) | expected continuous (B's control point equals M) — unverified | sweep |
| B5 | O1 ↔ O3 (a forward extension's parameter passes zero: M at A or B) | **unknown** | a joining rule + sweep |
| B6 | O2 ↔ O3-w | **unknown** | a joining rule + sweep |
| B7 | small θ ↔ 0° | **do not meet** (a limit-length tip vs zero width) | a joining rule + sweep |
| B8 | near 180° ↔ 180° (unequal) | expected continuous — unverified | sweep |
| B9 | **any constructed join ↔ the plain fallback** (a check fails, a region not yet enabled) | **do not meet** by nature (a sharp construction vs two round-capped lines) | see below |

- **A joining rule** is a definition first (to dot), then code; interpolating one strength is only a candidate — each rule must keep the end widths at the cut, the tangent at the junction, no step and the tip limit, each checked (dot 1791788305).
- **Verification is a sweep:** angle, width ratio, ℓ, line length swept finely across each boundary; each step records the outline distance to the previous step (Hausdorff on both outlines), the topology (loops, holes, touch points), the junction's turn, the construction used and any fallback (dot 1791788321). Passing: the distance shrinks with the step, and topology / construction do not flicker.
- **Nothing with a known jump reaches the canvas (dot 1791788545 point 1).** All join constructions sit behind one **experimental switch**, off by default, in the bench only (not saved with the drawing, not in the core). With it off, the canvas draws exactly today's look (each line round-capped; ink of P1 reproduces it). The switch comes on by default only when every boundary a user can reach by editing — B1–B9 — has passed its sweep. B9 is the hard one: a join whose checks fail would jump to the plain fallback. It is closed only by constructions whose own checks cannot fail inside the reachable inputs (each failure mode of §6 mapped to a continuous rule or a narrower input domain), shown by sweeps up to the failure edges; until then the switch stays experimental.

## 5. Outline extraction and the error of the final ink

- **The experiments' extractor has a known defect** (a 1e-5 side offset misjudges thinner slivers — seen twice). It is not carried over.
- **A home-made exact extractor is not a ready fallback (dot 1791788609 point 4):** after coincident edges are split, a midpoint can still lie on several pieces' boundaries; a correct one must count each coincident edge's direction and coverage (winding contributions). That is its own design, written and reviewed before any such code; the plan prefers a mature library.
- **Candidates — checked from their registries and repositories on 2026-10-12** (npm registry metadata, GitHub API, the README; no package downloaded):

| Library | Licence | Latest / last publish | Repository | Notes from its documentation |
|---|---|---|---|---|
| `clipper2-ts` (countertype) | BSL-1.0 | 2.0.1-18, 2026-07-04 | github.com/countertype/clipper2-ts, pushed 2026-07-04, 4 open issues | TypeScript port of Clipper2 (C#-structured); no dependencies; 258 tests against Clipper2's reference suite (one bow-tie case with relaxed tolerance, also failing in C#); coordinates must stay within 2^53 (throws on overflow), `Number` with `BigInt` for some intermediate arithmetic; Z values on vertices with callbacks for new intersection vertices (can carry a source id); "faster than Clipper1 JS ports, slower than Clipper2-WASM" |
| `clipper2-wasm` (ErikSom) | BSL-1.0 | 0.4.0, 2026-05-18 | github.com/ErikSom/Clipper2-WASM, 112 stars, 1 open issue | WebAssembly build of the C++ Clipper2 (full 64-bit integers); depends on `@types/emscripten`; asynchronous loading not yet checked |
| `martinez-polygon-clipping` | MIT | 0.9.0, 2026-09-30 | github.com/w8r/martinez, 775 stars, 23 open issues | floating-point sweep-line with `robust-predicates`; not Clipper |
| `polygon-clipping` | MIT | 0.15.7, 2023-12-18 | github.com/mfogel/polygon-clipping, last push 2024-04-19, 46 open issues | less active |
| older Clipper ports (`clipper2-js`, `clipper-lib`, `js-angusj-clipper`) | BSL / MIT | 2019–2024 | — | not maintained recently |
| Clipper2 itself (C++/C#/Delphi) | BSL-1.0 | — | github.com/AngusJohnson/Clipper2, 2502 stars, pushed 2026-04-20 | the reference |

  **Candidate: `clipper2-ts`** (pure TypeScript, no dependencies, synchronous, tested against the reference, Z for attribution); `clipper2-wasm` as the faster alternative if measured speed requires it. **Not yet verified:** speed on our drawings and the behaviour on our sliver fixtures — both need the package on disk. **P0 asks bowen one thing:** may `clipper2-ts` (and, for comparison, `clipper2-wasm`) be downloaded into a scratch folder outside the project to measure them; installing into the project is a second decision after the measurement.
- **Integer coordinates:** Clipper works on integers; ink is scaled by a factor s chosen from the error budget below (one unit = 1/s drawing units), within 2^53.
- **The error is controlled on the final ink boundary, per line and locally (dot 1791788545 point 3):** each boundary curve of a piece — a line's offset edge with its width function, a join's rebuilt edges, a tip's sides, a cap — is subdivided adaptively in its own parameter until a **bound over the whole interval** is ≤ ε — not a test at the middle, which misses an S-shaped interval whose middle lies on the chord while both halves bulge (dot 1791788854). The bound: for a boundary curve f(u) on an interval of parameter length L, the distance from f to the chord of its ends is ≤ L²/8 · max|f″| on the interval (linear interpolation error). max|f″| is bounded per interval, never sampled: for a cubic centre line from its control points (the second derivative is linear in u, so its maximum is at an end); for an offset edge f = C + h·n from bounds of |C″|, |C′|, the curvature and its derivative, h, h′ and h″ on the interval (interval arithmetic on the cubic and on the width function — the Hermite's derivatives are polynomials); for a tip's quadratic sides from their control points. This bounds what is drawn, including normal turning, width change and join edges, not only the centre line; it is conservative, and a test compares it with a dense measurement on sample curves (the bound must never be below the measured error). ε is **local to each line**: ε = clamp(r × the line's full width, ε_min, ε_max), with r = 1 % to start, ε_min a fixed floor in drawing units — core already refuses a base width ≤ 0 (src/shapes/index.ts:56–58), so zero width arises only locally (a pinched end at 0°) and as ink's defensive input check; the floor keeps those finite and ε_max a ceiling; an unrelated thin line does not tighten others. A test measures every sample curve's ink against the true boundary.
- **Touch points** (0°): separate loops sharing the vertex.
- **Cost:** playback rebuilds ink every frame; P1 measures `ink.build` on a drawing of the bench's size and reports it before the switch can come on.

## 6. Inputs the construction cannot handle — safety first, in P1 / P2 (dot 1791788545 point 2)

- **Zero-length line, no usable end tangent:** never enter a join; the line is drawn as its own ink (a round dot of its width at zero length); the join's diagnostic says degenerate. In P1 (single lines) and P2 (joins).
- **Short lines and zone length:** ℓ is capped by the line's length with a cap continuous in the length (v103 caps its pinch radius at a third of the part, appearance.ts:125), so shortening a line changes ℓ smoothly, never the construction by a jump.
- **Two joins on one line** (dot 1791788609 point 6): the two zones must stay apart by a margin; each construction returns its line to the line's own width with zero slope at its cut (by definition), so between the cuts the line's ink is its original ink — **tested** (the ink between the cuts equals the plain line's within ε). If the zones would meet, both are shortened by the same continuous cap.
- **A cusp at a point where a line is trimmed by an arc** (dot 1791788609 point 6): `Geometry` lines are matched to their source lines and ends through the derived trim range; a cusp is built only when both lines' drawn ends are at the cusp's point. If either end is trimmed (an arc at the same point), the **whole group** at that point takes the plain fallback and the diagnostic names the mix.
- **More than two lines at one point with cusp rows:** the whole group at the point takes the plain fallback in P2; its own package later.
- **No legal construction** (J not found, a fold, the narrowed edge would cross, a region not yet enabled): the plain fallback; the diagnostic names the failed condition.
- **Shown, never blank:** the diagnostics come out of `ink.build`; with the experimental switch on, the bench marks such a join point and lists the reason in the properties panel (the marker's styling may come later; the diagnostic and the drawn lines are there from P1 / P2). The lines are always drawn.

## 7. Packages (one at a time, each accepted by dot before the next)

| Package | Content | Done when |
|---|---|---|
| P0 | the library check of §5 (done on paper, above); bowen: may the candidates be downloaded to a scratch folder to measure? then the measurement (speed, our sliver fixtures, s and ε) and the dependency decision | measured; dependency decided by bowen |
| P1 | `ink/` for single lines: constant-width outline, round ends, local ε on the final boundary, extraction, `Ink` pieces with source, diagnostics type, degenerate single lines; bench behind the experimental switch draws ink pieces; cost measured | with the switch on, every line within ε of today's look; switch off = today; snapshot / geometry untouched; tests |
| P2 | cusp joins on curves for O1 / O2 × I1 / I2a / I2b-i, behind the switch; source mapping and group fallbacks (arc-trimmed ends, more than two lines, two joins on one line); the safety inputs of §6; sweeps across B1, B2, B4 and B9 up to its failure edges | sweeps pass; the switch stays experimental |
| P3 … | one package per remaining boundary — B3 (I2b-ii-w), B5 / B6 (O3-w), B7 / 0° (pinch), B8 — definition to dot, then code, then its sweep | each sweep passes |
| last | the switch on by default | B1–B9 all passed |

After P2, bowen sees the correct variants that differ only in look (O2 style, h_p, k).

## 8. For bowen

- **P0 (now):** permission to download `clipper2-ts` and `clipper2-wasm` into a scratch folder to measure them — nothing installed in the project.
- **Later (after P2):** the O2 tip style, h_p, k.

## 10. Contracts to settle before any P1 code (dot 1791788918)

**10.1 Error.**
- **Termination:** an interval is split until its whole-interval bound (§5) is ≤ ε_flat, or until its parameter length reaches a floor (a depth limit, fixed); an interval stopped by the floor without meeting the bound is reported in the diagnostics ("precision not reached", with the bound reached) and drawn at that resolution — never an endless recursion, never silent.
- **Degenerate derivatives:** where the centre line's speed |C′| has a positive lower bound on the interval, the curvature and its derivative are bounded as usual. **Failing to find such a bound is not proof of a real zero** (dot 1791789047): first split to separate a loose interval bound from a true zero of the speed. **Locating zeros:** the speed's square |C′|² is a polynomial of degree 4 on a cubic; its roots on the interval are isolated by subdivision with a sign / Bernstein-coefficient test (an interval whose control coefficients are all positive has no root) down to a parameter width τ, so each true zero is located to within τ; τ is stated with the floor. **A true zero is not yet a corner (dot 1791789132):** the parameterization may only pause there — e.g. a handle collapsed onto its endpoint while the curve keeps a clear tangent. At each zero the one-sided limit directions are taken (the first non-vanishing derivative on each side); if they agree, the curve is smooth there and the offset passes through with no added shape; only if they differ (a real cusp in the line) is the offset closed with a round join of the local width, and there the original ε is **no longer claimed**. Every interval's diagnostic is one of: **verified** (the bound ≤ ε holds), or **not verified — fallback used** (the floor reached, or a round join at a true zero), with the bound reached where there is one. Ends with no usable tangent are §6's degenerate input.
- **The budget:** ε = ε_flat + ε_round with ε_round ≤ ε/4; integer coordinates at scale s round each vertex by at most √2 / (2s) drawing units, so s ≥ 2√2 / ε. **One grid per connected set (dot 1791789086):** all pieces connected through shared cuts — a line's middle piece, both of its ends' join groups, and every line those groups reach — form one set and use **one s**, chosen from the smallest ε in the set; never an s per join. Separate sets may differ.
- **Not yet budgeted — verification items for P0 / P1:** s ≥ 2√2 / ε covers only the rounding of input vertices. The rounding of new intersection points made by the boolean operation, and the collapse of tiny regions, need their own bound or a measured limit on the chosen library: P0 measures both on our fixtures (worst displacement of output vertices against the exact intersection, regions below a size that vanish), and P1 fixes the budget split from those numbers.

**10.2 Inputs and the division of ink.**
- **No internal field:** the public `Geometry.lines` carries `{ id, key, curve }` only (src/derived/index.ts:17–22); there is no trim range. A line's end is **eligible** for a cusp at point p iff the snapshot shows the line ends at p (its `a` or `b` is p) and **no `arc` row at p includes that line** (an arc trims both its lines at p, src/derived/index.ts:60–93). This uses only the snapshot's join rows and line ends, no geometry comparison.
- **Each line's own ink** is its stroke **between its zone cuts**: a joined end has no cap — the line's piece stops at the cut, the join group's piece starts there, and both use the same cut vertices; a free end has its round cap. Never the whole line under a join on top.
- **Both ends of one line** are allocated together before any piece is built: each end's zone length is the §6 cap applied to the pair, the two zones kept apart by the margin, so the line's middle piece is defined once.
- **Drawing without seams or double colour:** pieces that are painted the same are unioned into **one path per paint** before drawing (no anti-aliasing seam along shared cuts, no double alpha where pieces overlap); the source of every part is kept beside it for the diagnostics (Clipper's Z values on vertices, or our own map).
- **Paint follows the line, as today** (bench/src/app.tsx:1100–1102): normal `#111`, selected `#06f`, picked `#f80`, mirror source `#a3c`, cut `#bbb`, locked `#933`; while posing only locked / normal. When a join group's two lines have different paints, the group's piece must be shared between the two paints. **This is an open design for P2, not a rule yet** (dot 1791789047): a single polyline (inner meeting point → p → apex) does not exist in every construction — I2 and 0° have no Q, 0° and the 180° easing have no apex (O3-w away from 180° does keep a corner tip — dot 1791789250) — and need not stay inside the ink. P2 defines the division per construction (which constructions it covers, where the seam runs, that it stays in the ink), for dot's review before code; the interim is part of that design too, because each option has a visible cost: drawing a mixed-paint group as the plain fallback of §4 would make the join come apart whenever one of its lines is selected (an edit-state change altering the shape); drawing the group in the base paint and showing the state only by the line's halo would change today's look (a selected line is blue, app.tsx:1100). Selection must not make a join come apart (dot 1791789132), so the first option is excluded; P2 states its choice for dot's review.

**10.3 Display that stays.**
- **Hidden lines** (`visible: false`) are drawn today as a dashed centre line at opacity 0.35 (bench/src/app.tsx:1102). They take no part in ink or joins (their partner keeps its plain end, §2), and **that editing decoration stays exactly as today** — drawn from the centre line, not from ink.
- Arcs keep their own path, colour and width (bench/src/app.tsx:1104); halos and ghosts as in §2.

## 11. Status and implementation notes

- **Passed by dot 1791789250 at f7676ca** for the scope **P0 preparation + P1's single-line design**. Next: bowen's permission for the scratch-folder measurement (asked in Slack 1791788998); P1 starts only with P0's results and the error budget fixed from them; P2 is reviewed on its own.
- **Implementation notes (dot 1791789250), not a new plan round:**
  - all-positive Bernstein coefficients exclude a zero on an interval, but an interval that is left small after subdivision does **not** prove a true zero there — the true-zero decision needs its own test (e.g. a sign change of a coordinate of C′ or an exact root of a factor), else the interval stays "not verified";
  - the one-sided limit directions carry the sign of their parameter side (the direction approached from below vs left from above), so "agree" is decided with that sign;
  - O3-w away from 180° still has a corner tip — only the 180° easing has none.
- **Arc joins, equal widths (principle: Slack 1791802402; passed by dot 1791802438).** An arc is part of the line (v103, appearance.ts:83): derived already trims both lines and inserts the arc's centre line; the arc is swept like a line, at its lines' width, and the lines and arcs an arc joins form a group whose union is one outline (`merge`). Inked when either of its lines is visible. **Recorded limits:**
  - **paint:** a group whose lines share a paint is drawn as its one outline (no hairline seam); when they differ (e.g. one line selected) each line keeps its paint, the arc is drawn in the base colour under them and the state shows in the halo — the selected line's round end shows as a half-disc over the arc. The shape is the same either way: selection never changes a join's shape. To be settled with the cusp's mixed-colour question.
- **Arc joins, unequal widths (principle: Slack 1791803733; passed by dot 1791803768).** The half-width eases along the arc from lines[0]'s to lines[1]'s, h(u) = h0 + (h1 − h0)·smoothstep(u), u = the arc length accumulated along the flattened arc; the ink is a piecewise approximation of that variable-disc sweep — the union of the convex hulls of consecutive discs (`taperedSweep`), status 'unproven'. Checked by the output checks and the band against a finer tapered reference (`band`, exact uneven-capsule distance; the constant-width band is its special case). Not claimed: that no step shows for every input — a larger disc nearby can still cover the joint.
- **Smooth joins (principle: Slack 1791804157; passed by dot 1791804198).** Read from `snapshot.joins` (mode 'smooth'); derived does not change their geometry. The two lines' ink joins the same groups as arcs (one outline per group; a misaligned tangent under the core's spring gives a round join). Unequal widths ease at the joint to the average: h(s) = h_p + (h_i − h_p)·σ(s/λ), s from the joint's end of each line, λ = min(3 × the wider full width, each line's length / 3) — O3-w at 180° (sharp-join-F.md), the line split exactly at λ; a line eases at both ends independently. The easing rule is in the line's cache key (a neighbour's width or visibility rebuilds it); a hidden neighbour lends no width. **Recorded:** k = 3 is a default — the joint-zone length is bowen's to choose (sharp-join-summary.md); several smooth joins at one end: the first rules the easing (all join the group); cusp joins unchanged until the sharp step.

## 9. Changes from the first version (dot 1791788545, 1791788609)

1. Joins sit behind an experimental switch until every reachable boundary, including the fallback (B9), passes (§4).
2. Degenerate and short inputs, both-ends zones are in P1 / P2 as safety prerequisites (§6).
3. Error controlled on the final ink boundary, local per line, with a floor and a ceiling (§5).
4. No home-made extractor claimed as a ready fallback; the library check done before asking bowen anything (§5, P0).
5. Ink pieces keep their source; display rules per line; ghosts do not show the join (§2).
6. Arc-trimmed ends, several lines at one point and two joins on one line: source mapping and whole-group fallback (§6).
7. Ledger row 9 left as a stated limit with a follow-up, no question to bowen (§2).
