import {test,expect} from '@playwright/test';
test('3D camera corner angles update without editing source',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');const indicator=page.getByTestId('inspection-camera-angles');await expect(indicator).toBeVisible();
 const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {source:JSON.stringify(s.project),history:s.past.length};});const old=await indicator.textContent(),box=(await page.getByTestId('point-inspect').locator('canvas').boundingBox())!;
 await page.mouse.move(box.x+box.width*.8,box.y+box.height*.7);await page.mouse.down();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:10});await page.mouse.up();await expect(indicator).not.toHaveText(old!);
 expect(await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {source:JSON.stringify(s.project),history:s.past.length};})).toEqual(before);
 await page.evaluate(async()=>{const url='/src/ui/windows/state.ts';(await import(url)).useInspectionCamera.setState({quaternion:[0,0,0,1]});});await expect(indicator).toHaveText('Yaw 0.0°Pitch 0.0°');
 await page.evaluate(async()=>{const url='/src/ui/windows/state.ts';(await import(url)).useInspectionCamera.setState({quaternion:[-Math.sin(Math.PI/12),0,0,Math.cos(Math.PI/12)]});});await expect(indicator).toHaveText('Yaw 0.0°Pitch +30.0°');
});
test('pitch entry applies camera, preserves yaw/distance/target/history and cancels with Escape',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const state=()=>page.evaluate(async()=>{const url='/src/ui/windows/state.ts',c=(await import(url)).useInspectionCamera.getState(),s=(window as any).__editorPerfStore.getState();return {target:c.target,distance:Math.hypot(...c.position.map((v:number,i:number)=>v-c.target[i])),source:JSON.stringify(s.project),past:s.past.length};});const before=await state();
 const indicator=page.getByTestId('inspection-camera-angles'),yaw=(await indicator.textContent())!.split('Pitch')[0];
 await page.getByRole('button',{name:'Set Pitch',exact:true}).click();const input=page.getByRole('spinbutton',{name:'Pitch Value',exact:true});await input.fill('-17.5');await input.press('Enter');await expect(indicator).toHaveText(yaw+'Pitch -17.5°');
 const after=await state();expect(after.distance).toBeCloseTo(before.distance,10);expect(after.target).toEqual(before.target);expect(after.source).toBe(before.source);expect(after.past).toBe(before.past);
 await page.getByRole('button',{name:'Set Pitch',exact:true}).click();await input.fill('30');await input.press('Escape');await expect(indicator).toHaveText(yaw+'Pitch -17.5°');
 await page.getByRole('button',{name:'Set Pitch',exact:true}).click();await input.fill('25');await input.press('Tab');await expect(indicator).toHaveText(yaw+'Pitch +25.0°');
});
