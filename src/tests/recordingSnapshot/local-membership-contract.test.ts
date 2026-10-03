import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {createEmptyProject} from '../../app/emptyProject';
import {describe,it,expect} from 'vitest';
import {emptyDrawing,type DrawingDocument,type Cubic,type Point2} from '../../domain/drawing/model';
import {addLayer,createCurve,connect} from '../../domain/drawing/commands';
import {createFill} from '../../domain/drawing/paintCommands';
import {depthPaintBatches,setDepthOffset} from '../../domain/drawing/depth';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {snapshotAuthoredKeyCount} from '../../domain/recordingSnapshot/tracks';
import {resolveSnapshotLocalMembership,excludeSnapshotLocalMembers,applySnapshotMembershipEdit} from '../../domain/recordingSnapshot/localMembership';
import {captureSnapshotLayerClipboard,snapshotClipboardPasteCommands,captureDrawingLayerClipboard,planSnapshotClipboardPaste,prepareSnapshotReferencePaste} from '../../domain/recordingSnapshot/referenceClipboard';

const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function drawing(){let d=addLayer(emptyDrawing(),'Layer');return createCurve(d,d.layers[0].id,line([0,0],[1,0]),.02,'Curve','curve');}
function workspace(d:DrawingDocument=drawing()){
 const w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',d),source=w.snapshots[0],view=emptyRecordingSnapshot('view'),recording=emptySnapshotRecording('recording');
 w.snapshots.push(view);recording.snapshotIds=[view.id];recording.activeSnapshotId=view.id;w.recordings.push(recording);w.activeRecordingId=recording.id;
 return {w,source,view,recording};
}
const cid=(id:string)=>canonicalElementId('source',id);

describe('local Recording membership contract prototype',()=>{
 it('inherits all current source members by default, including later additions',()=>{
  expect(resolveSnapshotLocalMembership(['a','b']).elementIds).toEqual(['a','b']);
  const patch={addElementIds:['local'],excludeElementIds:['a']},before=JSON.stringify(patch);
  expect(resolveSnapshotLocalMembership(['a','b','new-source'],patch)).toEqual({elementIds:['b','new-source','local'],inheritedElementIds:['b','new-source'],localElementIds:['local']});
  expect(JSON.stringify(patch)).toBe(before);
 });
 it('excludes inherited IDs locally, retaining a tombstone across source disappearance and restoration',()=>{
  const patch=excludeSnapshotLocalMembers({},['a']);
  expect(resolveSnapshotLocalMembership(['a','b'],patch).elementIds).toEqual(['b']);
  expect(resolveSnapshotLocalMembership(['b'],patch).elementIds).toEqual(['b']);
  expect(resolveSnapshotLocalMembership(['a','b','new'],patch).elementIds).toEqual(['b','new']);
  expect(patch).toEqual({excludeElementIds:['a']});
 });
 it('allows a local original without a parent and releases membership without deleting original geometry',()=>{
  const sourceDrawing=drawing(),{w}=workspace(sourceDrawing),original=w.library.curves[cid('curve')],local={...original,id:'new-local'};
  w.library.curves[local.id]=local;const before=JSON.stringify(w.library),patch={addElementIds:[local.id]};
  expect(resolveSnapshotLocalMembership([],patch).localElementIds).toEqual([local.id]);
  expect(resolveSnapshotLocalMembership([],excludeSnapshotLocalMembers(patch,[local.id])).elementIds).toEqual([]);
  expect(JSON.stringify(w.library)).toBe(before);
  // A normal source update keeps the same node identities. Generating a new
  // drawing here would delete the referenced source nodes and correctly retire
  // their dependent local curve under the source-deletion contract.
  const synced=upsertDrawingSource(w,'source',sourceDrawing);
  expect(synced.library.curves[local.id]).toBe(local);expect(synced.snapshots[0].source?.originIds).not.toHaveProperty(local.id);
 });
 it('does not duplicate a live inherited ID and rejects contradictory membership',()=>{
  expect(resolveSnapshotLocalMembership(['a'],{addElementIds:['a','local']}).elementIds).toEqual(['a','local']);
  expect(()=>resolveSnapshotLocalMembership(['a'],{addElementIds:['a'],excludeElementIds:['a']})).toThrow(/both added and excluded/);
  expect(()=>resolveSnapshotLocalMembership(['a'],{addElementIds:['local','local']})).toThrow(/distinct/);
 });
});

function localFixture(){const result=workspace();applySnapshotCommand(result.w,{op:'pasteLayers',sourceSnapshotId:result.source.id,layerIds:[result.source.layers[0].id]});return {...result,layerId:result.view.layers[0].id};}
describe('local membership production transactions',()=>{
 it('creates new canonical geometry locally through the API without changing sources, keys or archive',()=>{
  const {w,source,view,layerId}=localFixture();w.legacyArchive={projectJSON:'{}',format:'landmark-project-json',migrationVersion:2};const before=JSON.stringify(w),parent=JSON.stringify(source),project={...createEmptyProject(),recordingSnapshots:w};
  const batch=prepareSnapshotBatch(project,{commands:[{op:'createLocalCurve',layerId,shape:line([0,2],[1,2]),name:'New local',ref:'new'}]});
  const id=batch.created.find(item=>item.kind==='curve')!.id,result=resolveSnapshot(batch.recordingSnapshots,view.id);
  expect(result.drawing.curves.map(curve=>curve.id)).toEqual([cid('curve'),id]);expect(result.diagnostics.some(issue=>issue.code==='LOCAL_ORIGINAL'&&issue.elementId===id)).toBe(true);
  expect(result.provenance[id]).toEqual({elementId:id,sourceSnapshotId:view.id,path:[view.id]});expect(JSON.stringify(w)).toBe(before);expect(JSON.stringify(batch.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===source.id))).toBe(parent);
  expect(batch.recordingSnapshots.legacyArchive).toEqual(w.legacyArchive);expect(snapshotAuthoredKeyCount(batch.recordingSnapshots.recordings[0])).toBe(0);
  expect(()=>prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-state',workspace:batch.recordingSnapshots})).not.toThrow();
 });
 it('excludes and restores inherited membership without deleting parent geometry or existing response data',()=>{
  const {w,source,view,layerId,recording}=localFixture(),parent=JSON.stringify(source),library=JSON.stringify(w.library);recording.tracks=[{id:'historic',channel:'depth',targetId:layerId,keys:[{id:'old-key',angle:{x:45,y:0},value:2}]}];const tracks=JSON.stringify(recording.tracks);
  applySnapshotCommand(w,{op:'excludeElements',layerId,elementIds:[cid('curve')]});expect(resolveSnapshot(w,view.id).drawing.curves).toHaveLength(0);expect(JSON.stringify(source)).toBe(parent);expect(JSON.stringify(w.library)).toBe(library);expect(JSON.stringify(recording.tracks)).toBe(tracks);
  const reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(w)));applySnapshotCommand(reloaded,{op:'restoreElements',layerId,elementIds:[cid('curve')]});expect(resolveSnapshot(reloaded,view.id).drawing.curves.map(curve=>curve.id)).toEqual([cid('curve')]);
 });
 it('keeps source additions live alongside local additions and inherited exclusions',()=>{
  const original=drawing(),{w,source,view}=workspace(original);applySnapshotCommand(w,{op:'pasteLayers',sourceSnapshotId:source.id,layerIds:[source.layers[0].id]});const layerId=view.layers[0].id;
  const created=applySnapshotCommand(w,{op:'createLocalCurve',layerId,shape:line([0,2],[1,2])}).created.find(item=>item.kind==='curve')!.id;applySnapshotCommand(w,{op:'excludeElements',layerId,elementIds:[cid('curve')]});
  const extended=createCurve(original,original.layers[0].id,line([0,1],[1,1]),.02,'Source addition','new-source'),next=upsertDrawingSource(w,'source',extended);
  expect(resolveSnapshot(next,view.id).drawing.curves.map(curve=>curve.id)).toEqual([cid('new-source'),created]);expect(next.snapshots[0].source?.originIds).not.toHaveProperty(created);
  applySnapshotCommand(next,{op:'excludeElements',layerId,elementIds:[created]});expect(next.library.curves[created]).toBeDefined();expect(resolveSnapshot(next,view.id).drawing.curves.map(curve=>curve.id)).toEqual([cid('new-source')]);
 });
 it('allows independent local originals while a layer source is missing',()=>{
  const {w,view,layerId}=localFixture(),layer=view.layers[0];if(layer.kind!=='reference')throw Error('Reference expected');layer.baseSnapshotId='missing-source';
  const id=applySnapshotCommand(w,{op:'createLocalCurve',layerId,shape:line([0,3],[1,3])}).created.find(item=>item.kind==='curve')!.id;
  const result=resolveSnapshot(w,view.id);expect(result.drawing.curves.map(curve=>curve.id)).toEqual([id]);expect(result.diagnostics.map(issue=>issue.code)).toEqual(expect.arrayContaining(['MISSING_SNAPSHOT','LOCAL_ORIGINAL']));expect(()=>parseRecordingSnapshots(w)).not.toThrow();
 });
 it('rejects membership changes at correction angles and validates persisted membership strictly',()=>{
  const {w,view,recording,layerId}=localFixture();recording.angle={x:30,y:0};expect(()=>applySnapshotCommand(w,{op:'createLocalCurve',layerId,shape:line([0,2],[1,2])})).toThrow(/real snapshot/);
  const layer=view.layers[0];if(layer.kind!=='reference')throw Error('Reference expected');layer.membership={addElementIds:['same'],excludeElementIds:['same']};expect(()=>parseRecordingSnapshots(w)).toThrow(/both added and excluded/);
 });
 it('supports a Drawing source target through the pure transaction helper without forcing active Recording',()=>{
  const {w,source,recording}=localFixture(),other=emptyRecordingSnapshot('other','Other','drawing');other.layers=[];w.snapshots.push(other);source.layers.push({kind:'reference',id:'drawing-local-slot',name:'Referenced layer',baseSnapshotId:other.id,baseLayerId:'absent'});
  const active=recording.activeSnapshotId;let next=0;const result=applySnapshotMembershipEdit(w,source.id,{op:'createLocalCurve',layerId:'drawing-local-slot',shape:line([1,2],[2,2])},()=>`local-${next++}`);
  expect(recording.activeSnapshotId).toBe(active);expect(resolveSnapshot(w,source.id).drawing.curves.some(curve=>curve.id===result.createdCurveId)).toBe(true);expect(source.source?.originIds).not.toHaveProperty(result.createdCurveId!);
 });
});

describe('session reference clipboard contract prototype',()=>{
 it('captures Drawing raw IDs as stable canonical addresses and plans a destination without baking or mode mutation',()=>{
  const d=drawing(),{w,source,view,recording}=workspace(d),before=JSON.stringify(w),clipboard=captureDrawingLayerClipboard(w,'project','source',[d.layers[0].id]);
  expect(clipboard.sources).toEqual([{snapshotId:source.id,layerIds:[cid(d.layers[0].id)]}]);
  expect(planSnapshotClipboardPaste(w,clipboard,'project',view.id)).toEqual({targetSnapshotId:view.id,commands:[{op:'pasteLayers',sourceSnapshotId:source.id,layerIds:[cid(d.layers[0].id)]}]});
  expect(JSON.stringify(w)).toBe(before);expect(recording.activeSnapshotId).toBe(view.id);expect(()=>planSnapshotClipboardPaste(w,clipboard,'project',source.id)).toThrow(/itself/);
 });
 it('captures references without changing a source, then pastes live same-ID membership after mode switches',()=>{
  const original=drawing(),{w,source,view,recording}=workspace(original),before=JSON.stringify(source),selection=[{snapshotId:source.id,layerIds:[source.layers[0].id]}];
  const clipboard=captureSnapshotLayerClipboard('project','reference',selection);selection[0].layerIds=[];
  expect(JSON.stringify(source)).toBe(before);expect(clipboard.sources[0].layerIds).toHaveLength(1);
  const extended=createCurve(original,original.layers[0].id,line([0,1],[1,1]),.02,'Later source curve','later'),current=upsertDrawingSource(w,'source',extended),sourceBeforePaste=JSON.stringify(current.snapshots[0]);
  for(const command of snapshotClipboardPasteCommands(clipboard,'project'))applySnapshotCommand(current,command);
  expect(resolveSnapshot(current,view.id).drawing.curves.map(curve=>curve.id).sort()).toEqual([cid('curve'),cid('later')].sort());
  expect(JSON.stringify(current.snapshots[0])).toBe(sourceBeforePaste);expect(snapshotAuthoredKeyCount(recording)).toBe(0);
  expect(clipboard.intent).toBe('reference');expect(clipboard.sources[0].snapshotId).toBe(source.id);
 });
 it('keeps independent duplication explicit and rejects references across projects',()=>{
  const {w,source,view}=workspace(),before=JSON.stringify(source),clipboard=captureSnapshotLayerClipboard('project','duplicate',[{snapshotId:source.id,layerIds:[source.layers[0].id]}]);
  const commands=snapshotClipboardPasteCommands(clipboard,'project');expect(commands[0].op).toBe('cloneLayers');
  applySnapshotCommand(w,commands[0]);expect(resolveSnapshot(w,view.id).drawing.curves[0].id).not.toBe(cid('curve'));expect(JSON.stringify(source)).toBe(before);
  expect(()=>snapshotClipboardPasteCommands(clipboard,'different-project')).toThrow(/another project/);
 });
});

describe('independent duplication of local members',()=>{
 it('copies current local geometry and relationships without retaining excluded source membership',()=>{
  const {w,source,view,layerId}=localFixture(),create=(shape:Cubic)=>applySnapshotCommand(w,{op:'createLocalCurve',layerId,shape}).created.find(item=>item.kind==='curve')!.id;
  const first=create(line([0,2],[1,2])),second=create(line([1,2],[2,2])),firstNode=w.library.curves[first].nodes[0];
  applySnapshotCommand(w,{op:'excludeElements',layerId,elementIds:[cid('curve')]});
  const layer=view.layers[0];if(layer.kind!=='reference')throw Error('Reference expected');layer.membership!.excludeElementIds!.push('missing-retained-tombstone');
  view.deformation.layers[layerId]={shape:{nodes:{[firstNode]:[.3,.4]},handles:{[first]:[[.1,.2],[0,0]]}}};
  view.relations.groups={add:[{id:'local-group',name:'Local group',visible:true,locked:false,curveIds:[first,second]}]};
  view.relations.endpointLinks={add:[{id:'local-link',a:{curveId:first,end:1},b:{curveId:second,end:0}}]};
  view.relations.displayIntervals={add:[{id:'local-interval',anchor:{id:first,reverse:false},scope:'CURVE',ranges:[{id:'local-range',start:.2,end:.8}]}]};
  const before=resolveSnapshot(w,view.id),oldLibrary=JSON.stringify(w.library),oldSource=JSON.stringify(source),effects=applySnapshotCommand(w,{op:'cloneLayers',sourceSnapshotId:view.id,layerIds:[layerId]}),map=effects.idMap!;
  expect(map[first]).toBeDefined();expect(map[second]).toBeDefined();expect(map[first]).not.toBe(first);expect(w.library.curves[map[first]].nodes).toEqual(w.library.curves[first].nodes.map(id=>map[id]));expect(w.library.curves[map[first]].handles).toEqual(before.drawing.curves.find(curve=>curve.id===first)!.handles);
  const copied=w.snapshots.find(snapshot=>snapshot.id===map[view.id])!,copiedLayer=copied.layers[0];expect(copiedLayer.kind).toBe('original');
  expect(copiedLayer).toMatchObject({items:[map[first],map[second]]});expect(copiedLayer).not.toHaveProperty('membership');expect(copied).not.toHaveProperty('parentSnapshotId');expect(map[cid('curve')]).toBeUndefined();expect(copied.deformation.warps).toEqual([]);expect(copied.deformation.layers).toEqual({});
  const evaluated=resolveSnapshot(w,copied.id);expect(evaluated.drawing.curves.map(curve=>curve.id).sort()).toEqual([map[first],map[second]].sort());expect(evaluated.drawing.curves.some(curve=>curve.id===map[cid('curve')])).toBe(false);
  expect(evaluated.drawing.nodes.find(node=>node.id===map[firstNode])?.position).toEqual(before.drawing.nodes.find(node=>node.id===firstNode)?.position);
  expect(evaluated.drawing.endpointLinks).toEqual([{id:map['local-link'],a:{curveId:map[first],end:1},b:{curveId:map[second],end:0}}]);expect(evaluated.drawing.groups?.[0].curveIds).toEqual([map[first],map[second]]);expect(evaluated.drawing.displayIntervals?.[0]).toMatchObject({id:map['local-interval'],anchor:{id:map[first]},ranges:[{id:map['local-range']}]});
  expect(JSON.stringify(source)).toBe(oldSource);for(const category of ['nodes','curves','fills','offsets'] as const)for(const [id,value] of Object.entries(JSON.parse(oldLibrary)[category]))expect(w.library[category][id]).toEqual(value);
  const copiedPosition=[...evaluated.drawing.nodes.find(node=>node.id===map[firstNode])!.position];w.library.nodes[firstNode].position=[99,99];expect(resolveSnapshot(w,copied.id).drawing.nodes.find(node=>node.id===map[firstNode])?.position).toEqual(copiedPosition);expect(()=>parseRecordingSnapshots(w)).not.toThrow();
 });
});

describe('pure explicit-target reference paste transactions',()=>{
 it('preserves the captured layer ID across separately pasted real views and graph samples while keeping local state independent',()=>{
  const {w,source,view,recording}=workspace(),end=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});w.snapshots.push(end);recording.snapshotIds.push(end.id);const sourceLayerId=source.layers[0].id;
  const first=prepareSnapshotReferencePaste(w,{sourceSnapshotId:source.id,targetSnapshotId:view.id},()=>{throw Error('Reference paste must not allocate identity');});
  const second=prepareSnapshotReferencePaste(first.workspace,{sourceSnapshotId:source.id,targetSnapshotId:end.id},()=>{throw Error('Reference paste must not allocate identity');});
  expect(first.created.map(layer=>layer.id)).toEqual([sourceLayerId]);expect(second.created.map(layer=>layer.id)).toEqual([sourceLayerId]);expect(second.workspace.library).toBe(w.library);
  const current=structuredClone(second.workspace),front=current.snapshots.find(snapshot=>snapshot.id===view.id)!,side=current.snapshots.find(snapshot=>snapshot.id===end.id)!,r=current.recordings[0];
  front.deformation.layers[sourceLayerId]={placement:{translation:[1,0],rotation:0,scale:1}};side.deformation.layers[sourceLayerId]={placement:{translation:[3,0],rotation:0,scale:1}};
  r.mode='triangulated';r.angleGraph=createSnapshotAngleGraph([{snapshotId:front.id,angle:{x:0,y:0}},{snapshotId:side.id,angle:{x:90,y:0}}]);
  expect(resolveSnapshot(current,front.id).drawing.nodes[0].position[0]).toBe(1);expect(resolveSnapshot(current,side.id).drawing.nodes[0].position[0]).toBe(3);
  for(const x of [0,44.9,45,45.1,90])expect(evaluateRecordingSnapshot(current,r.id,{angle:{x,y:0}}).drawing.layers.map(layer=>layer.id)).toEqual([sourceLayerId]);
  expect(evaluateRecordingSnapshot(current,r.id,{angle:{x:45,y:0}}).drawing.nodes[0].position[0]).toBeCloseTo(2);
  front.deformation.layers[sourceLayerId].placement!.translation=[7,0];expect(side.deformation.layers[sourceLayerId].placement!.translation).toEqual([3,0]);expect(()=>parseRecordingSnapshots(current)).not.toThrow();
 });
 it('retains legacy same-address slot IDs and blocks same-ID different-provenance collisions without migration',()=>{
  const {w,source,view}=workspace(),sourceLayerId=source.layers[0].id;
  view.layers=[{kind:'reference',id:'legacy-random-slot',name:'Legacy',baseSnapshotId:source.id,baseLayerId:sourceLayerId,membership:{excludeElementIds:[cid('curve')]}}];view.deformation.layers['legacy-random-slot']={depth:4};
  const before=JSON.stringify(w),repeat=prepareSnapshotReferencePaste(w,{sourceSnapshotId:source.id,targetSnapshotId:view.id});expect(repeat.changed).toBe(false);expect(repeat.reused.map(layer=>layer.id)).toEqual(['legacy-random-slot']);expect(JSON.stringify(w)).toBe(before);
  const conflictWorkspace=structuredClone(w),target=conflictWorkspace.snapshots.find(snapshot=>snapshot.id===view.id)!;target.layers=[{kind:'original',id:sourceLayerId,name:'Another local layer',visible:true,locked:false,items:[]}];
  const conflictBefore=JSON.stringify(conflictWorkspace),conflict=prepareSnapshotReferencePaste(conflictWorkspace,{sourceSnapshotId:source.id,targetSnapshotId:view.id});expect(conflict.blockedCode).toBe('LAYER_ID_CONFLICT');expect(conflict.changed).toBe(false);expect(conflict.workspace).toBe(conflictWorkspace);expect(conflict.created).toEqual([]);expect(JSON.stringify(conflictWorkspace)).toBe(conflictBefore);
  const withOther=upsertDrawingSource(conflictWorkspace,'other-source',drawing()),other=withOther.snapshots.find(snapshot=>snapshot.source?.artworkId==='other-source')!,targetWithOther=withOther.snapshots.find(snapshot=>snapshot.id===view.id)!;
  targetWithOther.layers=[{kind:'reference',id:sourceLayerId,name:'Different provenance',baseSnapshotId:other.id,baseLayerId:other.layers[0].id}];const otherBefore=JSON.stringify(withOther),otherConflict=prepareSnapshotReferencePaste(withOther,{sourceSnapshotId:source.id,targetSnapshotId:view.id});
  expect(otherConflict.blockedCode).toBe('LAYER_ID_CONFLICT');expect(otherConflict.workspace).toBe(withOther);expect(JSON.stringify(withOther)).toBe(otherBefore);expect(resolveSnapshot(otherConflict.workspace,view.id).drawing.curves.map(curve=>curve.id)).toEqual([canonicalElementId('other-source','curve')]);
 });
 it('pastes into a Drawing source snapshot through one shared transaction and serialized reload without baking',()=>{
  const origin=drawing(),targetDrawing=drawing(),initial=workspace(origin),w=upsertDrawingSource(initial.w,'target',targetDrawing,'Target drawing'),target=w.snapshots.find(snapshot=>snapshot.source?.artworkId==='target')!,before=JSON.stringify(w),active=structuredClone(w.recordings),originalCount=Object.keys(w.library.curves).length;
  const result=prepareSnapshotReferencePaste(w,{sourceSnapshotId:initial.source.id,targetSnapshotId:target.id,layerIds:[initial.source.layers[0].id]});
  expect(result.blockedCode).toBeUndefined();expect(result.changed).toBe(true);expect(result.created).toHaveLength(1);expect(result.workspace.library).toBe(w.library);expect(result.workspace.recordings).toBe(w.recordings);expect(JSON.stringify(w)).toBe(before);expect(result.workspace.recordings).toEqual(active);expect(Object.keys(result.workspace.library.curves)).toHaveLength(originalCount);
  const project={...createEmptyProject(),drawing:targetDrawing,recordingSnapshots:w},transaction=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'snapshot-state',workspace:result.workspace});
  expect(transaction.changed).toBe(true);expect(transaction.project.drawing).toBe(targetDrawing);
  const reload=parseRecordingSnapshots(JSON.parse(JSON.stringify(transaction.project.recordingSnapshots))),evaluated=resolveSnapshot(reload,target.id);
  expect(evaluated.drawing.curves.map(curve=>curve.id).sort()).toEqual([cid('curve'),canonicalElementId('target','curve')].sort());
  expect(reload.snapshots.find(snapshot=>snapshot.id===target.id)?.source?.originIds).not.toHaveProperty(cid('curve'));
  const extended=createCurve(origin,origin.layers[0].id,line([0,2],[1,2]),.02,'Live addition','later'),updated=upsertDrawingSource(reload,'source',extended);
  expect(resolveSnapshot(updated,target.id).drawing.curves.map(curve=>curve.id)).toContain(cid('later'));
  const refreshed=upsertDrawingSource(updated,'target',targetDrawing);expect(refreshed.snapshots.find(snapshot=>snapshot.id===target.id)?.layers.some(layer=>layer.kind==='reference'&&layer.baseSnapshotId===initial.source.id)).toBe(true);
 });
 it('reuses an exact reference slot on repeated paste, preserving local exclusions and deformation',()=>{
  const {w,source,view}=workspace(),first=prepareSnapshotReferencePaste(w,{sourceSnapshotId:source.id,targetSnapshotId:view.id}),slot=first.created[0],target=first.workspace.snapshots.find(snapshot=>snapshot.id===view.id)!;
  slot.membership={excludeElementIds:[cid('curve')]};target.deformation.layers[slot.id]={depth:3};const before=JSON.stringify(first.workspace);
  const again=prepareSnapshotReferencePaste(first.workspace,{sourceSnapshotId:source.id,targetSnapshotId:view.id});
  expect(again.changed).toBe(false);expect(again.workspace).toBe(first.workspace);expect(again.created).toEqual([]);expect(again.reused).toEqual([slot]);expect(again.diagnostics.map(issue=>issue.code)).toContain('ALREADY_REFERENCED');expect(JSON.stringify(first.workspace)).toBe(before);expect(resolveSnapshot(again.workspace,view.id).drawing.curves).toHaveLength(0);
  const effects=applySnapshotCommand(first.workspace,{op:'pasteLayers',sourceSnapshotId:source.id});expect(effects.created).toEqual([expect.objectContaining({kind:'layer',id:slot.id,created:false})]);expect(JSON.stringify(first.workspace)).toBe(before);
 });
 it('preserves existing cross-layer relationship requirements without guessing extra sources',()=>{
  let d=drawing();d=addLayer(d,'Linked');d=createCurve(d,d.layers[0].id,line([0,0],[2,1]),.02,'Other','other');d.endpointLinks=[{id:'link',a:{curveId:'curve',end:0},b:{curveId:'other',end:0}}];
  const {w,source,view}=workspace(d),before=JSON.stringify(w),partial=prepareSnapshotReferencePaste(w,{sourceSnapshotId:source.id,targetSnapshotId:view.id,layerIds:[source.layers[0].id]});
  expect(partial.blockedCode).toBe('LAYER_DEPENDENCIES');expect(partial.workspace).toBe(w);expect(JSON.stringify(w)).toBe(before);
  const complete=prepareSnapshotReferencePaste(w,{sourceSnapshotId:source.id,targetSnapshotId:view.id});expect(complete.blockedCode).toBeUndefined();expect(resolveSnapshot(complete.workspace,view.id).drawing.endpointLinks?.map(link=>link.id)).toEqual([cid('link')]);expect(JSON.stringify(w)).toBe(before);
 });
 it('blocks conflicting paths and cycles atomically while leaving the current artwork renderable',()=>{
  const {w,source,view}=workspace(),first=prepareSnapshotReferencePaste(w,{sourceSnapshotId:source.id,targetSnapshotId:view.id}),other=emptyRecordingSnapshot('alternate');other.layers=[{kind:'reference',id:'alternate-layer',name:'Alternate',baseSnapshotId:source.id,baseLayerId:source.layers[0].id}];first.workspace.snapshots.push(other);const before=JSON.stringify(first.workspace);
  const conflict=prepareSnapshotReferencePaste(first.workspace,{sourceSnapshotId:other.id,targetSnapshotId:view.id});expect(conflict.blockedCode).toBe('BRANCH_CONFLICT');expect(conflict.workspace).toBe(first.workspace);expect(conflict.created).toEqual([]);expect(resolveSnapshot(conflict.workspace,view.id).drawing.curves).toHaveLength(1);
  const cycleWorkspace=structuredClone(first.workspace);cycleWorkspace.snapshots.find(snapshot=>snapshot.id===view.id)!.layers[0].id='legacy-cycle-slot';const cycle=prepareSnapshotReferencePaste(cycleWorkspace,{sourceSnapshotId:view.id,targetSnapshotId:source.id});expect(cycle.blockedCode).toBe('SNAPSHOT_CYCLE');expect(JSON.stringify(first.workspace)).toBe(before);
 });
});

describe('referenced layer ordering compatibility',()=>{
 it('preserves collar interleaving and element order when a layer is pasted into a new snapshot',()=>{
  let d=addLayer(emptyDrawing(),'Neck');const neck=d.layers[0].id;
  d=createCurve(d,neck,line([-1,.5],[1,.5]),.04,'Shoulder','back');d=createCurve(d,neck,[[1,.5],[1,-1],[-1,-1],[-1,.5]],.04,'Back','back2');
  d=connect(d,{curveId:'back',end:1},{curveId:'back2',end:0},'POSITION');d=connect(d,{curveId:'back',end:0},{curveId:'back2',end:1},'POSITION');d=createFill(d,['back','back2'],'white');
  d=createCurve(d,neck,line([-1,0],[1,0]),.04,'Collar','front');d=createCurve(d,neck,line([1,0],[1,1]),.04,'Collar side','side');d=connect(d,{curveId:'front',end:1},{curveId:'side',end:0},'POSITION');d=setDepthOffset(d,'front',-1);
  const originalOrder=depthPaintBatches(d).map(batch=>cid(batch.owner??batch.item.id)),{w,source,view}=workspace(d),before=JSON.stringify(source);
  applySnapshotCommand(w,{op:'pasteLayers',sourceSnapshotId:source.id,layerIds:[cid(neck)]});
  const result=resolveSnapshot(w,view.id);
  expect(result.paintBatches.map(batch=>batch.owner??batch.item.id)).toEqual(originalOrder);
  expect(result.drawing.layers[0].items).toEqual(d.layers[0].items.map(cid));expect(result.drawing.curves.find(curve=>curve.id===cid('front'))?.depthOffset).toBe(-1);
  expect(JSON.stringify(source)).toBe(before);
 });
 it('does not reinterpret a legacy cross-layer offset against an unrelated destination neighbor',()=>{
  let d=drawing(),layer=d.layers[0].id;d=addLayer(d,'Original target');d=createCurve(d,d.layers[0].id,line([0,1],[1,1]),.02,'Original target','original-target');d=setDepthOffset(d,'curve',1,'LAYER');
  const {w,source,view}=workspace(d),other=emptyRecordingSnapshot('other','Other','drawing');
  other.layers=[{kind:'original',id:'other-layer',name:'Other',visible:true,locked:false,items:['unrelated']}];w.library.curves.unrelated={...w.library.curves[cid('curve')],id:'unrelated',depthOffset:0};w.snapshots.push(other);
  view.layers.push({kind:'reference',id:'other-slot',name:'Other',baseSnapshotId:other.id,baseLayerId:'other-layer'});
  applySnapshotCommand(w,{op:'pasteLayers',sourceSnapshotId:source.id,layerIds:[cid(layer)]});
  const result=resolveSnapshot(w,view.id);
  expect(result.drawing.layers).toHaveLength(2);expect(result.paintBatches.map(batch=>batch.owner??batch.item.id)).toEqual(['unrelated',cid('curve')]);
  expect(result.drawing.curves.find(curve=>curve.id===cid('curve'))).toMatchObject({depthOffset:1,depthScope:'LAYER'});
 });
});
