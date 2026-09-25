import {it,expect} from 'vitest';
import {nextCurveName,repairCurveNames} from '../domain/curves/naming';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {spanFixture} from './span-fixture';
it('allocates beyond existing labels despite deletions or sparse numbers',()=>{
 expect(nextCurveName({curves:[{name:'左结构线 36'},{name:'右结构线 34'}] as any})).toBe('结构线 37');expect(nextCurveName({curves:[]})).toBe('结构线 1');
});
it('repairs distinct duplicate pairs once, without touching custom names or geometry',()=>{
 const p=spanFixture().p;const canonical=p.curves.filter(c=>c.role==='canonical');p.curves=p.curves.map(c=>({...c,name:(c.role==='mirror'?'左':'右')+'结构线 36'}));
 const r=repairCurveNames(p);expect(new Set(r.curves.filter(c=>c.role==='canonical').map(c=>c.name)).size).toBe(canonical.length);
 for(let i=0;i<p.curves.length;i++){const {name:a,...before}=p.curves[i],{name:b,...after}=r.curves[i];expect(after).toEqual(before);const m=r.curves.find(c=>c.id===r.curves[i].mirrorPartnerCurveId);if(m)expect(m.name.slice(1)).toBe(b.slice(1));}
 expect(repairCurveNames(r)).toBe(r);const custom={...createLandmarkProject(),curves:p.curves.map(c=>({...c,name:'自定义'}))};expect(repairCurveNames(custom)).toBe(custom);
});
