import {test,expect} from '@playwright/test';
test('create one chin point, four symmetric ranges, edit and undo without adding a shell',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 await page.evaluate(async()=>{const file='/src/domain/landmarks/presets.ts';(window as any).__editorPerfStore.getState().load((await import(file)).createLandmarkProject());});
 const section=page.getByTestId('chin-construction');await section.getByRole('button',{name:/Chin Junction/}).click();await section.getByRole('button',{name:'Create Chin Junction',exact:true}).click();
 const controls=page.getByTestId('chin-controls');await expect(controls).toBeVisible();await expect(controls.getByRole('slider')).toHaveCount(4);
 const snapshot=()=>page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {chin:s.project.chinScaffold,curves:s.project.curves,points:s.project.landmarks,past:s.past.length,selection:s.selection};});
 const initial=await snapshot();expect(initial.selection.kind).toBe('point');expect(initial.chin.version).toBe(3);expect(initial.curves.filter((c:any)=>c.geometryType==='CHIN_SEAM')).toHaveLength(0);expect(initial.points.filter((p:any)=>p.systemRole?.startsWith('CHIN'))).toHaveLength(1);
 const range=controls.getByRole('slider',{name:'Upper Side Lines Range',exact:true});await range.locator('..').locator('.numeric-slider-value').dblclick();await controls.getByRole('textbox',{name:'Upper Side Lines Range value'}).fill('.05');await controls.getByRole('textbox',{name:'Upper Side Lines Range value'}).press('Enter');
 expect((await snapshot()).chin.ranges.UPPER_PAIR).toBe(.05);expect((await snapshot()).past).toBe(initial.past+1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshot()).chin.ranges.UPPER_PAIR).toBe(.08);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await snapshot()).chin).toBeUndefined();
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await snapshot()).chin.version).toBe(3);
 await page.evaluate(async()=>{const f='/src/domain/landmarks/persistence.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(f)).parseLandmarks(JSON.stringify(s.project)));s.selectObject({kind:'point',id:'09500000-0000-4000-8000-000000000101'});});
 await expect(controls).toBeVisible();expect(errors).toEqual([]);
});
