# V0.12.8 · Sharp Ink Joins

Drawing Room now treats fill visibility as belonging to its closed boundary, starts Pen segments without inherited handle direction, and treats CUSP as an ink join rather than a tangent constraint.

- A fill is rendered and hit-tested only when its own visibility, its layer and every boundary curve are visible. Whole-stroke hide/show therefore includes its fill without overwriting the fill's own flag. `inkVisible` still only hides black strokes, so an uninked boundary can retain a white or black fill.
- Entering Pen resets continuation to POSITION. Consecutive clicks produce straight cubic segments, including the closing segment. Dragging a point may shape the incoming segment, but does not prescribe the next segment's handle. Explicit SMOOTH continuation remains available.
- CUSP shares the endpoint and leaves both handles independent. There is no angle control or stored angle constraint. Acute joins get an outer miter derived from the actual endpoint tangents and local ink width, including variable-width profiles; no miter-limit bevel removes the sharp tip. Exact tangent reversal has no finite miter, so a short, width-scaled local ink taper converges to the shared point instead. These changes affect ink only, not source geometry or fill boundaries.
- Loading a legacy CUSP preserves its authored geometry and drops its obsolete `angle` property. Smooth and rounded joins retain their existing geometry behavior.

Existing document transactions cover Undo/Redo and persistence; no separate stored path or fill-parent state is introduced.

Validation: 70 Drawing/i18n unit tests; browser checks for straight polygon creation, independent handles, closing/restarting Pen, fill inheritance and own visibility, Undo/Redo, Save/Load, bilingual UI, plus pixel sampling of acute tips at several widths. Existing Drawing regressions cover smooth/arc joins, snapping, mirror, drag lifecycle, stroke groups, layers and painting.
