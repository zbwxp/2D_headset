import {test,expect} from 'vitest';
import data from './fixtures/chin-point-head.json';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {chinArm,chinField,chinAttachments,chinSourceProject} from '../domain/chin/junction';
import {pointId} from '../domain/chin/model';
import {chinSurfaces} from '../domain/chin/geometry';
import {evaluator,tessellate} from '../domain/patches/geometry';
import {boundaryGeometry} from '../domain/patches/boundary';
import {domainBoundaries,boundaryToDomain} from '../domain/patches/domain';
import {dependencyGraph} from '../domain/geometry/dependencies';
import {sub,dot,cross} from '../domain/geometry/core';
import {mirrorPoint} from '../domain/head/frame';
const len=(a:number[])=>Math.hypot(...a);
const load=()=>parseLandmarks(JSON.stringify(data));
test('actual save replaces cap topology with one point and retains the authored jaw faces',()=>{
 const p=load();expect(()=>dependencyGraph(p)).not.toThrow();expect(p.chinScaffold?.version).toBe(3);
 expect(chinSurfaces(p)).toEqual([]);expect(p.curves.filter(c=>'geometryType'in c&&c.geometryType==='CHIN_SEAM')).toHaveLength(0);
 expect(p.landmarks.filter(l=>l.systemRole?.startsWith('CHIN'))).toHaveLength(1);
 expect(chinAttachments(p)).toHaveLength(5);expect(p.patches).toHaveLength(data.patches.length);
 expect(p.patches!.filter(x=>x.name==='下颌面').every(x=>x.type==='tri'&&x.boundaryUses.length===3)).toBe(true);
 const q=parseLandmarks(JSON.stringify(p));expect(q.chinScaffold).toEqual(p.chinScaffold);expect(q.curves).toEqual(p.curves);expect(q.patches).toEqual(p.patches);
});
test('all incident curves share the point and tangent plane, mirrored exactly, with compact influence',()=>{
 const p=load(),ctx=evaluationContext(p),field=chinField(p),C=pointPosition(p,pointId('CHIN_M'));
 
 for(const a of chinAttachments(p)){
  const g=ctx.curve(a.curveId),raw=evaluationContext(chinSourceProject(p)).curve(a.curveId),t=a.endpoint==='START'?0:1;
  expect(len(sub(g.evaluate(t),C))).toBeLessThan(1e-12);
  expect(Math.abs(dot(g.derivative(t),field.normal))/len(g.derivative(t))).toBeLessThan(.001);
  for(const u of [.1,.3,.5,.7,.9])if(field.weight(raw.evaluate(u))===0)expect(g.evaluate(u)).toEqual(raw.evaluate(u));
  const c=p.curves.find(c=>c.id===a.curveId)!;if(c.role==='mirror'){const f=ctx.curve(c.canonicalCurveId);for(const t of [0,.2,.9,.99,1])expect(len(sub(g.evaluate(t),mirrorPoint(p,f.evaluate(t))))).toBeLessThan(1e-12);}
 }
});
test('jaw boundary remains exactly on incoming curves, with a smooth common center and no cap',()=>{
 const p=load(),field=chinField(p);
 for(const x of p.patches!.filter(x=>x.name==='下颌面')){
  const f=evaluator(p,x),ring=domainBoundaries(p,x);
  for(let i=0;i<ring.length;i++){const g=boundaryGeometry(p,ring[i]);for(let j=0;j<=60;j++){const t=j/60;expect(len(sub(f(...boundaryToDomain(x.type,i,t)),g.evaluate(t)))).toBeLessThan(1e-8);}}
  const corner=ring.findIndex(b=>b.startLandmarkId===pointId('CHIN_M')),uv=boundaryToDomain(x.type,corner,0),h=1e-5;
  const weights=[1-uv[0]-uv[1],uv[0],uv[1]];
  const at=(a:number,b:number)=>{const l=weights.map(v=>v*(1-a-b));l[(corner+1)%3]+=a;l[(corner+2)%3]+=b;return f(l[1],l[2]);};
  const n=cross(sub(at(2*h,h),at(h,h)),sub(at(h,2*h),at(h,h)));
  expect(Math.abs(dot(n,field.normal))/len(n)).toBeGreaterThan(.999);
  const mesh=tessellate(p,x,48);expect(mesh.invalid).toBeUndefined();
 }
});

import {ensureChin,defaultRanges} from '../domain/chin/model';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame} from '../domain/head/frame';
import type {Vec3} from '../domain/project/types';
import type {LandmarkProject} from '../domain/landmarks/model';
import {add,scale} from '../domain/geometry/core';
function sixWay(range=.08){
 let p=ensureChin(migrateHeadFrame(createLandmarkProject()));
 const C=pointPosition(p,pointId('CHIN_M')),ids=Array.from({length:6},()=>crypto.randomUUID()),rays=ids.map(()=>crypto.randomUUID()),ring=ids.map(()=>crypto.randomUUID());
 const angles=[90,30,-30,-90,-150,150].map(a=>a*Math.PI/180),positions=angles.map(t=>add(C,[.3*Math.cos(t),.07,.3*Math.sin(t)] as Vec3));
 const arms=['UP','UPPER_PAIR','LOWER_PAIR','DOWN','LOWER_PAIR','UPPER_PAIR'] as const;
 p={...p,chinScaffold:{...p.chinScaffold!,ranges:{UP:range,DOWN:range,UPPER_PAIR:range,LOWER_PAIR:range},arms:Object.fromEntries(rays.map((id,i)=>[id,arms[i]]))},landmarks:[...p.landmarks,...ids.map((id,i)=>({id,name:'outer '+i,type:'FREE' as const,viewLocks:{},placement:{kind:'WORLD' as const,position:positions[i]}}))],curves:[...p.curves,...rays.map((id,i)=>({id,name:'spoke '+i,role:'canonical' as const,startLandmarkId:pointId('CHIN_M'),endLandmarkId:ids[i],shape:{kind:'FREE_3D' as const,startHandleOffset:scale(sub(positions[i],C),.3),endHandleOffset:scale(sub(C,positions[i]),.3)}})),...ring.map((id,i)=>({id,name:'rim '+i,role:'canonical' as const,startLandmarkId:ids[i],endLandmarkId:ids[(i+1)%6],shape:{kind:'FREE_3D' as const,startHandleOffset:scale(sub(positions[(i+1)%6],positions[i]),1/3),endHandleOffset:scale(sub(positions[i],positions[(i+1)%6]),1/3)}}))],patches:ids.map((id,i)=>({id:crypto.randomUUID(),type:'tri' as const,boundaryUses:[{curveId:rays[i],startLandmarkId:pointId('CHIN_M'),endLandmarkId:id},{curveId:ring[i],startLandmarkId:id,endLandmarkId:ids[(i+1)%6]},{curveId:rays[(i+1)%6],startLandmarkId:ids[(i+1)%6],endLandmarkId:pointId('CHIN_M')}]}))};
 return {p,rays};
}
function chart(i:number,t:number,e:number):[number,number]{return [[(1-e)*t,e],[(1-e)*(1-t),(1-e)*t],[e,(1-e)*(1-t)]][i] as [number,number];}
test.each([.01,.08,.1])('six sectors have a common smooth graph and resolved mesh at %sR',range=>{
 const {p,rays}=sixWay(range),field=chinField(p),ctx=evaluationContext(p);
 expect(()=>dependencyGraph(p)).not.toThrow();
 for(const [a,b]of [[0,3],[1,4],[2,5]]){const A=ctx.curve(rays[a]).derivative(0),B=ctx.curve(rays[b]).derivative(0);expect(dot(A,B)/(len(A)*len(B))).toBeLessThan(-.999999);}
 for(const id of rays){
  const neighbors=p.patches!.filter(x=>x.boundaryUses.some(b=>b.curveId===id));expect(neighbors).toHaveLength(2);
  // Check normals along a segment inside the common graph, not just at its vertex.
  for(const t of [.002,.006,.01].map(t=>t*range/.08)){
   const normals=neighbors.map(x=>{const f=evaluator(p,x),bs=domainBoundaries(p,x),i=bs.findIndex(b=>b.curveId===id),s=bs[i].startLandmarkId===pointId('CHIN_M')?t:1-t,h=1e-6;return cross(ctx.curve(id).derivative(t),sub(f(...chart(i,s,h)),f(...chart(i,s,0))));});
   expect(Math.abs(dot(normals[0],normals[1]))/(len(normals[0])*len(normals[1]))).toBeGreaterThan(.999);
  }
 }
 for(const x of p.patches!){const mesh=tessellate(p,x,12);expect(mesh.invalid).toBeUndefined();const core=mesh.vertices.filter(v=>len(sub(v,field.center))<range*.3);expect(core.length).toBeGreaterThan(3);
  const orientations=mesh.triangles.filter(t=>t.every(i=>len(sub(mesh.vertices[i],field.center))<range*.3)).map(([a,b,c])=>dot(cross(sub(mesh.vertices[b],mesh.vertices[a]),sub(mesh.vertices[c],mesh.vertices[a])),field.normal));
  expect(orientations.length).toBeGreaterThan(1);expect(orientations.every(v=>v>0)||orientations.every(v=>v<0),JSON.stringify({range,id:x.id,min:Math.min(...orientations),max:Math.max(...orientations),count:orientations.length,ring:domainBoundaries(p,x),field:field.coefficients})).toBe(true);
 }
});

test('range changes preserve source data and create no material/contour-only geometry',()=>{
 const {p}=sixWay(),q={...p,chinScaffold:{...p.chinScaffold!,ranges:{...defaultRanges,UPPER_PAIR:.04}}};
 expect(q.curves).toBe(p.curves);expect(q.landmarks).toBe(p.landmarks);expect(chinSurfaces(q)).toEqual([]);
 const field=chinField(q);expect(Object.values(field.coefficients).every(Number.isFinite)).toBe(true);
});

import {normalizedArcLengthToT} from '../domain/geometry/bezier';
test('each curve returns C2 to its exact source at its arc-length influence cut',()=>{
 const p=load(),ctx=evaluationContext(p),raw=evaluationContext(chinSourceProject(p));
 for(const a of chinAttachments(p)){
  const g=ctx.curve(a.curveId),source=raw.curve(a.curveId),lut=source.arcLengthLUT(),L=lut.at(-1)!,start=a.endpoint==='START',range=p.chinScaffold!.ranges![chinArm(p,a.curveId)]*p.headFrame!.radiusX,cut=normalizedArcLengthToT(lut,start?Math.min(.4,range/L):1-Math.min(.4,range/L)),h=1e-7,inside=cut+(start?-h:h);
  expect(len(sub(g.evaluate(cut),source.evaluate(cut)))).toBeLessThan(1e-12);
  expect(len(sub(g.evaluate(inside),source.evaluate(inside)))).toBeLessThan(1e-9);
  expect(len(sub(g.derivative(inside),source.derivative(inside)))).toBeLessThan(1e-4);
 }
});
