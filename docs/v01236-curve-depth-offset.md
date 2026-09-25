# V0.12.36 · Curve Depth Offset

A single Drawing Curve can now move its ink in front of or behind siblings of its parent while keeping its layer, stroke, list position, geometry, endpoint connections and fill boundaries. This supports a collar whose upper segment sits behind a neck while its remaining segments sit in front.

## Interaction and data

Select an individual curve in the list or with Direct Select. Properties → Depth offset offers a reference (Stroke / direct parent or Layer), an integer offset, ±1 and reset. Switching the reference resets the offset. Negative values go backward; positive values go forward. The offset is relative to current structural sibling order, including hidden/collapsed and empty layer slots. Rendering clamps to that level's ends without automatically crossing another hierarchy level. The stored value survives later list changes.

`DrawingCurve.depthOffset` and `depthScope` are optional; old projects default to zero and PARENT. No separate path/ownership data is created. The list displays a depth badge. Within a stroke, dragging member rows changes their list/ink order. `localPaintOrder` records that members must retain independent paint ordering. The flattened paint queue includes fill boundaries in sibling extents, uses stable list order for ties, and never follows another curve's offset recursively.

The source layer still owns its fill/cutout operations. Moving ink does not move fills. All occlusion is normal painter's order, including occlusion by its own fill. Vector ink, endpoint extensions, mist and hit geometry move together. Editing handles remain foreground aids.

Complete stroke width/taper/display intervals are evaluated before splitting ink by source member. CUSP connection ink is emitted once with the foreground member. ARC bridges split at their arc midpoint and each half follows its source. Untouched strokes retain the existing whole-stroke rendering path.

## Bound endpoint defaults

A newly bound endpoint clears automatic taper/extension on every endpoint participating in that connection, leaving unrelated free ends alone. Position links receive the same default while preserving separate curve/layer structure. Existing legacy 20× values are suppressed at physical bound endpoints even when a branch makes one an evaluator path end. No eager archive migration is needed.

The user can subsequently opt a particular side into internal endpoint ink. Changing an existing join type preserves that explicit choice. Controls, overlays, keyboard editing and rendering distinguish a physical free endpoint from an internal branch endpoint.

## Validation

- 156 focused Drawing unit tests pass (20 files): sibling/layer offsets, clamping and empty layers, persistence, child ordering/Shift range, partitioned ink, ARC ownership, branch defaults, explicit local ink and connection changes.
- 28 distinct relevant browser scenarios passed across depth, internal ink, Pen defaults, transparent fills, arc joins, hair cusp seams, display intervals, mist and performance suites. An old ambiguous mirror-axis test selector was scoped to its toolbar.
- Actual SVG occlusion/picking tested with a collar bar behind a white filled closed stroke. Undo/Redo, Save/Load and Chinese/English controls checked.
- Hair raster comparison before/after ink partition: zero pixel difference for the regression fixture.
- Saved ear fixture (104 curves): handle drag average about 42 ms, frame P95 about 17 ms in the browser performance run.
- Production build passes; existing bundle-size advisory remains.

User JSON files and the live browser project's contents were not overwritten.
