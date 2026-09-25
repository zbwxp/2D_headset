import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const zoom=(p:Page)=>p.locator('.drawing-status').innerText().then(s=>Number(s.match(/(\d+)%/)![1]));
async function coord(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;return {x:r.x+r.width/2+x*u,y:r.y+r.height/2-y*u};}
async function field(p:Page,name:string,value:string){const f=p.getByRole('spinbutton',{name,exact:true});await f.fill(value);await f.press('Enter');}
async function seed(p:Page){await p.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Endpoint study');
 d=c.createCurve(d,d.layers[0].id,[[-.9,0],[-.7,0],[-.5,0],[-.3,0]],.025,'Incoming','a');d=c.createCurve(d,d.layers[0].id,[[-.3,0],[-.3,.2],[-.3,.45],[-.3,.65]],.025,'Outgoing','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC');
 d=c.createCurve(d,d.layers[0].id,[[.35,-.15],[.5,-.15],[.65,-.15],[.8,-.15]],.025,'Target','target');d=c.curveChange(d,'target',{locked:true});
 d=c.createCurve(d,d.layers[0].id,[[.1,-.55],[.3,-.55],[.5,-.55],[.7,-.55]],.025,'Hidden','hidden');d=c.curveChange(d,'hidden',{visible:false});
 (window as any).__editorPerfStore.getState().setDrawing(d);
 });}
async function choose(p:Page,id:string){await p.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('ARC shared endpoint snaps to another endpoint and mirror axis, commits once and undoes the whole group',async({page})=>{
 await seed(page);await choose(page,'a');const old=await data(page),h=await history(page),nodeId=old.curves.find((x:any)=>x.id==='a').nodes[1],node=page.locator(`[data-testid=drawing-node][data-node="${nodeId}"]`),r=(await node.boundingBox())!,target=await coord(page,.35,-.15);
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(target.x+4,target.y+2,{steps:6});await expect(page.getByTestId('drawing-node-snap')).toContainText('Snapped to endpoint');expect(await data(page)).toEqual(old);await page.mouse.up();
 let next=await data(page);expect(next.nodes.find((x:any)=>x.id===nodeId).position).toEqual([.35,-.15]);expect(next.curves.find((x:any)=>x.id==='b').nodes[0]).toBe(nodeId);expect(next.curves.find((x:any)=>x.id==='target').nodes[0]).not.toBe(nodeId);expect(next.joins).toEqual(old.joins);expect(next.nodes).toHaveLength(old.nodes.length);expect(await history(page)).toBe(h+1);
 for(const id of ['a','b']){const end=id==='a'?1:0,after=next.curves.find((x:any)=>x.id===id).handles[end],before=old.curves.find((x:any)=>x.id===id).handles[end];expect(after[0]-before[0]).toBeCloseTo(.65);expect(after[1]-before[1]).toBeCloseTo(-.15);}
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(old);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(next);
 const box=(await node.boundingBox())!,axis=await coord(page,0,-.38);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(axis.x+4,axis.y);await expect(page.getByTestId('drawing-node-snap')).toContainText('Snapped to mirror axis');await page.screenshot({path:'artifacts/drawing-arc/endpoint-snap.png'});await page.mouse.up();expect((await data(page)).nodes.find((x:any)=>x.id===nodeId).position[0]).toBe(0);
 // Hidden endpoints are not snap targets.
 const b=(await node.boundingBox())!,hidden=await coord(page,.1,-.55);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(hidden.x+4,hidden.y);await expect(page.getByTestId('drawing-node-snap')).toHaveCount(0);await page.keyboard.press('Escape');await page.mouse.up();expect((await data(page)).nodes.find((x:any)=>x.id===nodeId).position[0]).toBe(0);
});

test('Z drag uses vertical displacement, anchors the press position and adds no Undo entry',async({page})=>{
 await seed(page);await page.getByTestId('drawing-tool-zoom').click();const q=await coord(page,0,0),h=await history(page),old=await data(page);
 const center=()=>page.getByTestId('drawing-mirror-axis').getAttribute('x1').then(Number),x=await center();
 await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+45,q.y-65,{steps:8});const enlarged=await zoom(page);expect(enlarged).toBeGreaterThan(150);expect(await center()).toBeCloseTo(x,5);
 await page.mouse.move(q.x+70,q.y+65,{steps:9});expect(await zoom(page)).toBeLessThan(65);await page.mouse.up();const small=await zoom(page);expect(small).toBeLessThan(enlarged);expect(await history(page)).toBe(h);expect(await data(page)).toEqual(old);
 await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x,q.y-60);await page.keyboard.press('Escape');await page.mouse.up();expect(await zoom(page)).toBe(small);
});

test('fresh Pen defaults to position-only binding and handles remain independently editable',async({page})=>{
 await page.getByRole('button',{name:'New layer',exact:true}).click();await page.getByTestId('drawing-tool-pen').click();await expect(page.getByRole('combobox',{name:'Continue with',exact:true})).toHaveValue('POSITION');
 for(const xy of [[-.7,-.2],[0,.3],[.7,-.2]]){const q=await coord(page,xy[0],xy[1]);await page.mouse.click(q.x,q.y);}await page.keyboard.press('Enter');const d=await data(page);expect(d.curves).toHaveLength(2);expect(d.nodes).toHaveLength(3);expect(d.joins).toHaveLength(0);expect(d.curves[0].nodes[1]).toBe(d.curves[1].nodes[0]);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);
 await choose(page,d.curves[0].id);const handle=page.locator(`[data-testid=drawing-handle][data-id="${d.curves[0].id}"][data-end="1"]`),r=(await handle.boundingBox())!;await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+40,r.y-25);await page.mouse.up();expect((await data(page)).curves[1].handles).toEqual(d.curves[1].handles);
});

test('ink endpoints select, taper and extend visibly, retain geometry and survive Undo and Save/Load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);await choose(page,'a');await page.getByRole('button',{name:'Stroke start',exact:true}).click();
 const old=await data(page),originalInk=await page.getByTestId('drawing-ink').first().getAttribute('d');await field(page,'Stroke extension distance px','30');await field(page,'Endpoint taper distance px','18');
 const next=await data(page),styled=next.curves.find((x:any)=>x.inkEnds),end=styled.inkEnds[0].extension?0:1;expect(styled.inkEnds[end]).toEqual({extension:.12,taper:.072});expect(next.nodes).toEqual(old.nodes);expect(next.joins).toEqual(old.joins);expect(next.curves.map((c:any)=>c.handles)).toEqual(old.curves.map((c:any)=>c.handles));expect(await page.getByTestId('drawing-ink').first().getAttribute('d')).not.toBe(originalInk);
 const tip=page.locator(`[data-testid=drawing-ink-endpoint][data-id="${styled.id}"][data-end="${end}"]`);await tip.click();await expect(page.getByRole('spinbutton',{name:'Stroke extension distance px',exact:true})).toHaveValue('30');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await data(page)).curves.find((x:any)=>x.id===styled.id).inkEnds[end].taper).toBeUndefined();await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(next);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(next);
 await choose(page,styled.id);await page.locator(`[data-testid=drawing-ink-endpoint][data-id="${styled.id}"][data-end="${end}"]`).click();await page.getByTestId('language-toggle').click();await page.getByRole('spinbutton',{name:'笔触延伸距离 px',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/drawing-arc/ink-endpoints-zh.png'});
 await page.getByRole('button',{name:'隐藏编辑辅助',exact:true}).click();await expect(page.getByTestId('drawing-ink-endpoint')).toHaveCount(0);await expect(page.getByTestId('drawing-ink')).toHaveCount(2);expect(errors).toEqual([]);
});
