# V0.9.6 — Chin Junction

The chin is a semantic junction with a finite transition region. Width, depth and
height remain 0.01–0.1 R; pitch rotates that region. The existing shell evaluator
supplies the local shape, attachment positions and differential frames. It is no
longer presented as an independently managed Surface asset in the sidebar.

## Attachment and evaluation

- An ordinary FREE curve ending at a chin rim anchor automatically receives a
  local derived endpoint correction. Front anchors continue the front transverse
  arc; rear anchors continue the rear arc; central rim anchors continue the
  center seam. Both START and END are supported.
- The raw cubic and its handles are unchanged. The curve identity and endpoints
  remain unchanged, and consumers use the final CurveProvider (including spans,
  ON_CURVE points, Patch, picking and Contour).
- A compact endpoint derivative correction makes the endpoint tangent align with
  the outward chin tangent. It vanishes, with first and second derivatives, at
  the end of the transition range. The physical range is the maximum local
  dimension in R, capped at 30% of curve length at each end to prevent overlap.
- Roundness controls the correction's taper as well as the shell belly profile.
  At zero it concentrates the turn near the anchor; at one it spreads the turn
  through more of the specified range. The outer source curve remains exact.
- Dependencies remain one way: chin kernel → attachment → raw curve → derived
  curve → Patch. Independent legacy shape-override bindings remain available
  under Advanced; a curve attached to the chin cannot feed back into its kernel.

## Adjacent surfaces

For a Patch using a chin rim boundary, a local first-derivative correction aligns
its inward transverse direction with the opposite of the chin's inward
transverse direction. Tangential shear is preserved. The correction has zero
boundary displacement and compact support measured against the chin range. It
runs after ordinary fairing and Fullness, so those stages cannot undo the local
attachment. Mirrored patches reflect the canonical final evaluator exactly.

This is an actual geometry correction, not shading-normal blending or suppressing
Contour edges. No stored mesh, new Patch solver or camera-dependent geometry is
introduced. Internal shared boundaries continue to be suppressed by the existing
Contour topology pass; genuinely open boundaries retain their normal behavior.

## Authoring / presentation

Selecting an open chain of two or three external Patch edges whose two loose
endpoints match one unique chin rim auto-completes that internal BoundaryUse.
The resulting ordinary Tri/Quad Patch retains normal identity, deletion and
save/load semantics. Existing jaw patches already referencing the rim use the
new transition automatically, without reconnecting or reauthoring.

The sidebar shows **Chin Junction**, its status, attached-curve count and blend
parameters. **Show attachment guides** reveals the helper points and curves.
By default, helper guides and rim curves are hidden and the central chin point
remains visible. User-created surface points remain ordinary visible points.
Closing the Chin Junction panel hides the guides. The derived transition surface
can still be picked; its visibility is independent of guide visibility.

## Validation

The supplied `语义点头部研究 (2).json` is represented by
`src/tests/fixtures/chin-junction-head.json` (reference images removed).

- Original jaw/profile endpoint tangent mismatch: approximately 54.56° / 64.54°;
  the derived endpoints are G1 aligned.
- Dense seam sampling before and after ordinary Smooth: finite-difference
  tangent-plane error below 0.1° (about 0.005° in this fixture).
- Exact boundary positions, mirror symmetry, unchanged outer curve, Fullness,
  no new reversed parameter cells in the sampled fixture, dependent updates,
  implicit boundary completion and save/load are covered by unit tests.
- Browser tests cover helper display in 2D/3D, width editing without modifying
  raw cubic source, Undo/Redo, three-edge authoring, reload and close inspection.

Saved source schema remains `landmarks-0.9.5`: all required source fields already
exist. App version is V0.9.6. Guide visibility is runtime UI state, not geometry.
