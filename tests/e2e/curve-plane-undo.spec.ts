import {test,expect} from '@playwright/test';
import {spanFixture} from '../../src/tests/span-fixture';
import {controls} from '../../src/domain/curves/geometry';
test('legacy planar source migrates exactly and no longer exposes Curve Plane controls',async({page})=>{
 await page.goto('/');const f=spanFixture(),before=controls(f.p,f.p.curves.find(c=>c.id===f.ac)!);
 await page.evaluate(({p,id})=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.selectCurve(id);},{p:f.p,id:f.ac});
 await expect(page.getByTestId('free3d-inspector')).toBeVisible();await expect(page.locator('.curve-plane')).toHaveCount(0);
 const loaded=await page.evaluate(async id=>{const path='/src/domain/geometry/evaluation.ts',s=(window as any).__editorPerfStore.getState();return {shape:s.project.curves.find((c:any)=>c.id===id).shape,cp:(await import(path)).evaluationContext(s.project).sourceCurveControls(id)};},f.ac);
 expect(loaded.shape.kind).toBe('FREE_3D');expect(loaded.shape.planeNormal).toBeUndefined();loaded.cp.forEach((v:number[],i:number)=>v.forEach((x,k)=>expect(x).toBeCloseTo(before[i][k],11)));
 await page.reload();await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),f.ac);await expect(page.getByTestId('free3d-inspector')).toBeVisible();await expect(page.locator('.curve-plane')).toHaveCount(0);
});
