import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addPatch} from '../domain/patches/model';
import {dependencyGraph} from '../domain/geometry/dependencies';
import {evaluationContext} from '../domain/geometry/evaluation';
import {solveContinuity} from '../domain/continuity/solver';
import {installSmoothResult} from '../domain/continuity/evaluation';
import {tessellate,evaluator,fullnessEvaluator} from '../domain/patches/geometry';
const free='543850dc-c756-4913-8055-c0b9efdf676c',hosted='fcca89a0-4f6d-4768-81f8-3387c9c6f67b';
function fixture(){const p=parseLandmarks(readFileSync('src/tests/fixtures/on-patch-group-11.json','utf8'));return addPatch(p,[
 {curveId:free,startLandmarkId:'f5535305-6f3a-44ef-b6b8-70fc5e5b65aa',endLandmarkId:'e76c4972-b0f2-4817-be0f-2fcf5c730c26'},
 {curveId:'adfbbcc7-ba0d-479f-a4e2-482e4c861e98',startLandmarkId:'e76c4972-b0f2-4817-be0f-2fcf5c730c26',endLandmarkId:'903ce5d5-8c47-4700-afba-ca98389979ee'},
 {curveId:hosted,startLandmarkId:'903ce5d5-8c47-4700-afba-ca98389979ee',endLandmarkId:'f5535305-6f3a-44ef-b6b8-70fc5e5b65aa'}]);}
it('saved 11 creates the 56/49/ON_PATCH span face and evaluates final geometry without acceptance recursion',()=>{
 const p=fixture(),source=JSON.stringify(p);expect(p.patches).toHaveLength(20);expect(()=>dependencyGraph(p)).not.toThrow();
 for(const id of [free,hosted])expect(evaluationContext(p).curve(id).sample().flat().every(Number.isFinite)).toBe(true);
 const r=solveContinuity(p);installSmoothResult(p,r);
 for(const x of p.patches!){const mesh=tessellate(p,x,8);expect(mesh.invalid).toBeUndefined();expect(mesh.triangles.length).toBeGreaterThan(0);
 if(r.patches[x.canonicalId??x.id]?.shapeProtection)expect(evaluator(p,x)(.23,.31)).toEqual(fullnessEvaluator(p,x)(.23,.31));}
 expect(JSON.stringify(p)).toBe(source);
 const q=parseLandmarks(source);expect(evaluationContext(q).curve(free).evaluate(.4)).toEqual(evaluationContext(p).curve(free).evaluate(.4));
});
