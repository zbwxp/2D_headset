import {test,expect} from 'vitest';
import {ensureScaffold,HELMET_LOOP,RING_Y,RIM_R,SIDE_R,systemId} from '../domain/head/scaffold';
import {helmetLoopParts} from '../domain/head/helmetLoop';
import {isHelmetLoop,isSection} from '../domain/curves/model';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,toRelative,mirrorPoint} from '../domain/head/frame';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {closedBoundary,boundaryGeometry,eligibleAnchors,mirrorBoundary} from '../domain/patches/boundary';
import {addOnCurvePoint,setOnCurveS,validatePlacements} from '../domain/landmarks/placement';
import {createCurve} from '../domain/curves/management';
import {addPatch,addLoopPatch} from '../domain/patches/model';
import {evaluator,tessellate} from '../domain/patches/geometry';
import {duplicateRing} from '../domain/head/duplicateRing';
import {curveMemberships} from '../domain/head/membership';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {dependencyGraph,dirtyDescendants} from '../domain/geometry/dependencies';
import {boundaryIntervals,helmetBoundaryIntervals,exposedIntervals} from '../domain/contour/boundaries';
import {toggleLoomisLock,blockedLoomisEdit,isLoomisLocked} from '../domain/head/locks';
import {readFileSync} from 'node:fs';
const base=()=>ensureScaffold(migrateHeadFrame(createLandmarkProject()));
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
const unit=(v:number[])=>v.map(n=>n/Math.hypot(...v));

test('level rim loop stays on the helmet with G1 joins under height, tilt and roundness edits',()=>{
 for(const h of [-.15,0,.2])for(const sideTilt of [-20,0,25])for(const roundness of [0,.5,1]){
  const b=base(),p=ensureScaffold({...b,loomisScaffold:{...b.loomisScaffold!,horizontalOffset:h,sideTilt,roundness}}),ctx=evaluationContext(p),g=ctx.curve(HELMET_LOOP),loop=p.curves.find(c=>c.id===HELMET_LOOP)!;
  expect(isHelmetLoop(loop)).toBe(true);if(!isHelmetLoop(loop))throw Error();
  expect(g.closed).toBe(true);expect(g.evaluate(0)).toEqual(g.evaluate(1));
  for(const part of helmetLoopParts(p,loop)){
   for(const fraction of [0,.2,.5,.8,1]){
    const t=part.lo+(part.hi-part.lo)*fraction,q=g.evaluate(t),source=ctx.curve(part.curveId).evaluate(part.t0+(part.t1-part.t0)*fraction);
    expect(distance(q,source)).toBeLessThan(1e-10);expect(toRelative(p,q)[1]).toBeCloseTo(h,10);
   }
   const a=unit(g.derivative(part.hi-1e-7)),z=unit(g.derivative(part.hi+1e-7));expect(distance(a,z)).toBeLessThan(2e-4);
  }
  for(let i=0;i<32;i++)expect(distance(g.atArcLength((1-i/32)%1),mirrorPoint(p,g.atArcLength(i/32)))).toBeLessThan(1e-8);
  expect(ctx.curve(SIDE_R).closed).toBe(true);
 }
});

test('existing system intersections and rim points are legal loop anchors without new landmarks',()=>{
 let p=base();const ids=[100,101,107,109,111,113].map(systemId);
 expect(eligibleAnchors(p,HELMET_LOOP).map(l=>l.id).sort()).toEqual(ids.sort());
 for(const id of ids){const m=curveMemberships(p,id).find(m=>m.curveId===HELMET_LOOP)!;expect(distance(evaluationContext(p).curve(HELMET_LOOP).evaluate(m.t),pointPosition(p,id))).toBeLessThan(1e-10);}
 const rimPoint=addOnCurvePoint(p,RIM_R);p=rimPoint.project;
 expect(eligibleAnchors(p,HELMET_LOOP).some(l=>l.id===rimPoint.selectedId)).toBe(true);
 const onLoop=addOnCurvePoint(p,HELMET_LOOP);p=setOnCurveS(onLoop.project,onLoop.selectedId,.12);validatePlacements(p);
 const q=p.landmarks.find(l=>l.id===onLoop.selectedId)!,left=p.landmarks.find(l=>l.id===q.mirrorPartnerId)!;
 expect(pointPosition(p,left.id)).toEqual(mirrorPoint(p,pointPosition(p,q.id)));
 const next=ensureScaffold({...p,loomisScaffold:{...p.loomisScaffold!,horizontalOffset:.1,sideTilt:15}});
 expect(next.landmarks.find(l=>l.id===q.id)!.placement).toEqual(q.placement);expect(pointPosition(next,q.id)).not.toEqual(pointPosition(p,q.id));
 expect(dirtyDescendants(p,next).curves.has(HELMET_LOOP)).toBe(true);dependencyGraph(next);
});

test('one loop span can cross ring/rim joins and form a mirrored Patch with Free curves',()=>{
 let p=base();const a=systemId(100),b=systemId(109),neck=systemId(103);
 const span={curveId:HELMET_LOOP,startLandmarkId:a,endLandmarkId:b},g=boundaryGeometry(p,span),mirror=boundaryGeometry(p,mirrorBoundary(p,span));
 for(let i=0;i<=20;i++)expect(distance(mirror.evaluate(i/20),mirrorPoint(p,g.evaluate(i/20)))).toBeLessThan(1e-9);
 const c=createCurve(p,a,neck,p.views[0],'front');p=c.project;const d=createCurve(p,neck,b,p.views[0],'back');p=d.project;
 p=addPatch(p,[span,c.selectedId,d.selectedId]);expect(p.patches).toHaveLength(2);
 for(const patch of p.patches!){expect(evaluator(p,patch)(.25,.3).every(Number.isFinite)).toBe(true);expect(tessellate(p,patch,8).vertices.flat().every(Number.isFinite)).toBe(true);}
 const reloaded=parseLandmarks(JSON.stringify(p));expect(reloaded.patches).toEqual(p.patches);expect(reloaded.curves.find(c=>c.id===HELMET_LOOP)).toEqual(p.curves.find(c=>c.id===HELMET_LOOP));
});

test('whole loop supports annular Patch; aliasing retains Helmet open-edge identity',()=>{
 let p=base();const copy=duplicateRing(p,RING_Y);p={...copy.project,curves:copy.project.curves.map(c=>c.id===copy.selectedId&&isSection(c)&&c.role==='canonical'?{...c,section:{...c.section,planeOffset:-.4}}:c)};
 p=addLoopPatch(p,[closedBoundary(p,HELMET_LOOP),closedBoundary(p,copy.selectedId)]);expect(p.patches).toHaveLength(1);
 const mesh=tessellate(p,p.patches![0],12);expect(mesh.vertices.flat().every(Number.isFinite)).toBe(true);expect(mesh.triangles.length).toBeGreaterThan(100);
 const intervals=boundaryIntervals(p,p.patches![0].id,closedBoundary(p,HELMET_LOOP));
 expect(exposedIntervals([...helmetBoundaryIntervals(p),...intervals])).toEqual([]);
 expect(parseLandmarks(JSON.stringify(p)).patches).toEqual(p.patches);
});

test('legacy sag is removed without recreating original rings, landmarks or rim IDs',()=>{
 const p=base(),legacy={...p,curves:p.curves.filter(c=>c.id!==HELMET_LOOP),loomisScaffold:{...p.loomisScaffold!,rimSag:.4}},next=ensureScaffold(legacy);
 expect(next.loomisScaffold!.rimSag).toBe(0);expect(next.landmarks).toEqual(p.landmarks);expect(next.curves).toEqual(p.curves);
});

test('legacy sagged project transports dependent planar curves and keeps hosted s/topology',()=>{
 const legacy=JSON.parse(readFileSync('tests/fixtures/continuity-overlap-head.json','utf8')),loaded=parseLandmarks(JSON.stringify(legacy));
 expect(legacy.loomisScaffold.rimSag).toBeGreaterThan(0);expect(loaded.loomisScaffold!.rimSag).toBe(0);
 for(const l of loaded.landmarks.filter(l=>l.placement.kind==='ON_CURVE'))expect(l.placement).toEqual(legacy.landmarks.find((old:{id:string})=>old.id===l.id).placement);
 expect(loaded.patches).toEqual(legacy.patches);expect(parseLandmarks(JSON.stringify(loaded)).curves).toEqual(loaded.curves);
 expect(loaded.curves.filter(c=>c.id!==HELMET_LOOP).map(c=>c.id)).toEqual(legacy.curves.map((c:{id:string})=>c.id));
});

test('logical lower boundary participates in construction locking, including source changes',()=>{
 const p=toggleLoomisLock(base(),HELMET_LOOP),next=ensureScaffold({...p,loomisScaffold:{...p.loomisScaffold!,roundness:.8}});
 expect(isLoomisLocked(p,HELMET_LOOP)).toBe(true);expect(blockedLoomisEdit(p,next)).toBe(HELMET_LOOP);
 expect(parseLandmarks(JSON.stringify(p)).loomisLocks).toContain(HELMET_LOOP);
 expect(blockedLoomisEdit(toggleLoomisLock(p,HELMET_LOOP),next)).toBeNull();
});
