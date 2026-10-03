import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../app/snapshotEditTransaction';
import {prepareSnapshotBatch} from '../app/recordingSnapshotApi';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {serializeProject} from '../app/autosave';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {moveHandle} from '../domain/drawing/commands';
import {restoreDrawingSnapshot,saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,materializeOriginalSnapshot,syncRecordingSnapshotSources,upsertDrawingSource} from '../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshot,emptySnapshotDeformationState,type RecordingSnapshotWorkspace,type SceneIntervalValue} from '../domain/recordingSnapshot/model';
import {resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {identityScenePlacement} from '../domain/recordingScene/model';
import {createWarpGrid} from '../domain/vectorWarp/model';

const original=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(originalMode);vi.useRealTimers();});
const cid=(raw:string)=>canonicalElementId('A',raw);
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[1/3,0],[2/3,0]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}],groups:[{id:'group',name:'Source group',visible:true,locked:false,curveIds:['curve']}],displayIntervals:[{id:'interval',scope:'CURVE',anchor:{id:'curve',reverse:false},ranges:[{id:'range',start:.1,end:.9}]}]};
 const other:DrawingDocument={...structuredClone(drawing),nodes:[{id:'a',position:[2,0]},{id:'b',position:[3,0]}],curves:[{...structuredClone(drawing.curves[0]),handles:[[2.3,0],[2.7,0]]}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing,drawingSnapshots:{version:1 as const,activeId:'A',images:[],items:[{id:'A',name:'A',drawing:structuredClone(drawing)},{id:'B',name:'B',drawing:other}]}});
 const workspace=project.recordingSnapshots,source=drawingSnapshotForArtwork(workspace,'A')!,otherSource=drawingSnapshotForArtwork(workspace,'B')!,view=workspace.snapshots.find(s=>s.id===workspace.recordings[0].activeSnapshotId)!;
 view.layers=[{kind:'reference',id:'slot',name:'A',baseSnapshotId:source.id,baseLayerId:cid('layer')}];
 return {project,workspace,source,otherSource,view,drawing};
}
function localState(f:ReturnType<typeof fixture>){
 const grid=createWarpGrid({min:[-1,-1],max:[2,2]},1,1),source=f.source;
 source.angle={x:17,y:0};
 source.layers.push({kind:'reference',id:'local-reference',name:'B reference',baseSnapshotId:f.otherSource.id,baseLayerId:canonicalElementId('B','layer')});
 source.deformation={warps:[{id:'local-warp',name:'Local warp',restGrid:grid,grid:structuredClone(grid)}],bindings:[{layerId:cid('layer'),warpId:'local-warp'}],layers:{[cid('layer')]:{placement:{...identityScenePlacement(),scaleX:0},shape:{nodes:{[cid('a')]:[.1,.2]},handles:{}},visibility:{[cid('curve')]:false},depth:2}},relationPositions:{}};
 source.inheritedState=structuredClone(source.deformation);source.draft={angle:{x:17,y:0},deformation:structuredClone(source.deformation),channels:[]};
 source.relations.groups!.add!.push({id:'local-group',name:'Local group',visible:true,locked:false,curveIds:[cid('curve')]});
 source.relations.groups!.update=[{...source.relations.groups!.add![0],name:'Local override'}];
 const recording=f.workspace.recordings[0];recording.snapshotIds.push(source.id);source.authored=[{trackId:'local-placement',keyId:'local-key'}];
 recording.tracks.push({id:'local-placement',channel:'placement',targetId:cid('layer'),keys:[{id:'local-key',angle:{x:17,y:0},value:{...identityScenePlacement(),scaleX:0}}],draft:{angle:{x:17,y:0},value:identityScenePlacement()}});
 const side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});side.layers=structuredClone(f.view.layers);f.workspace.snapshots.push(side);recording.snapshotIds.push(side.id);
}

test('source adapter refresh preserves generic snapshot state, references, authored sparse values and old conflicting originals through reload',()=>{
 const f=fixture();localState(f);useEditor.getState().load(f.project);useEditor.setState({past:[],future:[]});
 const before=useEditor.getState().project,source=drawingSnapshotForArtwork(before.recordingSnapshots!,'A')!,saved=structuredClone(source),other=structuredClone(drawingSnapshotForArtwork(before.recordingSnapshots!,'B')!),recordings=structuredClone(before.recordingSnapshots!.recordings),archive=before.recordingSnapshots!.legacyArchive;
 const s=useEditor.getState();s.beginEdit();s.setDrawing(moveHandle(s.project.drawing!,{curveId:'curve',end:0},[.2,.4]));s.endEdit();
 const after=useEditor.getState().project,next=drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!;
 expect(next.deformation).toEqual(saved.deformation);expect(next.draft).toEqual(saved.draft);expect(next.inheritedState).toEqual(saved.inheritedState);expect(next.authored).toEqual(saved.authored);expect(next.layers).toEqual(saved.layers);expect(next.angle).toEqual(saved.angle);expect(next.relations.groups).toEqual(saved.relations.groups);
 expect(after.recordingSnapshots!.library.curves[cid('curve')].handles[0]).toEqual([.2,.4]);expect(after.recordingSnapshots!.library.curves[canonicalElementId('B','curve')]).toEqual(before.recordingSnapshots!.library.curves[canonicalElementId('B','curve')]);expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'B')).toEqual(other);
 expect(after.recordingSnapshots!.recordings).toEqual(recordings);expect(after.recordingSnapshots!.legacyArchive).toBe(archive);expect(after.drawingSnapshots).toBe(before.drawingSnapshots);expect(useEditor.getState().past).toEqual([before]);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
 useEditor.getState().load(parseLandmarks(serializeProject(after)));expect(useEditor.getState().project.recordingSnapshots).toEqual(after.recordingSnapshots);
});

test('shared planner is pure and source modes plus canonical ownership reject before Recording history opens',()=>{
 const f=fixture(),json=JSON.stringify(f.project),drawing=moveHandle(f.drawing,{curveId:'curve',end:0},[.2,.4]);
 expect(()=>prepareSnapshotEdit(snapshotEditContext(f.project,false),{kind:'original-geometry',drawing})).toThrow('录制模式不能修改源画稿');
 const plan=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing});expect(JSON.stringify(f.project)).toBe(json);expect(plan.project.recordingSnapshots!.library.curves[cid('curve')].handles[0]).toEqual([.2,.4]);
 useEditor.getState().load(f.project);useEditor.setState({past:[],future:[]});useWorkspaceMode.getState().setMode('recording');const before=useEditor.getState().project;
 const mutations:Array<(workspace:RecordingSnapshotWorkspace)=>void>=[
  w=>{w.library.nodes[cid('a')].position=[9,9];},
  w=>{drawingSnapshotForArtwork(w,'A')!.layers=[];},
  w=>{drawingSnapshotForArtwork(w,'A')!.relations.groups!.add![0].name='Wrong source';},
  w=>{drawingSnapshotForArtwork(w,'A')!.source!.artworkId='B';},
  w=>{w.legacyArchive!.projectJSON='{}';},
 ];
 for(const mutate of mutations){const workspace=structuredClone(before.recordingSnapshots!);mutate(workspace);expect(()=>useEditor.getState().commitRecordingSnapshots(workspace)).toThrow(/original/);expect(useEditor.getState().project).toBe(before);expect(useEditor.getState().past).toEqual([]);}
 expect(()=>useEditor.getState().setDrawing(drawing)).toThrow('录制模式不能修改源画稿');expect(()=>useEditor.getState().setDrawingSnapshotState({drawing})).toThrow('录制模式不能修改源画稿');
});

test('Recording local edits and independent clones commit through the planner without rewriting originals, in one Undo',()=>{
 const f=fixture();useEditor.getState().load(f.project);useEditor.setState({past:[],future:[]});useWorkspaceMode.getState().setMode('recording');
 const before=useEditor.getState().project,commands=prepareSnapshotBatch(before,{commands:[{op:'cloneLayers',sourceSnapshotId:f.source.id,layerIds:[cid('layer')]},{op:'setLayerPlacement',layerId:'slot',value:{...identityScenePlacement(),scaleX:0}},{op:'updateSnapshot'}]});
 useEditor.getState().commitRecordingSnapshots(commands.recordingSnapshots);const after=useEditor.getState().project;
 expect(Object.keys(after.recordingSnapshots!.library.curves)).toHaveLength(3);expect(after.drawing).toBe(before.drawing);expect(after.drawingSnapshots).toBe(before.drawingSnapshots);expect(after.drawingWorkingCopies).toBe(before.drawingWorkingCopies);expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'A')).toEqual(drawingSnapshotForArtwork(before.recordingSnapshots!,'A'));
 const evaluated=resolveSnapshot(after.recordingSnapshots!,f.view.id);expect(evaluated.placements.slot.scaleX).toBe(0);expect(useEditor.getState().past).toEqual([before]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
});

test('source relation overrides are local edits while original materialization keeps the adapter baseline',()=>{
 const f=fixture(),workspace=structuredClone(f.workspace),source=drawingSnapshotForArtwork(workspace,'A')!,originalGroup=structuredClone(source.relations.groups!.add![0]);
 source.relations.groups!.update=[{...originalGroup,name:'Local override'}];source.relations.groups!.disable=[originalGroup.id];
 const committed=prepareSnapshotEdit(snapshotEditContext(f.project,false),{kind:'snapshot-state',workspace}).project;
 expect(materializeOriginalSnapshot(committed.recordingSnapshots!,source.id)!.groups).toEqual([originalGroup]);
 const refreshed=prepareSnapshotEdit(snapshotEditContext(committed,true),{kind:'original-geometry',drawing:moveHandle(f.drawing,{curveId:'curve',end:0},[.2,.4])}).project;
 expect(drawingSnapshotForArtwork(refreshed.recordingSnapshots!,'A')!.relations.groups).toEqual(source.relations.groups);
 expect(materializeOriginalSnapshot(refreshed.recordingSnapshots!,source.id)!.groups).toEqual([originalGroup]);
});

test('same-ID working sources survive A to B and first-save promotion keeps canonical IDs',()=>{
 const f=fixture(),changed=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:moveHandle(f.drawing,{curveId:'curve',end:0},[.2,.4])}).project;
 const atB=prepareSnapshotEdit(snapshotEditContext(changed,true),{kind:'original-state',state:restoreDrawingSnapshot(changed,'B')}).project;
 expect(atB.drawingWorkingCopies?.A).toEqual(changed.drawing);expect(atB.recordingSnapshots!.library.curves[cid('curve')].handles[0]).toEqual([.2,.4]);expect(atB.drawingSnapshots!.items).toEqual(f.project.drawingSnapshots!.items);
 const unnamed=ensureRecordingSnapshots({...createEmptyProject(),drawing:f.drawing}),source=drawingSnapshotForArtwork(unnamed.recordingSnapshots,'$working')!,saved=prepareSnapshotEdit(snapshotEditContext(unnamed,true),{kind:'original-state',state:saveDrawingSnapshot(unnamed,'Named original')}).project;
 expect(drawingSnapshotForArtwork(saved.recordingSnapshots!,saved.drawingSnapshots!.activeId!)!.id).toBe(source.id);expect(Object.keys(saved.recordingSnapshots!.library.curves)).toEqual(Object.keys(unnamed.recordingSnapshots.library.curves));expect(saved.recordingSnapshots!.legacyArchive).toBe(unnamed.recordingSnapshots.legacyArchive);
 const second=upsertDrawingSource(saved.recordingSnapshots!,'$working',moveHandle(f.drawing,{curveId:'curve',end:0},[.2,.8])),secondSource=drawingSnapshotForArtwork(second,'$working')!;
 expect(secondSource.id).not.toBe(source.id);expect(new Set(second.snapshots.map(s=>s.id)).size).toBe(second.snapshots.length);expect(second.library.curves[canonicalElementId('$working','curve')]).toEqual(unnamed.recordingSnapshots.library.curves[canonicalElementId('$working','curve')]);expect(materializeOriginalSnapshot(second,secondSource.id)!.curves[0].handles[0]).toEqual([.2,.8]);
});

test('source interval transport visits saved, fallback and draft material once, including source-local state with reference layers',()=>{
 const f=fixture(),sourceDocument=materializeOriginalSnapshot(f.workspace,f.source.id)!,appearance={...structuredClone(sourceDocument.displayIntervals![0]),ranges:[{id:cid('range'),start:.2,end:.7}]},value:SceneIntervalValue={appearance,enabled:{[cid('range')]:false}};
 f.source.layers.push({kind:'reference',id:'other',name:'Other',baseSnapshotId:f.otherSource.id,baseLayerId:canonicalElementId('B','layer')});
 const state={...emptySnapshotDeformationState(),layers:{[cid('layer')]:{intervals:{[cid('interval')]:value}}}};f.source.deformation=structuredClone(state);f.source.inheritedState=structuredClone(state);f.source.draft={angle:{x:25,y:0},deformation:structuredClone(state),channels:[]};f.source.relations.displayIntervals!.update=[structuredClone(appearance)];
 f.workspace.recordings[0].tracks=[{id:'interval-track',channel:'interval',targetId:'slot',sourceTrackId:cid('interval'),keys:[{id:'interval-key',angle:{x:90,y:0},value:structuredClone(value)}],draft:{angle:{x:25,y:0},value:structuredClone(value)}}];
 const next=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:moveHandle(f.drawing,{curveId:'curve',end:0},[.2,.7])}).project,workspace=next.recordingSnapshots!,source=drawingSnapshotForArtwork(workspace,'A')!,track=workspace.recordings[0].tracks[0];
 if(track.channel!=='interval')throw Error('Expected interval track');const values=[track.keys[0].value,track.draft!.value,source.deformation.layers[cid('layer')].intervals![cid('interval')],source.inheritedState!.layers[cid('layer')].intervals![cid('interval')],source.draft!.deformation.layers[cid('layer')].intervals![cid('interval')]];
 expect(values.every(v=>v.appearance!.ranges[0].start!==.2)).toBe(true);for(const v of values){expect(v).toEqual(values[0]);expect(v.enabled).toEqual(value.enabled);}
 expect(source.relations.displayIntervals!.update![0]).toEqual(values[0].appearance);expect(track.keys.map(key=>key.angle)).toEqual([{x:90,y:0}]);expect(track.draft!.angle).toEqual({x:25,y:0});expect(source.draft!.angle).toEqual({x:25,y:0});expect(track.materialIssue).toBeUndefined();
 expect(syncRecordingSnapshotSources(next).recordingSnapshots).toEqual(workspace);expect(parseLandmarks(serializeProject(next)).recordingSnapshots).toEqual(workspace);
});
