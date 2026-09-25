# V0.12.10 · Short Handle Picking

The supplied Drawing Room archive contains both handles of Curve 17 in the right-eye layer and Curve 17 · 1 in the left-eye layer. Their P0 handle lengths are both 0.00016556136326817056 drawing units: about 0.048 CSS px at 100% in the test viewport. The endpoint square was painted after the handle circle and intercepted its center, making the handle appear absent and preventing normal selection.

Both affected P0 joins are already CUSP in the archive. Their outward handle angles are approximately 172.37° and 168.89°, so their endpoint tangents are nearly smooth. CUSP changes ink joining and does not force handles into an acute corner.

Fix:

- A handle within 10 CSS px of its node has a 9 px dashed ring. The grip stays centered at the actual handle position: there is no coordinate proxy, auto-extension or geometry correction.
- The active handle is painted and hit-tested above the endpoint square. Dragging continues to apply pointer displacement to its original coordinates, without a jump.
- The curve inspector provides explicit P0/P1 Endpoint and Handle selection buttons. Coincident and zero-length handles can be selected and edited even in dense geometry.
- Selecting a control is transient UI state; it does not change geometry or create Undo history. Shared-node semantics, independent CUSP handles and existing Smooth constraints are unchanged.

The regression fixture contains the supplied drawing geometry with its background photo omitted. Browser tests cover both eye handles, ring/inspector selection, exact drag deltas, unaffected nodes/other handles, Undo/Redo, Save/Load and conversion to CUSP with a completely collapsed handle. Existing drawing interactions are also covered by regression tests.
