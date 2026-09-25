import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
async function coord(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;return {x:r.x+r.width/2+x*u,y:r.y+r.height/2-y*u};}
function expectStraight(d:any,c:any){const a=d.nodes.find((n:any)=>n.id===c.nodes[0]).position,b=d.nodes.find((n:any)=>n.id===c.nodes[1]).position;for(let i=0;i<2;i++)for(let k=0;k<2;k++)expect(c.handles[i][k]).toBeCloseTo(a[k]+(b[k]-a[k])*(i+1)/3,8);}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('very acute cusp spikes stop at five widths in the displayed SVG',async({page})=>{
 const widths=[.02,.06,.12];
 await page.evaluate(async(widths)=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Limited sharp ink');
  for(let i=0;i<widths.length;i++){const y=.7-i*.7,a=[-.6,y+.01745],p=[.4,y],b=[-.6,y-.01745],line=(a:number[],b:number[])=>[a,a.map((x,k)=>x+(b[k]-x)/3),a.map((x,k)=>x+2*(b[k]-x)/3),b];d=c.createCurve(d,d.layers[0].id,line(a,p),widths[i],undefined,'a'+i);d=c.createCurve(d,d.layers[0].id,line(p,b),widths[i],undefined,'b'+i);d=c.connect(d,{curveId:'a'+i,end:1},{curveId:'b'+i,end:0},'CUSP');}
  (window as any).__editorPerfStore.getState().setDrawing(d);
 },widths);
 const original=await data(page);await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-cusp-tip')).toHaveCount(3);
 const lengths=await page.getByTestId('drawing-cusp-tip').evaluateAll(els=>els.map(el=>{const xy=el.getAttribute('d')!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);return Math.hypot(xy[4]-xy[0],xy[5]-xy[1]);}));
 const r=(await page.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;
 expect(lengths.sort((a,b)=>a-b)).toEqual(expect.arrayContaining(widths.map(w=>expect.closeTo(5*w*u,6))));expect(await data(page)).toEqual(original);
 await page.screenshot({path:'artifacts/drawing-arc/cusp-limit.png'});
});

test('continuous Pen clicks make straight polygon edges, closing and restarting preserve position-only defaults',async({page})=>{
 await page.getByRole('button',{name:'New layer',exact:true}).click();await page.getByTestId('drawing-tool-pen').click();
 await page.getByRole('combobox',{name:'Continue with',exact:true}).selectOption('SMOOTH');await page.getByTestId('drawing-tool-direct').click();await page.getByTestId('drawing-tool-pen').click();await expect(page.getByRole('combobox',{name:'Continue with',exact:true})).toHaveValue('POSITION');
 for(const [x,y] of [[-.8,-.4],[-.4,.7],[.6,.2],[.4,-.6],[-.8,-.4]]){const q=await coord(page,x,y);await page.mouse.click(q.x,q.y);}
 const polygon=await data(page);expect(polygon.curves).toHaveLength(4);expect(polygon.nodes).toHaveLength(4);expect(polygon.joins).toHaveLength(0);for(const c of polygon.curves)expectStraight(polygon,c);await expect(page.getByTestId('drawing-chain-select')).toContainText('Closed stroke');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await data(page)).curves).toHaveLength(3);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(polygon);
 // An intentional incoming handle drag must not prescribe the next segment's outgoing direction.
 await page.getByTestId('drawing-tool-pen').click();let q=await coord(page,-.8,-.95);await page.mouse.click(q.x,q.y);q=await coord(page,-.2,-.95);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+25,q.y-40,{steps:4});await page.mouse.up();q=await coord(page,.65,-1.05);await page.mouse.click(q.x,q.y);await page.keyboard.press('Enter');
 const d=await data(page);expect(d.curves).toHaveLength(6);expectStraight(d,d.curves.at(-1));expect(d.joins).toHaveLength(0);await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await page.screenshot({path:'artifacts/drawing-arc/polygon-pen.png'});
});

test('closed stroke owns fill visibility, with Undo, own visibility and save/load preserved',async({page})=>{
 await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);const d=c.addLayer(m.emptyDrawing(),'Iris'),e=c.ellipse(d,d.layers[0].id,[-.65,-.5],[.65,.5],.02);(window as any).__editorPerfStore.getState().setDrawing(e.document);});
 await page.getByTestId('drawing-chain-select').click();await page.getByRole('button',{name:'Create black fill',exact:true}).click();await expect(page.getByTestId('drawing-fill')).toHaveCount(1);const before=await data(page);
 await page.getByTestId('drawing-chain-visibility').click();await expect(page.getByTestId('drawing-ink')).toHaveCount(0);await expect(page.getByTestId('drawing-fill')).toHaveCount(0);expect((await data(page)).fills.map((f:any)=>f.visible)).toEqual([false]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);await expect(page.getByTestId('drawing-fill')).toHaveCount(1);await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.getByTestId('drawing-fill')).toHaveCount(0);
 const hidden=await data(page),dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(hidden);await expect(page.getByTestId('drawing-fill')).toHaveCount(0);await page.getByTestId('drawing-chain-visibility').click();await expect(page.getByTestId('drawing-fill')).toHaveCount(1);
 await page.getByTestId('drawing-chain-select').click();await page.getByRole('checkbox',{name:'Show ink on selected segments',exact:true}).uncheck();await expect(page.getByTestId('drawing-ink')).toHaveCount(0);await expect(page.getByTestId('drawing-fill')).toHaveCount(1);
 const row=page.getByTestId('drawing-paint-row');await row.getByRole('button',{name:/^Hide /}).click();await expect(page.getByTestId('drawing-fill')).toHaveCount(0);await page.getByTestId('drawing-chain-visibility').click();await page.getByTestId('drawing-chain-visibility').click();await expect(page.getByTestId('drawing-fill')).toHaveCount(1);
});

test('acute cusp renders a pointed miter at thin and thick widths, without moving source handles',async({page})=>{
 const widths=[.02,.06,.12],ys=[.7,0,-.7];
 await page.evaluate(async({widths,ys})=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Sharp ink');
 for(let i=0;i<widths.length;i++){const y=ys[i],a=[-.6,y+.18],p=[.4,y],b=[-.6,y-.18],line=(a:number[],b:number[])=>[a,a.map((x,k)=>x+(b[k]-x)/3),a.map((x,k)=>x+2*(b[k]-x)/3),b];d=c.createCurve(d,d.layers[0].id,line(a,p),widths[i],'In '+i,'a'+i);d=c.createCurve(d,d.layers[0].id,line(p,b),widths[i],'Out '+i,'b'+i);d=c.connect(d,{curveId:'a'+i,end:1},{curveId:'b'+i,end:0},'CUSP');}
 (window as any).__editorPerfStore.getState().setDrawing(d);},{widths,ys});
 const original=await data(page);for(const c of original.curves)expectStraight(original,c);await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-cusp-tip')).toHaveCount(3);
 // Sample beyond a round join's radius but within the sharp wedge in the actual SVG rendering.
 const pixels=await page.getByTestId('drawing-canvas').evaluate(async(el,{widths,ys})=>{const svg=el as SVGSVGElement,r=svg.getBoundingClientRect(),u=Math.min(r.width,r.height)/2.8,copy=svg.cloneNode(true) as SVGSVGElement;copy.setAttribute('width',String(r.width));copy.setAttribute('height',String(r.height));const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));await image.decode();const canvas=document.createElement('canvas');canvas.width=r.width;canvas.height=r.height;const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);return widths.map((w,i)=>[...ctx.getImageData(r.width/2+(.4+w*.5*Math.sqrt(1+.18**2)/.18*.65)*u,r.height/2-ys[i]*u,1,1).data]);},{widths,ys});
 for(const px of pixels)expect(px[0]).toBeLessThan(90);expect(await data(page)).toEqual(original);await page.screenshot({path:'artifacts/drawing-arc/sharp-ink-widths.png'});
});
