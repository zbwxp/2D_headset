import {test,expect} from '@playwright/test';
test('Loomis offset controls, keyboard session, direct input and persistence',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {createLandmarkProject}=await import('/src/domain/landmarks/presets.ts' as string),{migrateHeadFrame}=await import('/src/domain/head/frame.ts' as string),{addSurfacePoint}=await import('/src/domain/head/surfacePoint.ts' as string);const p=migrateHeadFrame(createLandmarkProject());Object.assign(p,{landmarks:[],curves:[],patches:[],centerlineOrder:[]});const r=addSurfacePoint(p,[.5,.3,.8],false),s=(window as any).__editorPerfStore;s.getState().load(r.project);s.getState().selectLandmark(r.selectedId);});
 const slider=page.getByRole('slider',{name:'Offset X',exact:true});await expect(slider).toBeVisible();
 const read=()=>page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.landmarks.find((l:any)=>l.id===s.selectedId).placement.offsetX??0;});
 await slider.focus();await page.keyboard.down('ArrowRight');await page.waitForTimeout(900);await page.keyboard.up('ArrowRight');await slider.blur();expect(await read()).toBeGreaterThan(.01);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await read()).toBe(0);await page.getByRole('button',{name:'重做',exact:true}).click();expect(await read()).toBeGreaterThan(.01);
 await page.evaluate(() => {const s=(window as any).__editorPerfStore.getState();s.beginEdit(true);s.setLoomisOffset(s.selectedId,0,.2);s.endEdit();});
 const controls=page.getByTestId('loomis-offset');await controls.getByText('0.2 R',{exact:true}).dblclick();const input=controls.getByRole('textbox',{name:'Offset X 数值'});await input.fill('0.35');await input.press('Enter');expect(await read()).toBe(.35);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await read()).toBe(.2);await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>!!(window as any).__editorPerfStore);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.some((l:any)=>l.placement.offsetX===.2))).toBe(true);
});
