# V0.9.10 — Recording Endpoint Snap

Dragging either endpoint in Recording Room snaps within **10 CSS pixels** to another visible curve. Exact endpoints take priority over the curve body. Ordinary curves and guides participate, including locked curves and visible frozen references. Snap uses the displayed cubic after POSITION, Smooth trimming and whole-view mirroring; Smooth transitions also participate. Hidden curves and trimmed-away source segments do not.

The target is highlighted in gold with a marker at the contact point. Alt bypasses snapping. At front view the existing exact `x=0` centerline snap remains the fallback when no curve is captured.

Selected curve endpoints and handles render above every curve picking path, so an endpoint can immediately be dragged again after snapping onto another curve.

This is a one-shot position edit, not an automatic Bind. Target keys and junctions stay unchanged; the moving endpoint retains its endpoint-relative adjacent handle vector. Existing bound endpoint groups still move and Auto-Key together. One drag creates one history transaction; Escape cancels it.

Targets are evaluated once at drag start. The moving curve, its bound endpoint partners and dependent geometry are excluded to avoid following a moving target. Nearest-point search uses adaptive Bézier control-hull bounds in CSS space and returns an actual cubic sample (under 0.02 px subdivision tolerance), not a flattened-segment point. There is no schema change.
