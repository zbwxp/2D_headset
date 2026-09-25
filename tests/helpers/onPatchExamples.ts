import {spanFixture} from '../../src/tests/span-fixture';
import {createCurve} from '../../src/domain/curves/management';
import {addPatch,addLoopPatch,orientLoopUses} from '../../src/domain/patches/model';
import {addOnCurvePoint,setOnCurveS} from '../../src/domain/landmarks/placement';
import {createOnPatch} from '../../src/domain/curves/onPatch';
import {closedBoundary} from '../../src/domain/patches/boundary';
import {ensureScaffold,RING_Y} from '../../src/domain/head/scaffold';
import {migrateHeadFrame} from '../../src/domain/head/frame';
import {createLandmarkProject} from '../../src/domain/landmarks/presets';
import {duplicateRing} from '../../src/domain/head/duplicateRing';
import {isSection} from '../../src/domain/curves/model';
export function onPatchExample(type:'tri'|'quad'|'lens'|'loop'){
 const f=spanFixture();let p=f.p,edges:string[]=[];
 if(type==='tri'){p=addPatch(p,[f.use,f.ac,f.bc]);edges=[f.ac,f.bc];}
 if(type==='lens'){const c=createCurve(p,f.a,f.b,p.views[0],'lens chord');p=addPatch(c.project,[f.use,c.selectedId]);edges=[f.host,c.selectedId];}
 if(type==='quad'){
 const ids=['右眉头点','右眉尾点','右外眼角点','右内眼角点'].map(n=>p.landmarks.find(l=>l.name===n)!.id);
 for(let i=0;i<4;i++){const c=createCurve(p,ids[i],ids[(i+1)%4],p.views[0],'Quad '+i);p=c.project;edges.push(c.selectedId);}p=addPatch(p,edges);edges=[edges[1],edges[3]];
 }
 if(type==='loop'){
 p=ensureScaffold(migrateHeadFrame(createLandmarkProject()));const d=duplicateRing(p,RING_Y);p={...d.project,curves:d.project.curves.map(c=>c.id===d.selectedId&&isSection(c)&&c.role==='canonical'?{...c,section:{...c.section,planeOffset:.45}}:c)};
 edges=[RING_Y,d.selectedId];p=addLoopPatch(p,orientLoopUses(p,edges.map(id=>closedBoundary(p,id))));
 }
 const a=addOnCurvePoint(p,edges[0]);p=setOnCurveS(a.project,a.selectedId,type==='loop'?.15:.4);
 const b=addOnCurvePoint(p,edges[1]);p=setOnCurveS(b.project,b.selectedId,type==='loop'?.3:.6);
 const hostId=p.patches![0].id,r=createOnPatch(p,hostId,a.selectedId,b.selectedId);
 return {project:r.project,curveId:r.selectedId,hostId,startId:a.selectedId};
}
