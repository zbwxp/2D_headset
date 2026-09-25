# V0.9.1 — Independent Eye Editing

Supersedes the shared Eyeball/EyeCoord transform in V0.9.0.

- Eyeball center uses scaffold parameters XYZ; its base rotation uses `ballOrientation`.
- Lid center uses `coord.position`; its base rotation uses `coord.orientation`.
- Each component retains strict left/right mirroring. Moving or rotating either component leaves the other unchanged.
- Legacy V0.9.0 transforms are copied into both frames once, preserving the prior geometry. A frozen `perspectiveOrigin` retains the previous eye-only display correction without introducing an indirect dependency on either editable center.
- Point inspector XYZ now edits HeadFrame/model coordinates through the existing nudge/inverse-local transform. X is horizontal, Y vertical, Z depth. Local width/height normalization and rotated EyeCoord axes remain internal source representation.
- Rotation sliders explicitly say “rotation about X/Y/Z”; they are not positional XYZ controls.
- Upper and lower lids are true 3D cubic Bézier curves: shared endpoints plus two independently editable spatial control points each, with no coplanarity constraint.

Validated independent position/rotation, gaze, persistence, both-side XYZ directions under tilted frames, handle dragging and Undo/Redo.
