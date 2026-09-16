import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {savedProject} from '../helpers/persistence';
const raw=JSON.parse(readFileSync('artifacts/head-frame/source.json','utf8'));
test('Loomis resize preserves parameters, updates views, one undo and save/load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(p=>{if(!localStorage.getItem('contour.landmarks.v039'))localStorage.setItem('contour.landmarks.v039',JSON.stringify(p));},raw);await page.goto('/');await page.waitForFunction(()=>!!(window as any).__editorPerfStore);await page.locator('.head-frame-panel summary').click();
 const before=await savedProject(page);expect(before.landmarks.every((l:any)=>l.placement.kind!=='WORLD')).toBe(true);await expect(page.getByTestId('loomis-wire')).toHaveCount(3);
 const width=page.getByRole('slider',{name:'Width',exact:true});await width.focus();await width.press('ArrowRight');await width.blur();const after=await savedProject(page);expect(after.headFrame.radiusX).toBeGreaterThan(before.headFrame.radiusX);expect(after.landmarks).toEqual(before.landmarks);expect(after.patches).toEqual(before.patches);for(let i=0;i<after.curves.length;i++)if(after.curves[i].shape){expect(after.curves[i].shape.startHandle).toEqual(before.curves[i].shape.startHandle);expect(after.curves[i].shape.endHandle).toEqual(before.curves[i].shape.endHandle);}
 await page.waitForFunction(async()=>{const m=await import('/src/domain/continuity/evaluation.ts' as string);return !!m.getSmoothResult((window as any).__editorPerfStore.getState().project);});
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await savedProject(page)).headFrame).toEqual(before.headFrame);await page.getByRole('button',{name:'重做',exact:true}).click();expect((await savedProject(page)).headFrame).toEqual(after.headFrame);
 await page.reload();await page.locator('.head-frame-panel summary').click();expect((await savedProject(page)).headFrame).toEqual(after.headFrame);
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');await expect(page.getByTestId('contour-silhouette').locator('path')).not.toHaveCount(0);await page.screenshot({path:'artifacts/head-frame/editor.png'});
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.setViewLock('front',true);});await expect(width).toBeDisabled();await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.setViewLock('front',false);});await expect(width).toBeEnabled();expect(errors).toEqual([]);
});

test('mouse resize supports focused Cmd/Ctrl-Z, redo and one transaction per axis',async({page})=>{
 await page.addInitScript(p=>localStorage.setItem('contour.landmarks.v039',JSON.stringify(p)),raw);await page.goto('/');await page.locator('.head-frame-panel summary').click();
 for(const [label,axis] of [['Width','radiusX'],['Height','radiusY'],['Depth','radiusZ']]){
  const slider=page.getByRole('slider',{name:label,exact:true});const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {frame:s.project.headFrame,past:s.past.length};});
  const box=(await slider.boundingBox())!;await page.mouse.move(box.x+box.width*.38,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.48,box.y+box.height/2,{steps:10});await page.mouse.up();await expect(slider).toBeFocused();
  const after=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {frame:s.project.headFrame,past:s.past.length};});expect(after.frame[axis]).not.toBe(before.frame[axis]);expect(after.past).toBe(before.past+1);
  await slider.press('Meta+z');expect((await savedProject(page)).headFrame).toEqual(before.frame);
  await slider.press('Meta+Shift+z');expect((await savedProject(page)).headFrame).toEqual(after.frame);
  await slider.press('Control+z');expect((await savedProject(page)).headFrame).toEqual(before.frame);
 }
});
