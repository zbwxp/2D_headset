# V0.10.0 — Recorded Points and Semantic Curves

Recording Room now offers:

1. **New Recorded Point / 新建录制语义点**: click the canvas to place a visible point, then name it (brow, chin, ear root, etc.). Dragging records its position at the current view in one Undo transaction. Points have their own key list, view map, visibility and lock controls, plus a Point badge.
2. **New Semantic Curve / 新建语义曲线**: click two distinct recorded points, on the canvas or in the list. A cubic is created between them. Its endpoints reference those shared points and its handles remain independently editable/recordable.

Points draw as cyan dots in the editor (selected green, uncovered red) and small black dots in Final Preview when covered. Hiding a point hides only its marker; curves that depend on it keep their positions and visibility. Point data is stored separately from ordinary/guide curves for future grouping. This version does not add a grouping tool.

## Data and evaluation

- Optional `Recording.points: RecordedPoint[]` stores point IDs, names, visibility/locks, and `{yaw,pitch,position}` keys. Legacy recordings with no points still load unchanged.
- Optional `RecordedCurve.semantic: {startPointId,endPointId}` identifies a semantic curve. It otherwise keeps ordinary curve keys and properties. Raw cubic endpoints are authoring baselines; handle-minus-endpoint vectors are what matter under point motion.
- Point interpolation reuses the current deterministic view interpolation through a runtime adapter, without storing fake curve assets.
- Pipeline: raw curve field → shared point positions + endpoint-relative handles → compatible POSITION Junctions → Smooth → whole-view mirror → rendering/picking.
- Point and curve coverage remain independent. Editing outside coverage uses the existing red frozen reference and Auto-Key behavior. Final Preview requires curve and both point fields to be covered. Moving a point never silently adds curve shape keys. Hide is separate from coverage.
- Editing handles subtracts the derived endpoint translation before writing the raw key. Negative-yaw authoring inverse-mirrors once. Moving a point or dragging a semantic curve endpoint updates only the point's keys; every referring curve follows.

## Existing tools

- Snap excludes all curves driven by the moving point, preventing self-capture.
- Smooth can pair semantic curves sharing the same point through the existing two-click Bind tool. A conflicting Bind cannot replace a semantic endpoint's point owner. Unbinding that pair disables its Junction/Smooth, not its underlying point references.
- Mirror Edit retains target point ownership. Duplicate creates independent curve keys while retaining references to the same semantic points (no whole-curve offset that would detach endpoints).
- Locking a point prevents its position edits but still permits curve handle edits. Hiding/locking dependent curves does not freeze their source point's geometry.
- Referenced points cannot be permanently deleted until their curves are removed, so Save/Load cannot introduce dangling references. Per-point key deletion retains at least one key.
- No 3D/modeling geometry or existing assets are converted.

## Validation

- Production build passes.
- Recording domain and language tests: 57 passing tests, including nine semantic point/curve tests.
- Browser verification covers creation, shared-point motion, independent handle Auto-Key, negative yaw, point visibility/locks, Smooth, Undo/Redo and Save/Load. Existing recording, reference-image, guide and endpoint-snap scenarios also pass.
