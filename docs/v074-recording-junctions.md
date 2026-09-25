# V0.7.4 — Recording Junctions

Recording Room offers Bind Endpoint: click master then follower. Both must have valid coverage at the current view. Completion exits the tool and selects the follower. Creation adds one POSITION RecordingJunction without changing any raw ViewKey; the derived endpoint closes immediately and its adjacent handle translates by the same delta.

Evaluation: raw cubics → dependency-ordered Junctions → whole-view mirror → shared rendering/picking. Curve-level cycles and duplicate incoming endpoint relations are rejected during creation and loading. Outside common coverage, the raw follower remains unchanged; no extrapolation. Curve deletion removes its relations.

Bound endpoint drag and Merge moving endpoint are rejected. Handle editing inverse-mirrors and subtracts the active junction translation before writing raw keys. Mirror Edit writes raw shape and leaves relations intact. Duplicate copies the visible derived shape into an independent curve. Binding, undo and redo persist through the existing project history and JSON serialization. Explicit Unbind and Smooth are not implemented.

At canonical yaw within VIEW_EPS of zero, an authoring-only centerline is shown. Endpoint drag within 6 CSS pixels snaps normalized x to exact zero and translates the adjacent handle by the actual endpoint displacement. No snap occurs during tool selection or handle drag.

Verification: 25 targeted unit tests, 7 browser regressions and production build passed. Browser navigation tests use actual angle value inputs rather than dynamic-importing a second Vite module instance. Coverage includes binding creation, raw preservation, handle editing, undo/redo, persistence, negative yaw, and snapping at multiple zoom levels.
