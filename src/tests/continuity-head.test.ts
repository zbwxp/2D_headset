import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {solveContinuity,fairStats} from '../domain/continuity/solver';
import {installSmoothResult} from '../domain/continuity/evaluation';
import {evaluator,tessellate} from '../domain/patches/geometry';
it('actual 30-patch head: independent fairing, exact mirror and finite final surface',()=>{
 const p=parseLandmarks(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8')),before=JSON.stringify(p),start=performance.now(),r=solveContinuity(p),ms=performance.now()-start;
 expect(r.diagnostics.warnings).toEqual([]);for(const a of Object.values(r.diagnostics.angles)){expect(a.after).toBeLessThan(2);expect(a.solverSamples).toBeLessThan(2);}
 installSmoothResult(p,r);const meshes=p.patches!.map(x=>tessellate(p,x,24));
 expect(meshes.every(m=>!m.invalid)).toBe(true);expect(JSON.stringify(p)).toBe(before);
 for(const x of p.patches!)if(x.canonicalId){const a=evaluator(p,p.patches!.find(q=>q.id===x.canonicalId)!),b=evaluator(p,x);for(const [u,v] of [[.11,.22],[.33,.27],[.01,.7]]){const q=a(u,v);expect(b(u,v)).toEqual([-q[0],q[1],q[2]]);}}
 mkdirSync('artifacts/continuity',{recursive:true});writeFileSync('artifacts/continuity/head-diagnostics.json',JSON.stringify({ms,stats:fairStats,patches:Object.entries(r.patches).map(([id,x])=>({id,iterations:x.iterations,error:x.error})),...r.diagnostics},null,2));
});
