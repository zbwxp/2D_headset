# V0.8.7 — Surface Bézier

All ON_PATCH curves support two editable UV control handles in the Main 2D viewport. The final line is S(BézierUV(t)), not a world-space cubic. The same host evaluator continues to supply Fullness/Fairing and mirror geometry.

- Optional `path.handleOffsets` stores two normalized UV vectors relative to the start/end chart positions. Missing offsets retain the previous straight parameter-domain path exactly; no load-time rewrite.
- Handles stay in the rectangular, triangular or periodic-U/open-V host domain. The UV cubic stays inside the convex chart. Loop traversal uses the existing persisted winding/lift.
- Editing either mirror side writes the canonical path. Displayed handles and their guide lines are mapped onto the selected host and then through Eyes perspective styling.
- Dragging uses local projected-distance minimization from the current UV to avoid jumping to remote overlapping surface branches. An edge-on view may offer little visible motion; rotate the view to edit that direction.
- One drag is one Undo transaction; camera changes do not create keys or geometry edits.
- ON_PATCH host selection filters to eligible patches; non-Patch HeadSet reference surfaces no longer intercept Eyes host selection.

Validation includes the user's 眼睛研究1.json: cylinder host picking, corner selection, creation, handle drag, Undo/Redo; all four Patch topologies, endpoint preservation, mirror, persistence and legacy ON_PATCH tests.
