import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
async function seed(p:Page){await p.evaluate(async()=>{
 const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Mirror study');
 d=c.createCurve(d,d.layers[0].id,[[0,-.4],[0,-.2],[0,.2],[0,.4]],.012,'On the axis','a');
 d=c.createCurve(d,d.layers[0].id,[[.35,.2],[.55,.4],[.85,.4],[1,.1]],.012,'Snap target','b');
 d=c.curveChange(d,'b',{locked:true});d=c.createCurve(d,d.layers[0].id,[[.37,-.2],[.55,-.4],[.85,-.4],[1,-.1]],.012,'Hidden','h');d=c.curveChange(d,'h',{visible:false});
 (window as any).__editorPerfStore.getState().setDrawing(d);
 });}
async function coord(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,percent=Number((await p.locator('.drawing-status').innerText()).match(/(\d+)%/)![1]),u=Math.min(r.width,r.height)/2.8*percent/100;return {x:r.x+r.width/2+x*u,y:r.y+r.height/2-y*u,u};}
async function begin(p:Page){const r=(await p.getByTestId('drawing-mirror-grip').boundingBox())!;await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();await seed(page);});

test('axis stays across tools; snaps exactly to visible endpoints with one Undo and saved position',async({page})=>{
 for(const tool of ['select','direct','pen','ellipse','bind','mirror']){await page.getByTestId('drawing-tool-'+tool).click();await expect(page.getByTestId('drawing-mirror-guide')).toBeVisible();}
 await page.getByTestId('drawing-tool-direct').click();const before=await data(page),h=await history(page),target=await coord(page,.35,.2);
 await begin(page);await page.mouse.move(target.x+5,target.y,{steps:6});await expect(page.getByTestId('drawing-mirror-snap')).toBeVisible();expect(await data(page)).toEqual(before);
 const axis=page.getByTestId('drawing-mirror-axis');expect(Number(await axis.getAttribute('x1'))).toBeCloseTo(target.x-(await page.getByTestId('drawing-canvas').boundingBox())!.x,6);
 await page.mouse.up();expect((await data(page)).mirrorAxisX).toBe(.35);expect(await history(page)).toBe(h+1);expect((await data(page)).curves).toEqual(before.curves);expect((await data(page)).nodes).toEqual(before.nodes);await expect(page.getByTestId('drawing-mirror-snap')).toHaveCount(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await data(page)).mirrorAxisX).toBe(.35);
 // Moving out of the snap band releases normally; Escape cancels the preview.
 await begin(page);await page.mouse.move(target.x+20,target.y);await expect(page.getByTestId('drawing-mirror-snap')).toHaveCount(0);await page.keyboard.press('Escape');await page.mouse.up();expect((await data(page)).mirrorAxisX).toBe(.35);
 const saved=await data(page),download=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await download).path())!);await expect.poll(()=>data(page)).toEqual(saved);await expect(page.getByTestId('drawing-mirror-guide')).toBeVisible();
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(axis).toHaveCount(0);await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-mirror-guide')).toBeVisible();
});

test('snapping uses screen tolerance at different zoom levels and highlights its target',async({page})=>{
 for(const clicks of [0,2]){
  await page.getByTestId('drawing-tool-mirror').click();const field=page.getByRole('spinbutton',{name:'Mirror axis X',exact:true});await field.fill('0');await field.press('Enter');
  for(let i=0;i<clicks;i++)await page.locator('.drawing-status').getByRole('button',{name:'＋',exact:true}).click();
  const target=await coord(page,.35,.2);await begin(page);await page.mouse.move(target.x+6,target.y);await expect(page.getByTestId('drawing-mirror-snap')).toHaveCount(1);await page.mouse.up();expect((await data(page)).mirrorAxisX).toBe(.35);
 }
 await page.getByTestId('language-toggle').click();await begin(page);const target=await coord(page,.35,.2);await page.mouse.move(target.x+3,target.y);await expect(page.getByTestId('drawing-mirror-snap')).toContainText('已吸附端点');await page.screenshot({path:'artifacts/drawing-arc/mirror-snap-zh.png'});await page.mouse.up();
});

test('persistent guide does not steal curve selection, endpoint dragging, pen strokes or zoom clicks',async({page})=>{
 // The source runs directly along the guide. Geometry must win the hit test.
 await page.getByTestId('drawing-tool-mirror').click();const center=await coord(page,0,0);await page.mouse.click(center.x,center.y);await expect(page.getByTestId('drawing-mirror-preview')).toHaveCount(1);
 await page.getByTestId('drawing-tool-direct').click();await page.mouse.click(center.x,center.y);await expect(page.locator('[data-testid=drawing-selected][data-id=a]')).toHaveCount(1);
 const node=page.getByTestId('drawing-node').first(),r=(await node.boundingBox())!;await page.mouse.move(r.x+4,r.y+4);await page.mouse.down();await page.mouse.move(r.x+34,r.y+4);await page.mouse.up();expect((await data(page)).mirrorAxisX).toBeUndefined();
 await page.getByTestId('drawing-tool-pen').click();const start=await coord(page,0,-.7),end=await coord(page,.5,-.7);await page.mouse.click(start.x,start.y);await page.mouse.click(end.x,end.y);await page.keyboard.press('Enter');expect((await data(page)).curves).toHaveLength(4);expect((await data(page)).mirrorAxisX).toBeUndefined();
 await page.getByTestId('drawing-tool-zoom').click();await page.mouse.click(center.x,center.y);await expect(page.locator('.drawing-status')).toContainText('130%');expect((await data(page)).mirrorAxisX).toBeUndefined();
});
