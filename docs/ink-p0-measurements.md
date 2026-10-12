# Ink P0 — measurements of the candidate libraries (docs/ink-joins-plan.md §5, §7 P0, §10.1)

bowen 1791790281 allowed downloading the candidates into a scratch folder outside the project to measure them. Downloaded 2026-10-12 into the session's scratch folder with `npm install clipper2-ts clipper2-wasm`: **clipper2-ts 2.0.1-18** (BSL-1.0, 2.1 MB installed, one 125 KB minified module) and **clipper2-wasm 0.4.0** (BSL-1.0, 1.2 MB installed, two .wasm files of 214 KB and 237 KB). Nothing was installed in the project. The scripts are kept in `bench/experiments/ink-p0/` (`p0.mjs`, `p0b.mjs`, `p0speed.mjs`); they run only beside that scratch install, not in the project. Machine: this Mac, Node, numbers below are single runs after warm-up — indicative, not a benchmark suite.

## 1. Correctness on our fixtures (scale s = 10⁴)

| Fixture | What it reproduces | clipper2-ts | clipper2-wasm |
|---|---|---|---|
| F1 cap sliver | a 32-gon cap centred on a body's end edge — the 5e-6 sliver that gave our extractor open chains | **with consistently oriented inputs:** 1 path, area 1496.185802 vs 1496.186013 — the expectation is exact (a centred 32-gon is halved by a line through its centre, dot 1791790632); the gap is **quantization**, see the scale study below | same |
| F1, inputs oriented oppositely | — | 2 paths, area short by half the disc: **NonZero cancels a clockwise piece against a counter-clockwise one** — not a library fault | same |
| F2 narrowing strip at the cut | Wo − Wn, the strip thinning to nothing at the cut (tangent) — our extractor's second failure | 1 path, area 68.209218 vs 68.209224 (trapezoid sum), diff −5.6e-6 | (difference not run on wasm) |
| F3 touch at a point | two arms meeting only at p (0°) | 2 paths, area 30 exactly | same |
| F4 collinear overlap | two bands on one line, widths 4 / 12 (0°, straight) | 1 path, area 1200 exactly | same |

**Scope (dot 1791790569):** these fixtures passing supports the comparison of the candidates; it is not a general guarantee of correctness on every input.

**F1 scale study (`p0c.mjs`):** the union's area against the true one: 6.4e-2 / −8.7e-4 / −2.1e-4 / 2.4e-5 / 5.1e-6 / 7.5e-6 / 2.6e-9 at s = 10² … 10⁸; against A0′ + A1′ − A∩′ (the areas of the rounded inputs and of their intersection): 0 / −6.0e-3 / −6.0e-4 / −5.6e-5 / −6.5e-6 / −5.5e-7 / −6.1e-8 — about 6 / s. **What is and is not exact (dot 1791790774):** BigInt makes the area of each *integer* polygon exact; but A∩′ is itself the library's output, whose crossing vertices are rounded, so this is **not** a comparison with the exact (rational) union of the rounded inputs — it compares two rounded results. So the ~6 / s column is only the **inclusion–exclusion residual of two library outputs** (dot 1791790804), not the union's own error.

**F1 with an exact rational reference (`p0d.mjs`, dot 1791790804):** both F1 pieces are convex, so the exact intersection of the rounded inputs is clipped in rationals (BigInt fractions, Sutherland–Hodgman), and the exact union area of the rounded inputs is A0′ + A1′ − A∩(exact). Separately:

| s | input rounding: exact union of rounded inputs − true | operation: library union − exact union of rounded inputs |
|---|---|---|
| 10² | 6.44e-2 | 0 |
| 10³ | −8.68e-4 | −4.91e-8 |
| 10⁴ | −2.39e-4 | 2.88e-5 |
| 10⁵ | 1.91e-5 | 4.74e-6 |
| 10⁶ | 5.07e-6 | −2.53e-9 |

On this one fixture the input rounding dominates and the operation's own area error is smaller and not monotone in s; one convex fixture, not a general bound.

**Contract found (refined, dot 1791790632):** independent solid pieces passed to a union are oriented the same way; a result with holes that goes into another operation keeps its outer loops and its holes in **opposite** orientations — holes are never turned into solids by normalising. The adapter normalises solids only and passes structured results (outer + holes) through as they are.

## 2. Rounding of new intersection points

Two bands crossing at 200 angles (crossing sine from 0.100 up).

- **The library's own rounding** — output vertices against the exact crossings of the *rounded* input edges: worst **0.496 grid units** (≤ √2/2 as expected).
- **Against the true crossing** (unrounded inputs): worst 2.6 / 5.6 / 4.1 / 3.6 / 3.4 grid units at s = 10² … 10⁶. This is the **input rounding** (≤ 0.5 unit per vertex) moved along a shallow crossing: about 0.5 / sin φ grid units, 5.0 at sin φ = 0.1 — and sharp joins at small angles cross at exactly such shallow angles.
- **Status:** the 0.5 / sin φ term is an explanation that fits this measurement (one family of crossings, 200 angles), not a proven bound; the budget below is a working estimate for P1 to test, not a guarantee (dot 1791790569).
- **Not a budget guarantee — an item to verify (dot 1791790593):** (0.5 / sin φ + 0.5) / s is an empirical order of magnitude from this one family of crossings. It does not account for the perturbation of several endpoints of both edges, nor for their change of direction, so it **cannot certify** any choice of s for any range of φ (the earlier sentence "s = 10⁸ covers crossings down to sin φ ≈ 2·10⁻⁶" is withdrawn). What it does tell P1: shallow crossings magnify input rounding, so s should be large (coordinates × s below 2⁵³).
- **A counterexample to that term (dot 1791790659):** at s = 1, the edges (−1000, 0.49) → (1000, 0.49) and (−1000, −100.49) → (1000, 99.51) cross at (9.8, 0.49); with rounded endpoints they cross at (0, 0) — 9.812 grid units away, where the term gives about 5.525. It is kept as a fixture for P1.
- **For P1 (not settled here):** an error may be called verified only with a checkable conservative bound, or with an a-posteriori check of the **complete** boolean result — not only of the output vertices, since a vanished sliver or hole leaves no vertex to check (dot 1791790659); and equal area and topology do **not** replace a check of the outline's distance (dot 1791790774). Without either, the plan's **not verified** status. P0 does not promise how such a checker is built — that is P1's design, for dot's review.

## 3. Region collapse (grid units)

- A lone thin triangle of height t beside a square: **vanishes at t = 0.2, survives from t = 0.5** (both libraries).
- A gap of width g between two squares: **closes at g = 0.2, stays from g = 0.5** (clipper2-ts).
- **Observed in these cases, not a guarantee** (dot 1791790569, 1791790593): with these positions and directions, features under about half a grid unit collapsed here; that does not mean every feature above half a unit keeps its topology; at s = 10⁸ that is 5·10⁻⁹ drawing units — far below any ε, provided s is chosen as in §2.

## 4. Speed

A drawing of 300 lines, each outline 2 × 120 vertices plus two 17-vertex caps (~275 vertices), consistently oriented; "per-line" = one union per line (all 300 per frame), "2-line groups" = 150 unions of two lines' pieces.

Re-run after freeing the WebAssembly clip list (the first run leaked an empty `Paths64` per call, dot 1791790632):

| s | clipper2-ts per-line / groups (ms per frame) | clipper2-wasm per-line / groups |
|---|---|---|
| 10⁴ | 19.0 / 22.0 | 13.8 / 16.1 |
| 10⁶ | 18.5 / 21.7 | 13.2 / 15.4 |
| 10⁸ | 26.3 / 28.4 (BigInt intermediates) | 14.4 / 16.3 |

- **clipper2-wasm loading, named by what was measured (dot 1791790632):** in a fresh Node process with the files in the OS cache, the dynamic `import()` took 2.3–2.4 ms and the **first** factory call (instantiating the module) 4.1–4.2 ms; a second factory call 1.4–1.5 ms. (The earlier "6.4–7.6 ms" was import + first factory call together, in the same setting.) A browser's cold start — fetching and compiling the .wasm — was **not** measured.
- At 60 frames per second (16.7 ms) a union of **every** line every frame does not fit with clipper2-ts and barely with clipper2-wasm. The plan's structure avoids that: a plain line with no join and no self-overlap needs no boolean operation (its outline is drawn as built); only join groups (and self-overlapping offsets) go through the library, and editing rebuilds only what changed. Playback rebuilds every frame, so P1 measures `ink.build` in the browser on a real drawing before the switch can come on.

## 5. Proposal for the dependency decision (bowen's, after dot's review)

- **clipper2-ts** for P1: synchronous, pure TypeScript, no loading step, correct on all our fixtures; slower, and slower again at large s.
- **clipper2-wasm** kept as the measured alternative if P1's in-browser numbers need it (≈ 30–45 % faster here, constant across s; asynchronous load of ~7 ms; BigInt coordinates at the boundary).
- Either way the module calls the library through one small adapter (orientation normalised, scale s per connected set, results mapped back with their sources), so the choice can be swapped without touching the constructions.
