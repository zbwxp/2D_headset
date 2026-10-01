import {expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {prepareRecordingBatch,recordingOverview,evaluateRecording,type RecordingCommand} from '../app/vectorRecordingApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {parseVectorRecording} from '../domain/vectorRecording/persistence';
import {currentPose} from '../domain/vectorRecording/model';
import type {LandmarkProject} from '../domain/landmarks/model';
function project():LandmarkProject{let d=addLayer(emptyDrawing(),'Face');d=createCurve(d,d.layers[0].id,[[0,0],[.3,.2],[.7,.2],[1,0]],.01,'Outline','curve');d=addDisplayInterval(d,'curve','HIDE');d.displayIntervals![0].ranges[0]={...d.displayIntervals![0].ranges[0],start:.2,end:.3};return {...createEmptyProject(),drawing:d};}
function apply(p:LandmarkProject,commands:RecordingCommand[]){const result=prepareRecordingBatch(p,{commands});return {...p,vectorRecording:result.next};}
function setup(){let p=project();p=apply(p,[{op:'ensureRig'},{op:'createDeformer',layerIds:[p.drawing!.layers[0].id],rows:2,columns:2,name:'Head',ref:'head'}]);return p;}
const rig=(p:LandmarkProject)=>p.vectorRecording!.rigs[0];

 test('fixed recording commands form a 0→30→60→90 keyform loop without touching canonical source',()=>{
  const p=project(),source=JSON.stringify(p.drawing),layerId=p.drawing!.layers[0].id;
  const request={commands:[{op:'ensureRig'},{op:'createDeformer',layerIds:[layerId],rows:2,columns:2,name:'Head',ref:'head'},{op:'saveKeyform',name:'Front',ref:'front'},{op:'setAngle',angle:{x:30,y:0}},{op:'editGridNodes',deformerId:'$head',edits:[{index:4,position:[.51,.1]}]},{op:'saveKeyform',name:'30 degrees',ref:'thirty'},{op:'setAngle',angle:{x:60,y:0}},{op:'editGridNodes',deformerId:'$head',edits:[{index:4,position:[.53,.1],handleU:[.7,.1]}]},{op:'saveKeyform',name:'60 degrees',ref:'sixty'},{op:'setAngle',angle:{x:90,y:0}},{op:'editGridNodes',deformerId:'$head',edits:[{index:4,position:[.55,.1]}]},{op:'saveKeyform',name:'Profile',ref:'profile'}] satisfies RecordingCommand[]};
  const plan=prepareRecordingBatch(p,request),next={...p,vectorRecording:plan.next};expect(plan.changed).toBe(true);expect(rig(next).keys).toHaveLength(7);expect(rig(next).draft).toBeUndefined();expect(rig(next).angle).toEqual({x:90,y:0});expect(plan.created.find(x=>x.ref==='profile')!.created).toBe(false);expect(JSON.stringify(p.drawing)).toBe(source);expect(next.drawing).toBe(p.drawing);expect(parseVectorRecording(plan.next)).toEqual(plan.next);
  for(const x of [0,30,45,60,90]){const result=evaluateRecording(next,{angle:{x,y:0}});expect(result.angle.x).toBe(x);expect(result.usedDraft).toBe(false);expect(result.intervalTransportErrors).toEqual([]);expect(result.drawing.curves).toHaveLength(1);}
 });

 test('inspection resolves stable names/IDs and returns detached rest/current grids and key descriptors',()=>{
  const p=setup(),r=recordingOverview(p,{deformerNames:['Head']});expect(r).toMatchObject({exists:true,sourceReadOnly:true,sourceReviewRequired:false});if(!('deformers'in r))throw Error('no rig');expect(r.deformers).toHaveLength(1);expect(r.deformers[0].currentGrid!.nodes).toHaveLength(9);expect(r.keys.every(k=>!('grids'in k))).toBe(true);r.deformers[0].currentGrid!.nodes[0].position[0]=999;expect(rig(p).deformers[0].grid.nodes[0].position[0]).not.toBe(999);expect(()=>recordingOverview(p,{deformerIds:['missing']})).toThrow();
 });

 test('a dirty draft cannot be silently discarded on angle/key loading; explicit discard is available',()=>{
  const p=setup(),id=rig(p).deformers[0].id,draft=apply(p,[{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[.6,.1]}]}]),before=JSON.stringify(draft);
  expect(()=>prepareRecordingBatch(draft,{commands:[{op:'setAngle',angle:{x:30,y:0}}]})).toThrow(/draft/i);expect(()=>prepareRecordingBatch(draft,{commands:[{op:'loadKeyform',keyformId:rig(draft).keys[2].id}]})).toThrow(/draft/i);expect(JSON.stringify(draft)).toBe(before);
  const next=apply(draft,[{op:'discardDraft'},{op:'setAngle',angle:{x:30,y:0}}]);expect(rig(next).draft).toBeUndefined();expect(rig(next).angle.x).toBe(30);
 });

 test('preview at an explicit angle uses saved keys and reports an unapplied draft',()=>{
  const p=setup(),id=rig(p).deformers[0].id,draft=apply(p,[{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[.6,.1]}]}]),before=JSON.stringify(draft);
  expect(evaluateRecording(draft)).toMatchObject({usedDraft:true,hasUnappliedDraft:false});const saved=evaluateRecording(draft,{angle:{x:0,y:0}});expect(saved).toMatchObject({usedDraft:false,hasUnappliedDraft:true});expect(saved.pose.grids[id].nodes[4].position).not.toEqual([.6,.1]);expect(evaluateRecording(draft,{angle:{x:0,y:0},useDraft:true}).usedDraft).toBe(true);expect(()=>evaluateRecording(draft,{angle:{x:30,y:0},useDraft:true})).toThrow(/current stored angle/);expect(JSON.stringify(draft)).toBe(before);
 });

 test('node moves preserve tangent vectors unless requested otherwise and explicit handles win',()=>{
  const p=setup(),id=rig(p).deformers[0].id,n=rig(p).deformers[0].grid.nodes[4],next=apply(p,[{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[n.position[0]+.1,n.position[1]+.2],handleU:[.9,.8],twist:[.1,.2]}]}]),out=rig(next).draft!.grids[id].nodes[4];expect(out.handleU).toEqual([.9,.8]);expect(out.handleV[0]).toBeCloseTo(n.handleV[0]+.1);expect(out.handleV[1]).toBeCloseTo(n.handleV[1]+.2);expect(out.twist).toEqual([.1,.2]);
 });

 test('failed batches, dry-runs and malformed edits do not mutate original recording/source',()=>{
  const p=setup(),before=JSON.stringify(p),id=rig(p).deformers[0].id;const dry=prepareRecordingBatch(p,{dryRun:true,commands:[{op:'setAngle',angle:{x:30,y:0}}]});expect(dry.dryRun).toBe(true);expect(JSON.stringify(p)).toBe(before);
  for(const commands of [[{op:'setAngle',angle:{x:30,y:0}},{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[NaN,1]}]}],[{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[1,1]},{index:4,position:[2,2]}]}],[{op:'bindLayers',layerIds:['missing'],deformerId:id}],[{op:'setAngle',angle:{x:91,y:0}}]])expect(()=>prepareRecordingBatch(p,{commands})).toThrow();expect(JSON.stringify(p)).toBe(before);
 });

 test('deformer parent/binding edits use existing hierarchy logic and cycles reject',()=>{
  const p=setup(),base=rig(p).deformers[0].id,layer=p.drawing!.layers[0].id,next=apply(p,[{op:'createDeformer',layerIds:[],name:'Parent',ref:'parent'},{op:'setDeformer',deformerId:base,parentId:'$parent'},{op:'bindLayers',layerIds:[layer],deformerId:base}]);const parent=rig(next).deformers.find(d=>d.name==='Parent')!.id;expect(()=>apply(next,[{op:'setDeformer',deformerId:parent,parentId:base}])).toThrow(/循环/);const deleted=apply(next,[{op:'deleteDeformer',deformerId:parent}]);expect(rig(deleted).deformers[0].parentId).toBeUndefined();expect(rig(deleted).bindings[layer]).toBe(base);
 });

 test('pose visibility expands layers and interval changes never replace source tracks',()=>{
  const p=setup(),d=p.drawing!,before=JSON.stringify(d),rangeId=d.displayIntervals![0].ranges[0].id,next=apply(p,[{op:'setVisibility',layerIds:[d.layers[0].id],visible:false},{op:'changePoseInterval',rangeId,start:.4,end:.6},{op:'setPoseIntervalEnd',rangeId,end:0,style:{taper:.02}},{op:'setPoseIntervalEnabled',rangeIds:[rangeId],enabled:false}]);const pose=currentPose(rig(next),d);expect(pose.visibility.curve).toBe(false);expect(pose.intervalOverrides![0].ranges[0]).toMatchObject({start:.4,end:.6,inkEnds:[{taper:.02},expect.anything()]});expect(pose.intervals[rangeId]).toBe(false);expect(JSON.stringify(next.drawing)).toBe(before);expect(next.drawing).toBe(d);
 });

 test('source changes require explicit review acceptance and anchor keyforms remain protected',()=>{
  const p=setup(),changed={...p,drawing:{...p.drawing!,curves:p.drawing!.curves.map(c=>({...c,name:'Changed'}))} as DrawingDocument};expect(recordingOverview(changed)).toMatchObject({sourceReviewRequired:true});expect(()=>apply(changed,[{op:'setAngle',angle:{x:30,y:0}}])).toThrow(/acceptSource/);const accepted=apply(changed,[{op:'acceptSource'},{op:'setAngle',angle:{x:30,y:0}},{op:'saveKeyform',name:'Middle'}]);const middle=rig(accepted).keys.find(k=>k.angle.x===30)!;expect(rig(apply(accepted,[{op:'deleteKeyform',keyformId:middle.id}])).keys).toHaveLength(5);expect(()=>apply(accepted,[{op:'deleteKeyform',keyformId:rig(accepted).keys[0].id}])).toThrow(/base angle/);
 });

function apiHarness(p=setup()){
 let state=p,mode:'drawing'|'recording'='recording',past:LandmarkProject[]=[],future:LandmarkProject[]=[];const api=createVectorEditingApi({getState:()=>({project:state,past,future}),getMode:()=>mode,commitDrawing(){throw Error('Source commit forbidden in Recording test');},commitRecording(recording){past.push(state);future=[];state={...state,vectorRecording:recording};},undo(){const p=past.pop();if(p){future.unshift(state);state=p;}},redo(){const p=future.shift();if(p){past.push(state);state=p;}}});return {api,state:()=>state,past:()=>past,mode:(m:typeof mode)=>{mode=m;}};
}
const val=<T>(r:VectorResult<T>)=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

test('Recording facade gates writes, dry-runs atomically, rejects stale revisions and performs one Undo',()=>{
 const h=apiHarness(),before=h.state(),revision=h.api.inspect().revision,id=rig(before).deformers[0].id,commands:RecordingCommand[]=[{op:'setAngle',angle:{x:30,y:0}},{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[.55,.1]}]},{op:'saveKeyform',name:'30°'}];
 val(h.api.recording({commands,expectedRevision:revision,dryRun:true}));expect(h.state()).toBe(before);expect(h.api.inspect().revision).toBe(revision);expect(h.past()).toHaveLength(0);
 h.mode('drawing');expect(h.api.recording({commands})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});expect(h.api.inspectRecording().ok).toBe(true);h.mode('recording');val(h.api.recording({commands,expectedRevision:revision}));expect(h.past()).toHaveLength(1);expect(h.state().drawing).toBe(before.drawing);expect(h.api.recording({commands:[],expectedRevision:revision})).toMatchObject({ok:false,error:{code:'STALE_REVISION'}});
 val(h.api.undo());expect(h.state()).toBe(before);val(h.api.redo());expect(rig(h.state()).angle.x).toBe(30);expect(h.api.execute({commands:[{op:'moveNode',nodeId:before.drawing!.nodes[0].id,position:[9,9]}]})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});
});

test('previewRecording uses the real evaluated SVG chain, is mode-independent and never commits hypothetical commands',()=>{
 const h=apiHarness(),before=h.state(),revision=h.api.inspect().revision,id=rig(before).deformers[0].id,options={width:400,height:400,center:[.5,.1] as [number,number],pixelsPerUnit:250,showFills:false};
 const baseline=val(h.api.previewRecording({...options,angle:{x:0,y:0}}));h.mode('drawing');const preview=val(h.api.previewRecording({...options,commands:[{op:'setAngle',angle:{x:30,y:0}},{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[.56,.14]}]}]}));expect(preview.svg).toContain('<svg');expect(preview.svg).not.toBe(baseline.svg);expect(preview.usedDraft).toBe(true);expect(preview.fitDiagnostics).toHaveLength(before.drawing!.curves.length);expect(preview.diagnosticStage).toBe('full');expect(preview.maxErrorPixels).toBeGreaterThanOrEqual(0);expect(h.state()).toBe(before);expect(h.api.inspect().revision).toBe(revision);expect(h.past()).toHaveLength(0);
});

test('a failed Recording facade batch has a precise command index and cannot commit its earlier edit',()=>{
 const h=apiHarness(),before=h.state();expect(h.api.recording({commands:[{op:'setAngle',angle:{x:30,y:0}},{op:'bindLayers',layerIds:['missing'],deformerId:rig(before).deformers[0].id}]})).toMatchObject({ok:false,error:{code:'NOT_FOUND',commandIndex:1}});expect(h.state()).toBe(before);expect(h.past()).toHaveLength(0);
});

test('default Recording adapter uses one existing store transaction and preserves exact source/snapshots',()=>{
 const old=useEditor.getState(),oldMode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{const p=setup();useEditor.setState({project:p,past:[],future:[]});useWorkspaceMode.getState().setMode('recording');const api=createVectorEditingApi(),id=rig(p).deformers[0].id;
  val(api.recording({commands:[{op:'setAngle',angle:{x:30,y:0}},{op:'editGridNodes',deformerId:id,edits:[{index:4,position:[.55,.1]}]},{op:'saveKeyform',name:'30°'}]}));expect(useEditor.getState().past).toHaveLength(1);expect(useEditor.getState().project.drawing).toBe(p.drawing);expect(useEditor.getState().project.drawingSnapshots).toBe(p.drawingSnapshots);val(api.undo());expect(useEditor.getState().project).toEqual(p);
 }finally{vi.runAllTimers();useEditor.setState(old,true);useWorkspaceMode.getState().setMode(oldMode);vi.unstubAllGlobals();vi.useRealTimers();}
});

const guide=readFileSync(new URL('../../docs/vector-recording-api.md',import.meta.url),'utf8'),examples=[...guide.matchAll(/<!-- recording-tested: ([a-z-]+) -->\s*```json\s*([\s\S]*?)```/g)].map(m=>({name:m[1],request:JSON.parse(m[2])}));
test('recording guide declares the expected executable JSON examples',()=>expect(examples.map(e=>e.name)).toEqual(['inspect','turn-scaffold','preview-saved']));
for(const e of examples)test(`recording guide example ${e.name} uses the actual facade`,()=>{
 const h=apiHarness(),before=h.state(),layer=h.state().drawing!.layers[0].id,replace=(v:unknown):unknown=>v==='SOURCE_LAYER_ID'?layer:Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)])):v,r=replace(e.request) as {method:string;request:any};
 const result=r.method==='inspectRecording'?h.api.inspectRecording(r.request):r.method==='recording'?h.api.recording(r.request):h.api.previewRecording(r.request);expect(result.ok,JSON.stringify(result)).toBe(true);expect(h.state()).toBe(before);
});


test('inspection remains available when a changed source makes saved interval interpolation stale',()=>{
 let p=setup();const rangeId=p.drawing!.displayIntervals![0].ranges[0].id;p=apply(p,[{op:'changePoseInterval',rangeId,start:.1,end:.5},{op:'saveKeyform'},{op:'setAngle',angle:{x:45,y:0}}]);const changed={...p,drawing:{...p.drawing!,displayIntervals:undefined}};
 const overview=recordingOverview(changed);expect(overview).toMatchObject({sourceReviewRequired:true,exists:true});expect('poseEvaluationError'in overview&&overview.poseEvaluationError).toBeTruthy();expect('deformers'in overview&&overview.deformers[0].currentGrid).toBeNull();expect(()=>apply(changed,[{op:'acceptSource'}])).not.toThrow();
});
