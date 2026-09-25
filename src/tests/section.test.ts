import {describe,it,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,toRelative,mirrorPoint} from '../domain/head/frame';
import {createSection,sectionFromAngles,validateSection} from '../domain/curves/section';
import {isSection} from '../domain/curves/model';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {dot,sub} from '../domain/geometry/core';
import {addOnCurvePoint,setOnCurveS} from '../domain/landmarks/placement';
import {createCurve,deleteCurve} from '../domain/curves/management';
import {followEndpoints} from '../domain/curves/geometry';
import {dirtyDescendants} from '../domain/geometry/dependencies';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {boundaryGeometry,reverseBoundary,boundaryKey,mirrorBoundary} from '../domain/patches/boundary';
import {addPatch,loop} from '../domain/patches/model';
import {baseEvaluator} from '../domain/patches/base';
import {baseDifferential} from '../domain/patches/fullness';
import {tessellate} from '../domain/patches/geometry';
import {editRenderSnapshot} from '../app/renderSnapshot';
import {solveContinuity,solvePatch} from '../domain/continuity/solver';
import type {Vec3} from '../domain/project/types';
const near=(a:Vec3,b:Vec3,e=1e-9)=>expect(Math.hypot(...sub(a,b))).toBeLessThan(e);
function fixture(){let {project:p,selectedId:host}=createSection(migrateHeadFrame(createLandmarkProject()));const a=addOnCurvePoint(p,host);p=setOnCurveS(a.project,a.selectedId,.8);const b=addOnCurvePoint(p,host);p=setOnCurveS(b.project,b.selectedId,.2);return {p,host,a:a.selectedId,b:b.selectedId,use:{curveId:host,startLandmarkId:a.selectedId,endLandmarkId:b.selectedId}};}
describe('analytic Loomis Section',()=>{
 it('exact ellipsoid/plane intersection and analytic derivative, not cubic',()=>{const {p,host}=fixture(),g=evaluationContext(p).curve(host),c=p.curves.find(c=>c.id===host)!;if(!isSection(c)||c.role!=='canonical')throw Error();expect(g.closed).toBe(true);expect(g.controls).toBeUndefined();expect(c.startLandmarkId).toBeUndefined();for(let i=0;i<=30;i++){const t=i/30,q=toRelative(p,g.evaluate(t));expect(dot(q,q)).toBeCloseTo(1,12);expect(dot(q,c.section.planeNormal)).toBeCloseTo(c.section.planeOffset,12);const h=1e-6,d=sub(g.evaluate(t+h),g.evaluate(t-h)).map(x=>x/(2*h)) as Vec3;near(g.derivative(t),d,1e-8);}near(g.evaluate(0),g.evaluate(1));});
 it.each(['radiusX','radiusY','radiusZ'] as const)('%s changes evaluated ellipse and descendants only',axis=>{const {p,host,a}=fixture(),q=followEndpoints(p,{...p,headFrame:{...p.headFrame!,[axis]:p.headFrame![axis]*1.7}});expect(q.curves).toEqual(p.curves);expect(q.landmarks).toBe(p.landmarks);expect(pointPosition(q,a)).not.toEqual(pointPosition(p,a));expect(dirtyDescendants(p,q).curves.has(host)).toBe(true);near(evaluationContext(q).curve(host).atArcLength(.8),pointPosition(q,a));});
 it('uses normalized world arc length, not theta fraction',()=>{const {p,host,a}=fixture();p.headFrame!.radiusX=3;const g=evaluationContext(p).curve(host);near(g.atArcLength(.8),pointPosition(p,a));expect(Math.hypot(...sub(g.evaluate(.8),pointPosition(p,a)))).toBeGreaterThan(.01);});
 it('wrapped A→B retains arc on loop reversal and exact mirror',()=>{const {p,use}=fixture(),g=boundaryGeometry(p,use),rev=reverseBoundary(p,use),r=boundaryGeometry(p,rev),m=boundaryGeometry(p,mirrorBoundary(p,use));expect(boundaryKey(p,use)).toBe(boundaryKey(p,rev));expect(boundaryKey(p,{...use,startLandmarkId:use.endLandmarkId,endLandmarkId:use.startLandmarkId})).not.toBe(boundaryKey(p,use));for(let i=0;i<=20;i++){const t=i/20;near(g.evaluate(t),r.evaluate(1-t));near(m.evaluate(t),mirrorPoint(p,g.evaluate(t)));}near(g.evaluate(0),pointPosition(p,use.startLandmarkId));near(g.evaluate(1),pointPosition(p,use.endLandmarkId));});
 it('mixed analytic span / Bezier TriPatch has exact boundary and derivatives; Fullness and render work',()=>{const f=fixture();let p=f.p;const c=p.landmarks.find(l=>l.name==='右嘴角点')!.id,ac=createCurve(p,f.a,c,p.views[0],'AC');p=ac.project;const bc=createCurve(p,f.b,c,p.views[0],'BC');p=addPatch(bc.project,[f.use,ac.selectedId,bc.selectedId]);const patch=p.patches![0],ring=loop(p,patch.boundaryUses),base=baseEvaluator(p,patch),d=baseDifferential(p,patch);for(let i=0;i<=20;i++){const t=i/20;near(base(t,0),boundaryGeometry(p,ring[0].use).evaluate(t));near(base(1-t,t),boundaryGeometry(p,ring[1].use).evaluate(t));near(base(0,1-t),boundaryGeometry(p,ring[2].use).evaluate(t));}const h=1e-6;near(d(.2,.2).du,sub(base(.2+h,.2),base(.2-h,.2)).map(x=>x/(2*h)) as Vec3,1e-8);const smooth=solveContinuity(p);expect(smooth).toBeTruthy();const q={...p,patches:p.patches!.map((x,i)=>i===0?{...x,fullness:.2}:x)};expect(tessellate(q,q.patches[0],6).invalid).toBeUndefined();expect(editRenderSnapshot(q,{subdivisions:6,curveSegments:96,includeSurface:true}).curves.every(c=>[...c.samples].every(Number.isFinite))).toBe(true);expect(parseLandmarks(JSON.stringify(q)).patches).toEqual(q.patches);});
 it('source-only roundtrip preserves seam, s and mirrored geometry',()=>{const {p,host}=fixture(),q=parseLandmarks(JSON.stringify(p));expect(q.curves).toEqual(p.curves);for(const c of p.curves)for(const t of [0,.123,.8,1])near(evaluationContext(p).curve(c.id).evaluate(t),evaluationContext(q).curve(c.id).evaluate(t));const c=p.curves.find(c=>c.id===host)!;for(const l of p.landmarks.filter(l=>l.placement.kind==='ON_CURVE'))if(l.mirrorPartnerId)near(mirrorPoint(p,pointPosition(p,l.id)),pointPosition(p,l.mirrorPartnerId));expect(deleteCurve(p,host).landmarks.some(l=>l.placement.kind==='ON_CURVE')).toBe(false);});
 it('sagittal self-symmetric Section is one curve with CENTERLINE locators',()=>{const r=createSection(migrateHeadFrame(createLandmarkProject()),true),q=addOnCurvePoint(r.project,r.selectedId),l=q.project.landmarks.find(l=>l.id===q.selectedId)!;expect(l.type).toBe('CENTERLINE');expect(l.mirrorPartnerId).toBeUndefined();expect(toRelative(q.project,pointPosition(q.project,l.id))[0]).toBe(0);expect(parseLandmarks(JSON.stringify(q.project)).curves).toEqual(q.project.curves);});
 it('degenerate/no-intersection planes reject clearly; near-tangent stays finite',()=>{for(const d of [-1,1,2,NaN])expect(()=>validateSection(sectionFromAngles(20,30,d))).toThrow();const f=fixture();f.p.curves=f.p.curves.map(c=>isSection(c)&&c.role==='canonical'?{...c,section:sectionFromAngles(20,30,.999999)}:c);expect(evaluationContext(f.p).curve(f.host).sample().flat().every(Number.isFinite)).toBe(true);});
});
it('section edits dirty descendants but reuse unrelated providers; mirror follows a rotated/translated frame',()=>{
 const f=fixture(),p={...f.p,headFrame:{...f.p.headFrame!,center:[.3,-.2,.6] as Vec3,orientation:[0,Math.sin(.3),0,Math.cos(.3)] as [number,number,number,number]}};
 const other=createSection(p);const before=other.project;const q={...before,curves:before.curves.map(c=>c.id===f.host&&isSection(c)&&c.role==='canonical'?{...c,section:sectionFromAngles(12,42,.3)}:c)};
 const dirty=dirtyDescendants(before,q);expect(dirty.curves.has(f.host)).toBe(true);expect(dirty.points.has(f.a)).toBe(true);expect(dirty.curves.has(other.selectedId)).toBe(false);expect(evaluationContext(before).curve(other.selectedId)).toBe(evaluationContext(q).curve(other.selectedId));
 const host=q.curves.find(c=>c.id===f.host)!;for(const t of [0,.2,.8,1])near(mirrorPoint(q,evaluationContext(q).curve(f.host).evaluate(t)),evaluationContext(q).curve(host.mirrorPartnerCurveId!).evaluate(t));
});
it('mixed analytic-arc patches still solve, but unsafe candidates are rejected as a group',()=>{
 const f=fixture();let p=f.p;
 for(const name of ['右嘴角点','右眉头点']){const c=p.landmarks.find(l=>l.name===name)!.id,ac=createCurve(p,f.a,c,p.views[0],'AC');p=ac.project;const bc=createCurve(p,f.b,c,p.views[0],'BC');p=addPatch(bc.project,[f.use,ac.selectedId,bc.selectedId]);}
 const owners=p.patches!.filter(x=>!x.canonicalId);expect(owners).toHaveLength(2);
 // This fixture's original candidates turn normals by about 90–98 degrees.
 // Analytic-arc solver support remains intact; installing those candidates is now unsafe.
 for(const patch of owners){const raw=solvePatch(p,patch);expect(raw.error).toBeUndefined();expect(raw.field).toBeDefined();}
 const r=solveContinuity(p);
 for(const patch of owners){expect(r.patches[patch.id].shapeProtection).toBe('normal-change');expect(r.patches[patch.id].field).toBeUndefined();}
 expect(r.diagnostics.safety?.some(g=>!g.accepted&&owners.every(p=>g.patchIds.includes(p.id)))).toBe(true);
});
