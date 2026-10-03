import {describe,expect,test,vi} from 'vitest';
import * as commands from '../domain/drawing/commands';
import {applyCurveSplitIntent,createCurveSplitIntent,mapCurveSplitIntent,splitCurveParameter,createLayerCurveSplitIntent,applyLayerEditIntent} from '../domain/drawing/layerEditIntent';
import {createDisplayRouteField,resolveDisplayRoute,splitDisplayRoute,splitRouteCoverage,type DisplayRoute,type RouteMaterialSpan} from '../domain/drawing/displayRoutes';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {evaluate} from '../domain/geometry/bezier';

const line:Cubic=[[0,0],[1/3,0],[2/3,0],[1,0]];
function fixture(shape:Cubic=[[0,0],[.1,.9],[.7,-.4],[1,0]]) {
 const drawing=commands.addLayer(emptyDrawing(),'Source');
 return commands.createCurve(drawing,drawing.layers[0].id,shape,.02,'Original curve','curve');
}
const allocator=()=>{let index=0;return ()=>`planned-${++index}`;};
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
const at=(shape:Cubic,t:number)=>evaluate(shape.map(([x,y])=>[x,y,0]),t).slice(0,2);
const close=(a:number[],b:number[],precision=11)=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],precision));
function scoped(drawing:DrawingDocument,reverse=false):DrawingDocument {
 return {...drawing,displayIntervals:[{id:'track',scope:'CURVE',anchor:{id:'curve',reverse},ranges:[
  {id:'show',mode:'SHOW',start:.1,end:.9,inkEnds:[{taper:.003},{taper:.009}]},
  {id:'hidden',mode:'HIDE',start:.12,end:.2,enabled:false},
 ]}]};
}

describe('explicit layer split identity plan',()=>{
 test.each([false,true])('enabled mirror split shares new child identities and maps reverse=%s material parameters',reverse=>{
  let drawing=fixture();const layer=drawing.layers[0].id,original=shapeOf(drawing,'curve'),mirror=original.map(([x,y])=>[-x,y]) as Cubic;
  drawing=commands.createCurve(drawing,layer,reverse?[...mirror].reverse() as Cubic:mirror,.02,'Other','other');drawing.mirrorEditing={enabled:true,curvePairs:[{id:'pair',a:'curve',b:'other',reverse}]};
  const intent=createLayerCurveSplitIntent(drawing,'curve',.3,{allocateId:allocator()});expect(intent.kind).toBe('split-curves');if(intent.kind!=='split-curves')throw Error('Expected batch');
  expect(intent.splits.map(value=>value.t)).toEqual([.3,reverse?.7:.3]);const result=applyLayerEditIntent(drawing,intent).document;
  expect(result.curves).toHaveLength(4);expect(result.mirrorEditing!.enabled).toBe(true);expect(result.mirrorEditing!.curvePairs).toHaveLength(2);
  for(const pair of result.mirrorEditing!.curvePairs){const a=shapeOf(result,pair.a),b=shapeOf(result,pair.b);for(let i=0;i<4;i++)close([-a[i][0],a[i][1]],b[pair.reverse?3-i:i]);}
  expect(parseDrawing(result)).toEqual(result);const off={...drawing,mirrorEditing:{...drawing.mirrorEditing,enabled:false}},single=createLayerCurveSplitIntent(off,'curve',.3,{allocateId:allocator()}),free=applyLayerEditIntent(off,single).document;expect(single.kind).toBe('split-curve');expect(shapeOf(free,'other')).toEqual(shapeOf(drawing,'other'));expect(free.mirrorEditing!.curvePairs).toEqual([]);
 });
 test('one serializable plan splits independently deformed frozen snapshots exactly without allocating on application',()=>{
  const source=scoped(fixture()),warp=([x,y]:Point2):Point2=>[1.3*x+.1,y+.7*x*x-.2];
  const pose={...source,nodes:source.nodes.map(node=>({...node,position:warp(node.position)})),curves:source.curves.map(curve=>({...curve,handles:curve.handles.map(warp) as [Point2,Point2]}))};
  const sourceJson=JSON.stringify(source),poseJson=JSON.stringify(pose),intent=freeze(createCurveSplitIntent(source,'curve',.37,{allocateId:allocator(),relatedDrawings:[pose]}));
  const random=vi.spyOn(crypto,'randomUUID').mockImplementation(()=>{throw Error('Application must not allocate');});
  try {
   const first=applyCurveSplitIntent(freeze(source),intent),second=applyCurveSplitIntent(freeze(pose),JSON.parse(JSON.stringify(intent)));
   expect(first.ids).toEqual(second.ids);expect(first.ids).not.toContain('curve');expect(first.provenance).toEqual(second.provenance);
   expect(first.provenance.children).toEqual([{curveId:intent.childCurveIds[0],sourceInterval:[0,.37]},{curveId:intent.childCurveIds[1],sourceInterval:[.37,1]}]);
   for(const [before,after] of [[source,first.document],[pose,second.document]] as const){
    expect(after.curves.some(curve=>curve.id==='curve')).toBe(false);
    expect(after.nodes.map(node=>node.id)).toEqual([...before.nodes.map(node=>node.id),intent.seamNodeId]);
    for(const t of [0,.07,.24,.37,.49,.81,1]){const point=splitCurveParameter(intent,t);close(at(shapeOf(after,point.curveId),point.t),at(shapeOf(before,'curve'),t));}
    expect(parseDrawing(JSON.parse(JSON.stringify(after)))).toEqual(after);
   }
   expect(first.document.displayIntervals?.map(track=>[track.id,track.ranges.map(range=>range.id)])).toEqual(second.document.displayIntervals?.map(track=>[track.id,track.ranges.map(range=>range.id)]));
   expect(first.document.nodes.find(node=>node.id===intent.seamNodeId)?.position).not.toEqual(second.document.nodes.find(node=>node.id===intent.seamNodeId)?.position);
  } finally {random.mockRestore();}
  expect(JSON.stringify(source)).toBe(sourceJson);expect(JSON.stringify(pose)).toBe(poseJson);
 });

 test('canonical mapping includes provenance, nodes and every allocated material identity',()=>{
  const drawing=scoped(fixture()),intent=createCurveSplitIntent(drawing,'curve',.4,{allocateId:allocator()}),mapped=mapCurveSplitIntent(intent,id=>`canonical:${id}`);
  expect(mapped.curveId).toBe('canonical:curve');expect(mapped.sourceLayerId).toBe(`canonical:${drawing.layers[0].id}`);
  expect(mapped.sourceNodeIds).toEqual(intent.sourceNodeIds.map(id=>`canonical:${id}`));expect(mapped.childCurveIds).toEqual(intent.childCurveIds.map(id=>`canonical:${id}`));
  expect(mapped.intervals[0]).toEqual({trackId:'canonical:track',rightTrackId:`canonical:${intent.intervals[0].rightTrackId}`,ranges:intent.intervals[0].ranges.map(range=>({rangeId:`canonical:${range.rangeId}`,rightRangeId:`canonical:${range.rightRangeId}`}))});
  expect(mapped.t).toBe(.4);expect(intent.curveId).toBe('curve');
 });

 test('plans include local material additions across snapshots and fail closed on unplanned ranges',()=>{
  const drawing=scoped(fixture()),related=scoped(fixture());
  related.displayIntervals![0].ranges.push({id:'local-range',mode:'HIDE',start:.3,end:.6});
  related.displayIntervals!.push({id:'local-track',scope:'CURVE',anchor:{id:'curve',reverse:true},ranges:[{id:'local-show',start:0,end:1}]});
  // Related snapshots share canonical controls, even if their layer slots differ.
  related.curves[0].nodes=[...drawing.curves[0].nodes];related.nodes=structuredClone(drawing.nodes);
  const plan=createCurveSplitIntent(drawing,'curve',.4,{allocateId:allocator(),relatedDrawings:[related]});
  const before=JSON.stringify(plan);expect(()=>applyCurveSplitIntent(related,plan)).not.toThrow();expect(JSON.stringify(plan)).toBe(before);
  const incomplete=createCurveSplitIntent(drawing,'curve',.4,{allocateId:allocator()});expect(()=>applyCurveSplitIntent(related,incomplete)).toThrow(/missing.*material identity/);
 });

 test('preserves source endpoint identities and remaps joins, links, reverse paint paths and groups without stale curve references',()=>{
  let drawing=fixture();const layer=drawing.layers[0].id;
  drawing=commands.createCurve(drawing,layer,[[-1,0],[-.6,-.4],[-.2,-.3],[0,0]],.02,'Neighbor','neighbor');
  drawing=commands.connect(drawing,{curveId:'neighbor',end:1},{curveId:'curve',end:0},'CUSP');
  drawing=commands.addLayer(drawing,'Linked');drawing=commands.createCurve(drawing,drawing.layers[0].id,[[1,0],[1.3,.2],[1.6,.1],[2,0]],.02,'Linked curve','linked');
  drawing=commands.linkEndpoints(drawing,{curveId:'curve',end:1},{curveId:'linked',end:0});
  drawing.groups=[{id:'group',name:'Group',visible:true,locked:false,curveIds:['neighbor','curve']}];
  drawing.fills=[{id:'fill',name:'Fill',visible:true,locked:false,color:'white',boundary:[{id:'curve',reverse:true},{id:'neighbor',reverse:true}]}];
  drawing.offsets=[{id:'offset',name:'Offset',visible:true,locked:false,source:[{id:'curve',reverse:true}],distance:.03,start:0,end:1,taper:0,width:.02}];
  drawing.layers.find(value=>value.id===layer)!.items.push('fill','offset');
  const oldNodes=[...drawing.curves.find(value=>value.id==='curve')!.nodes],join=drawing.joins[0],link=drawing.endpointLinks![0],intent=createCurveSplitIntent(drawing,'curve',.38,{allocateId:allocator()}),[left,right]=intent.childCurveIds,result=applyCurveSplitIntent(freeze(drawing),intent).document;
  expect(result.curves.find(curve=>curve.id===left)!.nodes).toEqual([oldNodes[0],intent.seamNodeId]);expect(result.curves.find(curve=>curve.id===right)!.nodes).toEqual([intent.seamNodeId,oldNodes[1]]);
  expect(result.joins.find(value=>value.id===join.id)!.b).toEqual({curveId:left,end:0});expect(result.endpointLinks!.find(value=>value.id===link.id)!.a).toEqual({curveId:right,end:1});
  expect(result.fills[0].boundary).toEqual([{id:right,reverse:true},{id:left,reverse:true},{id:'neighbor',reverse:true}]);expect(result.offsets[0].source).toEqual([{id:right,reverse:true},{id:left,reverse:true}]);
  expect(result.groups![0].curveIds.sort()).toEqual(['neighbor',left,right].sort());expect(result.layers.find(value=>value.id===layer)!.items).not.toContain('curve');
  expect(parseDrawing(result)).toEqual(result);
 });

 test('reverse curve-local SHOW/HIDE masks retain stable IDs, brush roles and empty channels',()=>{
  for(const reverse of [false,true]){
   const drawing=scoped(fixture(line),reverse);drawing.displayIntervals![0].ranges[1].enabled=true;
   const intent=createCurveSplitIntent(drawing,'curve',.4,{allocateId:allocator()}),result=applyCurveSplitIntent(drawing,intent).document;
   const before=displayField(drawing,displayPath(drawing,'curve')),after=displayField(result,displayPath(result,intent.childCurveIds[0]));
   expect(after.inkSpans!.length).toBe(before.inkSpans!.length);after.inkSpans!.forEach((span,index)=>{close([span.start,span.end],[before.inkSpans![index].start,before.inkSpans![index].end]);expect(span.ends).toEqual(before.inkSpans![index].ends);});
   expect(result.displayIntervals![0].id).toBe('track');expect(result.displayIntervals![0].ranges.map(range=>range.id)).toEqual(['show','hidden']);
   expect(result.displayIntervals![1].id).toBe(intent.intervals[0].rightTrackId);
   expect(result.displayIntervals![1].ranges.map(range=>range.originId)).toEqual(['show','hidden']);
   expect(result.displayIntervals!.flatMap(track=>track.ranges).some(range=>range.mode==='HIDE'&&range.start===range.end)).toBe(true);
   expect(parseDrawing(result)).toEqual(result);
  }
 });

 test('propagation preserves hidden and locked states but cannot bypass authoring guards without an explicit plan',()=>{
  const drawing=fixture(),intent=createCurveSplitIntent(drawing,'curve',.3,{allocateId:allocator()}),hidden={...drawing,curves:drawing.curves.map(curve=>({...curve,visible:false,locked:true}))};
  expect(()=>applyCurveSplitIntent(hidden,intent)).toThrow(/隐藏或锁定/);
  const result=applyCurveSplitIntent(freeze(hidden),intent,{propagate:true}).document;expect(result.curves.every(curve=>!curve.visible&&curve.locked)).toBe(true);
  expect(()=>commands.splitCurve(drawing,'curve',.3,{propagate:true})).toThrow(/explicit identity plan/);
 });

 test('rejects stale topology, collisions, malformed parameters and reuse atomically',()=>{
  const drawing=scoped(fixture()),intent=createCurveSplitIntent(drawing,'curve',.4,{allocateId:allocator()}),before=JSON.stringify(drawing);
  const stale={...drawing,curves:drawing.curves.map(curve=>({...curve,nodes:[...curve.nodes].reverse() as [string,string]}))};
  expect(()=>applyCurveSplitIntent(stale,intent)).toThrow(/topology/);
  expect(()=>applyCurveSplitIntent(drawing,{...intent,childCurveIds:['curve',intent.childCurveIds[1]]})).toThrow(/existing or duplicate/);
  expect(()=>applyCurveSplitIntent(drawing,{...intent,seamJoinId:intent.seamNodeId})).toThrow(/existing or duplicate/);
  expect(()=>createCurveSplitIntent(drawing,'curve',.4,{allocateId:()=>drawing.nodes[0].id})).toThrow(/allocator/);
  for(const t of [NaN,Infinity,-.1,0,1,1.1])expect(()=>createCurveSplitIntent(drawing,'curve',t)).toThrow(/parameter/);
  const after=applyCurveSplitIntent(drawing,intent).document;expect(()=>applyCurveSplitIntent(after,intent)).toThrow(/topology/);expect(JSON.stringify(drawing)).toBe(before);
 });
});

describe('explicit split display traversal and material provenance',()=>{
 test('reversed traversal and native material parameters map to both fresh child identities',()=>{
  const drawing=fixture(line),intent=createCurveSplitIntent(drawing,'curve',.4,{allocateId:allocator()}),[left,right]=intent.childCurveIds;
  const route:DisplayRoute={seed:{segments:[{id:'curve',reverse:true}],closed:false},throughLinkIds:[]},mapped=splitDisplayRoute(route,'curve',right,left);
  expect(mapped.seed.segments).toEqual([{id:right,reverse:true},{id:left,reverse:true}]);
  const ends:[{taper:number},{taper:number}]=[{taper:.03},{taper:.07}],spans:RouteMaterialSpan[]=[{from:{kind:'curve',curveId:'curve',t:.8},to:{kind:'curve',curveId:'curve',t:.1},ends,run:2,continuesBefore:false,continuesAfter:false}];
  const material=splitRouteCoverage(spans,'curve',right,.4,left);
  expect(material.map(span=>[span.from,span.to])).toEqual([[{kind:'curve',curveId:right,t:expect.closeTo(2/3,12)},{kind:'curve',curveId:right,t:0}],[{kind:'curve',curveId:left,t:1},{kind:'curve',curveId:left,t:.25}]]);
  expect(material[0].ends[0]).toEqual(ends[0]);expect(material[1].ends[1]).toEqual(ends[1]);expect(material[0].continuesAfter).toBe(true);expect(material[1].continuesBefore).toBe(true);
  expect(splitCurveParameter(intent,.4)).toEqual({curveId:left,t:1});expect(splitCurveParameter(intent,.4,1)).toEqual({curveId:right,t:0});
 });

 test('an existing cross-layer display route and its IDs survive replacing both source curve identities',()=>{
  let drawing=fixture(line);drawing=commands.addLayer(drawing,'Other');drawing=commands.createCurve(drawing,drawing.layers[0].id,line.map(([x,y])=>[x+1,y]) as Cubic,.02,'Other curve','other');
  drawing=commands.linkEndpoints(drawing,{curveId:'curve',end:1},{curveId:'other',end:0});drawing.endpointLinks![0].throughDisplay=true;
  const route:DisplayRoute={seed:{segments:[{id:'curve',reverse:true}],closed:false},throughLinkIds:[drawing.endpointLinks![0].id]};
  drawing.displayIntervals=[{id:'routed-track',anchor:{id:'curve',reverse:true},displayRoute:route,ranges:[{id:'routed-range',start:.2,end:.8}]}];
  const before=createDisplayRouteField(drawing,route),intent=createCurveSplitIntent(drawing,'curve',.4,{allocateId:allocator()}),result=applyCurveSplitIntent(freeze(drawing),intent).document,track=result.displayIntervals![0],after=createDisplayRouteField(result,track.displayRoute!);
  expect(track.id).toBe('routed-track');expect(track.ranges[0].id).toBe('routed-range');expect(track.anchor).toEqual({id:intent.childCurveIds[1],reverse:true});
  expect(resolveDisplayRoute(result,track.displayRoute!).diagnostics).toEqual([]);expect(track.displayRoute!.throughLinkIds).toEqual(route.throughLinkIds);
  close(before.at(.2).p,after.at(.2).p);close(before.at(.8).p,after.at(.8).p);expect(parseDrawing(result)).toEqual(result);
 });
});
