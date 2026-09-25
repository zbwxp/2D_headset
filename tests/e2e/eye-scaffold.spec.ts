import {test,expect} from '@playwright/test';
test('default eye wire scaffold creation, slider edit, selection, history and persistence',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();
 const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {patches:s.project.patches,history:s.past.length};});
 await page.getByRole('button',{name:'Create Default Eye Scaffold',exact:true}).click();
 const created=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {eyes:s.project.eyeScaffold,patches:s.project.patches,history:s.past.length};});expect(created.patches.length).toBe((before.patches?.length??0)+2);expect(created.history).toBe(before.history+1);
 await page.getByRole('button',{name:'Right Eye',exact:true}).click();await expect(page.getByTestId('eye-controls')).toBeVisible();
 const slider=page.getByRole('slider',{name:'Cylinder Radius X',exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();const entry=slider.locator('..').locator('.numeric-slider-entry');await entry.fill('0.4');await entry.press('Enter');
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.eyeScaffold.parameters.radiusX)).toBe(.4);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.eyeScaffold.parameters.radiusX)).toBe(.25);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.selectCurve(s.project.eyeScaffold.left.curveIds[0]);});await expect(page.getByRole('button',{name:'Left Eye',exact:true})).toHaveAttribute('aria-expanded','true');
 const shared=await page.evaluate(()=>{const store=(window as any).__editorPerfStore;store.getState().beginEdit();store.getState().setEyeParameter('left','height',.9);store.getState().endEdit();return store.getState().project.eyeScaffold;});expect(shared.parameters.height).toBe(.9);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.eyeScaffold.parameters.height)).toBe(.7);
 await expect(page.locator(`[data-point-id="${created.eyes.left.pointIds[20]}"]`)).toHaveCount(0);
 const canvas=page.getByTestId('point-inspect').locator('canvas');await expect(canvas).toBeVisible();
 await page.screenshot({path:'artifacts/eyes/default-eye-scaffold.png'});
 const saved=await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts',p=JSON.stringify(e.project);e.load((await import(url)).parseLandmarks(p));return (window as any).__editorPerfStore.getState().project.eyeScaffold;});expect(saved.parameters.radiusX).toBe(.4);expect(saved.left.parameters).toBeUndefined();expect(saved.right.parameters).toBeUndefined();
 await page.getByTestId('geometry-modules').getByRole('button',{name:'HeadSet',exact:true}).click();
 const locked=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState(),before=JSON.stringify(s.project.eyeScaffold);s.setEyeParameter('right','height',1);s.selectCurve(s.project.eyeScaffold.right.curveIds[0]);return {same:before===JSON.stringify((window as any).__editorPerfStore.getState().project.eyeScaffold),selection:(window as any).__editorPerfStore.getState().selection};});expect(locked).toEqual({same:true,selection:null});
});
test('XYZ position sliders translate cylinder and eyeball together',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();await page.getByRole('button',{name:'Create Default Eye Scaffold',exact:true}).click();await page.getByRole('button',{name:'Right Eye',exact:true}).click();
 const positions=()=>page.evaluate(async()=>{const url='/src/domain/geometry/evaluation.ts',{pointPosition}=await import(url),s=(window as any).__editorPerfStore.getState(),e=s.project.eyeScaffold;return {R:s.project.headFrame.radiusX,left:e.left.pointIds.map((id:string)=>pointPosition(s.project,id)),right:e.right.pointIds.map((id:string)=>pointPosition(s.project,id))};});
 for(const [axis,label,value,delta] of [[0,'Group Position X (from Midline)',.7,.2],[1,'Group Position Y',-.1665315937744661,.2],[2,'Group Position Z',.7911634322080732,.2]] as const){const before=await positions(),slider=page.getByRole('slider',{name:label,exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();const input=slider.locator('..').locator('.numeric-slider-entry');await input.fill(String(value));await input.press('Enter');const after=await positions();for(const side of ['left','right'] as const)for(let i=0;i<23;i++)for(let a=0;a<3;a++)expect(after[side][i][a]-before[side][i][a]).toBeCloseTo(a===axis?delta*before.R*(axis===0&&side==='left'?-1:1):0,8);}
});
test('eyeball offset slider supports inward mirrored adjustment and Undo',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();await page.getByRole('button',{name:'Create Default Eye Scaffold',exact:true}).click();await page.getByRole('button',{name:'Right Eye',exact:true}).click();
 const slider=page.getByRole('slider',{name:'Eyeball X Offset (negative inward)',exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();const entry=slider.locator('..').locator('.numeric-slider-entry');await entry.fill('-0.12');await entry.press('Enter');expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.eyeScaffold.parameters.ballOffsetX)).toBe(-.12);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.eyeScaffold.parameters.ballOffsetX)).toBe(0);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.eyeScaffold.parameters.ballOffsetX)).toBe(-.12);
});
