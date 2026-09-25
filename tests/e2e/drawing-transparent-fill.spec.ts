import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const paintRow=(p:Page,id:string)=>p.locator(`[data-testid=drawing-paint-row][data-id="${id}"]`);
async function pixel(p:Page,x:number,y:number){return p.getByTestId('drawing-canvas').evaluate(async(el,{x,y})=>{
 const svg=el as SVGSVGElement,r=svg.getBoundingClientRect(),u=Math.min(r.width,r.height)/2.8,copy=svg.cloneNode(true) as SVGSVGElement;
 copy.setAttribute('width',String(r.width));copy.setAttribute('height',String(r.height));
 const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));await image.decode();
 const c=document.createElement('canvas');c.width=r.width;c.height=r.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
 return [...ctx.getImageData(r.width/2+x*u,r.height/2-y*u,1,1).data];
 },{x,y});}
async function click(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;await p.mouse.click(r.x+r.width/2+x*u,r.y+r.height/2-y*u);}
async function seed(p:Page){return p.evaluate(async()=>{
 const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),paint=await import('/src/domain/drawing/paintCommands.ts' as string),s=await import('/src/ui/drawing/session.ts' as string);
 let d=m.emptyDrawing(),i=0;
 const rect=(layer:string,x0:number,y0:number,x1:number,y1:number,color:'white'|'black')=>{
  const ps=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]],ids=[];
  for(let k=0;k<4;k++){const a=ps[k],b=ps[(k+1)%4],id='r'+i++;ids.push(id);d=c.createCurve(d,layer,[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b],.01,id,id);}
  d=paint.createFill(paint.setInk(d,ids,{inkVisible:false}),ids,color);return d.fills.at(-1)!.id;
 };
 d=c.addLayer(d,'Below');const below=d.layers[0].id,backBlack=rect(below,-1,-.9,1,.9,'black'),backWhite=rect(below,-1,-.9,0,.9,'white');
 d=c.addLayer(d,'Cut layer');const layer=d.layers[0].id;rect(layer,-.8,-.7,.8,.7,'white');rect(layer,-.8,-.7,0,.7,'black');
 d=c.createCurve(d,layer,[[-.7,0],[-.2,0],[.2,0],[.7,0]],.025,'Intact line','line');d=paint.createOffset(d,'line');d=paint.changePaint(d,d.offsets[0].id,{source:[{id:'line',reverse:false}],distance:.15,start:0,end:1,taper:0,profile:'UNIFORM',width:.02});
 const hole=c.ellipse(d,layer,[-.35,-.35],[.55,.35],.01);d=paint.setInk(hole.document,hole.ids,{inkVisible:false});d=c.renameStroke(d,hole.ids[0],'Hole boundary');
 (window as any).__editorPerfStore.getState().setDrawing(d);s.useDrawing.setState({selection:{ids:hole.ids},layerId:layer,tool:'select',preview:false,showFills:true,zoom:1,pan:[0,0]});
 return {layer,below,hole:hole.ids,backBlack,backWhite};
 });}
async function create(p:Page){await p.getByTestId('drawing-chain-select').filter({hasText:'Hole boundary'}).click();await p.getByRole('button',{name:'Create transparent fill',exact:true}).click();return (await data(p)).fills.at(-1).id as string;}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('transparent fill cuts both colors in its layer, preserves ink/offsets, and lets picking reach the layer below',async({page})=>{
 const f=await seed(page);expect(await pixel(page,-.15,-.1)).toEqual([0,0,0,255]);expect(await pixel(page,.3,-.1)).toEqual([255,255,255,255]);
 const before=await data(page),h=await history(page),id=await create(page);
 expect((await data(page)).fills.at(-1).color).toBe('transparent');expect(await history(page)).toBe(h+1);
 expect((await data(page)).curves).toEqual(before.curves);expect((await data(page)).fills.slice(0,-1)).toEqual(before.fills);
 expect(await pixel(page,-.15,-.1)).toEqual([255,255,255,255]);expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 expect(await pixel(page,-.15,0)).toEqual([25,30,34,255]);expect(await pixel(page,-.15,.15)).toEqual([25,30,34,255]);
 await click(page,.3,-.1);await expect(paintRow(page,f.backBlack)).toHaveClass(/selected/);
 await paintRow(page,id).locator('.drawing-object-name').click();await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();
 expect(await pixel(page,-.15,-.1)).toEqual([255,255,255,255]);expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 // Without a lower layer the output really has zero alpha, not white paint.
 await page.locator(`[data-testid=drawing-layer][data-id="${f.below}"]`).getByTestId('drawing-layer-visibility').click();expect((await pixel(page,.3,-.1))[3]).toBe(0);
 expect(await pixel(page,.65,-.1)).toEqual([255,255,255,255]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 const saved=await data(page),download=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await download).path())!);await expect.poll(()=>data(page)).toEqual(saved);
 expect(await pixel(page,-.15,-.1)).toEqual([255,255,255,255]);await page.screenshot({path:'artifacts/drawing-room/transparent-fill.png'});
});

test('overlapping cutouts form a union; hide, delete, invalid boundaries and color changes restore the solids',async({page})=>{
 const f=await seed(page),id=await create(page);
 const second=await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string),s=(window as any).__editorPerfStore.getState();let d=s.project.drawing;const e=c.ellipse(d,d.layers[0].id,[0,-.3],[.7,.3],.01);d=p.createFill(p.setInk(e.document,e.ids,{inkVisible:false}),e.ids,'transparent');s.setDrawing(d);return {id:d.fills.at(-1).id,ids:e.ids};});
 expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);expect(await pixel(page,.62,-.1)).toEqual([0,0,0,255]);
 await paintRow(page,id).getByRole('button',{name:/^Hide /}).click();expect(await pixel(page,-.15,-.1)).toEqual([0,0,0,255]);expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 await paintRow(page,second.id).locator('.drawing-object-name').click();await page.getByRole('combobox',{name:'Fill color',exact:true}).selectOption('white');expect(await pixel(page,.3,-.1)).toEqual([255,255,255,255]);
 await page.getByRole('combobox',{name:'Fill color',exact:true}).selectOption('transparent');expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 // Missing source geometry disables only that cutout and exposes the diagnostic.
 await page.evaluate(async id=>{const c=await import('/src/domain/drawing/commands.ts' as string),s=(window as any).__editorPerfStore.getState();s.setDrawing(c.deleteCurves(s.project.drawing,[id]));},second.ids[0]);
 await expect(page.getByTestId('drawing-paint-status')).toContainText('deleted');expect(await pixel(page,.3,-.1)).toEqual([255,255,255,255]);
 await paintRow(page,id).getByRole('button',{name:/^Show /}).click();expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 await paintRow(page,id).locator('.drawing-object-name').click();await page.getByRole('button',{name:'Delete',exact:true}).click();expect(await pixel(page,.3,-.1)).toEqual([255,255,255,255]);
});

test('cutouts follow their owner layer and boundary geometry, independent of ink visibility and paint order',async({page})=>{
 const f=await seed(page),id=await create(page);
 await page.getByRole('button',{name:'Send to back',exact:true}).click();expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 await page.evaluate(async ids=>{const c=await import('/src/domain/drawing/commands.ts' as string),i=await import('/src/domain/drawing/displayIntervals.ts' as string),s=(window as any).__editorPerfStore.getState();let d=i.addDisplayInterval(s.project.drawing,ids[0]);for(const id of ids)d=c.curveChange(d,id,{visible:false});s.setDrawing(d);},f.hole);
 expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 await page.getByRole('combobox',{name:'Move to layer',exact:true}).selectOption(f.below);expect(await pixel(page,.3,-.1)).toEqual([255,255,255,255]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await pixel(page,.3,-.1)).toEqual([0,0,0,255]);
 // Restore visible controls, then change the boundary; the hole follows it.
 await page.evaluate(async ids=>{const c=await import('/src/domain/drawing/commands.ts' as string),s=(window as any).__editorPerfStore.getState();let d=s.project.drawing;for(const id of ids)d=c.curveChange(d,id,{visible:true});s.setDrawing(c.transform(d,ids,([x,y]:number[])=>[x+.8,y]));},f.hole);
 expect(await pixel(page,.3,-.1)).toEqual([255,255,255,255]);expect(await pixel(page,.7,-.1)).toEqual([0,0,0,255]);
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('combobox',{name:'填充颜色',exact:true})).toHaveValue('transparent');await expect(paintRow(page,id)).toContainText('透明挖空');
});
