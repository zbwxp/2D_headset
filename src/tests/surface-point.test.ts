import {it,expect} from 'vitest';
import {addSurfacePoint,setSurfaceDirection,intersectLoomis} from '../domain/head/surfacePoint';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,toRelative,mirrorPoint} from '../domain/head/frame';
import {pointPosition} from '../domain/geometry/evaluation';
import {dirtyDescendants,deleteClosure} from '../domain/geometry/dependencies';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {duplicateLandmark} from '../domain/landmarks/management';
import {createSection} from '../domain/curves/section';
import {createCurve} from '../domain/curves/management';
import {followEndpoints,controls} from '../domain/curves/geometry';
import {eligibleAnchors} from '../domain/patches/boundary';
import {setGlobalViewLock} from '../domain/landmarks/model';
const base=()=>migrateHeadFrame(createLandmarkProject());
it('analytic ray handles miss, tangent, inside, pole, thin and transformed ellipsoids',()=>{
 const p=base();p.headFrame={center:[0,0,0],orientation:[0,0,0,1],radiusX:1,radiusY:1,radiusZ:1};
 expect(intersectLoomis(p,[0,0,3],[0,0,-1])).toEqual([0,0,1]);expect(intersectLoomis(p,[2,0,3],[0,0,-1])).toBeNull();expect(intersectLoomis(p,[1,0,3],[0,0,-1])).toEqual([1,0,0]);expect(intersectLoomis(p,[0,0,0],[0,1,0])).toEqual([0,1,0]);
 p.headFrame.radiusX=1e-5;expect(intersectLoomis(p,[3,0,0],[-1,0,0])![0]).toBeCloseTo(1,9);
 p.headFrame={...p.headFrame,radiusX:1,center:[2,3,4],orientation:[0,Math.SQRT1_2,0,Math.SQRT1_2]};expect(Math.hypot(...intersectLoomis(p,[2,3,9],[0,0,-1])!)).toBeCloseTo(1,12);
});
it('frame-only host, stable direction, strict symmetry and no Section/Region dependency',()=>{
 const section=createSection(base()),r=addSurfacePoint(section.project,[.4,.5,.6]),p=r.project,l=p.landmarks.find(l=>l.id===r.selectedId)!;
 const next={...p,headFrame:{...p.headFrame!,radiusX:2,radiusY:1.7,orientation:[0,0,Math.SQRT1_2,Math.SQRT1_2] as [number,number,number,number]}};
 expect(next.landmarks.find(x=>x.id===l.id)!.placement).toEqual(l.placement);expect(Math.hypot(...toRelative(next,pointPosition(next,l.id)))).toBeCloseTo(1,12);pointPosition(next,l.mirrorPartnerId!).forEach((v,i)=>expect(v).toBeCloseTo(mirrorPoint(next,pointPosition(next,l.id))[i],12));
 const removed=deleteClosure(next,[`curve:${section.selectedId}`]);expect(removed.landmarks.find(x=>x.id===l.id)).toEqual(l);expect(dirtyDescendants(p,next).points.has(l.id)).toBe(true);
 const changed=setSurfaceDirection(p,l.id,[.1,.8,.4]);expect([...dirtyDescendants(p,changed).points].sort()).toEqual([l.id,l.mirrorPartnerId!].sort());
 expect(eligibleAnchors(p,section.selectedId).some(x=>x.id===l.id)).toBe(false);
});
it('surface endpoints preserve curve handles and serialize without mesh/region coordinates',()=>{
 const a=addSurfacePoint(base(),[.3,.4,.5]),b=addSurfacePoint(a.project,[.6,-.4,.5]),r=createCurve(b.project,a.selectedId,b.selectedId,b.project.views[0],'球面连接'),p=r.project,c=p.curves.find(x=>x.id===r.selectedId)!;
 const changed=followEndpoints(p,setSurfaceDirection(p,a.selectedId,[.2,.5,.3]));const after=changed.curves.find(x=>x.id===r.selectedId)!;
 if(c.role==='canonical'&&after.role==='canonical'&&'shape' in c&&'shape' in after){expect(after.shape).toEqual(c.shape);}
 expect(controls(changed,after)[0]).toEqual(pointPosition(changed,a.selectedId));expect(dirtyDescendants(p,changed).curves.has(c.id)).toBe(true);
 const loaded=parseLandmarks(JSON.stringify(changed));expect(loaded.landmarks.find(x=>x.id===a.selectedId)!.placement).toEqual(changed.landmarks.find(x=>x.id===a.selectedId)!.placement);
 const l=loaded.landmarks.find(x=>x.id===a.selectedId)!;expect(Object.keys(l.placement).sort()).toEqual(['direction','hostFrameId','kind']);
 const locked=setGlobalViewLock(loaded,loaded.views[0].id,true);expect(locked.landmarks.find(x=>x.id===l.id)!.viewLocks).toEqual({});const dup=duplicateLandmark(locked,l.id,'复制球面点');expect(dup.project.landmarks.find(x=>x.id===dup.selectedId)!.viewLocks).toEqual({});
 const bad=JSON.parse(JSON.stringify(loaded));delete bad.headFrame;expect(()=>parseLandmarks(JSON.stringify(bad))).toThrow();
});
it('centerline directions stay on sagittal great circle and invalid zero directions reject',()=>{
 const a=addSurfacePoint(base(),[.4,.3,.2],true),p=setSurfaceDirection(a.project,a.selectedId,[.9,-.2,.6]),l=p.landmarks.find(x=>x.id===a.selectedId)!;expect(l.type).toBe('CENTERLINE');if(l.placement.kind==='ON_LOOMIS_SURFACE')expect(l.placement.direction[0]).toBe(0);expect(()=>setSurfaceDirection(p,l.id,[1,0,0])).toThrow();expect(parseLandmarks(JSON.stringify(p)).centerlineOrder).toContain(l.id);
});
it('surface movement dirties and deforms only incident Patch descendants; removing Region preserves points',async()=>{
 const {addPatch}=await import('../domain/patches/model'),{tessellate}=await import('../domain/patches/geometry'),{regionCandidates}=await import('../domain/head/regions');
 let p=createSection(base(),true).project;const host=p.curves.find(c=>'geometryType' in c)!.id,candidate=regionCandidates(p,[host])[0];p={...p,loomisRegions:[{id:'region',name:'区域',cuts:candidate.cuts,seed:candidate.seed}]};
 const ids:string[]=[];for(const d of [[.2,.5,.6],[.7,.1,.5],[.3,-.4,.7]]){const r=addSurfacePoint(p,d as [number,number,number]);p=r.project;ids.push(r.selectedId);}
 const edges:string[]=[];for(let i=0;i<3;i++){const r=createCurve(p,ids[i],ids[(i+1)%3],p.views[0],`曲线 ${i}`);p=r.project;edges.push(r.selectedId);}p=addPatch(p,edges);const old=tessellate(p,p.patches![0],6),next=followEndpoints(p,setSurfaceDirection(p,ids[0],[.3,.6,.6]));expect(tessellate(next,next.patches![0],6).vertices).not.toEqual(old.vertices);expect(dirtyDescendants(p,next).patches.size).toBe(2);
 const noRegion={...next,loomisRegions:[]};for(const id of ids)expect(pointPosition(noRegion,id)).toEqual(pointPosition(next,id));const noSection=deleteClosure(next,[`curve:${host}`]);expect(noSection.loomisRegions).toEqual([]);for(const id of ids)expect(pointPosition(noSection,id)).toEqual(pointPosition(next,id));
});
