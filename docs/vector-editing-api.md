# Local structured vector editing API

Current release: v19 / `1559770`, API 2.0, published 2026-10-02 at 05:17:48 UTC. Recording uses the [independent scene API](recording-scene-api.md); the initial browser workflow acceptance passed within the scope recorded in [release validation](recording-scene-release-validation.md). Source commands retain the Drawing-only contract below.

`window.contourAI` exposes source-vector inspection and bounded JSON commands in the local app. The API does not connect to a service, accept credentials, execute supplied JavaScript, or switch workspace modes. It is an editing interface for a future image-guided assistant, **not an automatic image-to-vector matching solver**.

Module: `src/app/vectorEditingApi.ts`. Integration calls `registerVectorEditingApi()` once; its return value unregisters that instance. Tests and local integrations can call `createVectorEditingApi(host)` without a browser. The host must commit through the application's normal drawing transaction. The default host uses one `beginEdit` → `setDrawing` → `endEdit` sequence.

## Contract

Project/source/Recording operations except `help()` return one of the forms below. Transient `inspectView / view / snapView` intentionally omit project revision, as described in their separate contract:

```json
{"ok":true,"revision":"opaque-session-token:1","value":{}}
```

```json
{"ok":false,"revision":"opaque-session-token:1","error":{"code":"NOT_FOUND","message":"Unknown curve ID: missing.","commandIndex":1}}
```

- Treat revision as opaque. Send the latest inspection's revision as `expectedRevision` when editing, selecting, previewing, exporting, or undoing. Any observed project/source/library replacement, including inactive artwork working copies and UI editing, invalidates an older token. Tokens are local to this API instance, not saved in project JSON
- All source writes require **Drawing** mode. Recording-mode calls cannot alter nodes, handles, topology, layer contents or visibility. They return `MODE_RESTRICTED`; the API never changes modes to make a command succeed
- Inspection and source export remain available in Recording. `inspect().value.recording` may include a detached legacy rig archive, when present; use `inspectScene()` for the current recording state. Source SVG preview is explicitly a source-artwork preview, not recording evaluation
- Commands are sequential within a private draft. All commands, coordinates, source constraints and new derived-geometry diagnostics are checked before the single store transaction. A failed command, dry run, no-op or speculative preview creates no undo entry
- `undo()` / `redo()` use normal project history. In Recording, a history step that changes source artwork, saved source artworks, or retained working copies is rejected. These operations are not a separate API-private history
- Existing IDs are retained by ordinary edits; explicit creation/duplication returns fresh IDs and deletion reports removed IDs. Stroke IDs are derived anchors of connected components, not a second persistent topology
- Locks, hidden-member rules, linked endpoints and smooth tangent constraints use the same drawing commands as manual editing. A node move also moves its adjacent handles and linked nodes. A smooth handle move can move its partner handle. Changed IDs include those effects
- `allowRelated:true` explicitly permits related-curve effects for affine/four-corner transforms; it never overrides locks. Otherwise a partial connected selection can return `CONSTRAINT_VIOLATION` with `relatedCurveIds`
- Geometry edits transport display interval material positions using the existing drawing transport logic. Track/range IDs, direction and appearance are retained. Angle-specific visibility stays in recording data and is not a source command
- Width changes apply to the connected stroke, following the existing width command
- Bounds from inspection are exact cubic centerline bounds. They exclude width, mist, offsets and extensions and are not exact final-ink bounds

## Inspection and selection

```js
const api = window.contourAI;
api.help();
api.inspect();
api.inspect({layerNames: ["鼻部"]});
api.inspect({layerIds: ["canonical-layer-id"]});
api.inspect({curveIds: ["canonical-curve-id"]});
api.inspect({curveNames: ["上眼睑"], strokeNames: ["右眼外轮廓"]});
api.inspect({nameIncludes: "眼"});
api.select({curveIds: ["canonical-curve-id"], expectedRevision: revision});
```

Query filters are ANDed. Names return all matches; the API never guesses between duplicate names. Unknown explicitly supplied IDs fail. Missing names return an empty result. IDs returned by inspection are the authority for writing.

Inspection includes:

- Current mode, source capability, artwork ID, revision, selection, available canvas viewport
- Exact source `mirrorAxisX` (use reflection matrix `[-1,0,0,1,2*mirrorAxisX,0]`)
- Canonical absolute controls, node IDs, exact centerline bounds, layer and derived stroke membership
- Shared-node endpoint membership, linked-node IDs, touching joins and endpoint links
- Associated fills, offset-source relations, organizational groups and display intervals for selected strokes
- Reference-image name/dimensions/transform, but no embedded pixel payload
- Current derived geometry warnings; existing warnings do not silently prevent unrelated edits

Results are detached copies. Changing a returned object does not change the project.

## JSON command schema

`execute({commands, expectedRevision?, dryRun?})` supports:

```json
{"op":"moveNode","nodeId":"node-id","position":[0.1,0.2]}
{"op":"moveHandle","curveId":"curve-id","end":0,"position":[0.1,0.2]}
{"op":"transformCurves","curveIds":["curve-id"],"matrix":[1,0,0,1,0.02,-0.01],"allowRelated":false}
{"op":"deformCurves","curveIds":["curve-id"],"bounds":{"min":[-1,-1],"max":[1,1]},"quad":[[-1,-1],[1,-1],[0.9,1],[-0.8,1]],"allowRelated":false}
{"op":"renameCurve","curveId":"curve-id","name":"Upper eyelid"}
{"op":"renameStroke","curveId":"any-member-curve-id","name":"Eye outline"}
{"op":"setCurveWidth","curveIds":["curve-id"],"width":0.008}
```

- `end:0` selects the first handle, adjacent to `curves.nodes[0]`; `end:1` selects the second handle
- Coordinates are absolute source units, X right / Y up, including handles
- Affine matrix `[a,b,c,d,e,f]` means `x'=a*x+c*y+e`, `y'=b*x+d*y+f`. It must be nonsingular
- Four-corner order is bottom-left, bottom-right, top-right, top-left in source space. This calls the existing projective/cubic-fitting tool and returns `approximations[].sampledMaxError` in source units. That is a sampled fit error, not a certified maximum or image similarity score
- Positions and affine components are finite with absolute value at most 10,000; final source coordinates are checked again. Names are 1–256 characters. Width is greater than zero and at most 1. A batch has at most 1,000 commands. Unknown command names and extra fields fail
- Current commands deliberately preserve topology and layer ownership. There is no raw project replacement, curve deletion, mode change, reference upload, network call, or angle-visibility mutation endpoint

Success includes `applied`, `dryRun`, `changed`, changed `curveIds`, `nodeIds`, `displayTrackIds`, derived `affectedFillIds` / `affectedOffsetIds`, before/after bounds, approximation reports and diagnostics. A no-op has `applied:false` and no new history entry.

## Deterministic preview and export

```js
api.preview({width:800, height:800, showFills:true, expectedRevision:revision});
api.preview({commands, width:800, height:800, expectedRevision:revision});
api.exportSource({expectedRevision:revision});
api.exportSource({includeReference:true, expectedRevision:revision});
```

`preview()` returns `svg`, media type, viewport, source bounds and diagnostics. It renders the actual `PaintScene` pipeline, preserving fills, cutouts, depth order, intervals, stroke appearance and existing mist effects. Editing overlays and the reference image are excluded. It does not write to the document. Supplying commands previews the validated draft without committing.

The default viewport fits source centerlines with padding; extended ink or unusually large fill effects may need an explicit `center` and `pixelsPerUnit`. Supply the same viewport settings when comparing before/after images so auto-fit cannot hide a positional change. Returned SVG is deterministic for the same document, options and rendering environment.

Full mist-fill rendering uses the existing Canvas/Path2D pipeline and works inside the app browser. In a headless environment without those APIs it returns `BROWSER_REQUIRED`, not a silently reduced rendering. `showFills:false` is an explicit ink-only option. This renderer may embed the existing mist-fill raster effect inside SVG; canonical source geometry remains vector and unchanged.

`exportSource()` returns a detached DrawingDocument and its JSON string, not a full project. Embedded reference pixels are excluded unless requested. No file upload, download or network transmission is triggered. Use the normal project save workflow for complete recording/source-library persistence.

## Coordinate conversion for pixel references

```js
api.convertPoint({point:[600,250], from:"reference", to:"source"});
api.convertPoint({point:[0.1,0.2], from:"source", to:"canvas"});
api.convertPoint({point:[0.1,0.2], from:"source", to:"client"});
api.convertPoint({
  point:[400,400], from:"canvas", to:"source",
  viewport:{width:800,height:800,center:[0,0],pixelsPerUnit:250,origin:[0,0]}
});
```

`reference` means pixels of the currently attached source image, with origin at its top-left. It uses the stored alignment, scale and rotation. `canvas` means local CSS/output pixels; `client` additionally applies the canvas origin in the browser viewport. `source` means canonical Y-up coordinates. A preview's returned viewport can be passed here to map reference landmarks into an exported image. No inference of pose angle, facial landmark detection or automatic registration is performed.

## Default face recipe: query → preview → modify → undo

This example makes a reversible 0.01-source-unit nose translation on the working document. It does not overwrite a saved artwork or the packaged fixture. Do this in Drawing mode and inspect every result before continuing.

```js
const api = window.contourAI;
const q = api.inspect({layerNames:["鼻部"]});
if (!q.ok || q.value.mode !== "drawing" || !q.value.curves.length) {
  throw new Error("Open the default face in Drawing mode and inspect the result");
}
const curveIds = q.value.curves.map(c => c.id);
const commands = [{op:"transformCurves",curveIds,matrix:[1,0,0,1,0.01,0]}];
const dry = api.execute({commands,expectedRevision:q.revision,dryRun:true});
if (!dry.ok) throw new Error(dry.error.message);
const before = api.preview({expectedRevision:q.revision,width:800,height:800});
if (!before.ok) throw new Error(before.error.message);
const after = api.preview({
  commands,expectedRevision:q.revision,width:800,height:800,
  center:before.value.viewport.center,
  pixelsPerUnit:before.value.viewport.pixelsPerUnit
});
if (!after.ok) throw new Error(after.error.message);
// Review before.value.svg / after.value.svg and dry.value changed IDs.
const edit = api.execute({commands,expectedRevision:q.revision});
if (!edit.ok) throw new Error(edit.error.message);
const restored = api.undo({expectedRevision:edit.revision});
if (!restored.ok) throw new Error(restored.error.message);
```

The dedicated tests execute this flow against the 210-curve packaged face in a detached test host, verify stable IDs/constraints/serialization, and confirm that the canonical asset bytes are untouched. A future image-guided agent can use these same query, coordinate mapping, draft preview and reversible command steps. It still has to decide what facial correspondence and deformation are appropriate.

## Verification

`npx vitest run src/tests/vector-editing-api.test.ts`

Coverage: names and stable lookups, exact cubic bounds, linked/shared endpoints and smooth joins, one-undo batches, dry runs, stale revisions, finite inputs, unknown commands/fields, locks, related selection, failed batch isolation, Recording gates, selection feedback, interval transport, projective fit reporting, deterministic source/SVG export, reference/canvas conversion and canonical-face preservation.

## Explicit AI helper view (transient)

Normal UI, source JSON and ordinary previews stay free of AI annotations. The separate **AI 辅助视图** toggle is transient and off by default. The API only annotates when explicitly asked:

```js
api.preview({
  width:800,height:800,
  annotations:{curveIds:chosenCurveIds,grid:true,labels:true,handles:true,diagnostics:true}
});
```

At most 32 curves can be annotated per API preview; filter by semantic layer/stroke/name first. `curveIds:[]` requests grid/context only. Guides identify endpoint P0/P1 versus handle H0/H1, source coordinates, shared/linked endpoints and selected join diagnostics. SVG titles retain full object IDs even when the visible label shortens them. The returned `annotated` flag distinguishes this inspection image from the clean preview. A subsequent ordinary `preview()` stays clean; these guides never enter saved artwork or change geometry.

Inspection's `controls` now gives `targetKind`, `role`, `curveId`, `nodeId` or handle `end`, plus the absolute position. Each edit result's `beforeAfter` records affected curve IDs, owner layer IDs, names, controls and widths before/after, including constraint-propagated changes. `activeCreationLayerId` is reported separately from each selected curve's `layerId`; a creation-layer label is not evidence of selection ownership.

Baseline hands-on QA found that numeric endpoint/handle edits and exact Undo already worked well. The friction was traversing the nested tree/collapsed property panels, generic “节点 X/Y” labels reused for different target types, and a creation-layer indicator that differed from selection ownership. The explicit roles and IDs address those ambiguities without replacing working numeric editing. Interval values remain normalized arc length in the track's orientation; CURVE-scoped tracks use the anchor curve's arc length, not Bézier t. Anchor IDs and reverse flags are retained in inspection. `displayIntervalLocations` also resolves each cut to its current source curve ID / cubic t, or a derived join piece ID, and source-space position using the existing arc-length table; this is labeled as an approximation.

## Copy layers from a saved artwork

`src/domain/drawing/importArtworkLayers.ts` provides the pure helpers used by the Drawing-only artwork import dialog:

```ts
planArtworkLayerImport(sourceDrawing, selectedLayerIds);
importArtworkLayers(targetDrawing, sourceDrawing, selectedLayerIds, {
  includeDependencies: false,
  insertAt: 0
});
```

The plan identifies dependency layers caused by cross-layer endpoint links or fill/offset source references. By default an incomplete selection throws `ArtworkLayerDependencyError` with an actionable plan. The UI can explicitly include the full closure; no authored link is silently detached and no reference binds to similarly named/identified geometry in the target.

All imported layers, curves, nodes, joins, groups, fills, offsets, endpoint links, interval tracks and ranges get fresh IDs, returned in `idMap`. Geometry, names, source ordering, flags, styles, anchors and relationships are retained. Fresh ID assignment preserves source endpoint ordering because it affects derived open-stroke direction. For an unusual branched return path whose curve-ID tie-break still reverses traversal, the imported profileReverse bit is compensated, following the existing duplicate command; geometry and visible taper direction are retained. The source artwork and existing target content are untouched; reference image and mirror guide remain those of the target. Importing at the top is the default, and the caller performs one normal Drawing transaction for one Undo.

Dedicated import verification: `npx vitest run src/tests/import-artwork-layers.test.ts`. Tests cover exact relationship remapping, source/target isolation, fresh-ID collision failures, explicit dependency closure, asymmetric profile direction, every dependency-closed layer in the default face, source serialization, and one root-store Undo/Redo.

## Source CRUD commands (API 1.1)

The following commands run through the same private-draft validation, expected-revision check, Drawing-only gate and one-Undo transaction as geometry edits:

- `createLayer {name, ref?}`; `duplicateLayer {layerId, ref?}`; `deleteLayers {layerIds}`
- `setLayer {layerId, name?, visible?, locked?}`; `reorderLayer {layerId, targetLayerId, after?}`
- `transformLayers {layerIds, matrix, allowRelated?}` selects every source curve, including hidden members, in those layers
- `setObjectState {objectIds, visible?, locked?}` and `deleteObjects {objectIds}` accept curves, fills and offsets
- `moveToLayer {curveIds, layerId}` preserves whole-stroke constraints and moves completely owned fills with their boundaries
- `createFill {curveIds, color, kind?, ref?}` requires one closed boundary; color is `white`, `black` or `transparent`, kind defaults to `SOLID` (`MIST` is also supported)
- `setFill {fillId, name?, color?, visible?, locked?}` edits fill appearance/state; delete a fill explicitly with `deleteObjects`
- `reorderObject {objectId, targetObjectId, after?}` requires the same layer and follows the UI's stroke/group paint ordering

Layer visibility changes all current members, including fills. To hide a closure line while retaining its fill, target only its curve IDs with `setObjectState`. Whole-layer duplication preserves each member's visible/locked/ink state, fill/offset state and paint order. Individual Ctrl+D copying retains its existing separate UI behavior. API layer duplication rejects external dependency closure rather than silently dropping a cross-layer endpoint relation. Use the explicit dependency-aware artwork import workflow for that case.

A creation command may declare `ref:"copy"`; later ID fields within the **same batch** may use `$copy`. Ref names must begin with an ASCII letter and contain only letters, digits, `_` or `-`. Forward/repeated references fail before any mutation. Dry-run IDs are provisional and must not be reused in a real execution; use the same aliases instead.

```json
{"expectedRevision":"LATEST_TOKEN","commands":[
  {"op":"duplicateLayer","layerId":"SOURCE_LAYER_ID","ref":"otherEye"},
  {"op":"transformLayers","layerIds":["$otherEye"],"matrix":[-1,0,0,1,-0.6589609028577848,0]},
  {"op":"setLayer","layerId":"$otherEye","name":"左眼内结构"},
  {"op":"reorderLayer","layerId":"$otherEye","targetLayerId":"SOURCE_LAYER_ID","after":true}
]}
```

The numeric matrix above reflects around the bundled front artwork's axis. Always inspect the current artwork's own axis rather than assuming that value for another drawing.

Results include `created` entries (`commandIndex`, `kind`, `id`, optional `ref`; a duplicated layer also supplies source-to-copy `idMap` for layers/objects/nodes), `addedCurves`, changed layer/fill/offset IDs, and a `removed` ID collection. Existing-curve `beforeAfter` remains available. All result data is assembled before the host commit. Deleting a fill boundary without its dependent fill is rejected if it would introduce invalid geometry; explicitly include both objects in the deletion.

Regression commands: `npx vitest run src/tests/vector-editing-api.test.ts src/tests/vector-editing-crud.test.ts src/tests/drawing-layer-duplication.test.ts`. This increment covers source layers and paint; artwork-library CRUD and new endpoint-binding semantics are not implied by these commands.

### Curve and source-interval CRUD

- `createCurve {layerId, shape:[P0,H0,H1,P1], width?, name?, ref?}` creates a canonical cubic and two fresh endpoint nodes. Width defaults to 0.008 source units. Coincident coordinates do not imply a shared-node binding
- `splitCurve {curveId, t, ref?}` performs the existing exact cubic subdivision, retaining the original ID for the first piece and returning the second piece's new ID. Here `t` is Bézier t, strictly inside the curve; this differs from display-interval arc length. Fill/offset references and outer authored tip styles are retained by the domain operation
- `setMirrorAxis {x}` sets the exact guide coordinate
- `setInkVisibility {curveIds, visible}` changes only selected segment ink, retaining geometry and fills
- `setCurveInkEnd {curveId, end:0|1, style}` explicitly edits an authored tip; style may contain `taper`, `extension`, `taperWidthScale`, `interior`. Distances use source units. Specify either absolute taper or width-multiple taper, not both
- `setDepth {curveId, offset, scope?}` sets an integer relative paint offset; scope is `PARENT` or `LAYER`
- `addDisplayInterval {curveId, mode?, start?, end?, enabled?, ref?}` adds to that curve's existing derived stroke track, defaulting to SHOW and the UI's default positions. Its created entity is `kind:"displayRange"`
- `changeDisplayInterval {rangeId, mode?, start?, end?, enabled?}`, `removeDisplayInterval {rangeId}`, and `setDisplayIntervalEnd {rangeId, end:0|1, style}` resolve the owning track by stable range ID. `$refs` work for newly created ranges
- `setFill` additionally accepts a full validated `mist:{enabled,side,width,opacity}` value, using the existing fill-mist command. Width is 0.001–0.8 source units; opacity is 0–1. Edit appearance before locking the fill

Source intervals use normalized **arc length** 0–1; closed paths may wrap through the origin when start > end. HIDE subtracts ink without cutting away fill geometry. A pre-existing SHOW range still restricts the visible portion; disable/remove that SHOW range explicitly if the whole loop should otherwise be visible. Editing an interval never adds cross-piece binding or a logical contour. Current explicit `connectGeometry` and `linkEndpoints` commands preserve authored terminal brushes; their separate contracts are documented below. Display-route adoption is explicit and never implied by an interval edit.

Example closure mask in a newly created piece, inside one batch:

```json
{"op":"addDisplayInterval","curveId":"$internalClosure","mode":"HIDE","start":0,"end":1,"ref":"hiddenClosure"}
```

A later command may set `rangeId:"$hiddenClosure"`. `createCurve` plus `createFill` can construct exact closed source loops in a single atomic batch using aliases; doing so does not claim that two independent loops acquire shared endpoint/tangent constraints.

## Precise terminology and inspection

- **端点 / geometry endpoint** means actual cubic P0/P1, with a canonical node ID
- **区间 / visibility range** means the path's SHOW/HIDE interval and its start/end bounds
- **末端 / visible ink terminus** means the visible line's end, which may lie inside a cubic at an interval cut. A range bound is not a new geometry node

The shared brush concepts concern visible terminal/junction appearance. These APIs do not introduce a common endpoint object. Explicit display-route adoption retains its own traversal and coverage contract. Source `setCurveInkEnd` and `setDisplayIntervalEnd` apply only explicitly requested authored style edits; source connection APIs preserve authored brush data rather than automatically overwriting it.

`inspect({layerNames:["右眼内结构"],includeRecording:false})` gives a concise source query without rig payload. Layer records include `effectiveState` computed from current members; legacy `visible`/`locked` container fields are neutral and should not be interpreted as inherited gates. Fills and offsets include owner `layerId` and `selectionRelation` (`owned` versus a dependency of selected curves). A paint-only layer is inspectable even when its boundary/source curves live elsewhere. Canonical IDs are opaque: literal `$`-prefixed IDs remain usable, and a new alias that would collide with one is refused. Prototype-like ID strings are retained safely in duplicate mappings.

## Artwork-library transactions (API 1.2)

Artwork metadata and mutations are separate from source command batches:

```js
api.inspectArtworks({expectedRevision});
api.artwork({op:"save",name:"Front copy",expectedRevision,dryRun:true});
api.artwork({op:"save",name:"Front copy",expectedRevision});
api.artwork({op:"rename",artworkId:"EXACT_ID",name:"Front",expectedRevision});
api.artwork({op:"restore",artworkId:"EXACT_ID",expectedRevision});
api.artwork({op:"delete",artworkId:"EXACT_ID",expectedRevision});
```

Each call accepts exactly one operation and uses one guarded root-store transaction. `save` with no `artworkId` creates a fresh ID, even if another artwork has the same name. `save` with an explicit `artworkId` updates that existing snapshot and retains its ID/rig association; an unknown ID fails instead of creating another artwork. `rename` changes only the label and never captures unsaved working geometry. Names may be trimmed; IDs never are.

`restore` on a named artwork keeps its unsaved changes under the same ID in `drawingWorkingCopies`, then loads the target’s retained working copy before its checkpoint. Only an unnamed source still requires a saved identity first. `discardUnsaved:true` explicitly discards the current working copy; normal Undo recovers the previous state. Updating a checkpoint with the same ID clears that working copy; saving as a new ID preserves the old source’s working copy and does not retarget its scene instances. `inspectArtworks()` reports `hasWorkingCopy`. Scene source resolution is active Drawing → same-ID working copy → checkpoint, and API revision covers inactive working copies too.

`delete` removes the saved checkpoint and that ID’s retained working copy, while preserving the current Drawing document. An archived legacy rig reference still triggers `ARTWORK_HAS_RIG`. Otherwise scene references and animation keys remain orphaned with local diagnostics until the source is restored; scene cleanup never deletes library artwork. There is no permanent purge.

Artwork reads work in either mode; writes require Drawing. Stale revisions, malformed fields, operation arrays, failed validation and dry runs create no history entry. A new ID returned by a save dry-run is provisional. The default host uses `beginEdit → setDrawingSnapshotState → endEdit`, preserving the store's existing first-save `$working` rig migration. Custom hosts may implement optional synchronous `commitArtwork(state)`; without it, mutation returns `UNAVAILABLE` while metadata reads and dry-run planning remain usable.

The visible console can route explicit whitelisted envelopes such as `{"method":"artwork","request":{"op":"save","name":"Front copy"}}` or `{"method":"inspectArtworks","request":{}}`. The API itself never executes arbitrary supplied code or replaces the raw project.

Artwork regression coverage: `npx vitest run src/tests/vector-artwork-api.test.ts`. This verifies stable identity, first-save rig mapping, dirty-source protection, rig-bound deletion refusal, exact Undo/Redo, Recording restrictions, dry runs and opaque artwork IDs.

## Source connections and remaining elements

`connectGeometry` takes `a` and `b` geometric refs `{curveId,end:0|1}` and an optional `mode:"POSITION"`. It explicitly merges same-layer nodes. It rejects differing width/profile settings and existing whole-stroke display intervals rather than silently rescaling their coordinate frame. Build each closed source loop first, then add its visibility intervals.

`linkEndpoints` takes the same refs, optionally `ref`, and couples positions across independent layers without merging nodes or strokes. `unlinkEndpoints` takes `linkId`. Both structured paths preserve authored 末端笔触; connected appearance remains a derived concern. These commands do not enable cross-layer display routing or an ARC brush. Dry runs, lock/dependency validation, mode restrictions and one-batch Undo apply as usual.

A three-curve filled piece uses three `createCurve` calls, three `connectGeometry` calls connecting each end to the next start, then `createFill` with its three curve IDs. Mirrored pieces have independent nodes; link the intended visible jaw ports only. The executable two-piece recipe is in `src/tests/vector-source-connections.test.ts`.

Additional source commands now include `duplicateObjects` (explicit dependency closure and fresh ID map), `reorderCurveMember`, `movePaint`, `createOffset`, `setOffset`, `detachOffset`, `createGroup`, `setGroup`, `ungroup`, `groupToLayer`, `setInkStyle`, and `setContourMist`. Names and numeric values are validated; no raw source replacement is exposed. Exact JSON fields are the `ElementCommand` union in `src/app/vectorElementCommands.ts`.

## Display-route commands (Drawing only)

`setLinkJoinBrush` accepts `{linkId,brush:{kind:"SHARP"|"SMOOTH"}}` or
`{linkId,brush:{kind:"ARC",trimDistance}}`. The distance uses source units.
`adoptDisplayRoute` accepts `{trackId,linkId}`; `detachDisplayRoute` accepts
`{trackId}`. Use a single batch to configure the brush and adopt the route.
No source cubic, layer or fill geometry is rewritten. Unsupported styles or
unmappable material cuts reject atomically. These source commands trigger the
existing explicit source review before reusing an older Recording rig.


## Persistent Drawing mirror editing (API 1.4)

Deployment must be confirmed through `help().commands` before use. These commands edit the existing `drawing.mirrorEditing` metadata through the normal transaction. No raw document/configuration replacement is exposed.

- `createMirrorPair {a,b,reverse?,ref?}` creates one stable pair ID; `a/b` are curve IDs and accept earlier `$refs`. `reverse` defaults false. A new configuration starts disabled; adding to an enabled configuration validates the existing geometry
- `setMirrorPair {pairId,a?,b?,reverse?}` updates that same identity; `deleteMirrorPairs {pairIds}` removes explicit relations
- `setMirrorAxisNodes {nodeIds}` replaces the explicit axis-node set; inferred self-mapped node components also remain on the axis
- `setMirrorEditing {enabled}` validates rather than repairs when enabling. Disabled metadata preserves pair identities and permits asymmetry; axis movement requires the switch off

`inspect()` includes a detached `mirrorEditing` plus `mirrorEditingState` with effective axis node IDs. Execute reports `mirrorEditingChanged`, `mirrorPairIds`, removed pair IDs, and `created.kind="mirrorPair"` with optional aliases. Configurations serialize with source artwork, but are not recording Warp/keyform commands.

Only source nodes and handles follow reflection. Existing position links and smooth constraints must agree; locks on reflected followers cancel the whole batch, even when those members are hidden. Paint order, fills, visibility, width, brush metadata and authored display ranges are not copied to the counterpart. Material ranges are transported after final mirrored geometry. Topology changes/copies affecting paired curves or axis bindings require explicit removal of the affected relation first; there is no guessed split mapping.

Batch intent records the last direct node value and direct handle vector relative to its node. Only explicitly selected curves contribute direct transform/deform targets; generated mirror/link/smooth followers do not become new authorship. Incompatible explicit edits to both sides return `MIRROR_AUTHORED_CONFLICT`, with no partial application/history entry. A later node translation rebases a prior handle intention. An actual metadata configuration change begins a new constraint-intent epoch after earlier commands have been validated; a no-op configuration command does not erase prior intentions. Errors originating from mirror math use `MIRROR_<domain code>`; malformed JSON retains normal `INVALID_REQUEST` handling.

The executable specimen is [the two-face setup batch](examples/two-face-mirror-editing-api-batch.json). It is read directly by `src/tests/vector-mirror-editing-api.test.ts` and targets the known example IDs only; inspect current source identity before applying it to a saved copy.


## Explicit full closed-loop interval flag (API 1.4)

`addDisplayInterval` and `changeDisplayInterval` accept optional strict boolean `fullLoop`. For a closed display path, true means one complete turn and normalizes the end to the start. Equal bounds without true mean empty coverage; full SHOW reveals the whole loop and full HIDE hides all ink. Open paths and CURVE-scoped ranges reject true atomically. An explicit start/end edit clears the flag unless fullLoop is explicitly passed again; mode/enabled changes retain it. This flag is source interval metadata, not a new endpoint or source-geometry edit. See `vector-display-full-loop-api.test.ts` for executable requests, empty/full distinction, no-mutation failures and dry-run behavior.


## Separate Recording and transient-view interfaces

API 2.0 uses `inspectScene / scene / previewScene / previewSceneFrames`, documented in [the scene guide](recording-scene-api.md). Scene writes use their own Recording-only atomic transaction and never author Drawing source geometry. The [legacy rig guide](vector-recording-api.md) remains historical; its four methods return `LEGACY_RECORDING_RETIRED` when the project has `recordingScenes`.

API 1.6 adds `inspectView / view`, documented in [the temporary view guide](vector-workspace-view-api.md). These wrappers use the transient WorkspaceView store only. They intentionally do not accept or return a project revision, do not add project history and do not auto-save. Failed or dry-run view batches do not apply any partial state.
