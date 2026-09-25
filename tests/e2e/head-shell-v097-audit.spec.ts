import {test} from '@playwright/test';
test('capture read-only evaluated head shell audit',async({page})=>{
 await page.setViewportSize({width:1800,height:920});
 await page.goto('/artifacts/head-shell-v097-audit/view.html');
 await page.waitForFunction(()=>(window as any).auditReady,{},{timeout:60000});
 await page.screenshot({path:'artifacts/head-shell-v097-audit/full-shell.png'});
 await page.getByRole('button',{name:'放大下巴',exact:true}).click();
 await page.locator('#filter').selectOption('lower');
 await page.screenshot({path:'artifacts/head-shell-v097-audit/chin-closeup.png'});
 await page.getByRole('button',{name:'隐藏结构线',exact:true}).click();
 await page.screenshot({path:'artifacts/head-shell-v097-audit/chin-shaded.png'});
 await page.goto('/artifacts/head-shell-v097-audit/view.html?plain');
 await page.waitForFunction(()=>(window as any).auditReady);
 await page.screenshot({path:'artifacts/head-shell-v097-audit/plain-full.png'});
 await page.getByRole('button',{name:'放大下巴',exact:true}).click();
 await page.locator('#filter').selectOption('lower');
 await page.getByRole('button',{name:'隐藏结构线',exact:true}).click();
 await page.screenshot({path:'artifacts/head-shell-v097-audit/plain-chin.png'});
});
