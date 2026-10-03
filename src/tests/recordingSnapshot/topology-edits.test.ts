import {expect,test} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {createVectorEditingApi} from '../../app/vectorEditingApi';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {createCurveSplitIntent,applyCurveSplitIntent,mapCurveSplitIntent,createLayerCurveSplitIntent,applyLayerEditIntent,curveSplitIntents,mapLayerEditIntent} from '../../domain/drawing/layerEditIntent';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,upsertDrawingSource,remapDrawingIdentities} from '../../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {createWarpGrid} from '../../domain/vectorWarp/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {splitSnapshotLocalCurve} from '../../domain/recordingSnapshot/topologyEdits';
const cid=(id:string)=>canonicalElementId('$working',id);
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.2,.4],[.7,-.3]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',items:['curve'],visible:true,locked:false}],displayIntervals:[{id:'material',scope:'CURVE',anchor:{id:'curve',reverse:false},ranges:[{id:'range',start:.1,end:.9}]}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing}),workspace=project.recordingSnapshots,source=drawingSnapshotForArtwork(workspace,'$working')!;
 const front=emptyRecordingSnapshot('front','Front','view',{x:0,y:0}),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});
 front.layers=[{kind:'reference',id:'slot',name:'Curve',baseSnapshotId:source.id,baseLayerId:cid('layer')}];side.layers=structuredClone(front.layers);
 side.deformation.layers.slot={shape:{nodes:{[cid('a')]:[.3,.7],[cid('b')]:[-.2,.6]},handles:{[cid('curve')]:[[.1,.2],[-.2,-.1]]}},placement:{...identityScenePlacement(),translation:[.2,-.1],rotation:.3,scaleX:1.2,scaleY:.8},elementPlacements:{[cid('curve')]:{...identityScenePlacement(),translation:[.03,.06]}}};
 const recording=emptySnapshotRecording('recording','Recording');recording.mode='triangulated';recording.snapshotIds=[front.id,side.id];recording.activeSnapshotId=front.id;recording.angleGraph=createSnapshotAngleGraph([front,side].map(value=>({snapshotId:value.id,angle:value.angle})));workspace.snapshots.push(front,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 let next=0;const intent=createCurveSplitIntent(drawing,'curve',.37,{allocateId:()=>`new-${++next}`});return {project,workspace,drawing,source,front,side,intent,canonical:mapCurveSplitIntent(intent,cid)};
}
function commit(f:ReturnType<typeof fixture>){return prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.drawing,f.intent).document,intent:f.intent}).project.recordingSnapshots!;}
function expectPoseSplit(before:DrawingDocument,after:DrawingDocument,intent:ReturnType<typeof fixture>['canonical']){const expected=applyCurveSplitIntent(before,intent,{propagate:true}).document;for(const id of intent.childCurveIds)for(const [i,p] of shapeOf(expected,id).entries())for(const axis of [0,1])expect(shapeOf(after,id)[i][axis]).toBeCloseTo(p[axis],8);}
test('source split preserves distinct 0/90 final controls with shared new IDs, placement, source addresses, archive and reload',()=>{
 const f=fixture(),json=JSON.stringify(f.project),saved=resolveSnapshot(f.workspace,'side',{useDraft:false}).drawing,front=resolveSnapshot(f.workspace,'front',{useDraft:false}).drawing,after=commit(f);
 expect(JSON.stringify(f.project)).toBe(json);expectPoseSplit(saved,resolveSnapshot(after,'side',{useDraft:false}).drawing,f.canonical);expectPoseSplit(front,resolveSnapshot(after,'front',{useDraft:false}).drawing,f.canonical);
 expect(after.library.curves[f.canonical.curveId]).toBeUndefined();for(const id of f.canonical.childCurveIds)expect(after.library.curves[id]).toBeDefined();
 expect(after.snapshots.find(value=>value.id==='side')!.deformation.layers.slot.placement).toEqual(f.side.deformation.layers.slot.placement);expect(after.snapshots.find(value=>value.id==='side')!.layers).toEqual(f.side.layers);expect(after.legacyArchive).toEqual(f.workspace.legacyArchive);expect(parseRecordingSnapshots(after)).toEqual(after);
});
test('nonlinear Warp and draft are rebased locally without resetting the Warp',()=>{
 const f=fixture(),grid=createWarpGrid({min:[-.5,-.5],max:[1.5,1.5]},1,1),warped=structuredClone(grid);warped.nodes[0].position[1]+=.23;warped.nodes[3].handleU[1]+=.3;
 f.side.deformation.warps=[{id:'warp',name:'Warp',restGrid:grid,grid:warped}];f.side.deformation.bindings=[{layerId:'slot',warpId:'warp'}];f.side.draft={angle:f.side.angle,channels:[],deformation:{warps:[],bindings:[],layers:{slot:{shape:{nodes:{[cid('a')]:[.4,.9]},handles:{[cid('curve')]:[[.2,-.1],[.3,.1]]}}}},relationPositions:{}}};
 const saved=resolveSnapshot(f.workspace,'side',{useDraft:false}).drawing,draft=resolveSnapshot(f.workspace,'side',{useDraft:true}).drawing,after=commit(f);
 expectPoseSplit(saved,resolveSnapshot(after,'side',{useDraft:false}).drawing,f.canonical);expectPoseSplit(draft,resolveSnapshot(after,'side',{useDraft:true}).drawing,f.canonical);expect(after.snapshots.find(value=>value.id==='side')!.deformation.warps).toEqual(f.side.deformation.warps);
});
test('excluded old source membership excludes both descendants',()=>{const f=fixture();f.side.layers=[{...f.side.layers[0],kind:'reference',baseSnapshotId:f.source.id,baseLayerId:cid('layer'),membership:{excludeElementIds:[cid('curve')]}}];const after=commit(f),side=after.snapshots.find(value=>value.id==='side')!;expect(side.layers[0].kind==='reference'&&side.layers[0].membership?.excludeElementIds).toEqual(f.canonical.childCurveIds);expect(resolveSnapshot(after,'side').drawing.curves).toEqual([]);});
test('local child split breaks correspondence and preserves every other basis and canonical parent',()=>{
 const f=fixture(),before=resolveSnapshot(f.workspace,'side',{useDraft:false}).drawing;let n=0;const intent=createCurveSplitIntent(before,cid('curve'),.37,{allocateId:()=>`local-${++n}`}),result=splitSnapshotLocalCurve(f.workspace,'side',intent);
 expect(result.diagnostics[0].code).toBe('LOCAL_SPLIT_CORRESPONDENCE');expect(result.workspace.snapshots.find(value=>value.id==='front')).toEqual(f.front);expect(result.workspace.snapshots.find(value=>value.id===f.source.id)).toEqual(f.source);expect(result.workspace.library.curves[cid('curve')]).toEqual(f.workspace.library.curves[cid('curve')]);expect(result.workspace.recordings).toEqual(f.workspace.recordings);expectPoseSplit(before,resolveSnapshot(result.workspace,'side').drawing,intent);expect(parseRecordingSnapshots(result.workspace)).toEqual(result.workspace);
});
test('unsupported live legacy shape trajectory reports its exact mode and target atomically',()=>{const f=fixture();f.workspace.recordings[0].mode='tracks';delete f.workspace.recordings[0].angleGraph;f.workspace.recordings[0].tracks=[{id:'old-shape',channel:'shape',targetId:'slot',keys:[{id:'key',angle:{x:90,y:0},value:{nodes:{},handles:{[cid('curve')]:[[.1,.2],[.3,.1]]}}}]}];const before=JSON.stringify(f.workspace);expect(()=>commit(f)).toThrow(/tracks Recording recording, shape track old-shape, target slot/);expect(JSON.stringify(f.workspace)).toBe(before);});
test('explicit intent rejects altered submitted geometry before mutation',()=>{const f=fixture(),drawing=applyCurveSplitIntent(f.drawing,f.intent).document;drawing.curves[0].handles[0][1]+=.4;expect(()=>prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing,intent:f.intent})).toThrow(/intent and submitted/);});
test('source split preserves curve material overrides, range enabled state and reference-local groups',()=>{
 const f=fixture(),basis=resolveSnapshot(f.workspace,'side',{useDraft:false}).source,appearance=structuredClone(basis.displayIntervals![0]);appearance.ranges[0].start=.22;appearance.ranges[0].end=.81;
 f.side.deformation.layers.slot.intervals={[appearance.id]:{appearance,enabled:{[cid('range')]:false}}};f.side.relations.groups={add:[{id:'local-group',name:'Local',visible:true,locked:false,curveIds:[cid('curve')]}]};
 const before=resolveSnapshot(f.workspace,'side',{useDraft:false}).drawing,after=commit(f),actual=resolveSnapshot(after,'side',{useDraft:false}).drawing,expected=applyCurveSplitIntent(before,f.canonical,{propagate:true}).document;
 for(const track of expected.displayIntervals??[]){const got=actual.displayIntervals?.find(value=>value.id===track.id)!;expect(got).toBeDefined();for(const [i,range] of track.ranges.entries()){expect(got.ranges[i].start).toBeCloseTo(range.start,6);expect(got.ranges[i].end).toBeCloseTo(range.end,6);}}
 expect(actual.groups!.find(value=>value.id==='local-group')!.curveIds).toEqual(f.canonical.childCurveIds);const local=after.snapshots.find(value=>value.id==='side')!;expect(local.deformation.layers.slot.intervals![f.canonical.intervals[0].rightTrackId].enabled[f.canonical.intervals[0].ranges[0].rightRangeId]).toBe(false);
});
test('grandchild local residuals preserve a distinct pose after parent-first rebasing',()=>{
 const f=fixture(),child=emptyRecordingSnapshot('grandchild','Grandchild');child.parentSnapshotId=f.side.id;child.layers=[{kind:'reference',id:'child-slot',name:'Child',baseSnapshotId:f.side.id,baseLayerId:'slot'}];child.deformation.layers['child-slot']={shape:{nodes:{[cid('b')]:[.03,-.15]},handles:{[cid('curve')]:[[-.1,.09],[.08,.04]]}}};f.workspace.snapshots.unshift(child);
 const before=resolveSnapshot(f.workspace,child.id,{useDraft:false}).drawing,after=commit(f);expectPoseSplit(before,resolveSnapshot(after,child.id,{useDraft:false}).drawing,f.canonical);expect(after.snapshots.find(value=>value.id===child.id)!.parentSnapshotId).toBe(f.side.id);
});
test('automatic profile mirror keeps same-ID reflection and local pose through parent split',()=>{
 const f=fixture();f.front.angle={x:-90,y:0};f.side.parentSnapshotId=f.front.id;f.side.parentLayers={};f.side.inputMirror={axisX:.5,curvePairs:[]};f.side.layers=[{kind:'reference',id:'slot',name:'Mirror',baseSnapshotId:f.front.id,baseLayerId:'slot'}];f.workspace.recordings[0].angleGraph=createSnapshotAngleGraph([f.front,f.side].map(value=>({snapshotId:value.id,angle:value.angle})));
 const before=resolveSnapshot(f.workspace,f.side.id,{useDraft:false}).drawing,after=commit(f);expectPoseSplit(before,resolveSnapshot(after,f.side.id,{useDraft:false}).drawing,f.canonical);expect(after.snapshots.find(value=>value.id===f.side.id)!.inputMirror).toEqual(f.side.inputMirror);
});
test('source transaction transfers live scalar graph responses through split and reload',()=>{
 const f=fixture(),graph=f.workspace.recordings[0].angleGraph!,edge=graph.mesh.edges[0];graph.edgeResponses[edge.id]={nodes:{[cid('a')]:{x:[[.3,.85]],y:[[.4,-.2]]}},handles:{[cid('curve')]:[{x:[[.6,.15]],y:[[.5,1.4]]},{x:[[.4,-.6]],y:[[.7,.1]]}]}};
 const angles=[9,27,43,69,81],before=angles.map(x=>evaluateRecordingSnapshot(f.workspace,'recording',{angle:{x,y:0},useDraft:false,diagnostics:'preview'}).drawing),after=commit(f),loaded=parseRecordingSnapshots(after);
 angles.forEach((x,index)=>expectPoseSplit(before[index],evaluateRecordingSnapshot(loaded,'recording',{angle:{x,y:0},useDraft:false,diagnostics:'preview'}).drawing,f.canonical));
 for(const responses of Object.values(loaded.recordings[0].angleGraph!.responseExpressions??{}))for(const control of [...Object.values(responses.nodes),...Object.values(responses.handles).flat()])for(const expression of Object.values(control))for(const term of expression.terms)for(const {basis} of term.basis)if(basis.target.kind==='handle')expect(basis.target.curveId).not.toBe(cid('curve'));
});
test.each([[false,true],[true,true],[false,false],[true,false]])('paired parent split preserves asymmetric mirrored descendants, reverse=%s enabled=%s',(reverse,enabled)=>{
 const f=fixture(),d=f.drawing;d.displayIntervals=[];
 const points=shapeOf(d,'curve').map(([x,y])=>[2-x,y] as [number,number]);if(reverse)points.reverse();
 d.nodes.push({id:'c',position:points[0]},{id:'d',position:points[3]});d.curves.push({...structuredClone(d.curves[0]),id:'partner',nodes:['c','d'],handles:[points[1],points[2]]});d.layers[0].items.push('partner');d.mirrorAxisX=1;d.mirrorEditing={enabled,curvePairs:[{id:'pair',a:'curve',b:'partner',reverse}]};
 f.project.recordingSnapshots=upsertDrawingSource(f.workspace,'$working',d);const workspace=f.project.recordingSnapshots,side=workspace.snapshots.find(value=>value.id==='side')!;side.parentSnapshotId='front';side.parentLayers={};side.layers=[{kind:'reference',id:'slot',name:'Mirror',baseSnapshotId:'front',baseLayerId:'slot'}];side.inputMirror={axisX:1,curvePairs:[{id:cid('pair'),a:cid('curve'),b:cid('partner'),reverse}]};
 side.deformation.layers.slot.shape!.handles[cid('partner')]=[[.1,.2],[-.05,.1]];
 const graph=workspace.recordings[0].angleGraph!,edge=graph.mesh.edges[0];graph.edgeResponses[edge.id]={nodes:{},handles:{[cid('curve')]:[{x:[[.3,.9]]},{y:[[.6,-.2]]}],[cid('partner')]:[{y:[[.4,1.3]]},{x:[[.7,.2]]}]}};const oldIntermediate=evaluateRecordingSnapshot(workspace,'recording',{angle:{x:31,y:0},useDraft:false,diagnostics:'preview'}).drawing;
 const old=resolveSnapshot(workspace,'side',{useDraft:false}).drawing;let next=0;const intent=createLayerCurveSplitIntent(d,'curve',.37,{allocateId:()=>`paired-${++next}`}),canonical=mapLayerEditIntent(intent,cid);expect(curveSplitIntents(intent)).toHaveLength(enabled?2:1);
 const drawing=applyLayerEditIntent(d,intent).document,after=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing,intent}).project.recordingSnapshots!,actual=resolveSnapshot(after,'side',{useDraft:false}).drawing;
 for(const split of curveSplitIntents(canonical))expectPoseSplit(old,actual,split);
 for(const split of curveSplitIntents(canonical))expectPoseSplit(oldIntermediate,evaluateRecordingSnapshot(after,'recording',{angle:{x:31,y:0},useDraft:false,diagnostics:'preview'}).drawing,split);
 if(!enabled)for(const [index,point] of shapeOf(old,cid('partner')).entries())for(const axis of [0,1])expect(shapeOf(actual,cid('partner'))[index][axis]).toBeCloseTo(point[axis],8);
 expect(after.snapshots.find(value=>value.id==='side')!.inputMirror!.curvePairs).toHaveLength(enabled?2:0);expect(parseRecordingSnapshots(after)).toEqual(after);
});
test('JSON source API batches split and later edits through one prepared Snapshot transaction and one Undo',()=>{
 const initial=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
 try{const f=fixture(),old=resolveSnapshot(f.workspace,'side',{useDraft:false}).drawing;useEditor.setState({project:f.project,past:[],future:[]});useWorkspaceMode.getState().setMode('drawing');const api=createVectorEditingApi();
  const result=api.execute({commands:[{op:'splitCurve',curveId:'curve',t:.37,ref:'right'},{op:'renameCurve',curveId:'$right',name:'Renamed right'}]});if(!result.ok)throw Error(result.error.message);
  const after=useEditor.getState().project,intent=result.value.topologyIntents![0],canonical=mapLayerEditIntent(intent,cid);expectPoseSplit(old,resolveSnapshot(after.recordingSnapshots!,'side',{useDraft:false}).drawing,curveSplitIntents(canonical)[0]);expect(after.drawing!.curves.some(curve=>curve.name==='Renamed right')).toBe(true);expect(useEditor.getState().past).toEqual([f.project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(f.project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
 }finally{useEditor.setState(initial,true);useWorkspaceMode.getState().setMode(mode);}
});
test('JSON source API failed mixed split batch leaves project and history byte-for-byte unchanged',()=>{
 const initial=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
 try{const f=fixture();useEditor.setState({project:f.project,past:[],future:[]});useWorkspaceMode.getState().setMode('drawing');const result=createVectorEditingApi().execute({commands:[{op:'splitCurve',curveId:'curve',t:.37},{op:'renameCurve',curveId:'missing',name:'Invalid'}]});expect(result.ok).toBe(false);expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().past).toEqual([]);
 }finally{useEditor.setState(initial,true);useWorkspaceMode.getState().setMode(mode);}
});
test('shared split allocation preserves Snapshot-local material identities while assigning the planned right counterpart',()=>{
 const f=fixture();f.side.relations.displayIntervals={add:[{id:'local-material',scope:'CURVE',anchor:{id:cid('curve'),reverse:false},ranges:[{id:'local-range',start:.15,end:.82}]}]};const source=f.source.source!,related=remapDrawingIdentities(resolveSnapshot(f.workspace,'side',{useDraft:false}).drawing,id=>source.originIds[id]??id);let id=0;
 const intent=createLayerCurveSplitIntent(f.drawing,'curve',.37,{relatedDrawings:[related],allocateId:()=>`material-plan-${++id}`}),drawing=applyLayerEditIntent(f.drawing,intent).document,after=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing,intent}).project.recordingSnapshots!;
 const tracks=resolveSnapshot(after,'side',{useDraft:false}).drawing.displayIntervals!,plan=curveSplitIntents(intent)[0].intervals.find(value=>value.trackId==='local-material')!;expect(tracks.some(track=>track.id==='local-material')).toBe(true);expect(tracks.some(track=>track.id===cid(plan.rightTrackId))).toBe(true);expect(tracks.find(track=>track.id==='local-material')!.ranges[0].id).toBe('local-range');
});
