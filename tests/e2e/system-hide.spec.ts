import {test,expect} from '@playwright/test';
test('system pair hide/reveal/unhide is display-only in both viewports; Helmet preserved for contour',async({page})=>{
 await page.goto('/');const ids=await page.evaluate(async()=>{const {SIDE_R,SIDE_L,HELMET}=await import('/src/domain/head/scaffold.ts'),s=(window as any).__editorPerfStore.getState();s.selectCurve(SIDE_R);return {r:SIDE_R,l:SIDE_L,h:HELMET,point:s.project.landmarks.find((l:any)=>l.systemRole&&l.type==='RIGHT').id};});
 const canvas=page.getByTestId('point-inspect').locator('canvas'),curves=+(await canvas.getAttribute('data-visible-curves'))!;
 const source=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {json:JSON.stringify(s.project),past:s.past.length};});
 await page.getByRole('button',{name:'隐藏',exact:true}).click();await expect(page.getByTestId('curve-hit-'+ids.r)).toHaveCount(0);await expect(page.getByTestId('curve-hit-'+ids.l)).toHaveCount(0);await expect(canvas).toHaveAttribute('data-visible-curves',String(curves-2));
 await page.locator(`[data-object-id="${ids.r}"] .symmetric-pair-row`).click();await expect(page.getByTestId('curve-hit-'+ids.r)).toBeAttached();await expect(canvas).toHaveAttribute('data-visible-curves',String(curves));
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectLandmark(id),ids.point);await expect(canvas).toHaveAttribute('data-visible-curves',String(curves-2));
 const points=+(await canvas.getAttribute('data-visible-points'))!;await page.getByRole('button',{name:'隐藏',exact:true}).click();await expect(canvas).toHaveAttribute('data-visible-points',String(points-2));await expect(page.locator(`[data-point-id="${ids.point}"]`)).toHaveCount(0);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),ids.r);await page.getByRole('button',{name:'解除隐藏',exact:true}).click();await expect(canvas).toHaveAttribute('data-visible-curves',String(curves));
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectPatch(id),ids.h);const surfaces=+(await canvas.getAttribute('data-visible-surfaces'))!;await page.getByRole('button',{name:'隐藏',exact:true}).click();await expect(canvas).toHaveAttribute('data-visible-surfaces',String(surfaces-1));await expect(page.getByTestId('gpu-derived-renderer')).toHaveAttribute('data-surface-count',String(surfaces-1));
 expect(await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {json:JSON.stringify(s.project),past:s.past.length};})).toEqual(source);
});
test('hidden preferences survive reload and stay isolated per project',async({page})=>{
 await page.goto('/');const ids=await page.evaluate(async()=>{const {SIDE_R,SIDE_L}=await import('/src/domain/head/scaffold.ts'),s=(window as any).__editorPerfStore.getState();s.selectCurve(SIDE_R);return {r:SIDE_R,l:SIDE_L};});
 await page.getByRole('button',{name:'隐藏',exact:true}).click();await page.reload();await expect(page.getByTestId('curve-hit-'+ids.r)).toHaveCount(0);await expect(page.getByTestId('curve-hit-'+ids.l)).toHaveCount(0);
 const original=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project);
 await page.evaluate(p=>{const s=(window as any).__editorPerfStore.getState();s.load({...p,meta:{...p.meta,createdAt:p.meta.createdAt+1}});},original);await expect(page.getByTestId('curve-hit-'+ids.r)).toBeAttached();
 await page.evaluate(p=>(window as any).__editorPerfStore.getState().load(p),original);await expect(page.getByTestId('curve-hit-'+ids.r)).toHaveCount(0);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),ids.r);await expect(page.getByTestId('curve-hit-'+ids.r)).toBeAttached();await page.getByRole('button',{name:'解除隐藏',exact:true}).click();await page.reload();await expect(page.getByTestId('curve-hit-'+ids.r)).toBeAttached();
});
