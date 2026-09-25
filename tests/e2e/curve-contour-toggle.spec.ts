import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const saved=JSON.parse(readFileSync('src/tests/fixtures/on-patch-group-11.json','utf8'));
const id='543850dc-c756-4913-8055-c0b9efdf676c',mirror='e518dccb-2661-4ca0-95e3-22d5433a1478';
test('Contour checkbox preserves Free Curve geometry, mirrors, undoes and persists',async({page})=>{
 await page.goto('/');await page.evaluate(({saved,id})=>{const s=(window as any).__editorPerfStore.getState();s.load(saved);s.selectCurve(id);},{saved,id});
 const checkbox=page.getByRole('checkbox',{name:'显示在 Contour 中',exact:true});await expect(checkbox).not.toBeChecked();
 const before=await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);await checkbox.check();
 const p=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project);
 for(const key of [id,mirror])expect(p.curves.find((c:any)=>c.id===key)).toEqual({...saved.curves.find((c:any)=>c.id===key),contourRole:'OPEN_EDGE'});
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length)).toBe(before+1);
 await page.evaluate(id=>{const s=(window as any).__editorPerfStore.getState();s.undo();s.selectCurve(id);},id);await expect(checkbox).not.toBeChecked();
 await page.evaluate(id=>{const s=(window as any).__editorPerfStore.getState();s.redo();s.selectCurve(id);},id);await expect(checkbox).toBeChecked();
 await page.evaluate(async({p,mirror})=>{const path='/src/domain/landmarks/persistence.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(path)).parseLandmarks(JSON.stringify(p)));s.selectCurve(mirror);},{p,mirror});await expect(checkbox).toBeChecked();
 await checkbox.uncheck();expect(await page.evaluate(id=>(window as any).__editorPerfStore.getState().project.curves.find((c:any)=>c.id===id).contourRole,id)).toBe('NONE');
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('checkbox',{name:'Show in Contour',exact:true})).toBeVisible();
});
