# V0.12.3 — Drawing zoom, cusp angles and linked Mirror Edit

Drawing Room only. Recording and 3D geometry are unchanged.

## Zoom

Z selects Zoom. Click zooms in; hold Ctrl and click to zoom out. Releasing Ctrl restores zoom-in. The cursor follows the modifier immediately. Alt-click remains supported. Ctrl-click reported as the right button on macOS also zooms out instead of panning. Ctrl+Z / Cmd+Z keep Undo, including while Zoom is active. Navigation creates no history entries.

## Signed cusp angle

Select the shared endpoint or either adjacent handle. Join Relationship exposes Cusp Angle as a number and slider, from -90° to +90°. Existing CUSP joins without `angle` evaluate as 0°.

`TangentJoin.angle` is the signed angle from outward handle A to outward handle B in Drawing coordinates (X right, Y up). Positive is counterclockwise; A is the first-click side used to create the join. Changing the angle preserves A and both handle lengths, rotating B. Dragging either handle maintains the angle bidirectionally. This is a sharp join constraint, not the ARC trim/transition feature.

Translations and rotations preserve the angle. Reflections negate it. Nonuniform scale transforms both handle lengths and A direction, then constrains B to retain the chosen angle. Consequently a nonzero cusp does not undergo a completely unconstrained affine deformation. Splitting and duplication preserve the relation. Switching to Smooth or Arc removes its angle. A slider drag is one transaction; Undo/Redo and Save/Load include the parameter and resulting handles.

## Mirror related-curve warning

Previously `mirrorEdit` called `checkScope` before evaluating anything. Sharing an endpoint with an unselected curve was enough to reject the edit, including when that point would remain stationary. The generic dialog only expanded selection and required repeating the action.

Mirror now computes an immutable candidate and compares actual endpoint/handle changes. Stationary neighbours do not trigger the warning, including stationary locked neighbours. Locked or hidden objects that would actually change still prevent the operation.

If neighbours change, the dialog lists the target and actually affected curves. Continue Mirror applies the pending source/target operation directly, preserving Bind and TangentJoin constraints. Cancel does nothing. A document change invalidates the pending operation. Confirmation commits once and Undo restores all affected geometry. If the source is itself related and must move, it is included in the affected list as well.

Other partial transforms and cross-layer moves retain their existing related-selection checks.

## Verification

56 Drawing/catalog unit tests passed, including all four endpoint combinations, positive/negative cusp angles, bidirectional handle edits, reflected and anisotropic transforms, persistence validation, mirror no-op neighbours and lock checks.

All 25 relevant browser scenarios passed across the regression run and focused reruns, including modifier zoom and cursor, numeric/slider cusp edits, atomic mirror confirmation, Undo/Redo, valid endpoint selection after Undo, Save/Load, arc joins, stroke/fill/offset editing and drag recovery. Production build passed (existing bundle-size advisory remains).
