import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
async function at(p:Page,x:number,y:number){const b=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(b.width,b.height)/2.8;return {x:b.x+b.width/2+x*u,y:b.y+b.height/2-y*u};}
async function click(p:Page,x:number,y:number){const a=await at(p,x,y);await p.mouse.click(a.x,a.y);}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});
test('Pen keyboard Undo removes one segment and resumes from the previous anchor',async({page})=>{
 await page.getByRole('button',{name:'New layer',exact:true}).click();await page.getByTestId('drawing-tool-pen').click();
 await click(page,-.8,0);await click(page,-.2,.3);const first=await data(page);await click(page,.4,0);expect((await data(page)).curves).toHaveLength(2);
 await page.keyboard.press('Control+z');expect(await data(page)).toEqual(first);await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(1);
 await click(page,.6,-.2);const next=await data(page);expect(next.curves).toHaveLength(2);expect(next.curves[1].nodes[0]).toBe(first.curves[0].nodes[1]);
});

test('Pen Ctrl/Cmd Undo/Redo restores geometry, closing and continuation without double Undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'New layer',exact:true}).click();const empty=await data(page);await page.getByTestId('drawing-tool-pen').click();
 await click(page,-.8,0);await page.keyboard.press('Control+z');expect(await data(page)).toEqual(empty);await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(0);
 await click(page,-.8,0);await click(page,0,.5);const first=await data(page);await click(page,.8,0);const second=await data(page);await click(page,-.8,0);const closed=await data(page);expect(closed.curves).toHaveLength(3);await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(0);
 await page.keyboard.press('Meta+z');expect(await data(page)).toEqual(second);await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(1);
 await page.keyboard.press('Meta+Shift+z');expect(await data(page)).toEqual(closed);await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(0);
 await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');expect(await data(page)).toEqual(first);
 await page.keyboard.press('Control+y');expect(await data(page)).toEqual(second);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(first);await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(1);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(second);
 await page.getByTestId('drawing-canvas').focus();await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');expect(await data(page)).toEqual(empty);await page.keyboard.press('Control+z');expect(await data(page)).toEqual(empty);await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(0);expect(errors).toEqual([]);
});
async function seed(p:Page,connected=false){return p.evaluate(async connected=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Lines');for(let i=0;i<6;i++){const x=-.9+i*.3;d=c.createCurve(d,d.layers[0].id,[[x,0],[x+.1,.2],[x+.2,.2],[x+.3,0]],.015,'Line '+i,'c'+i);if(connected&&i)d=c.connect(d,{curveId:'c'+(i-1),end:1},{curveId:'c'+i,end:0},'POSITION');}(window as any).__editorPerfStore.getState().setDrawing(d);return d;},connected);}
const row=(p:Page,id:string)=>p.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`);
const chosen=(p:Page)=>p.locator('[data-testid=drawing-curve-row].selected').evaluateAll(els=>els.map(e=>e.getAttribute('data-id')));
test('list Shift selects and shrinks a displayed range, Ctrl/Cmd toggles, Delete removes it in one Undo',async({page})=>{
 const before=await seed(page);await row(page,'c5').click();await row(page,'c2').click({modifiers:['Shift']});expect(await chosen(page)).toEqual(['c5','c4','c3','c2']);
 await row(page,'c4').click({modifiers:['Shift']});expect(await chosen(page)).toEqual(['c5','c4']);
 await row(page,'c1').click({modifiers:['ControlOrMeta']});expect(await chosen(page)).toEqual(['c5','c4','c1']);await row(page,'c4').click({modifiers:['Meta']});expect(await chosen(page)).toEqual(['c5','c1']);
 await page.keyboard.press('Delete');expect((await data(page)).curves.map((c:any)=>c.id)).toEqual(['c0','c2','c3','c4']);
 await page.keyboard.press('Control+z');expect(await data(page)).toEqual(before);await page.keyboard.press('Control+Shift+z');expect((await data(page)).curves).toHaveLength(4);
});
test('Shift selects inner segments of a continuous stroke, including hidden segments, then batch deletes with Backspace',async({page})=>{
 await seed(page,true);const ids=await page.getByTestId('drawing-curve-row').evaluateAll(els=>els.map(e=>e.getAttribute('data-id')!));
 await page.locator(`[data-testid=drawing-curve-row][data-id="${ids[2]}"]`).getByRole('button',{name:/^Hide /}).click();const before=await data(page);
 await row(page,ids[1]).click();await row(page,ids[4]).click({modifiers:['Shift']});expect(await chosen(page)).toEqual(ids.slice(1,5));await page.keyboard.press('Backspace');
 expect((await data(page)).curves.map((c:any)=>c.id).sort()).toEqual([ids[0],ids[5]].sort());await page.keyboard.press('Meta+z');expect(await data(page)).toEqual(before);
 await row(page,ids[1]).click();await row(page,ids[3]).click({modifiers:['Shift']});await page.getByTestId('drawing-delete-selection').click();expect((await data(page)).curves).toHaveLength(3);
});
test('a selected locked segment rejects bulk deletion atomically; name text editing retains native keys',async({page})=>{
 await seed(page);await page.locator('[data-testid=drawing-curve-row][data-id="c3"]').getByRole('button',{name:'Lock Line 3',exact:true}).click();const before=await data(page);
 await row(page,'c5').click();await row(page,'c2').click({modifiers:['Shift']});await page.keyboard.press('Delete');expect(await data(page)).toEqual(before);await expect(page.locator('.drawing-status [role=status]')).toContainText('locked');
 await row(page,'c0').click();const name=page.getByRole('textbox',{name:'Curve name',exact:true});await name.fill('Rename draft');await name.press('Control+z');await name.press('Backspace');expect(await data(page)).toEqual(before);
});
test('collapsed stroke range includes its fill; property deletion and list Select All preserve atomic Undo',async({page})=>{
 const before=await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Artwork');const e=c.ellipse(d,d.layers[0].id,[-.6,-.4],[.6,.4],.02);d=p.createFill(e.document,e.ids,'black');d=c.createCurve(d,d.layers[0].id,[[-.8,.7],[-.4,.9],[.4,.9],[.8,.7]],.02,'Brow','brow');(window as any).__editorPerfStore.getState().setDrawing(d);return d;});
 const chain=page.getByTestId('drawing-stroke-row').filter({has:page.getByTestId('drawing-chain-select')});
 await chain.getByRole('button',{name:'Expand stroke',exact:true}).click();await row(page,'brow').click();await chain.getByTestId('drawing-chain-select').click({modifiers:['Shift']});
 await expect(page.locator('.drawing-list-actions')).toContainText('6 objects selected');await expect(chain.getByTestId('drawing-paint-row')).toHaveCount(0);
 await page.screenshot({path:'artifacts/drawing-list-selection.png'});
 await page.locator('.drawing-properties').getByRole('button',{name:'Delete',exact:true}).click();expect((await data(page)).curves).toHaveLength(0);expect((await data(page)).fills).toHaveLength(0);
 await page.keyboard.press('Meta+z');expect(await data(page)).toEqual(before);
 await row(page,'brow').click();await page.keyboard.press('ControlOrMeta+a');await expect(page.locator('.drawing-list-actions')).toContainText('6 objects selected');await page.keyboard.press('Delete');expect((await data(page)).curves).toHaveLength(0);expect((await data(page)).fills).toHaveLength(0);
 await page.keyboard.press('Control+z');expect(await data(page)).toEqual(before);
});
