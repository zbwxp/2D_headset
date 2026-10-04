import {describe,expect,it} from 'vitest';
import type {DrawingDocument} from '../../domain/drawing/model';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateRecordingSnapshot,resolveSnapshot,snapshotViewMirrorOptions} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {mirrorViewDrawing} from '../../domain/recordingSnapshot/viewMirrorMath';
import {prepareSnapshotViewMirrorSurface} from '../../domain/recordingSnapshot/viewMirrorSurface';
import {interpolateSnapshotSimplexGeometry,type SnapshotSimplexBasis} from '../../domain/recordingSnapshot/simplexGeometry';
import {createSnapshotSurfaceValueSampler,prepareSnapshotSurfaceTargetEdit} from '../../domain/recordingSnapshot/surfaceTargets';
import {locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {interpolateSnapshotSurfaceOnion} from '../../ui/vectorRecording/surfaceOnion';

const at=(x:number)=>({x,y:0});
function fixture(reverse=true){
 const w=emptyRecordingSnapshotWorkspace();
 w.library.nodes={a:{id:'a',position:[-.7,.2]},b:{id:'b',position:[-.2,.3]},c:{id:'c',position:[.4,.5]},d:{id:'d',position:[.9,.6]}};
 w.library.curves={left:{id:'left',name:'Left',nodes:['a','b'],handles:[[-.6,.1],[-.3,.4]],visible:true,locked:false,width:.01},right:{id:'right',name:'Right',nodes:['c','d'],handles:[[.5,.4],[.8,.7]],visible:true,locked:false,width:.01}};
 const source=emptyRecordingSnapshot('source','Source','drawing');source.layers=[{kind:'original',id:'layer',name:'Layer',items:['left','right'],visible:true,locked:false}];source.source={artworkId:'asset',originIds:{},mirrorAxisX:0,mirrorEditing:{enabled:false,curvePairs:[{id:'pair',a:'left',b:'right',reverse}]}};
 const zero=emptyRecordingSnapshot('zero','Zero','view',at(0)),left=emptyRecordingSnapshot('left-view','Left','view',at(-90)),right=emptyRecordingSnapshot('right-view','Right','view',at(90));
 for(const view of [zero,left]){view.parentSnapshotId=source.id;view.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:source.id,baseLayerId:'layer'}];}
 zero.deformation.layers.layer={placement:{...identityScenePlacement(),translation:[.3,.1]}};
 left.deformation.layers.layer={shape:{nodes:{a:[.8,.6],b:[.7,.8],c:[.5,-.3],d:[.9,-.5]},handles:{left:[[.6,.4],[-.2,.5]],right:[[.5,-.2],[-.4,-.6]]}}};
 right.parentSnapshotId=left.id;right.parentLayers={};right.inputMirror={axisX:123,curvePairs:[]};right.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:left.id,baseLayerId:'layer'}];
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=[zero.id,left.id,right.id];recording.activeSnapshotId=zero.id;recording.angle=at(0);recording.angleGraph=createSnapshotAngleGraph([zero,left,right].map(view=>({snapshotId:view.id,angle:view.angle})));
 w.snapshots=[source,zero,left,right];w.recordings=[recording];w.activeRecordingId=recording.id;
 return {w,source,zero,left,right,recording};
}
const drawing=(f:ReturnType<typeof fixture>,x:number,useDraft=true)=>evaluateRecordingSnapshot(f.w,f.recording.id,{angle:at(x),useDraft,diagnostics:'preview'}).drawing;
function sameControls(actual:DrawingDocument,expected:DrawingDocument){
 expect(actual.curves.map(curve=>curve.id)).toEqual(expected.curves.map(curve=>curve.id));
 for(const node of actual.nodes)for(const axis of [0,1] as const)expect(node.position[axis]).toBeCloseTo(expected.nodes.find(value=>value.id===node.id)!.position[axis],10);
 for(const curve of actual.curves)for(const end of [0,1] as const)for(const axis of [0,1] as const)expect(curve.handles[end][axis]).toBeCloseTo(expected.curves.find(value=>value.id===curve.id)!.handles[end][axis],10);
}
function expected(f:ReturnType<typeof fixture>,x:number,useDraft=true){const zero=evaluateRecordingSnapshot(f.w,f.recording.id,{angle:at(0),useDraft,diagnostics:'preview'});return mirrorViewDrawing(drawing(f,-x,useDraft),zero.drawing,snapshotViewMirrorOptions(f.w,f.recording,zero)).drawing;}
function correctNegative(f:ReturnType<typeof fixture>,x:number,save=true){
 applySnapshotCommand(f.w,{op:'setAngle',angle:at(x)});
 applySnapshotCommand(f.w,{op:'moveShapeNode',layerId:'layer',nodeId:'a',position:x===-30?[1.2,-.8]:[-.5,1.4]});
 applySnapshotCommand(f.w,{op:'moveShapeHandle',layerId:'layer',curveId:'left',end:0,position:x===-30?[1.8,-1.2]:[-1.3,1.9]});
 if(save)applySnapshotCommand(f.w,{op:'updateSnapshot'});
}

describe('live whole-negative-branch View mirror responses',()=>{
 it('reflects saved nonlinear node XY and H-P overshoot at every positive angle with reversed ends',()=>{
  const f=fixture();correctNegative(f,-30);correctNegative(f,-60);const before=JSON.stringify(f.w),graph=f.recording.angleGraph!;
  for(const angle of [5,15,30,45,60,75,89])sameControls(drawing(f,angle),expected(f,angle));
  sameControls(drawing(f,0),resolveSnapshot(f.w,f.zero.id,{useDraft:false}).drawing);
  expect(JSON.stringify(f.w)).toBe(before);expect(graph.mesh.vertices.filter(vertex=>vertex.angle.x===0)).toHaveLength(1);expect(f.recording.tracks).toEqual([]);
  const parsed=parseRecordingSnapshots(JSON.parse(before));expect(parsed).toEqual(f.w);
 });
 it('shares current negative draft and saved-only sampling with complete onion geometry',()=>{
  const f=fixture();correctNegative(f,-30,false);const current=evaluateRecordingSnapshot(f.w,f.recording.id,{useDraft:true,diagnostics:'preview'}),before=JSON.stringify(f.w);
  sameControls(drawing(f,30),expected(f,30));expect(drawing(f,30).nodes).not.toEqual(drawing(f,30,false).nodes);
  for(const useDraft of [true,false]){const evaluated=useDraft?current:evaluateRecordingSnapshot(f.w,f.recording.id,{useDraft:false,diagnostics:'preview'}),onion=interpolateSnapshotSurfaceOnion(f.recording,evaluated,{startSnapshotId:f.zero.id,endSnapshotId:f.right.id},10);for(const frame of onion.frames)sameControls(frame.drawing,drawing(f,frame.angle.x,useDraft));}
  expect(JSON.stringify(f.w)).toBe(before);
  applySnapshotCommand(f.w,{op:'discardEndpointCorrection'});sameControls(drawing(f,30),expected(f,30));
 });
 it('replays positive node and relative-handle edits on the live inherited response while retaining +90 overrides',()=>{
  const f=fixture();correctNegative(f,-30);correctNegative(f,-60);
  f.right.deformation.layers.layer={placement:{...identityScenePlacement(),translation:[.15,-.2]}};
  const endpoint=drawing(f,90),source=JSON.stringify(f.w.snapshots),negative=JSON.stringify(f.recording.angleGraph!.edgeResponses);
  applySnapshotCommand(f.w,{op:'setAngle',angle:at(30)});applySnapshotCommand(f.w,{op:'moveShapeNode',layerId:'layer',nodeId:'d',position:[.25,.85]});applySnapshotCommand(f.w,{op:'moveShapeHandle',layerId:'layer',curveId:'right',end:1,position:[.05,1.15]});
  expect(drawing(f,30).nodes.find(node=>node.id==='d')!.position).toEqual([expect.closeTo(.25,10),expect.closeTo(.85,10)]);expect(drawing(f,30).curves.find(curve=>curve.id==='right')!.handles[1]).toEqual([expect.closeTo(.05,10),expect.closeTo(1.15,10)]);
  sameControls(drawing(f,90),endpoint);expect(JSON.stringify(f.w.snapshots)).toBe(source);expect(JSON.stringify(f.recording.angleGraph!.edgeResponses)).toBe(negative);
  const draft=drawing(f,30);applySnapshotCommand(f.w,{op:'updateSnapshot'});sameControls(drawing(f,30,false),draft);
 });
 it('invalidates source and zero revisions without serializing sampled controls',()=>{
  const f=fixture();correctNegative(f,-30);const original=drawing(f,30);
  f.left.deformation.layers.layer.shape!.nodes.a=[1.1,.9];const revised=drawing(f,30);expect(revised.nodes).not.toEqual(original.nodes);sameControls(revised,expected(f,30));
  f.zero.deformation.layers.layer.placement!.translation=[.7,-.1];sameControls(drawing(f,30),expected(f,30));
 });
 it('preserves the already projected mirrored SMOOTH baseline and inverses positive corrections through the same component',()=>{
  const f=fixture(),graph=f.recording.angleGraph!,zero=drawing(f,0),options={curvePairs:[{id:'pair',a:'left',b:'right',reverse:true}]};
  const bases:SnapshotSimplexBasis[]=graph.mesh.vertices.map(vertex=>({snapshotId:vertex.snapshotId,angle:vertex.angle,drawing:drawing(f,vertex.angle.x)}));
  for(const basis of bases)basis.drawing={...basis.drawing,joins:[{id:'smooth',a:{curveId:'left',end:0},b:{curveId:'right',end:1},mode:'SMOOTH'}]};
  const baseZero=bases.find(basis=>basis.snapshotId==='zero')!.drawing,negative=bases.find(basis=>basis.snapshotId==='left-view')!.drawing;
  bases.find(basis=>basis.snapshotId==='right-view')!.drawing=mirrorViewDrawing(negative,baseZero,options).drawing;
  const positive=bases.map(basis=>basis.snapshotId==='zero'?{...basis,drawing:mirrorViewDrawing(baseZero,baseZero,options).drawing}:basis),context=prepareSnapshotViewMirrorSurface(graph,bases,baseZero,()=>options);
  const sample=(x:number,g=graph)=>{const location=locateSnapshotSimplex(g.mesh,at(x))!,selected=x>0?positive:bases;return interpolateSnapshotSimplexGeometry(location.snapshotIds.map(id=>selected.find(basis=>basis.snapshotId===id)!),location.geometricWeights,createSnapshotSurfaceValueSampler(g,location,selected,x>0?context:undefined)).drawing;};
  for(const angle of [15,30,45,60,75])sameControls(sample(angle),mirrorViewDrawing(sample(-angle),baseZero,options).drawing);
  const location=locateSnapshotSimplex(graph.mesh,at(30))!,candidate:typeof graph={...graph,edgeResponses:{...graph.edgeResponses,[location.simplexId]:{nodes:{},handles:{right:[{},{x:[[location.geometricWeights[1],.8] as [number,number]],y:[[location.geometricWeights[1],-.2] as [number,number]]}]}}}};
  const wanted=sample(30,candidate),current=sample(30),result=prepareSnapshotSurfaceTargetEdit(graph,location,location.snapshotIds.map(id=>positive.find(basis=>basis.snapshotId===id)!),current,wanted,{angle:at(30),frameId:'positive-smooth',allBases:positive,mirror:context});
  expect(result.changed).toBe(true);sameControls(sample(30,result.graph),wanted);
 });
 it('locates opposite source diagonals and carries shared zero-column edge responses only once',()=>{
  const f=fixture(),zero=drawing(f,0),options={curvePairs:[{id:'pair',a:'left',b:'right',reverse:true}]},inputs=[-90,0,90].flatMap(x=>[0,90].map(y=>({snapshotId:`${x}/${y}`,angle:{x,y}}))),graph=createSnapshotAngleGraph(inputs);
  const native:SnapshotSimplexBasis[]=inputs.map(({snapshotId,angle})=>{const k=angle.x/90,p=angle.y/90;return {snapshotId,angle,drawing:{...zero,nodes:zero.nodes.map((node,index)=>({...node,position:[node.position[0]+k*(index+1)*.2+p*.13,node.position[1]+k*.23-p*(index+1)*.11] as [number,number]})),curves:zero.curves.map((curve,index)=>({...curve,handles:curve.handles.map((handle,end)=>[handle[0]+k*(index+end+1)*.17+p*.2,handle[1]+k*.3-p*(index+end+1)*.14]) as [[number,number],[number,number]]}))}};});
  for(const edge of graph.mesh.edges)if(edge.vertexIds.every(id=>graph.mesh.vertices.find(vertex=>vertex.id===id)!.angle.x<=0))graph.edgeResponses[edge.id]={nodes:{a:{x:[[.3,1.2]],y:[[.65,-.3]]}},handles:{left:[{x:[[.4,-.7]],y:[[.7,1.4]]},{}]}};
  const positive=native.map(basis=>basis.angle!.x>=0?{...basis,drawing:mirrorViewDrawing(native.find(value=>value.angle!.x===-basis.angle!.x&&value.angle!.y===basis.angle!.y)!.drawing,zero,options).drawing}:basis),context=prepareSnapshotViewMirrorSurface(graph,native,zero,()=>options);
  let different=false;
  for(const angle of [{x:20,y:35},{x:60,y:20},{x:15,y:70},{x:70,y:65}]){
   const sourceLocation=locateSnapshotSimplex(graph.mesh,{x:-angle.x,y:angle.y})!,location=locateSnapshotSimplex(graph.mesh,angle)!;
   const reflectedSupport=location.vertexIds.map(id=>graph.mesh.vertices.find(vertex=>vertex.id===id)!.angle).map(angle=>`${-angle.x}/${angle.y}`).sort();if(JSON.stringify(reflectedSupport)!==JSON.stringify([...sourceLocation.snapshotIds].sort()))different=true;
   const source=interpolateSnapshotSimplexGeometry(sourceLocation.snapshotIds.map(id=>native.find(basis=>basis.snapshotId===id)!),sourceLocation.geometricWeights,createSnapshotSurfaceValueSampler(graph,sourceLocation,native)).drawing;
   const actual=interpolateSnapshotSimplexGeometry(location.snapshotIds.map(id=>positive.find(basis=>basis.snapshotId===id)!),location.geometricWeights,createSnapshotSurfaceValueSampler(graph,location,positive,context)).drawing;
   sameControls(actual,mirrorViewDrawing(source,zero,options).drawing);
  }
  expect(different).toBe(true);
 });
});
