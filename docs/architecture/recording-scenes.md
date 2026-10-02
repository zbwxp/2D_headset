# Recording scenes and independent object tracks

Status: v23 / `384c310` published 2026-10-02 at 06:27:29 UTC. Viewpoint authoring was introduced in v22; v23 groups each instance once without changing scene paint order. Bounded browser evidence and remaining coverage are recorded in [release validation](../recording-scene-release-validation.md).

Drawing is the reusable source artwork library. Recording assembles references to that library into independent scenes. Editing a source in Drawing updates its instances; Recording never writes source Bézier controls.

## Persistent ownership

- A project contains a set of recording scenes and an active scene ID, independently of the active Drawing artwork.
- An instance names one source artwork. The same artwork may appear repeatedly, with independent instance identities.
- A scene layer is identified by `(instanceId, sourceLayerId)`. Compilation namespaces every geometry, paint, link, and interval identity, including references inside those objects.
- A layer binds to one leaf Warp. The Warp's parent chain applies once, child first. Scene/instance tree membership does not add another deformation.
- Each Warp owns a rest grid, sparse angle keys, and an optional draft with its own angle.
- Layer appearance is independently animated. Member visibility overrides and source display intervals retain their original semantics. A cross-layer display interval has one channel and one owner, the source anchor's layer; it is never duplicated into every participating layer.
- Existing white fills, element depth offsets, local and linked end brushes remain source data unless an explicit pose appearance channel overrides the relevant property.

## Interaction

1. Create or select a Recording scene and add source artworks as instances. Each instance appears once as a collapsible group in the reused Drawing layer panel; the displayed grouping does not change paint order.
2. Choose an angle and explicitly create a viewpoint. A viewpoint can exist with no Warp or tracks. Unestablished angles are preview-only in the UI, including appearance and grid controls.
3. At an established viewpoint, change member appearance or select unbound layers across instances to create a shared Warp. Existing bindings use explicit parent, child, or rebind operations.
4. A newly created Warp receives rest-grid keys at all existing explicit viewpoints. Existing objects are untouched. Creating another viewpoint later does not add keys to existing tracks.
5. Update the viewpoint to commit only existing drafts at that angle, regardless of current selection. Unchanged channels and other-angle drafts retain their data. This is not a full-scene snapshot.
6. Use the angle slider to preview interpolation; a preview position does not create a key or viewpoint. Each object still evaluates its own track.
7. The low-level scene API retains direct track editing and saveSelected at angles without viewpoints. AI clients should normally create/update viewpoints to follow the UI workflow; the UI preview-only rule must not be described as an API write ban.
8. Removing an instance or a layer from a scene removes only scene use, never the Drawing artwork. Source-library organization is a separate explicit, backed-up workflow.

Viewpoints are `{id,name,angle}` entries, optional for compatibility. UI first edits materialize derived legacy key angles; ordinary parse/inspection does not. An explicit empty list stays empty. Renaming/deleting a viewpoint does not rename/delete object keys. Object drafts retain their own angles; editing an object at a different draft angle still requires resolving that object's prior draft.

## Interpolation

Each track brackets its own authored X/Y coordinates, with the source/rest neutral at zero when needed. Values outside its defined axis range use its boundary value. Explicit corners win; missing two-axis grid corners use the existing additive X + Y − neutral rule. Interval blending retains the established positive-coverage rules, and boolean appearance uses a deterministic dominant sample.

A two-key Warp and a ten-key Warp share an angle cursor without sharing a key lattice.

## Source updates and migration

Source lookup uses the active Drawing document, then that artwork ID’s retained working copy, then its saved checkpoint. Switching artworks preserves a dirty working copy under the same ID; returning to it restores that copy. Updating the current artwork commits the checkpoint and clears that ID’s working copy. Saving as a new artwork creates a new identity without retargeting existing instances. Names never identify a source. Missing references produce local diagnostics instead of being substituted by a similarly named artwork. Working copies persist in `project.drawingWorkingCopies`, keyed by stable artwork ID. Source signatures and interval material transport always use this effective-source resolution. API revisions include the working-copy map, including inactive assets, so an old-coordinate batch cannot proceed merely because the scene object itself is unchanged. Deleting a source removes its working copy but leaves scene animation orphaned or protected by an explicit in-use guard; normal Undo restores it.

The legacy one-artwork rig remains preserved. Its source becomes one compatibility instance, because a flattened source does not contain reliable original assembly provenance. Migration evaluates the old interpolation lattice before distributing values into independent tracks, preserving existing results and all original artwork data. Existing drafts retain their angle. Migration does not invent source assets.

Source geometry changes retain grids and keys. Appearance material must be transported against a known prior source using the existing source-sync rules. Topology or route ambiguity must be reported at the affected relation/channel; it must not silently delete unrelated animation.

## Acceptance boundaries

- Import front and independent side-front parts; repeated source instances must have disjoint runtime IDs.
- Select layers across instances, build a shared Warp, wrap a parent, and create a child; cycles and ambiguous binding replacement reject atomically.
- Save different object key counts and show that editing one track does not change another.
- Edit a mouth in Drawing and verify every instance at saved and interpolated angles uses the updated source.
- Preserve source controls, white fills, source depth offsets, display route coverage, and end brush behavior.
- Undo, Redo, JSON roundtrip, reload, drafts, and interrupted gestures require actual store tests.
- Browser acceptance is separate from headless tests and must exercise the complete user flow.

## Visibility and editing feedback

A scene layer's visibility track is a container gate. Hiding the layer suppresses its members; opening it preserves source-hidden members and authored member overrides. Source inheritance is distinct from an explicit member-level override. The low-level layer track remains a gate. The reused Drawing layer panel instead writes actual member visibility channels: an individual eye changes that member, and a layer eye explicitly batches its members, which can show source-hidden members. This UI operation must not be confused with setting the layer gate to true. Ink visibility and display intervals remain separate.

Warp influence highlighting is not selection. The low-level selected-object save writes only explicitly selected Warps and checked layers; viewpoint update writes matching-angle dirty channels independently of selection. A parent Warp reports both directly bound and recursively affected layer counts.

Child Warp editing uses its parent-input coordinate frame and visibly excludes ancestors while editing. Global preview does not enable direct dragging of child controls in final screen coordinates. No nonlinear inverse mapper is implied. Newly wrapped parents enclose child rest domains and authored/evaluated output control hulls.

A later Drawing relation may make an existing instance subset incomplete. This does not freeze or roll back the source or hide the whole instance: relationships crossing omitted layers and appearance channels that require them are suspended locally. Their keys remain intact, and the diagnostic explains any fallback to base selected-curve ink (including a possible formerly hidden closure). Adding the dependencies restores the relation. New incomplete subset operations are rejected before mutation, with a list and an explicit include-dependencies action.
