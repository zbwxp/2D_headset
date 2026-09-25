import {test,expect} from '@playwright/test';
import {spanFixture} from '../../src/tests/span-fixture';
test('online position uses all four arrows, modifiers, grouped hold and undo',async({page})=>{
 await page.goto('/');const f=spanFixture();await page.evaluate(({p,id})=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.selectLandmark(id);},{p:f.p,id:f.a});
 const slider=page.getByRole('slider',{name:'在线位置',exact:true});await expect(slider).toBeVisible();const initial=+(await slider.inputValue());
 for(const [key,sign] of [['ArrowRight',1],['ArrowUp',1],['ArrowLeft',-1],['ArrowDown',-1]] as const){await slider.press(key);await expect.poll(async()=>+(await slider.inputValue())).toBeCloseTo(initial+sign*.0025,8);await slider.press('Control+z');await expect.poll(async()=>+(await slider.inputValue())).toBeCloseTo(initial,8);}
 await slider.press('Alt+ArrowUp');await expect.poll(async()=>+(await slider.inputValue())).toBeCloseTo(initial+.0005,8);await slider.press('Control+z');
 await slider.press('Shift+ArrowRight');await expect.poll(async()=>+(await slider.inputValue())).toBeCloseTo(initial+.0125,8);await slider.press('Control+z');await slider.press('Control+Shift+z');await expect.poll(async()=>+(await slider.inputValue())).toBeCloseTo(initial+.0125,8);await slider.press('Control+z');
 const before=await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);await page.clock.install();await slider.focus();await page.keyboard.down('ArrowUp');await page.clock.runFor(1200);await page.keyboard.up('ArrowUp');expect(+(await slider.inputValue())).toBeGreaterThan(initial+.01);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length)).toBe(before+1);await slider.press('Control+z');await expect.poll(async()=>+(await slider.inputValue())).toBeCloseTo(initial,8);
});
