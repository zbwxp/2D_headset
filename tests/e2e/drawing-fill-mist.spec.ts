import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
async function seed(page:Page){return page.evaluate(async()=>{const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Iris');const e=c.ellipse(d,d.layers[0].id,[-.4,-.6],[.4,.6],.01);(window as any).__editorPerfStore.getState().setDrawing(e.document);return e.ids;});}
async function number(p:Page,name:string,value:string){const slider=p.getByRole('slider',{name,exact:true}),parent=slider.locator('..');await parent.locator('.numeric-slider-value').dblclick();const field=parent.locator('input[type=text]');await field.fill(value);await field.press('Enter');}
async function create(page:Page){await page.getByTestId('drawing-chain-select').click();await page.getByTestId('drawing-create-mist-fill').click();}
async function scan(page:Page){return page.getByTestId('drawing-canvas').evaluate(async el=>{
 const svg=el as SVGSVGElement,r=svg.getBoundingClientRect(),u=Math.min(r.width,r.height)/2.8,copy=svg.cloneNode(true) as SVGSVGElement;copy.setAttribute('width',String(r.width));copy.setAttribute('height',String(r.height));
 for(const child of [...copy.children])if(child.getAttribute('data-testid')!=='drawing-paint-layer')child.remove();copy.querySelectorAll('[data-testid=drawing-ink],[data-testid=drawing-cusp-tip]').forEach(e=>e.remove());
 const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));await image.decode();const c=document.createElement('canvas');c.width=r.width;c.height=r.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
 const alpha=(logicalX:number)=>ctx.getImageData(Math.round(r.width/2+logicalX*u),Math.round(r.height/2),1,1).data[3];
 return {inner:alpha(.4-3/250),innerFar:alpha(.4-14/250),outside:alpha(.4+3/250),outsideFar:alpha(.4+14/250),center:alpha(0)};
 });}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();await seed(page);});
test('create from an ellipse; Gaussian gray alpha follows inside/outside/both, opacity and numeric controls',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const before=await data(page);await create(page);await expect(page.getByRole('combobox',{name:'Fill type',exact:true})).toHaveValue('MIST');
 await number(page,'Fill mist width','20');await number(page,'Fill opacity','100');const inside=await scan(page);console.log('inside mist',inside);expect(inside.inner).toBeGreaterThan(150);expect(inside.innerFar).toBeLessThan(inside.inner/3);expect(inside.outside).toBe(0);expect(inside.center).toBe(0);
 await page.getByRole('combobox',{name:'Fill diffusion side'}).selectOption('OUTSIDE');const out=await scan(page);expect(out.inner).toBe(0);expect(out.outside).toBeGreaterThan(150);expect(out.outsideFar).toBeLessThan(out.outside/3);
 await page.getByRole('combobox',{name:'Fill diffusion side'}).selectOption('BOTH');const both=await scan(page);expect(both.inner).toBeGreaterThan(150);expect(both.outside).toBeGreaterThan(150);
 const href=await page.getByTestId('drawing-mist-fill-image').getAttribute('href');await number(page,'Fill opacity','40');const faint=await scan(page);expect(faint.inner/both.inner).toBeCloseTo(.4,1);expect(faint.outside/both.outside).toBeCloseTo(.4,1);expect(await page.getByTestId('drawing-mist-fill-image').getAttribute('href')).toBe(href);
 const after=await data(page);expect(after.curves).toEqual(before.curves);expect(after.nodes).toEqual(before.nodes);expect(after.joins).toEqual(before.joins);expect(errors).toEqual([]);
});
test('sliders commit one Undo, preserve settings through Save/Load and source edit; filled and mist modes coexist',async({page})=>{
 await create(page);await number(page,'Fill mist width','24');const before=await data(page),h=await history(page),slider=page.getByRole('slider',{name:'Fill opacity',exact:true});await slider.scrollIntoViewIfNeeded();const r=(await slider.boundingBox())!;
 await page.mouse.move(r.x+r.width*.6,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width*.25,r.y+r.height/2,{steps:8});expect(await data(page)).toEqual(before);await page.mouse.up();expect(await history(page)).toBe(h+1);const changed=await data(page);
 await slider.press('Meta+z');expect(await data(page)).toEqual(before);await slider.press('Meta+Shift+z');expect(await data(page)).toEqual(changed);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(changed);
 await page.locator('[data-testid=drawing-paint-row] .drawing-object-name').click();await page.getByRole('combobox',{name:'Fill type',exact:true}).selectOption('SOLID');await expect(page.getByTestId('drawing-fill')).toHaveCount(1);await expect(page.getByTestId('drawing-mist-fill')).toHaveCount(0);await page.getByRole('combobox',{name:'Fill type',exact:true}).selectOption('MIST');await expect(slider).toHaveAttribute('aria-valuetext',Math.round(changed.fills[0].mist.opacity*100)+'%');
 const old=await page.getByTestId('drawing-mist-fill-image').getAttribute('href');await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),st=(window as any).__editorPerfStore,d=st.getState().project.drawing;st.getState().setDrawing(c.moveHandle(d,{curveId:d.curves[0].id,end:0},[.8,.25]));});expect(await page.getByTestId('drawing-mist-fill-image').getAttribute('href')).not.toBe(old);
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('combobox',{name:'填充扩散方向'})).toHaveValue('INSIDE');await page.getByTestId('drawing-fill-mist-controls').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/drawing-room/mist-fill-controls.png'});
});
test('reverse traversal does not swap inside/outside; hidden strokes, display intervals and fill visibility stay independent',async({page})=>{
 await create(page);const a=await page.getByTestId('drawing-mist-fill-image').getAttribute('href');await page.evaluate(async()=>{const p=await import('/src/domain/drawing/paintCommands.ts' as string),i=await import('/src/domain/drawing/displayIntervals.ts' as string),st=(window as any).__editorPerfStore;let d=st.getState().project.drawing;d=p.setInk(d,d.curves.map((c:any)=>c.id),{inkVisible:false});d=i.addDisplayInterval(d,d.curves[0].id);st.getState().setDrawing(d);});expect(await page.getByTestId('drawing-mist-fill-image').getAttribute('href')).toBe(a);await expect(page.getByTestId('drawing-ink')).toHaveCount(0);
 const before=await scan(page);await page.evaluate(()=>{const st=(window as any).__editorPerfStore,d=st.getState().project.drawing;st.getState().setDrawing({...d,fills:d.fills.map((f:any)=>({...f,boundary:f.boundary.slice().reverse().map((u:any)=>({...u,reverse:!u.reverse}))}))});});const reversed=await scan(page);expect(reversed.inner).toBeCloseTo(before.inner,0);expect(reversed.outside).toBe(0);
 await page.locator('[data-testid=drawing-paint-row]').getByRole('button',{name:/^Hide /}).click();await expect(page.getByTestId('drawing-mist-fill')).toHaveCount(0);await page.locator('[data-testid=drawing-paint-row]').getByRole('button',{name:/^Show /}).click();await expect(page.getByTestId('drawing-mist-fill')).toHaveCount(1);
});
test('two ellipses compose a black iris mist and a white lower glow; sharp pupil/highlights stay separate',async({page})=>{
 await page.evaluate(async()=>{
  const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string),f=await import('/src/domain/drawing/fillMist.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Iris mist study');const l=d.layers[0].id;
  const ellipse=(a:number[],b:number[],color:string,width:number,opacity:number,side='INSIDE',ink=false)=>{const e=c.ellipse(d,l,a,b,.008);d=e.document;d=p.setInk(d,e.ids,{inkVisible:ink});d=p.createFill(d,e.ids,color,width?'MIST':'SOLID');const id=d.fills.at(-1).id;if(width)d=f.setFillMist(d,id,{width:width/250,opacity,side});return id;};
  const iris=ellipse([-.65,-.8],[.65,.8],'black',150,.85,'INSIDE',true);
  ellipse([-1.2,-2.75],[1.2,-.72],'white',200,1,'BOTH');
  ellipse([-.16,-.27],[.16,.32],'black',0,1);
  ellipse([-.36,.3],[-.15,.53],'white',0,1);ellipse([.15,.45],[.28,.58],'white',0,1);
  const rim=new Set(d.fills.find((f:any)=>f.id===iris).boundary.map((u:any)=>u.id));d={...d,curves:d.curves.map((c:any)=>rim.has(c.id)?{...c,depthOffset:99}:c)};
  (window as any).__editorPerfStore.getState().setDrawing(d);
 });
 await expect(page.getByTestId('drawing-mist-fill-image')).toHaveCount(2);await expect(page.getByTestId('drawing-fill')).toHaveCount(3);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await page.screenshot({path:'artifacts/drawing-room/iris-mist-study.png'});
});

test('outside mist is selectable only in its visible band; a same-layer transparent cutout removes mist but keeps strokes',async({page})=>{
 await create(page);await number(page,'Fill mist width','30');await number(page,'Fill opacity','100');await page.getByRole('combobox',{name:'Fill diffusion side'}).selectOption('OUTSIDE');
 const target=(x:number)=>page.getByTestId('drawing-canvas').evaluate((el,x)=>{const r=el.getBoundingClientRect(),u=Math.min(r.width,r.height)/2.8;return document.elementFromPoint(r.x+r.width/2+x*u,r.y+r.height/2)?.getAttribute('data-testid');},x);
 expect(await target(.4+20/250)).toBe('drawing-mist-fill-hit');expect(await target(0)).not.toBe('drawing-mist-fill-hit');expect(await target(.8)).not.toBe('drawing-mist-fill-hit');const before=await scan(page);expect(before.outside).toBeGreaterThan(150);
 await page.evaluate(async()=>{const st=(window as any).__editorPerfStore,c=await import('/src/domain/drawing/commands.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string);let d=st.getState().project.drawing;const e=c.ellipse(d,d.layers[0].id,[.35,-.15],[.6,.15],.004);d=p.setInk(e.document,e.ids,{inkVisible:false});st.getState().setDrawing(p.createFill(d,e.ids,'transparent'));});
 const masked=await scan(page);expect(masked.outside).toBe(0);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);expect(await target(.4+20/250)).not.toBe('drawing-mist-fill-hit');
 await page.evaluate(()=>{const st=(window as any).__editorPerfStore,d=st.getState().project.drawing;st.getState().setDrawing({...d,fills:d.fills.map((f:any)=>f.color==='transparent'?{...f,visible:false}:f)});});expect((await scan(page)).outside).toBeGreaterThan(150);
});
