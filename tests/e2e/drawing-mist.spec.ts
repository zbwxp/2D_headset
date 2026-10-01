import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const row=(p:Page,id:string)=>p.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`);
async function seed(p:Page){await p.evaluate(async()=>{
 const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Ink edge study');
 const line=(a:number,b:number,y:number)=>[[a,y],[a+(b-a)/3,y],[a+2*(b-a)/3,y],[b,y]];
 d=c.createCurve(d,d.layers[0].id,line(-1,0,.3),.008,'Edge source','a');d=c.createCurve(d,d.layers[0].id,line(0,1,.3),.008,'Unchanged neighbour','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'POSITION');
 d=c.createCurve(d,d.layers[0].id,line(-1,1,-.3),.008,'Unchanged line','c');(window as any).__editorPerfStore.getState().setDrawing(d);
 });await row(p,'a').click();}
async function number(p:Page,name:string,value:string){const slider=p.getByRole('slider',{name,exact:true}),parent=slider.locator('..');await parent.locator('.numeric-slider-value').dblclick();const field=parent.locator('input[type=text]');await field.fill(value);await field.press('Enter');}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('ink edge is per member, undoable, non-pickable and persists without changing authoring geometry',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);const before=await data(page),h=await history(page);
 await page.getByRole('checkbox',{name:'Raster ink edge',exact:true}).check();expect(await history(page)).toBe(h+1);
 const edge=page.getByTestId('drawing-ink-edge');await expect(edge).toHaveCount(1);expect(await edge.evaluate(e=>getComputedStyle(e).pointerEvents)).toBe('none');await expect(edge.locator('image')).toHaveCount(0);
 expect((await data(page)).curves.find((c:any)=>c.id==='b').mist).toBeUndefined();expect((await data(page)).curves.find((c:any)=>c.id==='c').mist).toBeUndefined();expect((await data(page)).nodes).toEqual(before.nodes);expect((await data(page)).joins).toEqual(before.joins);
 await number(page,'Edge softness','2');const widthState=await data(page),nh=await history(page);await number(page,'Ink edge strength','100');expect(await history(page)).toBe(nh+1);expect((await data(page)).curves[0].mist).toEqual({mode:'INK_EDGE',enabled:true,width:2/250,density:1});
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(widthState);await page.getByRole('button',{name:'Redo',exact:true}).click();
 const saved=await data(page),dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(saved);await expect(edge).toHaveCount(1);expect(errors).toEqual([]);
});

test('edge strength slider commits once, zero bypasses filtering, masks and hidden ink still apply',async({page})=>{
 await seed(page);await page.getByRole('checkbox',{name:'Raster ink edge',exact:true}).check();const base=await data(page),nh=await history(page),slider=page.getByRole('slider',{name:'Ink edge strength',exact:true});await slider.scrollIntoViewIfNeeded();const r=(await slider.boundingBox())!;
 await page.mouse.move(r.x+r.width*.7,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width*.2,r.y+r.height/2,{steps:8});expect(await data(page)).toEqual(base);await page.mouse.up();expect(await history(page)).toBe(nh+1);
 await slider.press('Meta+z');expect(await data(page)).toEqual(base);await number(page,'Ink edge strength','0');await expect(page.getByTestId('drawing-ink-edge')).toHaveCount(0);await expect(page.getByTestId('drawing-ink').first()).toBeVisible();
 await number(page,'Ink edge strength','100');
 await page.evaluate(async()=>{const m=await import('/src/domain/drawing/displayIntervals.ts' as string),s=(window as any).__editorPerfStore.getState();s.setDrawing(m.addDisplayInterval(s.project.drawing,'a'));});
 await row(page,'a').click();await page.getByRole('checkbox',{name:'Show ink on selected segments',exact:true}).uncheck();await expect(page.getByTestId('drawing-ink-edge')).toHaveCount(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByTestId('drawing-ink-edge')).toHaveCount(1);
 await page.getByRole('checkbox',{name:'Raster ink edge',exact:true}).uncheck();await expect(page.getByTestId('drawing-ink-edge')).toHaveCount(0);
});
