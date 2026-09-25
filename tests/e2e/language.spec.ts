import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync('tests/fixtures/continuity-overlap-head.json','utf8'));
test('Chinese/English switch covers tools and inspectors, persists locally, preserves source and UI selection',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.evaluate(p=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.selectPatch(p.patches[0].id);},fixture);
 const snapshot=()=>page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return JSON.stringify({project:s.project,selection:s.selection,tool:s.tool,past:s.past,future:s.future});});
 const before=await snapshot();await expect(page.getByRole('button',{name:'保存 JSON',exact:true})).toBeVisible();await expect(page.getByTestId('inline-inspector')).toContainText('身份');
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'Save JSON',exact:true})).toBeVisible();await expect(page.getByTestId('inline-inspector')).toContainText('Identity');await expect(page.getByRole('slider',{name:'Surface fullness',exact:true})).toBeVisible();
 await page.locator('.creation-shelf summary').filter({hasText:'Curve'}).click();await expect(page.getByRole('button',{name:'On Surface Curve',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Free Curve',exact:true})).toBeVisible();
 expect(await snapshot()).toBe(before);await page.screenshot({path:'artifacts/i18n/english.png'});
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'贴面曲线',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'自由曲线',exact:true})).toBeVisible();expect(await snapshot()).toBe(before);await page.screenshot({path:'artifacts/i18n/chinese.png'});
 await page.getByTestId('language-toggle').click();await page.reload();await expect(page.getByRole('button',{name:'Save JSON',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('lang','en');expect(errors).toEqual([]);
});
