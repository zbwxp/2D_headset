# 四角 / 曲边 deform — package 1: the math (checklist before any code, for dot's review)

bowen 1791890087: four-corner perspective and Bézier-edge frame transform, as the earlier version has them; an edit. bowen 1791891109: curves come back as curves the v103 way ("A": one cubic per line, exact end points, tangent directions from the field, handle lengths by a least-squares fit).

Source: v103 = 7205381, `src/domain/deformation/{homography,cageField,coons,cubicDeformation}.ts` — one feature: a Coons bend of the four edges first, then the homography of the four corners (`drawingDeformProjection`: map = H(Coons(p))). Ported as it is (memory: port the reviewed construction; no silent change of the maths).

## 1. Where
- A new top-level package **`deform/`** (`deform/index.ts`, `deform/test/`), like `move/`: plain maths on plain data, **no imports** (its own `Vec`, `Cubic` as `{x, y}` objects; v103 uses `[x, y]` tuples — converted at the boundary of each function, nothing else changed). Added to `vitest.config.ts` and to the bench's type check like the other packages.
- Not in `src/`: core stays as it is. Package 2 (the edit) is planned to apply the result through the existing core operations (`move`, `moveHandle`) in one edit — its own checklist; if dot prefers a core operation there, the package moves under `src/` unchanged.

## 2. What it exports (each a port of the v103 function named)
- `quadProjection(rect, quad)` → `{ map, vector, denominator, matrix, affine }` (cageField.ts `quadProjection`): normalized 8×8 DLT by Gauss–Jordan with pivoting; `vector` the analytic Jacobian; refuses a crossed or flattened quad and points past the projective horizon (den < 1e-4), with v103's messages.
- `bendPoint`, `bendVector`, `assertBend`, `inverseBend`, `neutralBend`, `isNeutralBend`, `bendEdges` (coons.ts): the displacement form of the bilinearly blended Coons patch on the unit square; edges bottom, right, top, left, two handles each; the fold guard (17×17 Jacobian samples, det ≥ 0.015) and the |n| ≤ 8 bound.
- `deformField(rect, quad, bend?)` (cageField.ts `drawingDeformProjection`): the composed field; a neutral or disabled bend returns the exact homography; the 17×17 interior horizon check.
- `fitDeformedCubic(cubic, field)` → `{ shape, parameters, maxError }` and `fitCubicTarget` (cubicDeformation.ts): affine field → the control points mapped exactly; otherwise the v103 fit — end points exact, tangent rays from `field.vector`, handle lengths bounded to [1 %, 800 %] of the mapped ones, 128-sample least squares alternating with closest-point Newton steps (projective initial parameters `deformParameter`), at most 10 rounds; `maxError` from 257 samples (a diagnostic, not a bound).
- `sourceParameter` / `mappedParameter` (the t-maps), kept for later (display intervals ride on t); not used by package 2.

## 3. Evidence (tests)
- **Same numbers as v103:** a test runs the v103 functions themselves (read with `git show 7205381:…` into a fixture at test-writing time, committed as a frozen copy under `deform/test/v103/` with its source SHA in a header) and this port on the same inputs — random quads, bends and cubics — and requires equal outputs (map, vector, fitted shape, maxError) to 1e-9.
- Ported v103 cases (`drawing-deform`, `drawing-curved-deform`, `drawing-deform-kernel`, `drawing-curved-cage` — the maths parts only): the four corners hit exactly; an affine quad is exact; crossing and horizon refused; neutral bend = the homography; Coons ∘ H with analytic derivatives (checked against finite differences); one cubic per source with exact end points and tangent rays, handles not point-mapped; folded bends refused; the edge midpoint factor 4/3.
- Corner cases: a degenerate rect (zero width / height) refused; a cubic with a zero-length handle (v103's stationary end handles); a reversed cubic.

## 4. Not in package 1
The edit itself (which lines, locks, mirror, links, undo) — package 2. The tool, the frame, live preview, reset — package 3.
