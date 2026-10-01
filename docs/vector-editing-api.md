# Local structured vector editing API

`window.contourAI` exposes source-vector inspection and bounded JSON commands in the local app. The API does not connect to a service, accept credentials, execute supplied JavaScript, or switch workspace modes. It is an editing interface for a future image-guided assistant, **not an automatic image-to-vector matching solver**.

Module: `src/app/vectorEditingApi.ts`. Integration calls `registerVectorEditingApi()` once; its return value unregisters that instance. Tests and local integrations can call `createVectorEditingApi(host)` without a browser. The host must commit through the application's normal drawing transaction. The default host uses one `beginEdit` → `setDrawing` → `endEdit` sequence.

## Contract

Every operation except `help()` returns one of:

```json
{"ok":true,"revision":"opaque-session-token:1","value":{}}
```

```json
{"ok":false,"revision":"opaque-session-token:1","error":{"code":"NOT_FOUND","message":"Unknown curve ID: missing.","commandIndex":1}}
```

- Treat revision as opaque. Send the latest inspection's revision as `expectedRevision` when editing, selecting, previewing, exporting, or undoing. Any observed project replacement, including UI editing, invalidates an older token. Tokens are local to this API instance, not saved in project JSON
- All source writes require **Drawing** mode. Recording-mode calls cannot alter nodes, handles, topology, layer contents or visibility. They return `MODE_RESTRICTED`; the API never changes modes to make a command succeed
- Inspection and source export remain available in Recording. `inspect().value.recording` exposes a detached copy of the current vector rig, when present. Source SVG preview is explicitly a source-artwork preview, not recording evaluation
- Commands are sequential within a private draft. All commands, coordinates, source constraints and new derived-geometry diagnostics are checked before the single store transaction. A failed command, dry run, no-op or speculative preview creates no undo entry
- `undo()` / `redo()` use normal project history. In Recording, a history step that changes source artwork or saved source artworks is rejected. These operations are not a separate API-private history
- Canonical curve, node, layer, join and endpoint-link IDs are preserved by all current commands. Stroke IDs are derived anchors of connected components, not a second persistent topology
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
