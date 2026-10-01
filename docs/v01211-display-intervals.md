# V0.12.11 · Display Intervals

Drawing Room supports multiple visible or gap intervals on a standalone cubic, a continuous stroke, or a closed stroke. Select a curve or stroke, choose **Display intervals → New interval type → Visible interval / Gap interval**, then **Add display interval** in Properties. Existing ranges also have an editable type selector. New markers start at one third and two thirds of the continuous path's arc length. Markers slide along evaluated geometry, including rounded joins, rather than attaching to authoring endpoints. Percent fields provide precise positioning. Selected markers also support arrow nudges and Delete; Escape cancels a pending drag.

No intervals means full ink. Visible intervals form the allowed union; gap intervals are subtracted afterward. With only gaps, the allowed base is the full stroke. Gaps win in overlapping areas. Open-path markers can pass one another; the span between them is used for either showing or hiding. Closed paths follow their orientation from start to end, wrapping over the origin when start exceeds end. Explicit 0%–100% covers a full loop; equal percentages cover an empty range. An empty visible range shows nothing, while an empty gap removes nothing. Deleting the last interval restores full ink.

The full selected geometry remains as a faint editing guide. Preview hides all editing aids and draws only masked ink. Fills continue using full boundary geometry and remain closed. Width profiles retain their original whole-stroke progress; cropping does not restart a taper. Tangent extensions display only when their original terminal is included. Derived offset source geometry is unaffected.

## Data and evaluation

`DrawingDocument.displayIntervals` is optional and backward compatible with version 2 documents. Each track holds an ID, a stable oriented source-curve anchor, and independent interval IDs/start/end fractions. Each range has an optional `mode: 'SHOW' | 'HIDE'`; absent mode means legacy SHOW, without rewriting saved data. This is appearance metadata, not another stored stroke membership graph. Membership is derived from connected geometry on every evaluation. Branched groups have separate continuous paths, with intervals applied to the path containing the selected source curve.

The anchor stabilizes traversal direction and closed-loop origin against layer reordering and cloning. On exact curve splitting, a reversed anchor transfers to the appropriate new segment. Duplication copies appearance with fresh IDs. Deleting an anchor transfers the normalized intervals to a surviving member of its old path; deleting the whole path removes its appearance records. Connecting paths combines their positive and negative interval records on the resulting path using the same union-then-subtract rule. Further topology edits reevaluate normalized ranges on the resulting path rather than preserving old world-space cuts.

`displayField()` measures the same derived curves/arcs used by ink rendering and maps stored fractions to current traversal. `inkRuns()` intersects these spans with existing ink-enabled segments and crops cubic pieces while retaining full-path width sampling. It never edits raw curves, nodes, joins, fill boundaries or offset sources.

Dragging uses the common Drawing Room drag transaction: preview locally, commit once on release, Undo/Redo restore the complete state. Locked or hidden members prevent interval edits. Project JSON persists and validates interval IDs, anchors and finite normalized positions.

## Validation

Unit coverage includes single curves, cross-join spans, union/overlap/empty masks, closed wrapping, stable origins under reorder/reversal, whole-stroke profiles, tangent extensions, arc joins, geometry changes, exact splitting, duplication, deletion, layer movement, lock enforcement and save validation. Browser coverage includes marker dragging across a join, one-step Undo/Redo, Save/Load, multiple spans and preview, unchanged fills, marker deletion, cancellation, locking, and Chinese UI.


## Gap intervals (2026-09-25)

不同区间使用不同颜色，同一区间的 A/B 两端及编号使用同一种颜色，保留 1A/1B、2A/2B 编号；显线/断线类型通过属性和标记提示查看。断线两端笔触作用于缺口两侧留下的墨线：收尖朝向缺口，设置延伸会伸进缺口；原始笔画外端的笔触保持。重叠缺口先合并，只对真正暴露的缺口边界应用笔触，内部标记不产生额外笔尖。填充和矢量几何均不受影响。

录制时缺失的断线区间按中点处零长度、零收尖/延伸参与插值，使缺口和两端笔触一起逐渐张开。正区间缺失沿用 full-ink / 区间生长规则。同一 range ID 在两个快照里由 SHOW 改为 HIDE 时，求值使用正、负两个派生通道连续过渡，不在半途突然反转蒙版；原快照不改写。闭环保留循环起点/长度语义。

验证新增缺口、显线与断线混合、多缺口重叠、空/全长区间、开曲线反向、闭环跨缝和填充、收尖与延伸方向、快照类型变化/缺口生长、旧数据兼容、精确分割/复制、Undo/Redo 及 Save/Load。实际浏览器验证新增断线、改类型、撤销和纯预览的缺口线头。
