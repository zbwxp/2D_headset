import {patchRows} from '../ui/shared/pairRows';
import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,rotateFrame,mirrorPoint} from '../domain/head/frame';
import {createEyeScaffold,rebuildEyeScaffold,EYE_DEFAULTS} from '../domain/eyes/scaffold';
import {addEyeFrontPatches} from '../domain/eyes/frontPatches';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {evaluator,tessellate} from '../domain/patches/geometry';
import {eyeObjectMatrix} from '../rendering/eyeDisplay';
const setup=()=>addEyeFrontPatches(createEyeScaffold(migrateHeadFrame(createLandmarkProject())));
test('saved eye study defaults and one front quad per eye / one symmetric pair',()=>{
 const p=setup(),e=p.eyeScaffold!,q=e.parameters;expect(q).toEqual(EYE_DEFAULTS);expect(q).toMatchObject({x:.5,y:-.3665315937744661,z:.5911634322080732,radiusX:.25,radiusZ:.25,height:.7,ballX:.25,ballY:.25,ballZ:.25});expect(e.perspective).toEqual({x:.234422041418454,y:0});
 expect(p.patches).toHaveLength(2);expect(patchRows(p)).toHaveLength(1);expect(addEyeFrontPatches(p)).toBe(p);
 for(const patch of p.patches!){expect(p.geometryModules?.[patch.id]).toBe('EYES');expect(patch.type).toBe('quad');expect(patch.boundaryUses).toHaveLength(4);const mesh=tessellate(p,patch,12);expect(mesh.invalid).toBeFalsy();expect(mesh.triangles.length).toBeGreaterThan(0);
 for(const v of mesh.vertices){const local=rotateFrame(v.map((n,i)=>n-p.headFrame!.center[i]) as [number,number,number],p.headFrame!,true).map(n=>n/p.headFrame!.radiusX);expect(local[2]).toBeGreaterThanOrEqual(q.z-1e-8);expect(local[1]).toBeGreaterThanOrEqual(q.y-q.height/2-1e-8);expect(local[1]).toBeLessThanOrEqual(q.y+q.height/2+1e-8);const ellipse=((Math.abs(local[0])-q.x)/q.radiusX)**2+((local[2]-q.z)/q.radiusZ)**2;expect(ellipse).toBeCloseTo(1,2);}
 if(patch.canonicalId){const a=evaluator(p,p.patches!.find(x=>x.id===patch.canonicalId)!),b=evaluator(p,patch);expect(b(.3,.6)).toEqual(mirrorPoint(p,a(.3,.6)));}
 }
 expect(()=>parseLandmarks(JSON.stringify(p))).not.toThrow();expect(parseLandmarks(JSON.stringify(p)).patches).toHaveLength(0);
});
test('front patches follow cylinder edits and use the same side display transform as their boundary',()=>{
 const p=setup(),e=p.eyeScaffold!,next=rebuildEyeScaffold({...p,eyeScaffold:{...e,parameters:{...e.parameters,radiusX:.4,height:1,z:.8}}});
 for(const patch of next.patches!){expect(tessellate(next,patch,8).invalid).toBeFalsy();expect(evaluator(next,patch)(.5,.5)).not.toEqual(evaluator(p,patch)(.5,.5));expect(eyeObjectMatrix(next,patch.id,[.7,0,.7]).elements).toEqual(eyeObjectMatrix(next,patch.boundaryUses[0].curveId,[.7,0,.7]).elements);}
});

import {addPatchPoint,setPatchPoint} from '../domain/patches/point';
import {pointPosition} from '../domain/geometry/evaluation';
import {deleteClosure,dirtyDescendants} from '../domain/geometry/dependencies';
import {addPatch} from '../domain/patches/model';
test('surface landmarks retain host UV, mirror, follow geometry, save/load and dependency deletion',()=>{
 let p=setup();const host=p.patches!.find(x=>!x.canonicalId)!;const r=addPatchPoint(p,host.id,.3,.6);p=r.project;
 expect(pointPosition(p,r.id)).toEqual(evaluator(p,host)(.3,.6));
 const partner=p.landmarks.find(x=>x.id===r.id)!.mirrorPartnerId!;expect(pointPosition(p,partner)).toEqual(mirrorPoint(p,pointPosition(p,r.id)));
 p=setPatchPoint(p,partner,.4,.7);expect(p.landmarks.find(x=>x.id===r.id)!.placement).toMatchObject({u:.4,v:.7});
 const e=p.eyeScaffold!,next=rebuildEyeScaffold({...p,eyeScaffold:{...e,parameters:{...e.parameters,radiusZ:.45}}});
 expect(dirtyDescendants(p,next).points.has(r.id)).toBe(true);expect(pointPosition(next,r.id)).not.toEqual(pointPosition(p,r.id));
 const loaded=parseLandmarks(JSON.stringify(next));expect(loaded.landmarks.some(l=>l.id===r.id||l.id===partner)).toBe(false);
 expect(deleteClosure(next,[`patch:${host.id}`]).landmarks.some(x=>x.id===r.id||x.id===partner)).toBe(false);
});
test('old two-quarter surfaces upgrade to one quad per side without deleting authored points or guides',()=>{
 let p=createEyeScaffold(migrateHeadFrame(createLandmarkProject()));const c=p.eyeScaffold!.right.curveIds;
 for(const q of [0,1])p=addPatch(p,[c[q],c[4+q],c[8+q],c[9+q]]);
 const next=addEyeFrontPatches(p);expect(next.patches).toHaveLength(2);expect(next.landmarks).toEqual(p.landmarks);expect(next.curves).toHaveLength(p.curves.length+4);
 expect(addEyeFrontPatches(next)).toBe(next);
});

import {createOnPatch} from '../domain/curves/onPatch';
import {evaluationContext} from '../domain/geometry/evaluation';
import {isOnPatch} from '../domain/curves/model';
test('ordinary On Surface Curve accepts interior hosted points, follows their UV and preserves mirror/save/load',()=>{
 let p=setup();const host=p.patches!.find(x=>!x.canonicalId)!;
 const a=addPatchPoint(p,host.id,.2,.35);p=a.project;const b=addPatchPoint(p,host.id,.8,.6);p=b.project;
 const result=createOnPatch(p,host.id,a.id,b.id);p=result.project;
 const c=p.curves.find(x=>x.id===result.selectedId)!;expect(isOnPatch(c)&&c.role==='canonical'&&c.path).toMatchObject({startBoundary:-1,endBoundary:-1});
 const g=evaluationContext(p).curve(c.id),surface=evaluator(p,host);
 for(const t of [0,.2,.5,.8,1])g.evaluate(t).forEach((n,i)=>expect(n).toBeCloseTo(surface(.2+.6*t,.35+.25*t)[i],12));
 expect(evaluationContext(p).curve(c.mirrorPartnerCurveId!).evaluate(.4)).toEqual(mirrorPoint(p,g.evaluate(.4)));
 const loaded=parseLandmarks(JSON.stringify(p));expect(loaded.curves.some(x=>x.id===c.id)).toBe(false);
 const next=setPatchPoint(p,a.id,.1,.2);expect(evaluationContext(next).curve(c.id).evaluate(0)).toEqual(pointPosition(next,a.id));
 const foreign=p.landmarks.find(x=>x.id===a.id)!.mirrorPartnerId!;expect(()=>createOnPatch(p,host.id,foreign,b.id)).toThrow(/Endpoint/);
});

import {setOnPatchHandle,onPatchControls} from '../domain/curves/onPatch';
test('surface Bezier handles stay in chart, preserve endpoints, mirror and roundtrip',()=>{
 let p=setup();const host=p.patches!.find(x=>!x.canonicalId)!;
 const a=addPatchPoint(p,host.id,.15,.4),b=addPatchPoint(a.project,host.id,.85,.4),r=createOnPatch(b.project,host.id,a.id,b.id);p=r.project;
 const old=evaluationContext(p).curve(r.selectedId).evaluate(.5);p=setOnPatchHandle(p,r.selectedId,0,[.3,.8]);
 const c=p.curves.find(x=>x.id===r.selectedId)!,g=evaluationContext(p).curve(c.id);expect(g.evaluate(.5)).not.toEqual(old);expect(g.evaluate(0)).toEqual(pointPosition(p,a.id));expect(g.evaluate(1)).toEqual(pointPosition(p,b.id));
 const cp=onPatchControls(p,c as any).controls,f=evaluator(p,host);for(const t of [.2,.5,.8]){const w=[(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3],uv=[0,1].map(k=>cp.reduce((n,q,i)=>n+w[i]*q[k],0));expect(g.evaluate(t)).toEqual(f(uv[0],uv[1]));}
 const q=setOnPatchHandle(p,c.mirrorPartnerCurveId!,1,[.7,.9]);expect(evaluationContext(q).curve(c.mirrorPartnerCurveId!).evaluate(.5)).toEqual(mirrorPoint(q,evaluationContext(q).curve(c.id).evaluate(.5)));
 const loaded=parseLandmarks(JSON.stringify(q));expect(loaded.curves.some(x=>x.id===c.id)).toBe(false);
});
