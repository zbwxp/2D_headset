# Global Undo across Drawing and Recording

Confirmed 2026-10-04: always undo the last committed action in global time order and return to its viewport. Reference-image edits participate too.

## Runtime contract

- The shared store keeps one chronological history. Each entry records exact before/after project identities and explicit before/after mode, view, Drawing camera/selection, and Recording camera including fit bounds. The saved project itself carries the active artwork, recording, snapshot and angle.
- Undo/Redo restore validated historical projects directly. New source edits still obey Drawing ownership checks; replay no longer asks the user to switch rooms first. Both the toolbar and public editing API use this path. Tooltips identify the destination room, artwork or snapshot/angle, and local reference/viewport edits.
- Reference uploads, replacements, removal, transforms, opacity, lock and visibility changes join that history as local effects. Recording images remain in their existing dedicated local store, outside project JSON, canonical source geometry, snapshots and recording keys. Replay updates the local store in the same ordered write queue.
- Recording and Drawing camera pan/zoom drags preview without history, commit once on release, and restore their starting camera on cancellation. Fit and wheel changes are undoable. Recording fit bounds remain stable until explicit Fit, preventing topology updates from overwriting a restored camera.
- Reference position sliders and number fields use the shared preview/commit control in both rooms. A completed drag commits once; canceled or unchanged previews neither add history nor clear Redo. Scale/rotation/opacity text fields commit their accepted value.
- No-op/canceled store transactions restore the entire prior history, including Redo and the oldest entry at the 100-entry cap. Automatic history navigation and local reference hydration never record new history.
- History is session-local. Reload retains the committed project/reference and existing workspace preferences, but does not serialize the Undo stack. Ordinary room selection, object selection and panel/tool preferences remain navigation rather than authoring transactions.

## Verification

`global-history.test.ts` covers chronological Drawing → Recording replay, exact project identity, destination mode/snapshot/camera, API replay of local-only edits, reference load/unlock/move/scale/visibility/remove plus persistence, cancellation/unchanged edits, Redo preservation and the history cap.

`recording-curve-canvas.test.ts` exercises real Recording pan/zoom pointer handlers: many preview samples produce one entry, cancellation preserves Redo, and Undo/Redo restore the camera without changing source data. Existing Drawing snapshot, Recording authoring, reference persistence and workspace-session suites remain covered by focused checks.

No browser run or deployment was performed for this patch. The existing legacy route-cut synchronization assertion in `recording-scene-source-integration.test.ts:86` fails identically on base commit `1d6449001dded61a57c39ab902eeda119802a021` before history replay; it is outside this change.
