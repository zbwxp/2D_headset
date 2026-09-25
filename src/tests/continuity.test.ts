import {isDerived} from '../domain/curves/model';
import {describe,it,expect} from 'vitest';
import {smoothFixture} from './smooth-fixture';
import {solveContinuity,seamAngle,fairStats,patchFairKey,fairDifferential} from '../domain/continuity/solver';
import {relations,setRelationship,migrateContinuity} from '../domain/continuity/model';
import {baseEvaluator} from '../domain/patches/base';
import {sub} from '../domain/geometry/core';
describe('automatic exact-boundary continuity',()=>{
 it('coplanar shear is no-op',()=>{const p=smoothFixture(0,.7),r=solveContinuity(p);expect(r.diagnostics.warnings).toEqual([]);for(const x of Object.values(r.patches))expect(x.field).toBeUndefined();});
 it('fold improves at off-grid samples while boundary stays exact',()=>{const p=smoothFixture(.7),r=solveContinuity(p),seam=relations(p).find(r=>r.key==='seam')!;expect(r.diagnostics.warnings).toEqual([]);expect(seamAngle(p,seam,.473,r)).toBeLessThan(2);expect(seamAngle(p,seam,.473)).toBeGreaterThan(30);for(const patch of p.patches!){const f=fairDifferential(p,patch,r),base=baseEvaluator(p,patch);for(let k=0;k<=50;k++){const t=k/50;for(const [u,v] of [[t,0],[0,t],[1,t],[t,1]])expect(Math.hypot(...sub(f(u,v).position,base(u,v)))).toBeLessThan(1e-12);}}});
 it('crease removes pair, restores natural; third cancels only auto',()=>{let p=smoothFixture(.5);p=setRelationship(p,'seam',{mode:'crease'});expect(relations(p).find(r=>r.key==='seam')!.pair).toBeUndefined();expect(Object.values(solveContinuity(p).patches).every(x=>!x.field)).toBe(true);p=setRelationship(p,'seam',undefined);p.patches!.push({...p.patches![0],id:'third'});expect(relations(p).find(r=>r.key==='seam')!.pair).toBeUndefined();p=setRelationship(p,'seam',{mode:'manual',patchIds:['pa','pb']});expect(relations(p).find(r=>r.key==='seam')!.pair).toEqual(['pa','pb']);});
 it('fullness does not change fairing keys or solve count',()=>{const p=smoothFixture(.3);solveContinuity(p);const before=fairStats.solves,key=patchFairKey(p,p.patches![0]);const q={...p,patches:p.patches!.map(x=>({...x,fullness:.8}))};expect(patchFairKey(q,q.patches[0])).toBe(key);solveContinuity(q);expect(fairStats.solves).toBe(before);});
 it('legacy disabled migrates to Auto; explicit zero becomes crease',()=>{let p=smoothFixture(.4);p.surfaceSmooth!.enabled=false;expect(relations(migrateContinuity(p,undefined)).find(r=>r.key==='seam')!.mode).toBe('auto');p.surfaceSmooth!.edgeInfluenceOverrides.seam=0;expect(relations(migrateContinuity(p,undefined)).find(r=>r.key==='seam')!.mode).toBe('crease');});
});

import {wholeBoundary,boundaryKey,mirrorBoundary} from '../domain/patches/boundary';
import {repairContinuity} from '../domain/continuity/model';
import {installSmoothResult,getPatchSolution} from '../domain/continuity/evaluation';
import {tessellate,evaluator} from '../domain/patches/geometry';
import {spanFixture} from './span-fixture';
import {addPatch} from '../domain/patches/model';
import {createCurve} from '../domain/curves/management';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {vi} from 'vitest';
function addWing(p:ReturnType<typeof smoothFixture>,third=false){
 const points=third?[[0,0,2]]:[[2,-.64,1.4],[2,.36,1.4]];
 points.forEach((position,i)=>p.landmarks.push({id:'extra'+i,name:'extra'+i,type:'FREE',placement:{kind:'WORLD',position:position as [number,number,number]},viewLocks:{}}));
 const edge=(id:string,a:string,b:string)=>{p.curves.push({id,name:id,role:'canonical',startLandmarkId:a,endLandmarkId:b,shape:{planeNormal:[0,0,1],startHandle:{along:1/3,offset:0},endHandle:{along:1/3,offset:0}}});return id;};
 const es=third?['seam',edge('e0','v0','extra0'),edge('e1','extra0','v1')]:['b2',edge('e0','v4','extra0'),edge('e1','extra0','extra1'),edge('e2','extra1','v5')];
 p.patches!.push({id:'pc',type:third?'tri':'quad',boundaryUses:es.map(id=>wholeBoundary(p,id))});return p;
}
it('A natural change refairs A/B, but never feeds Fair B into target B/C',()=>{
 const p=addWing(smoothFixture(.62)),r=solveContinuity(p);installSmoothResult(p,r);const c=p.patches!.find(x=>x.id==='pc')!,mesh=tessellate(p,c,6),before=fairStats.solves;
 const q={...p,landmarks:p.landmarks.map(l=>l.id==='v2'&&l.placement.kind==='WORLD'?{...l,placement:{...l.placement,position:[l.placement.position[0],l.placement.position[1],1.9] as [number,number,number]}}:l)};
 expect(patchFairKey(p,c)).toBe(patchFairKey(q,c));expect(patchFairKey(p,p.patches![1])).not.toBe(patchFairKey(q,p.patches![1]));
 const next=solveContinuity(q);installSmoothResult(q,next);expect(fairStats.solves-before).toBe(2);expect(next.patches.pc).toBe(r.patches.pc);expect(tessellate(q,c,6)).toBe(mesh);
});
it('ear-like third patch is untouched by manual head pair and deletion restores Auto',()=>{
 let p=addWing(smoothFixture(.52),true);expect(relations(p).find(r=>r.key==='seam')!.pair).toBeUndefined();p=setRelationship(p,'seam',{mode:'manual',patchIds:['pa','pb']});const r=solveContinuity(p);
 expect(r.patches.pc.field).toBeUndefined();expect(r.patches.pa.field).toBeDefined();expect(r.patches.pb.field).toBeDefined();
 const restored=repairContinuity({...p,patches:p.patches!.filter(x=>x.id!=='pa')});expect(restored.surfaceContinuity?.overrides.seam).toBeUndefined();expect(relations(restored).find(r=>r.key==='seam')!.pair).toEqual(['pb','pc']);
});
it('temporary zero tangent preserves Manual intent and recovers on source restoration',()=>{
 const p=setRelationship(addWing(smoothFixture(.53),true),'seam',{mode:'manual',patchIds:['pa','pb']});const q={...p,curves:p.curves.map(c=>c.id==='seam'&&(c.role==='canonical'&&!isDerived(c))?{...c,shape:{...c.shape,startHandle:{along:1,offset:0},endHandle:{along:1,offset:0}}}:c)};
 expect(solveContinuity(q).patches.pa.error).toBeTruthy();expect(repairContinuity(q).surfaceContinuity).toEqual(p.surfaceContinuity);expect(solveContinuity(p).patches.pa.error).toBeUndefined();
});
it('exact and overlapping spans pair; mirror Crease and roundtrip',()=>{
 const f=spanFixture();let p=addPatch(f.p,[f.ac,f.bc,f.use]);const d=p.landmarks.find(l=>l.name==='右嘴角点')!.id;
 const ac=createCurve(p,f.a,d,p.views[0],'AD');p=ac.project;const bc=createCurve(p,f.b,d,p.views[0],'BD');p=bc.project;
 p=addPatch(p,[ac.selectedId,bc.selectedId,{...f.use,startLandmarkId:f.b,endLandmarkId:f.a}]);const key=boundaryKey(p,f.use),mk=boundaryKey(p,mirrorBoundary(p,f.use));expect(relations(p).find(r=>r.key===key)!.pair).toHaveLength(2);
 const before=JSON.stringify([p.landmarks,p.curves,p.patches]);p=setRelationship(p,key,{mode:'crease'});expect(p.surfaceContinuity!.overrides[mk]).toEqual({mode:'crease'});expect(JSON.stringify([p.landmarks,p.curves,p.patches])).toBe(before);
 expect(parseLandmarks(JSON.stringify(p)).surfaceContinuity).toEqual(p.surfaceContinuity);
 const other={...f.use,endLandmarkId:p.curves.find(c=>c.id===f.host)!.endLandmarkId!};const q={...p,patches:p.patches!.map((x,i)=>i===2?{...x,boundaryUses:x.boundaryUses.map(b=>boundaryKey(p,b)===key?other:b)}:x)};expect(relations(q).find(r=>r.key===key)!.patchIds).toHaveLength(2);
});
it('Fullness applied after Fair: exact boundary derivatives and scaled normal amplitude',()=>{
 const p=smoothFixture(.61),r=solveContinuity(p);installSmoothResult(p,r);const q={...p,patches:p.patches!.map(x=>({...x,fullness:.7}))},x=q.patches[0],base=evaluator(p,p.patches![0]),f=evaluator(q,x);
 expect(getPatchSolution(q,x)).toBe(getPatchSolution(p,x));expect(f(.5,.5)).not.toEqual(base(.5,.5));for(const t of [.13,.39,.73]){expect(f(t,0)).toEqual(base(t,0));const h=1e-7;expect(Math.hypot(...sub(f(t,h),base(t,h)))/h).toBeLessThan(1e-5);}
});
it('relationship edits are one Undo step and redo preserves explicit intent',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});const {useEditor}=await import('../app/store');const p=smoothFixture(.49);p.views=createLandmarkProject().views;const s=()=>useEditor.getState();s().load(p);const n=s().past.length;s().setContinuity('seam',{mode:'crease'});expect(s().past.length).toBe(n+1);expect(s().project.surfaceContinuity?.overrides.seam).toEqual({mode:'crease'});s().undo();expect(s().project.surfaceContinuity).toBeUndefined();s().redo();expect(s().project.surfaceContinuity?.overrides.seam).toEqual({mode:'crease'});vi.unstubAllGlobals();
});
it('self-symmetric whole patch fairing remains reflection-equivariant',()=>{
 let p=smoothFixture();p={...p,landmarks:[],curves:[],patches:[]};const positions:Record<string,[number,number,number]>={b:[0,0,1],t:[0,1,1],l:[-1,.5,1],r:[1,.5,1],o:[-1,1.5,2],q:[1,1.5,2]},partner:Record<string,string>={l:'r',r:'l',o:'q',q:'o',b:'b',t:'t'};
 for(const [id,position]of Object.entries(positions))p.landmarks.push({id,name:id,placement:{kind:'WORLD',position},type:['t','b'].includes(id)?'CENTERLINE':id==='l'||id==='o'?'LEFT':'RIGHT',...(['t','b'].includes(id)?{}:{mirrorPartnerId:partner[id]}),viewLocks:{}});
 for(const [id,a,b]of [['tl','t','l'],['lb','l','b'],['lo','l','o'],['ot','o','t']]){p.curves.push({id,name:id,startLandmarkId:a,endLandmarkId:b,role:'canonical',mirrorPartnerCurveId:id+'m',shape:{planeNormal:[0,0,1],startHandle:{along:1/3,offset:0},endHandle:{along:1/3,offset:0}}});p.curves.push({id:id+'m',name:id+'m',role:'mirror',canonicalCurveId:id,mirrorPartnerCurveId:id,startLandmarkId:partner[a],endLandmarkId:partner[b]});}
 p=addPatch(addPatch(p,['tl','lb','lbm','tlm']),['tl','lo','ot']);const result=solveContinuity(p);expect(result.patches[p.patches![0].id].error).toBeUndefined();installSmoothResult(p,result);
 const {boundaryUses}=p.patches![0];const bs=loop(p,boundaryUses),perm=bs.map(b=>bs.findIndex(q=>q.vertex===partner[b.vertex])),f=evaluator(p,p.patches![0]);
 for(const [u,v]of [[.13,.22],[.34,.57],[.5,.5]]){const w=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v],m=perm.map(i=>w[i]),a=f(u,v),b=f(m[1]+m[2],m[2]+m[3]);expect(b[0]).toBeCloseTo(-a[0],11);expect(b[1]).toBeCloseTo(a[1],11);expect(b[2]).toBeCloseTo(a[2],11);}
});
import {loop} from '../domain/patches/model';
it('curved reversed CurveSpan drives both numerical surfaces without changing its cubic',()=>{
 const f=spanFixture();let p=addPatch(f.p,[f.ac,f.bc,f.use]);const d=p.landmarks.find(l=>l.name==='右嘴角点')!,v:[number,number,number]=[-.4,.95,.65];p={...p,landmarks:p.landmarks.map(l=>l.id===d.id?{...l,placement:{kind:'WORLD',position:v}}:l.id===d.mirrorPartnerId?{...l,placement:{kind:'WORLD',position:[-v[0],v[1],v[2]]}}:l)};
 const ac=createCurve(p,f.a,d.id,p.views[0],'AD');p=ac.project;const bc=createCurve(p,f.b,d.id,p.views[0],'BD');p=addPatch(bc.project,[ac.selectedId,bc.selectedId,{...f.use,startLandmarkId:f.b,endLandmarkId:f.a}]);
 const result=solveContinuity(p);expect(Object.values(result.patches).every(x=>!x.error)).toBe(true);const seam=relations(p).find(r=>r.key===boundaryKey(p,f.use))!;
 for(const t of [.213,.475,.726])expect(seamAngle(p,seam,t,result)).toBeLessThan(2);
});
