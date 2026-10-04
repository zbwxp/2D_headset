import {readFileSync} from 'node:fs';
import {describe,expect,test} from 'vitest';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument,type DrawingCurve,type Point2} from '../../domain/drawing/model';
import {registerEvaluatedAffine,evaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {derivedUses} from '../../domain/drawing/roundedJoin';
import {createDisplayRouteField} from '../../domain/drawing/displayRoutes';
import {strokes,strokePaths} from '../../domain/drawing/strokes';
import {mirrorSnapshotDrawing} from '../../domain/recordingSnapshot/snapshotMirror';
import {mirrorViewDrawing,viewMirrorUnpairedCurveGroups,ViewMirrorError,type ViewMirrorOptions} from '../../domain/recordingSnapshot/viewMirrorMath';

const curve=(id:string,nodes:[string,string],handles:[Point2,Point2]):DrawingCurve=>({id,name:id,nodes,handles,visible:true,locked:false,width:.01});
const point=(actual:Point2,wanted:Point2)=>actual.forEach((n,i)=>expect(Math.abs(n-wanted[i])).toBeLessThan(1e-12));
const delta=(p:Point2,p0:Point2,t0:Point2):Point2=>[t0[0]-(p[0]-p0[0]),t0[1]+(p[1]-p0[1])];
function paired():DrawingDocument {return {...emptyDrawing(),
 nodes:[{id:'l0',position:[1,2]},{id:'l1',position:[2,3]},{id:'r0',position:[7,4]},{id:'r1',position:[8,5]}],
 curves:[curve('left',['l0','l1'],[[1.3,2.1],[1.7,2.8]]),curve('right',['r1','r0'],[[7.8,4.8],[7.2,4.1]])],
 layers:[{id:'left-layer',name:'Left',items:['left'],visible:true,locked:false},{id:'right-layer',name:'Right',items:['right'],visible:true,locked:false}],
 };}
const pairOptions:ViewMirrorOptions={curvePairs:[{id:'pair',a:'left',b:'right',reverse:true}]};
function transformed(d:DrawingDocument,map:(p:Point2,id:string)=>Point2):DrawingDocument {return {...d,nodes:d.nodes.map(node=>({...node,position:map(node.position,node.id)})),curves:d.curves.map(curve=>({...curve,handles:curve.handles.map(p=>map(p,curve.id)) as [Point2,Point2]}))};}
function unpaired():DrawingDocument {return {...emptyDrawing(),nodes:[{id:'p0',position:[4,0]},{id:'p1',position:[6,1]},{id:'p2',position:[5,3]}],curves:[curve('a',['p0','p1'],[[4.2,.1],[5.7,.8]]),curve('b',['p1','p2'],[[6.4,1.4],[5.2,2.7]])],layers:[{id:'profile',name:'Profile',visible:true,locked:false,items:['a','b']}]};}
const unpairedOptions:ViewMirrorOptions={curvePairs:[],unpairedGroups:[{curveIds:['a','b'],reference:[5,1]}]};

describe('local zero-view reflection',()=>{
 test('zero group discovery reuses complete canonical relation components without choosing a pivot',()=>{
  const zero=paired();zero.nodes.push({id:'tip',position:[2.4,3.2]},{id:'linked',position:[2.4,3.2]},{id:'far',position:[4,5]});zero.curves.push(curve('zero-only-detail',['l1','tip'],[[2.1,3.4],[2.3,3.3]]),curve('linked-detail',['linked','far'],[[2.5,3.5],[3.5,4.7]]));zero.endpointLinks=[{id:'link',a:{curveId:'zero-only-detail',end:1},b:{curveId:'linked-detail',end:0}}];
  const before=JSON.stringify(zero);expect(viewMirrorUnpairedCurveGroups(zero,pairOptions.curvePairs)).toEqual([['left','zero-only-detail','linked-detail']]);expect(JSON.stringify(zero)).toBe(before);
  expect(viewMirrorUnpairedCurveGroups(paired(),pairOptions.curvePairs)).toEqual([]);expect(viewMirrorUnpairedCurveGroups(unpaired(),[])).toEqual([['a','b']]);
 });

 test('paired controls use semantic zero targets, reverse ends and both components of the source delta',()=>{
  const zero=paired(),current=transformed(zero,([x,y],id)=>[x+(id.startsWith('l')?.4:-.2),y+(id.startsWith('l')?.7:.3)]),before=JSON.stringify([current,zero]);
  const {drawing,correspondence}=mirrorViewDrawing(current,zero,pairOptions);
  for(const source of current.curves){const map=correspondence.curves[source.id],s0=shapeOf(zero,source.id),t0=shapeOf(zero,map.id);shapeOf(current,source.id).forEach((p,i)=>point(shapeOf(drawing,map.id)[map.reverse?3-i:i],delta(p,s0[i],t0[map.reverse?3-i:i])));}
  expect(JSON.stringify([current,zero])).toBe(before);expect(drawing.curves.map(curve=>curve.id)).toEqual(['right','left']);
  // Deliberately asymmetric zero controls are valid; no geometric partner is guessed.
  const atZero=mirrorViewDrawing(zero,zero,pairOptions).drawing;for(const source of zero.curves)expect(shapeOf(atZero,source.id)).toEqual(shapeOf(zero,source.id));
 });

 test('absolute handles and endpoint-relative H−P deltas are equivalent',()=>{
  const zero=paired(),current=transformed(zero,([x,y],id)=>[x+(id==='left'?.8:.2),y+(id==='left'?-.5:.3)]),{drawing,correspondence}=mirrorViewDrawing(current,zero,pairOptions);
  for(const source of current.curves){const map=correspondence.curves[source.id],s0=shapeOf(zero,source.id),s=shapeOf(current,source.id),t0=shapeOf(zero,map.id),t=shapeOf(drawing,map.id);for(const end of [0,1] as const){const pi=end?3:0,hi=end?2:1,ti=map.reverse?3-pi:pi,th=map.reverse?3-hi:hi;point(t[th],[t[ti][0]+t0[th][0]-t0[ti][0]-((s[hi][0]-s[pi][0])-(s0[hi][0]-s0[pi][0])),t[ti][1]+t0[th][1]-t0[ti][1]+((s[hi][1]-s[pi][1])-(s0[hi][1]-s0[pi][1]))]);}}
 });

 test('source-only current presence maps to its zero counterpart without padding the missing half',()=>{
  const zero=paired(),current={...zero,nodes:zero.nodes.filter(node=>node.id.startsWith('l')),curves:zero.curves.filter(curve=>curve.id==='left'),layers:zero.layers.filter(layer=>layer.id==='left-layer')};
  const result=mirrorViewDrawing(current,zero,pairOptions);expect(result.drawing.curves.map(curve=>curve.id)).toEqual(['right']);expect(result.drawing.nodes.map(node=>node.id)).toEqual(['r0','r1']);expect(result.drawing.layers.map(layer=>layer.id)).toEqual(['right-layer']);expect(shapeOf(result.drawing,'right')).toEqual(shapeOf(zero,'right'));
 });

 test('one continuous unpaired profile shares one supplied zero reference and permits an orientation change at zero',()=>{
  const zero=unpaired(),current=transformed(zero,([x,y])=>[x-.7,y+.2]),plusZero=mirrorViewDrawing(zero,zero,unpairedOptions).drawing,{drawing}=mirrorViewDrawing(current,zero,unpairedOptions);
  for(const source of zero.curves)shapeOf(zero,source.id).forEach((p,i)=>point(shapeOf(plusZero,source.id)[i],[10-p[0],p[1]]));
  for(const source of current.curves)shapeOf(current,source.id).forEach((p,i)=>point(shapeOf(drawing,source.id)[i],[10-p[0],p[1]]));
  expect(drawing.nodes).toHaveLength(3);expect(drawing.curves.map(curve=>curve.nodes)).toEqual(zero.curves.map(curve=>curve.nodes));expect(plusZero.curves[0].handles).not.toEqual(zero.curves[0].handles);
 });

 test('different disconnected profiles retain different explicit local zero references',()=>{
  const zero=unpaired(),other=transformed(unpaired(),([x,y])=>[x+20,y-3]);
  other.nodes=other.nodes.map(node=>({...node,id:`other-${node.id}`}));other.curves=other.curves.map(curve=>({...curve,id:`other-${curve.id}`,nodes:curve.nodes.map(id=>`other-${id}`) as [string,string]}));other.layers=[{...other.layers[0],id:'other-layer',items:other.curves.map(curve=>curve.id)}];
  const input={...zero,nodes:[...zero.nodes,...other.nodes],curves:[...zero.curves,...other.curves],layers:[...zero.layers,...other.layers]},options={curvePairs:[],unpairedGroups:[...unpairedOptions.unpairedGroups!,{curveIds:['other-a','other-b'],reference:[25,-2] as Point2}]};
  const {drawing}=mirrorViewDrawing(input,input,options);for(const source of input.curves)shapeOf(input,source.id).forEach((p,i)=>point(shapeOf(drawing,source.id)[i],[(source.id.startsWith('other-')?50:10)-p[0],p[1]]));
 });

 test('collapsed width at an off-global-axis zero is identical on both zero sides and needs no division or smoothing',()=>{
  const zero=transformed(unpaired(),([,y])=>[.73,y]),options={...unpairedOptions,unpairedGroups:[{curveIds:['a','b'],reference:[.73,0] as Point2}]};
  expect(mirrorViewDrawing(zero,zero,options).drawing.nodes).toEqual(zero.nodes);expect(mirrorViewDrawing(zero,zero,options).drawing.curves).toEqual(zero.curves);
  for(const width of [-.3,0,.6]){const current=transformed(unpaired(),([x,y])=>[.73+width*(x-5),y]);for(const curve of current.curves)shapeOf(current,curve.id).forEach((p,i)=>point(shapeOf(mirrorViewDrawing(current,zero,options).drawing,curve.id)[i],[1.46-p[0],p[1]]));}
 });

 test('an unpaired shared-node branch follows explicit paired node authority with relative handles',()=>{
  const zero=paired();zero.nodes.push({id:'tip',position:[2.4,3.2]});zero.curves.push(curve('detail',['l1','tip'],[[2.1,3.4],[2.3,3.3]]));zero.layers[0].items.push('detail');
  const options={...pairOptions,unpairedGroups:[{curveIds:['detail'],reference:[2,0] as Point2}]},current=transformed(zero,([x,y])=>[x+.2,y-.1]),{drawing}=mirrorViewDrawing(current,zero,options);
  const detail=drawing.curves.find(curve=>curve.id==='detail')!;expect(detail.nodes).toEqual(['r1','tip']);expect(drawing.nodes.filter(node=>node.id==='r1')).toHaveLength(1);const p=drawing.nodes.find(node=>node.id==='r1')!.position;point(detail.handles[0],[p[0]-.1,p[1]+.4]);
 });

 test('EndpointLinks preserve distinct node identities while an unpaired follower uses the pair baseline once',()=>{
  const zero=paired();zero.nodes.push({id:'linked',position:[2,3]},{id:'tip',position:[2.4,3.2]});zero.curves.push(curve('detail',['linked','tip'],[[2.1,3.4],[2.3,3.3]]));zero.layers[0].items.push('detail');zero.endpointLinks=[{id:'link',a:{curveId:'left',end:1},b:{curveId:'detail',end:0}}];
  const options={...pairOptions,unpairedGroups:[{curveIds:['detail'],reference:[2,0] as Point2}]},{drawing}=mirrorViewDrawing(transformed(zero,([x,y])=>[x+.2,y-.1]),zero,options),nodes=new Map(drawing.nodes.map(node=>[node.id,node.position]));
  expect(drawing.endpointLinks).toEqual([{id:'link',a:{curveId:'right',end:0},b:{curveId:'detail',end:0}}]);expect(nodes.get('linked')).toEqual(nodes.get('r1'));expect(drawing.curves.find(curve=>curve.id==='detail')!.nodes[0]).toBe('linked');
 });

 test('missing zero IDs fail with actionable diagnostics without guessing a global axis',()=>{
  const current=unpaired(),zero={...current,nodes:current.nodes.filter(node=>node.id!=='p1')},before=JSON.stringify([current,zero]);
  try{mirrorViewDrawing(current,zero,unpairedOptions);throw Error('Expected missing baseline failure');}catch(error){expect(error).toBeInstanceOf(ViewMirrorError);expect((error as ViewMirrorError).diagnostics).toEqual([expect.objectContaining({code:'MISSING_ZERO_ENTITY',entityKind:'nodes',entityId:'p1'})]);}
  expect(JSON.stringify([current,zero])).toBe(before);expect(()=>mirrorViewDrawing(current,current,{curvePairs:[]})).toThrow('explicit shared local-zero group reference');
 });

 test('per-segment reference conflicts are rejected for a continuous profile',()=>{
  const zero=unpaired();expect(()=>mirrorViewDrawing(zero,zero,{curvePairs:[],unpairedGroups:[{curveIds:['a'],reference:[4,0]},{curveIds:['b'],reference:[6,0]}]})).toThrow('cannot use different local-zero references');
 });

 test.each([1.7,0])('existing ARC, fill, route and affine material mapping survives local-zero reflection at x scale %s',scaleX=>{
  const original=parseDrawing(JSON.parse(readFileSync(new URL('../../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),'utf8'))),zero=transformed(original,([x,y])=>[x+1.25,y-.4]),place=([x,y]:Point2):Point2=>[scaleX*x+2,.8*y+.1],current=transformed(original,place);
  registerEvaluatedAffine(current,original,()=>({point:place,maxScale:Math.max(scaleX,.8)}));
  const pairs=original.mirrorEditing!.curvePairs,pairedIds=new Set(pairs.flatMap(pair=>[pair.a,pair.b])),options={curvePairs:pairs,unpairedGroups:[{curveIds:current.curves.filter(curve=>!pairedIds.has(curve.id)).map(curve=>curve.id),reference:[original.mirrorAxisX!+1.25,0] as Point2}]};
  const result=mirrorViewDrawing(current,zero,options),absolute=mirrorSnapshotDrawing(current,{axisX:original.mirrorAxisX!+1.25,curvePairs:pairs});
  expect(result.drawing.fills).toEqual(absolute.drawing.fills);expect(result.drawing.displayIntervals).toEqual(absolute.drawing.displayIntervals);expect(result.drawing.layers).toEqual(absolute.drawing.layers);expect(result.drawing.endpointLinks).toEqual(absolute.drawing.endpointLinks);expect(evaluatedAffine(result.drawing,result.drawing.curves[0].id)).toBeDefined();
  let arcs=0;
  for(const layer of current.layers)for(const stroke of strokes(current,layer.id))for(const path of strokePaths(stroke)){
   const uses=path.segments.map(use=>({id:result.correspondence.curves[use.id].id,reverse:use.reverse!==result.correspondence.curves[use.id].reverse})),before=derivedUses(absolute.drawing,uses,path.closed),after=derivedUses(result.drawing,uses,path.closed);
   arcs+=after.pieces.filter(piece=>piece.joinId).length;expect(after.shapes).toHaveLength(before.shapes.length);before.shapes.forEach((shape,i)=>shape.forEach((p,j)=>point(after.shapes[i][j],p)));
  }
  for(const track of result.drawing.displayIntervals??[])if(track.displayRoute){const before=createDisplayRouteField(absolute.drawing,track.displayRoute),after=createDisplayRouteField(result.drawing,track.displayRoute);expect(after.diagnostics).toEqual([]);arcs+=after.geometry.pieces.filter(piece=>piece.joinId).length;expect(after.geometry.shapes).toHaveLength(before.geometry.shapes.length);before.geometry.shapes.forEach((shape,i)=>shape.forEach((p,j)=>point(after.geometry.shapes[i][j],p)));}
  expect(arcs).toBeGreaterThan(0);
 });

 test('nonuniform zero corrections with deferred material fail explicitly instead of rebuilding a different ARC',()=>{
  const zero=paired(),current=transformed(zero,p=>[...p]);registerEvaluatedAffine(current,zero,()=>({point:p=>p,maxScale:1}));
  expect(()=>mirrorViewDrawing(current,zero,pairOptions)).toThrow('nonuniform zero-baseline correction');
 });
});
