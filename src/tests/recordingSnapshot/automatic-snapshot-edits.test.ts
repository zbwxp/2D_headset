import {describe,expect,test,vi} from 'vitest';
import * as evaluation from '../../domain/recordingSnapshot/evaluation';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {insertSnapshotVertex,removeSnapshotVertex} from '../../domain/recordingSnapshot/triangulation';
import {seedAutomaticExtremeSnapshots,propagateAutomaticSnapshotLayers} from '../../domain/recordingSnapshot/automaticSnapshotEdits';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {prepareSnapshotReferencePaste} from '../../domain/recordingSnapshot/referenceClipboard';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {depthPaintBatches} from '../../domain/drawing/depth';
import {mirrorSnapshotDrawing} from '../../domain/recordingSnapshot/snapshotMirror';

function fixture(x=0){
 const workspace=emptyRecordingSnapshotWorkspace(),view=emptyRecordingSnapshot('real','Real','view',{x,y:0}),recording=emptySnapshotRecording('recording');
 recording.mode='triangulated';recording.snapshotIds=[view.id];recording.activeSnapshotId=view.id;recording.angle={x,y:0};recording.angleGraph=createSnapshotAngleGraph([{snapshotId:view.id,angle:view.angle}]);workspace.snapshots=[view];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 let index=0;const fresh=()=>`generated-${++index}`;return {workspace,view,recording,fresh};
}
function addSource(workspace:RecordingSnapshotWorkspace){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[-.7,.2]},{id:'b',position:[-.2,.3]},{id:'c',position:[.4,.5]},{id:'d',position:[.9,.6]}],curves:[{id:'left',name:'Left',nodes:['a','b'],handles:[[-.6,.1],[-.3,.4]],visible:true,locked:false,width:.01},{id:'right',name:'Right',nodes:['c','d'],handles:[[.5,.4],[.8,.7]],visible:true,locked:false,width:.02}],layers:[{id:'left-layer',name:'Left',items:['left'],visible:true,locked:false},{id:'right-layer',name:'Right',items:['right'],visible:true,locked:false}]};
 const source=emptyRecordingSnapshot('source','Source','drawing');source.layers=drawing.layers.map(layer=>({...layer,kind:'original'}));source.source={artworkId:'asset',originIds:Object.fromEntries([...drawing.nodes,...drawing.curves,...drawing.layers].map(value=>[value.id,value.id])),mirrorAxisX:0,mirrorEditing:{enabled:false,curvePairs:[{id:'pair',a:'left',b:'right',reverse:false}]}};
 workspace.snapshots.push(source);workspace.library.nodes=Object.fromEntries(drawing.nodes.map(node=>[node.id,node]));workspace.library.curves=Object.fromEntries(drawing.curves.map(curve=>[curve.id,curve]));return source;
}
const find=(workspace:RecordingSnapshotWorkspace,x:number,y:number)=>workspace.snapshots.find(snapshot=>workspace.recordings[0].angleGraph!.mesh.vertices.some(vertex=>vertex.snapshotId===snapshot.id&&vertex.angle.x===x&&vertex.angle.y===y))!;
const commit=(before:RecordingSnapshotWorkspace,after:RecordingSnapshotWorkspace)=>{const project={...createEmptyProject(),recordingSnapshots:before};return prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-state',workspace:after}).project.recordingSnapshots!;};

describe('ordinary automatic extreme snapshot edits',()=>{
 test('semantic mirror keeps the originating element depth context through snapshot painting',()=>{
  const f=fixture(-90),source=addSource(f.workspace);f.workspace.library.curves.left.depthOffset=1;
  const pasted=prepareSnapshotReferencePaste(f.workspace,{targetSnapshotId:f.view.id,sourceSnapshotId:source.id},f.fresh);const workspace=pasted.workspace,mirror={axisX:0,curvePairs:source.source!.mirrorEditing!.curvePairs};
  seedAutomaticExtremeSnapshots(workspace,f.recording.id,f.view.id,f.fresh,{mirror});
  const parent=resolveSnapshot(workspace,f.view.id),opposite=find(workspace,90,0),actual=resolveSnapshot(workspace,opposite.id),expected=depthPaintBatches(mirrorSnapshotDrawing(parent.drawing,mirror).drawing);
  const keys=(batches:typeof expected)=>batches.map(batch=>[batch.layerId,batch.owner??batch.item.id]);
  expect(keys(actual.paintBatches)).toEqual(keys(expected));
 });
 test('new empty front seeds only its two pitch placeholders; paste then propagates in the same transaction',()=>{
  const f=fixture(),source=addSource(f.workspace),original=JSON.stringify(f.workspace.library),result=seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,f.view.id,f.fresh);
  expect(result.createdSnapshotIds).toHaveLength(2);expect(f.recording.snapshotIds).toHaveLength(3);expect(f.recording.tracks).toEqual([]);
  for(const id of result.createdSnapshotIds){const child=f.workspace.snapshots.find(snapshot=>snapshot.id===id)!;expect(child.kind).toBe('view');expect(child.parentSnapshotId).toBe(f.view.id);expect(child.layers).toEqual([]);expect(child.source).toBeUndefined();expect(child.inheritedState).toBeUndefined();}
  const before=JSON.stringify(f.workspace),pasted=prepareSnapshotReferencePaste(f.workspace,{targetSnapshotId:f.view.id,sourceSnapshotId:source.id},f.fresh);expect(pasted.changed).toBe(true);
  const after=commit(f.workspace,pasted.workspace);expect(JSON.stringify(f.workspace)).toBe(before);expect(JSON.stringify(after.library)).toBe(original);
  for(const id of result.createdSnapshotIds){const child=after.snapshots.find(snapshot=>snapshot.id===id)!;expect(child.layers).toHaveLength(2);expect(child.layers.every(layer=>layer.kind==='reference'&&layer.baseSnapshotId===f.view.id)).toBe(true);expect(resolveSnapshot(after,id).drawing.curves.map(curve=>curve.id)).toEqual(['left','right']);}
  expect(parseRecordingSnapshots(after)).toEqual(after);
 });

 test('new negative extreme fills missing points and mirrors the saved parent in its local zero basis',()=>{
  const f=fixture();seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,f.view.id,f.fresh);const source=addSource(f.workspace),negative=emptyRecordingSnapshot('negative','Left','view',{x:-90,y:0});negative.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));f.view.layers=structuredClone(negative.layers);f.workspace.snapshots.push(negative);f.recording.snapshotIds.push(negative.id);f.recording.angleGraph!.mesh=insertSnapshotVertex(f.recording.angleGraph!.mesh,{snapshotId:negative.id,angle:negative.angle});
  const original=JSON.stringify(f.workspace.library),result=seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,negative.id,f.fresh),mirror=find(f.workspace,90,0);
  expect(result.createdSnapshotIds).toHaveLength(5);expect(f.recording.snapshotIds).toHaveLength(9);expect(mirror.parentSnapshotId).toBe(negative.id);expect(mirror.inputMirror?.axisX).toBe(0);expect(mirror.layers.map(layer=>layer.id)).toEqual(['right-layer','left-layer']);
  const mirrored=resolveSnapshot(f.workspace,mirror.id),drawing=mirrored.drawing;expect(drawing.nodes.find(node=>node.id==='c')!.position).toEqual([.4,.5]);expect(drawing.nodes.find(node=>node.id==='a')!.position).toEqual([-.7,.2]);
  expect(mirrored.provenance.right.elementId).toBe('right');expect(mirrored.provenance.right.materialContext!.elementId).toBe('left');expect(mirrored.provenance.right.materialContext!.idMap['left-layer']).toBe('right-layer');expect(mirrored.provenance.right.materialContext!.idMap).toBe(mirrored.provenance.c.materialContext!.idMap);expect(resolveSnapshot(f.workspace,find(f.workspace,90,90).id).provenance.right.materialContext).toBe(mirrored.provenance.right.materialContext);
  expect(resolveSnapshot(f.workspace,find(f.workspace,90,90).id).drawing.nodes).toEqual(drawing.nodes);expect(JSON.stringify(f.workspace.library)).toBe(original);expect(parseRecordingSnapshots(f.workspace)).toEqual(f.workspace);
  const previous=JSON.stringify(f.workspace);expect(seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,negative.id,f.fresh).createdSnapshotIds).toEqual([]);expect(JSON.stringify(f.workspace)).toBe(previous);
 });

 test('later parent edits preserve child residuals, explicit layer deletion, and local reordering',()=>{
  const f=fixture(),source=addSource(f.workspace);f.view.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,f.view.id,f.fresh);
  const child=find(f.workspace,0,90),first=child.layers[0].id;child.deformation.layers[first]={placement:{...identityScenePlacement(),translation:[.1,.2]}};
  const reordered=structuredClone(f.workspace);reordered.snapshots.find(snapshot=>snapshot.id===child.id)!.layers.reverse();const withOrder=commit(f.workspace,reordered);expect(withOrder.snapshots.find(snapshot=>snapshot.id===child.id)!.parentLayers!.orderOverride).toBe(true);
  const parentEdited=structuredClone(withOrder);parentEdited.snapshots.find(snapshot=>snapshot.id===f.view.id)!.deformation.layers[first]={placement:{...identityScenePlacement(),translation:[.3,0]}};
  const after=commit(withOrder,parentEdited),resolved=resolveSnapshot(after,child.id);expect(resolved.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(-.3);expect(resolved.drawing.nodes.find(node=>node.id==='a')!.position[1]).toBeCloseTo(.4);expect(after.snapshots.find(snapshot=>snapshot.id===child.id)!.layers.map(layer=>layer.id)).toEqual(['right-layer','left-layer']);
  const removed=structuredClone(after);removed.snapshots.find(snapshot=>snapshot.id===child.id)!.layers=removed.snapshots.find(snapshot=>snapshot.id===child.id)!.layers.filter(layer=>layer.id!==first);const deleted=commit(after,removed);expect(deleted.snapshots.find(snapshot=>snapshot.id===child.id)!.parentLayers!.excludedLayerIds).toEqual([first]);
  const replay=propagateAutomaticSnapshotLayers(deleted,structuredClone(deleted)).workspace;expect(replay.snapshots.find(snapshot=>snapshot.id===child.id)!.layers.map(layer=>layer.id)).toEqual(['right-layer']);expect(parseRecordingSnapshots(replay)).toEqual(replay);
 });

 test('empty negative mirror discovers exact source pairs on later paste and reports conflicting fixed axes',()=>{
  const f=fixture(-90),result=seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,f.view.id,f.fresh,{mirror:{axisX:0,curvePairs:[]}});expect(result.createdSnapshotIds).toHaveLength(5);
  const before=structuredClone(f.workspace),source=addSource(f.workspace),pasted=prepareSnapshotReferencePaste(f.workspace,{targetSnapshotId:f.view.id,sourceSnapshotId:source.id},f.fresh),next=propagateAutomaticSnapshotLayers(before,pasted.workspace).workspace,child=find(next,90,0);
  expect(resolveSnapshot(next,child.id).drawing.nodes.find(node=>node.id==='c')!.position).toEqual([.7,.2]);
  const altered=structuredClone(next);altered.snapshots.find(snapshot=>snapshot.id===source.id)!.source!.mirrorAxisX=1;expect(resolveSnapshot(altered,child.id).diagnostics.some(issue=>issue.code==='INPUT_MIRROR'&&issue.message.includes('selected axis 0'))).toBe(true);
 });

 test('parent layer additions and removals stay live while old unopted snapshots stay untouched',()=>{
  const f=fixture(),source=addSource(f.workspace);f.view.layers=[{kind:'reference',id:'left-slot',name:'Left',baseSnapshotId:source.id,baseLayerId:'left-layer'}];
  const ordinary=emptyRecordingSnapshot('ordinary');ordinary.parentSnapshotId=f.view.id;f.workspace.snapshots.push(ordinary);seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,f.view.id,f.fresh);
  const child=find(f.workspace,0,90),before=structuredClone(f.workspace),changed=structuredClone(before);changed.snapshots.find(snapshot=>snapshot.id===f.view.id)!.layers.push({kind:'reference',id:'right-slot',name:'Right',baseSnapshotId:source.id,baseLayerId:'right-layer'});
  const expanded=commit(before,changed);expect(expanded.snapshots.find(snapshot=>snapshot.id===child.id)!.layers.map(layer=>layer.id)).toEqual(['left-slot','right-slot']);expect(expanded.snapshots.find(snapshot=>snapshot.id===ordinary.id)).toEqual(ordinary);
  const removed=structuredClone(expanded);removed.snapshots.find(snapshot=>snapshot.id===f.view.id)!.layers=removed.snapshots.find(snapshot=>snapshot.id===f.view.id)!.layers.filter(layer=>layer.id!=='left-slot');const reduced=commit(expanded,removed),reducedChild=reduced.snapshots.find(snapshot=>snapshot.id===child.id)!;
  expect(reducedChild.layers.map(layer=>layer.id)).toEqual(['right-slot']);expect(reducedChild.parentLayers).toEqual({});expect(resolveSnapshot(reduced,child.id).drawing.curves.map(curve=>curve.id)).toEqual(['right']);
  const restored=structuredClone(reduced);restored.snapshots.find(snapshot=>snapshot.id===f.view.id)!.layers.push(before.snapshots.find(snapshot=>snapshot.id===f.view.id)!.layers[0]);expect(commit(reduced,restored).snapshots.find(snapshot=>snapshot.id===child.id)!.layers.map(layer=>layer.id)).toEqual(['right-slot','left-slot']);
 });

 test('load, later transactions and snapshot deletion never regenerate missing graph points',()=>{
  const f=fixture();seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,f.view.id,f.fresh);const removed=find(f.workspace,0,90).id;f.workspace.snapshots=f.workspace.snapshots.filter(snapshot=>snapshot.id!==removed);f.recording.snapshotIds=f.recording.snapshotIds.filter(id=>id!==removed);f.recording.angleGraph!.mesh=removeSnapshotVertex(f.recording.angleGraph!.mesh,removed);
  const loaded=parseRecordingSnapshots(f.workspace),after=commit(loaded,structuredClone(loaded));expect(after.recordings[0].snapshotIds).toHaveLength(2);expect(after.snapshots.some(snapshot=>snapshot.id===removed)).toBe(false);
 });
});


test('draft-only geometry skips saved mirror membership work while mirror changes invalidate it',()=>{
 const f=fixture(),source=addSource(f.workspace),negative=emptyRecordingSnapshot('negative','Left','view',{x:-90,y:0});
 negative.layers=source.layers.map(layer=>({kind:'reference' as const,id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));f.view.layers=structuredClone(negative.layers);f.workspace.snapshots.push(negative);f.recording.snapshotIds.push(negative.id);f.recording.angleGraph!.mesh=insertSnapshotVertex(f.recording.angleGraph!.mesh,{snapshotId:negative.id,angle:negative.angle});seedAutomaticExtremeSnapshots(f.workspace,f.recording.id,negative.id,f.fresh);
 const before=f.workspace,next={...before,snapshots:before.snapshots.map(snapshot=>snapshot.id===negative.id?{...snapshot,draft:{angle:snapshot.angle,deformation:{warps:[],bindings:[],relationPositions:{},layers:{'left-layer':{shape:{nodes:{a:[.02,.01] as [number,number]},handles:{}}}}},channels:[]}}:snapshot)},spy=vi.spyOn(evaluation,'resolveSnapshot');
 try{expect(propagateAutomaticSnapshotLayers(before,next).workspace).toBe(next);expect(spy).not.toHaveBeenCalled();
  const mirror=find(before,90,0),changed={...before,snapshots:before.snapshots.map(snapshot=>snapshot.id===mirror.id?{...snapshot,inputMirror:{...snapshot.inputMirror!,axisX:1}}:snapshot)};propagateAutomaticSnapshotLayers(before,changed);expect(spy).toHaveBeenCalled();
 }finally{spy.mockRestore();}
});
