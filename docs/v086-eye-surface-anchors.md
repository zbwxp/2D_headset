# V0.8.6 — Eye Surface Anchors

- Smart Modules heading toggles its content, freeing sidebar space.
- One ordinary Quad per eye spans the full +Z cylinder half. Each horizontal boundary is a composite of the two existing cubic quarter arcs, with shared source samples and derivatives. No internal semantic surface seam.
- Scaffold persists two extra front-arc IDs per eye. Original quarter guides and their source points retain identities. General Curve evaluation and the dependency graph resolve the composite arcs from their two quarters.
- The existing Add Missing Front Cylinder Patches command upgrades the previous four quarter patches to two front patches. It refuses to remove patches with attached curve/point dependencies. New scaffold creation uses the single-quad layout directly.
- Eyes Construction Surface Point clicks intersect only displayed Eyes quads, including the view-dependent eye perspective transform; they never fall back to the HeadSet ellipsoid. Current tool remains a 2D authoring tool.
- New SemanticLandmark placement `ON_PATCH { hostPatchId, u, v }` persists normalized surface coordinates. Evaluation uses the final Patch evaluator; point geometry follows host edits. Mirror points use mirrored host patches and their shared canonical chart. The point is editable by surface U/V controls or constrained 2D drag.
- Dependency graph includes Patch → Point, including final-continuity dependencies. Deleting a host follows dependency deletion. Creation/edit transactions preserve Undo/Redo and module ownership.
- The change does not reintroduce default scaffold point markers.

Validation: focused geometry tests, browser creation/picking/Undo tests, and build. Full unit suite additionally exposes older assertions involving default views, migration field additions, and contour-source metadata; see `/tmp/eye-all-unit.txt` for the run.

## On Surface Curve integration fix

The original ON_PATCH Curve authoring accepted boundary anchors only. It now also accepts a SemanticLandmark explicitly hosted on the selected Patch. `SurfacePath` boundary occurrence `-1` denotes that source; nonnegative occurrences preserve existing boundary semantics. Endpoint UV is read afresh on evaluation rather than copied into the curve. Wrong-host points are rejected. This applies to ordinary Patch geometry, not just Eye Scaffold.

Selecting a Patch via the common selection command advances a waiting On Surface tool. Existing-point proximity picking and draft previews use the Eyes display transform, consistent with final display. Unit checks cover UV evaluation, mirrors, host changes, save/load, and wrong-host rejection; browser checks create a curve between two cylinder interior points and exercise Undo/Redo.
