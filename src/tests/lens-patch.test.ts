import {test,expect,vi} from 'vitest';
import saved from '../../tests/fixtures/lens-head.json';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addPatch,loop} from '../domain/patches/model';
import {baseEvaluator,evaluator,tessellate} from '../domain/patches/geometry';
import {boundaryGeometry} from '../domain/patches/boundary';
import {mirrorPoint} from '../domain/head/frame';
import {solveContinuity,fairDifferential} from '../domain/continuity/solver';
const ids=['a056605d-adca-4aee-928f-3cd201d65866','e52ce876-51ae-43b2-ac01-93d53c932ae6'];
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((x,i)=>x-b[i]));
test('actual jaw two edges auto form mirrored lens, exact boundaries and valid render mesh',()=>{
 const original=parseLandmarks(JSON.stringify(saved)),p=addPatch(original,ids),patch=p.patches!.at(-2)!,mirror=p.patches!.at(-1)!;expect(patch.type).toBe('lens');expect(p.patches!.length).toBe(original.patches!.length+2);expect(p.curves).toEqual(original.curves);expect(p.landmarks).toEqual(original.landmarks);
 const [a,b]=loop(p,patch.boundaryUses).map(r=>boundaryGeometry(p,r.use)),f=baseEvaluator(p,patch);
 for(let i=0;i<=20;i++){const u=i/20;expect(distance(f(u,0),a.evaluate(u))).toBeLessThan(1e-12);expect(distance(f(u,1),b.evaluate(1-u))).toBeLessThan(1e-12);expect(baseEvaluator(p,mirror)(u,.4)).toEqual(mirrorPoint(p,f(u,.4)));}
 for(const n of [4,12,24]){const mesh=tessellate(p,patch,n);expect(mesh.invalid).toBeUndefined();expect(mesh.triangles.length).toBeGreaterThan(0);expect(mesh.triangles.every(t=>new Set(t).size===3)).toBe(true);}
 expect(parseLandmarks(JSON.stringify(p)).patches).toEqual(p.patches);
});
test('lens Fullness / Continuity keep the two exact source boundaries',()=>{
 let p=addPatch(parseLandmarks(JSON.stringify(saved)),ids);const patch=p.patches!.at(-2)!;p={...p,patches:p.patches!.map(x=>x.id===patch.id?{...x,fullness:.25}:x)};const x=p.patches!.find(x=>x.id===patch.id)!,f=evaluator(p,x),base=baseEvaluator(p,x),result=solveContinuity(p),fair=fairDifferential(p,x,result);expect(result.patches[x.id].error).toBeUndefined();expect(tessellate(p,x,12).invalid).toBeUndefined();
 for(const u of [.1,.3,.7,.9])for(const v of [0,1]){expect(distance(f(u,v),base(u,v))).toBeLessThan(1e-12);expect(distance(fair(u,v).position,base(u,v))).toBeLessThan(1e-12);const h=v===0?1e-7:1-1e-7;expect(distance(f(u,h),base(u,h))/1e-7).toBeLessThan(1e-4);}
});
test('second edge creates immediately, one Undo/Redo, without an extra Create click',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});const {useEditor}=await import('../app/store');const s=()=>useEditor.getState();s().load(parseLandmarks(JSON.stringify(saved)));const n=s().project.patches!.length;s().startPatch();s().pickPatchEdge(ids[0]);expect(s().project.patches).toHaveLength(n);s().pickPatchEdge(ids[1]);expect(s().project.patches).toHaveLength(n+2);expect(s().patchCreation?.uses).toEqual([]);s().undo();expect(s().project.patches).toHaveLength(n);s().redo();expect(s().project.patches).toHaveLength(n+2);vi.unstubAllGlobals();
});
