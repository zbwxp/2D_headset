# Local Recording membership and exact canonical-ID presence

Status: local membership production helpers, schema/parser checks, reference
resolution and Recording API commands are implemented. The active-simplex
presence helper, clipboard transport and explicit-target reference paste are ready for integration. UI, shared
clipboard state, and the new Recorder runtime remain owned by separate work.
The earlier 1D nearest-sample prototype has been removed, not wired to runtime.

## Current authoritative ownership (13:11–13:24)

- A snapshot owns geometry/residual state, membership and its layer array order.
  It has at most one semantic `parentSnapshotId`. That field is integrated by the
  main model owner, not this membership patch
- A Recorder vertex owns angle binding: `{id,snapshotId,angle}`. Existing
  `Snapshot.angle` is a legacy compatibility field, not the new authoritative
  angle. Rebinding a vertex must not rewrite the snapshot's geometry
- Cross-artwork layer paste adds a source/provenance address. Existing layer
  `baseSnapshotId/baseLayerId` remain compatible source addresses and must not be
  interpreted as multiple semantic snapshot parents
- Real Recorder vertices participate in one stable shared 2D triangulation.
  Correction frames never become snapshots, vertices or membership samples
- Presence is the intersection of memberships at the located simplex vertices
  with nonzero ORIGINAL geometric barycentric weights. The interior uses three,
  an exact edge two, and an exact vertex one. Corrected interpolation weights
  do not alter membership. There is no global same-ID search or missing-vertex
  bypass; real 45 lacking an ID prevents that ID on adjacent cells/edges
- Yaw 0/±90 can generate pitch ±90 placeholders; yaw −90 has the specified mirror
  relation to +90. Automatic points stay live through ordinary inheritance/edit
  transactions. They do not create another derived-snapshot category or engine
- Three-vertex inverse correction follows the agreed minimum change from the
  original geometric barycentric weights. This file does not implement inverse
  correction, triangulation, pole generation or mirror behavior

These decisions supersede the earlier segment-only design discussion retained
below. Scalar restriction/procedural alternatives remain historical analysis,
not permission to introduce an extra runtime or hidden geometry authority.

## Implemented membership/API contract

`createLocalCurve {layerId,shape,width?,name?,ref?}` creates one fresh canonical
curve and two nodes in layer-input coordinates, before local Warp, shape and
placement. `excludeElements {layerId,elementIds}` removes local additions or
adds inherited exclusions. `restoreElements {layerId,elementIds}` removes only
exclusions. All three currently target a reference layer. The existing facade's
legacy saved-angle gate remains until the new Recorder owner replaces it with
vertex-binding validation. No cursor-space drawing gesture is connected yet.

`applySnapshotMembershipEdit(workspace,targetSnapshotId,command,fresh)` exposes
the same operations for a caller-owned transaction draft without selecting or
requiring an active Recording. A Drawing/sculpt wrapper must supply a verified
real snapshot target and a fresh-ID allocator. The helper never changes the
Drawing adapter's owned originals or adopts local IDs into `originIds`.

A `LOCAL_ORIGINAL` diagnostic is nonfatal. Independent local geometry resolves
even when its referenced source snapshot/layer is missing. Local exclusion
keeps source geometry, library records, dormant response data and archive intact.
The source-membership refresh still carries later source additions live.

`resolveSnapshotSimplexPresence({snapshotIds,geometricWeights},memberships)`
accepts the structural output of the shared locator and returns active snapshot
IDs and their membership intersection. It has no angle search or corrected-weight
parameter. It uses exact zero only, including nonzero subnormal weights. The
triangulation owns robust predicates and vertex/edge classification.

## Concrete file ownership and Drawing adapter plan

This task owns the membership-only hunks in `model.ts`, `persistence.ts`,
`validation.ts`, `evaluation.ts:inputForSnapshot`, and the three command entries
in `commands.ts`, plus `localMembership.ts`, `referenceClipboard.ts`, this report
and `local-membership-contract.test.ts`. It does not own graph fields, semantic
parent fields, angle binding, mode dispatch, endpoint compatibility, UI, source
migration, or new triangulation/response algorithms. Coordinate the remaining
common imports/type unions when merging shared files.

The minimum safe cross-mode Drawing integration is:

1. Share one session clipboard containing canonical source snapshot/layer
   addresses and reference/duplicate intent. `captureDrawingLayerClipboard`
   translates raw Drawing layer IDs through the existing adapter's `originIds`;
   it does not ingest or clone geometry. `planSnapshotClipboardPaste` preserves
   the captured source address and explicit destination snapshot
2. `prepareSnapshotReferencePaste(workspace,{targetSnapshotId,sourceSnapshotId,
   layerIds?},fresh?)` now produces a pure candidate workspace, created/reused
   slots and diagnostics. `pasteLayers` delegates to it for the active Recording;
   Drawing can call it with its source snapshot directly, without switching the
   Recording. Commit the candidate through the shared snapshot transaction.
   Exact repeated source addresses are no-ops preserving the slot's local state;
   conflicting branches/cycles produce an atomic blocked result, not broken data
3. Store pasted reference slots on the Drawing source snapshot in
   `recordingSnapshots`. The existing original-source sync preserves non-owned
   slots, and the snapshot-state transaction permits those slots without
   modifying Drawing-owned originals
4. Give Drawing a transient evaluated composition for render, picking and layer
   rows. Keep its raw owned source document as the original-edit adapter.
   Do not pass the composed drawing to `commitDrawing`, `importArtworkLayers`,
   `prepareOriginalState`, or `upsertDrawingSource`: those routes would bake or
   re-scope the referenced geometry into a new original
5. Route edits by ownership: owned original changes use the source adapter;
   reference membership/placement/local shape changes use snapshot transactions.
   Until a particular reference edit has an explicit local transaction, expose
   it as unavailable instead of forwarding it to raw Drawing commands
6. Resolve delete by current local membership. Preserve source layer item order,
   relation definitions and legacy depth context. Neither a mode switch nor a
   snapshot switch clears the shared transport. A project change does

Tests now exercise actual membership API/ownership transactions, Drawing
capture/destination planning, reference paste into a Drawing source, one shared
`prepareSnapshotEdit` commit, and serialized reload with live source updates. Shared session state and Drawing composed-view
render/edit routing still need end-to-end integration; this report does not claim
that pasting in the current Drawing UI is already implemented.

## Additive membership contract

Keep the canonical library as the only original geometry store. Local membership
can be an additive extension to workspace version 2. The segment-graph schema's
version/migration remains a separate explicit decision. Extend a reference layer
with this optional field:

```ts
membership?: {
  addElementIds?: string[];
  excludeElementIds?: string[];
}
```

Original layers continue to own their ordered `items`. Reference layer membership
is `(live parent items + ordered local additions) - exclusions`. Omission is full
live inheritance, so every old file retains its existing behavior. Later source
members arrive automatically unless that exact canonical ID is excluded. The
same ID cannot be both added and excluded. Nodes are dependencies of curves,
not independently listed layer members.

A locally drawn original receives fresh curve/node IDs in `workspace.library`.
Only the current layer gains membership. The Drawing adapter's `originIds` must
not adopt those new IDs. It already refreshes only its own originals; its source
sync retains independent library records. Existing canonical geometry must
never be overwritten to create a local variation.

Deleting an inherited member creates a local exclusion, including when its
source temporarily disappears. Deleting a local addition removes that addition.
Neither operation deletes the parent, canonical library data, existing residual
channels, response knots, or recovery archive. Dependent fills, offsets and
relations become inactive when their required curves are absent; retain their
stored definitions for restoration and Undo.

A local original with no corresponding parent is allowed. Its provenance begins
at the current snapshot (`sourceSnapshotId=current`, `path=[current]`). Add a
dedicated nonfatal diagnostic, rendered red, to explain that it has no parent
original. Do not reuse `MISSING_ELEMENT` as a hard creation failure. A reference
whose parent is missing must still resolve its independent additions, while
retaining the missing-parent diagnostic.

## Historical 1D design discussion, superseded by shared 2D presence

Presence belongs to resolved structural membership at real angle snapshots.
`visible`, `inkVisible`, layer display toggles, sparse shape-track key counts, and
inverse correction knots do not determine presence. Equal names or geometry
never connect different canonical IDs. A correction at 60 changes an existing
edge's interpolation; it adds no snapshot, membership, canonical identity, or
pose sample.

To add a line at 60, the user explicitly creates a real snapshot at 60. That
operation replaces the active 0→90 connection with 0→60 and 60→90 connections.
The new snapshot captures the existing evaluated pose without cloning canonical
curve IDs. A new line then belongs only to snapshot 60 and appears exactly
there. Pasting a reference to that same ID into snapshot 90 gives the 60→90
connection two matching endpoints, enabling interpolation over that segment.

- One genuine membership sample: exact-coordinate presence only
- Shared same-ID endpoint membership: interpolate inside an enabled supported
  segment, never beyond that segment
- Hidden geometry remains structural membership; visibility is a separate
  channel, and missing is not a hidden value
- A Recorder connection is explicit data. A per-element nearest-sample search
  must not invent a connection that bypasses an intervening real snapshot
- Two-dimensional surfaces, overlapping connections, alternate branches, and
  duplicate real snapshots at one coordinate need explicit selection/validation
  rules; none is settled by the prototype's one-dimensional search

The formerly open real-45 absence rule was resolved by shared 2D presence:
only the located simplex's nonzero geometric vertices participate. A real middle
snapshot lacking an ID is not skipped. The old sample-skipping helper and its
assertion have been replaced by active-simplex tests.

Historical proposal, superseded at 12:54: the earlier text said "Never create an
interior basis" and deferred more than two real snapshots to an eventual general
view system. That restriction is withdrawn. Explicit creation of a third real
snapshot is the required operation; the endpoint-pair Recorder must be promoted
to a segment graph/chain rather than reject the third snapshot. Ordinary track
recordings and their historical keys still require preservation, not automatic
conversion or deletion.

## Historical segment-only field proposal (not the current 2D schema)

The following names are a reviewable schema proposal, not implemented fields.
They separate ownership while allowing a first implementation to restrict the
graph to an ordered one-dimensional chain.

```ts
// RecordingSnapshot remains a real pose. Do not add kind:'correction'.
interface RecordingSnapshot {
  id: string;                 // existing stable ID
  angle: Angle;               // legacy only; new Recorder vertices own angle
  layers: SnapshotLayer[];     // actual membership and layer order
  deformation: SnapshotDeformationState;
  relations: SnapshotRelationOverrides;
  // Optional provenance for explicitly captured/re-rooted evaluated poses.
  poseOrigin?: {
    segmentRevisionId: string;
    progress: number;
  };
}

interface RecordingSegment {
  id: string;
  startSnapshotId: string;
  endSnapshotId: string;
  axis: 'x';                  // expand only with a defined coordinate domain
  responseAssetId: string;
  enabled: boolean;
  derivedFrom?: {
    segmentRevisionId: string;
    progressRange: [number, number];
  };
}

interface RecordingResponseAsset {
  id: string;
  evaluator:
    | {kind:'scalar'; controls:SnapshotEndpointResponses}
    // Optional richer model requiring explicit approval; not an automatic fallback.
    | {
        kind:'restricted';
        segmentRevisionId:string;
        progressRange:[number,number];
      };
}

interface RecordingCorrectionFrame {
  id: string;
  segmentId: string;
  angle: Angle;
  // Metadata/index of response constraints, not another geometry authority.
  responseAssetId: string;
  controlIds: string[];
}

interface SnapshotRecording {
  id: string;                 // preserve existing recording ID
  snapshotIds: string[];       // real snapshots only
  segments: RecordingSegment[];
  responseAssets: RecordingResponseAsset[];
  correctionFrames: RecordingCorrectionFrame[];
  activeFrame?:
    | {kind:'snapshot'; snapshotId:string}
    | {kind:'correction'; segmentId:string; angle:Angle};
  correctionDraft?: {
    segmentId:string;
    angle:Angle;
    responses:SnapshotEndpointResponses;
  };
  // Retained immutable evaluator lineage, never a second active edge.
  segmentRevisions?: RecordingSegmentRevision[];
}
```

The `restricted` evaluator and `poseOrigin` are richer design options, not an
approved implicit residual mechanism. A minimal scalar-only implementation can
omit them and refuse a conversion it cannot represent exactly. A proposed
`RecordingSegmentRevision` needs immutable response-evaluator references and
the old endpoint/provenance domain sufficient for exact restriction. Whether its
source geometry references remain live or bind to source revisions is a material
open decision described below. A new 60 snapshot must not depend on an active
segment that in turn references 60; the retained pre-insertion revision makes
that dependency acyclic. `controlIds` and correction markers are derived/index
metadata; response assets remain the sole scalar-function authority. Correction
drafts do not create saved frame geometry or ordinary track keys.

Current-to-proposed mapping:

- `endpointPair.startSnapshotId/endSnapshotId` → first segment's endpoints
- `endpointPair.responses` → one scalar response asset, preserving all values
- `endpointPair.draft` → Recorder correction draft with that segment ID
- `recording.snapshotIds` → same existing real snapshot IDs, plus explicitly
  created snapshots only
- `recording.activeSnapshotId` → snapshot selection within `activeFrame`; an
  interior cursor uses a correction frame, not a fabricated active snapshot
- Existing `tracks`, interpolation assets, archives and endpoint original data
  remain intact; introducing `mode:'segments'` or a schema revision requires an
  explicit adapter and round-trip tests

Promotion of an existing 0/90 pair retains recording and snapshot IDs, response
values and any already identified response assets. Assign new IDs only to newly
introduced graph/asset containers and the explicitly created snapshot. Never
clone the endpoint snapshots or canonical curves as an incidental upgrade. Keep
the old segment evaluator in revision lineage when splitting its active edge.

## Historical 1D restriction math and representability cautions

For an existing scalar response `r(t)` on 0→90, inserting real snapshot 60 has
`a=2/3` and captures the current final control value `q(a)` once for the new pose.
The intended restricted paths are the exact old paths on `[0,a]` and `[a,1]`,
not two new linear interpolations. For each independently represented node
coordinate or endpoint-relative handle-vector coordinate, normalizing responses
would give:

```text
left response(u)  = r(a*u) / r(a)
right response(u) = (r(a+(1-a)*u)-r(a)) / (1-r(a))
```

These formulas apply only when the respective endpoint coordinate delta is
numerically available. Restrict and remap all existing knots, retain signed and
nonmonotone responses, and verify exact endpoint and old-knot evaluations. An
overshooting or returning path may have zero new endpoint displacement while
still moving inside a subsegment. No scalar response between equal endpoints
can express that path. Existing endpoint-only correction explicitly rejects
unavailable zero-delta axes and has no hidden residual geometry, so conversion
must not silently introduce a different model. There are two honest choices:

1. Minimal scalar-only path: atomically refuse exact Create60 conversion when
   any coordinate or dependent channel is unrepresentable. Leave the original
   0→90 edge, snapshots, responses, membership and archive untouched, and report
   the specific unavailable coordinate. Do not leave a partial 60 snapshot.
2. Explicit richer model, pending a user/root decision: retain a restricted
   old-edge generator with visible provenance and its full dependencies. A
   nominal 0→60 subsegment may still depend on the old 90 endpoint through that
   generator. The UI/API must disclose this; it must not masquerade as an
   ordinary response controlled only by 0 and 60 or store hidden residuals.

A diagnostic alone never justifies dropping the old motion or deleting its
data. Constant zero-delta coordinates are harmless. Unresolved
ARC constraints and nonlinear material transport must also be checked against
the old evaluator, not assumed to commute with response normalization.

The actual pose at 60 needs a verified re-rooting representation. Existing local
residual state can be used only when it represents the pose exactly in its
declared domain; retained evaluator provenance is an additional model choice,
not automatic permission to introduce a procedural pose. Neither route copies
canonical originals. Existing `inheritedState` is a residual fallback, not a
container for baked world-space geometry. It cannot simply accept the evaluated
drawing. A failed exact re-root must leave the original graph untouched.

Mixed-source and future-edit risks must be settled explicitly:

- The same canonical ID can reach 0 and 90 through different saved parent
  states. A single nearest parent at 60 would lose one branch's provenance or
  change shape when source updates arrive
- Capturing final coordinates as new canonical originals would duplicate live
  geometry authority and destroy same-ID correspondence
- A retained old segment that reads live endpoints preserves source updates but
  may also make the newly captured 60 pose change after later 0/90 pose edits;
  freezing every endpoint/source value would instead stop expected live sync
- The new 60 pose, its later direct edits and the two restricted edges need an
  explicit dependency policy. Preserve source ancestry and record residuals in
  a declared coordinate domain; do not silently reparent any identity
- Membership at insertion must reflect the evaluated scene under the agreed
  exact/segment presence rule. A one-sided endpoint-only member must not be
  cloned into 60 merely to make topology sets match

Approval of the overall graph structure does not establish these unresolved
source-update and exact-membership policies. Runtime integration remains paused.

## Runtime integration boundaries

1. `model.ts`, `persistence.ts`, `validation.ts`: add the optional field and
   strict parsing, limits, unique IDs and disjoint addition/exclusion validation.
   The existing parser rejects unknown fields, so the helper alone is not a
   persistence implementation. Add old/new JSON round-trip and archive tests.
2. `evaluation.ts:inputForSnapshot`: derive effective membership before copying
   parent geometry; resolve local originals from the library separately and
   preserve parent membership/provenance. Missing parent handling must no longer
   skip the independent additions. Filter relations/dependencies without
   deleting their stored state. Existing immutable cache keys include layers;
   every membership edit must replace affected layer/snapshot objects.
3. `endpointPair.ts` and the proposed segment evaluator: preserve the existing
   pair through an adapter, then relax complete-set equality only. Continue to reject
   conflicting topology of the same shared curve, fill, offset or relation.
   Build dependency-valid common-ID geometry for interior frames, including
   pruned linked-node authority and material routes. Do not read absent end
   nodes/curves through non-null assertions. Exact drawings remain unchanged.
4. `evaluation.ts:evaluateEndpointPair` and its segment successor: check presence
   before progress clamping
   so an out-of-range query cannot acquire a singleton endpoint. Preserve
   original requested angle, basis/correction distinction, cache invalidation,
   one-sided endpoint onion geometry, and all dormant response data.
5. `commands.ts`: add separate explicit real-snapshot insertion, segment
   connection editing, and local create/exclude/restore commands at real views.
   Correction-frame editing modifies only the selected segment's response asset.
   Promote the two-endpoint guard to graph validation; do not reject explicit
   third-snapshot creation or create one during an inverse gesture.
   Validate complete batches atomically through `recordingSnapshotApi.ts` and
   the existing `prepareSnapshotEdit` transaction. Keep
   `assertOriginalsUnchanged` and its archive guard. Add the new commands to
   pair/segment-basis mutation checks. Control-response targets must exist at both
   endpoints; missing basis support gets a clear diagnostic, not invented data.
6. Creation coordinates need a declared domain: the current shape edit stage is
   post-Warp and pre-placement. Raw final cursor coordinates stored as original
   controls would run through the layer pipeline again. Invert supported stages
   and replay the transaction to verify the requested final controls, or create
   in an explicit local original layer with its own undeformed domain. Missing
   parent provenance alone must never be used to block drawing.
7. Wire session clipboard and Recording add/delete UI only after these domain
   checks pass. Source editing, Undo/Redo and reload must retain local IDs,
   exclusions and their warnings.

## Clipboard semantics

One session-level transport shared by Drawing and Recording stores project ID,
source snapshot/layer IDs, and intent. Switching rooms or saved views does not
clear it. A project change does. Capture stores addresses, never baked geometry,
and makes no source edit.

The user's cut action means reference capture. Paste appends a live same-ID
reference using `pasteLayers`, never `moveLayers`. Explicit delete is the only
operation that removes current membership. Existing explicit independent-copy
or duplicate intent continues to use `cloneLayers` and fresh IDs. Do not silently
turn an existing independent-copy action into a reference action. Preserve the
captured source snapshot relationship; do not replace it with that snapshot's
ancestor. Reject a conflicting duplicate canonical branch rather than silently
reparenting, cloning, or changing the source. An identical already-present
reference may become an explicit no-op in the UI command adapter.

`referenceClipboard.ts` is a pure capture/command-plan prototype. It is not yet
a session store, and existing Drawing and Recording React-local clipboards must
be replaced during integration. Existing Drawing object-cut behavior should not
be reused to implement layer reference capture.

## Layer and element ordering

The destination snapshot owns its own layer array order. Pasting selected layers
does not import the source snapshot's complete layer ordering. Within a pasted
layer, preserve `items`, grouping, stroke relationships, `depthOffset`,
`depthScope`, and `localPaintOrder` verbatim.

Beware: legacy `depthScope=PARENT` is not necessarily layer-local. A standalone
curve falls back to source layer siblings, as does explicit `LAYER`. Therefore
re-evaluating old numeric offsets against the destination layer array can target
unrelated new layers. The existing `snapshotPaintBatches` intentionally resolves
the offset in its original source context, then maps target canonical IDs into
the assembled frame. Keep that compatibility for old data.

Internal collar interleaving remains attached to its layer. A legacy cross-layer
target not included in the paste stays dormant, retaining its offset and source
target; add a diagnostic rather than silently choosing a new destination
neighbor. Do not clamp and persist a replacement offset during extraction.
Local originals in a mixed original/reference view require their own layer
context because `materializeOriginalSnapshot` currently returns undefined for
that mixed view. Any eventual durable target representation must preserve old
source-context meaning and distinguish within-layer targets from cross-layer
targets; this phase does not rewrite existing offsets.

## Executable evidence

The focused suite now covers real membership API transactions, canonical source
ownership, missing-source local originals, local exclusion/restoration, JSON
validation and reload, unchanged historical keys/archive, source live additions,
active geometric vertex/edge/triangle intersection, subnormal geometric weights,
absence at an intervening real vertex, independence from corrected weights,
Drawing raw-ID capture, explicit paste destination, same-ID live reference paste,
explicit independent duplication, idempotent reference paste, atomic source
conflicts/cycles, collar interleaving and missing legacy depth
targets. Existing snapshot-domain and shared transaction suites also pass.

Verification is recorded in the task handback after the final focused run and
TypeScript check. This is domain/API evidence, not browser/UI acceptance.

## Split lineage: planned extension only

The split contract is a separate topology operation, not a shortcut through
local create/delete. A source split allocates its complete child ID map once.
Both 0/90 descendants inherit those same canonical IDs. Persist a lineage
record describing the original curve ID, ordered child curve IDs, shared split
node ID, material `splitT`, source snapshot, operation identity, and the IDs of
derived relations/material tracks/ranges. Keep the original curve and original
pose/response data recoverable. Do not silently reuse a geometrically different
curve identity or discard the old correspondence.

The current `drawing/commands.ts:splitCurve` mutates the old ID into the first
child and allocates a second curve, split node and join on each call.
`splitDisplayIntervals` also allocates child interval/range IDs. Repeating these
functions independently at each endpoint therefore cannot implement shared
lineage. Refactor an ID-supplied split planner/replayer before integration;
preserve ordinary Drawing split compatibility through an explicit adapter.

For an inherited source split, evaluate each descendant's existing old curve
with its saved deformation first, then split that cubic at the same source
material parameter. Never replace it with undeformed source child geometry,
clear old deformation, or mint another set of child IDs in that descendant.
Apply any later child-local edits after the inherited split result. Repeated
splits compose a lineage tree whose parameter maps remain explicit.

A split performed only in a child view excludes the old curve locally and adds
new local children there. It leaves the parent and other views unchanged. Show
an explicit correspondence warning: those new IDs have not become shared
samples of the old curve. Source lineage and child-local lineage must not be
conflated merely because the split positions happen to match.

Response migration must prove representability. De Casteljau is linear in the
four absolute control points. Apply that same linear map to the existing
angle-dependent control functions, and then derive child handle vectors from
child endpoints. Use the union of all original response knot coordinates. A
resulting child coordinate with nonzero endpoint delta can be normalized back
to a scalar response and replay-verified. A zero-delta child coordinate can
still vary at interior angles through cancellation of original controls; that
case cannot be represented by the current endpoint scalar form. A procedural
split evaluator referencing the original response functions is a richer design
option needing explicit approval and visible lineage. The minimal current-model
path atomically refuses the unrepresentable split/conversion while preserving
all original data. Neither path may drop knots, flatten the shape, or approximate
an unavailable inverse. Tiny or nonfinite deltas follow existing numerical
availability checks.

For interval/material migration, retain source-parameter spans and split their
parameter domains: left `u=t/splitT`, right
`u=(t-splitT)/(1-splitT)`. `splitRouteCoverage` is useful existing math, but its
left child currently retains the old ID and requires remapping to the new
lineage IDs. Preserve directional routes, endpoint brushes, range identities,
fills, offsets, joins and endpoint links through the one shared ID map. Normalized
arclength percentages must be transported through the evaluated child material
fields; they cannot generally be rescaled using `splitT` alone. Unrepresentable
or unresolved channels remain preserved with precise diagnostics.

Before runtime integration, specify how subsequent edits to the source children
compose with a retained procedural old-curve response. Storing two competing
live geometry authorities or baking all descendant frames is not acceptable.
The minimum tests are identical source-created child IDs at 0/90; exact split
reconstruction of each deformed basis and every correction knot; zero-delta
interior-motion preservation; local-only split exclusion; interval and reversed
route coverage; nested split lineage; Undo/reload; and archive/key retention.

The previously open new-curve-at-60 interaction was resolved at 12:54: the user
must explicitly create a real 60 snapshot before adding the curve. That splits
the Recorder's active 0→90 edge into 0→60 and 60→90, preserving the old trajectory.
A correction frame at 60 remains only an edge edit. This resolution is separate
from source/local curve splitting; neither prototype helper creates a real view
or pose key implicitly.

## Explicit-target reference paste handback

The pure helper does not mutate its input, active Recording, source snapshot,
canonical library or archive. Only a successful candidate's target layer array
receives new reference slots. It preserves the existing dependency-closure check
and relation behavior. The runtime command adapter delegates only `pasteLayers`;
`cloneLayers` and legacy explicit `moveLayers` remain unchanged. Nonfatal
`ALREADY_REFERENCED` diagnostics identify reused slots, and `blockedCode` means
callers must retain the original workspace.

Explicit `cloneLayers` now creates a [current-shape independent copy](../current-shape-independent-copy.md): selected local additions and the currently evaluated inherited members receive fresh canonical IDs in one new ownership root. Excluded members and source tombstones are not part of that root. Current geometry, groups, links, paint and material are preserved; saved residuals and former parents are not replayed. The copy retains only the affine material representation needed to preserve exact ARC and interval appearance. JSON/evaluation verification rejects any unsupported case atomically with affected object diagnostics.
