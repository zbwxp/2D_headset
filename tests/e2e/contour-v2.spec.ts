import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
test('Contour V2 renders open segments without closing them',async({page})=>{
 await page.goto('/');
 await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles('artifacts/surface-smooth/full-head-regression.json');
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();
 const p=page.getByTestId('contour-preview');await expect(p.locator('[data-contour-open]').first()).toBeVisible({timeout:20000});
 await expect(p).toHaveAttribute('aria-busy','false');
 const paths=await p.locator('[data-contour-open]').evaluateAll(es=>es.map(e=>e.getAttribute('d')!));
 expect(paths.length).toBeGreaterThan(0);expect(paths.every(d=>!/[zZ]/.test(d))).toBe(true);
 mkdirSync('artifacts/contour-v2',{recursive:true});await p.screenshot({path:'artifacts/contour-v2/preview.png'});
});
test('saved span head renders repaired boundaries across camera orientations',async({page})=>{
 await page.goto('/');
 await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles('tests/fixtures/contour-span-head.json');
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();
 const preview=page.getByTestId('contour-preview');
 await expect(preview.locator('svg path').first()).toBeVisible({timeout:20000});
 for(const [name,q] of [['front',[0,0,0,1]],['oblique',[.12,.3,0,Math.sqrt(1-.12*.12-.3*.3)]]] as const){
  await page.evaluate(async q=>{const {useInspectionCamera}=await import('/src/ui/windows/state.ts');useInspectionCamera.setState({quaternion:[...q]});},q);
  await expect(preview).toHaveAttribute('aria-busy','false',{timeout:10000});
  await preview.screenshot({path:'artifacts/contour-v2/repaired-'+name+'.png'});
 }
});
