import {test,expect,type Page} from '@playwright/test';
const data=(page:Page)=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.recording);
const history=(page:Page)=>page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
async function view(page:Page,yaw:number){
 const parent=page.getByRole('slider',{name:'Recording Yaw',exact:true}).locator('..');
 await parent.locator('.numeric-slider-value').dblclick();await parent.locator('.numeric-slider-entry').fill(String(yaw));await parent.locator('.numeric-slider-entry').press('Enter');
}
async function clickCurve(page:Page,fraction:number){
 const xy=await page.getByTestId('recorded-stroke').first().evaluate((el,f)=>{
  const path=el as SVGPathElement,p=path.getPointAtLength(path.getTotalLength()*f),m=path.getScreenCTM()!;
  return {x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};
 },fraction);
 await page.mouse.click(xy.x,xy.y);
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));
 await page.goto('/');await page.getByTestId('room-toggle').click();
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 await page.evaluate(async()=>{
  const url='/src/domain/recording/commands.ts',purl='/src/domain/recording/points.ts',e=(window as any).__editorPerfStore.getState(),r=e.project.recording,c=r.curves[0];
  let next=(await import(url)).writeKey(r,c.id,{yaw:60,pitch:0},c.keys[0].shape.map(([x,y]:number[])=>[x+.1,y+.1]));
  next=(await import(purl)).createRecordedPoint(next,{yaw:0,pitch:0},'p','Editor point',[.6,.4]);e.setRecording(next);
 });
});
test('two-click multi-region drawing, geometry isolation, undo/redo, controls and saved state',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const original=await data(page),n=await history(page),editorLength=await page.getByTestId('recorded-stroke').evaluate(el=>(el as SVGPathElement).getTotalLength());
 await expect(page.getByTestId('recording-point')).toHaveCount(1);
 await expect(page.getByTestId('recording-final').locator('circle')).toHaveCount(0);
 await page.getByRole('button',{name:'Add Drawing Region',exact:true}).click();
 await clickCurve(page,.2);await expect(page.getByTestId('drawing-region-first')).toHaveCount(1);
 expect((await data(page)).curves[0].drawing).toBeUndefined();expect(await history(page)).toBe(n);
 await clickCurve(page,.45);
 const first=await data(page);expect(first.curves[0].drawing.regions).toHaveLength(1);expect(first.curves[0].keys).toEqual(original.curves[0].keys);expect(first.points).toEqual(original.points);
 expect(await history(page)).toBe(n+1);
 expect(await page.getByTestId('recorded-stroke').evaluate(el=>(el as SVGPathElement).getTotalLength())).toBeCloseTo(editorLength,3);
 await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(1);
 expect(await page.getByTestId('recorded-final-stroke').getAttribute('d')).not.toBe(await page.getByTestId('recorded-stroke').getAttribute('d'));
 await page.getByRole('button',{name:'Add Drawing Region',exact:true}).click();await clickCurve(page,.92);await clickCurve(page,.7);
 const two=await data(page);expect(two.curves[0].drawing.regions).toHaveLength(2);
 await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(2);await expect(page.getByTestId('drawing-region-row')).toHaveCount(2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(first);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(two);
 const start=page.getByRole('spinbutton',{name:'Region start 1',exact:true});
 const h=await history(page);await start.focus();await start.press('Tab');expect(await history(page)).toBe(h);
 await start.fill('10');await start.press('Enter');expect((await data(page)).curves[0].drawing.regions[0].start).toBe(.1);
 const valid=await data(page);await start.fill('99');await start.press('Enter');expect(await data(page)).toEqual(valid);
 await page.getByRole('checkbox',{name:'Draw regions only',exact:true}).uncheck();await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(1);await expect(page.getByTestId('recorded-final-stroke')).toHaveAttribute('d',(await page.getByTestId('recorded-stroke').getAttribute('d'))!);
 await page.getByRole('checkbox',{name:'Draw regions only',exact:true}).check();
 await view(page,-30);await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(2);
 await view(page,80);await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(0);await expect(page.getByTestId('recorded-stroke')).toHaveCount(1);
 await view(page,0);
 const saved=await data(page);
 await page.evaluate(async()=>{const url='/src/domain/landmarks/persistence.ts',e=(window as any).__editorPerfStore.getState();e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await data(page)).toEqual(saved);await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(2);
 await page.waitForTimeout(800);await page.reload();await page.getByTestId('room-toggle').click();expect(await data(page)).toEqual(saved);
 await page.getByTestId('recording-row').getByRole('button').first().click();
 await expect(page.getByTestId('drawing-region-row')).toHaveCount(2);await expect(page.getByTestId('recording-final').locator('circle')).toHaveCount(0);
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'新增绘制区域',exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/recording/drawing-regions.png'});expect(errors).toEqual([]);
});
test('view changes and Escape cancel pending span; empty enabled set, locking and removal',async({page})=>{
 const before=await data(page),n=await history(page);
 await page.getByRole('button',{name:'Add Drawing Region',exact:true}).click();await clickCurve(page,.2);await view(page,30);
 await expect(page.getByTestId('drawing-region-first')).toHaveCount(0);
 await clickCurve(page,.8);await expect(page.getByTestId('drawing-region-first')).toHaveCount(1);
 await page.keyboard.press('Escape');await expect(page.getByTestId('drawing-region-first')).toHaveCount(0);await page.keyboard.press('Escape');
 expect(await data(page)).toEqual(before);expect(await history(page)).toBe(n);
 await page.getByRole('checkbox',{name:'Draw regions only',exact:true}).check();await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(0);await expect(page.getByTestId('recorded-stroke')).toHaveCount(1);
 await page.getByRole('button',{name:'Add Drawing Region',exact:true}).click();await clickCurve(page,.1);await clickCurve(page,.8);
 await page.getByRole('button',{name:'Delete drawing region 1',exact:true}).click();await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByTestId('recorded-final-stroke')).toHaveCount(1);
 await page.getByTestId('recording-row').getByRole('button').last().click();await expect(page.getByRole('button',{name:'Add Drawing Region',exact:true})).toBeDisabled();await expect(page.getByRole('spinbutton',{name:'Region start 1',exact:true})).toBeDisabled();
});

test('a region can end on the visible Smooth bridge without modifying its source keys',async({page})=>{
 await page.evaluate(()=>{
  const shapeA=[[-.9,.6],[-.9,-.4],[-.4,-.6],[0,-.6]],shapeB=[[0,-.6],[.4,-.6],[.9,-.4],[.9,.6]];
  (window as any).__editorPerfStore.getState().setRecording({version:1,curves:[shapeA,shapeB].map((shape,i)=>({id:i?'b':'a',name:i?'B':'A',visible:true,locked:false,keys:[{yaw:0,pitch:0,shape}]})),junctions:[{id:'j',masterCurveId:'a',masterEndpoint:'P1',followerCurveId:'b',followerEndpoint:'P0',mode:'SMOOTH',baseRadius:.4,smoothKeys:[]}]});
 });
 await page.locator('[data-testid="recording-row"][data-curve-id="a"]').getByRole('button').first().click();
 const before=await data(page),transitionLength=await page.getByTestId('smooth-transition').evaluate(el=>(el as SVGPathElement).getTotalLength());
 await page.getByRole('button',{name:'Add Drawing Region',exact:true}).click();await clickCurve(page,.5);
 const xy=await page.getByTestId('smooth-transition').evaluate(el=>{const p=el as SVGPathElement,q=p.getPointAtLength(p.getTotalLength()*.25),m=p.getScreenCTM()!;return {x:m.a*q.x+m.c*q.y+m.e,y:m.b*q.x+m.d*q.y+m.f};});
 await page.mouse.click(xy.x,xy.y);
 const after=await data(page);expect(after.curves[0].drawing.regions).toHaveLength(1);expect(after.curves[0].keys).toEqual(before.curves[0].keys);expect(after.junctions).toEqual(before.junctions);
 expect(await page.getByTestId('smooth-transition').evaluate(el=>(el as SVGPathElement).getTotalLength())).toBeCloseTo(transitionLength,3);
 await expect(page.getByTestId('smooth-final')).toHaveCount(2);
 await page.getByRole('checkbox',{name:'Draw regions only',exact:true}).uncheck();await expect(page.getByTestId('smooth-final')).toHaveCount(1);
});
