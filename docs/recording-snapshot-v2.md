# Recording snapshots v2

This is the native snapshot implementation candidate. Browser acceptance is reported separately from the code and migration checks.

## Data model

`project.recordingSnapshots.version=2` contains one canonical original-element library, snapshots, and recordings. A snapshot stores ordered live layer references, its own relationship overrides (`add`, `update`, `disable`), and residual pose state. It stores no baked copy of original curves. Source snapshots own the live layer member list; referenced snapshots follow source additions and edits.

A recording indexes view snapshots and independent sparse channel tracks. Creating a view inherits the current evaluated references and state without creating a key for every object. Updating a view saves only its current-angle drafts. Warp creation seeds that new Warp at existing views so established poses remain neutral. Snapshot ancestry has stable identities, cycle checks and explicit branch-conflict diagnostics; a face-variant editing UI is outside this release.

Drawing remains the original-element editor. Its changes and canonical-library updates share one history transaction. Existing per-curve offsets remain relative to the updated originals. A new curve has zero direct offsets and follows any live layer Warp or domain placement. Cut/paste moves references; source Drawing snapshots remain available below the current view. Copy/paste creates new canonical identities and rewrites their internal references.

Legacy sources with identical raw IDs are isolated by original artwork identity, with a complete origin mapping. Valid v33 pose tracks migrate to editable layer channels, preserving every key, empty key, interpolation mode, draft and exact zero scale. Original project JSON is archived for recovery. Missing or conflicting dependencies retain explicit legacy fallback rather than guessing or deleting data.

## Human workflow

1. Enter Recording. A new recording starts with one empty 0° view.
2. Use “Add source” to choose a source snapshot, select its layers, click Cut, then Paste in the highlighted current view. Only requested source lists are shown; the viewport renders each selected canonical element once.
3. Set the desired angle and establish the next view. It inherits the evaluated references and state. Modify visibility, layer order or direct curve shape, then update the view. Existing Warp deformation remains supported by evaluation and the API; Warp creation and grid controls are hidden from this editing workspace.
4. V-click a continuous stroke to select and transform it; Shift adds strokes. A edits its endpoints and handles. Layer selection applies a layer-domain transform; its edge handles allow exact zero width/height and recovery.
5. Enable “Endpoint interpolation”, then select two view snapshots (default 0° and −90° at Y=0). Ghosts blend their final canonical Bézier controls at 5°/10° steps using the selected layer/curve interpolation weight asset; the default is linear. Editing the current endpoint updates this inspection live; the other endpoint is cached. Endpoint inspection blends the selected endpoint pair. Runtime uses the same scalar weight mapping on its sparse interpolation brackets and preserves every exact authored key, including intermediate views. Matching material interval boundaries interpolate separately; boolean visibility follows the nearer endpoint. Missing geometry or incompatible interval structure is reported. Current fills are hidden temporarily, and −30°/−60° guides have distinct colors. Inspection writes no source, keys or history.
6. Delete a view with its × button. Sources remain, Undo restores it, and surviving saved view values are preserved. Deletion is refused if another snapshot explicitly depends on it.

Snapshot relationships remain separate from mere layer ordering. A single-layer V action that newly separates a true cross-layer EndpointLink is rejected with the affected layer names; selecting the connected layers in one batch is supported. Ordinary A editing continues to move linked endpoints. Width-zero placement is rendered and serializable, but inverse-dependent curve edits require restoring that axis first.

## API

Use `inspectSnapshots`, `snapshot`, `previewSnapshot` and `previewSnapshotFrames`. `snapshot` accepts `{recordingId?, commands, expectedRevision?, dryRun?}`. Batches are validated before a single commit; failed or dry-run batches do not mutate the source or history. Current v2 projects reject archived `scene`/legacy recording writes.

Core operations are `createRecording`, `createSnapshot`, `selectSnapshot`, `setAngle`, `updateSnapshot`, `deleteSnapshot`, `pasteLayers`, `moveLayers`, `cloneLayers`, `reorderLayers`, `setVisibility`, `setLayerPlacement`, `moveShapeNode`, `moveShapeHandle`, `transformShapeElements`, `createWarp`, `editWarpNodes`, and the retained interval/order/Warp-tree commands. Shape positions are in the post-Warp, pre-placement coordinate system. `transformShapeElements` uses a world-space transform and writes residual element deformation, never a hidden Warp.

### Interpolation weight assets

A weight curve belongs to a layer or one canonical curve within that layer, for an explicit pair of views in the same recording. It is stored in `recording.interpolationWeights`, not in transient viewport preferences or a pose key. Each asset has `{id, target: {layerId, curveId?}, startSnapshotId, endSnapshotId, points}`. Targets keep their canonical IDs; renaming a view or navigating to another angle does not change the relationship.

`setInterpolationWeight` accepts `{startSnapshotId, endSnapshotId, targets: [{layerId, curveId?}, ...], points}`. The targets array applies one curve to a selection in one transaction. A layer target sets the fallback for that layer; a curve target overrides that fallback for only that curve and pair. Targets must be present in both selected endpoint views. At least one target is required. The endpoint pair must consist of distinct snapshots belonging to the requested recording, with different angles along one axis only: shared Y for yaw, or shared X for pitch. Diagonal pairs are rejected explicitly. Source-only Drawing snapshots are not interpolation endpoints in this API.

Points are normalized `[input, weight]` pairs, with 2–32 points including fixed `[0,0]` and `[1,1]` endpoints. Inputs increase strictly, weights never decrease, and all coordinates remain between 0 and 1. Smooth monotone cubic interpolation passes through the points without overshoot. No asset means linear. Explicit `[[0,0],[1,1]]` saves a linear override, which can intentionally override a curved layer fallback.

`resetInterpolationWeight` accepts the same pair and targets, without points. It removes only those relationship assets: a reset curve inherits its layer asset, and a reset layer falls back to linear. Neither operation writes geometry, endpoint views, pose keys or angle drafts. All selected edits share one Undo step. Native graph drags use an immutable preview and commit once when released; API dry runs and failures leave project data and history unchanged.

Reversing a pair refers to the same asset. Evaluation reverses its mapping as `1 - f(1 - t)`; setting the reversed pair keeps the asset ID and adopts the submitted orientation. `inspectSnapshots()` returns `interpolationWeights` and each recording's `interpolationWeightCount`. JSON export/import preserves them. Older v2 projects without this optional field remain linear. Removing an endpoint view removes its attached weight assets in the same Undo transaction; unavailable source geometry does not silently delete its saved assets.

```js
window.contourAI.snapshot({commands: [{
  op: 'setInterpolationWeight',
  startSnapshotId: 'front-view-id',
  endSnapshotId: 'side-view-id',
  targets: [{layerId: 'layer-slot-id', curveId: 'canonical-curve-id'}],
  points: [[0, 0], [0.5, 0.2], [1, 1]]
}]})
```

### Weight curve authoring and evaluation

Choose the two views with the endpoint selectors, select curves or layers in the current view, then edit **变形权重曲线 / Deformation weight curve**. The selectors also work with onion display off. The graph's horizontal axis is angle progress and its vertical axis is deformation weight. Click to add a point, drag to adjust, double-click or Delete to remove an interior point. Arrow keys adjust a focused point; Shift is a larger step and Alt/Option is a smaller step. The endpoints stay fixed. Multi-selection applies the same points to all selected targets in one Undo transaction. “Linear override” and “Inherit layer” are different actions.

The editing view stays in place: for example, keep the -90° view active, display the -60° reference and highlighted onion guide, and adjust the far-side curve or response while watching that guide. The graph marks -30°/-60° (or positive 30°/60° for that pair) in the same colors as onion skin. No comparison panes or automatic intermediate views are created.

Runtime uses the same monotone scalar response inside each existing sparse-track bracket contained in the selected view pair. If a pair spans intermediate authored keys, each adjacent bracket renormalizes the response between its own two boundaries, so every channel’s authored key remains exact. At an angle keyed only on a different layer/channel, an unkeyed channel still changes according to its response; there is no implicit whole-frame hold. A completely flat response across a bracket falls back to local linear timing. The graph labels authored intermediate positions; endpoint-only onion deliberately ignores those intermediate keys and mixes only its two chosen final endpoint shapes. Nonlinear placement/Warp evaluation also remains distinct from final-control-point blending. This feature does not replace normal animation with endpoint-only evaluation.

Layer responses retime placement and direct shape deformation. A single-layer Warp may share its layer timing; an existing Warp shared by several layers keeps its one original domain timing. Curve overrides retime their own handle-vector deltas and exclusive node deltas. A shared node or EndpointLink component has one deterministic layer authority, and linked layer placements share that authority's timing; conflicting ownership is explained by diagnostics rather than splitting or averaging a junction. The layer domain is not duplicated for a curve override. In endpoint inspection, neighboring curves retain their own response around an ARC. The ARC interior uses its relation response, while its first/last derived points and adjacent handles follow the weighted neighboring material trims; differing responses are explained by a diagnostic. This keeps the join connected without disabling the selected line’s weight control. Visibility, material interval positions and layer order retain their existing angle timing.

Weight assets are bound to stable layer/curve IDs and their explicit view pair. Moving the same layer reference between presentation positions does not create new assets or replace source geometry. Source edits continue through the canonical library. An explicitly cloned curve is a new identity and does not silently inherit the original curve's response asset.

Relations and membership are discrete view state: preview chooses the nearest saved view by angle distance, with deterministic Y/X/ID tie-breaking. Geometry pose channels interpolate independently. An explicit snapshot ID selects that snapshot's structure. Parent snapshots evaluate at their own saved state, not at the child's cursor angle.

Endpoint inspection preferences (enabled state, selected snapshots, step and opacity) are saved locally per project and recording. Switching Drawing/Recording or reloading preserves them; deleted endpoints fall back to valid defaults. These preferences are excluded from project data and Undo history.

Workspace reference images remain local viewport aids. They are excluded from project source geometry and ordinary SVG export. Legacy project restoration uses the archived JSON and remains a separate deliberate open operation.
