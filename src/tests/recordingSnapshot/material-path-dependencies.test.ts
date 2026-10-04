import {describe,expect,test} from 'vitest';
import {emptyDrawing,type Cubic,type DrawingCurve,type DrawingDocument as Doc,type Point2} from '../../domain/drawing/model';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {resolveDisplayRoute} from '../../domain/drawing/displayRoutes';
import {registerEvaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {appendEvaluatedDeformation} from '../../domain/drawing/evaluatedDeformation';
import {createFittedGeometryProjector} from '../../domain/drawing/cageGeometry';
import {withIntervalPinch} from '../../domain/drawing/intervalPinch';
import {drawingMaterialPathDependencies,drawingReadContextStats,prepareDrawingReadContext,preparedDrawingReadContext,withDrawingReadScope} from '../../domain/drawing/readContext';
import {endpointPairDisplayField,replaceEndpointPairMaterial,transportEndpointPairMaterial} from '../../domain/recordingSnapshot/endpointPairMaterial';
import type {StrokePath} from '../../domain/drawing/strokes';

let serial=0;
function fixture(routed=false):Doc {
 const positions:Record<string,Point2>={a0:[0,0],a1:[2,0],b1:[2,2],c0:[2,0],c1:[2,-2],z0:[5,0],z1:[6,1]};
 const curve=(id:string,a:string,b:string):DrawingCurve=>({id,name:id,nodes:[a,b],handles:[1/3,2/3].map(t=>[positions[a][0]+t*(positions[b][0]-positions[a][0]),positions[a][1]+t*(positions[b][1]-positions[a][1])]) as [Point2,Point2],width:.01,visible:true,locked:false});
 return {...emptyDrawing(),nodes:Object.entries(positions).map(([id,position])=>({id,position})),curves:[curve('z','z0','z1'),curve('c','c0','c1'),curve('b','a1','b1'),curve('a','a0','a1')],
  layers:[{id:`local-${++serial}`,name:'Local',items:['a','b'],visible:true,locked:false},{id:'linked',name:'Linked',items:['c'],visible:true,locked:false},{id:'other',name:'Other',items:['z'],visible:true,locked:false}],
  joins:[{id:'arc',a:{curveId:'a',end:1},b:{curveId:'b',end:0},mode:'ARC',radius:.2}],
  endpointLinks:[{id:'link',a:{curveId:'a',end:1},b:{curveId:'c',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.2}}],
  displayIntervals:[{id:'track',anchor:{id:'a',reverse:false},ranges:[{id:'range',start:.13,end:.83}],...(routed?{displayRoute:{seed:{segments:[{id:'a',reverse:false}],closed:false},throughLinkIds:['link']}}:{})}],
 };
}
const path:StrokePath={segments:[{id:'a',reverse:false}],closed:false};
const field=(d:Doc,p=path)=>withDrawingReadScope(()=>endpointPairDisplayField(d,p));
const changeCurve=(d:Doc,id:string)=>d.curves.find(c=>c.id===id)!;
const changeNode=(d:Doc,id:string)=>d.nodes.find(n=>n.id===id)!;
function materialOutput(value:ReturnType<typeof displayField>){
 return {geometry:value.geometry,total:value.total,parts:value.parts.map(part=>({shape:part.shape,start:part.start,length:part.length,pts:part.pts,dist:part.dist})),tracks:value.tracks,mask:value.mask,pinches:value.pinches,inkSpans:value.inkSpans,points:[0,.13,.5,.83,1].map(t=>value.at(t)),coordinates:value.tracks.map(track=>[value.native(track,.37),value.relative(track,.61)]),diagnostics:'diagnostics' in value?value.diagnostics:undefined};
}

describe('shared material dependency indexing',()=>{
 test('lazily compiles ordered ID addresses once and retains them through fresh numeric samples',()=>{
  const d=fixture(),before=drawingReadContextStats(),context=prepareDrawingReadContext(d);
  expect(drawingReadContextStats().materialDependencyIndexes).toBe(before.materialDependencyIndexes);
  const first=drawingMaterialPathDependencies(d,['a'])!;
  expect(first.dependencies).toEqual({curveIds:['c','b','a'],nodeIds:['a0','a1','b1','c0','c1'],joinIds:['arc'],linkIds:['link']});
  for(let i=0;i<40;i++){
   const next=structuredClone(d);changeCurve(next,'a').handles[0][1]=i/100;
   withDrawingReadScope(()=>{
    const current=drawingMaterialPathDependencies(next,['a'])!;
    expect(current.dependencies).toBe(first.dependencies);expect(current.structuralIdToken).toBe(first.structuralIdToken);
    expect(current.context.topology).toBe(context.topology);expect(current.context.curves.get('a')).toBe(changeCurve(next,'a'));
   });
  }
  const after=drawingReadContextStats();expect(after.materialDependencyIndexes-before.materialDependencyIndexes).toBe(1);expect(after.materialPathPlans-before.materialPathPlans).toBe(1);
 });
 test.each([false,true])('unaffected geometry reuses the same material field with route=%s',routed=>{
  const d=fixture(routed),p=displayPath(d,'a'),first=field(d,p),next=structuredClone(d);
  changeCurve(next,'z').handles[0][1]=8;changeNode(next,'z1').position[0]=9;
  expect(field(next,p)).toBe(first);
 });
 test.each([
  ['path handle',(d:Doc)=>{changeCurve(d,'a').handles[0][1]=.3;}],
  ['path node',(d:Doc)=>{changeNode(d,'a0').position[1]=.2;}],
  ['path material width',(d:Doc)=>{changeCurve(d,'a').width=.02;}],
  ['incident ARC radius',(d:Doc)=>{d.joins[0].radius=.31;}],
  ['incident ARC mode',(d:Doc)=>{d.joins[0].mode='CUSP';}],
  ['ARC neighbor handle',(d:Doc)=>{changeCurve(d,'b').handles[1][0]=2.2;}],
  ['ARC neighbor node',(d:Doc)=>{changeNode(d,'b1').position[0]=2.4;}],
  ['incident link brush',(d:Doc)=>{d.endpointLinks![0].joinBrush={kind:'ARC',trimDistance:.3};}],
  ['link neighbor handle',(d:Doc)=>{changeCurve(d,'c').handles[1][0]=2.2;}],
  ['link neighbor node',(d:Doc)=>{changeNode(d,'c1').position[0]=2.4;}],
  ['current range',(d:Doc)=>{d.displayIntervals![0].ranges[0].end=.74;}],
  ['current brush',(d:Doc)=>{d.displayIntervals![0].ranges[0].inkEnds=[{taper:.1},{extension:.1}];}],
  ['transient pinch',(d:Doc)=>{withIntervalPinch(d.displayIntervals![0].ranges[0],.7);}]
 ] as const)('%s invalidates the field with current values',(_name,mutate)=>{
  const d=fixture(),first=field(d),next=structuredClone(d);mutate(next);const current=field(next);
  expect(current).not.toBe(first);expect(materialOutput(current)).toEqual(materialOutput(displayField(next,path)));
 });
 test.each([
  ['incident join endpoints',(d:Doc)=>{d.joins[0].b={curveId:'c',end:0};}],
  ['incident link endpoints',(d:Doc)=>{d.endpointLinks![0].b={curveId:'b',end:0};}],
  ['new incident relation',(d:Doc)=>{d.joins.push({id:'second',a:{curveId:'z',end:1},b:{curveId:'a',end:0},mode:'CUSP'});}],
  ['curve order',(d:Doc)=>{d.curves.reverse();}],
  ['node order',(d:Doc)=>{d.nodes.reverse();}],
  ['curve node membership',(d:Doc)=>{changeCurve(d,'b').nodes[1]='z1';}]
 ] as const)('%s rebuilds dependency addresses',(_name,mutate)=>{
  const d=fixture(),first=field(d),next=structuredClone(d);mutate(next);
  expect(field(next)).not.toBe(first);
 });
 test('route precedence, off-path declarations and remote structural IDs remain dependencies',()=>{
  const d=fixture(true),p=displayPath(d,'a');
  d.displayIntervals!.push({id:'other-route',anchor:{id:'z',reverse:false},ranges:[],displayRoute:{seed:{segments:[{id:'z',reverse:false}],closed:false},throughLinkIds:[]}});
  const first=field(d,p);
  for(const mutate of [
   (next:Doc)=>{next.displayIntervals!.reverse();},
   (next:Doc)=>{next.displayIntervals![1].displayRoute!.seed.segments[0].reverse=true;},
   (next:Doc)=>{next.displayIntervals![1].anchor.reverse=true;},
   (next:Doc)=>{next.curves.push({...changeCurve(next,'z'),id:'display-join:link'});},
   (next:Doc)=>{next.layers[2].items=[];},
   (next:Doc)=>{changeCurve(next,'z').nodes.reverse();},
  ]){const next=structuredClone(d);mutate(next);expect(field(next,p)).not.toBe(first);}
 });
 test('current interval wrappers share structural plans while source tracks and pinches stay live',()=>{
  const d=fixture(),first=field(d),hidden={...d,displayIntervals:[{...d.displayIntervals![0],ranges:[withIntervalPinch({id:'gap',start:.5,end:.5,mode:'HIDE' as const},.4)]}]};
  const current=field(hidden);expect(current).not.toBe(first);expect(current.tracks).toEqual(hidden.displayIntervals);expect(current.pinches).toHaveLength(1);expect(current.pinches[0].strength).toBe(.4);
  withDrawingReadScope(()=>{
   const initial=drawingMaterialPathDependencies(hidden,['a'])!;
   replaceEndpointPairMaterial(hidden,[]);const empty=endpointPairDisplayField(hidden,path);
   expect(empty.tracks).toEqual([]);expect(empty.pinches).toEqual([]);expect(empty).not.toBe(current);
   expect(drawingMaterialPathDependencies(hidden,['a'])!.dependencies).toBe(initial.dependencies);
  });
  expect(d.displayIntervals).toHaveLength(1);expect(first.tracks).toEqual(d.displayIntervals);
 });
 test('default mutable documents keep guarded array-filter signatures and no retained dependency plan',()=>{
  const d=fixture(),first=endpointPairDisplayField(d,path);expect(drawingMaterialPathDependencies(d,['a'])).toBeUndefined();
  changeNode(d,'b1').position[0]+=.5;
  const next={...d};expect(endpointPairDisplayField(next,path)).not.toBe(first);
  expect(preparedDrawingReadContext(d)).toBeUndefined();expect(preparedDrawingReadContext(next)).toBeUndefined();
 });
 test('duplicate IDs retain array-filter semantics instead of collapsing distinct dependency values',()=>{
  const d=fixture();d.curves.push({...changeCurve(d,'b'),handles:[[2,.4],[2,.8]]});prepareDrawingReadContext(d);
  expect(drawingMaterialPathDependencies(d,['a'])).toBeUndefined();
  const first=endpointPairDisplayField(d,path),next=structuredClone(d);next.curves.at(-1)!.handles[1][1]+=.01;
  expect(field(next)).not.toBe(first);
 });
 test('deferred affine placement still exits before compiling material dependencies',()=>{
  const source=fixture(),drawing=structuredClone(source),point=([x,y]:Point2):Point2=>[2*x+.1,3*y-.2];
  drawing.nodes=drawing.nodes.map(node=>({...node,position:point(node.position)}));drawing.curves=drawing.curves.map(curve=>({...curve,handles:curve.handles.map(point) as [Point2,Point2]}));
  registerEvaluatedAffine(drawing,source,()=>({point,maxScale:3}));const before=drawingReadContextStats();
  expect(materialOutput(field(drawing))).toEqual(materialOutput(displayField(drawing,path)));
  expect(drawingReadContextStats().materialDependencyIndexes).toBe(before.materialDependencyIndexes);
 });
 test('equal fitted controls cannot reuse fields with different retained material programs',()=>{
  const source=fixture();source.joins=[];source.endpointLinks=[];
  const ordinary=field(source),first=structuredClone(source),second=structuredClone(source);
  for(const [drawing,middle] of [[first,.25],[second,.75]] as const){
   const fit=(shape:Cubic)=>({shape,parameters:{values:[0,middle,1]},maxError:0});
   appendEvaluatedDeformation(drawing,source,new Set(['a']),createFittedGeometryProjector(piece=>fit(piece.shape),fit),`program-${middle}`);
  }
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));const before=drawingReadContextStats(),a=field(first),b=field(second);
  expect(a).not.toBe(ordinary);expect(b).not.toBe(a);expect(a.geometry).toEqual(b.geometry);expect(a.at(.5).p).not.toEqual(b.at(.5).p);
  expect(materialOutput(a)).toEqual(materialOutput(displayField(first,path)));expect(materialOutput(b)).toEqual(materialOutput(displayField(second,path)));
  expect(drawingReadContextStats().materialDependencyIndexes).toBe(before.materialDependencyIndexes);
 });
 test.each([false,true])('geometry, material transport and diagnostics are exact with route=%s',routed=>{
  const source=fixture(routed),current=structuredClone(source);changeCurve(current,'a').handles[0][1]=.07;
  const p=displayPath(current,'a'),expected=displayField(current,p),before=JSON.stringify([source,current]);
  expect(materialOutput(field(current,p))).toEqual(materialOutput(expected));
  const directDiagnostics:string[]=[],indexedDiagnostics:string[]=[],track=source.displayIntervals![0];
  const direct=transportEndpointPairMaterial(source,track,current,directDiagnostics);
  const indexedSource=structuredClone(source),indexedCurrent=structuredClone(current);
  const indexed=withDrawingReadScope(()=>transportEndpointPairMaterial(indexedSource,indexedSource.displayIntervals![0],indexedCurrent,indexedDiagnostics));
  expect(indexed).toEqual(direct);expect(indexedDiagnostics).toEqual(directDiagnostics);
  if(routed){
   const invalid=structuredClone(current);changeNode(invalid,'c0').position[0]+=.3;
   const route=invalid.displayIntervals![0].displayRoute!,diagnostics=resolveDisplayRoute(invalid,route).diagnostics;
   expect(withDrawingReadScope(()=>resolveDisplayRoute(invalid,route)).diagnostics).toEqual(diagnostics);
   expect(diagnostics.map(d=>d.code)).toEqual(['SEPARATED_LINK']);
   expect(()=>withDrawingReadScope(()=>transportEndpointPairMaterial(indexedSource,indexedSource.displayIntervals![0],invalid,[]))).toThrow(diagnostics[0].message);
  }
  expect(JSON.stringify([source,current])).toBe(before);
 });
});
