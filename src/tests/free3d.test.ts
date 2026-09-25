import {describe,it,expect} from 'vitest';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {createCurve,deleteCurve} from '../domain/curves/management';
import {canonical,controls,handleShape,bodyShape,bezier,followEndpoints,viewPlaneTarget} from '../domain/curves/geometry';
import {isDerived,isFree3DShape,type Free3DShape} from '../domain/curves/model';
import {migrateFree3D,handleToLocal,handleToWorld} from '../domain/curves/free3d';
import {migrateHeadFrame,mirrorPoint,spatialPlacement,toHead} from '../domain/head/frame';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {add,sub,scale,dot,cross,basis} from '../domain/geometry/core';
import {addOnCurvePoint,setOnCurveS} from '../domain/landmarks/placement';
import {dirtyDescendants,dependencyGraph} from '../domain/geometry/dependencies';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addSmoothJoin,setJoinRadius} from '../domain/curves/smoothJoin/commands';
import {resolveJoin} from '../domain/curves/smoothJoin/geometry';
import {solveContinuity} from '../domain/continuity/solver';
import {installSmoothResult} from '../domain/continuity/evaluation';
import {evaluator,tessellate} from '../domain/patches/geometry';
import {smoothFixture} from './smooth-fixture';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {Vec3} from '../domain/project/types';
const near=(a:readonly number[],b:readonly number[],tol=1e-11)=>expect(Math.hypot(...a.map((x,i)=>x-b[i]))).toBeLessThan(tol);
const shape=(p:LandmarkProject,id:string)=>{const s=canonical(p,p.curves.find(c=>c.id===id)!).shape;if(!isFree3DShape(s))throw Error('Expected Free3D');return s;};
function fixture(){
 const p=migrateHeadFrame(createLandmarkProject()),id=(name:string)=>p.landmarks.find(l=>l.name===name)!.id;
 const made=createCurve(p,id('下巴尖点'),id('右外眼角点'),p.views[0],'Space');
 return {p:made.project,id:made.selectedId};
}
function edit(p:LandmarkProject,id:string,index:1|2,delta:Vec3){
 const c=canonical(p,p.curves.find(c=>c.id===id)!),s=handleShape(p,c,index,add(controls(p,c)[index],delta));
 return {...p,curves:p.curves.map(x=>x.id===id?{...c,shape:s}:x)};
}
describe('HeadSet Free3D source',()=>{
 it('creates straight local offsets then supports truly noncoplanar controls without clamping',()=>{
  let {p,id}=fixture();const c=p.curves.find(c=>c.id===id)!;
  expect(Object.keys(shape(p,id)).sort()).toEqual(['endHandleOffset','kind','startHandleOffset']);
  const initial=controls(p,c);near(initial[1],add(initial[0],scale(sub(initial[3],initial[0]),1/3)));
  p=edit(edit(p,id,1,[.3,.15,.2]),id,2,[-.2,.35,-.4]);const cp=controls(p,c);
  expect(Math.abs(dot(cross(sub(cp[1],cp[0]),sub(cp[2],cp[0])),sub(cp[3],cp[0])))).toBeGreaterThan(.01);
  const huge=edit(p,id,1,[2,3,-4]);near(controls(huge,c)[1],add(cp[1],[2,3,-4]));
  near(evaluationContext(p).curve(id).derivative(0),scale(sub(cp[1],cp[0]),3));
 });
 it('endpoint movement keeps local offsets and normalized ON_CURVE s, with downstream invalidation',()=>{
  let {p,id}=fixture();p=edit(p,id,1,[0,.2,.3]);const r=addOnCurvePoint(p,id);p=setOnCurveS(r.project,r.selectedId,.37);
  const c=p.curves.find(c=>c.id===id)!,before=controls(p,c),loc=p.landmarks.find(l=>l.id===r.selectedId)!;
  const next={...p,landmarks:p.landmarks.map(l=>l.id===c.endLandmarkId?{...l,placement:spatialPlacement(p,add(before[3],[.2,.1,-.3]))}:l)};
  const q=followEndpoints(p,next);expect(shape(q,id)).toBe(shape(p,id));near(controls(q,c)[1],before[1]);near(sub(controls(q,c)[2],controls(q,c)[3]),sub(before[2],before[3]));
  expect(q.landmarks.find(l=>l.id===loc.id)!.placement).toEqual(loc.placement);
  near(pointPosition(q,loc.id),evaluationContext(q).curve(id).atArcLength(.37));expect(pointPosition(q,loc.id)).not.toEqual(pointPosition(p,loc.id));
  expect(dirtyDescendants(p,q).points.has(loc.id)).toBe(true);expect(deleteCurve(q,id).landmarks.some(l=>l.id===loc.id)).toBe(false);
 });
 it('HeadFrame anisotropic scaling and rotation preserve source and exact reflected geometry',()=>{
  let {p,id}=fixture();p=edit(edit(p,id,1,[.1,.2,.3]),id,2,[-.2,.05,.1]);
  const q={...p,headFrame:{center:[2,-1,3] as Vec3,orientation:[0,Math.sin(.3),0,Math.cos(.3)] as [number,number,number,number],radiusX:2,radiusY:.8,radiusZ:1.5}};
  const c=q.curves.find(c=>c.id===id)!,cp=controls(q,c),reflected=controls(q,q.curves.find(x=>x.id===c.mirrorPartnerCurveId)!);
  cp.forEach((x,i)=>near(reflected[i],mirrorPoint(q,x)));expect(shape(q,id)).toBe(shape(p,id));near(sub(cp[1],cp[0]),handleToWorld(q,shape(q,id).startHandleOffset));
  near(handleToLocal(q,handleToWorld(q,[.2,.4,-.3])),[.2,.4,-.3]);
  // Offset depends on frame even when endpoints are WORLD placements.
  const w={...p,landmarks:p.landmarks.map(l=>({...l,placement:{kind:'WORLD' as const,position:pointPosition(p,l.id)}}))};
  expect(dirtyDescendants(w,{...w,headFrame:q.headFrame}).curves.has(id)).toBe(true);expect(dependencyGraph(q).dependencies.get(`curve:${id}`)).toContain('frame:head');
 });
 it('front/side/oblique drags preserve the unobservable depth, including mirror edits',()=>{
  let {p,id}=fixture();p=edit(p,id,1,[.1,.2,.3]);const c=p.curves.find(c=>c.id===id)!;
  for(const viewId of ['front','side','left30'])for(const selected of [c,p.curves.find(x=>x.id===c.mirrorPartnerCurveId)!]){
   const view=p.views.find(v=>v.id===viewId)!,a=viewPlaneTarget(p,selected,view,[0,0])!,b=viewPlaneTarget(p,selected,view,[.15,-.12])!,cp=controls(p,c);
   const s=handleShape(p,canonical(p,c),1,add(cp[1],sub(b,a))),q={...p,curves:p.curves.map(x=>x.id===id?{...canonical(p,c),shape:s}:x)};
   const delta=sub(controls(q,selected)[1],controls(p,selected)[1]),axes=basis(view);
   expect(dot(delta,axes.forward)).toBeCloseTo(0,12);expect(dot(delta,axes.right)).toBeCloseTo(.15,12);expect(dot(delta,axes.up)).toBeCloseTo(-.12,12);
  }
 });
 it('body drag solves the full 3D displacement and midline-only curves retain symmetry',()=>{
  const {p,id}=fixture(),c=canonical(p,p.curves.find(c=>c.id===id)!),cp=controls(p,c),target=add(bezier(cp,.4),[.2,-.1,.3]),s=bodyShape(p,c,.4,target),q={...p,curves:p.curves.map(x=>x.id===id?{...c,shape:s}:x)};
  near(bezier(controls(q,c),.4),target);near(controls(q,c)[0],cp[0]);near(controls(q,c)[3],cp[3]);
  const centers=p.landmarks.filter(l=>l.type==='CENTERLINE'),made=createCurve(p,centers[0].id,centers[1].id,p.views[0],'midline'),changed=edit(made.project,made.selectedId,1,[.5,.1,.2]);
  expect(shape(changed,made.selectedId).startHandleOffset[0]).toBe(0);
 });
 it('Save/Load is idempotent, rejects malformed offsets, and retains contour role',()=>{
  let {p,id}=fixture();p=edit(p,id,2,[.1,.2,.4]);p={...p,curves:p.curves.map(c=>({...c,contourRole:'OPEN_EDGE' as const}))};
  const q=parseLandmarks(JSON.stringify(p));expect(q.curves).toEqual(p.curves);expect(parseLandmarks(JSON.stringify(q)).curves).toEqual(q.curves);expect(q.version).toBe('landmarks-0.9.2');
  for(const invalid of [[0,1],['oops',0,1],null])expect(()=>parseLandmarks(JSON.stringify({...p,curves:p.curves.map(c=>c.id===id?{...c,shape:{...shape(p,id),startHandleOffset:invalid}}:c)}))).toThrow();
 });
 it('Curve Smooth Join accepts spatial cubics and leaves raw shape/radius semantics intact',()=>{
  let {p,id}=fixture();p=edit(edit(p,id,1,[.005,0,0]),id,2,[0,.03,.05]);const c=p.curves.find(c=>c.id===id)!;
  const q=addSmoothJoin(p,c.startLandmarkId!,{curveId:id,endpoint:'START'},{curveId:c.mirrorPartnerCurveId!,endpoint:'START'},.08),ctx=evaluationContext(q),j=q.curveSmoothJoins![0];
  expect(resolveJoin(q,j,id=>ctx.sourceCurve(id)).warning).toBeUndefined();expect(q.curves).toEqual(p.curves);
  const a=ctx.curve(id).derivative(0),b=ctx.curve(c.mirrorPartnerCurveId!).derivative(0);near(scale(a,1/Math.hypot(...a)),scale(b,-1/Math.hypot(...b)));
  const r=setJoinRadius(q,j.id,.15);expect(evaluationContext(r).curve(id).key).not.toBe(ctx.curve(id).key);
  expect(parseLandmarks(JSON.stringify(q)).curveSmoothJoins).toEqual(q.curveSmoothJoins);
 });
 it('migration keeps real source controls, hosted points, and unchanged Natural/Fullness surfaces',()=>{
  const raw=JSON.parse(readFileSync('src/tests/fixtures/smooth-safety-10.json','utf8')) as LandmarkProject,p=migrateHeadFrame(raw),q=migrateFree3D(p),a=evaluationContext(p),b=evaluationContext(q);
  let maxControl=0,maxPoint=0,maxSurface=0;
  for(const c of p.curves)if(!isDerived(c))a.sourceCurveControls(c.id).forEach((v,i)=>{maxControl=Math.max(maxControl,Math.hypot(...sub(v,b.sourceCurveControls(c.id)[i])));});
  for(const l of p.landmarks)maxPoint=Math.max(maxPoint,Math.hypot(...sub(a.pointPosition(l.id),b.pointPosition(l.id))));
  for(const x of p.patches??[])for(const [u,v] of [[.15,.2],[.3,.4],[.5,.2]])maxSurface=Math.max(maxSurface,Math.hypot(...sub(evaluator(p,x)(u,v),evaluator(q,x)(u,v))));
  expect(maxControl).toBeLessThan(1e-12);expect(maxPoint).toBeLessThan(1e-11);expect(maxSurface).toBeLessThan(1e-10);
  expect(q.patches).toBe(p.patches);expect(q.surfaceContinuity).toBe(p.surfaceContinuity);expect(q.curveSmoothJoins).toBe(p.curveSmoothJoins);
  mkdirSync('artifacts/free3d',{recursive:true});writeFileSync('artifacts/free3d/migration.json',JSON.stringify({maxControl,maxPoint,maxSurface,curves:p.curves.length,points:p.landmarks.length,patches:p.patches?.length},null,2));
 });
 it('unchanged Surface Smooth + Fullness solve on the new source, preserving boundaries',()=>{
  const p=smoothFixture(.3),q=migrateFree3D(p);for(const x of q.patches!)x.fullness=.2;
  const result=solveContinuity(q);installSmoothResult(q,result);
  expect(Object.values(result.patches).some(x=>x.field)).toBe(true);
  for(const patch of q.patches!){expect(tessellate(q,patch).invalid).toBeUndefined();expect(evaluator(q,patch)(.5,.5).every(Number.isFinite)).toBe(true);}
 });
 it('migration leaves Eyes-owned legacy source, CONTROL_POINTS, scaffold and gaze untouched',()=>{
  let {p,id}=fixture();const c=canonical(p,p.curves.find(c=>c.id===id)!);
  p={...p,geometryModules:{[id]:'EYES'},curves:p.curves.map(x=>x.id===id?{...c,shape:{planeNormal:[0,0,1] as Vec3,startHandle:{along:.3,offset:.1},endHandle:{along:.3,offset:0}}}:x)};
  const q=migrateFree3D(p);expect(q.curves).toEqual(p.curves);expect(q.curves[0]).toBe(p.curves[0]);
 });
});
