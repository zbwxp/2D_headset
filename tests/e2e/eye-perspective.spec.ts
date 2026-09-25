import {test,expect} from '@playwright/test';
test('Eyes anisotropic perspective, mirrored display, history, persistence and 3D picking',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();await page.getByRole('button',{name:'Create Default Eye Scaffold',exact:true}).click();
 await page.evaluate(async()=>{const s=(window as any).__editorPerfStore.getState();s.createGaze();s.setEyePerspective('x',0);const path=performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/src/ui/windows/state.ts'))!;(await import(path)).useWindows.getState().setView('viewport','right45');s.selectView('right45');});
 const dimensions=()=>page.locator('[data-eye-side]').evaluateAll(nodes=>nodes.map(n=>{const b=(n as SVGGraphicsElement).getBBox();return {width:b.width,height:b.height};}));const base=await dimensions();
 const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {landmarks:JSON.stringify(s.project.landmarks),curves:JSON.stringify(s.project.curves),history:s.past.length};});
 const slider=page.getByRole('slider',{name:'X Perspective Strength',exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();const input=slider.locator('..').locator('.numeric-slider-entry');await input.fill('1');await input.press('Enter');
 const after=await dimensions();expect(after[0].width).toBeLessThan(base[0].width*.8);expect(after[1].width).toBeGreaterThan(base[1].width*1.2);expect(after[0].height).toBeCloseTo(base[0].height,5);
 expect(await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {landmarks:JSON.stringify(s.project.landmarks),curves:JSON.stringify(s.project.curves),history:s.past.length};})).toEqual({...before,history:before.history+1});
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await dimensions()).toEqual(base);await page.getByRole('button',{name:'Redo',exact:true}).click();
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.beginEdit();s.setEyePerspective('y',.2);s.endEdit();});
 const saved=await page.evaluate(async()=>{const url='/src/domain/landmarks/persistence.ts',store=(window as any).__editorPerfStore,p=(await import(url)).parseLandmarks(JSON.stringify(store.getState().project));store.getState().load(p);return p.eyeScaffold.perspective;});expect(saved).toEqual({x:1,y:.2});
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.setActiveModule('EYES');s.selectView('right45');});
 await expect(page.locator('[data-testid="gaze-overlay-2d"] [data-point-id]')).toHaveCount(0);
 await page.screenshot({path:'artifacts/eyes/stylized-perspective.png'});
});
