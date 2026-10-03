import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {serializeProject} from '../app/autosave';
import {prepareSnapshotBatch} from '../app/recordingSnapshotApi';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {deleteCurves,deleteLayer} from '../domain/drawing/commands';
import {emptyDrawing,parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {canonicalElementId,drawingSnapshotForArtwork} from '../domain/recordingSnapshot/sources';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../domain/recordingSnapshot/evaluation';
import {emptySnapshotDeformationState,type RecordingSnapshotWorkspace,type SnapshotPropertyResponses} from '../domain/recordingSnapshot/model';
import {createWarpGrid} from '../domain/vectorWarp/model';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import type {SnapshotCommand} from '../domain/recordingSnapshot/commands';

const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
const workspace=()=>useEditor.getState().project.recordingSnapshots!;
function command(commands:SnapshotCommand[]){const plan=prepareSnapshotBatch(useEditor.getState().project,{commands});useEditor.getState().commitRecordingSnapshots(plan.recordingSnapshots);return plan;}
function editSource(change:(drawing:DrawingDocument)=>DrawingDocument){const state=useEditor.getState();state.beginEdit();try{state.setDrawing(change(state.project.drawing!));}finally{state.endEdit();}}
function setup(){
 const drawing:DrawingDocument={...emptyDrawing(),mirrorAxisX:0,mirrorEditing:{enabled:false,curvePairs:[{id:'pair',a:'gone',b:'live',reverse:false}]},
  nodes:[{id:'gone-node',position:[0,0]},{id:'live-node',position:[0,0]}],
  curves:[{id:'gone',name:'Left loop',nodes:['gone-node','gone-node'],handles:[[-1,1],[-1,-1]],visible:true,locked:false,width:.01},{id:'live',name:'Right loop',nodes:['live-node','live-node'],handles:[[1,1],[1,-1]],visible:true,locked:false,width:.01}],
  fills:[{id:'fill',name:'Left fill',boundary:[{id:'gone',reverse:false}],color:'black',visible:true,locked:false}],
  offsets:[{id:'offset',name:'Left offset',source:[{id:'gone',reverse:false}],distance:.02,start:0,end:1,taper:0,width:.01,visible:true,locked:false}],
  layers:[{id:'gone-layer',name:'Left layer',items:['gone','fill','offset'],visible:true,locked:false},{id:'live-layer',name:'Right layer',items:['live'],visible:true,locked:false}],
  endpointLinks:[{id:'link',a:{curveId:'gone',end:0},b:{curveId:'live',end:0}}],
  displayIntervals:[{id:'interval',anchor:{id:'gone',reverse:false},scope:'CURVE',ranges:[{id:'range',start:.2,end:.8}]},{id:'live-interval',anchor:{id:'live',reverse:false},scope:'CURVE',ranges:[{id:'live-range',start:.1,end:.9}]}],
 };
 expect(()=>parseDrawing(drawing)).not.toThrow();
 useEditor.getState().load({...createEmptyProject(),...saveDrawingSnapshot({drawing},'Original upload')});
 const project=useEditor.getState().project,asset=project.drawingSnapshots!.activeId!,source=drawingSnapshotForArtwork(workspace(),asset)!,id=(raw:string)=>canonicalElementId(asset,raw);
 command([{op:'createTriangulatedRecording',name:'Shared views'},{op:'pasteLayers',sourceSnapshotId:source.id}]);
 const recordingId=workspace().activeRecordingId!,recording=()=>workspace().recordings.find(r=>r.id===recordingId)!,front=recording().activeSnapshotId!;
 command([{op:'createSnapshot',angle:{x:-90,y:0},name:'Left'},{op:'pasteLayers',sourceSnapshotId:source.id}]);
 expect(recording().snapshotIds).toHaveLength(9);expect(recording().snapshotIds.some(sid=>workspace().snapshots.find(s=>s.id===sid)?.inputMirror)).toBe(true);
 const left=recording().activeSnapshotId!;
 command([{op:'createRecording',name:'Other recording'},{op:'pasteLayers',sourceSnapshotId:source.id}]);
 const other=workspace().recordings.find(r=>r.id===workspace().activeRecordingId)!;
 useEditor.setState({past:[],future:[]});return {id,sourceId:source.id,recordingId,front,left,otherId:other.id,recording};
}
function assertNoRenderedOwner(w:RecordingSnapshotWorkspace,removedIds:string[]){
 for(const snapshot of w.snapshots){const result=resolveSnapshot(w,snapshot.id,{useDraft:false});for(const id of removedIds){expect(result.drawing.curves.map(c=>c.id)).not.toContain(id);expect(result.paintBatches.map(batch=>batch.owner??batch.item.id)).not.toContain(id);}expect(result.diagnostics.filter(issue=>['MISSING_ELEMENT','MISSING_LAYER','MISSING_RELATION'].includes(issue.code))).toEqual([]);}
 for(const recording of w.recordings.filter(r=>r.mode==='triangulated'))for(const angle of [{x:-45,y:20},{x:45,y:-20}]){const result=evaluateRecordingSnapshot(w,recording.id,{angle,useDraft:false});expect(result.angleSurface?.outsideCurves.some(curve=>removedIds.includes(curve.curveId))).toBe(false);for(const batch of result.paintBatches)expect(removedIds).not.toContain(batch.owner??batch.item.id);}
}

test('real source curve deletion removes canonical dependents in every view and recording, preserves the empty layer, and Undo restores one transaction',()=>{
 const f=setup(),before=useEditor.getState().project,archive=before.recordingSnapshots!.legacyArchive,checkpoint=before.drawingSnapshots;
 editSource(drawing=>deleteCurves(drawing,['gone']));const after=useEditor.getState().project,w=workspace(),gone=['gone','gone-node','fill','offset'].map(f.id);
 expect(useEditor.getState().past).toHaveLength(1);for(const map of Object.values(w.library))for(const id of gone)expect(Object.hasOwn(map,id)).toBe(false);
 expect(drawingSnapshotForArtwork(w,before.drawingSnapshots!.activeId!)!.layers.find(layer=>layer.id===f.id('gone-layer'))).toMatchObject({kind:'original',items:[]});
 expect(w.snapshots.find(snapshot=>snapshot.id===f.front)!.layers).toHaveLength(2);expect(w.legacyArchive).toEqual(archive);expect(after.drawingSnapshots).toBe(checkpoint);
 assertNoRenderedOwner(w,gone);expect(parseRecordingSnapshots(w)).toEqual(w);
 const serialized=serializeProject(after);useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);expect(workspace().library.curves[f.id('gone')]).toBeDefined();
 useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);useEditor.getState().load(parseLandmarks(serialized));assertNoRenderedOwner(workspace(),gone);expect(workspace().library.curves[f.id('gone')]).toBeUndefined();
});

test('source layer deletion follows all reference aliases and clears layer poses, tracks, bindings and properties',()=>{
 const f=setup(),prepared=structuredClone(workspace()),target=prepared.snapshots.find(s=>s.id===f.front)!,layer=target.layers.find(layer=>layer.kind==='reference'&&layer.baseLayerId===f.id('gone-layer'))!.id;
 const grid=createWarpGrid({min:[-1,-1],max:[1,1]});target.deformation.warps=[{id:'kept-warp',name:'Shared domain',restGrid:grid,grid}];target.deformation.bindings=[{layerId:layer,warpId:'kept-warp'}];target.deformation.layers[layer]={depth:2};target.inheritedState={...emptySnapshotDeformationState(),layers:{[layer]:{depth:1}}};
 const recording=prepared.recordings.find(r=>r.id===f.recordingId)!;recording.tracks.push({id:'dead-layer-track',channel:'depth',targetId:layer,keys:[{id:'dead-layer-key',angle:target.angle,value:3}]});target.authored.push({trackId:'dead-layer-track',keyId:'dead-layer-key'});
 const edge=recording.angleGraph!.mesh.edges[0].id,properties:SnapshotPropertyResponses={edges:{[edge]:[{target:{kind:'interval-endpoint',layerId:layer,sourceTrackId:f.id('live-interval'),rangeId:f.id('live-range'),end:'end'},knots:[[.5,.4]]}]},triangles:{}};
 recording.angleGraph!.propertyResponses=properties;
 // Exact serialized recovery evidence is intentionally not a live response.
 recording.angleGraph!.migration={sourceRecordingId:'archive',sourceMode:'endpoint-pair',sourceRecordingJSON:JSON.stringify({id:'archive',mode:'endpoint-pair',properties}),sourceSnapshotsJSON:JSON.stringify([target])};
 useEditor.setState({project:{...useEditor.getState().project,recordingSnapshots:prepared},past:[],future:[]});const before=useEditor.getState().project;
 editSource(drawing=>deleteLayer(drawing,'gone-layer'));const w=workspace();
 for(const snapshot of w.snapshots){expect(snapshot.layers.some(value=>value.id===layer||value.kind==='reference'&&value.baseLayerId===f.id('gone-layer'))).toBe(false);expect(snapshot.deformation.layers[layer]).toBeUndefined();expect(snapshot.deformation.bindings.some(binding=>binding.layerId===layer)).toBe(false);expect(snapshot.inheritedState?.layers[layer]).toBeUndefined();}
 const changed=w.recordings.find(r=>r.id===f.recordingId)!;expect(changed.tracks.some(track=>track.id==='dead-layer-track')).toBe(false);expect(changed.angleGraph!.propertyResponses!.edges[edge]).toEqual([]);expect(changed.angleGraph!.migration).toEqual(recording.angleGraph!.migration);
 expect(w.snapshots.find(s=>s.id===f.front)!.authored).toEqual([]);assertNoRenderedOwner(w,[f.id('gone'),f.id('fill'),f.id('offset')]);expect(parseRecordingSnapshots(w)).toEqual(w);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);
});

test('local exclude and local layer removal do not delete source geometry or another recording',()=>{
 const f=setup(),source=workspace().snapshots.find(s=>s.id===f.sourceId)!,library=workspace().library;
 command([{op:'selectRecording',recordingId:f.recordingId},{op:'selectSnapshot',snapshotId:f.left}]);const layer=workspace().snapshots.find(s=>s.id===f.left)!.layers[0].id;
 command([{op:'excludeElements',layerId:layer,elementIds:[f.id('gone')]}]);expect(workspace().library).toEqual(library);expect(workspace().snapshots.find(s=>s.id===f.sourceId)).toEqual(source);expect(resolveSnapshot(workspace(),f.front).drawing.curves.map(curve=>curve.id)).toContain(f.id('gone'));
 command([{op:'removeLayers',layerIds:[layer]}]);expect(workspace().library.curves[f.id('gone')]).toEqual(library.curves[f.id('gone')]);expect(workspace().snapshots.find(s=>s.id===f.sourceId)).toEqual(source);
 const other=workspace().recordings.find(r=>r.id===f.otherId)!;expect(resolveSnapshot(workspace(),other.activeSnapshotId!).drawing.curves.map(curve=>curve.id)).toContain(f.id('gone'));
});

test('source deletion prunes saved, inherited, draft, interval, mirror and scalar-response references while preserving unrelated values and archives',()=>{
 const f=setup(),w=structuredClone(workspace()),view=w.snapshots.find(s=>s.id===f.front)!,layer=view.layers[0].id,track=f.id('interval'),range=f.id('range'),node=f.id('gone-node'),curve=f.id('gone'),live=f.id('live'),liveNode=f.id('live-node'),link=f.id('link');
 const appearance=w.snapshots.find(s=>s.id===f.sourceId)!.relations.displayIntervals!.add!.find(t=>t.id===track)!;
 const state={...emptySnapshotDeformationState(),layers:{[layer]:{shape:{nodes:{[node]:[.1,.2] as [number,number],[liveNode]:[.3,.4] as [number,number]},handles:{[curve]:[[.1,0],[.2,0]] as [[number,number],[number,number]],[live]:[[.3,0],[.4,0]] as [[number,number],[number,number]]}},visibility:{[curve]:false,[live]:true},elementPlacements:{[curve]:{translation:[.1,0] as [number,number],rotation:0,scale:1}},intervals:{[track]:{appearance,enabled:{[range]:false}}}}},relationPositions:{'link-position':{sourceLinkIds:[link],offset:[.1,0] as [number,number]}},intervalMaterialIssues:{[track]:{sourceSnapshotId:f.sourceId,sourceSignature:'old source',message:'Old interval issue'}}};
 view.deformation=structuredClone(state);view.inheritedState=structuredClone(state);view.draft={angle:view.angle,deformation:structuredClone(state),channels:[{trackId:'interval-pose',keyId:'interval-key'}]};
 // Local relationships depending on deleted geometry disappear; an unrelated
 // local group and surviving member of a mixed group remain live.
 view.relations={endpointLinks:{update:[{id:link,a:{curveId:curve,end:0},b:{curveId:live,end:0}}],disable:[link]},groups:{add:[{id:'local-group',name:'Live',visible:true,locked:false,curveIds:[live]},{id:'mixed-group',name:'Mixed',visible:true,locked:false,curveIds:[curve,live]}]},displayIntervals:{update:[appearance],disable:[track]}};
 const recording=w.recordings.find(r=>r.id===f.recordingId)!;
 recording.tracks.push({id:'interval-pose',channel:'interval',targetId:layer,sourceTrackId:track,keys:[{id:'interval-key',angle:view.angle,value:{appearance,enabled:{[range]:false}}}],draft:{angle:view.angle,value:{appearance,enabled:{[range]:false}}}},{id:'shape-pose',channel:'shape',targetId:layer,keys:[{id:'shape-key',angle:view.angle,value:state.layers[layer].shape}],draft:{angle:view.angle,value:state.layers[layer].shape}},{id:'element-pose',channel:'visibility',targetId:layer,elementId:curve,keys:[]},{id:'relation-pose',channel:'relationPosition',targetId:'link-position',keys:[]});view.authored=[{trackId:'interval-pose',keyId:'interval-key'},{trackId:'shape-pose',keyId:'shape-key'}];
 const graph=recording.angleGraph!,edge=graph.mesh.edges[0].id,triangle=graph.mesh.triangles[0].id;
 const responses={nodes:{[node]:{x:[[.5,.25] as [number,number]]},[liveNode]:{x:[[.5,.7] as [number,number]]}},handles:{[curve]:[{x:[[.5,.3] as [number,number]]},{}] as [{x:[number,number][]},{}],[live]:[{},{}] as [{},{}]}};
 graph.edgeResponses[edge]=structuredClone(responses);graph.triangleResponses[triangle]={nodes:{[node]:{}},handles:{[curve]:[{},{}]}};
 const properties:SnapshotPropertyResponses={edges:{[edge]:[{target:{kind:'interval-endpoint',layerId:layer,sourceTrackId:track,rangeId:range,end:'start'},knots:[[.5,.4]]}]},triangles:{}};graph.propertyResponses=structuredClone(properties);graph.correctionFrames=[{id:'correction',angle:{x:15,y:15},status:'draft',edgeResponses:{[edge]:structuredClone(responses)},triangleResponses:{[triangle]:structuredClone(graph.triangleResponses[triangle])},propertyResponses:structuredClone(properties)}];
 graph.orphanedResponses=[{id:'recovery',reason:'mesh-change',message:'Historical recovery only',mesh:structuredClone(graph.mesh),edgeResponses:structuredClone(graph.edgeResponses),triangleResponses:structuredClone(graph.triangleResponses),propertyResponses:structuredClone(properties)}];
 const pairStart={...structuredClone(view),id:'pair-start',angle:{x:0,y:0},authored:[],draft:undefined},pairEnd={...structuredClone(view),id:'pair-end',angle:{x:90,y:0},authored:[],draft:undefined};w.snapshots.push(pairStart,pairEnd);
 w.recordings.push({id:'endpoint-pair',name:'Pair',mode:'endpoint-pair',angle:{x:0,y:0},snapshotIds:[pairStart.id,pairEnd.id],tracks:[],endpointPair:{axis:'x',startSnapshotId:pairStart.id,endSnapshotId:pairEnd.id,responses:structuredClone(responses),draft:{angle:{x:45,y:0},responses:structuredClone(responses)}}});
 useEditor.setState({project:{...useEditor.getState().project,recordingSnapshots:w},past:[],future:[]});const before=useEditor.getState().project;
 editSource(drawing=>deleteCurves(drawing,['gone']));const after=workspace(),changed=after.snapshots.find(s=>s.id===view.id)!,nextRecording=after.recordings.find(r=>r.id===recording.id)!,nextGraph=nextRecording.angleGraph!;
 expect(useEditor.getState().project.drawing!.fills).toEqual([]);expect(useEditor.getState().project.drawing!.offsets).toEqual([]);expect(useEditor.getState().project.drawing!.layers[0].items).toEqual([]);
 for(const current of [changed.deformation,changed.inheritedState!,changed.draft!.deformation]){expect(current.layers[layer].shape!.nodes).toEqual({[liveNode]:[.3,.4]});expect(current.layers[layer].shape!.handles).toEqual({[live]:[[.3,0],[.4,0]]});expect(current.layers[layer].visibility).toEqual({[live]:true});expect(current.layers[layer].elementPlacements).toEqual({});expect(current.layers[layer].intervals).toEqual({});expect(current.relationPositions).toEqual({});expect(current.intervalMaterialIssues??{}).toEqual({});}
 expect(changed.relations.endpointLinks).toEqual({update:[],disable:[]});expect(changed.relations.displayIntervals).toEqual({update:[],disable:[]});expect(changed.relations.groups!.add!.map(group=>group.curveIds)).toEqual([[live],[live]]);
 expect(nextRecording.tracks.map(t=>t.id)).toEqual(['shape-pose']);expect(changed.authored).toEqual([{trackId:'shape-pose',keyId:'shape-key'}]);expect(changed.draft!.channels).toEqual([]);
 for(const response of [nextGraph.edgeResponses[edge],nextGraph.correctionFrames![0].edgeResponses![edge],after.recordings.find(r=>r.id==='endpoint-pair')!.endpointPair!.responses!,after.recordings.find(r=>r.id==='endpoint-pair')!.endpointPair!.draft!.responses]){expect(response.nodes).toEqual({[liveNode]:responses.nodes[liveNode]});expect(response.handles).toEqual({[live]:[{},{}]});}
 expect(nextGraph.triangleResponses[triangle]).toEqual({nodes:{},handles:{}});expect(nextGraph.propertyResponses!.edges[edge]).toEqual([]);expect(nextGraph.correctionFrames![0].propertyResponses!.edges[edge]).toEqual([]);expect(nextGraph.orphanedResponses).toEqual(graph.orphanedResponses);
 expect(after.snapshots.filter(s=>s.inputMirror).every(s=>s.inputMirror!.curvePairs.length===0)).toBe(true);expect(parseRecordingSnapshots(after)).toEqual(after);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);
});

test('deleting one interval range removes only its live responses and enabled overrides',()=>{
 const f=setup();editSource(drawing=>({...drawing,displayIntervals:drawing.displayIntervals!.map(track=>track.id==='live-interval'?{...track,ranges:[...track.ranges,{id:'removed-range',start:.2,end:.3}]}:track)}));
 const w=structuredClone(workspace()),view=w.snapshots.find(s=>s.id===f.front)!,layer=view.layers.find(layer=>layer.kind==='reference'&&layer.baseLayerId===f.id('live-layer'))!.id,recording=w.recordings.find(r=>r.id===f.recordingId)!,graph=recording.angleGraph!,edge=graph.mesh.edges[0].id;
 const appearance=w.snapshots.find(s=>s.id===f.sourceId)!.relations.displayIntervals!.add!.find(track=>track.id===f.id('live-interval'))!,range=f.id('removed-range'),retained=f.id('live-range'),track=f.id('live-interval');
 view.deformation.layers[layer]={intervals:{[track]:{appearance,enabled:{[range]:false,[retained]:true}}}};
 const responses:SnapshotPropertyResponses={edges:{[edge]:[range,retained].map(rangeId=>({target:{kind:'interval-endpoint',layerId:layer,sourceTrackId:track,rangeId,end:'end'},knots:[[.5,.4]]}))},triangles:{}};graph.propertyResponses=responses;
 useEditor.setState({project:{...useEditor.getState().project,recordingSnapshots:w},past:[],future:[]});
 editSource(drawing=>({...drawing,displayIntervals:drawing.displayIntervals!.map(track=>({...track,ranges:track.ranges.filter(range=>range.id!=='removed-range')}))}));
 const changed=workspace(),state=changed.snapshots.find(s=>s.id===view.id)!.deformation.layers[layer].intervals![track];
 expect(state.enabled).toEqual({[retained]:true});expect(state.appearance!.ranges.map(range=>range.id)).toEqual([retained]);expect(changed.recordings.find(r=>r.id===recording.id)!.angleGraph!.propertyResponses!.edges[edge].map(value=>value.target.rangeId)).toEqual([retained]);expect(changed.library.curves[f.id('live')]).toBeDefined();expect(parseRecordingSnapshots(changed)).toEqual(changed);
});
