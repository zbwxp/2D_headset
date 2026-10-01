import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {test,expect} from 'vitest';
import {moveNode,moveHandle,transform} from '../domain/drawing/commands';
import {parseDrawing,curveById,nodeAt,shapeOf,add,sub,mul,type Point2,type Cubic,type DrawingDocument} from '../domain/drawing/model';
import {applyMirrorEditing,validateMirrorEditing,constrainMirrorNodePosition,mirrorWritesForCurves,type MirrorDrawing,type MirrorEditingConfig} from '../domain/drawing/mirrorEditing';

const raw=readFileSync(new URL('../assets/hairless-symmetric-two-face.json',import.meta.url),'utf8');
const recipe=JSON.parse(readFileSync(new URL('../../docs/examples/two-face-mirror-editing-setup.json',import.meta.url),'utf8')) as {source:{sha256:string;mirrorAxisX:number};config:MirrorEditingConfig;validation:{pairCount:number;coveredCurveCount:number;excludedCurveIds:string[];scopePairCounts:Record<string,number>;maxControlReflectionError:number}};
const source=()=>({...parseDrawing(JSON.parse(raw)),mirrorEditing:structuredClone(recipe.config)}) as MirrorDrawing;
const pairIds=new Set(recipe.config.curvePairs.flatMap(p=>[p.a,p.b]));
const base=source(),excludedShapes=new Map(recipe.validation.excludedCurveIds.map(id=>[id,shapeOf(base,id)]));
const appearance=(d:DrawingDocument)=>({...d,nodes:undefined,curves:d.curves.map(({handles:_,nodes:__,...c})=>c)});
const bezier=(s:Cubic,t:number):Point2=>{const u=1-t,w=[u*u*u,3*u*u*t,3*u*t*t,t*t*t];return [s.reduce((x,p,i)=>x+p[0]*w[i],0),s.reduce((x,p,i)=>x+p[1]*w[i],0)];};
function verified(d:DrawingDocument){
 expect(validateMirrorEditing(d)).toMatchObject({enabled:true,pairCount:54});
 for(const id of recipe.validation.excludedCurveIds)expect(shapeOf(d,id)).toEqual(excludedShapes.get(id));
}

test('actual two-face recipe pins source checksum, 54 explicit pairs, 107 curves and seven named axial nodes',()=>{
 const d=source(),before=JSON.stringify(d);expect(createHash('sha256').update(raw).digest('hex')).toBe(recipe.source.sha256);expect(d.mirrorAxisX).toBe(-.3294804514288924);
 expect(recipe.validation.scopePairCounts).toEqual({face:3,eyelids:12,eyeInterior:20,brows:1,ears:16,mouth:1,nose:1});
 expect(pairIds.size).toBe(107);expect(recipe.validation.excludedCurveIds).toHaveLength(14);expect(recipe.config.axisNodeIds).toHaveLength(7);expect(validateMirrorEditing(d).axisNodeIds).toHaveLength(7);
 expect(recipe.config.curvePairs.filter(p=>p.reverse)).toHaveLength(1);expect(recipe.config.curvePairs.filter(p=>p.a===p.b)).toHaveLength(1);
 expect(recipe.validation.maxControlReflectionError).toBeLessThan(1e-15);expect(JSON.stringify(d)).toBe(before);
 const jaw=curveById(d,'1a723ec7-9bbe-4c56-8c0f-680d03741aa6');expect(jaw.depthOffset).toBe(1);expect(jaw.depthScope).toBe('LAYER');
});

test('every covered node can drive a valid constrained move; excluded collar, paint/depth and input source stay unchanged',()=>{
 const d=source(),before=JSON.stringify(d),ids=new Set(d.curves.filter(c=>pairIds.has(c.id)).flatMap(c=>c.nodes));
 for(const id of ids){
  const original=d.nodes.find(n=>n.id===id)!.position,target=constrainMirrorNodePosition(d,id,add(original,[.002,.003]));
  try{const raw=moveNode(d,id,target,true),n=applyMirrorEditing(d,raw,{nodes:[{nodeId:id,position:target}]});verified(n);expect(appearance(n)).toEqual(appearance(d));}
  catch(error){throw new Error(`Node matrix ${id}: ${(error as Error).message}`);}
 }
 expect(ids.size).toBe(123);expect(JSON.stringify(d)).toBe(before);
});

test('all 214 source handles can drive radial edits on either side, including mouth reversal and nose self-pair',()=>{
 const d=source(),before=JSON.stringify(d);
 for(const id of pairIds)for(const end of [0,1] as const){
  const origin=nodeAt(d,{curveId:id,end}).position,target=add(origin,mul(sub(curveById(d,id).handles[end],origin),1.025));
  try{const raw=moveHandle(d,{curveId:id,end},target,true),n=applyMirrorEditing(d,raw,{handles:[{curveId:id,end,position:target}]});verified(n);expect(appearance(n)).toEqual(appearance(d));}
  catch(error){throw new Error(`Handle matrix ${id}:${end}: ${(error as Error).message}`);}
 }
 expect(JSON.stringify(d)).toBe(before);
});

test('all 107 covered source cubics support selected-side axis-compatible affine edits with explicit driver controls',()=>{
 const d=source(),before=JSON.stringify(d),axis=d.mirrorAxisX!;
 for(const id of pairIds){
  try{const raw=transform(d,[id],([x,y])=>[axis+(x-axis)*1.004,y*1.003+.001],true,true),n=applyMirrorEditing(d,raw,mirrorWritesForCurves(raw,[id]));verified(n);expect(appearance(n)).toEqual(appearance(d));}
  catch(error){throw new Error(`Curve transform matrix ${id}: ${(error as Error).message}`);}
 }
 expect(JSON.stringify(d)).toBe(before);
});

test('independent dense cubic samples confirm final reflected geometry and preserve authored jaw depth',()=>{
 const d=source(),id='65450d8d-7c62-4d87-b421-616dfbcab097',end=0 as const,h=add(curveById(d,id).handles[end],[-.016,.013]);
 const n=applyMirrorEditing(d,moveHandle(d,{curveId:id,end},h),{handles:[{curveId:id,end,position:h}]});
 for(const p of recipe.config.curvePairs)for(let i=0;i<=100;i++){
  const a=bezier(shapeOf(n,p.a),i/100),b=bezier(shapeOf(n,p.b),p.reverse?1-i/100:i/100);expect(Math.hypot(2*d.mirrorAxisX!-a[0]-b[0],a[1]-b[1])).toBeLessThan(2e-14);
 }
 expect(curveById(n,'1a723ec7-9bbe-4c56-8c0f-680d03741aa6').depthOffset).toBe(1);expect(n.fills).toEqual(d.fills);
});
