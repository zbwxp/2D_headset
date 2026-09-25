# V0.7.6 — Smooth Junction Field

Select a Junction row (or a rendered transition), then Enable Smooth Junction. It creates one default Smooth Key at the canonical current view, without changing source Curve Keys. Edit radius scale or tension in the Inspector, or drag transition handles along their tangent constraints. The Junction ViewMap shows Smooth Keys only. Switching back to POSITION removes Smooth data in one undoable operation.

## Source and style separation

`RecordingJunction` is a discriminated union: POSITION, or SMOOTH with `baseRadius` and `smoothKeys`. SmoothKey stores yaw/pitch plus positive `radiusScale`, `tensionA`, `tensionB`. No absolute handles are persisted. Old POSITION assets are unchanged. Validation rejects invalid keys and duplicate Smooth use of an endpoint.

The style evaluator uses a cached runtime adapter to the existing deterministic Delaunay/barycentric engine; it does not create a RecordedCurve asset. Zero keys use unit defaults; one key propagates globally. Collinear keys interpolate piecewise; other keys triangulate. Outside the Style hull, nearest boundary style extends indefinitely. Existence is still the intersection of source coverages. Source key positions never enter Style triangulation.

## Geometry

Resolve POSITION relations first, keeping raw fields immutable. Compute arc-length trims on the bound cubics with the existing 512-segment LUT. Trim length on each side is `L = baseRadius * radiusScale * min(lengthA,lengthB)`; baseRadius defaults to 0.08. Source subcurves are exact de Casteljau subcurves at the LUT-derived parameters.

Orient tangent A toward the removed junction and tangent B away from it. Default handle length is `min(L, distance(PA,PB))/3`, multiplied by its positive tension. Thus endpoint tangents remain positively collinear for all supported style edits. Handle drag projects screen-space movement onto the rendered tangent (including unequal axis scaling and negative yaw), clamped to 0.05–4. Radius scale UI spans 0.1–8. The style does not guarantee freedom from interior self-intersections for arbitrary source shapes; G1 applies at both source connections.

Degenerate length, trim tangent, or transition chord produces diagnostics and POSITION fallback. Overlapping opposite-end trims mark both conflicting transitions before any cuts are installed. No partial transition is rendered. Hidden source pairs do not leave detached transitions or cropped visible partners.

## UI/history

Rendering and source picking use trimmed paths; transition picking selects the Junction. Source editing retains bound-source handles and the shared point editor. Smooth editing keys only the Style field. Pointer edits use a draft and one commit; cancelled gestures discard the draft. NumericSlider sessions reuse the project history lifecycle. Undo removes a newly auto-created Smooth Key or restores existing parameters. Save/Load retains the Junction field.

## Validation

33 targeted unit tests passed, including all four endpoint orientations, G1, exact trim positions, sparse Style propagation/interpolation, boundary extension, source key topology independence, uniform source scaling, persistence, overlap/degenerate fallback, and existing Bind behavior. Eight Recording Room browser regressions passed; the final Smooth-specific UI recheck covers outside-coverage controls, handle Auto-Key undo, negative yaw and reload persistence. Production build passes (existing bundle-size warning remains).
