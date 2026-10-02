import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {serializeProject} from '../app/autosave';
import {prepareSnapshotBatch} from '../app/recordingSnapshotApi';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addLayer,createCurve,moveHandle} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {canonicalElementId} from '../domain/recordingSnapshot/sources';
import {resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import type {SnapshotCommand} from '../domain/recordingSnapshot/commands';

const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
function command(commands:SnapshotCommand[]){const plan=prepareSnapshotBatch(useEditor.getState().project,{commands});useEditor.getState().commitRecordingSnapshots(plan.recordingSnapshots);return plan;}
function editSource(change:(drawing:DrawingDocument)=>DrawingDocument){const s=useEditor.getState();s.beginEdit();try{s.setDrawing(change(s.project.drawing!));}finally{s.endEdit();}}
function setup(){
 let drawing=addLayer(emptyDrawing(),'Source layer');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[.3,.2],[.7,.2],[1,0]],.01,'Source curve','curve');
 const state=saveDrawingSnapshot({drawing},'Shared original');useEditor.getState().load({...createEmptyProject(),...state});
 let p=useEditor.getState().project,w=p.recordingSnapshots!,recording=w.recordings.find(r=>r.id===w.activeRecordingId)!,first=recording.activeSnapshotId!;
 expect(w.snapshots.find(s=>s.id===first)!.layers).toEqual([]);
 const asset=p.drawingSnapshots!.activeId!,source=w.snapshots.find(s=>s.source?.artworkId===asset)!;
 const pasted=command([{op:'pasteLayers',sourceSnapshotId:source.id,layerIds:[source.layers[0].id]}]),layer=pasted.created.find(c=>c.kind==='layer')!.id;
 p=useEditor.getState().project;const priorTracks=JSON.stringify(p.recordingSnapshots!.recordings[0].tracks),priorOriginals=Object.keys(p.recordingSnapshots!.library.curves);
 const created=command([{op:'createSnapshot',name:'Side',angle:{x:90,y:0}}]),second=created.snapshotId!;
 expect(JSON.stringify(useEditor.getState().project.recordingSnapshots!.recordings[0].tracks)).toBe(priorTracks);
 expect(Object.keys(useEditor.getState().project.recordingSnapshots!.library.curves)).toEqual(priorOriginals);
 const curve=canonicalElementId(asset,'curve');
 command([{op:'setLayerPlacement',layerId:layer,value:{translation:[2,0],rotation:0,scale:1}},{op:'moveShapeHandle',layerId:layer,curveId:curve,end:0,position:[.3,.5]},{op:'updateSnapshot'}]);
 useEditor.setState({past:[],future:[]});return {asset,first,second,curve,layer,project:useEditor.getState().project};
}
const evaluated=(snapshotId:string)=>resolveSnapshot(useEditor.getState().project.recordingSnapshots!,snapshotId,{useDraft:false});
const close=(a:Point2,b:Point2)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],9));

test('real Drawing setter updates two shared snapshot references and retains pose offsets with one Undo',()=>{
 const s=setup(),before=[evaluated(s.first),evaluated(s.second)],tracks=JSON.stringify(s.project.recordingSnapshots!.recordings[0].tracks);
 editSource(d=>{const h=d.curves.find(c=>c.id==='curve')!.handles[0];return moveHandle(d,{curveId:'curve',end:0},[h[0],h[1]+.05]);});
 const changed=useEditor.getState().project;
 [s.first,s.second].forEach((id,i)=>{const a=shapeOf(before[i].drawing,s.curve),b=shapeOf(evaluated(id).drawing,s.curve);close(b[1],[a[1][0],a[1][1]+.05]);expect(evaluated(id).drawing.curves.map(c=>c.id)).toEqual([s.curve]);});
 expect(JSON.stringify(changed.recordingSnapshots!.recordings[0].tracks)).toBe(tracks);expect(changed.drawingSnapshots).toBe(s.project.drawingSnapshots);expect(useEditor.getState().past).toHaveLength(1);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(s.project);close(shapeOf(evaluated(s.second).drawing,s.curve)[1],shapeOf(before[1].drawing,s.curve)[1]);
 useEditor.getState().redo();expect(useEditor.getState().project).toBe(changed);
});

test('shared source changes and saved curve/placement poses survive serialize and real store reload',()=>{
 const s=setup();editSource(d=>moveHandle(d,{curveId:'curve',end:0},[.3,.27]));
 const before=useEditor.getState().project,poses=[evaluated(s.first).drawing,evaluated(s.second).drawing],tracks=JSON.stringify(before.recordingSnapshots!.recordings[0].tracks);
 useEditor.getState().load(parseLandmarks(serializeProject(before)));
 expect(evaluated(s.first).drawing).toEqual(poses[0]);expect(evaluated(s.second).drawing).toEqual(poses[1]);expect(JSON.stringify(useEditor.getState().project.recordingSnapshots!.recordings[0].tracks)).toBe(tracks);
});

test('a new independent source curve appears once in both views, inherits the layer domain and has zero direct shape offset',()=>{
 const s=setup(),source=useEditor.getState().project.drawing!,layer=source.layers[0].id,curve=canonicalElementId(s.asset,'new-curve');
 editSource(d=>createCurve(d,layer,[[0,1],[.3,1],[.7,1],[1,1]],.01,'Added','new-curve'));
 const front=evaluated(s.first),side=evaluated(s.second);expect(front.drawing.curves).toHaveLength(2);expect(side.drawing.curves).toHaveLength(2);
 close(shapeOf(front.drawing,curve)[0],[0,1]);close(shapeOf(side.drawing,curve)[0],[2,1]);close(shapeOf(side.drawing,curve)[1],[2.3,1]);
 const shape=useEditor.getState().project.recordingSnapshots!.recordings[0].tracks.find(t=>t.channel==='shape')!;
 expect(JSON.stringify(shape)).not.toContain(curve);
});
