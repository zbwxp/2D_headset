# Vector recording ownership

The working `project.drawing` and named `drawingSnapshots` are source artworks.
A recording rig refers to one artwork ID; parameter keyforms only store deformer
controls and visibility, never a copy of nodes, source handles or layer members.
The `$working` source ID is reserved for an unnamed artwork. Saving a new artwork
makes an independent source; switching artworks selects its own rig.

The editor uses Drawing and Recording modes. The store enforces source capability
checks so keyboard shortcuts and the structured editing API use the same rule.
Legacy poseRecording/assembly data remains in project JSON but is not exposed in
the primary workspace. No geometry is silently converted from those old rigs.
