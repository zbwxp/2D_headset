import {test,expect,type Page} from '@playwright/test';
const data=(page:Page)=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(page:Page)=>page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
async function click(page:Page,x:number,y:number){const b=(await page.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(b.width,b.height)/2.8;await page.mouse.click(b.x+b.width/2+x*u,b.y+b.height/2-y*u);}
async function setting(page:Page,value:number){await page.getByRole('spinbutton',{name:'Default taper multiplier',exact:true}).fill(String(value));await page.getByRole('button',{name:'Apply',exact:true}).click();}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();await page.getByRole('button',{name:'New layer',exact:true}).click();});

test('right-click and double-click Pen defaults persist, affect future strokes only, and preserve Undo and JSON',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const pen=page.getByTestId('drawing-tool-pen');await pen.click();await click(page,-.8,.5);await click(page,.8,.5);await page.keyboard.press('Enter');const original=await data(page),beforeHistory=await history(page);
 await pen.click({button:'right'});await expect(page.getByRole('spinbutton',{name:'Default taper multiplier',exact:true})).toHaveValue('20');await setting(page,8);
 expect(await history(page)).toBe(beforeHistory);expect(await data(page)).toEqual(original);
 await click(page,-.8,0);await click(page,0,.1);await click(page,.8,0);await page.keyboard.press('Enter');const changed=await data(page);expect(changed.curves).toHaveLength(3);expect(changed.curves[0]).toEqual(original.curves[0]);expect(changed.curves[1].inkEnds).toEqual([{taperWidthScale:8},{taper:0,extension:0}]);expect(changed.curves[2].inkEnds).toEqual([{taper:0,extension:0},{taperWidthScale:8}]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await data(page)).curves).toHaveLength(2);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(changed);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();const path=(await (await download).path())!;await page.locator('header input[type=file]').setInputFiles(path);await expect.poll(()=>data(page)).toEqual(changed);
 await page.reload();await page.getByTestId('drawing-room-toggle').click();await pen.dblclick();await expect(page.getByRole('spinbutton',{name:'Default taper multiplier',exact:true})).toHaveValue('8');await setting(page,0);
 const afterReload=await data(page);await click(page,-.8,-.6);await click(page,.8,-.6);await page.keyboard.press('Enter');const flat=await data(page);expect(flat.curves.slice(0,-1)).toEqual(afterReload.curves);expect(flat.curves.at(-1).inkEnds).toEqual([{taperWidthScale:0},{taperWidthScale:0}]);expect(errors).toEqual([]);
});

test('opening settings during a Pen chain preserves the anchor; cancel and invalid input preserve the preference',async({page})=>{
 const pen=page.getByTestId('drawing-tool-pen');await pen.click();await click(page,-.8,0);await click(page,0,.4);const before=await data(page);
 await pen.dblclick();await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(1);await setting(page,5);await click(page,.8,0);const next=await data(page);expect(next.curves).toHaveLength(2);expect(next.curves[1].nodes[0]).toBe(before.curves[0].nodes[1]);expect(next.curves[0]).toEqual({...before.curves[0],inkEnds:[before.curves[0].inkEnds[0],{taper:0,extension:0}]});expect(next.curves[1].inkEnds[1]).toEqual({taperWidthScale:5});
 await pen.click({button:'right'});const field=page.getByRole('spinbutton',{name:'Default taper multiplier',exact:true});await field.fill('201');await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();await field.fill('');await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();await field.fill('12');await field.press('Escape');await expect(page.getByRole('dialog',{name:'Pen defaults'})).toHaveCount(0);await expect(page.getByTestId('drawing-pen-anchor')).toHaveCount(1);expect(await data(page)).toEqual(next);
 await pen.click({button:'right'});await expect(field).toHaveValue('5');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByTestId('language-toggle').click();await pen.click({button:'right'});await expect(page.getByRole('dialog',{name:'钢笔默认设置'})).toBeVisible();await page.screenshot({path:'artifacts/drawing-room/pen-defaults.png'});
});
