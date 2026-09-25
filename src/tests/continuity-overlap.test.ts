import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {relations,setRelationship,repairContinuity} from '../domain/continuity/model';
import {edgeFrame,naturalDifferential,solveContinuity} from '../domain/continuity/solver';
import {boundaryGeometry,boundaryKey,mirrorBoundary} from '../domain/patches/boundary';
const project=()=>parseLandmarks(readFileSync('tests/fixtures/continuity-overlap-head.json','utf8'));
test('saved Curve 47 partitions into paired subspans and maps to exact source on both surfaces',()=>{
 const p=project(),id=p.curves.find(c=>c.name==='左结构线 47')!.id,rs=relations(p).filter(r=>r.use.curveId===id);
 expect(rs.length).toBe(2);expect(rs.every(r=>r.pair?.length===2)).toBe(true);
 for(const r of rs)for(const id of r.pair!)for(const t of [.1,.4,.8]){
  const patch=p.patches!.find(x=>x.id===id)!,f=edgeFrame(p,patch,r,t),actual=naturalDifferential(p,patch)(f.uv[0],f.uv[1]).position,target=boundaryGeometry(p,r.use).evaluate(t);
  expect(Math.hypot(...actual.map((x,k)=>x-target[k]))).toBeLessThan(1e-7);
 }
 const result=solveContinuity(p);console.log('overlap solve',result.diagnostics.warnings);
 for(const r of rs)for(const id of r.pair!)expect(result.patches[p.patches!.find(x=>x.id===id)!.canonicalId??id]?.error).toBeUndefined();
});
test('Crease edits only one subspan and its mirror; roundtrip and restore retain other relationships',()=>{
 const p=project(),rs=relations(p).filter(r=>r.use.curveId===p.curves.find(c=>c.name==='左结构线 47')!.id),r=rs[0],other=rs[1];
 const q=setRelationship(p,r.key,{mode:'crease'}),mk=boundaryKey(q,mirrorBoundary(q,r.use));
 expect(relations(q).find(x=>x.key===r.key)!.mode).toBe('crease');expect(relations(q).find(x=>x.key===mk)!.mode).toBe('crease');expect(relations(q).find(x=>x.key===other.key)!.mode).toBe('auto');
 expect(parseLandmarks(JSON.stringify(q)).surfaceContinuity).toEqual(q.surfaceContinuity);
 expect(relations(setRelationship(q,r.key,undefined)).find(x=>x.key===r.key)!.mode).toBe('auto');
 expect([q.landmarks,q.curves,q.patches]).toEqual([p.landmarks,p.curves,p.patches]);
 const oldKey=boundaryKey(p,Object.values(r.sources!).find(b=>boundaryKey(p,b)!==r.key)!);
 const old={...p,surfaceContinuity:{overrides:{[oldKey]:{mode:'crease' as const}}}};
 const repaired=repairContinuity(old);expect(relations(repaired).filter(x=>x.use.curveId===r.use.curveId).every(x=>x.mode==='crease')).toBe(true);
});
