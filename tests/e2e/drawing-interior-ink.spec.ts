import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const row=(p:Page,id:string)=>p.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`);
const extension=(p:Page)=>p.getByRole('spinbutton',{name:'Stroke extension distance px',exact:true});
const taper=(p:Page)=>p.getByRole('spinbutton',{name:'Endpoint taper distance px',exact:true});
async function field(p:Page,name:'extension'|'taper',value:number){const f=name==='extension'?extension(p):taper(p);await f.fill(String(value));await f.press('Enter');}
async function seed(page:Page){await page.evaluate(async()=>{
 const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string);
 let d=c.addLayer(m.emptyDrawing(),'Neck');const points=[[-.5,.5],[-.5,-.2],[.5,-.2],[.5,.5]];
 for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4];d=c.createPenCurve(d,d.layers[0].id,[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b],.024,'c'+i);d=c.curveChange(d,'c'+i,{name:['Left neck','Shoulder','Right neck','Top'][i]});}
 for(let i=0;i<4;i++)d=c.connect(d,{curveId:'c'+i,end:1},{curveId:'c'+((i+1)%4),end:0},'POSITION');d=p.createFill(d,['c0','c1','c2','c3'],'white');(window as any).__editorPerfStore.getState().setDrawing(d);
 });}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();await seed(page);});
test('closed stroke internal endpoint UI starts disabled; opt-in, local extension, Undo and JSON work without changing the fill',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await row(page,'c0').click();await page.getByRole('button',{name:'P1 Interior endpoint ink',exact:true}).click();
 const toggle=page.getByRole('checkbox',{name:'Enable interior endpoint ink'});await expect(toggle).not.toBeChecked();await expect(extension(page)).toHaveCount(0);const before=await data(page),fill=await page.getByTestId('drawing-fill').getAttribute('d'),ink=await page.getByTestId('drawing-ink').getAttribute('d');
 await toggle.check();await expect(taper(page)).toHaveValue('0');await expect(extension(page)).toHaveValue('0');expect(await page.getByTestId('drawing-ink').getAttribute('d')).toBe(ink);
 await field(page,'extension',30);await field(page,'taper',30);const changed=await data(page);expect(changed.curves[0].inkEnds[1]).toEqual({interior:true,taper:.12,extension:.12});expect(changed.nodes).toEqual(before.nodes);expect(changed.curves.slice(1)).toEqual(before.curves.slice(1));expect(changed.joins).toEqual(before.joins);expect(await page.getByTestId('drawing-fill').getAttribute('d')).toBe(fill);
 await expect(page.getByTestId('drawing-ink-extension-hit')).toHaveCount(1);const endpoint=page.locator('[data-testid=drawing-ink-endpoint][data-id=c0][data-end="1"]');await endpoint.click();await expect(extension(page)).toHaveValue('30');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(taper(page)).toHaveValue('0');await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(changed);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await download).path())!);await expect.poll(()=>data(page)).toEqual(changed);
 await row(page,'c0').click();await page.getByRole('button',{name:'P1 Interior endpoint ink',exact:true}).click();await toggle.uncheck();expect(await page.getByTestId('drawing-ink').getAttribute('d')).toBe(ink);await toggle.check();await expect(extension(page)).toHaveValue('30');await expect(taper(page)).toHaveValue('30');
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('checkbox',{name:'启用内部端点笔触'})).toBeChecked();await page.getByRole('spinbutton',{name:'笔触延伸距离 px'}).scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/drawing-room/interior-ink-controls.png'});expect(errors).toEqual([]);
});
test('physical point selection distinguishes the two sides and internal ink tips support arrow adjustment',async({page})=>{
 await row(page,'c0').click();await page.getByRole('button',{name:/^P1 endpoint$/i}).click();await expect(page.getByRole('checkbox',{name:'Enable interior endpoint ink'})).toBeVisible();await page.getByRole('checkbox',{name:'Enable interior endpoint ink'}).check();await field(page,'extension',20);await field(page,'taper',20);
 await row(page,'c1').click();await page.getByRole('button',{name:'P0 Interior endpoint ink',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Enable interior endpoint ink'})).not.toBeChecked();
 await row(page,'c0').click();await page.getByRole('button',{name:'P1 Interior endpoint ink',exact:true}).click();const before=await data(page);await page.keyboard.press('ArrowDown');const next=await data(page);expect(next.curves[0].inkEnds[1].extension).toBeGreaterThan(.08);expect(next.nodes).toEqual(before.nodes);expect(next.curves[1]).toEqual(before.curves[1]);
});
