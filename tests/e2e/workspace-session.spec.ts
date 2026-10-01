import {test,expect,type Page} from '@playwright/test';

async function menu(page:Page){await expect(page.getByTestId('assembly-room-toggle')).toBeAttached();const trigger=page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true});if(await trigger.count())await trigger.hover();}
const state=(page:Page)=>page.evaluate(async()=>{
 const url='/src/ui/assemblyDrawing/session.ts',s=(await import(url)).useDrawing.getState();
 return {pan:s.pan,rigPan:s.rigPan,zoom:s.zoom,rigViewLocked:s.rigViewLocked,tool:s.tool,layerId:s.layerId,selection:s.selection,sidebar:s.sidebar,closedLayers:s.closedLayers,viewOptions:s.viewOptions};
});
const positions=(page:Page)=>page.getByTestId('assembly-drawing-canvas').evaluate(svg=>({
 axis:svg.querySelector('[data-testid="assembly-main-axis"]')?.getAttribute('d'),
 ink:Array.from(svg.querySelectorAll('[data-testid="assembly-drawing-ink"]')).slice(0,4).map(p=>p.getAttribute('d')),
 box:svg.getBoundingClientRect().toJSON(),
}));
test('reload keeps the assembly room, locked registration, editor tool and panels exactly in place',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await menu(page);await page.getByTestId('assembly-room-toggle').click();
 await page.getByTestId('assembly-3d').hover();await expect(page.locator('.app-menu-bar')).toHaveAttribute('data-open','false');
 await page.getByTestId('assembly-import').click();await page.getByRole('button',{name:'载入副本',exact:true}).click();
 const canvas=page.getByTestId('assembly-drawing-canvas');await expect(canvas).toBeVisible();await canvas.hover();
 await expect(page.locator('.app-menu-bar')).toHaveAttribute('data-open','false');
 const bounds=(await canvas.boundingBox())!,x=bounds.x+bounds.width*.4,y=bounds.y+bounds.height*.7;
 // Create an intentionally nonzero independent alignment, then lock and move both.
 await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+90,y+40,{steps:4});await page.mouse.up({button:'right'});
 await page.getByTestId('assembly-view-lock').click();await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x-35,y+20,{steps:4});await page.mouse.up({button:'right'});
 await page.mouse.wheel(0,-180);await expect.poll(async()=>(await state(page)).zoom).toBeGreaterThan(1);
 const row=page.getByTestId('assembly-drawing-layer-select').first();await row.click();await page.getByTestId('assembly-drawing-tool-direct').click();
 await page.getByRole('button',{name:'收起 3D 定位',exact:true}).click();await canvas.hover();
 await expect(page.getByTestId('assembly-3d')).toHaveCount(0);
 // Let ResizeObserver finish before measuring; navigation itself is not altered.
 const before=await state(page);expect(before.rigViewLocked).toBe(true);expect(before.rigPan).not.toEqual(before.pan);
 await expect.poll(async()=> (await positions(page)).box.width).toBeGreaterThan(bounds.width);
 const geometry=await positions(page);
 const projectBefore=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project));
 await page.reload();await expect(page.getByTestId('assembly-room')).toBeVisible();
 await expect(page.getByTestId('assembly-view-lock')).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>state(page)).toEqual(before);
 await expect.poll(()=>positions(page)).toEqual(geometry);
 expect(JSON.parse(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project)))).toEqual(JSON.parse(projectBefore));
 // A change made just before reload is flushed at pagehide, including an unlocked origin.
 await page.evaluate(async()=>{const url='/src/ui/assemblyDrawing/session.ts';const s=(await import(url)).useDrawing.getState();s.set({rigViewLocked:false,pan:[213,-77],rigPan:[19,33]});});
 await page.reload();await expect(page.getByTestId('assembly-room')).toBeVisible();
 expect(await state(page)).toMatchObject({rigViewLocked:false,pan:[213,-77],rigPan:[19,33]});
 expect(errors).toEqual([]);
});
test('drawing, recording and modeling remain the active room after reload',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('drawing-canvas')).toBeVisible();
 await page.evaluate(async()=>{const url='/src/ui/drawing/session.ts';(await import(url)).useDrawing.getState().set({zoom:2,pan:[88,-34],tool:'direct'});});
 await page.reload();await expect(page.getByTestId('drawing-canvas')).toBeVisible();
 expect(await page.evaluate(async()=>{const url='/src/ui/drawing/session.ts';const s=(await import(url)).useDrawing.getState();return {zoom:s.zoom,pan:s.pan,tool:s.tool};})).toEqual({zoom:2,pan:[88,-34],tool:'direct'});
 await menu(page);await page.getByTestId('room-toggle').click();await expect(page.getByTestId('recording-canvas')).toBeVisible();
 await page.evaluate(async()=>{const url='/src/ui/recording/session.ts';(await import(url)).useRecording.getState().set({view:{yaw:37,pitch:-11},zoom:1.5,pan:[50,12]});});
 await page.reload();await expect(page.getByTestId('recording-canvas')).toBeVisible();
 expect(await page.evaluate(async()=>{const url='/src/ui/recording/session.ts';const s=(await import(url)).useRecording.getState();return {view:s.view,zoom:s.zoom,pan:s.pan};})).toEqual({view:{yaw:37,pitch:-11},zoom:1.5,pan:[50,12]});
 await menu(page);await page.getByTestId('room-toggle').click();await expect(page.getByTestId('recording-canvas')).toHaveCount(0);
 await page.reload();await expect(page.getByTestId('drawing-canvas')).toHaveCount(0);await expect(page.getByTestId('recording-canvas')).toHaveCount(0);await expect(page.getByTestId('assembly-room')).toHaveCount(0);
 await expect(page.getByTestId('assembly-room-toggle')).toBeAttached();
});
