import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {evaluateRecordingSnapshot,prepareSnapshotBatch,prepareSnapshotPreview,type SnapshotCommand} from '../app/recordingSnapshotApi';
import {applySnapshotCommand} from '../domain/recordingSnapshot/commands';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../domain/recordingSnapshot/model';
import {identityScenePlacement,type ScenePlacementValue} from '../domain/recordingScene/model';
import type {LandmarkProject} from '../domain/landmarks/model';
import {sub,type DrawingDocument,type Point2} from '../domain/drawing/model';

const unwrap=<T,>(result:VectorResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function fixture(options:{linked?:boolean;shared?:boolean;smooth?:boolean;arc?:boolean;handleDelta?:number;lastNodeDeltaX?:number}={}){
 const w=emptyRecordingSnapshotWorkspace(),connected=options.linked||options.shared;
 w.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,1]},...(!options.shared?{c:{id:'c',position:connected?[1,1]:[3,2] as Point2}}:{}),d:{id:'d',position:[4,3]}};
 w.library.curves={first:{id:'first',name:'First',nodes:['a','b'],handles:[[.2,.3],[.7,.6]],width:.01,visible:true,locked:false},second:{id:'second',name:'Second',nodes:[options.shared?'b':'c','d'],handles:[connected?[1.6,1.8]:[3.6,2.8],[3.7,2.6]],width:.01,visible:true,locked:false}};
 const start=emptyRecordingSnapshot('start','Start'),end=emptyRecordingSnapshot('end','End','view',{x:90,y:0});
 for(const s of [start,end]){
  s.layers=[{kind:'original',id:'left',name:'Left',visible:true,locked:false,items:['first']},{kind:'original',id:'right',name:'Right',visible:true,locked:false,items:['second']}];
  if(options.shared)s.relations.joins={add:[{id:'smooth',a:{curveId:'first',end:1},b:{curveId:'second',end:0},mode:options.arc?'ARC':options.smooth?'SMOOTH':'CUSP',...(options.arc?{radius:.1}:{})}]};
  if(options.linked)s.relations.endpointLinks={add:[{id:'link',a:{curveId:'first',end:1},b:{curveId:'second',end:0},...(options.smooth?{joinBrush:{kind:'SMOOTH' as const}}:{})}]};
 }
 end.deformation.layers={left:{shape:{nodes:{a:[2,3],b:[3,4]},handles:{first:[[options.handleDelta??.3,.4],[-.3,-.4]]}}},right:{shape:{nodes:{...(options.shared?{b:[3,4] as Point2}:{c:connected?[3,4] as Point2:[4,5] as Point2}),d:[options.lastNodeDeltaX??5,6]},handles:{second:[[.6,.8],[-.4,-.3]]}}}};
 const original=emptySnapshotRecording('original','Original');original.snapshotIds=['start','end'];original.activeSnapshotId='start';w.snapshots=[start,end];w.recordings=[original];w.activeRecordingId=original.id;
 let project:LandmarkProject={...createEmptyProject(),recordingSnapshots:w};const past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=> 'recording',commitDrawing(){throw Error('Unexpected source edit');},commitRecordingSnapshots(recordingSnapshots){past.push(project);future.length=0;project={...project,recordingSnapshots};},undo(){const previous=past.pop();if(previous){future.push(project);project=previous;}},redo(){const next=future.pop();if(next){past.push(project);project=next;}}});
 const apply=(...commands:SnapshotCommand[])=>unwrap(api.snapshot({commands}));
 apply({op:'createEndpointPairRecording',startSnapshotId:'start',endSnapshotId:'end'},{op:'setAngle',angle:{x:45,y:0}});
 const current=()=>project.recordingSnapshots!.recordings.find(r=>r.id===project.recordingSnapshots!.activeRecordingId)!;
 return {api,apply,past,current,project:()=>project,drawing:()=>evaluateRecordingSnapshot(project).drawing};
}
const transform=(value:Partial<ScenePlacementValue>,curveIds=['first','second']):SnapshotCommand=>({op:'transformShapeElements',curveIds,value:{...identityScenePlacement(),...value}});
const affine=(p:Point2,v:ScenePlacementValue):Point2=>{const r=v.rotation*Math.PI/180,x=p[0]*(v.scaleX??v.scale),y=p[1]*(v.scaleY??v.scale);return [Math.cos(r)*x-Math.sin(r)*y+v.translation[0],Math.sin(r)*x+Math.cos(r)*y+v.translation[1]];};
const pointNear=(actual:Point2,expected:Point2)=>{expect(actual[0]).toBeCloseTo(expected[0],10);expect(actual[1]).toBeCloseTo(expected[1],10);};
function transformedControls(before:DrawingDocument,after:DrawingDocument,value:ScenePlacementValue){for(const node of before.nodes)pointNear(after.nodes.find(n=>n.id===node.id)!.position,affine(node.position,value));for(const curve of before.curves)for(const end of [0,1] as const)pointNear(after.curves.find(c=>c.id===curve.id)!.handles[end],affine(curve.handles[end],value));}
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}

test('grouped translation changes only node responses, keeps source/bases/keys, and commits one undo batch',()=>{
 const h=fixture(),before=h.project(),drawing=h.drawing(),count=h.past.length,command=transform({translation:[.4,0]});
 h.apply(command,{op:'updateEndpointCorrection'});expect(h.past).toHaveLength(count+1);
 transformedControls(drawing,h.drawing(),(command as {value:ScenePlacementValue}).value);
 const responses=h.current().endpointPair!.responses!;expect(Object.keys(responses.nodes).sort()).toEqual(['a','b','c','d']);expect(responses.handles).toEqual({});expect(Object.values(responses.nodes).every(response=>response.x?.length===1&&response.y===undefined)).toBe(true);
 expect(h.project().recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);expect(h.project().recordingSnapshots!.snapshots).toEqual(before.recordingSnapshots!.snapshots);expect(h.project().recordingSnapshots!.recordings[0]).toEqual(before.recordingSnapshots!.recordings[0]);expect(h.current().tracks).toEqual([]);
 const after=h.project();unwrap(h.api.undo());expect(h.project()).toBe(before);unwrap(h.api.redo());expect(h.project()).toBe(after);
});

for(const [name,value] of Object.entries({rotation:{rotation:31},scale:{scale:1.4},independentAxes:{scaleX:1.6,scaleY:.4},zeroXAxis:{scaleX:0,scaleY:1}}))test(`grouped ${name} reaches affine final controls through node and relative-handle responses`,()=>{
 const h=fixture(),before=h.drawing(),command=transform({translation:[.2,-.1],...value});h.apply(command);
 transformedControls(before,h.drawing(),(command as {value:ScenePlacementValue}).value);expect(Object.keys(h.current().endpointPair!.draft!.responses.handles).sort()).toEqual(['first','second']);expect(h.current().tracks).toEqual([]);
});

test.each(['shared','linked'] as const)('%s positions keep one authority under a group transform and preserve SMOOTH',kind=>{
 const h=fixture({[kind]:true,smooth:true}),before=h.drawing(),command=transform({translation:[.1,-.2],rotation:27,scaleX:1.3,scaleY:.7});h.apply(command);
 transformedControls(before,h.drawing(),(command as {value:ScenePlacementValue}).value);
 const responses=h.current().endpointPair!.draft!.responses;expect(Object.keys(responses.nodes).sort()).toEqual(['a','b','d']);expect(responses.nodes.c).toBeUndefined();
 const after=h.drawing(),b=after.nodes.find(n=>n.id==='b')!.position,c=after.curves.find(c=>c.id==='first')!,d=after.curves.find(c=>c.id==='second')!,u=sub(c.handles[1],b),v=sub(d.handles[0],b);expect(u[0]*v[1]-u[1]*v[0]).toBeCloseTo(0,12);
});

test('a partial linked selection moves its authority once and only translates its unselected incident handle',()=>{
 const h=fixture({linked:true}),before=h.drawing();h.apply(transform({translation:[.25,-.5]},['second']));const after=h.drawing();
 for(const id of ['b','c','d'])pointNear(after.nodes.find(n=>n.id===id)!.position,affine(before.nodes.find(n=>n.id===id)!.position,{...identityScenePlacement(),translation:[.25,-.5]}));
 expect(after.nodes.find(n=>n.id==='a')).toEqual(before.nodes.find(n=>n.id==='a'));expect(after.curves.find(c=>c.id==='first')!.handles[0]).toEqual(before.curves.find(c=>c.id==='first')!.handles[0]);
 expect(Object.keys(h.current().endpointPair!.draft!.responses.nodes).sort()).toEqual(['b','d']);expect(h.current().endpointPair!.draft!.responses.handles).toEqual({});
});

for(const delta of [0,1e-16])test(`unavailable ${delta} handle axis rejects the entire candidate before mutating even an existing draft`,()=>{
 const h=fixture({handleDelta:delta});h.apply({op:'moveShapeNode',layerId:'left',nodeId:'a',position:[1.2,1.5]});
 const workspace=structuredClone(h.project().recordingSnapshots!),before=JSON.stringify(workspace),draft=workspace.recordings.find(r=>r.id===workspace.activeRecordingId)!.endpointPair!.draft;
 expect(()=>applySnapshotCommand(workspace,transform({scale:1.2}))).toThrow(/Handle first end 0 X: The endpoint coordinate delta is zero or numerically indistinguishable from zero/);
 expect(JSON.stringify(workspace)).toBe(before);expect(workspace.recordings.find(r=>r.id===workspace.activeRecordingId)!.endpointPair!.draft).toBe(draft);
 const project=h.project(),count=h.past.length;expect(h.api.snapshot({commands:[transform({scale:1.2})]})).toMatchObject({ok:false,error:{code:'ENDPOINT_AXIS_UNAVAILABLE'}});expect(h.project()).toBe(project);expect(h.past).toHaveLength(count);
});

test('an unavailable late node axis rejects every earlier solved target with its exact node diagnostic',()=>{
 const h=fixture({lastNodeDeltaX:0}),before=h.project();expect(h.api.snapshot({commands:[transform({translation:[.2,0]})]})).toMatchObject({ok:false,error:{code:'ENDPOINT_AXIS_UNAVAILABLE',message:expect.stringContaining('Node d X:')}});expect(h.project()).toBe(before);expect(h.current().endpointPair!.draft).toBeUndefined();
});

test('native group previews match strict batches and leave frozen source inputs unchanged',()=>{
 const h=fixture({linked:true,smooth:true}),before=freeze(h.project()),commands=[transform({rotation:19,scaleX:1.2,scaleY:.8})];
 const preview=prepareSnapshotPreview(before,{commands}),strict=prepareSnapshotBatch(before,{commands,dryRun:true});expect(preview.recordingSnapshots).toEqual(strict.recordingSnapshots);expect(preview.recordingSnapshots.library).toBe(before.recordingSnapshots!.library);expect(preview.recordingSnapshots.snapshots).toBe(before.recordingSnapshots!.snapshots);expect(h.current().endpointPair!.draft).toBeUndefined();
});

test('grouped corrections still refuse absolute placement tracks at an interior angle',()=>{
 const h=fixture();for(const op of ['setLayerPlacement','setShapeElementPlacement'] as const)expect(h.api.snapshot({commands:[op==='setLayerPlacement'?{op,layerId:'left',value:identityScenePlacement()}:{op,curveIds:['first'],value:identityScenePlacement()}]})).toMatchObject({ok:false,error:{code:'ENDPOINT_CORRECTION_ONLY'}});expect(h.current().tracks).toEqual([]);
});

test('SMOOTH boundary propagation preserves explicit selected targets and does not depend on selection order',()=>{
 const h=fixture({linked:true,smooth:true}),before=h.drawing(),command=transform({rotation:17,scaleX:1.2,scaleY:.8},['second']);h.apply(command);const after=h.drawing(),value=(command as {value:ScenePlacementValue}).value;
 for(const end of [0,1] as const)pointNear(after.curves.find(c=>c.id==='second')!.handles[end],affine(before.curves.find(c=>c.id==='second')!.handles[end],value));
 expect(after.nodes.find(n=>n.id==='a')).toEqual(before.nodes.find(n=>n.id==='a'));const oldVector=sub(before.curves.find(c=>c.id==='first')!.handles[1],before.nodes.find(n=>n.id==='b')!.position),newVector=sub(after.curves.find(c=>c.id==='first')!.handles[1],after.nodes.find(n=>n.id==='b')!.position);expect(Math.hypot(...newVector)).toBeCloseTo(Math.hypot(...oldVector),12);
 const a=fixture({linked:true,smooth:true}),b=fixture({linked:true,smooth:true});a.apply(transform(value,['first','second']));b.apply(transform(value,['second','first']));expect(a.current().endpointPair!.draft!.responses).toEqual(b.current().endpointPair!.draft!.responses);
});

test('a genuine basis mutation is still checked when the batch subsequently moves to an interior angle',()=>{
 const h=fixture();h.apply({op:'setAngle',angle:{x:0,y:0}});const before=h.project(),commands:SnapshotCommand[]=[{op:'removeLayers',layerIds:['left']},{op:'setAngle',angle:{x:45,y:0}}];
 expect(h.api.snapshot({commands})).toMatchObject({ok:false,error:{code:'ENDPOINT_BASIS_INCOMPATIBLE',commandIndex:0}});expect(h.project()).toBe(before);expect(()=>prepareSnapshotPreview(before,{commands})).toThrow(/canonical IDs differ/);
});


test('ARC radius-changing scale is rejected atomically while translation and rotation retain its brush',()=>{
 const h=fixture({shared:true,arc:true}),drawing=h.drawing(),translation=transform({translation:[.2,-.1]});h.apply(translation);transformedControls(drawing,h.drawing(),(translation as {value:ScenePlacementValue}).value);
 const rotated=h.drawing(),rotation=transform({rotation:12});h.apply(rotation);transformedControls(rotated,h.drawing(),(rotation as {value:ScenePlacementValue}).value);
 const project=h.project(),workspace=structuredClone(project.recordingSnapshots!),before=JSON.stringify(workspace),command=transform({scale:1.2});
 expect(()=>applySnapshotCommand(workspace,command)).toThrow(/ARC smooth radius changes.*basis endpoint/);expect(JSON.stringify(workspace)).toBe(before);
 expect(h.api.snapshot({commands:[command]})).toMatchObject({ok:false,error:{code:'ENDPOINT_ARC_BASIS_REQUIRED'}});expect(()=>prepareSnapshotPreview(project,{commands:[command]})).toThrow(/ARC smooth radius changes/);expect(h.project()).toBe(project);expect(h.drawing().joins.find(join=>join.id==='smooth')!.radius).toBeCloseTo(drawing.joins.find(join=>join.id==='smooth')!.radius!,12);
});
