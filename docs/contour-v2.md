# Contour V2 — visible geometric contours

## Pipeline

Final Patch (including continuity/fullness), Helmet, Region, Cap
→ worker-resident mesh and derived candidate topology
→ orthographic XY + camera-space depth
→ unchanged union coverage / exterior trace
→ shared frontmost surface depth
→ two-face front/back transition candidates + exposed boundary candidates
→ shared half-pixel visibility sampling / open subpaths
→ SVG closed exterior paths and open visible paths.

Files:
- domain/contour/source.ts: final geometry, semantic boundary ownership, local auxiliary mesh adjacency.
- domain/contour/visible.ts: adjacency, depth projection/raster, tangent candidates, shared visibility clipping.
- domain/contour/silhouette.ts: old coverage/trace, optional extra-vertex projection with identical framing.
- ui/windows/contour.worker.ts: cancellable passes and resident mesh.
- ui/windows/ContourPanel.tsx: open SVG paths, auxiliary source subscriptions.

Ordinary Patch boundaries and Cap closed boundaries use BoundaryUse identities, including spans. Shared keys are suppressed; exposed boundaries sample their actual curve provider. Auxiliary Helmet/Region perimeters use local mesh adjacency; duplicated chart vertices are identified locally without modifying source topology or globally welding surfaces. Local closed parameter seams are not exposed boundaries.

Depth uses camera-local +Z toward the observer; the closest sample wins. Triangle depth slopes reconstruct depth at the actual candidate XY instead of applying a permissive slope-dependent bias. Remaining epsilon is 1e-5 times scene scale. Both tangent and boundary candidates use this same comparison. Hidden pieces split paths; no SVG Z is added.

## Validation (2026-09-16)

48 tests passed across contour-v2, contour-camera, caps, loomis-regions, boundary-use, loop-patch, lens-patch. V2 includes:
- exposed/buried/rear auxiliary ordinary Quad against a closed head mesh;
- tilted surface depth, internal tangent contour on a closed concave shell;
- shared whole boundaries and ON_CURVE spans;
- Cap spokes/closed seam exclusion and Region triangle-soup seam exclusion;
- scale-relative tolerance and unchanged exterior pass.

Three Playwright tests passed, including open-path rendering and persistent-worker cancellation/camera regression. 3-second orbit: 266 camera events, 60 requests/installed results; zero surface uploads or geometry rebuilds. Mean worker stages: projection 1.93ms, raster 18.05ms, trace 6.55ms, total 30.94ms. Snapshot: artifacts/contour-v2/preview.png. Build passed.

## Limits

Mesh transition approximation at fixed subdivision 24 and raster 768² remains approximate. Grazing boundaries can exhibit pixel-scale fragments; no analytic visibility or line fitting is claimed. Exterior and tangent lines may overlap. Separate auxiliary surfaces without a shared BoundaryUse do not gain inferred semantic adjacency; spatial coincidence is not treated as proof of topology. Host-curve intervals are now split at all use endpoints; only intervals with one incident surface remain exposed. Helmet equatorial arcs and side rims use the same host domains as ordinary Patch boundaries. Unrelated Region topology is still not inferred from spatial coincidence.

No source/document schema, geometry solver, main GPU renderer, undo semantics, feature-line role or special Gill type was added.


## Shared interval correction

The supplied head fixture (tests/fixtures/contour-span-head.json, reference images removed) reproduced two errors:
- Curve 26: a lens uses the whole curve, while a triangle uses its initial subspan.
- Quad 2: its MAIN_Y arc joins Helmet, whose perimeter previously had no semantic ownership.

contour/boundaries.ts now resolves native host parameter intervals, including wrapped closed spans, and splits coverage at all endpoints. Multiple distinct surface owners suppress only their overlapping interval. Helmet contributes its exact MAIN_Y front/back intervals plus RIM_R/RIM_L; its numerical perimeter is no longer separately emitted. This changes only derived Contour candidates.

Regression: 50 related unit tests, 4 browser tests, build passed. Actual saved-head front/oblique snapshots are artifacts/contour-v2/repaired-front.png and repaired-oblique.png. Geometry and stored project unchanged.
