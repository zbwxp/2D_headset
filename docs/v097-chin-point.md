# V0.9.7 — Chin Point Fairing

V0.9.6 was still a cap with a rim. This version replaces that topology with a
single semantic vertex. There is no independent chin mesh, material, surface
boundary, or hidden fourth edge. The Contour algorithm is unchanged.

## Authoring

- Connect ordinary Free Curves to the one chin point.
- Four ranges, in horizontal HeadFrame radius R: upper, lower, upper side pair,
  lower side pair. Limits 0.01R–0.1R, initially 0.08R. Side pairs remain mirrored.
- The inspector lists which curves occupy each group, including empty groups.
- Position Y/Z remains under a collapsed position panel. Shell width, depth,
  height, pitch, roundness, bulge and manual fitting controls are gone.
- New curves classify from their source direction; migrated curves retain the
  semantic group of their former attachment point. Names do not control groups.

## Geometry

`raw incident curves → shared local chart → derived incident curves → existing
Patch pipeline → local surface correction → locally refined display mesh`.

1. Sample incoming source curves at physical arc-length cuts. A source-only
   evaluation context avoids feedback from the final junction into its own fit.
2. Fit a symmetric tangent frame. Upper/lower samples orient the YZ axis; X is
   fixed by HeadFrame symmetry. The six rays form three opposing tangent axes,
   rather than allowing a projection to put upper and lower rays on the same side.
3. Fit a shared quadratic graph with regularized least squares (sample error +
   quadratic bending penalty). No independent radius or convexity is authored.
4. Inside each curve's range, construct a quintic with prescribed endpoint jets.
   This is the minimum integrated squared third derivative for those jets. At
   the outer cut its position, tangent and second derivative match the source.
   A compact C2 graph projection provides a common smooth core. Its envelope
   also vanishes at the *arc-length* cut, not just a world-distance sphere.
5. Existing Tri/Quad/Lens faces meeting the point share this local graph. Boundary
   compensation preserves their exact source curves; shared-edge corrections
   affect only the neighborhood. Ordinary continuity/fullness stays upstream.
6. Locally refine parameter triangles down to the range scale; a 0.01R feature
   must not vanish between the ordinary whole-face tessellation samples.

The central graph is smooth, the three opposing ray pairs are G1 at the vertex,
all tested neighboring fan sectors share normals in that core, and the modified
curve intervals return C2 to the raw source. The transition band blends back to
existing faces; this is not a proof that arbitrary distant boundaries, deliberate
creases, or preexisting folded patches become globally smooth. Missing faces
are not invented, and unrelated surface solvers/Contour passes are unchanged.

## Migration / persistence

- Chin scaffold source version 3; project `landmarks-0.9.7`.
- Loading V0.9.5/0.9.6 merges the old system attachments into CHIN_M at its
  evaluated position, removes generated cap seams, and remaps authored endpoints.
- Existing face UUIDs survive. A jaw quad using the obsolete rim becomes a tri;
  its three authored boundary sources survive. Hosted UV weights and path handles
  are transported when the corresponding quad domain collapses.
- Custom points hosted on retired cap/seam geometry become spatial points at
  their evaluated positions. External authored control curves remain independent.
- Old shell evaluation exists only to read/migrate these sources. No old file is
  overwritten by loading; subsequent Save writes the new representation.
- Ranges are one transaction per slider gesture; Undo/Redo and JSON reload use
  the ordinary source-history path. Fitted charts and meshes are runtime only.

## Validation

- Actual `语义点头部研究 (3).json`: five incoming user curves (upper midline is
  absent), one chin vertex, zero generated cap seams/surface, both existing jaw
  faces retained as triangles. Exact boundary positions, mirror, source outside
  each cut, endpoint plane, cut C2, persistence and dependency invalidation tested.
- Synthetic six-curve/six-face fan at 0.01R, 0.08R and 0.1R: shared core normals,
  opposing ray G1, finite refined meshes, no core parameter inversion.
- Regression: ordinary Patch, continuity, fullness, Free 3D, ON_PATCH,
  CurveSpan, point merge, module ownership and Contour tests.
- Isolated-browser creation, four range controls, three-edge Patch authoring,
  Undo/Redo, reload and actual-save 3D/Contour screenshots.
