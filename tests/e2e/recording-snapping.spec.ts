import {test,expect,type Page} from '@playwright/test';

async function data(page:Page){return page.evaluate(()=>(window as any).__editorPerfStore.getState().project.recording);}
async function history(page:Page){return page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);}
async function navigate(page:Page,yaw:number){
 const parent=page.getByRole('slider',{name:'Recording Yaw',exact:true}).locator('..');
 await parent.locator('.numeric-slider-value').dblclick();
 await parent.locator('.numeric-slider-entry').fill(String(yaw));
 await parent.locator('.numeric-slider-entry').press('Enter');
}
async function targetPoint(page:Page,t:number){
 return page.locator('[data-curve="target"] [data-testid="recorded-stroke"]').evaluate((el,t)=>{
  const path=el as SVGPathElement,p=path.getPointAtLength(path.getTotalLength()*t),m=path.getScreenCTM()!;
  return {x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};
 },t);
}
async function start(page:Page,index=0){
 const h=(await page.getByTestId(`recorded-control-${index}`).boundingBox())!;
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));
 await page.goto('/');await page.getByTestId('room-toggle').click();
 await page.evaluate(()=>{
  const e=(window as any).__editorPerfStore.getState();
  e.setRecording({version:1,curves:[
   {id:'moving',name:'Moving',visible:true,locked:false,keys:[{yaw:0,pitch:0,shape:[[-.6,.4],[-.7,.1],[-.7,-.2],[-.6,-.4]]}]},
   {id:'target',name:'Target guide',auxiliary:true,visible:true,locked:true,keys:[0,60].map(yaw=>({yaw,pitch:0,shape:[[.45,-.5],[.45,-1/6],[.45,1/6],[.45,.5]]}))}
  ]});
 });
 await page.getByTestId('recording-row').first().getByRole('button').first().click();
});

test('snap guide body and exact endpoints in mirrored view, Auto-Key once, preserve handle and target, Undo/Redo and save',async({page})=>{
 await navigate(page,-30);
 const before=await data(page),n=await history(page),p=await targetPoint(page,.5);
 const edge0=await targetPoint(page,0),edge1=await targetPoint(page,1);
 await start(page);await page.mouse.move(p.x+4,p.y,{steps:5});
 await expect(page.getByTestId('recording-snap')).toHaveAttribute('data-target','target');
 await page.screenshot({path:'artifacts/recording/endpoint-snap.png'});
 await page.mouse.up();await expect(page.getByTestId('recording-snap')).toHaveCount(0);
 const after=await data(page),key=after.curves[0].keys.find((k:any)=>k.yaw===30);
 expect(after.curves[0].keys).toHaveLength(2);expect(await history(page)).toBe(n+1);
 expect(key.shape[0][0]).toBeCloseTo(.45,12);
 // Browser pointer coordinates quantize to CSS pixels and retain the grab offset.
 expect(Math.abs(key.shape[0][1]*(edge1.y-edge0.y))).toBeLessThan(1);
 const base=before.curves[0].keys[0].shape;
 key.shape[1].forEach((v:number,k:number)=>expect(v-key.shape[0][k]).toBeCloseTo(base[1][k]-base[0][k],10));
 expect(after.curves[1]).toEqual(before.curves[1]);expect(after.junctions).toBeUndefined();
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(after);

 // Snap near the line's last endpoint instead of stopping at an interior point.
 const end=await targetPoint(page,1);await start(page);
 await page.mouse.move(end.x+3,end.y+4,{steps:5});
 await expect(page.locator('.recording-hud')).toContainText('Snapped to endpoint');
 await page.mouse.up();
 const saved=await data(page);
 expect(saved.curves[0].keys.find((k:any)=>k.yaw===30).shape[0]).toEqual([.45,.5]);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await data(page)).toEqual(saved);
});

test('Alt bypass, drag-away release, Escape cancellation, hidden curves and control handles',async({page})=>{
 const original=await data(page),n=await history(page),p=await targetPoint(page,.5);
 await start(page);await page.mouse.move(p.x+4,p.y,{steps:4});
 await expect(page.getByTestId('recording-snap')).toBeVisible();
 await page.mouse.move(p.x+25,p.y);
 await expect(page.getByTestId('recording-snap')).toHaveCount(0);
 await page.mouse.move(p.x+4,p.y);
 await expect(page.getByTestId('recording-snap')).toBeVisible();
 await page.keyboard.press('Escape');await page.mouse.up();
 expect(await data(page)).toEqual(original);expect(await history(page)).toBe(n);
 await expect(page.getByTestId('recording-snap')).toHaveCount(0);

 await page.keyboard.down('Alt');await start(page);await page.mouse.move(p.x+4,p.y,{steps:4});
 await expect(page.getByTestId('recording-snap')).toHaveCount(0);
 await page.mouse.up();await page.keyboard.up('Alt');
 expect((await data(page)).curves[0].keys[0].shape[0][0]).toBeGreaterThan(.45);
 await page.getByRole('button',{name:'Undo',exact:true}).click();

 await start(page,1);await page.mouse.move(p.x+4,p.y,{steps:4});
 await expect(page.getByTestId('recording-snap')).toHaveCount(0);
 await page.mouse.up();expect((await data(page)).curves[0].keys[0].shape[1][0]).toBeGreaterThan(.45);
 await page.getByRole('button',{name:'Undo',exact:true}).click();

 await page.getByTestId('recording-row').nth(1).getByRole('checkbox').uncheck();
 await start(page);await page.mouse.move(p.x+4,p.y,{steps:4});
 await expect(page.getByTestId('recording-snap')).toHaveCount(0);
 await page.mouse.up();expect((await data(page)).curves[0].keys[0].shape[0][0]).toBeGreaterThan(.45);
});
