import {describe,test,expect} from 'vitest';
import {type DrawingDocument as Doc,type DrawingCurve,type Point2} from '../domain/drawing/model';
import {strokes,strokeFor,paintItems,strokeFillIds} from '../domain/drawing/strokes';
import {resolveDisplayRoute,createDisplayRouteField,type DisplayRoute} from '../domain/drawing/displayRoutes';
import {depthPaintBatches} from '../domain/drawing/depth';
import {prepareDrawingReadContext,preparedDrawingReadContext,retainPreparedDrawingReadContext,drawingReadContextStats,withDrawingReadScope} from '../domain/drawing/readContext';

const route:DisplayRoute={seed:{segments:['a0','a1','a2'].map(id=>({id,reverse:false})),closed:true},throughLinkIds:['ab']};
function fixture():Doc {
 const nodes=[['a0',[0,0]],['a1',[-1,0]],['a2',[-1,1]],['b0',[0,0]],['b1',[1,0]],['b2',[1,1]],['c0',[3,0]],['c1',[4,0]],['c2',[5,1]],['c3',[5,-1]]] as [string,Point2][];
 const curve=(id:string,a:string,b:string):DrawingCurve=>{
  const p=nodes.find(n=>n[0]===a)![1],q=nodes.find(n=>n[0]===b)![1];
  return {id,name:id,nodes:[a,b],handles:[[p[0]+(q[0]-p[0])/3,p[1]+(q[1]-p[1])/3],[p[0]+2*(q[0]-p[0])/3,p[1]+2*(q[1]-p[1])/3]],visible:true,locked:false,width:.01};
 };
 return {version:3,nodes:nodes.map(([id,position])=>({id:'n'+id,position})),
  curves:[curve('a0','a0','a1'),curve('a1','a1','a2'),curve('a2','a2','a0'),curve('b0','b0','b1'),curve('b1','b1','b2'),curve('b2','b2','b0'),curve('c0','c0','c1'),curve('c1','c1','c2'),curve('c2','c1','c3')].map(c=>({...c,nodes:c.nodes.map(n=>'n'+n) as [string,string]})),
  layers:[{id:'a',name:'A',visible:false,locked:true,items:['a0','fa','a1','oa','a2']},{id:'b',name:'B',visible:true,locked:false,items:['b0','b1','b2']},{id:'c',name:'C',visible:true,locked:false,items:['c0','c1','c2']}],
  joins:[{id:'aj',a:{curveId:'a2',end:1},b:{curveId:'a0',end:0},mode:'ARC',radius:.1},{id:'cj',a:{curveId:'c0',end:1},b:{curveId:'c1',end:0},mode:'CUSP'}],
  endpointLinks:[{id:'ab',a:{curveId:'a2',end:1},b:{curveId:'b0',end:0},throughDisplay:true,joinBrush:{kind:'SHARP'}}],
  fills:[{id:'fa',name:'Fill',visible:true,locked:false,color:'white',boundary:route.seed.segments.map(u=>({...u}))}],
  offsets:[{id:'oa',name:'Offset',visible:true,locked:false,source:[{id:'a0',reverse:false}],distance:.05,start:0,end:1,taper:0,width:.01}],
  groups:[{id:'ga',name:'Group',visible:true,locked:false,curveIds:['a0','a1','a2']}],
  displayIntervals:[{id:'ia',anchor:{id:'a0',reverse:false},ranges:[{id:'ra',start:.1,end:.8}],displayRoute:structuredClone(route)}],
 };
}
const localOutput=(d:Doc)=>d.layers.map(layer=>({strokes:strokes(d,layer.id),visible:strokes(d,layer.id,true),paint:paintItems(d,layer.id)}));

describe('explicit immutable Drawing read context',()=>{
 test('hundreds of repeated stroke and route queries compile each shared plan only once',()=>{
  const d=fixture(),oldLocal=localOutput(d),oldRoute=resolveDisplayRoute(d,route),before=drawingReadContextStats();
  const context=prepareDrawingReadContext(d);
  for(let i=0;i<400;i++){
   expect(strokeFor(d,'a1').segments).toEqual(oldLocal[0].strokes[0].segments);
   expect(resolveDisplayRoute(d,route)).toEqual(oldRoute);
  }
  expect(localOutput(d)).toEqual(oldLocal);
  const after=drawingReadContextStats();
  expect(after.contexts-before.contexts).toBe(1);expect(after.topologyKeys-before.topologyKeys).toBe(1);expect(after.topologyPlans-before.topologyPlans).toBe(1);
  expect(after.strokeKeys-before.strokeKeys).toBe(0);expect(after.preparedStrokeMisses-before.preparedStrokeMisses).toBe(d.layers.length*2);
  expect(after.strokeBuilds-before.strokeBuilds).toBe(d.layers.length*2);expect(after.localConnectionBuilds-before.localConnectionBuilds).toBe(1);
  expect(prepareDrawingReadContext(d)).toBe(context);expect(drawingReadContextStats()).toEqual(after);
 });
 test('fresh numeric/material indexes retain ID-only topology through geometry and paint changes',()=>{
  const d=fixture(),source=prepareDrawingReadContext(d);localOutput(d);resolveDisplayRoute(d,route);
  const next:Doc={...d,nodes:d.nodes.map(n=>({...n,position:[n.position[0]+.5,n.position[1]*2]})),curves:d.curves.map(c=>({...c,handles:c.handles.map(p=>[p[0]+.5,p[1]*2]) as [Point2,Point2],visible:c.id!=='a1',inkVisible:c.id!=='b0',depthOffset:7,depthScope:'LAYER',localPaintOrder:true})),endpointLinks:d.endpointLinks!.map(l=>({...l,joinBrush:{kind:'ARC',trimDistance:.04}}))};
  expect(preparedDrawingReadContext(next)).toBeUndefined();
  const oldLocal=localOutput(next),oldRoute=resolveDisplayRoute(next,route),json=JSON.stringify(next),before=drawingReadContextStats();
  const current=retainPreparedDrawingReadContext(next,d)!;
  expect(current.topology).toBe(source.topology);expect(current.curves.get('a0')).toBe(next.curves[0]);expect(current.nodes.get('na0')).toBe(next.nodes[0]);expect(current.endpointLinks.get('ab')).toBe(next.endpointLinks![0]);
  expect(current.curves.get('a0')).not.toBe(source.curves.get('a0'));expect(current.nodes.get('na0')).not.toBe(source.nodes.get('na0'));
  expect(localOutput(next)).toEqual(oldLocal);expect(resolveDisplayRoute(next,route)).toEqual(oldRoute);
  expect(strokes(next,'a',true).flatMap(s=>s.segments.map(u=>u.id))).not.toContain('a1');expect(strokes(next,'a').flatMap(s=>s.segments.map(u=>u.id))).toContain('a1');
  const after=drawingReadContextStats();expect(after.topologyRetains-before.topologyRetains).toBe(1);expect(after.localConnectionBuilds-before.localConnectionBuilds).toBe(0);expect(after.preparedStrokeMisses-before.preparedStrokeMisses).toBe(d.layers.length);
  expect(JSON.stringify(next)).toBe(json);
 });
 test('retained topology never caches resolved endpoints or caller route references',()=>{
  const d=fixture();prepareDrawingReadContext(d);expect(resolveDisplayRoute(d,route).diagnostics).toEqual([]);
  const next:Doc={...d,nodes:d.nodes.map(n=>n.id==='nb0'?{...n,position:[.2,.1]}:n)};
  retainPreparedDrawingReadContext(next,d);
  expect(resolveDisplayRoute(next,route).diagnostics.map(d=>d.code)).toEqual(['SEPARATED_LINK']);
  expect(resolveDisplayRoute(next,route,{deferEndpointPositions:true}).diagnostics).toEqual([]);
  expect(resolveDisplayRoute(next,{...route,seed:{...route.seed,segments:[{id:'missing',reverse:false}]}}).diagnostics[0].code).toBe('INVALID_SEED');
  expect(resolveDisplayRoute(d,route).diagnostics).toEqual([]);
 });
 test.each([
  ['curve node membership',(d:Doc)=>{d.curves[1].nodes[0]='nc0';}],
  ['layer membership',(d:Doc)=>{d.layers[0].items.splice(2,1);d.layers[1].items.push('a1');}],
  ['layer order',(d:Doc)=>{d.layers.reverse();}],
  ['item order',(d:Doc)=>{d.layers[0].items.reverse();}],
  ['join relation',(d:Doc)=>{d.joins[1].b={curveId:'c2',end:0};}],
  ['link relation',(d:Doc)=>{d.endpointLinks![0].b={curveId:'b2',end:1};}],
  ['link enabled',(d:Doc)=>{d.endpointLinks![0].throughDisplay=false;}],
  ['fill source',(d:Doc)=>{d.fills[0].boundary[0].reverse=true;}],
  ['offset source',(d:Doc)=>{d.offsets[0].source[0].id='a1';}],
  ['group membership',(d:Doc)=>{d.groups![0].curveIds.pop();}],
 ] as const)('%s changes cannot inherit an old structural plan',(_name,change)=>{
  const d=fixture(),source=prepareDrawingReadContext(d);localOutput(d);resolveDisplayRoute(d,route);
  const next=structuredClone(d);change(next);const expected=localOutput(next),resolved=resolveDisplayRoute(next,route);
  const current=retainPreparedDrawingReadContext(next,d)!;expect(current.topology).not.toBe(source.topology);expect(localOutput(next)).toEqual(expected);expect(resolveDisplayRoute(next,route)).toEqual(resolved);
 });
 test('interval wrappers keep their own current collection while sharing only local topology',()=>{
  const d=fixture(),source=prepareDrawingReadContext(d),wrapper:Doc={...d,displayIntervals:[]};
  const current=retainPreparedDrawingReadContext(wrapper,d)!;expect(current.topology).toBe(source.topology);expect(wrapper.displayIntervals).toEqual([]);expect(d.displayIntervals).toHaveLength(1);
  expect(resolveDisplayRoute(wrapper,{...route,throughLinkIds:[]}).path).toEqual(route.seed);
  expect(resolveDisplayRoute(d,route).path.segments).toHaveLength(6);
 });
 test('preparation leaves paint order, depth, hidden members, fills and route geometry exactly unchanged',()=>{
  const d=fixture();d.curves[0].depthOffset=-3;d.curves[1].inkVisible=false;d.curves[3].visible=false;
  const before=JSON.stringify(d),paints=depthPaintBatches(d),fills=strokeFillIds(d,strokeFor(d,'a0')),field=createDisplayRouteField(d,route);
  prepareDrawingReadContext(d);
  const next=createDisplayRouteField(d,route);expect(next.path).toEqual(field.path);expect(next.geometry).toEqual(field.geometry);expect(next.total).toBe(field.total);expect(next.diagnostics).toEqual(field.diagnostics);
  expect(depthPaintBatches(d)).toEqual(paints);expect(strokeFillIds(d,strokeFor(d,'a0'))).toEqual(fills);expect(JSON.stringify(d)).toBe(before);
 });
});

describe('mutable Drawing defaults remain guarded by content',()=>{
 test('in-place node, ownership, visibility and link edits are observed without preparation',()=>{
  const d=fixture();expect(strokeFor(d,'a0').segments).toHaveLength(3);expect(resolveDisplayRoute(d,route).diagnostics).toEqual([]);
  d.curves[1].visible=false;expect(strokes(d,'a',true).flatMap(s=>s.segments.map(u=>u.id))).not.toContain('a1');
  d.curves[1].nodes[0]='nc0';expect(resolveDisplayRoute(d,route).diagnostics[0].code).toBe('INVALID_SEED');
  d.curves[1].nodes[0]='na1';d.layers[0].items=d.layers[0].items.filter(id=>id!=='a1');d.layers[1].items.push('a1');expect(strokeFor(d,'a1').segments).toEqual([{id:'a1',reverse:false}]);
  d.endpointLinks![0].throughDisplay=false;expect(resolveDisplayRoute(d,route).diagnostics[0].code).toBe('DISABLED_LINK');
  expect(preparedDrawingReadContext(d)).toBeUndefined();expect(retainPreparedDrawingReadContext({...d},d)).toBeUndefined();
 });
});

describe('synchronous evaluation read scope',()=>{
 test('new numerical samples reuse a bounded value-guarded topology plan',()=>{
  const d=fixture();withDrawingReadScope(()=>resolveDisplayRoute(d,route));
  const before=drawingReadContextStats(),next:Doc={...d,nodes:d.nodes.map(n=>({...n,position:[n.position[0]+.4,n.position[1]-.2]})),curves:d.curves.map(c=>({...c,handles:c.handles.map(p=>[p[0]+.4,p[1]-.2]) as [Point2,Point2]}))};
  withDrawingReadScope(()=>expect(resolveDisplayRoute(next,route).diagnostics).toEqual([]));
  const after=drawingReadContextStats();
  expect(after.contexts-before.contexts).toBe(1);expect(after.topologyKeys-before.topologyKeys).toBe(1);
  expect(after.topologyPlans-before.topologyPlans).toBe(0);expect(after.strokeBuilds-before.strokeBuilds).toBe(0);
  expect(after.localConnectionBuilds-before.localConnectionBuilds).toBe(0);
  expect(preparedDrawingReadContext(next)).toBeUndefined();
 });
 test('shares nested readers, disposes after throw, and sees later mutable edits',()=>{
  const d=fixture(),expected=resolveDisplayRoute(d,route),before=drawingReadContextStats();
  expect(()=>withDrawingReadScope(()=>{
   for(let i=0;i<100;i++)withDrawingReadScope(()=>expect(resolveDisplayRoute(d,route)).toEqual(expected));
   expect(drawingReadContextStats().contexts-before.contexts).toBe(1);
   throw Error('stop');
  })).toThrow('stop');
  expect(preparedDrawingReadContext(d)).toBeUndefined();
  d.curves[1].nodes[0]='nc0';
  expect(withDrawingReadScope(()=>resolveDisplayRoute(d,route)).diagnostics[0].code).toBe('INVALID_SEED');
  expect(preparedDrawingReadContext(d)).toBeUndefined();
 });
 test('replacement arrays invalidate current geometry, membership and visible strokes',()=>{
  const d=fixture();
  withDrawingReadScope(()=>{
   expect(resolveDisplayRoute(d,route).diagnostics).toEqual([]);
   expect(strokes(d,'a',true).flatMap(s=>s.segments.map(u=>u.id))).toContain('a1');
   d.nodes=d.nodes.map(n=>n.id==='nb0'?{...n,position:[.2,.1]}:n);
   expect(resolveDisplayRoute(d,route).diagnostics[0].code).toBe('SEPARATED_LINK');
   d.curves=d.curves.map(c=>c.id==='a1'?{...c,visible:false}:c);
   expect(strokes(d,'a',true).flatMap(s=>s.segments.map(u=>u.id))).not.toContain('a1');
   d.layers=d.layers.map(l=>l.id==='a'?{...l,items:l.items.filter(id=>id!=='a1')}:l.id==='b'?{...l,items:[...l.items,'a1']}:l);
   expect(strokeFor(d,'a1').segments).toEqual([{id:'a1',reverse:false}]);
  });
 });
});
