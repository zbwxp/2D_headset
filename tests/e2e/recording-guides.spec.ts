import {test,expect,type Page} from '@playwright/test';

async function data(page:Page){return page.evaluate(()=>(window as any).__editorPerfStore.getState().project.recording);}
async function yaw(page:Page,value:number){
 const parent=page.getByRole('slider',{name:'Recording Yaw',exact:true}).locator('..');
 await parent.locator('.numeric-slider-value').dblclick();
 await parent.locator('.numeric-slider-entry').fill(String(value));
 await parent.locator('.numeric-slider-entry').press('Enter');
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));
 await page.goto('/');await page.getByTestId('room-toggle').click();
});

test('guide create, continuous picking, Auto-Key undo, duplicate, hide and persistence',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'New Recorded Guide',exact:true}).click();
 const guide=(await data(page)).curves[0];
 expect(guide.auxiliary).toBe(true);
 await expect(page.getByTestId('recording-guide-badge')).toHaveText('Guide');
 await expect(page.getByTestId('recorded-stroke')).toHaveAttribute('stroke-dasharray','7 5');
 await expect(page.getByTestId('recording-final').locator('path')).toHaveAttribute('stroke-dasharray','7 5');
 expect(await page.getByTestId('recorded-hit').getAttribute('stroke-dasharray')).toBeNull();

 await yaw(page,30);
 await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(0);
 await expect(page.getByTestId('recorded-stroke')).toHaveAttribute('stroke','#ff7278');
 const h=(await page.getByTestId('recorded-control-1').boundingBox())!;
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
 await page.mouse.move(h.x+h.width/2+25,h.y+h.height/2+15,{steps:5});await page.mouse.up();
 expect((await data(page)).curves[0].keys).toHaveLength(2);
 await expect(page.getByTestId('recording-final').locator('path')).toHaveAttribute('stroke-dasharray','7 5');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 expect((await data(page)).curves[0]).toEqual(guide);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await yaw(page,-15);
 await expect(page.getByTestId('recording-status')).toHaveText('Valid interpolation');
 await page.getByRole('button',{name:'Duplicate Current Frame',exact:true}).click();
 const copy=(await data(page)).curves[1];expect(copy.auxiliary).toBe(true);expect(copy.keys).toHaveLength(1);
 await page.getByRole('textbox',{name:'Recorded curve name',exact:true}).fill('Construction A');
 await page.getByRole('textbox',{name:'Recorded curve name',exact:true}).press('Enter');
 await expect(page.getByTestId('recording-row').nth(1).getByTestId('recording-guide-badge')).toHaveText('Guide');
 await page.getByTestId('recording-row').nth(1).getByRole('checkbox').uncheck();
 await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(1);
 await page.getByTestId('recording-row').nth(1).getByRole('checkbox').check();

 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 const normal=(await data(page)).curves[2];expect(normal.auxiliary).toBeUndefined();
 expect(await page.getByTestId('recorded-stroke').nth(2).getAttribute('stroke-dasharray')).toBeNull();
 // Click the guide's hit path, even in a dashed gap, after selecting another curve.
 const point=await page.locator(`[data-curve="${copy.id}"] [data-testid="recorded-hit"]`).evaluate(el=>{
  const p=(el as SVGPathElement).getPointAtLength(10),matrix=(el as SVGPathElement).getScreenCTM()!;
  return {x:matrix.a*p.x+matrix.c*p.y+matrix.e,y:matrix.b*p.x+matrix.d*p.y+matrix.f};
 });
 await page.mouse.click(point.x,point.y);
 await expect(page.getByRole('textbox',{name:'Recorded curve name',exact:true})).toHaveValue('Construction A');

 const saved=await data(page);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await data(page)).toEqual(saved);
 await page.waitForTimeout(800);await page.reload();await page.getByTestId('room-toggle').click();
 expect(await data(page)).toEqual(saved);
 await yaw(page,15);
 await page.getByTestId('language-toggle').click();
 await expect(page.getByRole('button',{name:'新建录制辅助线',exact:true})).toBeVisible();
 await expect(page.getByTestId('recording-guide-badge').first()).toHaveText('辅助线');
 await page.screenshot({path:'artifacts/recording/recording-guides.png'});
 expect(errors).toEqual([]);
});

test('Smooth keeps guides dashed while a mixed transition stays solid',async({page})=>{
 await page.evaluate(()=>{
  const e=(window as any).__editorPerfStore.getState();
  const shapes=[[[-.8,.6],[-.7,0],[-.3,-.6],[0,-.6]],[[0,-.6],[.3,-.6],[.7,0],[.8,.6]]];
  e.setRecording({version:1,curves:shapes.map((shape,i)=>({id:i?'b':'a',name:i?'Right':'Left',auxiliary:true,locked:false,visible:true,keys:[{yaw:0,pitch:0,shape}]})),junctions:[{id:'j',masterCurveId:'a',masterEndpoint:'P1',followerCurveId:'b',followerEndpoint:'P0',mode:'POSITION'}]});
 });
 await page.getByTestId('recording-junction-row').click();
 await page.getByRole('button',{name:'Enable Smooth Junction',exact:true}).click();
 await expect(page.getByTestId('smooth-transition')).toHaveAttribute('stroke-dasharray','7 5');
 await expect(page.getByTestId('smooth-final')).toHaveAttribute('stroke-dasharray','7 5');
 const geometry=await page.evaluate(async()=>{const url='/src/domain/recording/smooth.ts',r=(window as any).__editorPerfStore.getState().project.recording;return (await import(url)).smoothGeometry(r,{yaw:0,pitch:0}).transitions.map((t:any)=>t.shape);});
 await page.evaluate(()=>{const e=(window as any).__editorPerfStore.getState(),r=e.project.recording;e.setRecording({...r,curves:r.curves.map((c:any)=>c.id==='b'?{...c,auxiliary:false}:c)});});
 expect(await page.getByTestId('smooth-final').getAttribute('stroke-dasharray')).toBeNull();
 expect(await page.evaluate(async()=>{const url='/src/domain/recording/smooth.ts',r=(window as any).__editorPerfStore.getState().project.recording;return (await import(url)).smoothGeometry(r,{yaw:0,pitch:0}).transitions.map((t:any)=>t.shape);})).toEqual(geometry);
});
