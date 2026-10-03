import {readFileSync} from 'node:fs';
import {describe,expect,test} from 'vitest';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {splitCurve} from '../../domain/drawing/commands';
import {depthPaintBatches} from '../../domain/drawing/depth';
import {resolveDisplayRoute,createDisplayRouteField} from '../../domain/drawing/displayRoutes';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {registerEvaluatedAffine,evaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {derivedUses} from '../../domain/drawing/roundedJoin';
import {strokes,strokePaths} from '../../domain/drawing/strokes';
import {intervalPinch,withIntervalPinch} from '../../domain/drawing/intervalPinch';
import {compileDisplayRouteBrushes,scaleEvaluatedDisplayRouteBrush} from '../../domain/drawing/displayRouteBrush';
import {drawingIdentityIds} from '../../domain/recordingSnapshot/sources';
import {mirrorSnapshotDrawing,SnapshotMirrorError,type SnapshotMirrorOptions,type SnapshotMirrorCorrespondence} from '../../domain/recordingSnapshot/snapshotMirror';

const asset=(name:string)=>parseDrawing(JSON.parse(readFileSync(new URL(`../../assets/${name}.json`,import.meta.url),'utf8')));
const reflected=([x,y]:Point2,axis:number):Point2=>[2*axis-x,y];
const expectPoint=(actual:Point2,wanted:Point2)=>{expect(Math.abs(actual[0]-wanted[0])).toBeLessThanOrEqual(1e-14);expect(Math.abs(actual[1]-wanted[1])).toBeLessThanOrEqual(1e-14);};
const withoutGeometry=(drawing:DrawingDocument)=>({...drawing,nodes:drawing.nodes.map(node=>({...node,position:null})),curves:drawing.curves.map(curve=>({...curve,handles:null})),offsets:drawing.offsets.map(offset=>({...offset,...(offset.translation?{translation:null}:{})})),...(drawing.mirrorAxisX!==undefined?{mirrorAxisX:null}:{})});
function expectRoundTrip(source:DrawingDocument,options:SnapshotMirrorOptions){
 const before=JSON.stringify(source),first=mirrorSnapshotDrawing(source,options),second=mirrorSnapshotDrawing(first.drawing,options);
 expect(JSON.stringify(source)).toBe(before);
 expect(withoutGeometry(second.drawing)).toEqual(withoutGeometry(source));
 for(const node of source.nodes)expectPoint(second.drawing.nodes.find(value=>value.id===node.id)!.position,node.position);
 for(const curve of source.curves)shapeOf(second.drawing,curve.id).forEach((point,i)=>expectPoint(point,shapeOf(source,curve.id)[i]));
 for(const offset of source.offsets)if(offset.translation)expectPoint(second.drawing.offsets.find(value=>value.id===offset.id)!.translation!,offset.translation);
 expect(drawingIdentityIds(first.drawing).sort()).toEqual(drawingIdentityIds(source).sort());
 return first;
}
const mapObject=(mapping:SnapshotMirrorCorrespondence,id:string)=>mapping.curves[id]?.id??mapping.fills[id]??mapping.offsets[id];

describe('canonical snapshot reflection',()=>{
 test('actual 121-curve two-half asset preserves semantic topology, masks, ARC data, interval material and reflected paint order',()=>{
  const source=asset('hairless-symmetric-two-face-mirror'),options={axisX:source.mirrorAxisX!,...source.mirrorEditing!};
  // Deliberately asymmetric authored states expose a geometry-only swap or an
  // order reset even when the bundled rest geometry happens to be symmetric.
  const pair=options.curvePairs.find(pair=>pair.a!==pair.b)!;
  source.curves.find(curve=>curve.id===pair.a)!.visible=false;
  const {drawing,correspondence,diagnostics}=expectRoundTrip(source,options);
  expect(source.curves).toHaveLength(121);expect(options.curvePairs).toHaveLength(54);
  expect(()=>parseDrawing(drawing)).not.toThrow();
  expect(diagnostics.filter(diagnostic=>diagnostic.entityKind==='layers')).toEqual([]);
  expect(Object.values(correspondence.layers).sort()).toEqual(source.layers.map(layer=>layer.id).sort());
  expect(source.layers.some(layer=>correspondence.layers[layer.id]!==layer.id)).toBe(true);
  for(const curve of source.curves){
   const mapped=correspondence.curves[curve.id],shape=shapeOf(source,curve.id),target=shapeOf(drawing,mapped.id);
   shape.forEach((point,i)=>expectPoint(target[mapped.reverse?3-i:i],reflected(point,options.axisX)));
   expect(drawing.curves.find(value=>value.id===mapped.id)!.visible).toBe(curve.visible);
  }
  for(const fill of source.fills){const next=drawing.fills.find(value=>value.id===correspondence.fills[fill.id])!;expect(next.color).toBe(fill.color);expect(next.mist).toEqual(fill.mist);expect(next.boundary).toEqual(fill.boundary.map(use=>({id:correspondence.curves[use.id].id,reverse:use.reverse!==correspondence.curves[use.id].reverse})));}
  for(const join of source.joins){const next=drawing.joins.find(value=>value.id===correspondence.joins[join.id])!;expect(next.mode).toBe(join.mode);expect(next.radius).toBe(join.radius);expect(next.a.curveId).toBe(correspondence.curves[join.a.curveId].id);}
  for(const track of source.displayIntervals!){const next=drawing.displayIntervals!.find(value=>value.id===correspondence.displayIntervals[track.id])!;expect(next.ranges.map(({id,originId,...range})=>range)).toEqual(track.ranges.map(({id,originId,...range})=>range));}
  const originalBatches=depthPaintBatches(source),reflectedBatches=depthPaintBatches(drawing);
  expect(reflectedBatches.map(batch=>({layerId:batch.layerId,id:batch.item.id,owner:batch.owner,position:batch.position,kind:batch.item.kind}))).toEqual(originalBatches.map(batch=>({layerId:correspondence.layers[batch.layerId],id:mapObject(correspondence,batch.item.id),owner:batch.owner?mapObject(correspondence,batch.owner):undefined,position:batch.position,kind:batch.item.kind})));
  expect(drawing.layers.flatMap(layer=>layer.items)).toEqual(source.layers.flatMap(layer=>layer.items).map(id=>mapObject(correspondence,id)));
  // Every explicit through-display route remains valid after the semantic swap.
  for(const track of drawing.displayIntervals!)if(track.displayRoute)expect(resolveDisplayRoute(drawing,track.displayRoute).diagnostics).toEqual([]);
 });

 test.each([8,9])('standalone %i-curve profile reflects geometrically under the same IDs without inventing a partner',count=>{
  let source=asset('recording-side-part');if(count===9)source=splitCurve(source,source.curves[0].id,.375).document;
  const options={axisX:-.3294804514288924,curvePairs:[]},before=JSON.stringify(source),{drawing,correspondence,diagnostics}=expectRoundTrip(source,options);
  expect(source.curves).toHaveLength(count);expect(diagnostics).toEqual([]);
  expect(drawing.curves.map(curve=>curve.id)).toEqual(source.curves.map(curve=>curve.id));
  for(const curve of source.curves){expect(correspondence.curves[curve.id]).toEqual({id:curve.id,reverse:false});shapeOf(source,curve.id).forEach((point,i)=>expectPoint(shapeOf(drawing,curve.id)[i],reflected(point,options.axisX)));}
  expect(drawing.layers).toEqual(source.layers);expect(drawing.fills).toEqual(source.fills);expect(JSON.stringify(source)).toBe(before);
 });

 test('contradictory shared-node pairings, non-bijective endpoints and an absent axis fail atomically',()=>{
  const source=pairedDrawing(),before=JSON.stringify(source);
  const expectError=(options:SnapshotMirrorOptions,code:SnapshotMirrorError['code'])=>{try{mirrorSnapshotDrawing(source,options);throw Error('Expected atomic failure');}catch(error){expect(error).toBeInstanceOf(SnapshotMirrorError);expect((error as SnapshotMirrorError).code).toBe(code);}expect(JSON.stringify(source)).toBe(before);};
  expectError({...pairedOptions,curvePairs:pairedOptions.curvePairs.map(pair=>pair.id==='cd'?{...pair,reverse:false}:pair)},'NODE_CONFLICT');
  expectError({...pairedOptions,axisNodeIds:['absent']},'INVALID_REFERENCE');
  expectError({...pairedOptions,axisX:undefined as unknown as number},'INVALID_AXIS');
  expectError({...pairedOptions,curvePairs:[...pairedOptions.curvePairs,{id:'reuse',a:'a',b:'d',reverse:false}]},'PAIR_CONFLICT');
  const malformed=pairedDrawing();malformed.curves.find(curve=>curve.id==='d')!.nodes[1]='b0';
  expect(()=>mirrorSnapshotDrawing(malformed,pairedOptions)).toThrow(SnapshotMirrorError);
 });

 test('a newly added unpaired curve follows explicit shared-node correspondence without acquiring a guessed curve partner',()=>{
  const source=pairedDrawing();source.curves.push({id:'new-detail',name:'Detail',nodes:['a1','e0'],handles:[[-1.5,1.2],[-3.5,.2]],visible:true,locked:false,width:.01});source.layers[0].items.push('new-detail');
  const {drawing,correspondence}=expectRoundTrip(source,pairedOptions);
  expect(correspondence.curves['new-detail']).toEqual({id:'new-detail',reverse:false});expect(drawing.curves.find(curve=>curve.id==='new-detail')!.nodes).toEqual(['b1','f0']);
  shapeOf(source,'new-detail').forEach((point,i)=>expectPoint(shapeOf(drawing,'new-detail')[i],reflected(point,pairedOptions.axisX)));
 });

 test('reversed pairs preserve directed travel, physical reveal ends, offset normals and undirected link identities without changing the SMOOTH driver',()=>{
  const source=pairedDrawing(),{drawing,correspondence}=expectRoundTrip(source,pairedOptions);
  expect(correspondence.curves.a).toEqual({id:'b',reverse:true});expect(correspondence.nodes.a0).toBe('b0');
  expect(correspondence.endpointLinks.linkL).toBe('linkR');expect(correspondence.joins.joinL).toBe('joinR');
  const join=drawing.joins.find(join=>join.id==='joinR')!;expect(join).toMatchObject({a:{curveId:'b',end:0},b:{curveId:'d',end:1},mode:'SMOOTH'});
  const link=drawing.endpointLinks!.find(link=>link.id==='linkR')!;expect(link).toMatchObject({a:{curveId:'d',end:0},b:{curveId:'f',end:1},joinBrush:{kind:'SMOOTH'}});
  const offset=drawing.offsets.find(offset=>offset.id==='offsetR')!;expect(offset.source).toEqual([{id:'b',reverse:true},{id:'d',reverse:true}]);expect(offset.distance).toBe(-.07);expect(offset.translation).toEqual([-.13,.21]);expect(offset.start).toBe(.17);expect(offset.end).toBe(.81);
  const sourceTrack=source.displayIntervals!.find(track=>track.id==='trackL')!,track=drawing.displayIntervals!.find(track=>track.id==='trackR')!;
  expect(track.anchor).toEqual({id:'b',reverse:true});expect(track.displayRoute).toEqual({seed:{segments:[{id:'b',reverse:true},{id:'d',reverse:true}],closed:true},throughLinkIds:['linkR']});
  expect(track.ranges[0]).toEqual({...sourceTrack.ranges[0],id:'rangeR'});
  expect(drawing.displayIntervals!.find(track=>track.id==='localR')).toMatchObject({anchor:{id:'d',reverse:false},revealFrom:0,ranges:[{id:'localRangeL',start:.12,end:.67}]});
  const before=createDisplayRouteField(source,sourceTrack.displayRoute!),after=createDisplayRouteField(drawing,track.displayRoute!);
  expect(before.diagnostics).toEqual([]);expect(after.diagnostics).toEqual([]);
  expect(after.path.segments).toEqual(before.path.segments.map(use=>({id:correspondence.curves[use.id].id,reverse:use.reverse!==correspondence.curves[use.id].reverse})));
  expect(after.geometry.shapes).toHaveLength(before.geometry.shapes.length);
  before.geometry.shapes.forEach((shape,i)=>shape.forEach((point,j)=>expectPoint(after.geometry.shapes[i][j],reflected(point,pairedOptions.axisX))));
  const originalInk=displayField(source,displayPath(source,'a')).inkSpans,mirroredInk=displayField(drawing,displayPath(drawing,'b')).inkSpans;
  expect(mirroredInk).toEqual(originalInk);
 });

 test('unmatched and ambiguous local masks, offsets, intervals and mixed layers survive with explicit compatibility diagnostics',()=>{
  const source=pairedDrawing();
  source.fills.push({...structuredClone(source.fills[0]),id:'extra-mask',color:'transparent'});source.layers[0].items.push('extra-mask');
  source.offsets.push({...structuredClone(source.offsets[0]),id:'extra-offset'});source.layers[0].items.push('extra-offset');
  source.displayIntervals!.push({id:'extra-track',anchor:{id:'e',reverse:false},scope:'CURVE',ranges:[{id:'extra-range',start:.04,end:.64,mode:'HIDE',enabled:false,inkEnds:[{extension:.01},{taper:.03}]}]});
  const {drawing,correspondence,diagnostics}=expectRoundTrip(source,pairedOptions);
  expect(drawing.fills).toHaveLength(3);expect(drawing.offsets).toHaveLength(3);expect(drawing.displayIntervals).toHaveLength(5);
  expect(correspondence.fills['extra-mask']).toBe('extra-mask');expect(correspondence.offsets['extra-offset']).toBe('extra-offset');expect(correspondence.displayIntervals['extra-track']).toBe('extra-track');
  expect(drawing.fills.find(fill=>fill.id==='extra-mask')).toMatchObject({color:'transparent',boundary:[{id:'b',reverse:true},{id:'d',reverse:true}]});
  expect(drawing.displayIntervals!.find(track=>track.id==='extra-track')).toMatchObject({anchor:{id:'f',reverse:false},ranges:[{id:'extra-range',mode:'HIDE',enabled:false}]});
  expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({entityKind:'fills',entityId:'extra-mask',code:'AMBIGUOUS_ENTITY'}),expect.objectContaining({entityKind:'offsets',entityId:'extra-offset',code:'AMBIGUOUS_ENTITY'}),expect.objectContaining({entityKind:'displayIntervals',entityId:'extra-track',code:'UNMATCHED_ENTITY'}),expect.objectContaining({entityKind:'layers',code:'UNMATCHED_ENTITY'})]));
 });

 test('an explicit self-pair reverses canonical endpoints without clamping an off-axis node or adding metadata',()=>{
  const source:DrawingDocument={...emptyDrawing(),nodes:[{id:'start',position:[-.7,.2]},{id:'end',position:[.9,.4]}],curves:[{id:'mouth',name:'Mouth',nodes:['start','end'],handles:[[-.4,.3],[.5,.6]],visible:true,locked:false,width:.01,profile:'TAPER_END',inkEnds:[{taper:.01},{taper:.03}]}],layers:[{id:'mouth-layer',name:'Mouth',items:['mouth'],visible:true,locked:false}]};
  const result=expectRoundTrip(source,{axisX:.25,curvePairs:[{id:'self',a:'mouth',b:'mouth',reverse:true}]});
  expect(result.correspondence.nodes).toEqual({start:'end',end:'start'});expect(result.drawing.curves[0].nodes).toEqual(['start','end']);expect(result.drawing.curves[0].inkEnds).toEqual([{taper:.03},{taper:.01}]);expect(result.drawing.curves[0].profileReverse).toBeUndefined();
  const axis=expectRoundTrip(source,{axisX:.25,curvePairs:[],axisNodeIds:['start']});expect(axis.drawing.nodes[0].position).toEqual([1.2,.2]);
 });

 test.each([1.7,0])('deferred affine ARC geometry remains an exact reflected material projection at x scale %s',scaleX=>{
  const original=asset('hairless-symmetric-two-face-mirror'),point=([x,y]:Point2):Point2=>[scaleX*x+.2,.63*y-.11];
  const source:DrawingDocument={...original,nodes:original.nodes.map(node=>({...node,position:point(node.position)})),curves:original.curves.map(curve=>({...curve,handles:curve.handles.map(point) as [Point2,Point2]}))};
  registerEvaluatedAffine(source,original,()=>({point,maxScale:Math.max(scaleX,.63)}));
  const options={axisX:original.mirrorAxisX!,...original.mirrorEditing!},{drawing,correspondence}=expectRoundTrip(source,options);
  expect(evaluatedAffine(drawing,drawing.curves[0].id)).toBeDefined();
  let arcPieces=0;
  for(const layer of source.layers)for(const stroke of strokes(source,layer.id))for(const path of strokePaths(stroke)){
   const before=derivedUses(source,path.segments,path.closed),after=derivedUses(drawing,path.segments.map(use=>({id:correspondence.curves[use.id].id,reverse:use.reverse!==correspondence.curves[use.id].reverse})),path.closed);
   expect(after.shapes).toHaveLength(before.shapes.length);arcPieces+=before.pieces.filter(piece=>piece.joinId).length;
   before.shapes.forEach((shape,i)=>shape.forEach((p,j)=>expectPoint(after.shapes[i][j],reflected(p,options.axisX))));
  }
  for(const track of source.displayIntervals!)if(track.displayRoute){
   const mapped=drawing.displayIntervals!.find(value=>value.id===correspondence.displayIntervals[track.id])!,before=createDisplayRouteField(source,track.displayRoute),after=createDisplayRouteField(drawing,mapped.displayRoute!);
   arcPieces+=before.geometry.pieces.filter(piece=>piece.joinId).length;
   expect(after.geometry.shapes).toHaveLength(before.geometry.shapes.length);before.geometry.shapes.forEach((shape,i)=>shape.forEach((p,j)=>expectPoint(after.geometry.shapes[i][j],reflected(p,options.axisX))));
  }
  expect(arcPieces).toBeGreaterThan(0);
 });

 test('runtime interval pinch and scaled ARC permissions survive without adding serialized authoring data',()=>{
  const source=pairedDrawing(),originalRange=source.displayIntervals![0].ranges[0];withIntervalPinch(originalRange,.63);
  const first=mirrorSnapshotDrawing(source,pairedOptions),second=mirrorSnapshotDrawing(first.drawing,pairedOptions);
  expect(intervalPinch(first.drawing.displayIntervals!.find(track=>track.id==='trackR')!.ranges[0])).toBe(.63);
  expect(intervalPinch(second.drawing.displayIntervals!.find(track=>track.id==='trackL')!.ranges[0])).toBe(.63);
  expect(second.drawing.displayIntervals).toEqual(source.displayIntervals);
  const actual=asset('hairless-symmetric-two-face-mirror'),arc=actual.endpointLinks!.find(link=>link.joinBrush?.kind==='ARC')!;
  arc.joinBrush=scaleEvaluatedDisplayRouteBrush(arc.joinBrush!,1000);expect(arc.joinBrush.kind==='ARC'&&arc.joinBrush.trimDistance>2).toBe(true);
  const options={axisX:actual.mirrorAxisX!,...actual.mirrorEditing!},mirrored=mirrorSnapshotDrawing(actual,options),track=mirrored.drawing.displayIntervals!.find(track=>track.displayRoute?.throughLinkIds.includes(mirrored.correspondence.endpointLinks[arc.id]))!;
  const resolved=resolveDisplayRoute(mirrored.drawing,track.displayRoute!),brushes=compileDisplayRouteBrushes(mirrored.drawing,resolved);
  expect(brushes.diagnostics.some(issue=>issue.code==='INVALID_BRUSH')).toBe(false);
  expect(mirrored.drawing.endpointLinks!.find(link=>link.id===mirrored.correspondence.endpointLinks[arc.id])!.joinBrush).toEqual(arc.joinBrush);
 });
});

const pairedOptions:SnapshotMirrorOptions={axisX:.125,curvePairs:[{id:'ab',a:'a',b:'b',reverse:true},{id:'cd',a:'c',b:'d',reverse:true},{id:'ef',a:'e',b:'f',reverse:false}]};
function pairedDrawing():DrawingDocument {
 const curve=(id:string,nodes:[string,string],handles:[Point2,Point2])=>({id,name:id,nodes,handles,visible:true,locked:false,width:.01,inkEnds:[{taper:.01},{extension:.02}] as [{taper:number},{extension:number}]});
 const range=(id:string)=>({id,start:.17,end:.83,inkEnds:[{taper:.02},{extension:.03}] as [{taper:number},{extension:number}]});
 return {...emptyDrawing(),
  nodes:[{id:'a0',position:[-3,0]},{id:'a1',position:[-2,1]},{id:'b0',position:[3,0]},{id:'b1',position:[2,1]},{id:'e0',position:[-4,0]},{id:'e1',position:[-3,0]},{id:'f0',position:[4,0]},{id:'f1',position:[3,0]}],
  curves:[curve('a',['a0','a1'],[[-2.7,0],[-2.2,1]]),curve('c',['a1','a0'],[[-1.8,1],[-2.7,0]]),curve('e',['e0','e1'],[[-3.7,0],[-3.3,0]]),curve('b',['b1','b0'],[[2.2,1],[2.7,0]]),curve('d',['b0','b1'],[[2.7,0],[1.8,1]]),curve('f',['f0','f1'],[[3.7,0],[3.3,0]])],
  fills:[{id:'fillL',name:'Left',visible:true,locked:false,color:'white',mist:{enabled:true,side:'BOTH',width:.02,opacity:.4},boundary:[{id:'a',reverse:false},{id:'c',reverse:false}]},{id:'fillR',name:'Right',visible:false,locked:false,color:'black',boundary:[{id:'b',reverse:true},{id:'d',reverse:true}]}],
  offsets:[{id:'offsetL',name:'Left offset',visible:true,locked:false,source:[{id:'a',reverse:false},{id:'c',reverse:false}],distance:.07,start:.17,end:.81,taper:.1,width:.007,translation:[.13,.21]},{id:'offsetR',name:'Right offset',visible:false,locked:true,source:[{id:'b',reverse:true},{id:'d',reverse:true}],distance:-.04,start:.09,end:.91,taper:.2,width:.008}],
  layers:[{id:'layerL',name:'Left',visible:true,locked:false,items:['fillL','a','c','e','offsetL']},{id:'layerR',name:'Right',visible:true,locked:false,items:['fillR','b','d','f','offsetR']}],
  joins:[{id:'joinL',a:{curveId:'a',end:1},b:{curveId:'c',end:0},mode:'SMOOTH'},{id:'joinR',a:{curveId:'d',end:1},b:{curveId:'b',end:0},mode:'SMOOTH'}],
  endpointLinks:[{id:'linkL',a:{curveId:'c',end:1},b:{curveId:'e',end:1},throughDisplay:true,joinBrush:{kind:'SMOOTH'}},{id:'linkR',a:{curveId:'f',end:1},b:{curveId:'d',end:0},throughDisplay:true,joinBrush:{kind:'SMOOTH'}}],
  groups:[{id:'groupL',name:'Left',visible:true,locked:false,curveIds:['a','c']},{id:'groupR',name:'Right',visible:true,locked:false,curveIds:['b','d']}],
  displayIntervals:[{id:'trackL',anchor:{id:'a',reverse:false},displayRoute:{seed:{segments:[{id:'a',reverse:false},{id:'c',reverse:false}],closed:true},throughLinkIds:['linkL']},ranges:[range('rangeL')]},{id:'trackR',anchor:{id:'b',reverse:true},displayRoute:{seed:{segments:[{id:'b',reverse:true},{id:'d',reverse:true}],closed:true},throughLinkIds:['linkR']},ranges:[range('rangeR')]},{id:'localL',anchor:{id:'c',reverse:true},scope:'CURVE',revealFrom:1,ranges:[{id:'localRangeL',originId:'rangeL',start:.12,end:.67,mode:'HIDE',enabled:false}]},{id:'localR',anchor:{id:'d',reverse:false},scope:'CURVE',revealFrom:0,ranges:[{id:'localRangeR',originId:'rangeR',start:.27,end:.88,mode:'HIDE'}]}],
 };
}
