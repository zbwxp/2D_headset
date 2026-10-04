import {expect,test} from 'vitest';
import {emptyDrawing,type Cubic,type CurveUse,type DrawingDocument,type Endpoint} from '../../domain/drawing/model';
import {createFittedGeometryProjector} from '../../domain/drawing/cageGeometry';
import {evaluatedAffine,registerEvaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {appendEvaluatedDeformation,evaluatedDeformationSource,hasEvaluatedDeformation} from '../../domain/drawing/evaluatedDeformation';
import {prepareDrawingIdentityMapper,remapDrawingIdentities,remapIntervalIdentities} from '../../domain/recordingSnapshot/sources';

const id=(value:string)=>`canonical:${value}`;
const named={name:'curve:a',visible:true,locked:false};
const metadata={id:'curve:a',notes:['curve:b','missing:curve'],nested:{curveId:'node:a'}};
type WithMetadata<T>=T&{metadata:typeof metadata};
const withMetadata=<T extends object>(value:T):WithMetadata<T>=>({...value,metadata:structuredClone(metadata)});
function freeze<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;
}
function fixture():WithMetadata<DrawingDocument>{
 return withMetadata<DrawingDocument>({
  ...emptyDrawing(),
  nodes:[withMetadata({id:'node:a',position:[0,0]}),{id:'node:b',position:[1,0]},{id:'node:c',position:[1,0]},{id:'node:d',position:[2,0]}],
  curves:[withMetadata({...named,id:'curve:a',nodes:['node:a','node:b'],handles:[[.25,0],[.75,0]],width:.01,inkEnds:[{taper:.1},{extension:.02}]}),{...named,id:'curve:b',nodes:['node:c','node:d'],handles:[[1.25,0],[1.75,0]],width:.01}],
  fills:[withMetadata({...named,id:'fill',color:'black',boundary:[withMetadata({id:'curve:b',reverse:true}),{id:'missing:curve',reverse:false}],mist:{enabled:true,side:'INSIDE',width:.01,opacity:.6}})],
  offsets:[{...named,id:'offset',source:[{id:'curve:a',reverse:true},{id:'curve:b',reverse:false}],distance:.02,start:.1,end:.9,taper:.2,width:.01,translation:[.1,.2]}],
  layers:[{...named,id:'layer',items:['curve:b','curve:a','fill','offset','missing:item']}],
  joins:[withMetadata({id:'join',a:withMetadata({curveId:'curve:a',end:1}),b:{curveId:'missing:curve',end:0},mode:'CUSP'})],
  endpointLinks:[{id:'link',a:{curveId:'curve:a',end:1},b:{curveId:'curve:b',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.05}}],
  groups:[{...named,id:'group',curveIds:['curve:b','curve:a','missing:curve']}],
  displayIntervals:[withMetadata({id:'track',anchor:withMetadata({id:'curve:b',reverse:true}),displayRoute:withMetadata({seed:withMetadata({closed:false,segments:[{id:'curve:b',reverse:true},{id:'curve:a',reverse:true},{id:'missing:curve',reverse:false}]}),throughLinkIds:['link','missing:link']}),ranges:[withMetadata({id:'range',originId:'missing:range',start:.15,end:.8,name:'curve:a',inkEnds:[{taper:.03},{extension:.01}]}),{id:'range:second',start:.9,end:1,mode:'HIDE'}]})],
  mirrorAxisX:.5,mirrorEditing:{enabled:true,curvePairs:[{id:'pair',a:'curve:a',b:'missing:curve',reverse:true}],axisNodeIds:['node:b','missing:node']},
  reference:{name:'curve:a',dataUrl:'data:image/png;base64,abc',width:100,height:100,opacity:.5,visible:true,locked:true,offset:[.1,.2],scale:1,rotation:0},
 });
}

test('prepared cold mapping matches defensive mapping and preserves explicit orphan and reversed references',()=>{
 const drawing=freeze(fixture()),mapped=prepareDrawingIdentityMapper(id).map(drawing);
 expect(mapped).toEqual(remapDrawingIdentities(drawing,id));
 expect(mapped.curves[0].nodes).toEqual(['canonical:node:a','canonical:node:b']);
 expect(mapped.fills[0].boundary.map(use=>[use.id,use.reverse])).toEqual([['canonical:curve:b',true],['canonical:missing:curve',false]]);
 expect(mapped.offsets[0].source).toEqual([{id:'canonical:curve:a',reverse:true},{id:'canonical:curve:b',reverse:false}]);
 expect(mapped.layers[0].items).toEqual(drawing.layers[0].items.map(id));
 expect(mapped.groups![0].curveIds).toEqual(drawing.groups![0].curveIds.map(id));
 expect(mapped.joins[0].b).toEqual({curveId:'canonical:missing:curve',end:0});
 expect(mapped.endpointLinks![0]).toEqual({...drawing.endpointLinks![0],id:'canonical:link',a:{curveId:'canonical:curve:a',end:1},b:{curveId:'canonical:curve:b',end:0}});
 expect(mapped.displayIntervals![0].anchor.id).toBe('canonical:curve:b');
 expect(mapped.displayIntervals![0].anchor.reverse).toBe(true);
 expect(mapped.displayIntervals![0].displayRoute!.seed.segments).toEqual([{id:'canonical:curve:b',reverse:true},{id:'canonical:curve:a',reverse:true},{id:'canonical:missing:curve',reverse:false}]);
 expect(mapped.displayIntervals![0].displayRoute!.throughLinkIds).toEqual(['canonical:link','canonical:missing:link']);
 expect(mapped.displayIntervals![0].ranges[0]).toEqual({...drawing.displayIntervals![0].ranges[0],id:'canonical:range',originId:'canonical:missing:range'});
 expect(mapped.mirrorEditing).toEqual({enabled:true,curvePairs:[{id:'canonical:pair',a:'canonical:curve:a',b:'canonical:missing:curve',reverse:true}],axisNodeIds:['canonical:node:b','canonical:missing:node']});
 expect((mapped as WithMetadata<DrawingDocument>).metadata).toEqual(metadata);
 expect((mapped.curves[0] as WithMetadata<typeof mapped.curves[0]>).metadata).toEqual(metadata);
 expect(mapped.curves[0].name).toBe('curve:a');expect(mapped.reference).toEqual(drawing.reference);
});

test('whole drawings and unchanged records reuse owned mapped products under the immutable contract',()=>{
 const drawing=freeze(fixture()),mapper=prepareDrawingIdentityMapper(id),first=mapper.map(drawing),next=mapper.map({...drawing});
 expect(mapper.map(drawing)).toBe(first);expect(next).not.toBe(first);
 for(const kind of ['nodes','curves','fills','offsets','layers','joins','endpointLinks','groups','displayIntervals'] as const){
  expect(next[kind]).not.toBe(drawing[kind]);expect(next[kind]).not.toBe(first[kind]);
  drawing[kind]!.forEach((value,index)=>{expect(next[kind]![index]).toBe(first[kind]![index]);expect(next[kind]![index]).not.toBe(value);});
 }
 expect(next.mirrorEditing).toBe(first.mirrorEditing);expect(next.mirrorEditing).not.toBe(drawing.mirrorEditing);
 expect(next.curves[0].nodes).not.toBe(drawing.curves[0].nodes);
 expect(next.displayIntervals![0].ranges).not.toBe(drawing.displayIntervals![0].ranges);
 expect(next.displayIntervals![0].ranges[0]).not.toBe(drawing.displayIntervals![0].ranges[0]);
 // Untouched metadata and geometry may be shared, and are read-only by contract.
 expect(next.reference).toBe(drawing.reference);expect(next.curves[0].handles).toBe(drawing.curves[0].handles);
 expect((next as WithMetadata<DrawingDocument>).metadata).toBe(drawing.metadata);
});

test('node and handle edits replace only their changed mapped records',()=>{
 const drawing=freeze(fixture()),mapper=prepareDrawingIdentityMapper(id),first=mapper.map(drawing);
 const moved:DrawingDocument=freeze({...drawing,nodes:drawing.nodes.map((node,index)=>index===0?{...node,position:[.4,.2]}:node)}),next=mapper.map(moved);
 expect(next.nodes[0]).not.toBe(first.nodes[0]);expect(next.nodes[0].position).toEqual([.4,.2]);
 expect(next.nodes[1]).toBe(first.nodes[1]);expect(next.curves[0]).toBe(first.curves[0]);
 const handled:DrawingDocument=freeze({...moved,curves:moved.curves.map((curve,index)=>index===1?{...curve,handles:[[1.3,.2],curve.handles[1]]}:curve)}),last=mapper.map(handled);
 expect(last.curves[1]).not.toBe(next.curves[1]);expect(last.curves[1].handles[0]).toEqual([1.3,.2]);
 expect(last.curves[0]).toBe(next.curves[0]);expect(last.nodes[0]).toBe(next.nodes[0]);
 for(const kind of ['fills','offsets','layers','joins','endpointLinks','groups','displayIntervals'] as const)expect(last[kind]![0]).toBe(first[kind]![0]);
 expect(last.mirrorEditing).toBe(first.mirrorEditing);expect(last).toEqual(remapDrawingIdentities(handled,id));
});

test('additions, deletions and reference edits remap the current graph while retaining orphan IDs',()=>{
 const drawing=freeze(fixture()),mapper=prepareDrawingIdentityMapper(id),first=mapper.map(drawing);
 const added:DrawingDocument=freeze({...drawing,nodes:[...drawing.nodes,{id:'node:new',position:[3,0]}],curves:[...drawing.curves,{...drawing.curves[1],id:'curve:new',nodes:['node:d','node:new']}],layers:[{...drawing.layers[0],items:[...drawing.layers[0].items,'curve:new']}]}),next=mapper.map(added);
 expect(next).toEqual(remapDrawingIdentities(added,id));expect(next.curves[0]).toBe(first.curves[0]);expect(next.layers[0]).not.toBe(first.layers[0]);
 const removed:DrawingDocument=freeze({...added,curves:added.curves.filter(curve=>curve.id!=='curve:a'),layers:[{...added.layers[0],items:added.layers[0].items.filter(value=>value!=='curve:a')}]}),afterRemoval=mapper.map(removed);
 expect(afterRemoval).toEqual(remapDrawingIdentities(removed,id));expect(afterRemoval.curves.some(curve=>curve.id==='canonical:curve:a')).toBe(false);
 expect(afterRemoval.joins[0]).toBe(first.joins[0]);expect(afterRemoval.joins[0].a.curveId).toBe('canonical:curve:a');
 const revised:DrawingDocument=freeze({...removed,endpointLinks:[{...removed.endpointLinks![0],b:{curveId:'curve:new',end:1}}],groups:[{...removed.groups![0],curveIds:['curve:new']}],mirrorEditing:{...removed.mirrorEditing!,curvePairs:[{...removed.mirrorEditing!.curvePairs[0],b:'curve:new'}],axisNodeIds:['node:new']},displayIntervals:[{...removed.displayIntervals![0],anchor:{id:'curve:new',reverse:false},displayRoute:{seed:{closed:true,segments:[{id:'curve:new',reverse:true}]},throughLinkIds:['missing:new-link']}}]}),last=mapper.map(revised);
 expect(last).toEqual(remapDrawingIdentities(revised,id));expect(last.endpointLinks![0].b).toEqual({curveId:'canonical:curve:new',end:1});
 expect(last.displayIntervals![0].ranges[0]).toBe(first.displayIntervals![0].ranges[0]);
 expect(last.displayIntervals![0].displayRoute!.throughLinkIds).toEqual(['canonical:missing:new-link']);
 expect(last.groups![0].curveIds).toEqual(['canonical:curve:new']);expect(last.mirrorEditing!.axisNodeIds).toEqual(['canonical:node:new']);
});

test('material edits reuse unchanged ranges, route and anchor without repeating their ID callbacks',()=>{
 const drawing=freeze(fixture()),calls:string[]=[],mapper=prepareDrawingIdentityMapper(value=>{calls.push(value);return id(value);}),first=mapper.map(drawing);calls.length=0;
 const changed:DrawingDocument=freeze({...drawing,displayIntervals:[{...drawing.displayIntervals![0],ranges:drawing.displayIntervals![0].ranges.map((range,index)=>index===0?{...range,start:.2}:range)}]}),next=mapper.map(changed);
 expect(calls).toEqual(['track','range','missing:range']);expect(next.displayIntervals![0]).not.toBe(first.displayIntervals![0]);
 expect(next.displayIntervals![0].ranges[0]).not.toBe(first.displayIntervals![0].ranges[0]);expect(next.displayIntervals![0].ranges[1]).toBe(first.displayIntervals![0].ranges[1]);
 expect(next.displayIntervals![0].anchor).toBe(first.displayIntervals![0].anchor);expect(next.displayIntervals![0].displayRoute).toBe(first.displayIntervals![0].displayRoute);
 expect(next).toEqual(remapDrawingIdentities(changed,id));
});

test.each([100,1000])('one node and handle edit repeats four ID callbacks with %i unrelated curves',count=>{
 const drawing:DrawingDocument=emptyDrawing();
 for(let index=0;index<=count;index++){
  const a=`node:${index}:a`,b=`node:${index}:b`;drawing.nodes.push({id:a,position:[index,0]},{id:b,position:[index+1,0]});
  drawing.curves.push({...named,id:`curve:${index}`,nodes:[a,b],handles:[[index+.25,0],[index+.75,0]],width:.01});
 }
 drawing.layers=[{...named,id:'layer',items:drawing.curves.map(curve=>curve.id)}];freeze(drawing);
 const calls:string[]=[],mapper=prepareDrawingIdentityMapper(value=>{calls.push(value);return id(value);}),first=mapper.map(drawing);calls.length=0;
 const changed:DrawingDocument=freeze({...drawing,nodes:[{...drawing.nodes[0],position:[.1,.2]},...drawing.nodes.slice(1)],curves:[{...drawing.curves[0],handles:[[.3,.2],drawing.curves[0].handles[1]]},...drawing.curves.slice(1)]}),next=mapper.map(changed);
 expect(calls).toEqual(['node:0:a','curve:0','node:0:a','node:0:b']);
 expect(next.curves.slice(1).every((curve,index)=>curve===first.curves[index+1])).toBe(true);expect(next.layers[0]).toBe(first.layers[0]);
 calls.length=0;expect(mapper.map(changed)).toBe(next);expect(calls).toEqual([]);
});

test('record kind and mapper identity keep distinct interpretations and namespaces separate',()=>{
 const shared:CurveUse&Endpoint={id:'curve:a',reverse:true,curveId:'curve:b',end:1},drawing=fixture();
 drawing.fills[0].boundary=[shared];drawing.joins[0].a=shared;freeze(drawing);
 const mapped=prepareDrawingIdentityMapper(id).map(drawing);
 expect(mapped.fills[0].boundary[0]).toEqual({...shared,id:'canonical:curve:a'});expect(mapped.joins[0].a).toEqual({...shared,curveId:'canonical:curve:b'});
 expect(mapped.fills[0].boundary[0]).not.toBe(mapped.joins[0].a);
 expect(prepareDrawingIdentityMapper(value=>`other:${value}`).map(drawing).nodes[0].id).toBe('other:node:a');
});

test('public mappings retain deep mutation isolation for geometry, material and arbitrary metadata',()=>{
 const drawing=fixture(),before=structuredClone(drawing),mapped=remapDrawingIdentities(drawing,id),independent=remapDrawingIdentities(drawing,id);
 mapped.nodes[0].position[0]=99;mapped.curves[0].handles[0][1]=99;mapped.curves[0].inkEnds![0].taper=99;
 mapped.fills[0].mist!.opacity=99;mapped.endpointLinks![0].a.curveId='changed';mapped.reference!.offset[0]=99;
 const track=mapped.displayIntervals![0];track.ranges[0].inkEnds![0].taper=99;
 (track.anchor as WithMetadata<CurveUse>).metadata.nested.curveId='changed';
 (track.displayRoute as WithMetadata<NonNullable<typeof track.displayRoute>>).metadata.notes.push('changed');
 (mapped as WithMetadata<DrawingDocument>).metadata.id='changed';
 expect(drawing).toEqual(before);expect(independent).toEqual(remapDrawingIdentities(before,id));
 drawing.nodes[1].position[0]=88;expect(mapped.nodes[1].position).toEqual(before.nodes[1].position);
 const interval=remapIntervalIdentities(drawing.displayIntervals![0],id);
 (interval.anchor as WithMetadata<CurveUse>).metadata.notes.push('changed');interval.ranges[0].inkEnds![0].taper=77;
 expect(drawing.displayIntervals).toEqual(before.displayIntervals);
});

test('prepared identity mapping does not retain runtime affine or deformation programs',()=>{
 const drawing=freeze(fixture()),source=fixture();
 registerEvaluatedAffine(drawing,source,()=>({point:([x,y])=>[x+1,y],maxScale:1}));
 const deformed={...drawing,nodes:[...drawing.nodes]},fit=(shape:Cubic)=>({shape,parameters:{values:[0,1]},maxError:0});
 appendEvaluatedDeformation(deformed,drawing,new Set(['curve:a']),createFittedGeometryProjector(piece=>fit(piece.shape),fit),'identity');
 expect(evaluatedAffine(drawing,'curve:a')).toBeDefined();expect(hasEvaluatedDeformation(deformed)).toBe(true);
 for(const mapped of [remapDrawingIdentities(drawing,id),prepareDrawingIdentityMapper(id).map(drawing),remapDrawingIdentities(deformed,id),prepareDrawingIdentityMapper(id).map(deformed)]){
  expect(evaluatedAffine(mapped,'canonical:curve:a')).toBeUndefined();expect(hasEvaluatedDeformation(mapped)).toBe(false);expect(evaluatedDeformationSource(mapped)).toBeUndefined();
 }
});
