import {test,expect} from '@playwright/test';
test('point-based chin and cheek comparison',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1800,height:1000});
 await page.goto('/artifacts/point-smooth-v098/view.html');await page.waitForFunction(()=>(window as any).labReady);
 await expect(page.locator('canvas')).toHaveCount(3);
 await page.screenshot({path:'artifacts/point-smooth-v098/chin.png'});
 await page.getByRole('button',{name:'正面略仰',exact:true}).click();await page.screenshot({path:'artifacts/point-smooth-v098/front.png'});
 await page.getByRole('button',{name:'完整头壳',exact:true}).click();await page.screenshot({path:'artifacts/point-smooth-v098/full.png'});
 await page.getByRole('button',{name:'颧骨特写',exact:true}).click();await page.screenshot({path:'artifacts/point-smooth-v098/cheek.png'});
 await page.getByRole('button',{name:'显示结构线',exact:true}).click();await page.screenshot({path:'artifacts/point-smooth-v098/cheek-lines.png'});
 expect(errors).toEqual([]);
});
