import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {prepareArtworkAction} from '../app/vectorArtworkApi';
import {createVectorEditingApi,type VectorEditingHost} from '../app/vectorEditingApi';
import {prepareSceneBatch,evaluateRecordingScene} from '../app/recordingSceneApi';
import {serializeProject} from '../app/autosave';
import {planArtworkImport} from '../app/artworkExamples';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {moveHandle} from '../domain/drawing/commands';
import {shapeOf,type DrawingDocument} from '../domain/drawing/model';
import {snapshotDrawing} from '../domain/drawing/snapshots';
import {recordingSceneSources} from '../domain/recordingScene/sources';
import {instanceObjectId} from '../domain/recordingScene/model';
import type {LandmarkProject} from '../domain/landmarks/model';

const original=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
const raw=readFileSync(new URL('../assets/yaw-turning-example.json',import.meta.url),'utf8');
const current=()=>useEditor.getState().project;
const scene=()=>{const r=current().recordingScenes!;return r.scenes.find(s=>s.id===r.activeSceneId)!;};
function artwork(request:unknown){const plan=prepareArtworkAction(current(),request),s=useEditor.getState();s.beginEdit();try{s.setDrawingSnapshotState(plan.state);}finally{s.endEdit();}return plan;}
function edit(id:string,dy=.01){const s=useEditor.getState(),d=s.project.drawing!,h=d.curves.find(c=>c.id===id)!.handles[0];s.beginEdit();try{s.setDrawing(moveHandle(d,{curveId:id,end:0},[h[0],h[1]+dy]));}finally{s.endEdit();}}
function setup(){
 useEditor.getState().load(parseLandmarks(raw));const a=current().drawingSnapshots!.activeId!,b=current().drawingSnapshots!.items.find(x=>x.id!==a)!.id;
 const plan=prepareSceneBatch(current(),{commands:[{op:'addInstance',artworkId:a,name:'Second instance of A'}]});useEditor.getState().commitRecordingScenes(plan.recordingScenes);useEditor.setState({past:[],future:[]});
 const d=current().drawing!,mouthLayer=d.layers.find(l=>l.name==='嘴部')!,mouth=d.curves.find(c=>mouthLayer.items.includes(c.id))!;
 return {a,b,mouthId:mouth.id,base:current(),source:d,checkpoint:JSON.stringify(current().drawingSnapshots),authored:JSON.stringify(scene())};
}
function bothInstancesMatch(project:LandmarkProject,mouthId:string,source:DrawingDocument){
 const result=evaluateRecordingScene(project,{angle:{x:0,y:0}}),s=project.recordingScenes!.scenes.find(s=>s.id===project.recordingScenes!.activeSceneId)!;
 for(const i of s.instances)expect(shapeOf(result.drawing,instanceObjectId(i.id,mouthId))).toEqual(shapeOf(source,mouthId));
 expect(result.diagnostics).toEqual([]);
}
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(originalMode);vi.useRealTimers();});

test('A edit survives switching to B, two scene references, return to A, Undo/Redo and reload',()=>{
 const f=setup();edit(f.mouthId);const edited=current().drawing!,afterEdit=current(),keys=JSON.stringify(scene().warps);
 artwork({op:'restore',artworkId:f.b});const atB=current();expect(atB.drawingSnapshots!.activeId).toBe(f.b);expect(atB.drawingWorkingCopies?.[f.a]).toEqual(edited);expect(JSON.stringify(atB.drawingSnapshots!.items)).toBe(JSON.stringify(f.base.drawingSnapshots!.items));
 useWorkspaceMode.getState().setMode('recording');bothInstancesMatch(atB,f.mouthId,edited);expect(JSON.stringify(scene().warps)).toBe(keys);
 useWorkspaceMode.getState().setMode('drawing');artwork({op:'restore',artworkId:f.a});const backAtA=current();expect(backAtA.drawing).toEqual(edited);expect(useEditor.getState().past).toHaveLength(3);
 useEditor.getState().undo();expect(current()).toBe(atB);useEditor.getState().undo();expect(current()).toBe(afterEdit);useEditor.getState().undo();expect(current()).toBe(f.base);
 useEditor.getState().redo();useEditor.getState().redo();useEditor.getState().redo();expect(current()).toBe(backAtA);
 // Persist while A is inactive; its live source must not fall back to its checkpoint.
 artwork({op:'restore',artworkId:f.b});const beforeReload=current(),recording=JSON.stringify(beforeReload.recordingScenes);useEditor.getState().load(parseLandmarks(serializeProject(beforeReload)));
 expect(current().drawingWorkingCopies?.[f.a]).toEqual(edited);expect(current().drawingSnapshots!.activeId).toBe(f.b);expect(JSON.stringify(current().recordingScenes)).toBe(recording);bothInstancesMatch(current(),f.mouthId,edited);
 artwork({op:'restore',artworkId:f.a});expect(current().drawing).toEqual(edited);
},20000);

test('updating A commits the same asset and clears only its working copy in one Undo step',()=>{
 const f=setup();edit(f.mouthId);const edited=current().drawing!;artwork({op:'restore',artworkId:f.b});const bCurve=current().drawing!.curves[0];edit(bCurve.id,.007);const editedB=current().drawing!;artwork({op:'restore',artworkId:f.a});
 const before=current(),refs=scene().instances.map(i=>[i.id,i.artworkId]),keys=JSON.stringify(scene().warps),past=useEditor.getState().past.length;
 artwork({op:'save',artworkId:f.a,name:'A updated'});const after=current();expect(after.drawingSnapshots!.activeId).toBe(f.a);expect(snapshotDrawing(after.drawingSnapshots!,f.a)).toEqual(edited);expect(after.drawingWorkingCopies?.[f.a]).toBeUndefined();expect(after.drawingWorkingCopies?.[f.b]).toEqual(editedB);expect(scene().instances.map(i=>[i.id,i.artworkId])).toEqual(refs);expect(JSON.stringify(scene().warps)).toBe(keys);expect(useEditor.getState().past).toHaveLength(past+1);
 useEditor.getState().undo();expect(current()).toBe(before);useEditor.getState().redo();expect(current()).toBe(after);
});

test('explicit save-as keeps A working geometry and references while making a separate active asset',()=>{
 const f=setup();edit(f.mouthId);const edited=current().drawing!,refs=scene().instances.map(i=>[i.id,i.artworkId]);const result=artwork({op:'save',name:'Separate edited copy'}),copyId=result.result.artworkId;
 expect(copyId).not.toBe(f.a);expect(current().drawingSnapshots!.activeId).toBe(copyId);expect(current().drawingWorkingCopies?.[f.a]).toEqual(edited);expect(scene().instances.map(i=>[i.id,i.artworkId])).toEqual(refs);expect(snapshotDrawing(current().drawingSnapshots!,f.a)).toEqual(f.source);
 edit(f.mouthId,.02);bothInstancesMatch(current(),f.mouthId,edited);expect(recordingSceneSources(current())[copyId]).toBe(current().drawing);expect(shapeOf(current().drawing!,f.mouthId)).not.toEqual(shapeOf(edited,f.mouthId));
},15000);

test('resolver precedence is active Drawing, then matching working copy, then checkpoint without mutating any input',()=>{
 const f=setup(),aCopy={...f.source,mirrorAxisX:123},activeB=snapshotDrawing(f.base.drawingSnapshots!,f.b),staleBCopy={...activeB,mirrorAxisX:456};
 const p={...f.base,drawing:activeB,drawingSnapshots:{...f.base.drawingSnapshots!,activeId:f.b},drawingWorkingCopies:{[f.a]:aCopy,[f.b]:staleBCopy}},before=JSON.stringify(p),sources=recordingSceneSources(p);
 expect(sources[f.a]).toBe(aCopy);expect(sources[f.b]).toBe(activeB);const c=f.base.drawingSnapshots!.items.find(i=>i.id!==f.a&&i.id!==f.b);if(c)expect(sources[c.id]).toEqual(snapshotDrawing(p.drawingSnapshots,c.id));expect(JSON.stringify(p)).toBe(before);
});

test('revision includes inactive working copies even when a host keeps the same project wrapper',()=>{
 const f=setup(),wrapper:LandmarkProject={...f.base,drawing:snapshotDrawing(f.base.drawingSnapshots!,f.b),drawingSnapshots:{...f.base.drawingSnapshots!,activeId:f.b},drawingWorkingCopies:{[f.a]:f.source}},committed=vi.fn();
 const host:VectorEditingHost={getState:()=>({project:wrapper,past:[],future:[]}),getMode:()=> 'recording',commitDrawing:committed,commitRecordingScenes:committed,undo(){},redo(){}},api=createVectorEditingApi(host),revision=api.inspect().revision;
 const c=f.source.curves.find(c=>c.id===f.mouthId)!,h=c.handles[0],edited=moveHandle(f.source,{curveId:f.mouthId,end:0},[h[0],h[1]+.01]);wrapper.drawingWorkingCopies={[f.a]:edited};
 expect(api.inspect().revision).not.toBe(revision);const before=JSON.stringify(wrapper);expect(api.scene({commands:[{op:'setAngle',angle:{x:60,y:0}}],expectedRevision:revision})).toMatchObject({ok:false,error:{code:'STALE_REVISION'}});expect(committed).not.toHaveBeenCalled();expect(JSON.stringify(wrapper)).toBe(before);bothInstancesMatch(wrapper,f.mouthId,edited);
},15000);

test('Recording history cannot mutate an inactive working source; Drawing Undo/Redo retains the exact source state',()=>{
 const f=setup(),before:LandmarkProject={...f.base,drawingWorkingCopies:{[f.b]:snapshotDrawing(f.base.drawingSnapshots!,f.b)}},after:LandmarkProject={...before,drawingWorkingCopies:{...before.drawingWorkingCopies,[f.b]:{...before.drawingWorkingCopies![f.b],mirrorAxisX:123}}};
 useEditor.setState({project:after,past:[before],future:[]});useWorkspaceMode.getState().setMode('recording');useEditor.getState().undo();expect(current()).toBe(after);expect(useEditor.getState().past).toEqual([before]);
 useWorkspaceMode.getState().setMode('drawing');useEditor.getState().undo();expect(current()).toBe(before);useWorkspaceMode.getState().setMode('recording');useEditor.getState().redo();expect(current()).toBe(before);expect(useEditor.getState().future).toEqual([after]);
 useWorkspaceMode.getState().setMode('drawing');useEditor.getState().redo();expect(current()).toBe(after);
});

test('importing a different artwork does not mis-stash its geometry under the previously active asset',()=>{
 const f=setup(),imported=snapshotDrawing(f.base.drawingSnapshots!,f.b),plan=planArtworkImport(f.base,imported,'Imported independent source'),s=useEditor.getState();
 expect(recordingSceneSources(plan.state)[f.a]).toEqual(f.source);
 s.beginEdit();try{for(const step of plan.steps)s.setDrawingSnapshotState(step);}finally{s.endEdit();}
 expect(current().drawingSnapshots!.activeId).toBe(plan.artworkId);expect(recordingSceneSources(current())[f.a]).toEqual(f.source);expect(snapshotDrawing(current().drawingSnapshots!,f.a)).toEqual(f.source);bothInstancesMatch(current(),f.mouthId,f.source);
},15000);
