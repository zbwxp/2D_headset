# Triangulated recording work plan

Status: v50 published 2026-10-03 14:32 UTC with the triangulated Recorder, per-curve red coverage preview, automatic extreme/mirror snapshots, and Drawing-to-Recording layer references. Bounded human QA passed on the bundled full front. Independent property responses, source deletion consistency and reverse Drawing reference editing are the next candidate. Full topology editing, parent-split propagation and inside-coverage real-snapshot insertion remain unfinished. See the [acceptance matrix](editor-unification-acceptance.md) for implementation boundaries.

## Three editing responsibilities

- A layer owns stable element references, its internal relationships and ordering, and geometry edit intents. A batch addresses several layers through the same edit transaction.
- A snapshot owns its ordered layer references, local membership/state changes, and cross-layer relationships. It may have **one** `parentSnapshotId`; a layer's source address is provenance, not another snapshot parent.
- A recorder owns real angle-snapshot vertices, their interpolation connections, and inverse-response correction frames. A correction frame is never a snapshot or a triangulation vertex.

Existing source documents and working copies remain explicit compatibility adapters. Existing uploaded files and recording data remain recoverable. This work does not claim that all legacy fields disappear.

## Layer membership and clipboard

An original layer owns its members. A referenced layer follows the live source membership, with optional `addElementIds` and `excludeElementIds`. A locally authored element gets a fresh canonical ID and a visible provenance warning if absent from the parent. Deleting an inherited element excludes it only from the current snapshot; it does not delete the source element or its saved response data.

The shared session clipboard stores layer addresses. “Take reference” (the current cut action) does not remove anything. Reference paste preserves element identities and source linkage across Drawing and Recording. Independent duplication is a separate action that allocates new IDs. A project change clears the clipboard; room and snapshot changes do not.

Layer-internal order and depth offsets retain their source context when referenced. Snapshot layer order is independent. A missing old offset target is diagnosed or inactive, never reinterpreted as a different destination neighbor.

## Recorder geometry

The recorder will store a stable angle mesh: real snapshot vertices, canonical oriented shared edges, and counterclockwise triangles. A vertex owns its `{id, snapshotId, angle}` binding; the snapshot has no authoritative angle. The existing snapshot angle is a legacy evaluation adapter only. Rebinding changes the recorder coordinate and coverage without editing the stored pose.

Initial construction has a deterministic cocircular tie-break. Inserting a real snapshot splits the containing edge/triangle without flipping unrelated saved diagonals. Deleting a point removes its incident coverage and can leave holes; loading never regenerates deleted automatic points. Outside actual coverage, preview projects to the closest point in the covered triangle/edge union, shows all preview lines red, and displays both requested and evaluated coordinates. It does not select a nearest snapshot or extrapolate. Writes at that out-of-range cursor are disabled rather than silently committed to the projected boundary.

Presence is determined from the **original geometric barycentric coordinates**:

- At a vertex, use that snapshot's membership.
- On an edge, a curve must exist in both active endpoint snapshots.
- Inside a triangle, it must exist in all three active snapshots.

Hidden curves still exist. Response weights, including signed or overshooting weights, never change the presence support set. Missing relation dependencies disable only the affected fill/link/route with a diagnostic; they do not create missing geometry or block unrelated curves.

The 13:27 clarification adds **per-curve out-of-coverage preview**. A curve's valid coverage contains only mesh triangles/edges whose active vertices all contain that curve, plus its own real sample vertices. Outside that coverage, project onto its closest valid triangle, edge or vertex and show that curve's sampled full cubic in red. A curve existing only at yaw 60 therefore stays at its yaw-60 shape, red, at other coordinates. This preview does not change membership, add a sample, or substitute nearest-snapshot geometry for normally supported curves. Different out-of-range curves may use different projected coordinates; their preview cubics remain separate from the authoritative shared-node document so incompatible fallback positions cannot silently rewrite a real link.

## Geometry responses

Nodes keep one stable authority across real endpoint links. Handles are represented relative to their resolved node, `H - P`. X and Y responses are independent. The default is barycentric geometry interpolation. Edge responses are stored once and reused by every adjacent triangle; triangle interpolation extends them continuously so an existing nonlinear edge does not acquire a discontinuity.

At an interior inverse edit, the solver chooses the weight vector nearest the original geometric barycentric weights, subject to sum-one and the requested scalar coordinate. At an edge it reduces to the existing two-endpoint solver. Equal or numerically indistinguishable basis coordinates cannot express a different target on that axis. Such operations fail atomically with a specific target/axis diagnostic; they never create hidden geometry keys.

Correction samples store response constraints, not new originals or pose snapshots. Current line, layer and multiselection tools all produce desired control targets and use the same atomic resolver. Explicit SMOOTH/link constraints are replayed and checked after solving. The default interpolation and inverse correction share the same sampler with full-curve onions.

## Automatic extreme points and mirror edits

Only yaw columns at 0 and ±90 receive missing pitch ±90 placeholders automatically. Ordinary inserted positions such as yaw 60 do not create a full column. Placeholders are labeled and initially add no pitch geometry effect. Existing authored positions are not overwritten.

The positive yaw extreme uses an explicit mirrored editing transaction from the negative extreme. Paired left/right identities and orientation are exchanged through their semantic correspondence, while unpaired self-corresponding geometry retains identity. Names and nearest geometry are not identity mappings.

Automatic fill, mirror updates and split propagation use ordinary undoable edit transactions and the existing single-parent/update plumbing. They are not another snapshot category or a separate geometry authority. Their provenance records are update evidence only.

## Migration and real snapshot insertion

Migration operates on a new editable recording copy and preserves the original. Existing canonical geometry IDs, channel keys, drafts and response constraints are retained. An old endpoint-pair response belongs to the corresponding new oriented edge. Legacy keyed interpolation is not silently claimed equivalent to a new final-control barycentric surface; changed behavior requires an explicit diagnostic and recovery path.

Creating a real angle snapshot captures its current pose and membership and changes the recorder topology. It is distinct from authoring an inverse correction at the same coordinate. Splitting an existing response must preserve the prior trajectory where representable. A zero re-normalization denominator with nonconstant interior motion is not representable by a simple new two-endpoint weight; insertion must diagnose this before committing rather than discard the old correction.

Deleting a real view similarly checks affected edges, triangles and responses. Orphaned corrections are retained and reported; they are not silently moved onto an unrelated new connection.

## Parent curve splitting

Splitting a parent curve allocates descendant IDs once, records the original curve, children and material split parameter, and applies that lineage to every inheriting pose. Existing deformed geometry is split at the same parameter, with response/material references remapped where mathematically valid. A split in only one child snapshot is local membership change and breaks that old interpolation correspondence with a warning. No wholesale child-deformation reset is allowed.

## Bounded implementation stages

1. Shared membership/reference transactions and strict active-simplex presence; pure stable triangulation and response math, with focused tests.
2. Persisted recorder mesh and shared geometry sampler; old-pair copy migration, exact-vertex/edge regressions, and ordinary edit transaction routing.
3. Automatic missing extreme points, semantic mirror updates, shared clipboard UI, real-snapshot creation/deletion, and local topology authoring entry points. Drawing reference paste must consume the same evaluated snapshot context rather than baking a composite into source originals.
4. Parent-split lineage propagation and difficult migration diagnostics, then bounded human interaction QA on the deployed test Site.

No GPU rewrite, unrelated tool expansion, private archive upload, or original Site publication is part of this work. Performance measurements must separate CPU sampling, material/paint work and actual browser response.

## Recorder property responses

Independent properties belong to the Recorder, not to additional geometry snapshots. An interval start/end constraint at 30° does not add a triangulation vertex or author positions/scale. Scalar properties reuse the geometry response module's shared simplex orientation and piecewise-linear edge field. A collapsed HIDE range remains exact zero length through a zero-response plateau. Main material evaluation applies the property field after geometry sampling; full-curve onions intentionally omit the clipping stage. Display booleans, domain transforms and interval endpoints are distinct typed properties; only interval endpoint integration is in the next candidate.

Source-owned deletion removes the live canonical asset and dependent references so red coverage preview cannot resurrect it. Deleting curves retains their empty layer; deleting an owned layer removes its contents and referencing slots. Removing a reference or excluding inherited geometry remains local to that snapshot. Original upload/recovery evidence is not rewritten.
