import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const old=JSON.parse(readFileSync('src/tests/fixtures/smooth-safety-9.json','utf8'));
const fresh=JSON.parse(readFileSync('src/tests/fixtures/smooth-safety-10.json','utf8'));
test('shape protection is visible, survives selection, and clears on healthy geometry',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.evaluate(p=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.selectPatch('50a7e8ea-fc75-4c4d-bd49-81e3781ffab1');},old);
 const inspector=page.getByTestId('inline-inspector');await expect(inspector.getByTestId('smooth-shape-protection')).toBeVisible({timeout:20000});await expect(inspector).toContainText('法线变化过大');
 await page.screenshot({path:'artifacts/ear-diagnosis/safety-guard-browser.png'});
 const source=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project);expect(source.surfaceContinuity).toEqual(old.surfaceContinuity);expect(JSON.stringify(source)).not.toContain('shapeProtection');
 await page.evaluate(p=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.selectPatch('622bef6f-13fc-4b35-abb8-18a709959b32');},fresh);
 await page.locator('.surface-display > summary').click();await expect(page.getByTestId('continuity-status')).toHaveAttribute('data-state','ready',{timeout:20000});await expect(page.getByTestId('smooth-shape-protection')).toHaveCount(0);expect(errors).toEqual([]);
});
