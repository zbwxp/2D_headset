import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const curveRow=(p:Page,id:string)=>p.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`);
const paintRow=(p:Page,id:string)=>p.locator(`[data-testid=drawing-paint-row][data-id="${id}"] .drawing-object-name`);
const shape=(d:any,id:string)=>{const c=d.curves.find((x:any)=>x.id===id);return [d.nodes.find((n:any)=>n.id===c.nodes[0]).position,...c.handles,d.nodes.find((n:any)=>n.id===c.nodes[1]).position];};
function moved(before:any,after:any,id:string,delta:number[]){shape(after,id).forEach((p:number[],i:number)=>p.forEach((v,j)=>expect(v).toBeCloseTo(shape(before,id)[i][j]+delta[j],9)));}
async function seed(page:Page){return page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string),g=await import('/src/domain/drawing/groups.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Artwork');const e=c.ellipse(d,d.layers[0].id,[-.6,-.4],[.6,.4],.02);d=p.createFill(e.document,e.ids,'white');d=c.createCurve(d,d.layers[0].id,[[-.8,.7],[-.4,.9],[.4,.9],[.8,.7]],.02,'Brow','brow');d=p.createOffset(d,'brow');d=g.createGroup(d,[e.ids[0],'brow'],'Eye');d.reference={name:'Reference',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',width:1,height:1,scale:1,rotation:0,opacity:.2,offset:[0,0],visible:true,locked:false};(window as any).__editorPerfStore.getState().setDrawing(d);return {ellipse:e.ids,fill:d.fills[0].id,offset:d.offsets[0].id,layer:d.layers[0].id};});}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('curve, node and handle nudges use normal/fine/coarse steps and one Undo per held-key gesture',async({page})=>{
 await seed(page);await curveRow(page,'brow').click();const before=await data(page),h=await history(page);
 await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowRight');expect(await data(page)).toEqual(before);await page.keyboard.up('ArrowRight');moved(before,await data(page),'brow',[.012,0]);expect(await history(page)).toBe(h+1);
 await page.keyboard.press('Control+z');expect(await data(page)).toEqual(before);await page.keyboard.press('Control+Shift+z');moved(before,await data(page),'brow',[.012,0]);
 await page.keyboard.press('Shift+ArrowUp');await page.keyboard.press('Alt+ArrowLeft');moved(before,await data(page),'brow',[.0112,.02]);
 await page.getByRole('button',{name:'P0 Endpoint',exact:true}).click();const a=await data(page);await page.keyboard.press('ArrowDown');const b=await data(page);expect(shape(b,'brow')[0][1]).toBeCloseTo(shape(a,'brow')[0][1]-.004);expect(shape(b,'brow').slice(2)).toEqual(shape(a,'brow').slice(2));
 await page.getByRole('button',{name:'P1 Handle',exact:true}).click();const raw=await data(page);await page.keyboard.press('ArrowLeft');const n=await data(page);expect(n.nodes).toEqual(raw.nodes);expect(shape(n,'brow')[2][0]).toBeCloseTo(shape(raw,'brow')[2][0]-.004);
});

test('selected groups and layers nudge hidden members and selected followers once without changing organization',async({page})=>{
 const f=await seed(page);await page.locator('[data-testid=drawing-curve-row][data-id=brow]').getByRole('button',{name:'Hide Brow',exact:true}).click();
 await page.getByTestId('drawing-group-select').click();const raw=await data(page);await page.keyboard.press('ArrowRight');let n=await data(page);raw.curves.forEach((c:any)=>moved(raw,n,c.id,[.004,0]));expect(n.layers).toEqual(raw.layers);expect(n.groups).toEqual(raw.groups);expect(n.curves.find((c:any)=>c.id==='brow').visible).toBe(false);
 await page.locator(`[data-testid=drawing-layer][data-id="${f.layer}"] > .drawing-layer-row .drawing-object-name`).click();const a=await data(page);await page.keyboard.press('ArrowDown');n=await data(page);a.curves.forEach((c:any)=>moved(a,n,c.id,[0,-.004]));expect(n.offsets[0].translation).toBeUndefined();expect(n.fills).toEqual(a.fills);
});

test('fill and offset rows move with Undo, preserve sources/relationships and Save/Load',async({page})=>{
 const f=await seed(page);await paintRow(page,f.fill).click();const raw=await data(page);await page.keyboard.press('ArrowRight');let n=await data(page);f.ellipse.forEach(id=>moved(raw,n,id,[.004,0]));expect(shape(n,'brow')).toEqual(shape(raw,'brow'));expect(n.fills).toEqual(raw.fills);
 await page.keyboard.press('Meta+z');expect(await data(page)).toEqual(raw);await paintRow(page,f.offset).click();await page.keyboard.press('Shift+ArrowUp');n=await data(page);expect(n.offsets[0].translation).toEqual([0,.02]);expect(n.curves).toEqual(raw.curves);expect(n.offsets[0].source).toEqual(raw.offsets[0].source);await expect(page.getByRole('spinbutton',{name:'Offset position Y',exact:true})).toHaveValue('0.02');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await download).path())!);expect(await data(page)).toEqual(n);
});

test('background and selected mirror axis nudge independently; axis up/down does not create history',async({page})=>{
 await seed(page);await page.locator('.drawing-reference-row > button').first().click();const raw=await data(page);await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowUp');let n=await data(page);expect(n.reference.offset).toEqual([.004,.02]);expect(n.curves).toEqual(raw.curves);
 await page.getByTestId('drawing-mirror-grip').click();const h=await history(page);await page.keyboard.press('ArrowDown');expect(await history(page)).toBe(h);await page.keyboard.press('ArrowLeft');n=await data(page);expect(n.mirrorAxisX).toBe(-.004);expect(n.reference.offset).toEqual([.004,.02]);expect(n.curves).toEqual(raw.curves);
 await page.keyboard.press('Control+z');expect((await data(page)).mirrorAxisX).toBeUndefined();
});

test('bound-segment nudges do not warn, while locks and input focus protect against unintended changes',async({page})=>{
 await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Joined');d=c.createCurve(d,d.layers[0].id,[[-.8,0],[-.6,.1],[-.2,.1],[0,0]],.02,'A','a');d=c.createCurve(d,d.layers[0].id,[[0,0],[.2,-.1],[.6,-.1],[.8,0]],.02,'B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');(window as any).__editorPerfStore.getState().setDrawing(d);});
 await curveRow(page,'a').click();const raw=await data(page);await page.keyboard.press('ArrowLeft');let n=await data(page);moved(raw,n,'a',[-.004,0]);expect(shape(n,'b').slice(2)).toEqual(shape(raw,'b').slice(2));await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('[data-testid=drawing-curve-row][data-id=b]').getByRole('button',{name:'Lock B',exact:true}).click();const locked=await data(page),h=await history(page);await curveRow(page,'a').click();await page.keyboard.press('ArrowRight');expect(await data(page)).toEqual(locked);expect(await history(page)).toBe(h);await expect(page.locator('.drawing-status [role=status]')).toContainText('locked');
 const input=page.getByRole('textbox',{name:'Curve name',exact:true});await input.focus();await page.keyboard.press('ArrowRight');expect(await data(page)).toEqual(locked);
});

test('keyup loss, focus changes and cancellation never lose or double-commit a nudge',async({page})=>{
 const f=await seed(page);await curveRow(page,'brow').click();const raw=await data(page),h=await history(page);
 await page.keyboard.down('ArrowRight');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('ArrowRight');moved(raw,await data(page),'brow',[.004,0]);expect(await history(page)).toBe(h+1);
 await page.keyboard.down('ArrowRight');await paintRow(page,f.fill).click();await page.keyboard.up('ArrowRight');moved(raw,await data(page),'brow',[.008,0]);expect(await history(page)).toBe(h+2);
 const before=await data(page);await page.keyboard.down('ArrowDown');await page.keyboard.press('Escape');await page.keyboard.up('ArrowDown');expect(await data(page)).toEqual(before);expect(await history(page)).toBe(h+2);
 await page.keyboard.down('ArrowDown');await page.keyboard.press('Control+z');await page.keyboard.up('ArrowDown');expect(await data(page)).toEqual(before);expect(await history(page)).toBe(h+2);
});

test('nudging the active pen segment keeps the next segment attached and restores the anchor on Undo',async({page})=>{
 await page.getByRole('button',{name:'New layer',exact:true}).click();await page.getByTestId('drawing-tool-pen').click();const box=(await page.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(box.width,box.height)/2.8;
 const click=async(x:number,y:number)=>page.mouse.click(box.x+box.width/2+x*u,box.y+box.height/2-y*u);
 await click(-.8,0);await click(0,.3);const first=await data(page);await page.keyboard.press('Shift+ArrowRight');const n=await data(page);moved(first,n,first.curves[0].id,[.02,0]);
 await page.keyboard.press('Control+z');expect(await data(page)).toEqual(first);await page.keyboard.press('Control+Shift+z');expect(await data(page)).toEqual(n);
 await click(.6,0);const next=await data(page);expect(next.curves).toHaveLength(2);expect(next.curves[1].nodes[0]).toBe(n.curves[0].nodes[1]);expect(shape(next,next.curves[1].id)[0]).toEqual(shape(n,n.curves[0].id)[3]);
});
