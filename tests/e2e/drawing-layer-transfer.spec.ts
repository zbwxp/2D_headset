import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const layer=(p:Page,id:string)=>p.locator(`[data-testid=drawing-layer][data-id="${id}"]`);
const iris=(p:Page)=>p.getByTestId('drawing-stroke-row').filter({has:p.getByTestId('drawing-chain-select').filter({hasText:'Iris outline'})});
async function seed(p:Page){return p.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),paint=await import('/src/domain/drawing/paintCommands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Eyes');const source=d.layers[0].id,e=c.ellipse(d,source,[-.65,-.5],[.65,.5],.025);d=paint.createFill(c.renameStroke(e.document,e.ids[0],'Iris outline'),e.ids,'black');d=c.addLayer(d,'Hair');const target=d.layers[0].id;d=c.createCurve(d,target,[[-.9,.8],[-.3,1],[.3,1],[.9,.8]],.02,'Hair line','hair');d=c.addLayer(d,'Empty');const empty=d.layers[0].id;(window as any).__editorPerfStore.getState().setDrawing(d);return {source,target,empty,ids:e.ids,fill:d.fills[0].id};});}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('fill is a child of its closed stroke, folds with the curve rows and retains its own controls',async({page})=>{
 const f=await seed(page),row=iris(page),before=await data(page),h=await history(page);await expect(row.getByTestId('drawing-paint-row')).toHaveCount(1);await expect(layer(page,f.source).getByTestId('drawing-stroke-row')).toHaveCount(1);
 const fold=row.getByRole('button',{name:'Expand stroke',exact:true});await fold.click();await expect(fold).toHaveAttribute('aria-expanded','false');await expect(row.getByTestId('drawing-paint-row')).toHaveCount(0);await expect(row.getByTestId('drawing-curve-row')).toHaveCount(0);await expect(page.getByTestId('drawing-fill')).toHaveCount(1);expect(await data(page)).toEqual(before);expect(await history(page)).toBe(h);
 await fold.click();await row.getByTestId('drawing-paint-row').locator('.drawing-object-name').click();await expect(page.getByRole('combobox',{name:'Fill color',exact:true})).toBeVisible();await fold.click();await fold.click();await expect(row.getByTestId('drawing-paint-row')).toHaveCount(1);
 await row.getByTestId('drawing-chain-visibility').click();await expect(page.getByTestId('drawing-fill')).toHaveCount(0);await row.getByTestId('drawing-chain-visibility').click();await expect(page.getByTestId('drawing-fill')).toHaveCount(1);
 await row.getByTestId('drawing-paint-row').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/drawing-arc/fill-in-stroke.png'});
});

test('dragging a collapsed filled stroke into an empty collapsed layer moves everything in one Undo',async({page})=>{
 const f=await seed(page),before=await data(page),h=await history(page),row=iris(page);await row.getByRole('button',{name:'Expand stroke',exact:true}).click();await layer(page,f.empty).getByRole('button',{name:'Collapse Empty',exact:true}).click();
 await row.dragTo(layer(page,f.empty).locator('.drawing-layer-row'),{targetPosition:{x:100,y:15}});
 const moved=await data(page);expect(moved.layers.find((l:any)=>l.id===f.source).items).toEqual([]);expect(moved.layers.find((l:any)=>l.id===f.empty).items).toEqual(before.layers.find((l:any)=>l.id===f.source).items);expect(moved.curves).toEqual(before.curves);expect(moved.nodes).toEqual(before.nodes);expect(moved.joins).toEqual(before.joins);expect(moved.fills).toEqual(before.fills);expect(await history(page)).toBe(h+1);
 await expect(layer(page,f.empty).getByTestId('drawing-chain-select')).toContainText('Iris outline');await expect(iris(page).getByTestId('drawing-paint-row')).toHaveCount(0);await expect(page.getByTestId('drawing-fill')).toHaveCount(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(moved);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(moved);const fold=iris(page).getByRole('button',{name:'Expand stroke',exact:true});if(await fold.getAttribute('aria-expanded')==='false')await fold.click();await expect(layer(page,f.empty).getByTestId('drawing-paint-row')).toHaveCount(1);
});

test('drop above/below another layer item respects order and moving hidden strokes preserves flags',async({page})=>{
 const f=await seed(page),before=await data(page),sourceOrder=before.layers.find((l:any)=>l.id===f.source).items;
 await iris(page).dragTo(layer(page,f.target).getByTestId('drawing-stroke-row'),{targetPosition:{x:100,y:30}});expect((await data(page)).layers.find((l:any)=>l.id===f.target).items).toEqual(['hair',...sourceOrder]);
 await iris(page).getByTestId('drawing-chain-visibility').click();const hidden=await data(page);await iris(page).dragTo(layer(page,f.source).locator('.drawing-layer-row'),{targetPosition:{x:100,y:15}});const moved=await data(page);expect(moved.curves.filter((c:any)=>f.ids.includes(c.id)).every((c:any)=>!c.visible)).toBe(true);expect(moved.fills).toEqual(hidden.fills);await expect(page.getByTestId('drawing-fill')).toHaveCount(0);await iris(page).getByTestId('drawing-chain-visibility').click();await expect(page.getByTestId('drawing-fill')).toHaveCount(1);
});

test('a batch-locked target accepts new members; locked owned fill still prevents moving a stroke',async({page})=>{
 const f=await seed(page);await layer(page,f.target).getByRole('button',{name:'Lock Hair',exact:true}).click();
 await iris(page).dragTo(layer(page,f.target).locator('.drawing-layer-row'),{targetPosition:{x:100,y:15}});
 expect((await data(page)).layers.find((l:any)=>l.id===f.target).items).toContain(f.fill);
 expect((await data(page)).curves.find((c:any)=>c.id==='hair').locked).toBe(true);
 expect((await data(page)).curves.filter((c:any)=>f.ids.includes(c.id)).every((c:any)=>!c.locked)).toBe(true);
 await iris(page).getByTestId('drawing-paint-row').getByRole('button',{name:/^Lock /}).click();const before=await data(page),h=await history(page);
 await iris(page).dragTo(layer(page,f.source).locator('.drawing-layer-row'),{targetPosition:{x:100,y:15}});expect(await data(page)).toEqual(before);expect(await history(page)).toBe(h);await expect(page.locator('.drawing-status [role=status]')).toContainText('locked');
});
