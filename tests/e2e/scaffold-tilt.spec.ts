import {test,expect} from '@playwright/test';
test('HeadFrame exposes cut distance, tilt and ring height with atomic undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 await page.evaluate(async()=>{const p='/src/domain/landmarks/presets.ts',f='/src/domain/head/frame.ts',sc='/src/domain/head/scaffold.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(sc)).ensureScaffold((await import(f)).migrateHeadFrame((await import(p)).createLandmarkProject())));s.setActiveModule('HEADSET');s.selectObject({kind:'frame',id:'head'});});
 const before=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisScaffold);
 for(const [name,value] of [['Horizontal Ring Height Y','0.1'],['Side Cap Tilt (about Z)','-20'],['Side Cut Distance','0.7']]){const slider=page.getByRole('slider',{name,exact:true});await expect(slider).toBeVisible();await slider.locator('..').locator('.numeric-slider-value').dblclick();const input=slider.locator('..').locator('.numeric-slider-entry');await input.fill(value);await input.press('Enter');}
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisScaffold)).toMatchObject({horizontalOffset:.1,sideTilt:-20,sidePosition:.7});
 await page.screenshot({path:'artifacts/scaffold/tilted-side.png'});
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.undo();s.undo();s.undo();});expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisScaffold)).toEqual(before);expect(errors).toEqual([]);
});
