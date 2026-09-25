# Curve point merge — V0.9.5

Use **Point → Merge On-Curve Points**, or the same action in an on-curve point's inspector.

1. Select the point whose position and identity should be retained.
2. Select another point on the same host curve. Its incident curve endpoints are redirected to the retained point, and the redundant landmark is removed.

Both points must have exactly zero XYZ Offset and matching side/mirror relationships. Both mirror partners are merged in the same transaction. Selection works in 2D, 3D and the sidebar. Escape cancels an unfinished operation; Undo Step clears the first choice. Successful merging exits the tool and selects the retained point. Undo/Redo restores the entire operation.

Existing curves keep their IDs and authoring parameters. This creates a shared endpoint; it does not concatenate cubic segments or add Smooth. Patch topology and the surface solver are unchanged. Existing boundary references and continuity keys are redirected only to preserve referential integrity. A merge that would collapse a connected curve or existing Patch boundary is rejected rather than deleting that geometry. System anchors, nonzero offsets and locked/module-protected edits are rejected.

No new saved schema: existing landmark, curve and boundary references express the merged result.
