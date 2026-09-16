import {migrateHeadFrame} from '../domain/head/frame';
import {contourSource} from './legacy-smooth-runtime';
import {silhouette} from '../domain/contour/silhouette';
import {solveKey,installSmoothResult,evaluationToken} from '../domain/smooth/evaluation';
import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {addOnCurvePoint,setOnCurveS,validatePlacements} from '../domain/landmarks/placement';
import {createCurve,deleteCurve} from '../domain/curves/management';
import {controls,followEndpoints,canonical,frame} from '../domain/curves/geometry';
import {GeometryEvaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {dependencyGraph} from '../domain/geometry/dependencies';
import {arcLengthLUT,normalizedArcLengthToT,tToNormalizedArcLength} from '../domain/geometry/bezier';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {duplicateLandmark,deleteLandmark,renameLandmark} from '../domain/landmarks/management';
import {mirror,setGlobalViewLock,allowedBasis,editingBasis,activateDriver,dragPosition,type LandmarkProject} from '../domain/landmarks/model';
import {dot,sub} from '../domain/geometry/core';
import {addPatch} from '../domain/patches/model';
import {evaluator} from '../domain/patches/geometry';
import {solveSmooth} from '../domain/smooth/solver';
import {defaultSmooth} from '../domain/smooth/model';
import {snapTowardTargets} from '../ui/shared/numericSliderMath';
const id=(p:LandmarkProject,n:string)=>p.landmarks.find(l=>l.name===n)!.id;
function fixture(){let p=createLandmarkProject();const x=createCurve(p,id(p,'右眉头点'),id(p,'右眉尾点'),p.views[0],'宿主');p=x.project;const host=x.selectedId;const a=addOnCurvePoint(p,host);p=a.project;const y=createCurve(p,a.selectedId,id(p,'右外眼角点'),p.views[0],'下游');p=y.project;const b=addOnCurvePoint(p,y.selectedId);p=b.project;const z=createCurve(p,b.selectedId,id(p,'右嘴角点'),p.views[0],'末端');return {p:z.project,host,a:a.selectedId,y:y.selectedId,b:b.selectedId,z:z.selectedId};}
const assertPlanar=(p:LandmarkProject)=>{for(const c of p.curves){const cp=controls(p,c),owner=canonical(p,c),n=c.role==='mirror'?mirror(owner.shape.planeNormal):owner.shape.planeNormal;for(const v of cp)expect(Math.abs(dot(sub(v,cp[0]),n))).toBeLessThan(1e-9);}};
describe('ON_CURVE source dependencies',()=>{
 it('arc-length inversion is not raw t; endpoints, duplicates and degenerate host',()=>{const lut=arcLengthLUT([[0,0,0],[0,0,0],[.05,0,0],[4,0,0]]);for(const s of [0,.25,.5,.75,1])expect(tToNormalizedArcLength(lut,normalizedArcLengthToT(lut,s))).toBeCloseTo(s,12);expect(normalizedArcLengthToT(lut,.5)).toBeGreaterThan(.75);expect(normalizedArcLengthToT([0,0,1,1,2],.5)).toBe(.75);expect(normalizedArcLengthToT(lut,-1)).toBe(0);expect(normalizedArcLengthToT(lut,2)).toBe(1);expect(()=>normalizedArcLengthToT([0,0],.5)).toThrow();});
 it('only canonical s persists, selected host side preserved, exact mirrored evaluation and cache',()=>{const {p,a}=fixture(),l=p.landmarks.find(l=>l.id===a)!,q=followEndpoints(p,setOnCurveS(p,l.mirrorPartnerId!,.4235)),ctx=new GeometryEvaluationContext(q);expect(ctx.pointPosition(l.mirrorPartnerId!)).toEqual(mirror(ctx.pointPosition(a)));expect(ctx.pointPosition(a)).toBe(ctx.pointPosition(a));const pair=q.landmarks.filter(x=>x.id===a||x.id===l.mirrorPartnerId);expect(pair.filter(x=>'s' in x.placement)).toHaveLength(1);expect(pair.every(x=>!('position' in x.placement))).toBe(true);expect(l.type).toBe('RIGHT');expect(parseLandmarks(JSON.stringify(q)).landmarks).toEqual(migrateHeadFrame(q).landmarks);});
 it('s changes host-independent position and transports every downstream plane',()=>{const {p,a,host,b,z}=fixture(),q=followEndpoints(p,setOnCurveS(p,a,.7));expect(controls(q,q.curves.find(c=>c.id===host)!)).toEqual(controls(p,p.curves.find(c=>c.id===host)!));expect(pointPosition(q,b)).not.toEqual(pointPosition(p,b));expect(controls(q,q.curves.find(c=>c.id===z)!)).not.toEqual(controls(p,p.curves.find(c=>c.id===z)!));assertPlanar(q);});
 it('host shape edits propagate multiple levels retaining s and handle scalars',()=>{const {p,host,a,b,z}=fixture(),owner=canonical(p,p.curves.find(c=>c.id===host)!);const changed={...p,curves:p.curves.map(c=>c.id===owner.id?{...owner,shape:{...owner.shape,startHandle:{along:.15,offset:.4}}}:c)};const q=followEndpoints(p,changed);for(const point of [a,b])expect(pointPosition(q,point)).not.toEqual(pointPosition(p,point));expect(q.landmarks).toEqual(p.landmarks);const old=canonical(p,p.curves.find(c=>c.id===z)!),next=canonical(q,q.curves.find(c=>c.id===z)!);expect(next.shape.startHandle).toEqual(old.shape.startHandle);expect(next.shape.endHandle).toEqual(old.shape.endHandle);assertPlanar(q);});
 it('cycle rejected by graph, load, creation and recursive guard',()=>{const {p,host,b}=fixture(),owner=canonical(p,p.curves.find(c=>c.id===host)!);const q={...p,curves:p.curves.map(c=>c.id===owner.id?{...owner,startLandmarkId:b}:c)};expect(()=>dependencyGraph(q)).toThrow(/循环/);expect(()=>parseLandmarks(JSON.stringify(q))).toThrow();expect(()=>pointPosition(q,b)).toThrow(/循环/);expect(()=>createCurve(q,b,id(q,'右嘴角点'),q.views[0],'bad')).toThrow();});
 it('deletion closure flows downstream, never upstream; duplicate and rename preserve hosts',()=>{const {p,host,a,b,z}=fixture();const removed=deleteCurve(p,host);expect(removed.curves).toHaveLength(0);expect(removed.landmarks.some(l=>l.id===a||l.id===b)).toBe(false);const pointRemoved=deleteLandmark(p,a);expect(pointRemoved.curves.some(c=>c.id===host)).toBe(true);expect(pointRemoved.curves.some(c=>c.id===z)).toBe(false);const copy=duplicateLandmark(p,a,'复制定位点'),l=copy.project.landmarks.find(l=>l.id===copy.selectedId)!;expect(l.type).toBe('RIGHT');expect(pointPosition(copy.project,l.id)).toEqual(pointPosition(p,a));expect(copy.project.curves).toEqual(p.curves);validatePlacements(copy.project);const renamed=renameLandmark(copy.project,l.id,'新名称');expect(renamed.landmarks.find(x=>x.id===l.mirrorPartnerId)!.name).toBe('左新名称');});
 it('global locks and driver activation never constrain locator',()=>{const {p,a}=fixture(),q=setGlobalViewLock(p,'right45',true,a);expect(q.landmarks.find(l=>l.id===a)!.viewLocks).toEqual({});expect(activateDriver(q,a)).toBe(q);expect(allowedBasis(q,a)).toEqual([]);expect(editingBasis(q,a,q.views[0])).toEqual([]);expect(()=>dragPosition(q,a,q.views[0],[1,1])).toThrow(/在线位置/);});
 it('centerline locator is single, sagittal, and excluded from guide order',()=>{const p=createLandmarkProject(),ids=p.centerlineOrder.slice(0,2),r=createCurve(p,ids[0],ids[1],p.views[0],'中线'),a=addOnCurvePoint(r.project,r.selectedId),l=a.project.landmarks.at(-1)!;expect(l.type).toBe('CENTERLINE');expect(l.mirrorPartnerId).toBeUndefined();expect(pointPosition(a.project,l.id)[0]).toBe(0);expect(a.project.centerlineOrder).toEqual(p.centerlineOrder);expect(parseLandmarks(JSON.stringify(a.project)).centerlineOrder).toEqual(p.centerlineOrder);});
 it('old WORLD JSON migrates positions and source controls without losses',()=>{const raw=JSON.parse(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8')),p=parseLandmarks(JSON.stringify(raw));p.landmarks.forEach(l=>pointPosition(p,l.id).forEach((v,i)=>expect(v).toBeCloseTo(raw.landmarks.find((x:any)=>x.id===l.id).position[i],12)));expect(p.curves).toEqual(raw.curves);expect(p.centerlineOrder).toEqual(raw.centerlineOrder);expect(parseLandmarks(JSON.stringify(p))).toEqual(p);});
 it('invalid host, s, persisted XYZ, and mirror ownership rejected',()=>{const {p,a}=fixture();for(const mutate of [(q:any)=>{q.landmarks.find((l:any)=>l.id===a).placement.hostCurveId='missing';},(q:any)=>{const l=q.landmarks.find((l:any)=>l.placement.role==='canonical');l.placement.s=2;},(q:any)=>{q.landmarks.find((l:any)=>l.id===a).position=[0,0,0];}]){const q=structuredClone(p);mutate(q);expect(()=>parseLandmarks(JSON.stringify(q))).toThrow();}});
 it('midpoint detent is shared and permits fine movement away',()=>{expect(snapTowardTargets(.512,.509,0,1,[.5])).toBe(.5);expect(snapTowardTargets(.5,.5005,0,1,[.5])).toBe(.5005);expect(snapTowardTargets(.48,.481,0,1,[.5])).toBe(.481);});
});

it('edit-start propagation is event-rate independent, host closure is one Undo and redo',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 const {useEditor}=await import('../app/store'),f=fixture(),s=()=>useEditor.getState();
 s().load(f.p);s().beginEdit();s().setOnCurveS(f.a,.73);s().endEdit();const direct=s().project;
 s().load(f.p);s().beginEdit();for(const value of [.52,.65,.4,.58,.73])s().setOnCurveS(f.a,value);s().endEdit();expect(s().project).toEqual(direct);
 s().beginEdit();s().setOnCurveS(f.a,.3);s().setOnCurveS(f.a,.73);s().endEdit();expect(s().project).toEqual(direct);
 const before=s().project,count=s().past.length;s().deleteCurve(f.host);expect(s().past.length).toBe(count+1);expect(s().project.curves.filter(c=>!('systemRole' in c&&c.systemRole))).toHaveLength(0);s().undo();expect(s().project).toEqual(before);s().redo();expect(s().project.curves.filter(c=>!('systemRole' in c&&c.systemRole))).toHaveLength(0);
});

it('locator invalidates Patch, Fullness, Smooth and final contour; delete cleans patch and overrides',()=>{
 const f=fixture();let p=f.p;const end=id(p,'右外眼角点'),tail=id(p,'右嘴角点');const ab=createCurve(p,end,tail,p.views[0],'外边');p=ab.project;const ac=createCurve(p,f.a,tail,p.views[0],'闭环');p=ac.project;
 p=addPatch(p,[f.y,ab.selectedId,ac.selectedId]);p={...p,patches:p.patches!.map(x=>({...x,...(!x.canonicalId?{fullness:.4}:{})})),surfaceSmooth:{...defaultSmooth,enabled:true,edgeInfluenceOverrides:{[canonical(p,p.curves.find(c=>c.id===f.y)!).id]:.4}}};
 const q=followEndpoints(p,setOnCurveS(p,f.a,.8)),patch=p.patches![0];expect(evaluator(p,patch)(.3,.3)).not.toEqual(evaluator(q,patch)(.3,.3));expect(solveKey(p)).not.toBe(solveKey(q));
 const r=solveSmooth(p),t=solveSmooth(q);expect(r.error).toBeUndefined();expect(t.error).toBeUndefined();installSmoothResult(p,r);installSmoothResult(q,t);expect(evaluationToken(p)).not.toBe(evaluationToken(q));
 const before=contourSource({...p,smoothResult:r}),after=contourSource({...q,smoothResult:t});expect(after.invalid).toEqual([]);expect(after.mesh.vertices).not.toEqual(before.mesh.vertices);expect(silhouette(after.mesh,[0,0,0,1],128).paths).not.toEqual(silhouette(before.mesh,[0,0,0,1],128).paths);
 const deleted=deleteCurve(q,f.host);expect(deleted.patches).toEqual([]);expect(deleted.surfaceSmooth!.edgeInfluenceOverrides).toEqual({});
});
it('WORLD upstream point movement propagates through two locators with strict symmetry',()=>{
 const {p,host,a,b,z}=fixture(),c=p.curves.find(c=>c.id===host)!,l=p.landmarks.find(l=>l.id===c.startLandmarkId)!,v=pointPosition(p,l.id),position:[number,number,number]=[v[0]+.05,v[1]+.1,v[2]+.08];
 const q=followEndpoints(p,{...p,landmarks:p.landmarks.map(x=>x.id===l.id?{...x,placement:{kind:'WORLD',position}}:x.id===l.mirrorPartnerId?{...x,placement:{kind:'WORLD',position:mirror(position)}}:x)});
 for(const point of [a,b])expect(pointPosition(q,point)).not.toEqual(pointPosition(p,point));expect(controls(q,q.curves.find(c=>c.id===z)!)).not.toEqual(controls(p,p.curves.find(c=>c.id===z)!));assertPlanar(q);expect(parseLandmarks(JSON.stringify(q)).landmarks).toEqual(migrateHeadFrame(q).landmarks);
});
it('either host side creates same-side selection without changing ownership; zero host rejected',()=>{
 const {p,host}=fixture(),c=p.curves.find(c=>c.id===host)!;
 for(const id of [c.id,c.mirrorPartnerCurveId!]){const r=addOnCurvePoint(p,id),point=r.project.landmarks.find(l=>l.id===r.selectedId)!;expect(point.placement.kind==='ON_CURVE'&&point.placement.hostCurveId).toBe(id);const cp=r.project.landmarks.slice(-2).find(l=>l.placement.kind==='ON_CURVE'&&l.placement.role==='canonical')!;expect(cp.placement.kind==='ON_CURVE'&&cp.placement.hostCurveId).toBe(canonical(p,c).id);}
 const source=createLandmarkProject(),r=createCurve(source,id(source,'右眉头点'),id(source,'右眉尾点'),source.views[0],'退化'),zero={...r.project,landmarks:r.project.landmarks.map(l=>({...l,placement:{kind:'WORLD' as const,position:[0,0,0] as [number,number,number]}}))};expect(()=>addOnCurvePoint(zero,r.selectedId)).toThrow(/退化/);
});
