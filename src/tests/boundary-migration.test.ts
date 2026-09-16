import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parsePatches} from '../domain/patches/model';
import {tessellate} from './legacy-smooth-runtime';
import {solveSmooth} from '../domain/smooth/solver';
import {installSmoothResult} from '../domain/smooth/evaluation';
import {contourSource} from './legacy-smooth-runtime';
import {silhouette} from '../domain/contour/silhouette';
import type {LandmarkProject} from '../domain/landmarks/model';
const fixtures=JSON.parse(readFileSync('src/tests/fixtures/pre-boundary-use.json','utf8'));
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Captured using the pre-migration kernel from commit 28d54f5, not the new evaluator.
for(const [i,f] of fixtures.entries())it(`legacy geometry golden ${i}: exact base/fullness, Smooth, mesh and 768 contour`,()=>{
 const p:LandmarkProject={...f.project,patches:parsePatches(f.project.patches,f.project)};
 const off={...p,surfaceSmooth:{...p.surfaceSmooth!,enabled:false}};expect(hash(off.patches!.map(x=>tessellate(off,x,12)))).toBe(f.base);
 const result=solveSmooth(p);expect(hash(result)).toBe(f.smooth);installSmoothResult(p,result);expect(hash(p.patches!.map(x=>tessellate(p,x,12)))).toBe(f.final);
 expect(hash(silhouette(contourSource({...p,smoothResult:result}).mesh,[0,.25881904510252074,0,.9659258262890683],768))).toBe(f.contour);
});
