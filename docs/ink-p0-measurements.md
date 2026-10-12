# Ink P0 — measurements of the candidate libraries (docs/ink-joins-plan.md §5, §7 P0, §10.1)

bowen 1791790281 allowed downloading the candidates into a scratch folder outside the project to measure them. Downloaded 2026-10-12 into the session's scratch folder with `npm install clipper2-ts clipper2-wasm`: **clipper2-ts 2.0.1-18** (BSL-1.0, 2.1 MB installed, one 125 KB minified module) and **clipper2-wasm 0.4.0** (BSL-1.0, 1.2 MB installed, two .wasm files of 214 KB and 237 KB). Nothing was installed in the project. The scripts are kept in `bench/experiments/ink-p0/` (`p0.mjs`, `p0b.mjs`, `p0speed.mjs`); they run only beside that scratch install, not in the project. Machine: this Mac, Node, numbers below are single runs after warm-up — indicative, not a benchmark suite.

## 1. Correctness on our fixtures (scale s = 10⁴)

| Fixture | What it reproduces | clipper2-ts | clipper2-wasm |
|---|---|---|---|
| F1 cap sliver | a 32-gon cap centred on a body's end edge — the 5e-6 sliver that gave our extractor open chains | **with consistently oriented inputs:** 1 path, area 1496.185802 vs 1496.186013 expected (the difference is my approximate expectation, half the 32-gon) | same |
| F1, inputs oriented oppositely | — | 2 paths, area short by half the disc: **NonZero cancels a clockwise piece against a counter-clockwise one** — not a library fault | same |
| F2 narrowing strip at the cut | Wo − Wn, the strip thinning to nothing at the cut (tangent) — our extractor's second failure | 1 path, area 68.209218 vs 68.209224 (trapezoid sum), diff −5.6e-6 | (difference not run on wasm) |
| F3 touch at a point | two arms meeting only at p (0°) | 2 paths, area 30 exactly | same |
| F4 collinear overlap | two bands on one line, widths 4 / 12 (0°, straight) | 1 path, area 1200 exactly | same |

**Scope (dot 1791790569):** these fixtures passing supports the comparison of the candidates; it is not a general guarantee of correctness on every input.

**Contract found:** every piece passed to a union must be oriented the same way (or the fill rule chosen to match); the module normalises orientation before each call.

## 2. Rounding of new intersection points

Two bands crossing at 200 angles (crossing sine from 0.100 up).

- **The library's own rounding** — output vertices against the exact crossings of the *rounded* input edges: worst **0.496 grid units** (≤ √2/2 as expected).
- **Against the true crossing** (unrounded inputs): worst 2.6 / 5.6 / 4.1 / 3.6 / 3.4 grid units at s = 10² … 10⁶. This is the **input rounding** (≤ 0.5 unit per vertex) moved along a shallow crossing: about 0.5 / sin φ grid units, 5.0 at sin φ = 0.1 — and sharp joins at small angles cross at exactly such shallow angles.
- **Status:** the 0.5 / sin φ term is an explanation that fits this measurement (one family of crossings, 200 angles), not a proven bound; the budget below is a working estimate for P1 to test, not a guarantee (dot 1791790569).
- **Not a budget guarantee — an item to verify (dot 1791790593):** (0.5 / sin φ + 0.5) / s is an empirical order of magnitude from this one family of crossings. It does not account for the perturbation of several endpoints of both edges, nor for their change of direction, so it **cannot certify** any choice of s for any range of φ (the earlier sentence "s = 10⁸ covers crossings down to sin φ ≈ 2·10⁻⁶" is withdrawn). What it does tell P1: shallow crossings magnify input rounding, so s should be large (coordinates × s below 2⁵³).
- **What P1 must do instead:** claim an error as verified only with a checkable conservative bound, or with an **a-posteriori check per case** (e.g. each output vertex compared against the exact crossing of the unrounded edges it came from, and each piece's area / topology against the unclipped input); where neither holds, the result carries the plan's **not verified** status.

## 3. Region collapse (grid units)

- A lone thin triangle of height t beside a square: **vanishes at t = 0.2, survives from t = 0.5** (both libraries).
- A gap of width g between two squares: **closes at g = 0.2, stays from g = 0.5** (clipper2-ts).
- **Observed in these cases, not a guarantee** (dot 1791790569, 1791790593): with these positions and directions, features under about half a grid unit collapsed here; that does not mean every feature above half a unit keeps its topology; at s = 10⁸ that is 5·10⁻⁹ drawing units — far below any ε, provided s is chosen as in §2.

## 4. Speed

A drawing of 300 lines, each outline 2 × 120 vertices plus two 17-vertex caps (~275 vertices), consistently oriented; "per-line" = one union per line (all 300 per frame), "2-line groups" = 150 unions of two lines' pieces.

| s | clipper2-ts per-line / groups (ms per frame) | clipper2-wasm per-line / groups |
|---|---|---|
| 10⁴ | 17.9 / 21.6 | 13.8 / 16.3 |
| 10⁶ | 18.7 / 21.7 | 13.0 / 15.8 |
| 10⁸ | 25.7 / 28.2 (BigInt intermediates) | 13.9 / 16.2 |

- clipper2-wasm loads asynchronously: import + instantiate **6.4–7.6 ms** once.
- At 60 frames per second (16.7 ms) a union of **every** line every frame does not fit with clipper2-ts and barely with clipper2-wasm. The plan's structure avoids that: a plain line with no join and no self-overlap needs no boolean operation (its outline is drawn as built); only join groups (and self-overlapping offsets) go through the library, and editing rebuilds only what changed. Playback rebuilds every frame, so P1 measures `ink.build` in the browser on a real drawing before the switch can come on.

## 5. Proposal for the dependency decision (bowen's, after dot's review)

- **clipper2-ts** for P1: synchronous, pure TypeScript, no loading step, correct on all our fixtures; slower, and slower again at large s.
- **clipper2-wasm** kept as the measured alternative if P1's in-browser numbers need it (≈ 30–45 % faster here, constant across s; asynchronous load of ~7 ms; BigInt coordinates at the boundary).
- Either way the module calls the library through one small adapter (orientation normalised, scale s per connected set, results mapped back with their sources), so the choice can be swapped without touching the constructions.
