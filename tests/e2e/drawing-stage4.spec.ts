import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const validate=(p:Page)=>p.evaluate(async()=>{const m=await import('/src/domain/drawing/model.ts' as string);m.parseDrawing((window as any).__editorPerfStore.getState().project.drawing);});
async function field(p:Page,name:string,value:string){const x=p.getByRole('spinbutton',{name,exact:true});await x.fill(value);await x.press('Enter');}
async function curve(p:Page,id:string){await p.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();}
async function paint(p:Page,id:string){await p.locator(`[data-testid=drawing-paint-row][data-id="${id}"] .drawing-object-name`).click();}
async function coord(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;return {x:r.x+r.width/2+x*u,y:r.y+r.height/2-y*u};}
async function seed(p:Page,kind='lid'){
 await p.evaluate(async(kind)=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),s=await import('/src/ui/drawing/session.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Eye');
 if(kind==='lid'){d=c.createCurve(d,d.layers[0].id,[[-.8,0],[-.6,.35],[-.2,.5],[0,.35]],.026,'Lid A','a');d=c.createCurve(d,d.layers[0].id,[[0,.35],[.2,.2],[.6,.2],[.8,0]],.026,'Lid B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');}
 else {const p=await import('/src/domain/drawing/paintCommands.ts' as string),e=c.ellipse(d,d.layers[0].id,[-.3,-.3],[.3,.3],.012);d=p.createFill(e.document,e.ids,'black');d=c.addLayer(d,'Hair');const points=[[-.7,.05],[.7,.05],[.7,.65],[-.7,.65]];for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4];d=c.createCurve(d,d.layers[0].id,[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+(b[0]-a[0])*2/3,a[1]+(b[1]-a[1])*2/3],b],.009,'Hair '+i,'h'+i);}}
 (window as any).__editorPerfStore.getState().setDrawing(d);s.useDrawing.setState({selection:{ids:[]},layerId:d.layers[0].id,preview:false,showFills:true,zoom:1,pan:[0,0]});},kind);
}
async function pixel(p:Page,x:number,y:number){return p.getByTestId('drawing-canvas').evaluate(async(el,{x,y})=>{const svg=el as SVGSVGElement,r=svg.getBoundingClientRect(),u=Math.min(r.width,r.height)/2.8,copy=svg.cloneNode(true) as SVGSVGElement;copy.setAttribute('width',String(r.width));copy.setAttribute('height',String(r.height));const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));await image.decode();const c=document.createElement('canvas');c.width=r.width;c.height=r.height;const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0);return [...ctx.getImageData(r.width/2+x*u,r.height/2-y*u,1,1).data];},{x,y});}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('legacy ink appearance is preserved without profile controls; endpoint edits, hidden ink, Undo and live Pen Cusp',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);
 await page.evaluate(async()=>{const p=await import('/src/domain/drawing/paintCommands.ts' as string),store=(window as any).__editorPerfStore.getState();store.setDrawing(p.setInk(store.project.drawing,['a'],{profile:'EYELID'}));});
 await curve(page,'a');const legacy=await data(page),h=await history(page);await expect(page.getByRole('combobox',{name:'Stroke profile',exact:true})).toHaveCount(0);await expect(page.getByRole('checkbox',{name:'Reverse profile',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('drawing-ink')).toHaveCount(1);await expect(page.getByTestId('drawing-ink')).toHaveAttribute('fill','#191e22');const path=await page.getByTestId('drawing-ink').getAttribute('d');
 await page.getByRole('button',{name:'Stroke end',exact:true}).click();await field(page,'Endpoint taper distance px','4');expect(await page.getByTestId('drawing-ink').getAttribute('d')).not.toBe(path);expect(await history(page)).toBe(h+1);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(legacy);expect(await page.getByTestId('drawing-ink').getAttribute('d')).toBe(path);await curve(page,'a');
 await page.getByRole('checkbox',{name:'Show ink on selected segments',exact:true}).uncheck();expect((await data(page)).curves.find((c:any)=>c.id==='a').inkVisible).toBe(false);expect((await data(page)).curves).toHaveLength(2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await validate(page);
 // Author a cusp during continuing pen input rather than only converting it later.
 await page.getByTestId('drawing-tool-pen').click();await page.getByRole('combobox',{name:'Continue with',exact:true}).selectOption('CUSP');
 for(const [x,y] of [[-.5,-.5],[0,-.8],[.4,-.5]]){const q=await coord(page,x,y);await page.mouse.click(q.x,q.y);}await page.keyboard.press('Enter');
 expect((await data(page)).joins.some((j:any)=>j.mode==='CUSP')).toBe(true);await validate(page);expect(errors).toEqual([]);
});

test('white fill truly occludes, independent ink, object z-order and invalid boundary diagnostics',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page,'fill');await page.getByTestId('drawing-layer').first().locator('.drawing-layer-row .drawing-object-name').click();
 const before=await data(page);await page.getByRole('button',{name:'Create white fill',exact:true}).click();let d=await data(page);const f=d.fills.at(-1).id;expect(d.fills).toHaveLength(2);await expect(page.getByTestId('drawing-paint-status')).toHaveText('Closed boundary is valid');
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();expect((await pixel(page,0,.15)).slice(0,3)).toEqual([255,255,255]);expect((await pixel(page,0,-.15))[0]).toBe(0);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await page.getByRole('button',{name:'Show fills',exact:true}).click();await expect(page.getByTestId('drawing-fill')).toHaveCount(0);await page.getByRole('button',{name:'Show fills',exact:true}).click();
 await curve(page,'h0');await page.getByRole('checkbox',{name:'Show ink on selected segments',exact:true}).uncheck();await expect(page.getByTestId('drawing-fill')).toHaveCount(2);
 await paint(page,f);await page.getByRole('button',{name:'Bring to front',exact:true}).click();expect((await data(page)).layers[0].items[0]).toBe(f);
 await page.getByRole('button',{name:'Send backward',exact:true}).click();expect((await data(page)).layers[0].items.indexOf(f)).toBe(1);
 // Direct select from the list remains available behind a filled shape.
 await curve(page,'h0');await page.getByTestId('drawing-node').last().click();await field(page,'Node X','0.8');await paint(page,f);await expect(page.getByTestId('drawing-paint-status')).toContainText('disconnected');await expect(page.getByTestId('drawing-fill')).toHaveCount(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByTestId('drawing-fill')).toHaveCount(2);await curve(page,'h0');await page.getByRole('button',{name:'Delete',exact:true}).click();await paint(page,f);await expect(page.getByTestId('drawing-paint-status')).toContainText('deleted');await validate(page);expect(errors).toEqual([]);
});

test('persistent offset controls, source edits, independent conversion, undo and save/load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);await curve(page,'a');const h=await history(page);
 await page.getByRole('button',{name:'Create offset follower',exact:true}).click();let d=await data(page),id=d.offsets[0].id;expect(await history(page)).toBe(h+1);await expect(page.getByTestId('drawing-offset')).toHaveCount(1);
 await field(page,'Offset distance px','12');await field(page,'Source start %','10');await field(page,'Source end %','90');await field(page,'End convergence %','20');await expect(page.getByRole('combobox',{name:'Stroke profile',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Stroke end',exact:true}).click();await field(page,'Endpoint taper distance px','10');
 const path=await page.getByTestId('drawing-offset').locator('path').first().getAttribute('d');await page.getByRole('button',{name:'Select source geometry',exact:true}).click();await curve(page,'a');await page.getByTestId('drawing-handle').first().click();await field(page,'Node Y','0.6');expect(await page.getByTestId('drawing-offset').locator('path').first().getAttribute('d')).not.toBe(path);
 await paint(page,id);const derived=await data(page),n=await history(page);await page.getByRole('button',{name:'Convert to independent curves',exact:true}).click();expect((await data(page)).offsets).toHaveLength(0);expect((await data(page)).curves.length).toBeGreaterThan(2);expect(await history(page)).toBe(n+1);await validate(page);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(derived);await expect(page.getByTestId('drawing-offset')).toHaveCount(1);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();const pathSave=await (await dl).path();await page.locator('header input[type=file]').setInputFiles(pathSave!);await expect.poll(()=>data(page)).toEqual(derived);await page.waitForTimeout(350);await page.reload();await page.getByTestId('drawing-room-toggle').click();expect(await data(page)).toEqual(derived);await validate(page);expect(errors).toEqual([]);
});

test('filled layer duplication and complete Stage4 save/reopen keep z order and references',async({page})=>{
 await seed(page,'fill');await page.getByTestId('drawing-layer').first().locator('.drawing-layer-row .drawing-object-name').click();await page.getByRole('button',{name:'Create white fill',exact:true}).click();await curve(page,'h0');await page.getByRole('button',{name:'Create offset follower',exact:true}).click();
 await page.getByRole('button',{name:'Duplicate layer',exact:true}).click();let d=await data(page);expect(d.layers).toHaveLength(3);expect(d.fills).toHaveLength(3);expect(d.offsets).toHaveLength(2);await validate(page);
 const saved=await data(page),dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(saved);await validate(page);
 await page.getByTestId('language-toggle').click();await curve(page,'h0');await expect(page.getByRole('combobox',{name:'笔触',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'笔触起点',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'建立白色填充',exact:true})).toBeVisible();
});

test('Stage4 editable line-art sample and visual verification',async({page})=>{
 await page.evaluate(async()=>{
  const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string),s=await import('/src/domain/drawing/strokes.ts' as string);let d=c.addLayer(m.emptyDrawing(),'脸部 · Face');let count=0;
  const add=(shape:number[][],name:string,width=.009)=>{const id='demo-'+count++;d=c.createCurve(d,d.layers[0].id,shape,width,name,id);return id;};
  const profile=(id:string,style:string)=>{d=p.setInk(d,[id],{profile:style});};
  const face=add([[-.82,.5],[-.83,-.15],[-.55,-.65],[0,-.82]],'脸廓左',.011),face2=add([[0,-.82],[.55,-.65],[.83,-.15],[.82,.5]],'脸廓右',.011);d=c.connect(d,{curveId:face,end:1},{curveId:face2,end:0},'SMOOTH');
  profile(add([[-.15,-.53],[-.02,-.48],[.07,-.51],[.19,-.51]],'嘴线',.012),'TAPER_BOTH');profile(add([[.04,-.15],[.02,-.24],[.045,-.27],[.11,-.26]],'鼻线',.009),'TAPER_BOTH');
  for(const side of [-1,1]){
   d=c.addLayer(d,side<0?'右眼 · Eye R':'左眼 · Eye L');const map=(ss:number[][])=>ss.map(([x,y])=>[x*side,y]);
   const a=add(map([[.16,.12],[.25,.3],[.4,.34],[.48,.3]]),'上眼睑 A',.023),b=add(map([[.48,.3],[.57,.26],[.68,.18],[.74,.22]]),'上眼睑 B',.023);d=c.connect(d,{curveId:a,end:1},{curveId:b,end:0},'SMOOTH');
   const start=s.orientedShape(d,s.strokeFor(d,a).segments[0])[0];d=p.setInk(d,[a],{profile:'EYELID',profileReverse:Math.abs(start[0])>.5});
   const lower1=add(map([[.74,.22],[.67,.04],[.62,-.015],[.48,-.018]]),'下眼睑 · 外侧',.008),lower2=add(map([[.48,-.018],[.31,-.02],[.25,.04],[.16,.12]]),'下眼睑 · 隐藏边界',.008);d=p.setInk(d,[lower2],{inkVisible:false});profile(lower1,'TAPER_BOTH');d=p.createFill(d,[a,b,lower1,lower2],'white');
   const iris=c.ellipse(d,d.layers[0].id,[side*.32,-.02],[side*.57,.285],.007);d=iris.document;const pupil=c.ellipse(d,d.layers[0].id,[side*.4,.04],[side*.49,.24],.003);d=p.createFill(pupil.document,pupil.ids,'black');
   const highlight=c.ellipse(d,d.layers[0].id,[side*.36,.18],[side*.43,.255],.002);d=p.createFill(highlight.document,highlight.ids,'white');d=p.setInk(d,highlight.ids,{inkVisible:false});
   d=p.createOffset(d,a);const o=d.offsets.at(-1),forward=s.orientedShape(d,o.source[0])[0];d=p.changePaint(d,o.id,{name:'双眼皮 · Offset',distance:Math.abs(forward[0])<.5?.052*side:-.052*side,start:.1,end:.91,taper:.22,width:.007,profile:'TAPER_BOTH'});
   profile(add(map([[.17,.44],[.38,.59],[.57,.5],[.75,.46]]),'眉线',.018),'TAPER_BOTH');
  }
  d=c.addLayer(d,'刘海 · White occlusion');
  const a=add([[-.62,.79],[-.73,.54],[-.66,.28],[-.43,.09]],'刘海左边',.01),b=add([[-.43,.09],[-.5,.38],[-.22,.55],[-.25,.84]],'刘海右边',.01),base=add([[-.25,.84],[-.35,.94],[-.54,.9],[-.62,.79]],'刘海闭合边界',.01);d=p.createFill(d,[a,b,base],'white');
  profile(add([[-.54,.78],[-.61,.48],[-.48,.37],[-.46,.28]],'发纹',.008),'TAPER_END');
  profile(add([[-.32,.95],[.13,1.15],[.66,1.05],[.84,.51]],'发顶',.013),'TAPER_END');
  m.parseDrawing(d);(window as any).__editorPerfStore.getState().setDrawing(d);
  const session=await import('/src/ui/drawing/session.ts' as string);session.useDrawing.setState({selection:{ids:[]},layerId:d.layers[0].id,preview:true,showFills:true,zoom:1.12,pan:[0,0]});
 });
 await validate(page);await expect(page.getByTestId('drawing-offset')).toHaveCount(2);await expect(page.getByTestId('drawing-fill')).toHaveCount(7);
 await page.getByTestId('language-toggle').click();await page.screenshot({path:'artifacts/drawing-stage4/line-art-zh.png'});await page.locator('[data-testid=drawing-curve-row]').filter({hasText:'上眼睑 A'}).first().locator('.drawing-object-name').click();await page.screenshot({path:'artifacts/drawing-stage4/stroke-properties-zh.png'});await page.getByTestId('language-toggle').click();await page.screenshot({path:'artifacts/drawing-stage4/line-art-en.png'});
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await (await dl).saveAs('artifacts/drawing-stage4/line-art-demo.json');
});
