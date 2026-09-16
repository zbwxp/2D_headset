import {test,expect} from 'vitest';
import {addCap,capFrame,capMesh,capPosition,addCapPoint,hitCap,setCapPoint} from '../domain/head/caps';
import {createSection,sectionFromAngles} from '../domain/curves/section';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,mirrorPoint} from '../domain/head/frame';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {deleteClosure,dirtyDescendants} from '../domain/geometry/dependencies';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {createCurve} from '../domain/curves/management';
import {sub,cross,dot,scale,add} from '../domain/geometry/core';
import {finalSurfaceRenderData} from '../app/renderSnapshot';
import {contourSource} from '../domain/contour/source';
function fixture(center=false){let p=migrateHeadFrame(createLandmarkProject());p={...p,landmarks:[],curves:[],patches:[],centerlineOrder:[]};const r=createSection(p,center);return addCap(r.project,r.selectedId);}
test('cap disk boundary equals analytic Section, planar, mirrored and idempotent',()=>{
 const p=fixture();expect(p.loomisCaps).toHaveLength(2);const cap=p.loomisCaps![0],f=capFrame(p,cap.id),m=capMesh(p,cap),g=evaluationContext(p).curve(cap.hostSectionCurveId),normal=cross(f.u,f.v);
 for(let i=0;i<96;i++){expect(Math.hypot(...sub(m.vertices[i+1],g.evaluate(i/96)))).toBeLessThan(1e-12);expect(Math.abs(dot(sub(m.vertices[i+1],f.center),normal))).toBeLessThan(1e-12);}
 const other=capMesh(p,p.loomisCaps![1]);m.vertices.forEach((v,i)=>expect(Math.hypot(...sub(other.vertices[i],mirrorPoint(p,v)))).toBeLessThan(1e-12));
 expect(addCap(p,cap.hostSectionCurveId).loomisCaps).toHaveLength(2);expect(finalSurfaceRenderData(p,6)).toHaveLength(2);expect(contourSource(p).mesh.triangles).toHaveLength(192);
});
test('UV remains fixed under tilt/offset and anisotropic frame changes; dependents dirty',()=>{
 const p=fixture(),r=addCapPoint(p,p.loomisCaps![0].id,.2,-.3),a=r.project;
 const b={...a,headFrame:{...a.headFrame!,radiusX:1.6,radiusY:1.8,radiusZ:.9},curves:a.curves.map(c=>c.role==='canonical'?{...c,section:sectionFromAngles(17,75,.4)}:c)};
 expect(b.landmarks[0].placement).toEqual(a.landmarks[0].placement);expect(pointPosition(a,r.selectedId)).not.toEqual(pointPosition(b,r.selectedId));expect(dirtyDescendants(a,b).points.has(r.selectedId)).toBe(true);
 expect(Math.hypot(...sub(pointPosition(b,b.landmarks[1].id),mirrorPoint(b,pointPosition(b,r.selectedId))))).toBeLessThan(1e-12);
 const f=capFrame(b,b.loomisCaps![0].id);expect(Math.abs(dot(sub(pointPosition(b,r.selectedId),f.center),cross(f.u,f.v)))).toBeLessThan(1e-12);
});
test('analytic hit returns UV independent of mesh; bounds and centerline cap',()=>{
 const p=fixture(true);expect(p.loomisCaps).toHaveLength(1);const id=p.loomisCaps![0].id,f=capFrame(p,id),n=cross(f.u,f.v),target=capPosition(p,id,.3,.4),hit=hitCap(p,id,add(target,n),scale(n,-1));expect(hit?.u).toBeCloseTo(.3,12);expect(hit?.v).toBeCloseTo(.4,12);
 expect(hitCap(p,id,add(capPosition(p,id,2,0),n),scale(n,-1))).toBeNull();
 const r=addCapPoint(p,id,.3,.4);expect(r.project.landmarks).toHaveLength(1);expect(r.project.landmarks[0].type).toBe('CENTERLINE');expect(pointPosition(r.project,r.selectedId)[0]).toBeCloseTo(0,12);
});
test('cap points are ordinary endpoints; roundtrip and cap/Section cascade removes downstream',()=>{
 let p=fixture();const a=addCapPoint(p,p.loomisCaps![0].id,.1,.2);const b=addCapPoint(a.project,p.loomisCaps![0].id,-.3,.1);p=createCurve(b.project,a.selectedId,b.selectedId,p.views[0],'cap edge').project;
 const loaded=parseLandmarks(JSON.stringify(p));expect(loaded.loomisCaps).toEqual(p.loomisCaps);expect(loaded.landmarks.map(l=>l.placement)).toEqual(p.landmarks.map(l=>l.placement));
 expect(evaluationContext(loaded).curve(p.curves.at(-2)!.id).evaluate(0)).toEqual(pointPosition(loaded,a.selectedId));
 const noCap=deleteClosure(p,[`cap:${p.loomisCaps![0].id}`]);expect(noCap.loomisCaps).toHaveLength(0);expect(noCap.landmarks).toHaveLength(0);expect(noCap.curves).toHaveLength(2);
 const noHost=deleteClosure(p,[`curve:${p.loomisCaps![0].hostSectionCurveId}`]);expect(noHost.curves).toHaveLength(0);expect(noHost.loomisCaps).toHaveLength(0);expect(noHost.landmarks).toHaveLength(0);
 const moved=setCapPoint(p,a.selectedId,.7,.8);expect(pointPosition(moved,a.selectedId)).not.toEqual(pointPosition(p,a.selectedId));
});
