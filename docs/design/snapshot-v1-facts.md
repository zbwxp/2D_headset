# Snapshots in v1: facts (7205381)

These are facts about the old code, to be used in the snapshot questions of the architecture walkthrough. They are not rules.

- **Source:** commit 7205381 ("Contour V0.17.0"); every claim cites `path:line` at that commit. Collected by a read-only survey on 2026-10-10. Claude spot-checked the key citations: snapshots.ts:6, the principles doc lines 42/56/86/102, docs/v01239 lines 18/22, recordingSnapshot/model.ts:110.
- **Graph today:** the only snapshot rows are:
  - "View / snapshot references one image" (Q3, confirmed);
  - "Snapshot / view: no persisted object" (open);
  - "Cut-and-paste between recordings keeps ids" (Q21, open);
  - "Show/hide intervals belong to the continuous curve, later" (Q27, placement);
  - "another axis needs another snapshot".

## Four generations, two live

- **Live:**
  - `drawingSnapshots`, the artwork library ("画稿" in the UI; src/ui/drawing/SnapshotBar.tsx:34-44).
  - `recordingSnapshots` v2, the triangulated Recorder.
- **Retired or legacy:**
  - `vectorRecording.rigs`, `recordingScenes` and untriangulated recordings, which go to `LegacyRecordingReview` (src/domain/recordingSnapshot/retirement.ts:10-19; src/app/App.tsx:62).
  - `poseRecording` and `assembly`, which are `legacyWorkspaces` (src/domain/landmarks/model.ts:39).

## 1. What a drawing snapshot holds

- **Contents:** one whole drawing document (src/domain/drawing/snapshots.ts:7-19; model.ts:70): layers, curves, nodes, fills, joins, groups, show/hide intervals, endpoint links, mirror axis, and its own background image transform.
- **No angle:** "Authored drawing poses, deliberately independent of Recording view angles/placement" (snapshots.ts:6). There is no yaw, pitch or placement field (docs/v01239-drawing-snapshots.md:18-20, 28).
- **Saving is a copy, never a live link** (snapshots.ts:51).
  - *Corrected (dot 1791600814):* recording still reads the **live** source. The drawing being edited, or its stashed working copy, wins over the saved checkpoint: "The active working drawing wins over its saved checkpoint" (src/domain/recordingScene/sources.ts:4-11). So recording does not wait for another save.
  - Unsaved edits to an artwork are kept in `drawingWorkingCopies[artworkId]` while you switch away (snapshots.ts:37-44).
  - The unnamed canvas is `$working`; its first save "promotes" it to a real id (src/app/drawingWorkingCopies.ts:24-35).

## 2. How snapshots relate

- **Artworks are independent copies.** They keep curve, node and interval ids "以便未来对应", but do not sync topology (docs/v01239:18, 22): "不能假定任意两份快照天然可插值".
- **Recording v2 scopes ids per artwork:** `original:<len>:<artworkId>:<rawId>` (src/domain/recordingSnapshot/sources.ts:17-22). So the same raw id in two artworks is two different members.
- *Corrected (dot 1791600814):* correspondence does **not** need one artwork to reference the other; both may reference the same source. What recording checks, per curve, is listed below (src/domain/recordingSnapshot/snapshotCoverage.ts:44-65). The same name, the same shape, or only the same curve id is not enough.
  - every snapshot at those angles has the same **curve id**;
  - the curve has the same **two end node ids** (`nodes[0]`, `nodes[1]`);
  - those nodes exist in each of them.
- **Correspondence is by stable id, never by name, look or nearest position** (docs/architecture/editor-snapshot-recording-principles.md:42).
- **Layer reference:** `{kind:'reference', baseSnapshotId, baseLayerId, membership?}` (recordingSnapshot/model.ts:30-37). It follows the base live.
  - Local edits add or exclude members, or override their order.
  - Deformation residuals are per id.
- **One semantic parent:** a snapshot has at most one (principles.md:56-60). Layer source addresses are provenance only.

## 3. Angles, views, in-betweens

- **The angle belongs to Recorder vertices `{id, snapshotId, angle}`,** not to the snapshot (principles.md:86). `Snapshot.angle` is a legacy adapter (model.ts:110).
- **In-betweens:**
  - The Recorder vertices form a Delaunay mesh; inserting a vertex splits a triangle and flips no edges (triangulation.ts:6-8).
  - Between vertices, positions are blended per stable id, weighted by place in the triangle.
  - Response curves per edge and per triangle shape the blend; handles are stored relative to their node (model.ts:143-162, 240-245).
- **Missing ≠ hidden** (principles.md:102).
  - A hidden curve is still a member and still supports interpolation.
  - A missing one cannot be produced by showing it.
  - Outside its coverage, a curve is shown as a red read-only projection (principles.md:118-128).
- **Show/hide intervals:**
  - In the drawing, `{anchor, ranges[{start, end, mode: SHOW|HIDE, inkEnds}]}` has no angle (drawing/model.ts:50-52).
  - Over angle, **each interval end has its own scalar response** (model.ts:166-184; docs/recording-snapshot-v2.md:41-53).
  - Collapse is exact: start = end.
- **Earlier models:**
  - pose recording: yaw / pitch on the pose; per-id Delaunay over the poses holding that id (src/domain/recording/poses.ts:8-11).
  - rigs: warp grids plus interval flags per key, never node geometry (vectorRecording/model.ts:9-18).

## 4. Recording

- **v2 data:** `{library, snapshots, recordings}`; a recording has `snapshotIds`, `angleGraph` (mesh, responses, `viewMirror`) and `tracks` (model.ts:129-139, 228-256).
- **Workflow:** make an empty 0/0 view, then paste layer references into it. Pitch ±90 placeholders, and a +90 mirrored from −90, are made automatically (docs/recording-snapshot-v2.md:17-19).

## 5. Operations offered

- **Artwork bar:**
  - save new, update current, rename, delete;
  - switching with unsaved edits offers save-as, discard or cancel;
  - import layers from another artwork, with new ids (SnapshotBar.tsx:35-62).
- **Restore a layer from an artwork:** matched by stable layer id. It is refused if some objects now sit in another layer (LayerSnapshotDialog.tsx; snapshotLayers.ts:5-55).
- **Take / paste a layer reference** (same id, live), or duplicate (new ids) (referenceClipboard.ts:8-33).
- **Cut / paste that keeps ids works only within one document.** The cut is dropped when you switch artwork (DrawingRoom.tsx:399), so there is no cross-snapshot cut and paste.
- **Recorder:** create (empty, or inside existing coverage), rebind angle, update, delete (refused while referenced), move or remove layers (commands.ts:59-67, 408-414).

## Open questions a redesign must answer (from the survey)

1. **Correspondence across hand-drawn artworks.** In v1 it needs the same curve id, the same end node ids and the nodes present, which in practice means a shared source (corrected per dot 1791600814). Is correspondence authored, or read from ids?
2. **Where the angle lives.** In v1 it moved from snapshot to pose to keyform to Recorder vertex. One owner is needed.
3. **Live reference vs copy.** Working copy, checkpoint and source snapshot overlap.
4. **Show/hide intervals over angle.** v1 tried four schemes. Which is canonical, and how does SHOW turn into HIDE?
5. **Discrete properties over angle** (layer order, fill colour, topology). v1 takes the nearest pose and has no editor.
6. **Elements present at one angle only.** Freeze, show as a red projection, or infer?
7. **Topology changes in one view.** Local splits break correspondence.
8. **Reference image alignment.** Per snapshot (drawing) or per angle (recording)?
9. **Old data.** Rigs, scenes, assembly and pose recordings are kept but not converted.
