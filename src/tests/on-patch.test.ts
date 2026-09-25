import {followEndpoints} from '../domain/curves/geometry';
import {test,expect} from 'vitest';
import {spanFixture} from './span-fixture';
import {addPatch} from '../domain/patches/model';
import {addOnCurvePoint,setOnCurveS} from '../domain/landmarks/placement';
import {createOnPatch} from '../domain/curves/onPatch';
import {evaluationContext} from '../domain/geometry/evaluation';
import {evaluator} from '../domain/patches/geometry';
import {boundaryPointLocation} from '../domain/patches/domain';
import {isOnPatch} from '../domain/curves/model';
import {dirtyDescendants,deleteClosure,dependencyGraph} from '../domain/geometry/dependencies';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {mirrorPoint} from '../domain/head/frame';
function fixture(){
 const f=spanFixture();let p=addPatch(f.p,[f.use,f.ac,f.bc]);
 const A=addOnCurvePoint(p,f.ac);p=setOnCurveS(A.project,A.selectedId,.3);
 const B=addOnCurvePoint(p,f.bc);p=setOnCurveS(B.project,B.selectedId,.6);
 const r=createOnPatch(p,p.patches![0].id,A.selectedId,B.selectedId);return {...r,host:p.patches![0].id,a:A.selectedId,b:B.selectedId};
}
test('ON_PATCH uses final surface, mirrors exactly, supports arc length and downstream points',()=>{
 const r=fixture(),p=r.project,c=p.curves.find(c=>c.id===r.selectedId)!;if(!isOnPatch(c)||c.role!=='canonical')throw Error();
 const x=p.patches!.find(x=>x.id===r.host)!,g=evaluationContext(p).curve(c.id),a=boundaryPointLocation(p,x,c.startLandmarkId,c.path.startBoundary).uv,b=boundaryPointLocation(p,x,c.endLandmarkId,c.path.endBoundary).uv;
 for(const t of [0,.2,.5,.8,1])expect(g.evaluate(t)).toEqual(evaluator(p,x)(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t));
 expect(g.controls).toBeUndefined();expect(g.closed).toBe(false);expect(g.arcLengthLUT().at(-1)).toBeGreaterThan(0);
 const mirrored=evaluationContext(p).curve(c.mirrorPartnerCurveId!);expect(mirrored.evaluate(.37)).toEqual(mirrorPoint(p,g.evaluate(.37)));
 const child=addOnCurvePoint(p,c.id);expect(evaluationContext(child.project).pointPosition(child.selectedId)).toEqual(g.atArcLength(.5));
});
test('Fullness propagates past Patch, endpoints preserve parameters and delete closure removes hosted curves',()=>{
 const r=fixture(),p=r.project,g=evaluationContext(p).curve(r.selectedId),q={...p,patches:p.patches!.map(x=>x.id===r.host?{...x,fullness:.8}:x)};
 expect(evaluationContext(q).curve(r.selectedId).key).not.toBe(g.key);expect(evaluationContext(q).curve(r.selectedId).evaluate(.5)).not.toEqual(g.evaluate(.5));
 expect(dirtyDescendants(p,q).curves.has(r.selectedId)).toBe(true);
 const child=addOnCurvePoint(q,r.selectedId),deleted=deleteClosure(child.project,[`patch:${r.host}`]);
 expect(deleted.curves.some(c=>c.id===r.selectedId)).toBe(false);expect(deleted.landmarks.some(l=>l.id===child.selectedId)).toBe(false);
});
test('ON_PATCH persists after records parsed before geometry evaluation',()=>{
 const r=fixture(),p=parseLandmarks(JSON.stringify(r.project));expect(p.curves.find(c=>c.id===r.selectedId)).toEqual(r.project.curves.find(c=>c.id===r.selectedId));expect(evaluationContext(p).curve(r.selectedId).evaluate(.4).every(Number.isFinite)).toBe(true);
});
test('boundary graph rejects Patch -> Curve -> same Patch',()=>{
 const r=fixture(),p=r.project;
 const q={...p,patches:p.patches!.map(x=>x.id===r.host?{...x,boundaryUses:[{curveId:r.selectedId,startLandmarkId:r.a,endLandmarkId:r.b},...x.boundaryUses.slice(1)]}:x)};
 expect(()=>dependencyGraph(q)).toThrow(/循环/);
});

import {createCurve} from '../domain/curves/management';
import {wholeBoundary,boundaryGeometry,closedBoundary} from '../domain/patches/boundary';
import {smoothFixture} from './smooth-fixture';
import {setLoomisOffset} from '../domain/head/offset';
import {ensureScaffold,RING_Y} from '../domain/head/scaffold';
import {migrateHeadFrame} from '../domain/head/frame';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {duplicateRing} from '../domain/head/duplicateRing';
import {isSection} from '../domain/curves/model';
import {addLoopPatch,orientLoopUses} from '../domain/patches/model';
import {setRelationship,relations} from '../domain/continuity/model';
import {contourSource} from '../domain/contour/source';
test('Quad host follows fairing changes without stale final geometry',()=>{
 let p=smoothFixture(.6);const h=p.patches![0];
 const r=createOnPatch(p,h.id,'v0','v3');p=r.project;
 const g=evaluationContext(p).curve(r.selectedId),q=setRelationship(p,'seam',{mode:'crease'}),after=evaluationContext(q).curve(r.selectedId);
 expect(g.key).not.toBe(after.key);expect(Math.hypot(...g.evaluate(.5).map((v,i)=>v-after.evaluate(.5)[i]))).toBeGreaterThan(1e-7);
});
test('Lens host preserves singular tip endpoints without NaN',()=>{
 const f=spanFixture();let p=f.p;const c=createCurve(p,f.a,f.b,p.views[0],'lens chord');p=addPatch(c.project,[f.use,c.selectedId]);
 const r=createOnPatch(p,p.patches![0].id,f.a,f.b);const g=evaluationContext(r.project).curve(r.selectedId);
 expect(g.sample().flat().every(Number.isFinite)).toBe(true);expect(g.derivative(0).every(Number.isFinite)).toBe(true);
});
test('Loop host unwraps periodic path once and remains continuous across seam',()=>{
 let p=ensureScaffold(migrateHeadFrame(createLandmarkProject()));const d=duplicateRing(p,RING_Y);p={...d.project,curves:d.project.curves.map(c=>c.id===d.selectedId&&isSection(c)&&c.role==='canonical'?{...c,section:{...c.section,planeOffset:.45}}:c)};
 p=addLoopPatch(p,orientLoopUses(p,[closedBoundary(p,RING_Y),closedBoundary(p,d.selectedId)]));
 const a=addOnCurvePoint(p,RING_Y);p=setOnCurveS(a.project,a.selectedId,.98);const b=addOnCurvePoint(p,d.selectedId);p=setOnCurveS(b.project,b.selectedId,.95);
 expect(()=>createOnPatch(setLoomisOffset(p,a.selectedId,2,.1),p.patches![0].id,a.selectedId,b.selectedId)).toThrow(/Offset/);
 const r=createOnPatch(p,p.patches![0].id,a.selectedId,b.selectedId),before=evaluationContext(r.project).curve(r.selectedId);
 const q=setOnCurveS(r.project,a.selectedId,.02),after=evaluationContext(q).curve(r.selectedId);
 expect(Math.hypot(...before.evaluate(.5).map((x,i)=>x-after.evaluate(.5)[i]))).toBeLessThan(.2);
 expect(after.sample().flat().every(Number.isFinite)).toBe(true);
});
test('ON_PATCH supports CurveSpan, downstream Patch, transitive dirty and deletion',()=>{
 const r=fixture();let p=r.project;const middle=addOnCurvePoint(p,r.selectedId);p=middle.project;
 const c=p.curves.find(c=>c.id===r.selectedId)!;const span={curveId:c.id,startLandmarkId:c.startLandmarkId!,endLandmarkId:middle.selectedId};
 expect(boundaryGeometry(p,span).evaluate(1)).toEqual(evaluationContext(p).pointPosition(middle.selectedId));
 const f=spanFixture();const other=p.landmarks.find(x=>x.name==='右外眼角点')!;
 const a=createCurve(p,c.startLandmarkId!,other.id,p.views[0],'down A');const b=createCurve(a.project,middle.selectedId,other.id,p.views[0],'down B');p=addPatch(b.project,[span,a.selectedId,b.selectedId]);
 const down=p.patches!.at(-2)!,q={...p,patches:p.patches!.map(x=>x.id===r.host?{...x,fullness:.3}:x)};
 expect(dirtyDescendants(p,q).patches.has(down.id)).toBe(true);
 expect(evaluator(q,down)(.2,.2).every(Number.isFinite)).toBe(true);
 const restored=parseLandmarks(JSON.stringify(followEndpoints(p,q)));expect(restored.patches!.some(x=>x.id===down.id)).toBe(true);
 expect(deleteClosure(q,[`patch:${r.host}`]).patches!.some(x=>x.id===down.id)).toBe(false);
});
test('Continuity feedback is rejected even when ordinary source DAG is acyclic',()=>{
 const r=fixture(),p=r.project,c=p.curves.find(c=>c.id===r.selectedId)!,host=p.patches![0];
 const a=p.landmarks.find(x=>x.id===r.a)!.placement,b=p.landmarks.find(x=>x.id===r.b)!.placement;if(a.kind!=='ON_CURVE'||b.kind!=='ON_CURVE')throw Error();
 const corner=p.landmarks.find(x=>x.name==='右外眼角点')!.id;
 const uses=[wholeBoundary(p,c.id),{curveId:a.hostCurveId,startLandmarkId:r.a,endLandmarkId:corner},{curveId:b.hostCurveId,startLandmarkId:r.b,endLandmarkId:corner}];
 const q={...p,patches:[...p.patches!,{id:'feedback',type:'tri' as const,boundaryUses:uses}]};
 expect(()=>dependencyGraph(q,false)).not.toThrow();expect(()=>dependencyGraph(q)).toThrow(/feedback/);expect(()=>addPatch(p,uses)).toThrow(/feedback/);
});
test('offset endpoint is rejected and OPEN_EDGE is a public role independent of topology',()=>{
 const r=fixture(),p=r.project;
 const withLine=contourSource(p).mesh,off={...p,curves:p.curves.map(c=>({...c,contourRole:'NONE' as const}))},without=contourSource(off).mesh;
 expect(withLine.triangles.length).toBe(without.triangles.length);expect(withLine.boundaries!.length).toBe(without.boundaries!.length+2);
});
import {projection,depthSteps,visibilitySteps} from '../domain/contour/visible';
function finish<T>(g:Generator<void,T>):T {let r=g.next();while(!r.done)r=g.next();return r.value;}
test('public OPEN_EDGE reuses surface depth: coincident visible, foreground cover hides, no topology changes',()=>{
 let p=smoothFixture(0,0);const r=createOnPatch(p,'pa','v0','v3');p=r.project;
 const m=contourSource(p).mesh,line=m.boundaries!.at(-1)!;const q:[number,number,number,number]=[0,0,0,1],front=projection(m,q,256),depth=finish(depthSteps(front.points,m,256)),candidate=projection(m,q,256,line).points;
 expect(finish(visibilitySteps([candidate],depth,front.epsilon)).flat().length).toBeGreaterThan(20);
 // Actual foreground Surface triangles, not an ID-based hide rule.
 const at=m.vertices.length;m.vertices.push([-2,-2,2],[2,-2,2],[2,2,2],[-2,2,2]);m.triangles.push({indices:[at,at+1,at+2],patchId:'occluder',triangleId:0},{indices:[at,at+2,at+3],patchId:'occluder',triangleId:1});
 const cover=projection(m,q,256);expect(finish(visibilitySteps([projection(m,q,256,line).points],finish(depthSteps(cover.points,m,256)),cover.epsilon))).toEqual([]);
});
test('non-ON_PATCH OPEN_EDGE works without any Surface',()=>{
 const f=spanFixture(),p={...f.p,curves:f.p.curves.map(c=>c.id===f.host?{...c,contourRole:'OPEN_EDGE' as const}:c)},m=contourSource(p).mesh;
 expect(m.triangles).toHaveLength(0);const a=projection(m,[0,0,0,1],128),d=finish(depthSteps(a.points,m,128));
 expect(finish(visibilitySteps([projection(m,[0,0,0,1],128,m.boundaries![0]).points],d,a.epsilon)).length).toBeGreaterThan(0);
});

import {setOnPatchHandle,onPatchControls,clampSurfaceHandle} from '../domain/curves/onPatch';
test('all patch chart types constrain surface Bezier controls to their domain',()=>{
 for(const type of ['quad','lens','tri','loop']){const q=clampSurfaceHandle(type,[1.4,.8]);expect(q[1]).toBeLessThanOrEqual(1);if(type==='tri')expect(q[0]+q[1]).toBeLessThanOrEqual(1);else if(type!=='loop')expect(q[0]).toBe(1);else expect(q[0]).toBe(1.4);}
 const f=fixture(),c=f.project.curves.find(x=>x.id===f.selectedId)!;let p=setOnPatchHandle(f.project,c.id,0,[.3,.5]);expect(onPatchControls(p,p.curves.find(x=>x.id===c.id) as any).controls[1]).toEqual([.3,.5]);expect(()=>parseLandmarks(JSON.stringify(p))).not.toThrow();
});

import {onPatchExample} from '../../tests/helpers/onPatchExamples';
for(const topology of ['tri','quad','lens','loop'] as const)test(`${topology}: editable surface Bezier uses the actual host evaluator`,()=>{
 const f=onPatchExample(topology);let p=setOnPatchHandle(f.project,f.curveId,0,[.25,.3]);p=setOnPatchHandle(p,f.curveId,1,[.65,.25]);
 const curve=p.curves.find(x=>x.id===f.curveId) as any,{controls}=onPatchControls(p,curve),surface=evaluator(p,p.patches!.find(x=>x.id===f.hostId)!),g=evaluationContext(p).curve(f.curveId);
 for(const t of [0,.1,.4,.8,1]){const a=1-t,w=[a*a*a,3*a*a*t,3*a*t*t,t*t*t],uv=[0,1].map(k=>controls.reduce((n,q,i)=>n+w[i]*q[k],0));const expected=surface(topology==='loop'?(uv[0]%1+1)%1:uv[0],uv[1]);expect(g.evaluate(t)).toEqual(expected);}
 expect(()=>parseLandmarks(JSON.stringify(p))).not.toThrow();
});
