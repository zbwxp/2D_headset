import {isSection} from '../domain/curves/model';
import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,toHead} from '../domain/head/frame';
import {addSurfacePoint} from '../domain/head/surfacePoint';
import {createSection,sectionFromAngles} from '../domain/curves/section';
import {addOnCurvePoint,setOnCurveS} from '../domain/landmarks/placement';
import {addCap,addCapPoint} from '../domain/head/caps';
import {setLoomisOffset} from '../domain/head/offset';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {orthographicView,worldToScreen} from '../rendering/orthographic';
import {beginConstrainedDrag,constrainedValue,ellipsoidBranches} from '../ui/authoring/constrainedDrag';
import {dispatch2D,placementCapability} from '../ui/authoring/InteractionDispatcher2D';
const project=()=>migrateHeadFrame(createLandmarkProject());
const view=(p:ReturnType<typeof project>)=>orthographicView(p.views[0].camera,{zoom:1,pan:[0,0]},600,560);
test('dispatcher prioritizes fine objects in Select and restricts tool hit classes',()=>{
 expect(dispatch2D({kind:'select'},'point')).toBe('point');expect(dispatch2D({kind:'select'},'curve')).toBe('curve');expect(dispatch2D({kind:'select'},'surface')).toBe('surface');
 expect(dispatch2D({kind:'surfacePoint',centerline:false},'point')).toBe('surfacePoint');expect(dispatch2D({kind:'patch',pending:{mode:'whole',uses:[]}},'surface')).toBe('ignore');
});
test('ellipsoid front/back roots and existing back branch remain stable, offsets preserved',()=>{
 let p=project();const v=view(p),xy=worldToScreen(toHead(p,[.3,.2,0]),v),roots=ellipsoidBranches(p,xy,v);expect(roots.front![2]).toBeGreaterThan(0);expect(roots.back![2]).toBeLessThan(0);
 const r=addSurfacePoint(p,roots.back!);p=setLoomisOffset(r.project,r.selectedId,2,.12);const d=beginConstrainedDrag(p,r.selectedId,v);expect(d.branch).toBe('back');
 for(const x of [.4,.7,.9]){const value=constrainedValue(p,d,[worldToScreen(toHead(p,[x,.2,0]),v)[0],xy[1]],v);expect(value?.kind).toBe('ellipsoid');if(value?.kind==='ellipsoid')expect(value.direction[2]).toBeLessThan(0);}
 expect(p.landmarks.find(l=>l.id===r.selectedId)!.placement).toHaveProperty('offsetZ',.12);
 expect(constrainedValue(p,d,[-999,-999],v)).toBeNull();
});
test('ON_CURVE drag preserves projected branch of a closed edge and normalized s',()=>{
 let p=project();const section=createSection(p);p={...section.project,curves:section.project.curves.map(c=>c.id===section.selectedId&&isSection(c)&&c.role==='canonical'?{...c,section:sectionFromAngles(0,90,.2)}:c)};
 const r=addOnCurvePoint(p,section.selectedId);p=setOnCurveS(r.project,r.selectedId,.7);const v=view(p),d=beginConstrainedDrag(p,r.selectedId,v),g=evaluationContext(p).curve(section.selectedId),value=constrainedValue(p,d,worldToScreen(g.atArcLength(.72),v),v);
 expect(value?.kind).toBe('curve');if(value?.kind==='curve')expect(value.s).toBeCloseTo(.72,3);
});
test('cap drag uses plane coordinates, rejects outside disk, leaves offset intact',()=>{
 let p=project();const c=createSection(p);p={...c.project,curves:c.project.curves.map(x=>x.id===c.selectedId&&isSection(x)&&x.role==='canonical'?{...x,section:sectionFromAngles(0,0,.2)}:x)};p=addCap(p,c.selectedId);const r=addCapPoint(p,p.loomisCaps![0].id,.1,.2);p=setLoomisOffset(r.project,r.selectedId,1,.1);
 const v=view(p),d=beginConstrainedDrag(p,r.selectedId,v),xy=worldToScreen(pointPosition(p,r.selectedId),v),value=constrainedValue(p,d,[xy[0]+15,xy[1]],v);
 expect(value?.kind).toBe('cap');if(value?.kind==='cap')expect(value.u).toBeGreaterThan(.1);expect(constrainedValue(p,d,[-999,-999],v)).toBeNull();expect(p.landmarks.find(x=>x.id===r.selectedId)!.placement).toHaveProperty('offsetY',.1);
});
