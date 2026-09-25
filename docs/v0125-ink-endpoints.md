# V0.12.5 · Ink Endpoints

Drawing Room changes only.

- Drag any editable node, including a shared ARC junction, to snap to another visible endpoint (9 CSS px) or the persistent mirror axis (8 CSS px). Endpoint targets take precedence. A visible locked endpoint may be a reference, but is not modified. Hidden endpoints are excluded. Snapping translates the entire shared node and its adjacent handles; it never creates a new binding. Preview commits once on release and supports Undo/Redo.
- The Z zoom tool now supports vertical scrubbing: press and drag up to enlarge, down to reduce, including diagonal movement. The position under the initial press remains fixed. Zoom is navigation, not document history; Escape restores the initial view. Existing no-drag click / Ctrl-click behavior remains available.
- Each open derived stroke has selectable ink tips. Select an actual endpoint or use Stroke start / Stroke end in the appearance panel. Each tip has independent taper distance and outward tangent extension distance (0–500 reference px, 250 px per drawing unit). Taper may fall back to the selected profile's original default. A tip with positive extension can be clicked directly in the canvas.
- Optional `inkEnds` values belong to physical Curve P0/P1, so reversing stroke traversal does not swap endpoint settings. Splitting transfers only the original outer endpoints. Offset followers support the same settings and preserve them when detached. Closed strokes ignore endpoint treatment. These are ink-only changes; raw geometry, fill boundaries, offset source geometry, and bound nodes are untouched.
- New pen sessions default to POSITION (Bind only); Smooth and Cusp remain explicit options. Subsequent handle editing on one segment does not constrain the next segment in POSITION mode.

Validation: 61 Drawing/catalog unit tests, 32 Drawing browser regressions, production build. Browser tests cover ARC snapping/group movement, exact mirror-axis alignment, hidden-target filtering, Undo, scrub zoom, POSITION default, ink-tip selection, Save/Load, and bilingual controls.
