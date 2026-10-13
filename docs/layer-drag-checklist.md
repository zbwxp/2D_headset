# Layers panel drag (bowen 1791865224: "common sense", as in Adobe's panel)

Written with the code (a quick panel pass, memory "quick pass"), not before it.

- A layer row dragged over another layer row: the upper half → drop above it, the lower half → below; a blue line on that edge shows where. Over itself: no line, no drop.
- A continuous curve row: the same, above / below another curve, in its own layer (reorderGroup) or in another layer (moveGroup, then placed — one edit).
- A curve over another layer's row: the whole row framed → drop into that layer, on top (moveGroup). Over its own layer's row, or a layer over a curve: nothing.
- A drop that changes no order makes no edit. Each drop is one undo step. The line goes when the drag ends or leaves the panel.
- Curves are now listed top first inside a layer, like the layers (they were bottom first).
- Not done: dragging single lines, dragging several selected rows at once, auto-scroll while dragging.
