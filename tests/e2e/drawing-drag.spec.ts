import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
async function coord(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;return {x:r.x+r.width/2+x*u,y:r.y+r.height/2-y*u};}
async function start(p:Page,a:{x:number;y:number},b:{x:number;y:number}){await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(b.x,b.y,{steps:5});}
async function releaseCapture(p:Page){await p.getByTestId('drawing-canvas').evaluate(el=>{const id=(window as any).__dragPointer;if(el.hasPointerCapture(id))el.releasePointerCapture(id);});}
async function seed(p:Page){await p.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),s=await import('/src/ui/drawing/session.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Drag regression');d=c.createCurve(d,d.layers[0].id,[[-.8,0],[-.6,.4],[.4,.5],[.6,0]],.01,'A','a');(window as any).__editorPerfStore.getState().setDrawing(d);s.useDrawing.setState({tool:'select',selection:{ids:[]},zoom:1,pan:[0,0],layerId:d.layers[0].id});});}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('contour.ui-language','en');window.addEventListener('pointerdown',e=>(window as any).__dragPointer=e.pointerId,true);});await page.goto('/');await page.getByTestId('drawing-room-toggle').click();await seed(page);});

test('mirror release outside canvas after native capture loss commits once without snapping back',async({page})=>{
 await page.getByTestId('drawing-tool-mirror').click();const a=await coord(page,0,-.7),b=await coord(page,.25,-.7),h=await history(page);await start(page,a,b);await releaseCapture(page);
 // Real native capture loss: subsequent pointermove/up target the sidebar, not the SVG.
 const r=(await page.locator('.drawing-sidebar').boundingBox())!,end={x:r.x+40,y:b.y};await page.mouse.move(end.x,end.y);await page.mouse.up();
 const u=(b.x-a.x)/.25;expect((await data(page)).mirrorAxisX).toBeCloseTo((end.x-a.x)/u,4);expect(await history(page)).toBe(h+1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await data(page)).mirrorAxisX).toBeUndefined();await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await data(page)).mirrorAxisX).toBeCloseTo((end.x-a.x)/u,4);
});

test('window blur at release preserves the last valid mirror preview exactly once',async({page})=>{
 await page.getByTestId('drawing-tool-mirror').click();const h=await history(page);await start(page,await coord(page,0,-.7),await coord(page,.3,-.7));expect((await data(page)).mirrorAxisX).toBeUndefined();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();expect((await data(page)).mirrorAxisX).toBeCloseTo(.3,4);expect(await history(page)).toBe(h+1);
});

test('node and handle drags survive capture loss, foreign pointer cancellation and viewport exit',async({page})=>{
 await page.locator('[data-testid=drawing-curve-row][data-id=a] .drawing-object-name').click();const raw=await data(page),node=page.getByTestId('drawing-node').first(),r=(await node.boundingBox())!,a={x:r.x+4,y:r.y+4},b={x:a.x+35,y:a.y-25},h=await history(page);await start(page,a,b);await releaseCapture(page);await page.mouse.move(b.x+10,b.y-10);await page.mouse.up();expect(await data(page)).not.toEqual(raw);expect(await history(page)).toBe(h+1);
 const handle=page.locator('[data-testid=drawing-handle][data-end="1"]'),hr=(await handle.boundingBox())!,before=await data(page),n=await history(page);await start(page,{x:hr.x+4,y:hr.y+4},{x:hr.x+45,y:hr.y+10});
 await page.getByTestId('drawing-canvas').dispatchEvent('pointercancel',{pointerId:999,pointerType:'touch',bubbles:true});await page.mouse.move(hr.x+60,hr.y+20);await page.mouse.up();expect((await data(page)).curves[0].handles[1]).not.toEqual(before.curves[0].handles[1]);expect(await history(page)).toBe(n+1);
});

test('explicit Escape and external Undo still discard pending previews safely',async({page})=>{
 await page.getByTestId('drawing-tool-mirror').click();const raw=await data(page),h=await history(page);await start(page,await coord(page,0,-.7),await coord(page,.3,-.7));await releaseCapture(page);await page.keyboard.press('Escape');await page.mouse.up();expect(await data(page)).toEqual(raw);expect(await history(page)).toBe(h);
 await start(page,await coord(page,0,-.7),await coord(page,.2,-.7));await page.mouse.up();expect(await history(page)).toBe(h+1);
 await start(page,await coord(page,.2,-.7),await coord(page,.4,-.7));await page.evaluate(()=>(window as any).__editorPerfStore.getState().undo());await page.mouse.up();expect(await data(page)).toEqual(raw);expect(await history(page)).toBe(h);
});

test('matching pointercancel and mouseup fallback retain one valid result, never a stuck drag',async({page})=>{
 await page.getByTestId('drawing-tool-mirror').click();const h=await history(page);await start(page,await coord(page,0,-.7),await coord(page,.2,-.7));
 await page.getByTestId('drawing-canvas').evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:(window as any).__dragPointer,bubbles:true})));expect((await data(page)).mirrorAxisX).toBeCloseTo(.2,4);await expect(page.getByRole('status')).toContainText('last valid position');await page.mouse.up();expect(await history(page)).toBe(h+1);
 const before=await data(page);await start(page,await coord(page,.2,-.7),await coord(page,.4,-.7));
 // Emulate a host that forwards mouseup but drops pointerup.
 await page.evaluate(()=>window.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true})));expect((await data(page)).mirrorAxisX).toBeCloseTo(.4,4);await page.mouse.up();expect(await history(page)).toBe(h+2);
 await page.mouse.move(700,400);expect((await data(page)).mirrorAxisX).toBeCloseTo(.4,4);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
});
