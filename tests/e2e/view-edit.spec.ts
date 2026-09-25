import {test,expect} from '@playwright/test';
test('custom view popup edits and deletes with undo',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 await page.evaluate(()=>{(window as any).__editorPerfStore.getState().addView('Test View',25,15);});
 await page.getByRole('button',{name:'Test View',exact:true}).click();
 await expect(page.getByRole('region',{name:'Edit View',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Test View',exact:true}).dblclick();
 const panel=page.getByRole('region',{name:'Edit View',exact:true});await expect(panel).toBeVisible();
 await panel.getByRole('textbox').fill('Edited View');
 await panel.getByRole('slider').nth(1).fill('30');
 await panel.getByRole('button',{name:'Save Changes',exact:true}).click();
 const state=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.views.find((v:any)=>v.id===s.viewId);});expect(state.label).toBe('Edited View');expect(state.camera.position[1]).toBeCloseTo(2);
 await page.getByRole('button',{name:'Edited View',exact:true}).dblclick();await panel.getByRole('button',{name:'Delete View',exact:true}).click();await expect(page.getByRole('button',{name:'Edited View',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{(window as any).__editorPerfStore.getState().undo();});await expect(page.getByRole('button',{name:'Edited View',exact:true})).toBeVisible();
});

test('preset views can be edited/deleted and remain so after loading',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const label=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.views.find((v:any)=>v.id==='right30').label;});
 const tabs=page.locator('.point-view-tabs');
 const button=tabs.locator('button').filter({hasText:/右 30°|Right 30°/}).first();
 await button.click();await expect(page.getByRole('region',{name:'Edit View',exact:true})).toHaveCount(0);
 await button.dblclick();const panel=page.getByRole('region',{name:'Edit View',exact:true});await expect(panel).toBeVisible();
 await panel.getByRole('textbox').fill('Changed preset');await panel.getByRole('slider').first().fill('35');await panel.getByRole('button',{name:'Save Changes',exact:true}).click();
 await tabs.getByRole('button',{name:'Changed preset',exact:true}).dblclick();await panel.getByRole('button',{name:'Delete View',exact:true}).click();
 const restored=await page.evaluate(async()=>{const url='/src/domain/landmarks/persistence.ts',s=(window as any).__editorPerfStore.getState();return (await import(url)).parseLandmarks(JSON.stringify(s.project)).views.map((v:any)=>v.id);});expect(restored).not.toContain('right30');
 await page.evaluate(()=>{(window as any).__editorPerfStore.getState().undo();});await expect(tabs.getByRole('button',{name:'Changed preset',exact:true})).toBeVisible();
 expect(label).toBeTruthy();
});
