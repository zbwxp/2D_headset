# Recording snapshots v2

This is the native snapshot implementation candidate. Browser acceptance is reported separately from the code and migration checks.

## Data model

`project.recordingSnapshots.version=2` contains one canonical original-element library, snapshots, and recordings. A snapshot stores ordered live layer references, its own relationship overrides (`add`, `update`, `disable`), and residual pose state. It stores no baked copy of original curves. Source snapshots own the live layer member list; referenced snapshots follow source additions and edits.

A recording indexes view snapshots and independent sparse channel tracks. Creating a view inherits the current evaluated references and state without creating a key for every object. Updating a view saves only its current-angle drafts. Warp creation seeds that new Warp at existing views so established poses remain neutral. Snapshot ancestry has stable identities, cycle checks and explicit branch-conflict diagnostics; a face-variant editing UI is outside this release.

Drawing remains the original-element editor. Its changes and canonical-library updates share one history transaction. Existing per-curve offsets remain relative to the updated originals. A new curve has zero direct offsets and follows any live layer Warp or domain placement. Cut/paste moves references; source Drawing snapshots remain available below the current view. Copy/paste creates new canonical identities and rewrites their internal references.

Legacy sources with identical raw IDs are isolated by original artwork identity, with a complete origin mapping. Valid v33 pose tracks migrate to editable layer channels, preserving every key, empty key, interpolation mode, draft and exact zero scale. Original project JSON is archived for recovery. Missing or conflicting dependencies retain explicit legacy fallback rather than guessing or deleting data.

## Human workflow

1. Enter Recording. A new recording starts with one empty 0° view.
2. Select source layers in the lower source lists, click Cut, then Paste in the current view. The lower source remains available; the viewport renders each selected canonical element once.
3. Set the desired angle and establish the next view. It inherits the evaluated references and state. Modify visibility, layer order, direct curve shape or Warp, then update the view.
4. V-click a continuous stroke to select and transform it; Shift adds strokes. A edits its endpoints and handles. Layer selection applies a layer-domain transform; its edge handles allow exact zero width/height and recovery.
5. Enable onion skin to inspect the default −90°…0° yaw transition at Y=0. Unsaved current-pose edits participate through temporary evaluation keys. No source, saved keys or history are written by onion inspection. −30° and −60° have distinct guide colors.
6. Delete a view with its × button. Sources remain, Undo restores it, and surviving saved view values are preserved. Deletion is refused if another snapshot explicitly depends on it.

Snapshot relationships remain separate from mere layer ordering. A single-layer V action that newly separates a true cross-layer EndpointLink is rejected with the affected layer names; selecting the connected layers in one batch is supported. Ordinary A editing continues to move linked endpoints. Width-zero placement is rendered and serializable, but inverse-dependent curve edits require restoring that axis first.

## API

Use `inspectSnapshots`, `snapshot`, `previewSnapshot` and `previewSnapshotFrames`. `snapshot` accepts `{recordingId?, commands, expectedRevision?, dryRun?}`. Batches are validated before a single commit; failed or dry-run batches do not mutate the source or history. Current v2 projects reject archived `scene`/legacy recording writes.

Core operations are `createRecording`, `createSnapshot`, `selectSnapshot`, `setAngle`, `updateSnapshot`, `deleteSnapshot`, `pasteLayers`, `moveLayers`, `cloneLayers`, `reorderLayers`, `setVisibility`, `setLayerPlacement`, `moveShapeNode`, `moveShapeHandle`, `transformShapeElements`, `createWarp`, `editWarpNodes`, and the retained interval/order/Warp-tree commands. Shape positions are in the post-Warp, pre-placement coordinate system. `transformShapeElements` uses a world-space transform and writes residual element deformation, never a hidden Warp.

Relations and membership are discrete view state: preview chooses the nearest saved view by angle distance, with deterministic Y/X/ID tie-breaking. Geometry pose channels interpolate independently. An explicit snapshot ID selects that snapshot's structure. Parent snapshots evaluate at their own saved state, not at the child's cursor angle.

Workspace reference images remain local viewport aids. They are excluded from project source geometry and ordinary SVG export. Legacy project restoration uses the archived JSON and remains a separate deliberate open operation.
