import {expect,test} from 'vitest';
import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {applyDrawingShapeValue,drawingShapeRevision,drawingShapeWorkStats,resetDrawingShapeWorkStats,type DrawingShapeControl} from '../domain/drawing/sparseShape';
import type {SceneShapeValue} from '../domain/recordingScene/model';
function fixture(nuisance=0):DrawingDocument {
 const d:DrawingDocument={...emptyDrawing(),nodes:[{id:'a0',position:[0,0]},{id:'a1',position:[1,0]},{id:'b0',position:[1,0]},{id:'b1',position:[2,0]}],curves:[
  {id:'a',name:'A',nodes:['a0','a1'],handles:[[.3,0],[.7,0]],width:.02,visible:true,locked:false},
  {id:'b',name:'B',nodes:['b0','b1'],handles:[[1.3,0],[1.7,0]],width:.02,visible:true,locked:false},
 ],layers:[{id:'a-layer',name:'A',items:['a'],visible:true,locked:false},{id:'b-layer',name:'B',items:['b'],visible:true,locked:false}],endpointLinks:[{id:'link',a:{curveId:'a',end:1},b:{curveId:'b',end:0},joinBrush:{kind:'SMOOTH'}}]};
 for(let i=0;i<nuisance;i++){
  const id=`n${i}`,n0=`${id}:0`,n1=`${id}:1`;d.nodes.push({id:n0,position:[i,4]},{id:n1,position:[i+1,4]});d.curves.push({id,name:id,nodes:[n0,n1],handles:[[i+.3,4],[i+.7,4]],width:.02,visible:false,locked:true});d.layers.push({id:`${id}:layer`,name:id,items:[id],visible:true,locked:false});
 }
 return d;
}
const changes=(controls:DrawingShapeControl[])=>({structureUnchanged:true as const,controls});
const value=(nodes:SceneShapeValue['nodes']={},handles:SceneShapeValue['handles']={}):SceneShapeValue=>({nodes,handles});
const aHandle:DrawingShapeControl={kind:'handle',curveId:'a',end:1},bHandle:DrawingShapeControl={kind:'handle',curveId:'b',end:0};

test.each([0,100,1000])('retained LINK/SMOOTH revisions equal cold and numerical work is independent of %i nuisance curves',count=>{
 const before=fixture(count),saved=structuredClone(before),initial=value({}, {a:[[0,0],[.1,.2]]}),prior=applyDrawingShapeValue(before,initial,{retainRevision:true});
 const next=value({}, {a:[[0,0],[.1,.2]],b:[[.1,.4],[0,0]]});resetDrawingShapeWorkStats();
 const revised=applyDrawingShapeValue(before,next,{retainRevision:true,previous:prior,changes:changes([bHandle])}),stats=drawingShapeWorkStats();
 expect(stats).toMatchObject({plans:0,fullApplications:0,revisionApplications:1,nodeComponents:0,nodeControls:0,handleControls:1,projectedComponents:1});expect(stats.copiedControlSlots).toBe(before.nodes.length+2*before.curves.length);
 expect(revised).toEqual(applyDrawingShapeValue(before,next));expect(drawingShapeRevision(revised)?.dirtyCurveIds).toEqual(['b']);
 for(let i=2;i<before.curves.length;i++)expect(revised.drawing.curves[i]).toBe(prior.drawing.curves[i]);
 expect(revised.drawing.nodes[0]).toBe(prior.drawing.nodes[0]);expect(revised.drawing.layers).toBe(before.layers);expect(before).toEqual(saved);
});

test('revision additions, deletions, LINK conflicts and cumulative SMOOTH handle policy match the cold kernel',()=>{
 const before=fixture(),values=[value(),value({}, {a:[[0,0],[.15,.2]]}),value({}, {a:[[0,0],[.15,.2]],b:[[.1,.4],[0,0]]}),value({a1:[.2,.5]}, {a:[[0,0],[.15,.2]],b:[[.1,.4],[0,0]]}),value({a1:[.2,.5],b0:[.2,.5]}, {a:[[0,0],[.15,.2]],b:[[.1,.4],[0,0]]}),value({a1:[.2,.5],b0:[.2,.5]}, {b:[[.1,.4],[0,0]]}),value(),value({}, {a:[[0,0],[.3,0]],b:[[0,.5],[0,0]]}),value()];
 const all=changes([aHandle,bHandle,{kind:'node',nodeId:'a1'},{kind:'node',nodeId:'b0'}]);let previous=applyDrawingShapeValue(before,values[0],{retainRevision:true});
 for(const shape of values.slice(1)){const next=applyDrawingShapeValue(before,shape,{retainRevision:true,previous,changes:all});expect(next).toEqual(applyDrawingShapeValue(before,shape));expect(drawingShapeRevision(next)?.previous).toBe(previous);previous=next;}
});

test('SMOOTH collapse and contradictory components keep the complete raw product and exact ordered diagnostics',()=>{
 const before=fixture();before.nodes.push({id:'c0',position:[1,0]},{id:'c1',position:[1,1]});before.curves.push({id:'c',name:'C',nodes:['c0','c1'],handles:[[1,.3],[1,.7]],width:.02,visible:true,locked:false});before.layers.push({id:'c-layer',name:'C',items:['c'],visible:true,locked:false});
 before.endpointLinks!.push({id:'bc',a:{curveId:'b',end:0},b:{curveId:'c',end:0},joinBrush:{kind:'SMOOTH'}},{id:'ca',a:{curveId:'c',end:0},b:{curveId:'a',end:1},joinBrush:{kind:'SMOOTH'}});
 const first=value({}, {a:[[0,0],[.3,.2]]}),prior=applyDrawingShapeValue(before,first,{retainRevision:true}),next=value({}, {a:[[0,0],[.3,.5]]});
 const revised=applyDrawingShapeValue(before,next,{retainRevision:true,previous:prior,changes:changes([aHandle])});expect(revised).toEqual(applyDrawingShapeValue(before,next));expect(revised.issues).toEqual([{targetId:'b',message:'SMOOTH links request conflicting handle directions.'}]);
});

test('exact source and retained ownership guard revisions; replacing topology or mutable/unknown products uses cold work',()=>{
 const before=fixture(),first=value({}, {a:[[0,0],[.1,.2]]}),next=value({}, {a:[[0,0],[.2,.3]]}),retained=applyDrawingShapeValue(before,first,{retainRevision:true}),mutable=applyDrawingShapeValue(before,first);
 for(const [source,previous] of [[structuredClone(before),retained],[before,mutable]] as const){resetDrawingShapeWorkStats();const result=applyDrawingShapeValue(source,next,{previous,changes:changes([aHandle])});expect(drawingShapeRevision(result)).toBeUndefined();expect(drawingShapeWorkStats().fullApplications).toBe(1);expect(result).toEqual(applyDrawingShapeValue(source,next));}
 before.endpointLinks=[];resetDrawingShapeWorkStats();const result=applyDrawingShapeValue(before,next,{previous:retained,changes:changes([aHandle])});expect(drawingShapeRevision(result)).toBeUndefined();expect(result).toEqual(applyDrawingShapeValue(before,next));
});

test('unchanged values preserve output objects and produce an empty opaque dirty proof',()=>{
 const before=fixture(10),first=value({}, {a:[[0,0],[.1,.2]]}),previous=applyDrawingShapeValue(before,first,{retainRevision:true}),result=applyDrawingShapeValue(before,first,{previous,changes:changes([aHandle])});
 expect(drawingShapeRevision(result)?.dirtyCurveIds).toEqual([]);result.drawing.curves.forEach((curve,index)=>expect(curve).toBe(previous.drawing.curves[index]));
});
