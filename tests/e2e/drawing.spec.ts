import {drawingTool} from '../helpers/drawingTool';
import {test,expect,type Page,type Locator} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
async function coord(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!;const u=Math.min(r.width,r.height)/2.8;return {x:r.x+r.width/2+x*u,y:r.y+r.height/2-y*u};}
async function click(p:Page,x:number,y:number){const q=await coord(p,x,y);await p.mouse.click(q.x,q.y);}
async function drag(p:Page,a:{x:number,y:number},b:{x:number,y:number}){await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(b.x,b.y,{steps:9});await p.mouse.up();}
async function line(p:Page,points:number[][]){await p.getByTestId('drawing-tool-pen').click();await p.getByRole('combobox',{name:'Continue with',exact:true}).selectOption('SMOOTH');for(const [x,y,dx=0,dy=0] of points){await drag(p,await coord(p,x,y),await coord(p,x+dx,y+dy));}await p.keyboard.press('Enter');}
async function curveClick(p:Page,id:string,f=.5){const q=await p.locator(`[data-testid=drawing-hit][data-id="${id}"]`).evaluate((el,f)=>{const e=el as SVGPathElement,v=e.getPointAtLength(e.getTotalLength()*f),m=e.getScreenCTM()!;return {x:m.a*v.x+m.c*v.y+m.e,y:m.b*v.x+m.d*v.y+m.f};},f);await p.mouse.click(q.x,q.y);}
async function input(p:Page,label:string,value:string){const n=p.getByRole('spinbutton',{name:label,exact:true});await n.fill(value);await n.press('Enter');}
async function seed(p:Page){await p.evaluate(async()=>{const u='/src/domain/drawing/commands.ts',m='/src/domain/drawing/model.ts',c=await import(u),e=(window as any).__editorPerfStore.getState();let d=c.addLayer((await import(m)).emptyDrawing(),'Eye');d=c.createCurve(d,d.layers[0].id,[[-.85,.1],[-.65,.6],[-.25,.6],[0,.1]],.01,'Lid A','a');d=c.createCurve(d,d.layers[0].id,[[.25,.1],[.3,.7],[.55,.4],[.9,.1]],.01,'Lid B','b');e.setDrawing(d);});}
const validate=(p:Page)=>p.evaluate(async()=>{const u='/src/domain/drawing/model.ts';(await import(u)).parseDrawing((window as any).__editorPerfStore.getState().project.drawing);});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('continuous pen, V/A editing, exact split, undo/redo and save/reopen workflow',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'New layer',exact:true}).click();const n=await history(page);
 await line(page,[[-.8,0,.2,.4],[0,.35,.25,-.05],[.8,0,.15,-.3]]);
 let d=await data(page);expect(d.curves).toHaveLength(2);expect(d.joins).toHaveLength(1);expect(await history(page)).toBe(n+2);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);
 const a=d.curves[0].id;await page.getByTestId('drawing-tool-direct').click();await curveClick(page,a);
 await expect(page.getByTestId('drawing-handle')).toHaveCount(2);
 const h=page.locator(`[data-testid=drawing-handle][data-id="${a}"][data-end="0"]`),r=(await h.boundingBox())!;const before=await data(page),undo=await history(page);
 await drag(page,{x:r.x+r.width/2,y:r.y+r.height/2},{x:r.x+25,y:r.y-12});expect(await history(page)).toBe(undo+1);expect(await data(page)).not.toEqual(before);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();await validate(page);
 await page.getByTestId('drawing-tool-split').click();await curveClick(page,a,.48);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);d=await data(page);expect(d.curves).toHaveLength(3);expect(d.joins).toHaveLength(2);
 await page.getByTestId('drawing-tool-select').click();await curveClick(page,a);await expect(page.getByTestId('drawing-selected')).toHaveCount(3);await expect(page.getByTestId('drawing-transform-box')).toHaveCount(1);
 const old=await data(page),hn=await history(page);await page.keyboard.press('ArrowRight');expect(await history(page)).toBe(hn+1);await page.keyboard.press('Meta+z');expect(await data(page)).toEqual(old);
 await input(page,'Rotate by °','12');await input(page,'Scale %','110');await validate(page);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-handle')).toHaveCount(0);await expect(page.getByTestId('drawing-selected')).toHaveCount(0);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);
 const saved=await data(page);const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();const f=await download;const path=await f.path();expect(path).toBeTruthy();
 await page.locator('header input[type=file]').setInputFiles(path!);await expect.poll(()=>data(page)).toEqual(saved);await page.waitForTimeout(350);await page.reload();await page.getByTestId('drawing-room-toggle').click();expect(await data(page)).toEqual(saved);await validate(page);
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'钢笔',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

test('two-click bind/smooth/cusp preview is transient; handle edits retain modes and one transaction',async({page})=>{
 await seed(page);const original=await data(page),n=await history(page);
 await drawingTool(page,'smooth');await click(page,0,.1);expect(await data(page)).toEqual(original);expect(await history(page)).toBe(n);
 const target=await coord(page,.25,.1);await page.mouse.move(target.x,target.y);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);expect(await data(page)).toEqual(original);
 await page.keyboard.press('Escape');await expect(page.getByTestId('drawing-ink')).toHaveCount(2);expect(await data(page)).toEqual(original);
 await click(page,0,.1);await click(page,.25,.1);expect((await data(page)).joins[0].mode).toBe('SMOOTH');expect(await history(page)).toBe(n+1);await validate(page);
 await page.getByRole('button',{name:'Change to cusp',exact:true}).click();expect((await data(page)).joins[0].mode).toBe('CUSP');await validate(page);
 await drawingTool(page,'direct');
 const h=page.getByTestId('drawing-handle').first(),r=(await h.boundingBox())!;await drag(page,{x:r.x+4,y:r.y+4},{x:r.x+30,y:r.y-10});expect((await data(page)).joins[0].mode).toBe('CUSP');await validate(page);
 await page.getByTestId('drawing-node').first().click();await page.getByRole('button',{name:'Position only',exact:true}).last().click();expect((await data(page)).joins).toHaveLength(0);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);
});

test('ellipse, whole stroke/segment selection, ordering, reference controls and workspace screenshot',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'New layer',exact:true}).click();await page.getByTestId('drawing-layer').locator('.drawing-object-name').first().click();await page.getByRole('textbox',{name:'Layer name',exact:true}).fill('Left eye');await page.getByRole('textbox',{name:'Layer name',exact:true}).press('Enter');
 await line(page,[[-.9,.1,.2,.45],[-.3,.38,.25,0],[.4,.1,.2,-.3]]);
 await line(page,[[-.9,.1,.3,-.4],[.4,.1,.2,.3]]);
 await page.getByTestId('drawing-tool-ellipse').click();await drag(page,await coord(page,-.4,-.12),await coord(page,.02,.3));expect((await data(page)).curves).toHaveLength(7);await expect(page.getByTestId('drawing-ink')).toHaveCount(3);await validate(page);
 await page.getByRole('button',{name:'New layer',exact:true}).click();await page.getByTestId('drawing-layer').first().locator('.drawing-object-name').first().click();await page.getByRole('textbox',{name:'Layer name',exact:true}).fill('Hair');await page.getByRole('textbox',{name:'Layer name',exact:true}).press('Enter');
 await line(page,[[-1,.55,.2,.4],[.2,.85,.4,0],[.95,-.3,.1,-.4]]);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await page.screenshot({path:'artifacts/drawing-room/workspace.png'});await page.getByTestId('language-toggle').click();await page.screenshot({path:'artifacts/drawing-room/workspace-zh.png'});await page.getByTestId('language-toggle').click();
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await page.getByTestId('drawing-layer').first().locator('.drawing-object-name').first().click();await page.getByRole('button',{name:'Send to back',exact:true}).click();expect((await data(page)).layers.at(-1).name).toBe('Hair');
 await page.getByRole('button',{name:'Duplicate layer',exact:true}).click();expect((await data(page)).layers).toHaveLength(3);await page.getByRole('button',{name:'Delete layer',exact:true}).click();expect((await data(page)).layers).toHaveLength(2);
 await page.getByTestId('drawing-reference-input').setInputFiles({name:'Reference.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=','base64')});
 await expect(page.getByTestId('drawing-reference')).toHaveCount(1);expect((await data(page)).reference.locked).toBe(true);await page.getByRole('button',{name:'Lock reference image',exact:true}).click();await input(page,'Image opacity %','35');await input(page,'Image scale %','1000');expect((await data(page)).reference.scale).toBe(10);
 const curves=(await data(page)).curves;await page.getByRole('button',{name:'Pan image',exact:true}).click();await drag(page,await coord(page,0,0),await coord(page,.5,.3));await page.getByRole('button',{name:'Finish image pan',exact:true}).click();expect((await data(page)).reference.offset[0]).toBeCloseTo(.5,3);expect((await data(page)).curves).toEqual(curves);await validate(page);expect(errors).toEqual([]);
});

test('related selection guard, locked layer, pen cancellation and independent workspaces',async({page})=>{
 await seed(page);await drawingTool(page,'bind');await click(page,0,.1);await click(page,.25,.1);
 await page.getByTestId('drawing-tool-direct').click();await curveClick(page,'a');const before=await data(page),n=await history(page);
 await page.getByRole('button',{name:'Flip horizontally',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(await data(page)).toEqual(before);await page.getByRole('button',{name:'Select required related curves',exact:true}).click();expect(await history(page)).toBe(n);
 await page.getByRole('button',{name:'Flip horizontally',exact:true}).click();expect(await history(page)).toBe(n+1);await validate(page);
 await page.getByRole('button',{name:'Lock Eye',exact:true}).click();const locked=await data(page);await page.getByTestId('drawing-tool-pen').click();await click(page,-.7,-.5);await click(page,.7,-.5);expect((await data(page)).curves).toHaveLength(locked.curves.length+1);expect((await data(page)).curves.at(-1)).toMatchObject({visible:true,locked:false});await page.keyboard.press('Escape');await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.getByRole('button',{name:'Unlock Eye',exact:true}).click();await page.getByTestId('drawing-tool-pen').click();await click(page,-.7,-.5);await page.keyboard.press('Escape');expect((await data(page)).curves).toHaveLength(2);
 const d=await data(page);await page.getByTestId('room-toggle').click();await expect(page.getByTestId('drawing-room')).toHaveCount(0);await page.getByTestId('drawing-room-toggle').click();expect(await data(page)).toEqual(d);await page.getByTestId('drawing-room-toggle').click();await expect(page.getByTestId('drawing-room')).toHaveCount(0);
});

test('mirror, merge, numeric edits, transforms, layering and background navigation stay in 2D',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);
 const head=await page.evaluate(()=>{const {drawing,...rest}=(window as any).__editorPerfStore.getState().project;return rest;});
 const original=await data(page),h=await history(page);await page.getByTestId('drawing-tool-mirror').click();await curveClick(page,'a');expect(await history(page)).toBe(h);await curveClick(page,'b');expect(await history(page)).toBe(h+1);await validate(page);
 const n=await data(page);expect(n.curves.find((c:any)=>c.id==='b').name).toBe('Lid B');expect(n.joins).toHaveLength(0);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(original);
 await page.getByTestId('drawing-tool-merge').click();await click(page,0,.1);await click(page,.25,.1);let d=await data(page);expect(d.joins).toHaveLength(0);expect(d.nodes).toHaveLength(4);await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.getByTestId('drawing-tool-direct').click();await curveClick(page,'a');await page.getByTestId('drawing-node').first().click();await input(page,'Node X','-0.9');expect((await data(page)).nodes.find((x:any)=>x.id===d.curves.find((x:any)=>x.id==='a').nodes[0]).position[0]).toBe(-.9);
 await page.getByTestId('drawing-tool-select').click();await curveClick(page,'a');const beforeScale=await data(page),scale=page.getByTestId('drawing-scale').last(),sr=(await scale.boundingBox())!;await drag(page,{x:sr.x+4,y:sr.y+4},{x:sr.x+35,y:sr.y-18});expect(await data(page)).not.toEqual(beforeScale);await validate(page);
 const rotate=page.getByTestId('drawing-rotate'),rr=(await rotate.boundingBox())!;await drag(page,{x:rr.x+5,y:rr.y+5},{x:rr.x+48,y:rr.y+28});await validate(page);
 await page.getByRole('button',{name:'Duplicate',exact:true}).click();expect((await data(page)).curves).toHaveLength(3);await page.keyboard.press('Delete');expect((await data(page)).curves).toHaveLength(2);await page.keyboard.press('Meta+z');expect((await data(page)).curves).toHaveLength(3);
 // Cross-layer content remains selectable, regardless of current creation layer.
 await page.getByRole('button',{name:'New layer',exact:true}).click();await page.getByTestId('drawing-tool-direct').click();await curveClick(page,'b');await expect(page.getByTestId('drawing-selected')).toHaveAttribute('data-id','b');
 const target=(await data(page)).layers[0].id;await page.getByRole('combobox',{name:'Move to layer',exact:true}).selectOption(target);expect((await data(page)).layers[0].items).toEqual(['b']);
 const snapshot=await data(page);await page.getByTestId('drawing-tool-hand').click();await drag(page,await coord(page,.7,-.6),await coord(page,.9,-.5));await page.mouse.wheel(0,-70);expect(await data(page)).toEqual(snapshot);
 const afterHead=await page.evaluate(()=>{const {drawing,...rest}=(window as any).__editorPerfStore.getState().project;return rest;});expect(afterHead).toEqual(head);expect(errors).toEqual([]);
});

test('undo removes a handle-selected creation safely; cancelled drafts do not leak or create history',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'New layer',exact:true}).click();await line(page,[[-.6,0,.1,.2],[.6,0,.1,-.2]]);
 const id=(await data(page)).curves[0].id;await page.getByTestId('drawing-tool-direct').click();await curveClick(page,id);await page.getByTestId('drawing-handle').first().click();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByTestId('drawing-room')).toBeVisible();expect((await data(page)).curves).toHaveLength(0);
 await page.getByTestId('drawing-tool-pen').click();const before=await data(page),h=await history(page);await click(page,-.6,0);const q=await coord(page,.6,0);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+20,q.y-20);await expect(page.getByTestId('drawing-pen-anchor')).toBeVisible();expect(await data(page)).toEqual(before);await page.keyboard.press('Escape');await page.mouse.up();expect(await data(page)).toEqual(before);expect(await history(page)).toBe(h);expect(errors).toEqual([]);
});

test('box/shift selection, curve names, list drag order, visibility and collapsible panels',async({page})=>{
 await seed(page);const h=await history(page);await page.getByTestId('drawing-tool-select').click();await drag(page,await coord(page,-1,-.1),await coord(page,1,.8));await expect(page.getByTestId('drawing-selected')).toHaveCount(2);expect(await history(page)).toBe(h);
 await page.getByTestId('drawing-tool-direct').click();await curveClick(page,'a');await page.keyboard.down('Shift');await curveClick(page,'b');await page.keyboard.up('Shift');await expect(page.getByTestId('drawing-selected')).toHaveCount(2);
 const a=page.locator('[data-testid=drawing-curve-row][data-id=a]'),b=page.locator('[data-testid=drawing-curve-row][data-id=b]');await a.getByRole('button',{name:'Lid A',exact:true}).click();await page.getByRole('textbox',{name:'Curve name',exact:true}).fill('Upper eyelid');await page.getByRole('textbox',{name:'Curve name',exact:true}).press('Enter');expect(await history(page)).toBe(h+1);
 await a.locator('..').dragTo(b.locator('..'),{targetPosition:{x:10,y:2}});expect((await data(page)).layers[0].items).toEqual(['a','b']);
 await a.getByRole('button',{name:'Hide Upper eyelid',exact:true}).click();await expect(page.getByTestId('drawing-ink')).toHaveCount(1);await a.getByRole('button',{name:'Show Upper eyelid',exact:true}).click();await expect(page.getByTestId('drawing-ink')).toHaveCount(2);
 await page.getByRole('button',{name:'New layer',exact:true}).click();const list=page.getByTestId('drawing-layer'),top=(await data(page)).layers[0].id;await list.first().locator('.drawing-layer-row').dragTo(list.last().locator('.drawing-layer-row'),{targetPosition:{x:10,y:30}});expect((await data(page)).layers.at(-1).id).toBe(top);
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await expect(page.getByRole('region',{name:'Drawing layers'})).toHaveCount(0);await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();await expect(page.getByRole('region',{name:'Drawing layers'})).toBeVisible();await validate(page);
});
