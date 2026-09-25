# V0.12.12 · Endpoint Links

Drawing Room adds **Link endpoints / 端点联动**. Click the fixed endpoint, then the moving endpoint. The second endpoint and its adjacent handle translate into place. Moving either linked endpoint subsequently moves the entire linked position group. Handles retain their endpoint-relative vectors; no tangent alignment is introduced.

Links are separate from shared-node stroke topology. Original curve IDs, node IDs, continuous/closed stroke membership, widths, profiles, display intervals, fill ownership, layer membership and paint order remain independent. Links can cross layers and can connect another endpoint to an existing linked position. They do not turn two independent curves into one closed stroke or fill boundary. **Bind**, **Smooth**, **Cusp** and **Arc** still explicitly merge nodes and stroke membership as before.

## Interaction

The five connection tools share one toolbar slot. Single-click activates the last selected tool; right-click or press-and-hold opens the flyout. The flyout also supports keyboard opening and navigation. Hover provides the usual tooltip. Each tool shows a short explanation in the top options bar and in the flyout, in Chinese and English.

Linked endpoints have a purple editing ring. Select an endpoint to see its incident links and navigate to the other endpoint in Properties. **Unlink endpoints** removes that relation while retaining current curve geometry. Link creation, unlinking, endpoint dragging, nudging and transforms participate in existing atomic Undo/Redo transactions.

Linked partners are excluded from endpoint snap candidates so small drags cannot snap back to their own previous position. Locks and hidden-geometry edit guards apply to every endpoint that would move; rejected operations do not partially edit the group. Menu arrow keys never nudge selected canvas geometry.

## Persistence and command integration

`DrawingDocument.endpointLinks` is an optional version-2-compatible array of `{id, a: Endpoint, b: Endpoint}`. Endpoint references remain curve-local; link groups are derived from those references and underlying node IDs. The parser checks unique IDs, existing endpoint references, distinct nodes, duplicate node pairs and coincident positions.

Endpoint edits propagate bidirectionally. Whole-curve transforms and Mirror Edit propagate only linked endpoint translations to unselected partners, leaving the rest of those curves independent. Ordinary shared-node/tangent-join protections still apply. Moving a curve to another layer does not move linked partners to that layer.

Splitting preserves terminal link references. Duplicating both linked curves copies their relation with fresh IDs; duplicating just one produces an independent copy. Deleting a referenced curve removes its dangling links without moving survivors. Explicit Bind/Join removes links made redundant by actual node merging. Unbinding a shared node preserves any explicit links that reference the detached endpoint.

## Validation

Domain checks cover separate topology and appearance, cross-layer links, existing closed strokes, bidirectional multi-endpoint groups, transformations, Mirror Edit, snapping prerequisites, explicit joins after linking, split/duplicate/delete/unlink, locked and hidden geometry, and Save/Load validation.

Browser checks cover right-click, long-press, keyboard selection, top-bar descriptions, Chinese UI, cross-layer two-click preview, one-step Undo/Redo, Save/Load, small and large drags from either side, keyboard nudges, unlinking, locks and independent layer movement. Existing Drawing Room browser regressions cover all join modes, display intervals, fill/offset, mirror tools, pen, layer organization and drag lifecycle.
