import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {smoothFixture} from './smooth-fixture';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {solveContinuity,solvePatch,naturalDifferential,fairDifferential,acceptanceKey,patchFairKey,solveSafePatch} from '../domain/continuity/solver';
import {validateSmoothSurface} from '../domain/continuity/safety';
import {installSmoothResult,getPatchSolution} from '../domain/continuity/evaluation';
import {setRelationship,relations} from '../domain/continuity/model';
import {baseEvaluator,fullnessEvaluator} from '../domain/patches/base';
import {evaluator} from '../domain/patches/geometry';
import type {Differential} from '../domain/continuity/solver';
import type {Vec3} from '../domain/project/types';
const saved=(n:number)=>parseLandmarks(readFileSync(`src/tests/fixtures/smooth-safety-${n}.json`,'utf8'));
const plane:Differential=(u,v)=>({position:[u,v,0],du:[1,0,0],dv:[0,1,0]});
const scaled=(f:Differential,k:number):Differential=>(u,v)=>{const q=f(u,v);return{position:q.position.map(x=>x*k)as Vec3,du:q.du.map(x=>x*k)as Vec3,dv:q.dv.map(x=>x*k)as Vec3};};
describe('Surface Smooth Safety Guard',()=>{
 it('old saved model rejects whole connected group, preserves relations and exact Natural/mirror',()=>{
  const p=saved(9),before=JSON.stringify(p),r=solveContinuity(p),bad=r.diagnostics.safety!.find(g=>!g.accepted)!;expect(bad).toBeDefined();expect(bad.reason).toBe('normal-change');expect(Math.max(...Object.values(bad.patches).map(x=>x.maxNormalDeviation))).toBeGreaterThan(90);
  for(const id of bad.patchIds){expect(r.patches[id].field).toBeUndefined();expect(r.patches[id].shapeProtection).toBeDefined();}
  for(const rel of relations(p).filter(r=>r.pair)){const ids=rel.pair!.map(id=>p.patches!.find(x=>x.id===id)!.canonicalId??id);expect(ids.map(id=>!!r.patches[id].shapeProtection)).toEqual([!!r.patches[ids[0]].shapeProtection,!!r.patches[ids[0]].shapeProtection]);}
  installSmoothResult(p,r);for(const x of p.patches!){const owner=x.canonicalId??x.id;if(!bad.patchIds.includes(owner))continue;expect(evaluator(p,x)(.31,.27)).toEqual(fullnessEvaluator(p,x)(.31,.27));}
  expect(JSON.stringify(p)).toBe(before);
 });
 it('new saved model passes and accepted candidate coefficients are exactly unchanged',()=>{
  const p=saved(10),r=solveContinuity(p);expect(r.diagnostics.safety!.every(g=>g.accepted)).toBe(true);
  for(const x of p.patches!.filter(x=>!x.canonicalId)){expect(r.patches[x.id]).toBe(solvePatch(p,x));expect(fairDifferential(p,x,r)(.27,.33)).toEqual(fairDifferential(p,x,{patches:{[x.id]:solvePatch(p,x)},diagnostics:{warnings:[],angles:{}}})(.27,.33));}
 });
 it('ordinary crease passes; artificial severe solved candidate rejects without model UUID special cases',()=>{
  const mild=smoothFixture(Math.tan(10*Math.PI/180)),good=solveContinuity(mild);expect(good.diagnostics.safety!.every(x=>x.accepted)).toBe(true);expect(good.patches.pa.field).toBeDefined();
  const severe=smoothFixture(10);expect(solvePatch(severe,severe.patches![0]).field).toBeDefined();expect(solveContinuity(severe).diagnostics.safety!.some(g=>!g.accepted)).toBe(true);
 });
 it('geometry restoration reactivates without persisting a rejection',()=>{const p=smoothFixture(.2),q=smoothFixture(10);const first=solveContinuity(p);solveContinuity(q);expect(solveContinuity(p).patches.pa).toBe(first.patches.pa);expect(first.patches.pa.field).toBeDefined();expect(JSON.stringify(q)).not.toContain('shapeProtection');});
 it('group acceptance cache invalidates even when this patch local candidate key is unchanged',()=>{
  const p=saved(10),r=solveContinuity(p);installSmoothResult(p,r);
  const q={...p,landmarks:p.landmarks.map(l=>l.id==='903ce5d5-8c47-4700-afba-ca98389979ee'&&l.placement.kind==='FRAME_RELATIVE'?{...l,placement:{...l.placement,position:[l.placement.position[0]+.01,...l.placement.position.slice(1)]as Vec3}}:l)};
  const unchanged=p.patches!.find(x=>!x.canonicalId&&patchFairKey(p,x)===patchFairKey(q,x)&&acceptanceKey(p,x)!==acceptanceKey(q,x))!;expect(unchanged).toBeDefined();expect(getPatchSolution(q,unchanged)).toBeUndefined();
 });
 it('synchronous safe patch path rejects the same group as worker path',()=>{const p=saved(9),r=solveContinuity(p);for(const x of p.patches!.filter(x=>!x.canonicalId))expect(solveSafePatch(p,x)).toBe(r.patches[x.id]);});
 it('Crease/OFF has no safety sampling and preserves existing Natural exactly',()=>{const p=setRelationship(smoothFixture(.3),'seam',{mode:'crease'}),r=solveContinuity(p);expect(r.diagnostics.safety).toEqual([]);installSmoothResult(p,r);for(const x of p.patches!)expect(evaluator(p,x)(.31,.27)).toEqual(fullnessEvaluator(p,x)(.31,.27));});
 it('all domains accept identical geometry, lens poles skip only undefined Natural normals',()=>{
  for(const t of ['tri','quad','lens','loop']as const)expect(validateSmoothSurface(t,plane,plane,1).accepted).toBe(true);
  const lens:Differential=(u,v)=>({position:[u,v*u*(1-u),0],du:[1,v*(1-2*u),0],dv:[0,u*(1-u),0]});const r=validateSmoothSurface('lens',lens,lens,1);expect(r.accepted).toBe(true);expect(r.skippedNaturalSamples).toBeGreaterThan(0);
 });
 it('finite, displacement, directed normal and Jacobian guards work independently',()=>{
  const bad:Differential=()=>({position:[NaN,0,0],du:[1,0,0],dv:[0,1,0]});expect(validateSmoothSurface('quad',plane,bad,1).reason).toBe('invalid-geometry');
  const move:Differential=(u,v)=>({...plane(u,v),position:[u,v,.3]});expect(validateSmoothSurface('quad',plane,move,1).reason).toBe('relative-displacement');
  const fold:Differential=(u,v)=>({position:[u,v*Math.cos(1.5),v*Math.sin(1.5)],du:[1,0,0],dv:[0,Math.cos(1.5),Math.sin(1.5)]});expect(validateSmoothSurface('quad',plane,fold,10).reason).toBe('normal-change');
  const thin:Differential=(u,v)=>({position:[u,v*.01,0],du:[1,0,0],dv:[0,.01,0]});expect(validateSmoothSurface('quad',plane,thin,10).reason).toBe('jacobian-degradation');
 });
 it('scale 0.1 / 1 / 10 preserves guard results and real solver acceptance',()=>{
  for(const fold of [.15,10]){const results=[.1,1,10].map(k=>{const p=smoothFixture(fold);p.landmarks=p.landmarks.map(l=>({...l,placement:{kind:'WORLD',position:(l.placement as {position:Vec3}).position.map(x=>x*k)as Vec3}}));return solveContinuity(p).diagnostics.safety!.map(x=>x.accepted);});expect(results[0]).toEqual(results[1]);expect(results[1]).toEqual(results[2]);}
  const moved:Differential=(u,v)=>({...plane(u,v),position:[u,v,.3]});for(const k of [.1,1,10]){const r=validateSmoothSurface('quad',scaled(plane,k),scaled(moved,k),k);expect(r.reason).toBe('relative-displacement');expect(r.maxRelativeDisplacement).toBeCloseTo(.3,12);}
 });
});
