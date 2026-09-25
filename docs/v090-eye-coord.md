# V0.9.0 — EyeCoord

Eyes now initializes a fixed, HeadFrame-relative EyeCoord with mirrored local eyelid points and upper/lower cubic curves. Width, height, tilt, XYZ position and base orientation are editable. Corners and control points can be edited locally; the selected lid exposes two draggable handles in Main 2D. Both sides update together. Edits use existing Undo/Redo transactions.

Gaze rotates only the eyeball and iris about the eye center. It never changes eyelid source geometry. Eye-only perspective is applied afterward by the existing display transform.

## Authorized migration

Loading an old cylinder scaffold deletes the cylinder points/curves and their complete dependency closure (including hosted points, attached curves and downstream patches, on both sides). Eyeball/iris identities and parameters are retained. The former eyeball X offset is folded into EyeCoord X, preserving its center. Source JSON files on disk are not modified by migration. An already open legacy session also offers a one-transaction conversion button.

Reserved legacy ID slots remain in the scaffold metadata for stable eyeball identity; they are not regenerated as cylinder geometry. Legacy cylinder constructors remain available internally for migration fixtures, but the application creation path constructs EyeCoord directly and cannot add cylinder surfaces to it.

## Source model

- `eyeScaffold.coord`: shared width/height/tilt/orientation and stable lid IDs.
- `EYE_LOCAL`: mirrored semantic points with normalized local X/Y and R-relative Z.
- `CONTROL_POINTS`: cubic provider referencing two endpoint and two control point IDs; reuses curve evaluation, picking, contour display and dependency graph.
- All new objects belong to Eyes. No replacement surface, blink or lid-follow-gaze behavior is introduced.

## Validation

40 targeted tests cover migration, actual eye archive, source dependencies, symmetry, rotated coordinates, persistence, on-curve anchors, iris/gaze, perspective and existing hosted-curve evaluation. Browser tests cover actual archive migration, handle drag, Undo/Redo, new EyeCoord creation and shared center movement. Production build passes.
