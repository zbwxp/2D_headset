import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const zoom=(p:Page)=>p.locator('.drawing-status').innerText().then(s=>Number(s.match(/(\d+)%/)![1]));
async function selectJoint(p:Page){const d=await data(p),node=d.curves.find((c:any)=>c.id==='a').nodes[1];await p.locator('[data-testid=drawing-curve-row][data-id=a] .drawing-object-name').click();await p.locator(`[data-testid=drawing-node][data-node="${node}"]`).click();}
async function field(p:Page,name:string,value:string){const f=p.getByRole('spinbutton',{name,exact:true});await f.fill(value);await f.press('Enter');}
async function hit(p:Page,id:string){const q=await p.locator(`[data-testid=drawing-hit][data-id="${id}"]`).first().evaluate(el=>{const s=el as SVGPathElement,q=s.getPointAtLength(s.getTotalLength()*.5).matrixTransform(s.getScreenCTM()!);return {x:q.x,y:q.y};});await p.mouse.click(q.x,q.y);}
async function seed(p:Page,kind:'cusp'|'bound'|'stationary'='cusp'){await p.evaluate(async kind=>{
 const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Join study');
 d=c.createCurve(d,d.layers[0].id,[[-1,0],[-.8,.2],[-.3,.1],[0,0]],.012,'Source','a');d=c.createCurve(d,d.layers[0].id,[[.2,0],[.5,.3],[.8,.4],[1,0]],.012,'Target','b');
 if(kind==='cusp')d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'CUSP');
 else{d=c.createCurve(d,d.layers[0].id,[[.2,0],[.2,-.2],[.3,-.6],[.5,-.8]],.012,'Neighbour','n');d=c.connect(d,{curveId:'b',end:0},{curveId:'n',end:0},'POSITION');if(kind==='stationary'){d=c.moveNode(d,m.nodeAt(d,{curveId:'a',end:0}).id,[-.2,0]);d=c.curveChange(d,'n',{locked:true});}}
 (window as any).__editorPerfStore.getState().setDrawing(d);
 },kind);}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('Z zoom tool: held Ctrl toggles cursor and click direction without replacing Undo',async({page})=>{
 await seed(page);await page.getByTestId('drawing-canvas').focus();await page.keyboard.press('z');await expect(page.getByTestId('drawing-tool-zoom')).toHaveAttribute('aria-pressed','true');
 const canvas=page.getByTestId('drawing-canvas'),r=(await canvas.boundingBox())!,h=await history(page),old=await data(page);await page.mouse.move(r.x+r.width*.45,r.y+r.height*.4);
 await expect(canvas).toHaveCSS('cursor','zoom-in');await page.mouse.down();await page.mouse.up();await expect.poll(()=>zoom(page)).toBe(130);
 await page.keyboard.down('Control');await expect(canvas).toHaveCSS('cursor','zoom-out');await page.mouse.down();await page.mouse.up();await expect.poll(()=>zoom(page)).toBe(100);
 // Native macOS Ctrl-click may arrive as right button; it must not start pan.
 await page.mouse.click(r.x+r.width*.45,r.y+r.height*.4,{button:'right'});await expect.poll(()=>zoom(page)).toBe(77);
 await page.keyboard.up('Control');await expect(canvas).toHaveCSS('cursor','zoom-in');await page.mouse.click(r.x+r.width*.45,r.y+r.height*.4);await expect.poll(()=>zoom(page)).toBe(100);expect(await history(page)).toBe(h);expect(await data(page)).toEqual(old);
 await page.getByTestId('drawing-tool-mirror').click();await field(page,'Mirror axis X','0.3');await canvas.focus();await page.keyboard.press('z');
 await page.keyboard.press('Control+z');expect(await data(page)).toEqual(old);await expect.poll(()=>zoom(page)).toBe(100);
});

test('cusp is an ink join with independent handles, no angle field, Undo and save/load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);await selectJoint(page);
 await expect(page.getByText('Cusp makes a sharp ink join; both handles remain independent.',{exact:true})).toBeVisible();
 await expect(page.getByRole('spinbutton',{name:'Cusp angle °',exact:true})).toHaveCount(0);const original=await data(page),h=await history(page);
 await page.locator('[data-testid=drawing-handle][data-id=a][data-end="1"]').click();await field(page,'Node Y','0.35');const edited=await data(page);
 expect(edited.curves.find((c:any)=>c.id==='b')).toEqual(original.curves.find((c:any)=>c.id==='b'));expect(edited.curves.find((c:any)=>c.id==='a').handles[1][1]).toBe(.35);expect(edited.joins).toEqual(original.joins);expect(edited.joins[0].angle).toBeUndefined();expect(await history(page)).toBe(h+1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(original);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(edited);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await download).path())!);await expect.poll(()=>data(page)).toEqual(edited);
 await selectJoint(page);await page.getByTestId('language-toggle').click();await expect(page.getByText('尖点只影响描边尖角，两侧控制柄独立编辑。',{exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/drawing-arc/cusp-render-zh.png'});expect(errors).toEqual([]);
});

test('linked mirror has a direct continue action, cancel is atomic and one Undo restores all members',async({page})=>{
 await seed(page,'bound');const before=await data(page),h=await history(page);await page.getByTestId('drawing-tool-mirror').click();await hit(page,'a');await hit(page,'b');
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Neighbour');await expect(dialog).not.toContainText('Source');expect(await data(page)).toEqual(before);expect(await history(page)).toBe(h);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await data(page)).toEqual(before);await hit(page,'b');await dialog.getByRole('button',{name:'Continue mirror',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await history(page)).toBe(h+1);
 const after=await data(page);expect(after.curves.find((c:any)=>c.id==='a')).toEqual(before.curves.find((c:any)=>c.id==='a'));expect(after.curves.find((c:any)=>c.id==='n').handles).not.toEqual(before.curves.find((c:any)=>c.id==='n').handles);
 await page.evaluate(async()=>{const m=await import('/src/domain/drawing/model.ts' as string),d=(window as any).__editorPerfStore.getState().project.drawing;m.parseDrawing(d);const a=m.shapeOf(d,'a'),b=m.shapeOf(d,'b');if(a.some((p:number[],i:number)=>Math.hypot(p[0]+b[i][0],p[1]-b[i][1])>1e-8))throw Error('mirror mismatch');});
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(after);
});

test('shared unchanged endpoint does not block mirror, including an unchanged locked neighbour',async({page})=>{
 await seed(page,'stationary');const before=await data(page);await page.getByTestId('drawing-tool-mirror').click();await hit(page,'a');await hit(page,'b');await expect(page.getByRole('dialog')).toHaveCount(0);const after=await data(page);expect(after.curves.find((c:any)=>c.id==='n')).toEqual(before.curves.find((c:any)=>c.id==='n'));expect(after.curves.find((c:any)=>c.id==='b').handles).not.toEqual(before.curves.find((c:any)=>c.id==='b').handles);
});
