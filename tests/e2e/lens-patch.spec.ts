import {test,expect} from '@playwright/test';
import {openPatch} from '../helpers/sidebar';
test('reported jaw file: click two open curves -> visible mirrored lens immediately',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles('tests/fixtures/lens-head.json');await openPatch(page);
 const state=()=>page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {project:s.project,pending:s.patchCreation};});const n=(await state()).project.patches.length;const surfaceCount=Number(await page.getByTestId('gpu-derived-renderer').getAttribute('data-surface-count'));
 await page.getByRole('button',{name:'绘制面',exact:true}).click();
 for(const id of ['a056605d-adca-4aee-928f-3cd201d65866','e52ce876-51ae-43b2-ac01-93d53c932ae6'])await page.getByTestId('curve-hit-'+id).dispatchEvent('pointerdown',{button:0,pointerId:1});
 await expect.poll(async()=>(await state()).project.patches.length).toBe(n+2);expect((await state()).project.patches.at(-1).type).toBe('lens');expect((await state()).pending.uses).toHaveLength(0);
 await page.keyboard.press('Escape');await expect(page.getByRole('slider',{name:'面凸度 Fullness'})).toBeVisible();
 await expect(page.getByTestId('gpu-derived-renderer')).toHaveAttribute('data-surface-count',String(surfaceCount+2));
 await page.screenshot({path:'artifacts/lens-patch/jaw-filled.png'});
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await state()).project.patches.length).toBe(n);await page.getByRole('button',{name:'重做',exact:true}).click();expect((await state()).project.patches.length).toBe(n+2);
 await page.waitForTimeout(650);await page.reload();await page.waitForFunction(()=>!!(window as any).__editorPerfStore);expect((await state()).project.patches.at(-1).type).toBe('lens');expect(errors).toEqual([]);
});
