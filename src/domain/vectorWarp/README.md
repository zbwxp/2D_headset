# Vector Warp field and one-cubic approximation

This module is isolated from the Drawing authoring store. It evaluates a transient
copy of a DrawingDocument; it never splits, renames, or modifies canonical curves.
It is an explicit new math model, not a reconstruction of the proprietary Cubism kernel.

## Domain and control representation

- `rows` and `columns` count rectangular rest-domain **cells**. There are
  `(rows + 1) * (columns + 1)` row-major shared nodes.
- `bounds.min/max` are the source-domain rectangle. A node's `position` and absolute
  outgoing `handleU/handleV` are in output drawing coordinates. Opposite handles
  are mirrored about `position`, so each shared node supplies one derivative per axis.
- `3 * (handleU-position)` is dP/du and `3 * (handleV-position)` is dP/dv;
  u/v count cells. `twist` is d²P/du dv in these same units.
- Each cell is a tensor-product cubic Hermite patch. Shared boundary node jets give
  common boundary curves and common first derivatives: C1 across cell seams.
  Second derivatives need not be continuous. Interior nodes give actual local control.
- `moveWarpNode` translates its handles with it by default, retaining tangent vectors.
  Direct handle edits change the corresponding derivative. The user may create folds,
  singular Jacobians, and self-overlap; evaluation is forward-only and needs no inverse.
- A chain is ordered **child, parent, grandparent**. The parent's input/rest coordinates
  are the child's output coordinates. `createWarpMapper` compiles a snapshot of its grids.
- Outside the rectangle we polynomially continue the closest boundary cell. This is
  C1 at the border and preserves identity/affine maps, but far extrapolation may grow
  rapidly. Non-finite numerical results are flagged, not claimed to be usable geometry.

## Fitting and error semantics

`fitWarpedCubic` returns exactly one cubic for one source cubic, even on failure.
It fits F(B(t)), rather than merely warping the four Bezier control points.
Endpoints are exactly mapped. Endpoint tangent directions use the field Jacobian;
nonnegative least squares chooses two handle lengths without reversing them.
This preserves existing regular tangent alignment under a common field. At a singular
Jacobian or with a zero fitted length the tangent is reported as degenerate, rather
than inventing a direction. It does not guarantee source arc length or stroke-width
scaling, curvature continuity, or identical parameter speed.

Default tolerance is `1/250` logical Drawing units (one nominal canvas pixel), independent
of zoom. `maxError` is maximum **observed same-parameter positional distance**, not
Hausdorff distance and not a mathematically certified supremum. It is checked with
1024 independent half-offset observations plus endpoints and local-peak refinement;
fit observations use a separate 64-point set. This catches S-shaped errors that a
single midpoint misses, but no finite sampling proves an arbitrary field's exactness.
`peakT`, `peakExpected`, and `peakActual` locate the largest measured mismatch.
`validationKind` is `sampled` for warped fits. Unedited identity grids/empty chains
are recognized with exact authoring-state equality (no epsilon), return the unchanged
cubic immediately, and are honestly labeled `identity-exact` with zero samples. Over-tolerance results are returned with
warnings, never with automatic source subdivision or a hidden multi-cubic fallback.

`deformDrawing` shares evaluated endpoints by source node ID and also keeps explicit
endpoint links coupled across separate IDs. If incident curves request incompatible
mappings, their endpoint mean is retained once and all affected curves report endpoint
conflict; it is impossible to obey divergent maps and positional coupling simultaneously.
All curve, node, join, fill boundary, layer, style, and display-range identities are retained.
Display-range endpoints are transported by source cubic parameter to the fitted curve's new
arc-length coordinates, in both preview and full stages. A folded/collapsed path can make
this undefined; `intervalTransportErrors` and per-curve `appearanceWarning` flag the
fallback rather than silently treating stale percentages as valid material positions.
The result is transient rendering data, not new canonical artwork. Offsets and ink styles
remain semantic appearance relations; this module does not separately deform their
rendered stroke boundaries. The caller owns visibility parameter application.

## Interaction preview and settled validation

Use `{diagnostics:'preview'}` during handle or parameter scrubbing. It uses the
same 64-point least-squares fit and endpoint policy as full evaluation, so the
output geometry is bit-identical on release for the same inputs. Only diagnostics
are cheaper: 32 half-offset samples plus endpoints, with no peak refinement.
The result and each curve explicitly carry `diagnosticStage:'preview'`, and numeric
checks carry `validationKind:'sampled-preview'`. A preview pass can expose an error
but cannot establish a clean final check. Display it as provisional.

Use `{diagnostics:'full'}` (the default) after input settles. Full checks use at
least 1024 observations, include all preview observations, and refine local peaks.
Do not change `fitSamples` on release; doing so would change the fit. UI scheduling
should defer the full pass until the interaction stops and discard results for
superseded poses. The synchronous pure API does not itself schedule a worker.

For grid overlays compile `createWarpMapper(chain)` once per grid/pose and reuse
its `.mapPoint()`. Public `mapPoint(grid,p)` is a convenience one-shot compiler,
not the appropriate inner-loop call.

## Integration entry points

- `model.ts`: WarpGrid/WarpNode, createWarpGrid, moveWarpNode, cloneWarpGrid,
  validateWarpGrid, blendWarpGrids
- `evaluation.ts`: mapPoint, evaluateWarp (with Jacobian), mapPointThroughGrids,
  createWarpMapper, fitWarpedCubic, deformDrawing
- `blendWarpGrids` accepts signed weights (e.g. X+Y-neutral), normalizes by nonzero
  total weight, and requires the same rest domain and cell topology.
- `deformDrawing` accepts one grid, a child-first chain, or a curve-ID-to-chain resolver.

Run `npm test -- src/tests/vector-warp` for independent field/fit, seam, fold, topology,
non-mutation, source-artwork and diagnostic checks.
