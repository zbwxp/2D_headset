import {test,expect} from '@playwright/test';
test('V0.9.8 read-only experimental comparison',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1800,height:990});
 await page.goto('/artifacts/chin-v098-lab/view.html');await page.waitForFunction(()=>(window as any).labReady);
 await expect(page.locator('canvas')).toHaveCount(3);await expect(page.locator('select')).toHaveCount(3);expect((await page.request.get('/artifacts/chin-v098-lab/report.md')).status()).toBe(200);
 await page.screenshot({path:'artifacts/chin-v098-lab/oblique.png'});
 await page.getByRole('button',{name:'正面略仰',exact:true}).click();await page.screenshot({path:'artifacts/chin-v098-lab/front.png'});
 await page.getByRole('button',{name:'底部',exact:true}).click();await page.screenshot({path:'artifacts/chin-v098-lab/under.png'});
 await page.getByRole('button',{name:'完整头壳',exact:true}).click();await page.screenshot({path:'artifacts/chin-v098-lab/full.png'});
 await page.getByRole('button',{name:'放大下巴',exact:true}).click();await page.locator('select').nth(2).selectOption('spatial');await page.screenshot({path:'artifacts/chin-v098-lab/spatial.png'});
 await page.locator('select').nth(2).selectOption('wide');await page.getByRole('button',{name:'显示网格',exact:true}).click();await page.screenshot({path:'artifacts/chin-v098-lab/mesh.png'});
 expect(errors).toEqual([]);
});
