import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const row=(p:Page,id:string)=>p.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`);
async function seed(page:Page){await page.evaluate(async()=>{
 const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string);
 let d=c.addLayer(m.emptyDrawing(),'Neck');const l=d.layers[0].id;
 const line=(a:number[],b:number[])=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
 const points=[[-.5,.4],[.5,.4],[.5,-.4],[-.5,-.4]];
 for(let i=0;i<4;i++)d=c.createCurve(d,l,line(points[i],points[(i+1)%4]),.018,'Shoulder '+i,'b'+i);
 for(let i=0;i<4;i++)d=c.connect(d,{curveId:'b'+i,end:1},{curveId:'b'+((i+1)%4),end:0},'POSITION');d=p.createFill(d,['b0','b1','b2','b3'],'white');
 d=c.createCurve(d,l,line([-1,0],[1,0]),.025,'Collar bar','front');d=c.createCurve(d,l,[[1,0],[1,-.8],[-1,-.8],[-1,0]],.025,'Collar bottom','side');d=c.connect(d,{curveId:'front',end:1},{curveId:'side',end:0},'CUSP');d=c.renameStroke(d,'front','Front collar');
 (window as any).__editorPerfStore.getState().setDrawing(d);
 });}
const centerTarget=(page:Page)=>page.locator('[data-testid=drawing-hit][data-id=front]').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.getAttribute('data-testid');});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();await seed(page);});
test('single member depth follows parent siblings, fill occludes normally, list and geometry remain stable; Undo and Save/Load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await row(page,'front').click();const before=await data(page);await expect.poll(()=>centerTarget(page)).toBe('drawing-hit');
 await page.getByRole('button',{name:'Backward −1',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Depth offset',exact:true})).toHaveValue('-1');
 await expect.poll(()=>centerTarget(page)).toBe('drawing-fill');const changed=await data(page);expect(changed.layers).toEqual(before.layers);expect(changed.nodes).toEqual(before.nodes);expect(changed.joins).toEqual(before.joins);expect(changed.fills).toEqual(before.fills);expect(changed.curves.find((c:any)=>c.id==='side')).toEqual(before.curves.find((c:any)=>c.id==='side'));
 expect(await page.locator('[data-testid=drawing-depth-ink]').count()).toBe(2);await expect(row(page,'front')).toContainText('Depth -1');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>centerTarget(page)).toBe('drawing-hit');await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(()=>centerTarget(page)).toBe('drawing-fill');
 const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await wait).path())!);await expect.poll(()=>data(page)).toEqual(changed);await expect.poll(()=>centerTarget(page)).toBe('drawing-fill');
 await row(page,'front').click();await page.getByTestId('language-toggle').click();await expect(page.getByRole('combobox',{name:'深度基准'})).toHaveValue('PARENT');await page.getByTestId('drawing-depth-controls').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/drawing-room/depth-offset.png'});expect(errors).toEqual([]);
});
test('child rows reorder within the stroke, and choosing layer reference enables cross-layer depth',async({page})=>{
 const before=await data(page);const a=page.locator('[data-testid=drawing-curve-row][data-id=side]'),b=page.locator('[data-testid=drawing-curve-row][data-id=front]');await a.dragTo(b,{targetPosition:{x:80,y:3}});const reordered=await data(page);expect(reordered.layers[0].items.slice(0,2)).toEqual(['side','front']);expect(reordered.nodes).toEqual(before.nodes);expect(reordered.joins).toEqual(before.joins);
 await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),store=(window as any).__editorPerfStore;let d=c.addLayer(store.getState().project.drawing,'Above');d=c.createCurve(d,d.layers[0].id,[[-.4,.6],[-.2,.6],[.2,.6],[.4,.6]],.02,'Other','other');store.getState().setDrawing(d);});
 await row(page,'front').click();const controls=page.getByTestId('drawing-depth-controls');await controls.getByRole('combobox',{name:'Depth reference'}).selectOption('LAYER');await controls.getByRole('button',{name:'Forward +1'}).click();
 const batches=await page.locator('[data-testid=drawing-paint-layer]').evaluateAll(els=>els.map(e=>({layer:e.getAttribute('data-id'),front:!!e.querySelector('[data-testid=drawing-depth-ink][data-id=front]')})));expect(batches.at(-1)!.front).toBe(true);expect(batches.at(-1)!.layer).toBe(before.layers[0].id);
 await controls.getByRole('combobox',{name:'Depth reference'}).selectOption('PARENT');await expect(controls.getByRole('spinbutton',{name:'Depth offset'})).toHaveValue('0');
});

test('splitting ink for depth preserves sharp hair joins without visible cracks',async({page})=>{
 const {readFileSync}=await import('node:fs'),hair=JSON.parse(readFileSync('src/tests/fixtures/drawing-cusp-hair.json','utf8'));
 await page.evaluate(d=>(window as any).__editorPerfStore.getState().setDrawing(d),hair);
 const raster=()=>page.getByTestId('drawing-canvas').evaluate(async el=>{const svg=el as SVGSVGElement,r=svg.getBoundingClientRect(),copy=svg.cloneNode(true) as SVGSVGElement;
  for(const child of [...copy.children])if(child.getAttribute('data-testid')!=='drawing-paint-layer')child.remove();copy.setAttribute('width',String(r.width));copy.setAttribute('height',String(r.height));
  const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));await image.decode();const c=document.createElement('canvas');c.width=r.width;c.height=r.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return Array.from(ctx.getImageData(0,0,c.width,c.height).data).filter((_,i)=>i%4===3);
 });
 const before=await raster();await page.evaluate(()=>{const st=(window as any).__editorPerfStore,d=st.getState().project.drawing;st.getState().setDrawing({...d,curves:d.curves.map((c:any)=>({...c,localPaintOrder:true}))});});
 const after=await raster(),total=before.reduce((s,v)=>s+v,0),delta=after.reduce((s,v,i)=>s+Math.abs(v-before[i]),0);console.log('partition raster delta',delta/total);expect(total).toBeGreaterThan(10000);expect(delta/total).toBeLessThan(.035);
});

test('a three-way bound point is an internal endpoint, never an automatic tip; explicit local ink remains editable',async({page})=>{
 await page.evaluate(async()=>{const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Branch');for(const [i,p] of [[.8,0],[0,.8],[-.8,0]].entries())d=c.createPenCurve(d,d.layers[0].id,[[0,0],[p[0]/3,p[1]/3],[p[0]*2/3,p[1]*2/3],p],.02,'c'+i);for(let i=1;i<3;i++)d=c.connect(d,{curveId:'c0',end:0},{curveId:'c'+i,end:0},'POSITION');(window as any).__editorPerfStore.getState().setDrawing(d);});
 await row(page,'c0').click();await page.getByRole('button',{name:'P0 Interior endpoint ink',exact:true}).click();const toggle=page.getByRole('checkbox',{name:'Enable interior endpoint ink'});await expect(toggle).not.toBeChecked();await toggle.check();
 const extension=page.getByRole('spinbutton',{name:'Stroke extension distance px',exact:true});await extension.fill('25');await extension.press('Enter');await expect(page.getByTestId('drawing-ink-extension-hit')).toHaveCount(1);await expect(page.locator('[data-testid=drawing-ink-endpoint][data-id=c0][data-end="0"]')).toHaveCount(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(extension).toHaveValue('0');
});
