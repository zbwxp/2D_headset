import {expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createVectorEditingApi,type VectorCommand,type VectorResult} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve,linkEndpoints} from '../domain/drawing/commands';
import {emptyDrawing,curveById,nodeAt,shapeOf,parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {validateMirrorEditing,type MirrorDrawing} from '../domain/drawing/mirrorEditing';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import type {LandmarkProject} from '../domain/landmarks/model';

const value=<T>(r:VectorResult<T>)=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const fail=(r:VectorResult<unknown>,code:string)=>expect(r).toMatchObject({ok:false,error:{code}});
function fixture(){
 let d=addLayer(emptyDrawing(),'Right');d=createCurve(d,d.layers[0].id,[[-1,0],[-1,-.4],[-.4,-1],[0,-1]],.01,'Right jaw','a');
 d=addLayer(d,'Left');d=createCurve(d,d.layers[0].id,[[1,0],[1,-.4],[.4,-1],[0,-1]],.02,'Left jaw','b');
 d=linkEndpoints(d,{curveId:'a',end:1},{curveId:'b',end:1},true);return {...d,mirrorAxisX:0};
}
function harness(d:DrawingDocument=fixture()){
 let project:LandmarkProject={...createEmptyProject(),drawing:d},past:LandmarkProject[]=[],future:LandmarkProject[]=[],mode:'drawing'|'recording'='drawing';
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=>mode,commitDrawing(drawing){past.push(project);future=[];project={...project,drawing};},undo(){const p=past.pop();if(p){future.unshift(project);project=p;}},redo(){const p=future.shift();if(p){past.push(project);project=p;}}});
 return {api,d:()=>project.drawing! as MirrorDrawing,state:()=>({project,past,future}),mode:(m:typeof mode)=>{mode=m;}};
}
function enable(h:ReturnType<typeof harness>){return value(h.api.execute({commands:[{op:'createMirrorPair',a:'a',b:'b',ref:'jaws'},{op:'setMirrorEditing',enabled:true}]})).created.find(c=>c.ref==='jaws')!.id;}
function mirrored(d:DrawingDocument){const a=shapeOf(d,'a'),b=shapeOf(d,'b');for(let i=0;i<4;i++){expect(b[i][0]).toBeCloseTo(-a[i][0],12);expect(b[i][1]).toBeCloseTo(a[i][1],12);}}

test('mirror configuration is explicit, stable, detached, serializable and one undo transaction',()=>{
 const h=harness(),before=h.state().project,revision=h.api.inspect().revision,commands:VectorCommand[]=[{op:'createMirrorPair',a:'a',b:'b',ref:'p'},{op:'setMirrorPair',pairId:'$p',reverse:false},{op:'setMirrorEditing',enabled:true}];
 value(h.api.execute({commands,dryRun:true,expectedRevision:revision}));expect(h.state().project).toBe(before);expect(h.api.inspect().revision).toBe(revision);
 const result=value(h.api.execute({commands,expectedRevision:revision})),pair=result.created.find(c=>c.ref==='p')!;expect(pair.kind).toBe('mirrorPair');expect(h.d().mirrorEditing).toMatchObject({enabled:true,curvePairs:[{id:pair.id,a:'a',b:'b',reverse:false}]});expect(h.state().past).toHaveLength(1);
 const inspected=value(h.api.inspect({includeRecording:false}));expect(inspected.mirrorEditing?.curvePairs[0].id).toBe(pair.id);inspected.mirrorEditing!.curvePairs.length=0;expect(h.d().mirrorEditing!.curvePairs).toHaveLength(1);
 expect(parseDrawing(JSON.parse(JSON.stringify(h.d())))).toEqual(h.d());value(h.api.undo());expect(h.state().project).toBe(before);value(h.api.redo());expect(h.d().mirrorEditing!.enabled).toBe(true);
});

test('enabling never chooses or overwrites an asymmetric side; disabled relations retain IDs',()=>{
 const h=harness();const pair=enable(h);value(h.api.execute({commands:[{op:'setMirrorEditing',enabled:false},{op:'moveHandle',curveId:'a',end:0,position:[-1.2,-.4]}]}));const before=h.state().project;
 fail(h.api.execute({commands:[{op:'setMirrorEditing',enabled:true}]}),'MIRROR_ASYMMETRIC_SOURCE');expect(h.state().project).toBe(before);expect(h.d().mirrorEditing!.curvePairs[0].id).toBe(pair);expect(curveById(h.d(),'b').handles[0]).toEqual([1,-.4]);
});

test('one-side node/handle edits mirror geometry while appearance remains independently authored',()=>{
 const h=harness();enable(h);const metadata=h.d().curves.map(({nodes,handles,...rest})=>rest),node=nodeAt(h.d(),{curveId:'a',end:0}).id;
 value(h.api.execute({commands:[{op:'moveNode',nodeId:node,position:[-1.1,.1]},{op:'moveHandle',curveId:'a',end:0,position:[-1.3,-.2]}]}));mirrored(h.d());expect(h.d().curves.map(({nodes,handles,...rest})=>rest)).toEqual(metadata);
 value(h.api.execute({commands:[{op:'setInkVisibility',curveIds:['a'],visible:false},{op:'setDepth',curveId:'a',offset:1,scope:'LAYER'}]}));expect(curveById(h.d(),'b').inkVisible).toBeUndefined();expect(curveById(h.d(),'b').depthOffset).toBeUndefined();
});

test('linked central nodes stay on the axis and follow Y on both layers',()=>{
 const h=harness();enable(h);const node=nodeAt(h.d(),{curveId:'a',end:1}).id;value(h.api.execute({commands:[{op:'moveNode',nodeId:node,position:[.2,-1.1]}]}));
 expect(nodeAt(h.d(),{curveId:'a',end:1}).position).toEqual([0,-1.1]);expect(nodeAt(h.d(),{curveId:'b',end:1}).position).toEqual([0,-1.1]);mirrored(h.d());
});

test('inconsistent explicit dual-side nodes reject the whole batch despite sequential propagation',()=>{
 const h=harness();enable(h);const before=h.state().project,a=nodeAt(h.d(),{curveId:'a',end:0}).id,b=nodeAt(h.d(),{curveId:'b',end:0}).id;
 fail(h.api.execute({commands:[{op:'renameCurve',curveId:'a',name:'Must roll back'},{op:'moveNode',nodeId:a,position:[-1.2,.1]},{op:'moveNode',nodeId:b,position:[1.3,.1]}]}),'MIRROR_AUTHORED_CONFLICT');expect(h.state().project).toBe(before);
 value(h.api.execute({commands:[{op:'moveNode',nodeId:a,position:[-1.2,.1]},{op:'moveNode',nodeId:b,position:[1.2,.1]}]}));mirrored(h.d());
});

test('dual-side handle conflicts reject, but the last direct write to the same handle wins',()=>{
 const h=harness();enable(h);const before=h.state().project;
 fail(h.api.execute({commands:[{op:'moveHandle',curveId:'a',end:0,position:[-1.2,-.4]},{op:'moveHandle',curveId:'b',end:0,position:[1.3,-.4]}]}),'MIRROR_AUTHORED_CONFLICT');expect(h.state().project).toBe(before);
 value(h.api.execute({commands:[{op:'moveHandle',curveId:'a',end:0,position:[-1.2,-.4]},{op:'moveHandle',curveId:'a',end:0,position:[-1.4,-.5]}]}));expect(curveById(h.d(),'b').handles[0]).toEqual([1.4,-.5]);
});

test('earlier handle intention follows later node translation instead of becoming a stale absolute constraint',()=>{
 const h=harness();enable(h);const node=nodeAt(h.d(),{curveId:'a',end:0}).id;
 value(h.api.execute({commands:[{op:'moveHandle',curveId:'a',end:0,position:[-1.2,-.5]},{op:'moveNode',nodeId:node,position:[-1.1,.2]}]}));mirrored(h.d());expect(curveById(h.d(),'a').handles[0][0]).toBeCloseTo(-1.3);expect(curveById(h.d(),'a').handles[0][1]).toBeCloseTo(-.3);
});

test('selected transforms record both-sided intent; X translation of both sides refuses while Y agrees',()=>{
 const h=harness();enable(h);const before=h.state().project;
 fail(h.api.execute({commands:[{op:'transformCurves',curveIds:['a','b'],matrix:[1,0,0,1,.1,0],allowRelated:true}]}),'MIRROR_AUTHORED_CONFLICT');expect(h.state().project).toBe(before);
 value(h.api.execute({commands:[{op:'transformCurves',curveIds:['a','b'],matrix:[1,0,0,1,0,.1],allowRelated:true}]}));mirrored(h.d());
});

test('hidden geometry mirrors and a locked counterpart rejects atomically',()=>{
 const d=fixture();curveById(d,'b').visible=false;const h=harness(d);enable(h);value(h.api.execute({commands:[{op:'moveHandle',curveId:'a',end:0,position:[-1.2,-.4]}]}));mirrored(h.d());
 value(h.api.execute({commands:[{op:'setObjectState',objectIds:['b'],locked:true}]}));const before=h.state().project;fail(h.api.execute({commands:[{op:'moveHandle',curveId:'a',end:0,position:[-1.3,-.4]}]}),'MIRROR_LOCKED');expect(h.state().project).toBe(before);
});

test('paired topology is guarded even disabled; explicit pair removal permits the normal topology command',()=>{
 const h=harness(),pair=enable(h);value(h.api.execute({commands:[{op:'setMirrorEditing',enabled:false}]}));const before=h.state().project;
 expect(h.api.execute({commands:[{op:'splitCurve',curveId:'a',t:.5}]}).ok).toBe(false);expect(h.state().project).toBe(before);
 value(h.api.execute({commands:[{op:'deleteMirrorPairs',pairIds:[pair]},{op:'splitCurve',curveId:'a',t:.5}]}));expect(h.d().curves).toHaveLength(3);expect(h.d().mirrorEditing!.curvePairs).toHaveLength(0);
});

test('new-curve aliases and mirror-pair aliases resolve without treating names as IDs',()=>{
 const h=harness(emptyDrawing());value(h.api.execute({commands:[{op:'createLayer',name:'$literal-name',ref:'layer'},{op:'createCurve',layerId:'$layer',shape:[[-1,0],[-1,.2],[-1,.4],[-1,.6]],ref:'a'},{op:'createCurve',layerId:'$layer',shape:[[1,0],[1,.2],[1,.4],[1,.6]],ref:'b'},{op:'createMirrorPair',a:'$a',b:'$b',ref:'pair'},{op:'setMirrorPair',pairId:'$pair',reverse:false},{op:'setMirrorEditing',enabled:true}]}));expect(h.d().layers[0].name).toBe('$literal-name');expect(validateMirrorEditing(h.d()).pairCount).toBe(1);
});

test('configuration and geometry obey stale revisions and Recording mode; unknown fields are rejected',()=>{
 const h=harness(),revision=h.api.inspect().revision;enable(h);const before=h.state().project;
 fail(h.api.execute({commands:[{op:'setMirrorEditing',enabled:false}],expectedRevision:revision}),'STALE_REVISION');h.mode('recording');fail(h.api.execute({commands:[{op:'setMirrorEditing',enabled:false}]}),'MODE_RESTRICTED');h.mode('drawing');fail(h.api.execute({commands:[{op:'setMirrorEditing',enabled:false,repair:true} as unknown as VectorCommand]}),'INVALID_REQUEST');expect(h.state().project).toBe(before);
});

test('mirror axis movement requires disabled state and explicit axis nodes clamp only geometry',()=>{
 const h=harness();enable(h);const before=h.state().project;expect(h.api.execute({commands:[{op:'setMirrorAxis',x:.2}]}).ok).toBe(false);expect(h.state().project).toBe(before);
 value(h.api.execute({commands:[{op:'setMirrorEditing',enabled:false},{op:'setMirrorAxis',x:.2}]}));expect(h.d().mirrorAxisX).toBe(.2);
});

test('the documented actual two-face pair setup enables without changing any source geometry or appearance',()=>{
 const source=parseDrawing(JSON.parse(readFileSync(new URL('../assets/hairless-symmetric-two-face.json',import.meta.url),'utf8'))),setup=JSON.parse(readFileSync(new URL('../../docs/examples/two-face-mirror-editing-setup.json',import.meta.url),'utf8')),h=harness(source),before=JSON.stringify(source),batch=JSON.parse(readFileSync(new URL('../../docs/examples/two-face-mirror-editing-api-batch.json',import.meta.url),'utf8')),commands:VectorCommand[]=batch.commands;
 value(h.api.execute({commands,dryRun:true}));expect(JSON.stringify(h.d())).toBe(before);value(h.api.execute({commands}));expect(validateMirrorEditing(h.d()).pairCount).toBe(setup.config.curvePairs.length);const {mirrorEditing,...without}=h.d();expect(without).toEqual(source);expect(h.state().past).toHaveLength(1);
});


test('a source quad deformation is mirrored after fitting, with consistent batch intent',()=>{
 const h=harness();enable(h);value(h.api.execute({commands:[{op:'deformCurves',curveIds:['a'],bounds:{min:[-1,-1],max:[0,0]},quad:[[-1.05,-1],[-.05,-1],[-.05,0],[-1.05,0]],allowRelated:true}]}));mirrored(h.d());
});

test.each([[-.01,0],[.01,0],[0,-.01],[0,.01]])('actual two-face mirror edit (%s,%s) transports HIDE material after both sides settle',(dx,dy)=>{
 const source=parseDrawing(JSON.parse(readFileSync(new URL('../assets/hairless-symmetric-two-face.json',import.meta.url),'utf8'))),h=harness(source),batch=JSON.parse(readFileSync(new URL('../../docs/examples/two-face-mirror-editing-api-batch.json',import.meta.url),'utf8'));
 value(h.api.execute({...batch,dryRun:false}));const before=h.d(),snapshot=JSON.stringify(before),jaw='65450d8d-7c62-4d87-b421-616dfbcab097',node=nodeAt(before,{curveId:jaw,end:0}),route=before.displayIntervals!.find(t=>t.displayRoute)!.displayRoute!,oldField=createDisplayRouteField(before,route);
 value(h.api.execute({commands:[{op:'moveNode',nodeId:node.id,position:[node.position[0]+dx,node.position[1]+dy]}]}));const d=h.d(),nextField=createDisplayRouteField(d,route);
 expect(validateMirrorEditing(d).enabled).toBe(true);expect(d.fills).toEqual(before.fills);expect(d.layers).toEqual(before.layers);expect(d.endpointLinks).toEqual(before.endpointLinks);expect(d.curves.map(c=>[c.id,c.inkEnds,c.depthOffset,c.visible,c.width])).toEqual(before.curves.map(c=>[c.id,c.inkEnds,c.depthOffset,c.visible,c.width]));
 for(const t of before.displayIntervals!.filter(t=>t.displayRoute))for(const r of t.ranges){const next=d.displayIntervals!.find(x=>x.id===t.id)!.ranges.find(x=>x.id===r.id)!;for(const key of ['start','end'] as const)expect(next[key]).toBeCloseTo(nextField.positionOf(oldField.materialAt(r[key])!)!,10);}
 expect(displayField(d,displayPath(d,jaw)).mask).toHaveLength(1);value(h.api.undo());expect(JSON.stringify(h.d())).toBe(snapshot);
});

test('default store adapter respects an explicit disable-and-edit epoch and one exact Undo',()=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const h=harness();enable(h);const d=h.d();useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project:{...createEmptyProject(),drawing:d},past:[],future:[]});const api=createVectorEditingApi();
  value(api.execute({commands:[{op:'setMirrorEditing',enabled:false},{op:'moveHandle',curveId:'a',end:0,position:[-1.3,-.4]}]}));const after=useEditor.getState().project.drawing!;
  expect(after.mirrorEditing!.enabled).toBe(false);expect(curveById(after,'a').handles[0]).toEqual([-1.3,-.4]);expect(curveById(after,'b').handles[0]).toEqual([1,-.4]);expect(useEditor.getState().past).toHaveLength(1);
  value(api.undo());expect(useEditor.getState().project.drawing).toEqual(d);value(api.redo());expect(useEditor.getState().project.drawing).toEqual(after);
 }finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.unstubAllGlobals();vi.useRealTimers();}
});


test('a no-op configuration command cannot erase contradictory batch intentions',()=>{
 const h=harness();enable(h);const before=h.state().project,a=nodeAt(h.d(),{curveId:'a',end:0}).id,b=nodeAt(h.d(),{curveId:'b',end:0}).id;
 fail(h.api.execute({commands:[{op:'moveNode',nodeId:a,position:[-1.2,.1]},{op:'setMirrorEditing',enabled:true},{op:'moveNode',nodeId:b,position:[1.3,.1]}]}),'MIRROR_AUTHORED_CONFLICT');expect(h.state().project).toBe(before);
});
