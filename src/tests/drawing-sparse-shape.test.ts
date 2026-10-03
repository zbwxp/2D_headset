import {expect,test} from 'vitest';
import {emptyDrawing,nodeAt,shapeOf,sub,length,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {applyDrawingShapeValue} from '../domain/drawing/sparseShape';
import {identitySceneShape} from '../domain/recordingScene/model';

const near=(actual:Point2,expected:Point2)=>actual.forEach((n,i)=>expect(n).toBeCloseTo(expected[i],10));
function drawing():DrawingDocument {
 return {...emptyDrawing(),
  layers:[{id:'layer',name:'Ink',visible:true,locked:false,items:['a']}],
  nodes:[{id:'a0',position:[0,0]},{id:'a1',position:[1,0]}],
  curves:[{id:'a',name:'A',nodes:['a0','a1'],handles:[[.3,0],[.7,0]],visible:true,locked:false,width:.02}],
 };
}
function pair(linked=false):DrawingDocument {
 const d=drawing(),node=linked?'b0':'a1';
 d.nodes.push(...(linked?[{id:node,position:[1,0] as Point2}]:[]),{id:'b1',position:[2,0]});
 d.curves.push({id:'b',name:'B',nodes:[node,'b1'],handles:[[1.6,0],[1.8,0]],visible:true,locked:false,width:.02});
 if(linked){d.layers.push({id:'other',name:'Other',visible:true,locked:false,items:['b']});d.endpointLinks=[{id:'link',a:{curveId:'a',end:1},b:{curveId:'b',end:0}}];}
 else d.layers[0].items.push('b');
 return d;
}

test('canonical sparse controls carry endpoint handles and add node-relative handle offsets without mutating the input or rebuilding materials',()=>{
 const before=drawing();before.curves[0].visible=false;before.curves[0].locked=true;
 before.displayIntervals=[{id:'cut',anchor:{id:'a',reverse:false},ranges:[{id:'hide',start:.2,end:.4,mode:'HIDE'}]}];
 const value={nodes:{a0:[2,3] as Point2},handles:{a:[[.4,-.2],[0,0]] as [Point2,Point2]}},saved=structuredClone({before,value});
 const result=applyDrawingShapeValue(before,value);
 expect(result.changed).toBe(true);expect(result.issues).toEqual([]);expect(result.changedHandles).toEqual(new Set([JSON.stringify(['a',0])]));
 near(shapeOf(result.drawing,'a')[0],[2,3]);near(shapeOf(result.drawing,'a')[1],[2.7,2.8]);near(shapeOf(result.drawing,'a')[2],[.7,0]);
 expect(result.drawing.displayIntervals).toBe(before.displayIntervals);expect(result.drawing.joins).toBe(before.joins);expect(result.drawing.layers).toBe(before.layers);
 expect(result.drawing.curves[0]).toMatchObject({visible:false,locked:true,width:.02});expect({before,value}).toEqual(saved);
});

test('empty, zero and absent-target controls retain input identity while reporting absent canonical IDs',()=>{
 const before=drawing();
 for(const value of [identitySceneShape(),{nodes:{a0:[0,0] as Point2},handles:{a:[[0,0],[0,0]] as [Point2,Point2]}}]){
  const result=applyDrawingShapeValue(before,value);expect(result.drawing).toBe(before);expect(result.changed).toBe(false);expect(result.issues).toEqual([]);expect(result.changedHandles.size).toBe(0);
 }
 const value={nodes:{missing:[2,3] as Point2},handles:{lost:[[1,2],[3,4]] as [Point2,Point2]}},result=applyDrawingShapeValue(before,value);
 expect(result.drawing).toBe(before);expect(result.changed).toBe(false);expect(result.issues).toEqual([
  {targetId:'missing',message:'The shape node is missing; its offset is retained.'},
  {targetId:'lost',message:'The shape curve is missing; its handle offsets are retained.'},
 ]);expect(value.nodes.missing).toEqual([2,3]);
});

test('sparse canonical IDs include prototype-named IDs and never read inherited offsets',()=>{
 const before=drawing();before.nodes[0].id='__proto__';before.curves[0].id='constructor';before.curves[0].nodes[0]='__proto__';before.layers[0].items=['constructor'];
 const value=JSON.parse('{"nodes":{"__proto__":[1,2]},"handles":{"constructor":[[3,4],[0,0]]}}');
 const result=applyDrawingShapeValue(before,value);near(shapeOf(result.drawing,'constructor')[0],[1,2]);near(shapeOf(result.drawing,'constructor')[1],[4.3,6]);expect(result.issues).toEqual([]);
 const inherited={nodes:Object.create({'__proto__':[1,2]}),handles:Object.create({constructor:[[3,4],[0,0]]})};
 expect(applyDrawingShapeValue(before,inherited).drawing).toBe(before);
});

test('shared nodes and cross-layer LINK components require coherent offsets while independent controls still apply',()=>{
 for(const linked of [false,true]){
  const before=pair(linked),nodes:Record<string,Point2>=linked?{a1:[.2,.5],b0:[.2,.5]}:{a1:[.2,.5]},result=applyDrawingShapeValue(before,{nodes,handles:{}});
  for(const endpoint of [{curveId:'a',end:1 as const},{curveId:'b',end:0 as const}])near(nodeAt(result.drawing,endpoint).position,[1.2,.5]);
  near(result.drawing.curves[0].handles[1],[.9,.5]);near(result.drawing.curves[1].handles[0],[1.8,.5]);expect(result.issues).toEqual([]);expect(result.changedHandles.size).toBe(0);
 }
 const before=pair(true),result=applyDrawingShapeValue(before,{nodes:{a1:[.2,.5]},handles:{a:[[0,1],[0,0]]}});
 expect(result.changed).toBe(true);expect(result.issues).toEqual([{targetId:'a1',message:'Linked endpoint shape offsets conflict; this linked component keeps its Warp positions.'}]);
 expect(result.drawing.nodes).toEqual(before.nodes);near(result.drawing.curves[0].handles[0],[.3,1]);near(result.drawing.curves[1].handles[0],[1.6,0]);
 const conflictOnly=applyDrawingShapeValue(before,{nodes:{a1:[.2,.5]},handles:{}});expect(conflictOnly.drawing).toBe(before);expect(conflictOnly.changed).toBe(false);expect(conflictOnly.issues).toHaveLength(1);
});

test('LINK coherence uses the existing tolerance and stable canonical-node authority',()=>{
 const before=pair(true),value={nodes:{a1:[.2,.5] as Point2,b0:[.2+5e-9,.5] as Point2},handles:{}};
 const result=applyDrawingShapeValue(before,value);expect(result.issues).toEqual([]);
 expect(nodeAt(result.drawing,{curveId:'a',end:1}).position).toEqual(nodeAt(result.drawing,{curveId:'b',end:0}).position);
 expect(nodeAt(result.drawing,{curveId:'b',end:0}).position).toEqual([1.2,.5]);
});

test('Drawing joins and cross-layer SMOOTH links keep directed tangents and each corrected handle length',()=>{
 for(const linked of [false,true]){
  const before=pair(linked);
  if(linked)before.endpointLinks![0].joinBrush={kind:'SMOOTH'};
  else before.joins=[{id:'smooth',a:{curveId:'a',end:1},b:{curveId:'b',end:0},mode:'SMOOTH'}];
  const saved=structuredClone(before),result=applyDrawingShapeValue(before,{nodes:{},handles:{a:[[0,0],[.3,.4]],b:[[-.3,.8],[0,0]]}});
  const a=sub(result.drawing.curves[0].handles[1],nodeAt(result.drawing,{curveId:'a',end:1}).position),b=sub(result.drawing.curves[1].handles[0],nodeAt(result.drawing,{curveId:'b',end:0}).position);
  near(a,[0,.4]);near(b,[0,-Math.hypot(.3,.8)]);expect(a[0]*b[0]+a[1]*b[1]).toBeLessThan(0);expect(length(b)).toBeCloseTo(Math.hypot(.3,.8),10);
  expect(result.issues).toEqual([]);expect(before).toEqual(saved);
 }
});

test('a changed follower uses the existing stable SMOOTH driver and collapsed projections report without partial projection',()=>{
 const before=pair();before.joins=[{id:'smooth',a:{curveId:'a',end:1},b:{curveId:'b',end:0},mode:'SMOOTH'}];
 const follower=applyDrawingShapeValue(before,{nodes:{},handles:{b:[[-.6,.8],[0,0]]}});
 near(follower.drawing.curves[0].handles[1],[.7,0]);near(follower.drawing.curves[1].handles[0],[1.8,0]);expect(follower.issues).toEqual([]);
 const collapsed=applyDrawingShapeValue(before,{nodes:{},handles:{a:[[0,0],[1-.7,0]],b:[[0,.8],[0,0]]}});
 expect(collapsed.changed).toBe(true);expect(collapsed.issues).toEqual([{targetId:'a',message:'A SMOOTH handle cannot collapse to zero.'}]);
 near(collapsed.drawing.curves[0].handles[1],[1,0]);near(collapsed.drawing.curves[1].handles[0],[1.6,.8]);near(before.curves[1].handles[0],[1.6,0]);
});

test('contradictory SMOOTH component directions report once and retain the unapplied projection controls',()=>{
 const before=pair(true);
 before.nodes.push({id:'c0',position:[1,0]},{id:'c1',position:[1,1]});
 before.curves.push({id:'c',name:'C',nodes:['c0','c1'],handles:[[1,.3],[1,.7]],visible:true,locked:false,width:.02});
 before.layers.push({id:'third',name:'Third',visible:true,locked:false,items:['c']});
 before.endpointLinks=[
  {id:'01',a:{curveId:'a',end:1},b:{curveId:'b',end:0},joinBrush:{kind:'SMOOTH'}},
  {id:'02',a:{curveId:'b',end:0},b:{curveId:'c',end:0},joinBrush:{kind:'SMOOTH'}},
  {id:'03',a:{curveId:'c',end:0},b:{curveId:'a',end:1},joinBrush:{kind:'SMOOTH'}},
 ];
 const result=applyDrawingShapeValue(before,{nodes:{},handles:{a:[[0,0],[0,.4]]}});
 expect(result.issues).toEqual([{targetId:'a',message:'SMOOTH links request conflicting handle directions.'}]);
 near(result.drawing.curves[0].handles[1],[.7,.4]);expect(result.drawing.curves.slice(1)).toEqual(before.curves.slice(1));
});
