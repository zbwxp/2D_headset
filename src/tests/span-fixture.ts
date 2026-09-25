import {isDerived} from '../domain/curves/model';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {createCurve} from './planar-fixture';
import {addOnCurvePoint,setOnCurveS} from '../domain/landmarks/placement';
import type {PatchBoundaryUse} from '../domain/patches/boundary';
export function spanFixture(){
 let p=createLandmarkProject();const id=(name:string)=>p.landmarks.find(l=>l.name===name)!.id;
 const h=createCurve(p,id('右眉头点'),id('右眉尾点'),p.views[0],'宿主');p=h.project;const host=h.selectedId;
 const owner=p.curves.find(c=>c.id===host)!;const canonical=owner.role==='mirror'?owner.canonicalCurveId:host;
 p={...p,curves:p.curves.map(c=>c.id===canonical&&(c.role==='canonical'&&!isDerived(c))?{...c,shape:{...c.shape,startHandle:{along:.2,offset:.12},endHandle:{along:.4,offset:.08}}}:c)};
 const a=addOnCurvePoint(p,host);p=setOnCurveS(a.project,a.selectedId,.2);const b=addOnCurvePoint(p,host);p=setOnCurveS(b.project,b.selectedId,.8);
 const c=id('右外眼角点'),ac=createCurve(p,a.selectedId,c,p.views[0],'A-C');p=ac.project;const bc=createCurve(p,b.selectedId,c,p.views[0],'B-C');p=bc.project;
 const use:PatchBoundaryUse={curveId:host,startLandmarkId:a.selectedId,endLandmarkId:b.selectedId};return {p,host,a:a.selectedId,b:b.selectedId,c,ac:ac.selectedId,bc:bc.selectedId,use};
}
