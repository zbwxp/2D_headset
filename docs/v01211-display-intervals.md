# V0.12.11 · Display Intervals

Drawing Room supports multiple visible ink intervals on a standalone cubic, a continuous stroke, or a closed stroke. Select a curve or stroke and use **Display intervals → Add display interval** in Properties. New markers start at one third and two thirds of the continuous path's arc length. Markers slide along evaluated geometry, including rounded joins, rather than attaching to authoring endpoints. Percent fields provide precise positioning. Selected markers also support arrow nudges and Delete; Escape cancels a pending drag.

No intervals means full ink. Otherwise, the union of the intervals is rendered. Open-path markers can pass one another; the span between them remains visible. Closed paths follow their orientation from start to end, wrapping over the origin when start exceeds end. Explicit 0%–100% covers a full loop; equal percentages cover no ink. Deleting the last interval restores full ink.

The full selected geometry remains as a faint editing guide. Preview hides all editing aids and draws only masked ink. Fills continue using full boundary geometry and remain closed. Width profiles retain their original whole-stroke progress; cropping does not restart a taper. Tangent extensions display only when their original terminal is included. Derived offset source geometry is unaffected.

## Data and evaluation

`DrawingDocument.displayIntervals` is optional and backward compatible with version 2 documents. Each entry holds an ID, a stable oriented source-curve anchor, and independent interval IDs/start/end fractions. This is appearance metadata, not another stored stroke membership graph. Membership is derived from connected geometry on every evaluation. Branched groups have separate continuous paths, with intervals applied to the path containing the selected source curve.

The anchor stabilizes traversal direction and closed-loop origin against layer reordering and cloning. On exact curve splitting, a reversed anchor transfers to the appropriate new segment. Duplication copies appearance with fresh IDs. Deleting an anchor transfers the normalized intervals to a surviving member of its old path; deleting the whole path removes its appearance records. Connecting paths combines their interval records by union on the resulting path. Further topology edits reevaluate normalized ranges on the resulting path rather than preserving old world-space cuts.

`displayField()` measures the same derived curves/arcs used by ink rendering and maps stored fractions to current traversal. `inkRuns()` intersects these spans with existing ink-enabled segments and crops cubic pieces while retaining full-path width sampling. It never edits raw curves, nodes, joins, fill boundaries or offset sources.

Dragging uses the common Drawing Room drag transaction: preview locally, commit once on release, Undo/Redo restore the complete state. Locked or hidden members prevent interval edits. Project JSON persists and validates interval IDs, anchors and finite normalized positions.

## Validation

Unit coverage includes single curves, cross-join spans, union/overlap/empty masks, closed wrapping, stable origins under reorder/reversal, whole-stroke profiles, tangent extensions, arc joins, geometry changes, exact splitting, duplication, deletion, layer movement, lock enforcement and save validation. Browser coverage includes marker dragging across a join, one-step Undo/Redo, Save/Load, multiple spans and preview, unchanged fills, marker deletion, cancellation, locking, and Chinese UI.
