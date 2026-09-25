# V0.12.4 — Persistent mirror axis and endpoint snapping

The Drawing Room mirror axis remains visible when switching tools and after a mirror operation. Hide Editing Helpers hides it with the other editing guides. Its position remains the existing `DrawingDocument.mirrorAxisX`, with the same Save/Load and Undo/Redo behavior.

Drag the guide in Select, Direct Select or Mirror Edit, or use its top grip in drawing tools. Curves and their editable endpoints take precedence over the guide's wide hit target. Pen, zoom, hand and reference-image movement retain their normal canvas gestures.

During dragging, the vertical axis snaps to the exact X coordinate of a visible on-screen curve endpoint within 8 CSS pixels. Hidden curves/layers do not supply targets; locked visible curves can supply reference targets. Equal horizontal distances resolve by proximity to the pointer's Y position and then stable node ID. The guide turns green and the endpoint is highlighted while snapped. Leaving the tolerance releases the snap. This is positional alignment, not a persistent constraint on the endpoint or curve.

Dragging uses the existing preview transaction and window pointer tracking. Mouse-up commits once; Escape cancels. Geometry is never moved by dragging the axis.
