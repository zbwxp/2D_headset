# V0.12.1 — Mirror & Arc Joins

Scope: Drawing Room only. HeadSet geometry and Recording Junction/Smooth are unchanged.

## Mirror Edit

- Activating Mirror Edit shows an orange dashed vertical axis. Drag the axis horizontally or enter `Mirror axis X`; `Center mirror axis` restores X=0.
- First click selects the source and shows its reflected preview. Second click writes the target, preserving existing related-selection guards.
- Reflection is `x' = 2 * mirrorAxisX - x`. Moving the axis does not change curves until a mirror edit is performed.
- Axis drags commit once on release. Escape cancels a drag. Axis position persists as optional `DrawingDocument.mirrorAxisX` (default 0), with Undo/Redo.
- Guides are hidden in clean preview and outside the Mirror tool.

## Arc Join

- A third bound-endpoint join mode, alongside Smooth and Cusp. Two endpoint clicks share position and establish `TangentJoin.mode = ARC`.
- Binding translates the moving endpoint and its adjacent handle as before. ARC does **not** rotate either raw source handle. Existing Smooth/Cusp behavior is unchanged.
- The requested `radius` is an **influence distance along each source curve**, measured from the shared node. UI uses nominal drawing pixels (250 px per document unit), default 20 px, range 0.25–500 px. It is not a fixed circle radius at every corner angle.
- At each trimmed endpoint, use the current source tangent. An equal tangent-distance biarc connects the cuts with G1 continuity at both source contacts and at the middle join. Straight corners give a circular fillet. Curved sources generally require two tangent circular arcs.
- Circular arcs are rendered using cubic approximations, at most 90° per piece. The joins retain tangent continuity; this is not a general G2 curvature-continuity promise.
- Raw node/handles remain editable. The derived display is `trimmed source + circular pieces + trimmed source`; no new Curve or Path asset is created.
- A faint original source guide and influence circle remain available while editing. Clicking the rounded segment with Direct Select reveals its joint's radius controls.
- Radius drags create one Undo transaction; the numeric field supports exact values. Radius, mirror axis, and ARC joins survive Save/Load.

## Consumers and limits

- `roundedJoin.ts` computes the derived curves. Stroke path, width profiles, fills, offset followers and hit testing use the same derived pieces.
- A whole derived stroke uses one continuous profile; the circular pieces do not restart the profile.
- If both endpoints of a source have ARC joins, their requested distances share available source length. Oversized requests are clamped with an explicit UI message; raw geometry remains intact.
- Coincident cuts, degenerate tangents and reversing arcs report an invalid-arc diagnostic and retain the original position-bound geometry. No silent repair is written to source handles.
- Splitting is allowed on retained source segments. Splitting a derived arc or removed source segment is rejected. A split that would expand another previously clamped transition is also rejected to preserve exact-split semantics.
- Removing the join returns to position binding. Unbinding follows existing shared-node rules. Duplication remaps join endpoints; whole-stroke uniform scaling also scales the influence distance.
- Saved Drawing document version remains 2 with optional mirror position and ARC-specific radius validation. Existing v1/v2 documents load without new required fields. Old app binaries cannot interpret new ARC joins.

## Verification

- 47 targeted unit tests passed (Drawing domain, appearance, ARC geometry, translations).
- 16 browser scenarios passed across Drawing, Stage 4, and this feature: axis numeric/drag/preview/cancel, two-click creation, handle edits, radius drag Undo/Redo, join conversion, diagnostics, clean preview, Chinese labels, save/reload, existing fill/offset/profile and authoring interactions.
- Full-suite run retained the five known pre-existing failures; two additional concurrent geometry-test timeouts passed on isolated rerun (head-frame and on-patch-group, 55 tests passed with the then-current Drawing tests).
- Production build passed. Existing large-bundle warning remains.

Before-change snapshot: `artifacts/drawing-arc/V0.12.0-before-arc.tar.gz`.
Visual checks: `artifacts/drawing-arc/arc-controls-zh.png`, `arc-preview-zh.png`, `mirror-axis-zh.png`.
