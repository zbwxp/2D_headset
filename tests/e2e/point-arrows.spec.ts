import {test,expect} from '@playwright/test';
test('point arrow tap, held Undo, modifiers, oblique Z and slider isolation',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.reset();s.addDefaultPoint(false);s.selectView('front');});
 const read=()=>page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.landmarks.find((l:any)=>l.id===s.selectedId).placement;});
 const workspace=page.locator('.point-workspace');await workspace.focus();const old=await read();await page.keyboard.press('ArrowRight');expect((await read()).position[0]).toBeCloseTo(old.position[0]+.005);await page.keyboard.down('ArrowUp');await page.waitForTimeout(540);await page.keyboard.up('ArrowUp');expect((await read()).position[1]).toBeGreaterThan(old.position[1]+.01);await page.evaluate(()=>(window as any).__editorPerfStore.getState().undo());expect((await read()).position[1]).toBe(old.position[1]);
 await page.keyboard.press('Alt+ArrowRight');expect((await read()).position[0]).toBeCloseTo(old.position[0]+.006);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().selectView('right30'));await page.keyboard.press('ArrowUp');expect((await read()).position[2]).toBeCloseTo(old.position[2]+.005);
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.selectLandmark(s.project.landmarks.find((l:any)=>l.systemRole==='APEX_R').id);});await workspace.focus();await page.keyboard.press('ArrowUp');expect((await read()).offsetZ).toBe(.005);
 const h=page.getByRole('slider',{name:'Height',exact:true});await h.focus();await h.press('ArrowRight');expect((await read()).offsetZ).toBe(.005);
});
