import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('eye study 3 loads both lid surfaces and renders contour without errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.evaluate(async raw=>{const parser='/src/domain/landmarks/persistence.ts',windows='/src/ui/windows/state.ts',p=(await import(parser)).parseLandmarks(raw),s=(window as any).__editorPerfStore.getState();s.load(p);s.setActiveModule('EYES');},readFileSync('/Users/bowen/Desktop/眼部研究3.json','utf8'));
 await page.locator('.window-controls input[type=checkbox]').nth(1).check();
 await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false',{timeout:30000});
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.filter((p:any)=>(window as any).__editorPerfStore.getState().project.geometryModules[p.id]==='EYES').length)).toBe(2);
 await page.screenshot({path:'artifacts/eyes/eye-patch-display-fixed.png'});expect(errors).toEqual([]);
});
