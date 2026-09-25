import {test,expect,type Page} from '@playwright/test';
const data=(page:Page)=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.recording);
const history=(page:Page)=>page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const point=(page:Page,id:string)=>page.locator(`[data-testid="recording-point-row"][data-point-id="${id}"]`);
const curve=(page:Page,id:string)=>page.locator(`[data-testid="recording-row"][data-curve-id="${id}"]`);
async function view(page:Page,yaw:number){
 const p=page.getByRole('slider',{name:'Recording Yaw',exact:true}).locator('..');
 await p.locator('.numeric-slider-value').dblclick();await p.locator('.numeric-slider-entry').fill(String(yaw));await p.locator('.numeric-slider-entry').press('Enter');
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('room-toggle').click();
 await page.evaluate(async()=>{
  const a='/src/domain/recording/points.ts',b='/src/domain/recording/commands.ts',p=await import(a),c=await import(b);
  const front={yaw:0,pitch:0},side={yaw:60,pitch:0};let r:any={version:1,curves:[]};
  r=p.createRecordedPoint(r,front,'a','Brow',[-.5,.4]);r=p.createRecordedPoint(r,front,'b','Chin',[.5,-.5]);
  r=p.editRecordedPoint(r,'a',side,[-.4,.5]);r=p.editRecordedPoint(r,'b',side,[.4,-.4]);
  r=p.createSemanticCurve(r,front,'semantic','Semantic','a','b');r=c.editShape(r,'semantic',side,(s:any)=>{s[1][1]+=.1;return s;});
  for(const id of ['free','guide']){r=c.createRecorded(r,front,id,id,undefined,id==='guide');r=c.writeKey(r,id,side,r.curves.at(-1).keys[0].shape);}
  (window as any).__editorPerfStore.getState().setRecording(r);
 });
});
test('all curve types drag reorder with stable selection, undo and save/load',async({page})=>{
 await curve(page,'semantic').getByRole('button').first().click();
 const before=await data(page),n=await history(page),h=(await curve(page,'guide').boundingBox())!.height;
 await curve(page,'semantic').dragTo(curve(page,'guide'),{targetPosition:{x:20,y:h-3}});
 const next=await data(page);expect(next.curves.map((c:any)=>c.id)).toEqual(['free','guide','semantic']);expect(next.points).toEqual(before.points);
 for(const c of next.curves)expect(c).toEqual(before.curves.find((x:any)=>x.id===c.id));
 expect(await history(page)).toBe(n+1);await expect(curve(page,'semantic')).toHaveClass(/active/);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(next);
 await curve(page,'guide').dragTo(curve(page,'free'),{targetPosition:{x:20,y:3}});
 const saved=await data(page);expect(saved.curves.map((c:any)=>c.id)).toEqual(['guide','free','semantic']);
 const count=await history(page);await curve(page,'guide').dragTo(curve(page,'guide'));expect(await history(page)).toBe(count);
 await page.evaluate(async()=>{const url='/src/domain/landmarks/persistence.ts',e=(window as any).__editorPerfStore.getState();e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await data(page)).toEqual(saved);
 expect(await page.getByTestId('recording-row').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-curve-id')))).toEqual(['guide','free','semantic']);
});
test('current-view point removal hides only its marker, preserves connected curves and restores from the list',async({page})=>{
 await view(page,30);await point(page,'a').getByRole('button').first().click();
 const before=await data(page),n=await history(page);
 await page.getByRole('button',{name:'Hide/Delete at This View',exact:true}).click();
 const hidden=await data(page);expect(hidden.points[0].keys).toEqual(before.points[0].keys);expect(hidden.points).toHaveLength(2);expect(hidden.curves).toEqual(before.curves);
 expect(await history(page)).toBe(n+1);await expect(point(page,'a').getByTestId('recording-frame-hidden')).toBeVisible();
 await expect(page.locator('[data-testid="recording-point"][data-point="a"]')).toHaveCount(0);
 await expect(page.getByTestId('recorded-final-point')).toHaveCount(0);await expect(page.getByTestId('recorded-hit')).toHaveCount(3);
 await view(page,0);await expect(page.getByTestId('recording-point')).toHaveCount(2);
 await view(page,-30);await expect(page.getByTestId('recording-point')).toHaveCount(1);
 await point(page,'b').getByRole('button').first().click();await point(page,'a').getByRole('button').first().click();
 await page.getByRole('button',{name:'Restore at This View',exact:true}).click();await expect(page.getByTestId('recording-point')).toHaveCount(2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(hidden);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await page.evaluate(async()=>{const url='/src/domain/landmarks/persistence.ts',e=(window as any).__editorPerfStore.getState();e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await data(page)).toEqual(hidden);await expect(page.getByTestId('recording-point')).toHaveCount(1);
});
test('semantic/free/guide curves share frame removal and restoration without deleting keys or points',async({page})=>{
 await view(page,30);const before=await data(page);
 for(const id of ['semantic','free','guide']){
  await curve(page,id).getByRole('button').first().click();await page.getByRole('button',{name:'Hide/Delete at This View',exact:true}).click();
  await expect(curve(page,id).getByTestId('recording-frame-hidden')).toBeVisible();
  await expect(page.locator(`[data-curve="${id}"] [data-testid="recorded-hit"]`)).toHaveCount(0);
 }
 const hidden=await data(page);expect(hidden.points).toEqual(before.points);expect(hidden.curves).toHaveLength(3);
 hidden.curves.forEach((c:any,i:number)=>expect(c.keys).toEqual(before.curves[i].keys));
 await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(0);await expect(page.getByTestId('recorded-final-point')).toHaveCount(0);
 await view(page,60);await expect(page.getByTestId('recorded-hit')).toHaveCount(3);
 await view(page,-30);await expect(page.getByTestId('recorded-hit')).toHaveCount(0);
 await curve(page,'semantic').getByRole('button').first().click();await page.getByRole('button',{name:'Restore at This View',exact:true}).click();
 await expect(page.getByTestId('recorded-hit')).toHaveCount(1);await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(1);
 await curve(page,'semantic').getByRole('button').last().click();await expect(page.getByTestId('recording-frame-visibility')).toBeDisabled();
});
