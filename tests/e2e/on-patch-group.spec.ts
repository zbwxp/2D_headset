import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const saved=JSON.parse(readFileSync('src/tests/fixtures/on-patch-group-11.json','utf8'));
test('saved 11 span authoring creates a mirrored face without recursive geometry evaluation',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.evaluate(p=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.startPatch();s.setPatchMode('span');},saved);
 // Use exactly the same host/anchor actions as 2D and 3D authoring.
 for(const [curve,a,b] of [
 ['543850dc-c756-4913-8055-c0b9efdf676c','f5535305-6f3a-44ef-b6b8-70fc5e5b65aa','e76c4972-b0f2-4817-be0f-2fcf5c730c26'],
 ['adfbbcc7-ba0d-479f-a4e2-482e4c861e98','e76c4972-b0f2-4817-be0f-2fcf5c730c26','903ce5d5-8c47-4700-afba-ca98389979ee'],
 ['fcca89a0-4f6d-4768-81f8-3387c9c6f67b','903ce5d5-8c47-4700-afba-ca98389979ee','f5535305-6f3a-44ef-b6b8-70fc5e5b65aa']
 ])await page.evaluate(([c,a,b])=>{const s=(window as any).__editorPerfStore.getState();s.pickPatchEdge(c);s.pickPatchAnchor(a);s.pickPatchAnchor(b);},[curve,a,b]);
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.length)).toBe(20);
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().message)).toContain('已创建 Patch');
 await page.locator('.surface-display > summary').click();await expect(page.getByTestId('continuity-status')).toHaveAttribute('data-state','ready',{timeout:20000});
 await page.screenshot({path:'artifacts/ear-diagnosis/on-patch-group-fixed.png'});
 expect(errors).toEqual([]);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().undo());
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.length)).toBe(18);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().redo());
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.length)).toBe(20);
 expect(errors).toEqual([]);
});
