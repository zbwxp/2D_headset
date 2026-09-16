import {test,expect} from '@playwright/test';
test('empty project default points, one-step undo and duplicate source',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.load({...s.project,landmarks:[],curves:[],patches:[],loomisRegions:[],centerlineOrder:[],lockedViews:[]});});
 const section=page.getByRole('region',{name:'语义点',exact:true});
 await page.getByRole('button',{name:'+ 默认中线点',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.length)).toBe(1);
 await page.getByRole('button',{name:'+ 默认对称点',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.length)).toBe(3);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.length)).toBe(1);
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.length)).toBe(3);
});
