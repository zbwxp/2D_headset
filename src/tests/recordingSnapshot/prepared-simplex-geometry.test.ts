import {describe,it,expect,vi} from 'vitest';
import {emptyDrawing,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {dominantSnapshotBasis} from '../../domain/recordingSnapshot/simplexSupport';
import {applyEndpointPairSmoothConstraints,endpointPairNodeAuthorities} from '../../domain/recordingSnapshot/endpointPair';
import {interpolateSnapshotSimplexGeometry,prepareSnapshotSimplexGeometry,type SnapshotScalarResponse,type SnapshotScalarTarget,type SnapshotScalarValue,type SnapshotSimplexBasis,type SnapshotSimplexGeometry} from '../../domain/recordingSnapshot/simplexGeometry';

// Frozen pre-extraction oracle: compare the prepared path against the original
// per-angle implementation, including diagnostics and response call ordering.
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const keys=<T extends {id:string}>(items:readonly T[])=>new Map(items.map(item=>[item.id,item]));

/** Final-control geometry for one real vertex, one shared edge or one triangle.
 * The caller supplies only geometrically active vertices. No nearest-member
 * fill, hidden-line filtering, ink construction or material parsing occurs here.
 * This is deliberately independent of the recorder's response storage. */
function legacyGeometry(bases:readonly SnapshotSimplexBasis[],geometricWeights:readonly number[],response?:SnapshotScalarResponse):SnapshotSimplexGeometry {
 if(bases.length<1||bases.length>3||bases.length!==geometricWeights.length||new Set(bases.map(b=>b.snapshotId)).size!==bases.length)throw Error('A snapshot simplex needs one to three distinct active bases.');
 if(geometricWeights.some(w=>!Number.isFinite(w)||w<=0)||Math.abs(geometricWeights.reduce((a,b)=>a+b,0)-1)>1e-12)throw Error('Active geometric weights must be positive and sum to one.');
 if(bases.length===1)return {drawing:bases[0].drawing,diagnostics:[],nodeAuthorities:endpointPairNodeAuthorities(bases[0].drawing)};
 const diagnostics:string[]=[],dominant=dominantSnapshotBasis(bases,geometricWeights);
 const selected=bases[dominant].drawing,curveMaps=bases.map(b=>keys(b.drawing.curves)),nodeMaps=bases.map(b=>keys(b.drawing.nodes));
 const curves=selected.curves.filter(curve=>{
  if(!curveMaps.every(map=>map.has(curve.id)))return false;
  if(!curveMaps.every(map=>same(map.get(curve.id)!.nodes,curve.nodes))){diagnostics.push(`Curve ${curve.id} has incompatible canonical endpoint topology in the active snapshots and is inactive.`);return false;}
  if(!curve.nodes.every(id=>nodeMaps.every(map=>map.has(id)))){diagnostics.push(`Curve ${curve.id} is missing an endpoint dependency and is inactive.`);return false;}
  return true;
 });
 const curveIds=new Set(curves.map(c=>c.id)),nodeIds=new Set(curves.flatMap(c=>c.nodes));
 const shared=<T extends {id:string}>(name:string,collections:readonly (readonly T[])[],shape:(item:T)=>unknown,valid:(item:T)=>boolean):T[]=>{
  const maps=collections.map(keys);return collections[dominant].filter(item=>{
   if(!valid(item))return false;
   if(maps.some(map=>!map.has(item.id)||!same(shape(map.get(item.id)!),shape(item)))){diagnostics.push(`${name} ${item.id} is not shared with compatible references by every active snapshot and is inactive.`);return false;}
   return true;
  });
 };
 const endpointsPresent=(item:{a:{curveId:string};b:{curveId:string}})=>curveIds.has(item.a.curveId)&&curveIds.has(item.b.curveId);
 const joins=shared('Join',bases.map(b=>b.drawing.joins),j=>[j.a,j.b,j.mode],endpointsPresent);
 const endpointLinks=shared('EndpointLink',bases.map(b=>b.drawing.endpointLinks??[]),l=>[l.a,l.b,l.throughDisplay,l.joinBrush?.kind],endpointsPresent).filter(link=>{
  const coherent=bases.every((_,index)=>{const a=curveMaps[index].get(link.a.curveId)!,b=curveMaps[index].get(link.b.curveId)!,p=nodeMaps[index].get(a.nodes[link.a.end])!.position,q=nodeMaps[index].get(b.nodes[link.b.end])!.position;return Math.hypot(p[0]-q[0],p[1]-q[1])<=64*Number.EPSILON*Math.max(1,...p.map(Math.abs),...q.map(Math.abs));});
  if(!coherent)diagnostics.push(`EndpointLink ${link.id} has different endpoint positions in an active basis and is inactive; its curves are not silently snapped.`);return coherent;
 });
 const fills=shared('Fill',bases.map(b=>b.drawing.fills),f=>f.boundary,f=>f.boundary.every(u=>curveIds.has(u.id)));
 const offsets=shared('Offset',bases.map(b=>b.drawing.offsets),o=>o.source,o=>o.source.every(u=>curveIds.has(u.id)));
 const present=new Set([...curveIds,...fills.map(f=>f.id),...offsets.map(o=>o.id)]),drawing:DrawingDocument={...emptyDrawing(),...selected,curves,nodes:selected.nodes.filter(n=>nodeIds.has(n.id)),fills,offsets,joins,endpointLinks,
  layers:selected.layers.map(layer=>({...layer,items:layer.items.filter(id=>present.has(id))})),
  groups:selected.groups?.map(group=>({...group,curveIds:group.curveIds.filter(id=>curveIds.has(id))})).filter(group=>group.curveIds.length),
  displayIntervals:[],mirrorEditing:undefined};
 const linkIds=new Set(endpointLinks.map(link=>link.id));
 drawing.displayIntervals=shared('Display interval',bases.map(b=>b.drawing.displayIntervals??[]),t=>[t.anchor,t.scope,t.displayRoute,t.ranges.map(r=>r.id)],t=>curveIds.has(t.anchor.id)&&(!t.displayRoute||t.displayRoute.seed.segments.every(u=>curveIds.has(u.id))&&t.displayRoute.throughLinkIds.every(id=>linkIds.has(id))));
 const authorities=endpointPairNodeAuthorities(drawing);
 const sample=(target:SnapshotScalarTarget,axis:0|1,coordinates:number[]):number=>{
  const sampled=response?.(target,axis,coordinates,geometricWeights)??geometricWeights;
  if(typeof sampled==='number'){if(!Number.isFinite(sampled))throw Error('A simplex response produced a non-finite coordinate.');return sampled;}
  const weights=sampled;
  if(weights.length!==bases.length||weights.some(w=>!Number.isFinite(w))||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('A scalar response must return finite sum-one weights for its active bases.');
  const result=coordinates.reduce((sum,p,index)=>sum+p*weights[index],0);if(!Number.isFinite(result))throw Error('A simplex response produced a non-finite coordinate.');return result;
 };
 const positions=new Map<string,Point2>();
 for(const node of drawing.nodes){const authority=authorities.get(node.id)!;let position=positions.get(authority);if(!position){position=([0,1] as const).map(axis=>sample({kind:'node',nodeId:authority},axis,nodeMaps.map(map=>map.get(authority)!.position[axis]))) as Point2;positions.set(authority,position);}positions.set(node.id,position);}
 drawing.nodes=drawing.nodes.map(node=>({...node,position:positions.get(node.id)!}));
 drawing.curves=drawing.curves.map(curve=>({...curve,handles:([0,1] as const).map(end=>{
  const node=positions.get(curve.nodes[end])!;return ([0,1] as const).map(axis=>node[axis]+sample({kind:'handle',curveId:curve.id,end},axis,curveMaps.map((map,index)=>map.get(curve.id)!.handles[end][axis]-nodeMaps[index].get(curve.nodes[end])!.position[axis]))) as Point2;
 }) as [Point2,Point2]}));
 // Brush/offset numeric parameters retain the ordinary geometric interpolation
 // policy; a control's response does not remap appearance switching or material.
 const scalar=(values:number[])=>values.reduce((sum,value,index)=>sum+value*geometricWeights[index],0);
 drawing.joins=drawing.joins.map(join=>join.mode==='ARC'?{...join,radius:scalar(bases.map(b=>b.drawing.joins.find(j=>j.id===join.id)!.radius!))}:join);
 drawing.endpointLinks=drawing.endpointLinks?.map(link=>link.joinBrush?.kind==='ARC'?{...link,joinBrush:{...link.joinBrush,trimDistance:scalar(bases.map(b=>{const brush=b.drawing.endpointLinks!.find(l=>l.id===link.id)!.joinBrush!;return brush.kind==='ARC'?brush.trimDistance:0;}))}}:link);
 drawing.offsets=drawing.offsets.map(offset=>{const sources=bases.map(b=>b.drawing.offsets.find(o=>o.id===offset.id)!);return sources.some(o=>o.translation)?{...offset,translation:([0,1] as const).map(axis=>scalar(sources.map(o=>o.translation?.[axis]??0))) as Point2}:offset;});
 const smooth=response&&'projectSmooth' in response&&response.projectSmooth?response.projectSmooth(drawing):applyEndpointPairSmoothConstraints(drawing);diagnostics.push(...smooth.diagnostics);
 return {drawing:smooth.drawing,diagnostics:[...new Set(diagnostics)],nodeAuthorities:authorities};
}

function basis(index:number):SnapshotSimplexBasis {
 const x=index*2,y=index*.6,point=(a:number,b:number):Point2=>[x+a*(index+1),y+b];
 const drawing:DrawingDocument={...emptyDrawing(),
  nodes:[{id:'a0',position:point(0,0)},{id:'a1',position:point(1,.5)},{id:'b0',position:point(1,.5)},{id:'b1',position:point(2,1)},{id:'c0',position:point(2,1)},{id:'shared',position:point(3,1)},{id:'d1',position:point(4,0)}],
  curves:[
   {id:'a',name:`A ${index}`,nodes:['a0','a1'],handles:[point(.2,.4),point(.7,.7)],visible:index!==0,locked:index===2,width:.01+index*.02,depthOffset:index,depthScope:index===1?'PARENT':'LAYER',localPaintOrder:index===2},
   {id:'b',name:`B ${index}`,nodes:['b0','b1'],handles:[point(1.4,.2),point(1.8,.8)],visible:true,locked:false,width:.02,inkVisible:index!==1},
   {id:'c',name:`C ${index}`,nodes:['c0','shared'],handles:[point(2.2,1.5),point(2.8,1.1)],visible:true,locked:false,width:.03},
   {id:'d',name:`D ${index}`,nodes:['shared','d1'],handles:[point(3.2,.8),point(3.8,.1)],visible:true,locked:false,width:.04}],
  endpointLinks:[{id:'smooth',a:{curveId:'a',end:1},b:{curveId:'b',end:0},throughDisplay:true,joinBrush:{kind:'SMOOTH'}},{id:'arcLink',a:{curveId:'b',end:1},b:{curveId:'c',end:0},joinBrush:{kind:'ARC',trimDistance:.2+index*.1}}],
  joins:[{id:'arcJoin',a:{curveId:'c',end:1},b:{curveId:'d',end:0},mode:'ARC',radius:.1+index*.2}],
  fills:[{id:'fill',name:`Fill ${index}`,visible:true,locked:false,color:index===1?'white':'black',boundary:[{id:'a',reverse:false},{id:'b',reverse:false}]}],
  offsets:[{id:'offset',name:`Offset ${index}`,visible:true,locked:false,source:[{id:'c',reverse:false}],distance:index+.2,start:0,end:1,taper:.1,width:.05,...(index?{translation:point(.1,.2)}:{})}],
  displayIntervals:[{id:'interval',anchor:{id:'a',reverse:false},scope:'CURVE',ranges:[{id:'range',start:.1*index,end:.8,enabled:index!==2}]}],
  layers:[{id:'layer',name:`Layer ${index}`,visible:true,locked:false,items:['a','b','fill','c','offset','d']}],
  groups:[{id:'group',name:`Group ${index}`,visible:true,locked:false,curveIds:['a','b','c','d']}],mirrorAxisX:index};
 if(index===0){drawing.nodes.push({id:'extra0',position:[7,7]},{id:'extra1',position:[8,8]});drawing.curves.push({id:'extra',name:'Only one basis',nodes:['extra0','extra1'],handles:[[7.2,7.2],[7.8,7.8]],visible:true,locked:false,width:.01});drawing.layers[0].items.push('extra');drawing.groups![0].curveIds.push('extra');}
 if(index===1){drawing.nodes.reverse();drawing.curves.reverse();drawing.layers[0].items.reverse();drawing.groups![0].curveIds.reverse();}
 return {snapshotId:`basis${index}`,angle:{x:90-index*45,y:index===1?-10:0},drawing};
}
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const signed:SnapshotScalarResponse=(_target,_axis,coordinates)=>coordinates.length===2?[-.25,1.25]:[-1,1,1];
const value:SnapshotScalarValue=(target,axis,coordinates,weights)=>coordinates.reduce((sum,p,index)=>sum+p*weights[index],0)+(target.kind==='node'?.1:-.2)*(axis?1:-1);

describe('prepared snapshot simplex geometry',()=>{
 it.each([2,3])('matches the original %i-basis evaluator across dominant metadata/order switches and responses',count=>{
  const bases=freeze(Array.from({length:count},(_,index)=>basis(index))),plan=prepareSnapshotSimplexGeometry(bases);
  const samples=count===2?[[.9,.1],[.5,.5],[.1,.9],[1-1e-15,1e-15]]:[[.8,.1,.1],[.1,.8,.1],[.1,.1,.8],[1/3,1/3,1/3],[.5,.25,.25]];
  for(const weights of samples)for(const response of [undefined,signed,value]){
   const actual=plan.sample(weights,response),expected=legacyGeometry(bases,weights,response);
   expect(actual).toEqual(expected);expect(interpolateSnapshotSimplexGeometry(bases,weights,response)).toEqual(expected);
   const selected=bases[dominantSnapshotBasis(bases,weights)].drawing;
   expect(actual.drawing.curves.map(c=>c.id)).toEqual(selected.curves.filter(c=>c.id!=='extra').map(c=>c.id));
   expect(actual.drawing.curves.find(c=>c.id==='a')).toMatchObject({name:selected.curves.find(c=>c.id==='a')!.name,depthOffset:selected.curves.find(c=>c.id==='a')!.depthOffset,depthScope:selected.curves.find(c=>c.id==='a')!.depthScope,localPaintOrder:selected.curves.find(c=>c.id==='a')!.localPaintOrder});
   expect(actual.drawing.curves.some(c=>c.id==='extra')).toBe(false);
  }
 });

 it('keeps linked endpoints inactive when just one active basis is incoherent, including tiny positive support',()=>{
  const bases=[basis(0),basis(1),basis(2)];bases[2].drawing.nodes.find(n=>n.id==='b0')!.position[0]+=.4;
  const plan=prepareSnapshotSimplexGeometry(freeze(bases));
  for(const weights of [[.8,.1,.1],[.1,.1,.8],[.7,.3-1e-15,1e-15]]){
   const result=plan.sample(weights);expect(result).toEqual(legacyGeometry(bases,weights));
   expect(result.drawing.endpointLinks!.map(l=>l.id)).toEqual(['arcLink']);expect(result.nodeAuthorities.get('b0')).toBe('b0');
   expect(result.diagnostics.join(' ')).toContain('not silently snapped');
  }
 });

 it('preserves variant-specific diagnostics for missing members and incompatible relationships',()=>{
  const bases=[basis(0),basis(1),basis(2)];bases[1].drawing.nodes=bases[1].drawing.nodes.filter(n=>n.id!=='d1');
  bases[2].drawing.fills[0].boundary.reverse();bases[1].drawing.endpointLinks![0].throughDisplay=false;bases[2].drawing.displayIntervals=[];
  const plan=prepareSnapshotSimplexGeometry(freeze(bases));
  for(const weights of [[.8,.1,.1],[.1,.8,.1],[.1,.1,.8]]){
   const result=plan.sample(weights,signed);expect(result).toEqual(legacyGeometry(bases,weights,signed));
   expect(result.drawing.curves.map(c=>c.id)).not.toContain('d');expect(result.drawing.fills).toEqual([]);expect(result.drawing.displayIntervals).toEqual([]);
  }
 });

 it('keeps ARC and offset numeric interpolation geometric under signed control responses',()=>{
  const bases=freeze([basis(0),basis(1),basis(2)]),weights=[.2,.3,.5],result=prepareSnapshotSimplexGeometry(bases).sample(weights,signed).drawing;
  expect(result.joins[0].radius).toBeCloseTo(.2*.1+.3*.3+.5*.5,14);
  const brush=result.endpointLinks!.find(l=>l.id==='arcLink')!.joinBrush!;expect(brush.kind).toBe('ARC');if(brush.kind==='ARC')expect(brush.trimDistance).toBeCloseTo(.2*.2+.3*.3+.5*.4,14);
  expect(result.offsets[0].translation).toEqual([0,1].map(axis=>bases.reduce((sum,b,index)=>sum+(b.drawing.offsets[0].translation?.[axis]??0)*weights[index],0)));
  expect(result.offsets[0].distance).toBe(bases[2].drawing.offsets[0].distance);
 });

 it('keeps response call order, shared-node authority and the shared SMOOTH projection hook',()=>{
  const bases=freeze([basis(0),basis(1),basis(2)]),plan=prepareSnapshotSimplexGeometry(bases),weights=[.1,.8,.1];
  const run=(prepared:boolean)=>{
   const calls:unknown[]=[],response:SnapshotScalarValue=(target,axis,coordinates,geometric)=>{calls.push([target,axis,coordinates,geometric]);return value(target,axis,coordinates,geometric);};
   response.projectSmooth=vi.fn(drawing=>{const result=applyEndpointPairSmoothConstraints(drawing);return {...result,diagnostics:[...result.diagnostics,'projected','projected']};});
   const result=prepared?plan.sample(weights,response):legacyGeometry(bases,weights,response);expect(response.projectSmooth).toHaveBeenCalledTimes(1);return {calls,result};
  };
  const actual=run(true);expect(actual).toEqual(run(false));expect(actual.result.diagnostics.filter(d=>d==='projected')).toHaveLength(1);
  expect(actual.calls.filter(call=>(call as [SnapshotScalarTarget])[0].kind==='node')).toHaveLength(10);
  expect(actual.result.nodeAuthorities.get('b0')).toBe('a1');
 });

 it('reuses immutable scalar inputs but never shares mutable per-sample arrays, points or authority maps',()=>{
  const bases=freeze([basis(0),basis(1)]),plan=prepareSnapshotSimplexGeometry(bases),captured=new Map<string,{target:SnapshotScalarTarget;coordinates:readonly number[]}>();
  const response:SnapshotScalarResponse=(target,axis,coordinates,weights)=>{const key=JSON.stringify([target,axis]),previous=captured.get(key);if(previous){expect(target).toBe(previous.target);expect(coordinates).toBe(previous.coordinates);}else captured.set(key,{target,coordinates});expect(Object.isFrozen(target)).toBe(true);expect(Object.isFrozen(coordinates)).toBe(true);return weights;};
  const first=plan.sample([.7,.3],response),second=plan.sample([.7,.3],response),expected=structuredClone(second);
  for(const key of ['nodes','curves','fills','offsets','joins','endpointLinks','layers','groups','displayIntervals'] as const)expect(first.drawing[key]).not.toBe(second.drawing[key]);
  first.drawing.nodes[0].position[0]=900;first.drawing.curves[0].handles[0][0]=900;first.drawing.layers[0].items.length=0;first.drawing.groups![0].curveIds.length=0;first.drawing.offsets[0].translation![0]=900;
  first.drawing.joins[0].radius=900;const brush=first.drawing.endpointLinks!.find(l=>l.id==='arcLink')!.joinBrush!;if(brush.kind==='ARC')brush.trimDistance=900;
  first.drawing.curves.length=0;first.drawing.fills.length=0;first.drawing.displayIntervals!.length=0;first.nodeAuthorities.clear();first.diagnostics.push('mutated');
  expect(second).toEqual(expected);expect(plan.sample([.7,.3],response)).toEqual(expected);
 });

 it('compiles only the requested dominant variant and never serializes compatibility again for it',()=>{
  const bases=[basis(0),basis(1)];for(const b of bases)b.drawing.endpointLinks=b.drawing.endpointLinks!.filter(l=>l.id!=='smooth');
  freeze(bases);const stringify=vi.spyOn(JSON,'stringify');
  try{
   const plan=prepareSnapshotSimplexGeometry(bases);expect(stringify).not.toHaveBeenCalled();
   plan.sample([.7,.3]);expect(stringify).toHaveBeenCalled();stringify.mockClear();
   plan.sample([.6,.4]);expect(stringify).not.toHaveBeenCalled();
   plan.sample([.3,.7]);expect(stringify).toHaveBeenCalled();stringify.mockClear();
   plan.sample([.2,.8]);plan.sample([.8,.2]);expect(stringify).not.toHaveBeenCalled();
  }finally{stringify.mockRestore();}
 });

 it('observes in-place geometry, relation and binding edits through the standalone adapter',()=>{
  const bases=[basis(0),basis(1)],before=interpolateSnapshotSimplexGeometry(bases,[.5,.5]);
  bases[0].drawing.nodes.find(n=>n.id==='a0')!.position[0]=12;bases[1].drawing.curves.find(c=>c.id==='a')!.handles[0][1]=8;
  bases[0].drawing.nodes.find(n=>n.id==='b0')!.position[0]+=.5;bases[0].angle!.y=-20;
  const after=interpolateSnapshotSimplexGeometry(bases,[.5,.5]);expect(after).toEqual(legacyGeometry(bases,[.5,.5]));expect(after).not.toEqual(before);expect(after.drawing.curves[0].name).toBe('A 0');expect(after.drawing.endpointLinks!.map(l=>l.id)).toEqual(['arcLink']);
 });

 it('preserves exact vertices and weight/response validation',()=>{
  const a=basis(0),b=basis(1),single=prepareSnapshotSimplexGeometry([a]),plan=prepareSnapshotSimplexGeometry([a,b]);
  expect(single.sample([1]).drawing).toBe(a.drawing);expect(interpolateSnapshotSimplexGeometry([a],[1]).drawing).toBe(a.drawing);
  expect(()=>prepareSnapshotSimplexGeometry([])).toThrow('one to three');expect(()=>prepareSnapshotSimplexGeometry([a,a])).toThrow('distinct');
  for(const weights of [[1],[1,0],[-.1,1.1],[.5,.6],[NaN,.5],[Infinity,.5]])expect(()=>plan.sample(weights)).toThrow();
  for(const response of [()=>[1,1],()=>[NaN,NaN],()=>[1],()=>Infinity])expect(()=>plan.sample([.5,.5],response)).toThrow();
 });
});
