import {test,expect} from '@playwright/test';
test('independent contour and inspection projection modes preserve source geometry',async({page})=>{
 test.setTimeout(60000);await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles('tests/fixtures/contour-risk-head.json');await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();const preview=page.getByTestId('contour-preview');await expect(preview).toHaveAttribute('aria-busy','false',{timeout:20000});
 const before=await page.evaluate(()=>JSON.stringify(window.__editorPerfStore.getState().project));
 const paths=()=>preview.locator('svg').innerHTML();const orth=await paths();
 await page.getByRole('button',{name:'切换 Contour 投影',exact:true}).click();await expect(preview).toContainText('透视投影');await expect.poll(paths).not.toBe(orth);await expect(preview).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'切换 3D 投影',exact:true}).click();await expect(page.getByRole('button',{name:'切换 3D 投影'})).toHaveText('切换透视');
 const canvas=page.getByTestId('point-inspect').locator('canvas');await canvas.hover();await page.mouse.wheel(0,-100);await page.waitForTimeout(300);
 await page.getByRole('button',{name:'切换 3D 投影',exact:true}).click();await expect(page.getByRole('button',{name:'切换 3D 投影'})).toHaveText('切换正交');await expect(preview).toHaveAttribute('aria-busy','false',{timeout:20000});
 await page.getByRole('button',{name:'切换 Contour 投影',exact:true}).click();await expect(preview).toContainText('正交投影');await expect(preview).toHaveAttribute('aria-busy','false');expect(await page.evaluate(()=>JSON.stringify(window.__editorPerfStore.getState().project))).toBe(before);
 await page.screenshot({path:'artifacts/chin-camera/projection-modes.png'});
});
