import {afterEach,describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch,prepareSnapshotPreview,snapshotCommandNames} from '../../app/recordingSnapshotApi';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {createVectorEditingApi,type VectorResult} from '../../app/vectorEditingApi';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {emptyDrawing,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {depthPaintBatches,setDepthOffset} from '../../domain/drawing/depth';
import {changePaint,movePaint} from '../../domain/drawing/paintCommands';
import {applyCurveSplitIntent,createCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {emptyRecordingScene,instanceObjectId} from '../../domain/recordingScene/model';
import {evaluateScene} from '../../domain/recordingScene/evaluation';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotDeformationState,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {canonicalElementId,upsertDrawingSource,remapDrawingIdentities} from '../../domain/recordingSnapshot/sources';
import {evaluateRecordingSnapshot,prepareRecordingContext,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {applySnapshotPaintAppearanceToObject,validateSnapshotPaintAppearance} from '../../domain/recordingSnapshot/paintAppearance';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {mirrorSnapshotDrawing} from '../../domain/recordingSnapshot/snapshotMirror';
import {prepareSnapshotDrawingPropertyEdit} from '../../ui/vectorRecording/snapshotDrawingPropertyEdit';

const cid=(id:string)=>canonicalElementId('$working',id),eid=(id:string)=>canonicalElementId('extra',id),editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useWorkspaceMode.setState({mode});});
function drawingFor(ids:string[]):DrawingDocument {
 const drawing=emptyDrawing();
 for(const [index,id] of ids.entries()){
  const points:Point2[]=[[index*2,0],[index*2+1,0],[index*2+1,1],[index*2,1]],curveIds=points.map((_,i)=>`${id}-${i}`);
  drawing.nodes.push(...points.map((position,i)=>({id:`${id}-n${i}`,position})));
  drawing.curves.push(...points.map((a,i)=>{const b=points[(i+1)%4],at=(t:number):Point2=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];return {id:curveIds[i],name:curveIds[i],nodes:[`${id}-n${i}`,`${id}-n${(i+1)%4}`] as [string,string],handles:[at(1/3),at(2/3)] as [Point2,Point2],visible:true,locked:false,width:.01};}));
  drawing.fills.push({id:`${id}-fill`,name:`${id} fill`,visible:true,locked:false,color:'white',boundary:curveIds.map(id=>({id,reverse:false}))});
  drawing.layers.push({id:`${id}-layer`,name:id,visible:true,locked:false,items:[...curveIds,`${id}-fill`]});
 }
 return drawing;
}
function fixture(sourceDepth?:number){
 let drawing=drawingFor(['front','back']);if(sourceDepth!==undefined)drawing=setDepthOffset(drawing,'back-fill',sourceDepth,'LAYER');
 let workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'$working',drawing);const source=workspace.snapshots[0];workspace=upsertDrawingSource(workspace,'extra',drawingFor(['extra']));const extra=workspace.snapshots.find(snapshot=>snapshot.source?.artworkId==='extra')!;
 const view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 view.layers=[{kind:'reference',id:eid('extra-layer'),name:'Extra',baseSnapshotId:extra.id,baseLayerId:eid('extra-layer')},...source.layers.map(layer=>({kind:'reference' as const,id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}))];side.layers=structuredClone(view.layers);
 recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {project:{...createEmptyProject(),drawing,recordingSnapshots:workspace},workspace,source,view,side};
}
const order=(evaluation:ReturnType<typeof resolveSnapshot>)=>evaluation.paintBatches.map(batch=>batch.owner??batch.item.id);
const fill=(workspace:RecordingSnapshotWorkspace,snapshotId='view',useDraft=true)=>resolveSnapshot(workspace,snapshotId,{useDraft}).drawing.fills.find(fill=>fill.id===cid('back-fill'))!;
const reload=(workspace:RecordingSnapshotWorkspace)=>parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)));
function edit(project:ReturnType<typeof fixture>['project'],value:number,preview=false){const beforeDrawing=resolveSnapshot(project.recordingSnapshots,'view').drawing;return prepareSnapshotDrawingPropertyEdit(project,{recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},beforeDrawing,drawing:setDepthOffset(beforeDrawing,cid('back-fill'),value,'LAYER'),validation:preview?'preview':'full'});}
function apiFor(initial:LandmarkProject){
 let project=initial;const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing(){throw Error('Unexpected source write');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const old=past.pop();if(old){future.push(project);project=old;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 const value=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};return {api,value,past,project:()=>project};
}

describe('Snapshot fill depth through native appearance ownership',()=>{
 it('uses current sibling targets in preview and commit without changing canonical source, geometry, or membership',()=>{
  const {project}=fixture(),before=JSON.stringify(project),preview=edit(project,2,true),plan=edit(project,2),workspace=plan.project.recordingSnapshots!,result=resolveSnapshot(workspace,'view');
  expect(order(result)[0]).toBe(cid('back-fill'));expect(order(result)).toEqual(depthPaintBatches(result.drawing).map(batch=>batch.owner??batch.item.id));expect(preview.project.recordingSnapshots).toEqual(workspace);
  expect(workspace.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers[cid('back-layer')].paintAppearance?.[cid('back-fill')]).toEqual({kind:'fill',depthOffset:2,depthScope:'LAYER'});
  expect(workspace.library).toEqual(project.recordingSnapshots.library);expect(result.drawing.curves).toEqual(resolveSnapshot(project.recordingSnapshots,'view').drawing.curves);expect(result.drawing.nodes).toEqual(resolveSnapshot(project.recordingSnapshots,'view').drawing.nodes);expect(result.drawing.layers).toEqual(resolveSnapshot(project.recordingSnapshots,'view').drawing.layers);expect(result.paintBatches.find(batch=>batch.item.id===cid('back-fill'))!.layerId).toBe(cid('back-layer'));expect(JSON.stringify(project)).toBe(before);
  useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);expect(order(resolveSnapshot(reload(workspace),'view'))).toEqual(order(result));
 });
 it('merges saved and draft fields and supports Save and Discard without creating response tracks',()=>{
  const {project,view}=fixture();view.draft={angle:{...view.angle},channels:[],deformation:emptySnapshotDeformationState()};
  const workspace=edit(project,2).project.recordingSnapshots!,next={...project,recordingSnapshots:workspace};expect(fill(workspace).depthOffset).toBe(2);expect(fill(workspace,'view',false).depthOffset??0).toBe(0);
  const saved=prepareSnapshotBatch(next,{commands:[{op:'updateSnapshot'}]}).recordingSnapshots,discarded=prepareSnapshotBatch(next,{commands:[{op:'discardSelected',layerIds:[cid('back-layer')]}]}).recordingSnapshots;
  expect(fill(saved,'view',false).depthOffset).toBe(2);expect(fill(discarded).depthOffset??0).toBe(0);expect(saved.recordings[0].tracks).toEqual([]);expect(saved.recordings[0].angleGraph?.propertyResponses).toBeUndefined();expect(fill(reload(saved)).depthOffset).toBe(2);
 });
 it('holds explicit zero and sparse overrides against later live source updates',()=>{
  const {project}=fixture(1),workspace=reload(edit(project,0).project.recordingSnapshots!);workspace.library.fills[cid('back-fill')].depthOffset=-1;workspace.library.fills[cid('back-fill')].name='Updated source';workspace.library.fills[cid('back-fill')].color='black';
  expect(fill(workspace)).toMatchObject({depthOffset:0,depthScope:'LAYER',name:'Updated source',color:'black'});expect(fill(workspace,'side')).toMatchObject({depthOffset:-1,color:'black'});expect(JSON.stringify(workspace)).not.toContain('depthContext');
  const cleared=applySnapshotPaintAppearanceToObject(fill(workspace),{kind:'fill',depthOffset:null,depthScope:null});expect(cleared.depthOffset).toBeUndefined();expect(cleared.depthScope).toBeUndefined();
 });
 it('inherits authoring target addresses without retargeting an omitted neighbour to an unrelated child layer',()=>{
  const {project}=fixture(),owned=edit(project,2).project.recordingSnapshots!;let workspace=upsertDrawingSource(owned,'unrelated',drawingFor(['other']));const unrelated=workspace.snapshots.find(snapshot=>snapshot.source?.artworkId==='unrelated')!,child=emptyRecordingSnapshot('child');
  child.layers=[{kind:'reference',id:'unrelated-slot',name:'Other',baseSnapshotId:unrelated.id,baseLayerId:canonicalElementId('unrelated','other-layer')},{kind:'reference',id:'back-slot',name:'Back',baseSnapshotId:'view',baseLayerId:cid('back-layer')}];workspace.snapshots.push(child);
  const before=resolveSnapshot(workspace,'child');expect(fill(workspace,'child').depthOffset).toBe(2);expect(order(before)[0]).not.toBe(cid('back-fill'));
  workspace=prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'child',state:'saved',beforeDrawing:before.drawing,drawing:setDepthOffset(before.drawing,cid('back-fill'),1,'LAYER')}).workspace;expect(order(resolveSnapshot(workspace,'child'))[0]).toBe(cid('back-fill'));expect(order(resolveSnapshot(reload(workspace),'child'))).toEqual(order(resolveSnapshot(workspace,'child')));
 });
 it.each([false,true])('remaps source and local depth provenance through semantic fill mirrors (local: %s)',local=>{
  const {project}=fixture(1),workspace=structuredClone(local?edit(project,2).project.recordingSnapshots!:project.recordingSnapshots),parent=resolveSnapshot(workspace,'view'),mirror={axisX:0,curvePairs:[0,1,2,3].map(i=>({id:`pair-${i}`,a:cid(`front-${i}`),b:cid(`back-${i}`),reverse:false}))},mapped=mirrorSnapshotDrawing(parent.drawing,mirror),child=emptyRecordingSnapshot('mirror');
  child.parentSnapshotId='view';child.inputMirror=mirror;child.layers=mapped.drawing.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:'view',baseLayerId:layer.id}));workspace.snapshots.push(child);
  const actual=resolveSnapshot(workspace,'mirror');expect(mapped.correspondence.fills[cid('back-fill')]).toBe(cid('front-fill'));expect(actual.drawing.fills.find(fill=>fill.id===cid('front-fill'))!.depthOffset).toBe(local?2:1);expect(order(actual)).toEqual(depthPaintBatches(mapped.drawing).map(batch=>batch.owner??batch.item.id));expect(order(resolveSnapshot(reload(workspace),'mirror'))).toEqual(order(actual));
 });
 it('keeps the live positive View mirror depth discrete and allows its own local override',()=>{
  const {workspace,source,view,side}=fixture(),pairs=[0,1,2,3].map(i=>({id:`pair-${i}`,a:cid(`front-${i}`),b:cid(`back-${i}`),reverse:false})),negative=emptyRecordingSnapshot('negative','Negative','view',{x:-90,y:0});
  source.source!.mirrorEditing={enabled:false,curvePairs:pairs};source.source!.mirrorAxisX=0;negative.layers=structuredClone(view.layers);side.parentSnapshotId=negative.id;side.parentLayers={};side.inputMirror={axisX:0,curvePairs:pairs};side.layers=side.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:negative.id,baseLayerId:layer.id}));workspace.snapshots.push(negative);
  const recording=workspace.recordings[0];recording.snapshotIds.push(negative.id);recording.angleGraph=createSnapshotAngleGraph([view,negative,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
  const initial=resolveSnapshot(workspace,negative.id),authored=prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:negative.id,state:'saved',beforeDrawing:initial.drawing,drawing:setDepthOffset(initial.drawing,cid('back-fill'),2,'LAYER')}).workspace,mirrored=resolveSnapshot(authored,'side');
  expect(mirrored.drawing.fills.find(fill=>fill.id===cid('front-fill'))!.depthOffset).toBe(2);expect(order(mirrored)[0]).toBe(cid('front-fill'));
  const local=prepareSnapshotLocalDrawingEdit(authored,{snapshotId:'side',state:'saved',beforeDrawing:mirrored.drawing,drawing:setDepthOffset(mirrored.drawing,cid('front-fill'),0,'LAYER')}).workspace,loaded=reload(local);expect(resolveSnapshot(loaded,'side').drawing.fills.find(fill=>fill.id===cid('front-fill'))!.depthOffset).toBe(0);expect(fill(loaded,negative.id).depthOffset).toBe(2);expect(loaded.recordings[0].tracks).toEqual([]);
 });
 it('ignores retained transparent depth and restores it when inherited or local color becomes opaque',()=>{
  const {project}=fixture(1),workspace=reload(edit(project,2).project.recordingSnapshots!);workspace.library.fills[cid('back-fill')].color='transparent';
  const transparent=resolveSnapshot(workspace,'view');expect(fill(workspace)).toMatchObject({color:'transparent',depthOffset:2});expect(order(transparent)[0]).not.toBe(cid('back-fill'));
  const local=prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'view',state:'saved',beforeDrawing:transparent.drawing,drawing:changePaint(transparent.drawing,cid('back-fill'),{color:'black'})}).workspace;expect(order(resolveSnapshot(local,'view'))[0]).toBe(cid('back-fill'));
  const side=resolveSnapshot(workspace,'side'),restored=prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'side',state:'saved',beforeDrawing:side.drawing,drawing:changePaint(side.drawing,cid('back-fill'),{color:'white'})}).workspace;
  expect(order(resolveSnapshot(restored,'side')).indexOf(cid('back-fill'))).toBeLessThan(order(resolveSnapshot(restored,'side')).indexOf(cid('front-0')));expect(fill(reload(local))).toMatchObject({color:'black',depthOffset:2});
 });
 it('uses existing dominant-basis discrete metadata between real views and rejects differing appearance on real insertion',()=>{
  const {project}=fixture(),workspace=edit(project,2).project.recordingSnapshots!;
  for(const [x,offset] of [[0,2],[30,2],[45,2],[60,0],[90,0]]){const result=evaluateRecordingSnapshot(workspace,'recording',{angle:{x,y:0}});expect(result.drawing.fills.find(fill=>fill.id===cid('back-fill'))!.depthOffset??0).toBe(offset);expect(result.drawing.fills).toHaveLength(3);}
  expect(()=>prepareSnapshotBatch({...project,recordingSnapshots:workspace},{commands:[{op:'createSnapshot',angle:{x:60,y:0}}]})).toThrow(/differing membership, appearance, or material/);expect(workspace.recordings[0].tracks).toEqual([]);
  const equal=fixture(1),inserted=prepareSnapshotBatch(equal.project,{commands:[{op:'createSnapshot',angle:{x:60,y:0}}]}).recordingSnapshots,created=inserted.recordings[0].activeSnapshotId!;expect(fill(reload(inserted),created).depthOffset).toBe(1);
 });
 it('moves saved and draft depth records and preserves metadata through independent clones and identity remapping',()=>{
  const {project,view}=fixture();view.layers.push({kind:'original',id:'destination',name:'Destination',visible:true,locked:false,items:[]});
  const workspace=structuredClone(edit(project,2).project.recordingSnapshots!),snapshot=workspace.snapshots.find(snapshot=>snapshot.id==='view')!;snapshot.draft={angle:{...snapshot.angle},channels:[],deformation:{...emptySnapshotDeformationState(),layers:{[cid('back-layer')]:{paintAppearance:{[cid('back-fill')]:{kind:'fill',depthOffset:1}}}}}};
  const before=resolveSnapshot(workspace,'view'),moved=prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'view',state:'active-draft',beforeDrawing:before.drawing,drawing:movePaint(before.drawing,cid('back-fill'),'destination')}).workspace,owner=moved.snapshots.find(snapshot=>snapshot.id==='view')!;
  expect(owner.deformation.layers.destination.paintAppearance?.[cid('back-fill')]).toMatchObject({depthOffset:2,depthScope:'LAYER'});expect(owner.draft!.deformation.layers.destination.paintAppearance?.[cid('back-fill')]).toEqual({kind:'fill',depthOffset:1});expect(fill(reload(moved))).toMatchObject({depthOffset:1,depthScope:'LAYER'});
  const cloned=prepareSnapshotBatch({...project,recordingSnapshots:workspace},{commands:[{op:'selectSnapshot',snapshotId:'side'},{op:'cloneLayers',sourceSnapshotId:'view'}]}),map=cloned.idMaps[0].idMap,copy=resolveSnapshot(reload(cloned.recordingSnapshots),'side').drawing.fills.find(fill=>fill.id===map[cid('back-fill')]);expect(copy).toMatchObject({depthOffset:2,depthScope:'LAYER'});
  const remapped=remapDrawingIdentities(before.drawing,id=>`copy:${id}`);expect(remapped.fills.find(fill=>fill.id===`copy:${cid('back-fill')}`)).toMatchObject({depthOffset:1,depthScope:'LAYER'});
 });
 it('keeps fill depth through a source curve split and live boundary remapping',()=>{
  const {project}=fixture(1),edited=edit(project,2).project;let index=0;const intent=createCurveSplitIntent(project.drawing,'back-0',.4,{allocateId:()=>`split-${++index}`}),drawing=applyCurveSplitIntent(project.drawing,intent).document;
  const next=prepareSnapshotEdit(snapshotEditContext(edited,true),{kind:'original-geometry',drawing,intent}).project.recordingSnapshots!,actual=fill(reload(next));expect(actual).toMatchObject({depthOffset:2,depthScope:'LAYER'});expect(actual.boundary.map(use=>use.id)).toContain(cid(intent.childCurveIds[0]));expect(actual.boundary.map(use=>use.id)).toContain(cid(intent.childCurveIds[1]));expect(actual.boundary.map(use=>use.id)).not.toContain(cid('back-0'));
 });
 it('invalidates warm appearance and paint keys while preserving membership and cold evaluation parity',()=>{
  const {project}=fixture(),context=prepareRecordingContext(project.recordingSnapshots,{immutableInputs:true,diagnostics:'preview'}),before=context.sample('recording',{angle:{x:30,y:0}}),workspace=edit(project,2).project.recordingSnapshots!,after=context.fork(workspace).sample('recording',{angle:{x:30,y:0}}),cold=evaluateRecordingSnapshot(reload(workspace),'recording',{angle:{x:30,y:0},diagnostics:'preview'});
  expect(after.drawing.fills).not.toEqual(before.drawing.fills);expect(after.drawing.layers).toEqual(before.drawing.layers);expect(after.drawing.curves).toEqual(before.drawing.curves);expect(order(after)).toEqual(order(cold));expect(after.drawing).toEqual(cold.drawing);
 });
 it('keeps the shared scene paint adapter tied to original fill siblings and mask ownership',()=>{
  const source=setDepthOffset(drawingFor(['front','back']),'back-fill',2,'LAYER'),extra=drawingFor(['extra']),scene={...emptyRecordingScene('scene'),instances:[{id:'extra',artworkId:'extra',name:'Extra'},{id:'main',artworkId:'main',name:'Main'}]},result=evaluateScene(scene,id=>id==='main'?source:extra),ids=result.paintBatches.map(batch=>batch.owner??batch.item.id),back=instanceObjectId('main','back-fill');
  expect(ids.indexOf(instanceObjectId('extra','extra-fill'))).toBeLessThan(ids.indexOf(back));expect(ids.indexOf(back)).toBeLessThan(ids.indexOf(instanceObjectId('main','front-0')));expect(result.paintBatches.find(batch=>batch.item.id===back)!.layerId).toBe(instanceObjectId('main','back-layer'));
  const transparent=changePaint(source,'back-fill',{color:'transparent'}),masked=evaluateScene(scene,id=>id==='main'?transparent:extra),maskedIds=masked.paintBatches.map(batch=>batch.owner??batch.item.id);expect(maskedIds.indexOf(back)).toBeGreaterThan(maskedIds.indexOf(instanceObjectId('main','front-0')));
 });
 it('validates local patches and canonical JSON with the shared integer/scope contract',()=>{
  expect(()=>validateSnapshotPaintAppearance({fill:{kind:'fill',depthOffset:0,depthScope:'LAYER'}})).not.toThrow();expect(()=>validateSnapshotPaintAppearance({fill:{kind:'fill',depthOffset:null,depthScope:null}})).not.toThrow();
  for(const patch of [{depthOffset:.5},{depthOffset:Infinity},{depthOffset:10001},{depthOffset:'1'},{depthScope:'SCENE'},{localPaintOrder:true}])expect(()=>validateSnapshotPaintAppearance({fill:{kind:'fill',...patch}})).toThrow();
  const {workspace}=fixture(1);expect(fill(reload(workspace))).toMatchObject({depthOffset:1,depthScope:'LAYER'});for(const patch of [{depthOffset:.1},{depthOffset:10001},{depthScope:'SCENE'}]){const broken=structuredClone(workspace);Object.assign(broken.library.fills[cid('back-fill')],patch);expect(()=>parseRecordingSnapshots(broken)).toThrow();}
 });
 it('exposes one atomic public setDepth command for curves or fills, with preview, Save, JSON, and Undo',()=>{
  const {project,view}=fixture();view.draft={angle:{...view.angle},channels:[],deformation:emptySnapshotDeformationState()};const h=apiFor(project),commands=[{op:'setDepth' as const,fillId:cid('back-fill'),offset:2,scope:'LAYER' as const},{op:'setDepth' as const,curveId:cid('front-0'),offset:1,scope:'LAYER' as const}];
  expect(snapshotCommandNames).toContain('setDepth');const preview=prepareSnapshotPreview(project,{commands});expect(fill(preview.recordingSnapshots).depthOffset).toBe(2);h.value(h.api.snapshot({commands}));expect(h.past).toEqual([project]);expect(fill(h.project().recordingSnapshots!).depthOffset).toBe(2);expect(fill(h.project().recordingSnapshots!,'view',false).depthOffset??0).toBe(0);h.value(h.api.snapshot({commands:[{op:'updateSnapshot'}]}));expect(fill(reload(h.project().recordingSnapshots!),'view',false).depthOffset).toBe(2);expect(h.project().drawing).toBe(project.drawing);h.value(h.api.undo());expect(fill(h.project().recordingSnapshots!,'view',false).depthOffset??0).toBe(0);h.value(h.api.redo());expect(fill(h.project().recordingSnapshots!,'view',false).depthOffset).toBe(2);
 });
 it('rejects invalid, locked, transparent, missing, and intermediate API targets atomically',()=>{
  const {project}=fixture(),h=apiFor(project),before=JSON.stringify(project);
  for(const command of [{op:'setDepth',offset:1},{op:'setDepth',curveId:cid('back-0'),fillId:cid('back-fill'),offset:1},{op:'setDepth',fillId:cid('back-fill'),offset:.2},{op:'setDepth',fillId:cid('back-fill'),offset:1,scope:'SCENE'},{op:'setDepth',fillId:cid('back-0'),offset:1},{op:'setDepth',fillId:'missing',offset:1}])expect(h.api.snapshot({commands:[{op:'setDepth',fillId:cid('back-fill'),offset:2,scope:'LAYER'},command as SnapshotCommand]}).ok).toBe(false);
  expect(h.past).toEqual([]);expect(JSON.stringify(h.project())).toBe(before);
  for(const patch of [{locked:true},{color:'transparent' as const}]){const copy=structuredClone(project);Object.assign(copy.recordingSnapshots.library.fills[cid('back-fill')],patch);expect(apiFor(copy).api.snapshot({commands:[{op:'setDepth',fillId:cid('back-fill'),offset:1}]}).ok).toBe(false);}
  expect(h.api.snapshot({commands:[{op:'setAngle',angle:{x:45,y:0}},{op:'setDepth',fillId:cid('back-fill'),offset:1}]}).ok).toBe(false);expect(h.past).toEqual([]);
 });
});
