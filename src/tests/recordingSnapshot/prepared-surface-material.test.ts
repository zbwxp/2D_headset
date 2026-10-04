import {describe,expect,it} from 'vitest';
import {emptyDrawing,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {withIntervalPinch,intervalPinch} from '../../domain/drawing/intervalPinch';
import {registerEvaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {appendEvaluatedDeformation} from '../../domain/drawing/evaluatedDeformation';
import {createFittedGeometryProjector} from '../../domain/drawing/cageGeometry';
import {prepareSnapshotSimplexGeometry,reviseSnapshotSimplexGeometry,snapshotSimplexDrawingRevision,type SnapshotSimplexBasis,type SnapshotSimplexRevisionChanges,type SnapshotScalarTarget} from '../../domain/recordingSnapshot/simplexGeometry';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import type {SnapshotAngleGraph} from '../../domain/recordingSnapshot/model';
import {evaluateSnapshotSurfaceMaterial} from '../../domain/recordingSnapshot/surfaceMaterial';
import {getSnapshotSimplexMaterialStats,resetSnapshotSimplexMaterialStats} from '../../domain/recordingSnapshot/simplexMaterial';

function drawing(count=18):DrawingDocument {
 const drawing=emptyDrawing();drawing.layers=[{id:'layer',name:'Layer',items:[],visible:true,locked:false}];drawing.displayIntervals=[];
 for(let i=0;i<count;i++){
  const id=`curve${i}`,x=i*3;
  drawing.nodes.push({id:`${id}a`,position:[x,0]},{id:`${id}b`,position:[x+1,0]});
  drawing.curves.push({id,name:id,nodes:[`${id}a`,`${id}b`],handles:[[x+.2,.4],[x+.8,-.2]],width:.01,visible:true,locked:false});drawing.layers[0].items.push(id);
  if(i<9)drawing.displayIntervals.push({id:`track${i}`,anchor:{id,reverse:false},ranges:[withIntervalPinch({id:`range${i}`,start:.13,end:.83},i===2?.35:0)]});
 }
 return drawing;
}
function fixture(input=drawing()){
 const bindings=[{snapshotId:'A',angle:{x:-90,y:0}},{snapshotId:'B',angle:{x:0,y:0}}],mesh=createSnapshotTriangulation(bindings),graph:SnapshotAngleGraph={version:1,mesh,edgeResponses:{},triangleResponses:{}},angle={x:-45,y:0},location=locateSnapshotSimplex(mesh,angle)!;
 const bases:SnapshotSimplexBasis[]=bindings.map((binding,index)=>({...binding,drawing:{...input,nodes:input.nodes.map(node=>({...node,position:[node.position[0]*(1+index*.3),node.position[1]*(1+index*.2)] as Point2})),curves:input.curves.map(curve=>({...curve,handles:curve.handles.map(point=>[point[0]*(1+index*.3),point[1]*(1+index*.2)]) as [Point2,Point2]}))}}));
 const normal=prepareSnapshotSimplexGeometry(bases).sample(location.geometricWeights,undefined,{retainLineage:true}),material=evaluateSnapshotSurfaceMaterial(graph,location,bases,normal.drawing,angle,undefined,{retainLineage:true});
 return {graph,angle,location,bases,normal,material};
}
function changeHandle(bases:readonly SnapshotSimplexBasis[],snapshotId:string,curveId:string,delta:Point2):SnapshotSimplexBasis[]{
 return bases.map(basis=>basis.snapshotId!==snapshotId?basis:{...basis,drawing:{...basis.drawing,curves:basis.drawing.curves.map(curve=>curve.id!==curveId?curve:{...curve,handles:[[curve.handles[0][0]+delta[0],curve.handles[0][1]+delta[1]],curve.handles[1]] as [Point2,Point2]})}});
}
const target=(curveId:string):SnapshotScalarTarget=>({kind:'handle',curveId,end:0});
const changes=(curveId:string,bases=['A']):SnapshotSimplexRevisionChanges=>({structureUnchanged:true,basisControls:new Map(bases.map(id=>[id,[target(curveId)]])),responseControls:[]});
const output=(material:ReturnType<typeof evaluateSnapshotSurfaceMaterial>)=>({drawing:material.drawing,diagnostics:material.diagnostics,pinches:material.drawing.displayIntervals?.map(track=>track.ranges.map(intervalPinch))});
function revise(f:ReturnType<typeof fixture>,bases:SnapshotSimplexBasis[],dirty:SnapshotSimplexRevisionChanges,g=f.graph){
 const normal=reviseSnapshotSimplexGeometry(f.normal,bases,f.location.geometricWeights,undefined,dirty)!;expect(normal).toBeDefined();
 resetSnapshotSimplexMaterialStats();
 const material=evaluateSnapshotSurfaceMaterial(g,f.location,bases,normal.drawing,f.angle,undefined,{retainLineage:true,previous:f.material,changes:dirty}),counts=getSnapshotSimplexMaterialStats();
 const cold=evaluateSnapshotSurfaceMaterial(g,f.location,bases,normal.drawing,f.angle);
 expect(output(material)).toEqual(output(cold));return {normal,material,counts};
}

describe('prepared native surface material consumers',()=>{
 it.each(['curve0','curve8'])('transports one of nine paths for %s and retains every unaffected output',id=>{
  const f=fixture(),next=changeHandle(f.bases,'A',id,[.2,.6]),{material,counts}=revise(f,next,changes(id));
  expect(counts).toEqual({transportedTracks:1,transportedBasisTracks:2,reusedTracks:8,dependencyPlans:0,revisionSamples:1});expect(material.paintLayoutUnchanged).toBe(true);
  f.material.drawing.displayIntervals!.forEach((track,index)=>{if(track.anchor.id!==id)expect(material.drawing.displayIntervals![index]).toBe(track);});
 });
 it('transports no paths for nine unpainted curves, without rebuilding the plan',()=>{
  let f=fixture();
  for(let i=9;i<18;i++){
   const next=changeHandle(f.bases,'A',`curve${i}`,[.1,.3]),result=revise(f,next,changes(`curve${i}`));
   expect(result.counts).toEqual({transportedTracks:0,transportedBasisTracks:0,reusedTracks:9,dependencyPlans:0,revisionSamples:1});expect(result.material.drawing.displayIntervals).toBe(f.material.drawing.displayIntervals);
   f={...f,bases:next,normal:result.normal,material:result.material};
  }
 });
 it('skips numerically unchanged source control candidates',()=>{
  const f=fixture(),next=f.bases.map(basis=>({...basis,drawing:{...basis.drawing}})),result=revise(f,next,changes('curve0',['A','B']));
  expect(result.counts).toMatchObject({transportedTracks:0,transportedBasisTracks:0,reusedTracks:9,revisionSamples:1});expect(result.material.drawing.displayIntervals).toBe(f.material.drawing.displayIntervals);
 });
 it('tracks source material changes even when final weighted controls cancel',()=>{
  const f=fixture(),next=changeHandle(changeHandle(f.bases,'A','curve0',[0,.5]),'B','curve0',[0,-.5]),result=revise(f,next,changes('curve0',['A','B']));
  expect(snapshotSimplexDrawingRevision(result.normal.drawing)?.dirtyCurveIds).toEqual([]);
  expect(result.counts).toMatchObject({transportedTracks:1,transportedBasisTracks:2,reusedTracks:8,revisionSamples:1});
 });
 it('retains per-track diagnostics and zero-length intervals exactly',()=>{
  const d=drawing();d.displayIntervals![2].ranges[0]={id:'range2',start:.4,end:.4,mode:'HIDE'};d.nodes[6].position=[9,0];d.nodes[7].position=[9,0];d.curves[3].handles=[[9,0],[9,0]];
  const f=fixture(d),result=revise(f,changeHandle(f.bases,'A','curve0',[0,.25]),changes('curve0'));
  expect(result.material.diagnostics).toEqual(f.material.diagnostics);expect(result.material.diagnostics.length).toBeGreaterThan(0);expect(result.material.drawing.displayIntervals![2]).toBe(f.material.drawing.displayIntervals![2]);
 });
 it.each(['local ARC','route ARC'] as const)('includes the neighboring %s support in the reverse closure',kind=>{
  const d=drawing();d.curves[1].nodes[0]='curve0b';d.nodes=d.nodes.filter(node=>node.id!=='curve1a');d.nodes.find(node=>node.id==='curve1b')!.position=[1,1];d.curves[1].handles=[[1.2,.2],[.8,.8]];
  d.displayIntervals=d.displayIntervals!.filter(track=>track.id!=='track1');
  if(kind==='local ARC')d.joins=[{id:'arc',a:{curveId:'curve0',end:1},b:{curveId:'curve1',end:0},mode:'ARC',radius:.15}];
  else{
   d.nodes.push({id:'curve1a',position:[1,0]});d.curves[1].nodes[0]='curve1a';d.layers[0].items=d.layers[0].items.filter(id=>id!=='curve1');d.layers.push({id:'linked',name:'Linked',visible:true,locked:false,items:['curve1']});
   d.endpointLinks=[{id:'link',a:{curveId:'curve0',end:1},b:{curveId:'curve1',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.15}}];d.displayIntervals[0].displayRoute={seed:{segments:[{id:'curve0',reverse:false}],closed:false},throughLinkIds:['link']};
  }
  const f=fixture(d),result=revise(f,changeHandle(f.bases,'A','curve1',[.1,.3]),changes('curve1'));
  expect(result.counts).toMatchObject({transportedTracks:1,transportedBasisTracks:2,reusedTracks:7,revisionSamples:1});expect(result.material.paintLayoutUnchanged).toBe(true);
 });
 it('includes a source node and preserves exact unmodified source ranges',()=>{
  const f=fixture(),bases=f.bases.map(basis=>basis.snapshotId!=='A'?basis:{...basis,drawing:{...basis.drawing,nodes:basis.drawing.nodes.map(node=>node.id!=='curve0a'?node:{...node,position:[node.position[0]-.2,.1] as Point2})}}),dirty:SnapshotSimplexRevisionChanges={structureUnchanged:true,basisControls:new Map([['A',[{kind:'node',nodeId:'curve0a'}]]]),responseControls:[]},result=revise(f,bases,dirty);
  expect(result.counts).toMatchObject({transportedTracks:1,reusedTracks:8,revisionSamples:1});expect(result.material.drawing.displayIntervals![1]).toBe(f.material.drawing.displayIntervals![1]);
 });
 it('does not retain invalid route precedence and rebuilds after source structure changes',()=>{
  const d=drawing();d.displayIntervals![0].displayRoute={seed:{segments:[{id:'curve0',reverse:false}],closed:false},throughLinkIds:['missing']};const f=fixture(d),next=changeHandle(f.bases,'A','curve9',[0,.3]);
  const result=revise(f,next,changes('curve9'));expect(result.counts.revisionSamples).toBe(0);expect(result.material.paintLayoutUnchanged).toBeUndefined();
  const clean=fixture(),larger=drawing(19),bases=clean.bases.map(basis=>({...basis,drawing:larger})),normal=prepareSnapshotSimplexGeometry(bases).sample(clean.location.geometricWeights,undefined,{retainLineage:true});resetSnapshotSimplexMaterialStats();
  const material=evaluateSnapshotSurfaceMaterial(clean.graph,clean.location,bases,normal.drawing,clean.angle,undefined,{retainLineage:true,previous:clean.material,changes:changes('curve0')});expect(getSnapshotSimplexMaterialStats()).toMatchObject({transportedTracks:9,revisionSamples:0,dependencyPlans:1});expect(material.paintLayoutUnchanged).toBeUndefined();
 });
 it('uses canonical material after a property-response change',()=>{
  const f=fixture(),g={...f.graph,propertyResponses:{edges:{[f.location.simplexId]:[{target:{kind:'interval-endpoint' as const,layerId:'layer',sourceTrackId:'track1',rangeId:'range1',end:'end' as const},knots:[[.5,.8] as [number,number]]}]},triangles:{}}},result=revise(f,changeHandle(f.bases,'A','curve0',[0,.3]),changes('curve0'),g);
  expect(result.counts).toMatchObject({transportedTracks:9,transportedBasisTracks:18,reusedTracks:0,revisionSamples:0});expect(result.material.paintLayoutUnchanged).toBeUndefined();
 });
 it('requires exact prior geometry ancestry, unchanged angle and complete typed changes',()=>{
  const f=fixture(),next=changeHandle(f.bases,'A','curve0',[0,.3]),dirty=changes('curve0'),normal=reviseSnapshotSimplexGeometry(f.normal,next,f.location.geometricWeights,undefined,dirty)!;
  for(const input of [{...normal.drawing},normal.drawing]){
   resetSnapshotSimplexMaterialStats();const result=evaluateSnapshotSurfaceMaterial(f.graph,f.location,next,input,input===normal.drawing?{x:-44,y:0}:f.angle,undefined,{previous:f.material,changes:dirty});
   expect(getSnapshotSimplexMaterialStats()).toMatchObject({transportedTracks:9,revisionSamples:0});expect(result.paintLayoutUnchanged).toBeUndefined();
  }
  resetSnapshotSimplexMaterialStats();evaluateSnapshotSurfaceMaterial(f.graph,f.location,next,normal.drawing,f.angle,undefined,{previous:f.material});expect(getSnapshotSimplexMaterialStats()).toMatchObject({transportedTracks:9,revisionSamples:0});
 });
 it.each(['affine','domain'] as const)('retains the canonical path for %s source programs',kind=>{
  const d=drawing();
  if(kind==='affine')registerEvaluatedAffine(d,{...d,nodes:[...d.nodes]},id=>id==='curve0'?{point:point=>[point[0]*2,point[1]],maxScale:2}:undefined);
  else{const projector=createFittedGeometryProjector(piece=>({shape:piece.shape,parameters:{values:[0,1]},maxError:0}),shape=>({shape,parameters:{values:[0,1]},maxError:0}));appendEvaluatedDeformation(d,{...d,nodes:[...d.nodes]},new Set(['curve0']),projector,'domain');}
  // Keep the exact runtime source node arrays instead of fixture's numeric clone.
  const f=fixture(),bases=f.bases.map(basis=>({...basis,drawing:d})),normal=prepareSnapshotSimplexGeometry(bases).sample(f.location.geometricWeights,undefined,{retainLineage:true}),material=evaluateSnapshotSurfaceMaterial(f.graph,f.location,bases,normal.drawing,f.angle,undefined,{retainLineage:true}),prior={...f,bases,normal,material};
  const result=revise(prior,changeHandle(bases,'A','curve0',[0,.3]),changes('curve0'));
  expect(result.counts).toMatchObject({transportedTracks:9,reusedTracks:0,revisionSamples:0});expect(result.material.paintLayoutUnchanged).toBeUndefined();
 });
});
