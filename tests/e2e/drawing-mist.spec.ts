import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const hair=JSON.parse(readFileSync('src/tests/fixtures/drawing-cusp-hair.json','utf8'));
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const row=(p:Page,id:string)=>p.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`);
const sharp=(p:Page)=>p.getByTestId('drawing-ink').evaluateAll(els=>els.map(e=>e.getAttribute('d')));
async function seed(p:Page){await p.evaluate(async()=>{
 const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Mist study');
 const line=(a:number,b:number,y:number)=>[[a,y],[a+(b-a)/3,y],[a+2*(b-a)/3,y],[b,y]];
 d=c.createCurve(d,d.layers[0].id,line(-1,0,.3),.008,'Mist source','a');d=c.createCurve(d,d.layers[0].id,line(0,1,.3),.008,'Unchanged neighbour','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'POSITION');
 d=c.createCurve(d,d.layers[0].id,line(-1,1,-.3),.008,'Unchanged line','c');(window as any).__editorPerfStore.getState().setDrawing(d);
 });await row(p,'a').click();}
async function number(p:Page,name:string,value:string){const slider=p.getByRole('slider',{name,exact:true}),parent=slider.locator('..');await parent.locator('.numeric-slider-value').dblclick();const field=parent.locator('input[type=text]');await field.fill(value);await field.press('Enter');}
async function scan(p:Page){return p.getByTestId('drawing-canvas').evaluate(async el=>{
 const svg=el as SVGSVGElement,r=svg.getBoundingClientRect(),u=Math.min(r.width,r.height)/2.8,copy=svg.cloneNode(true) as SVGSVGElement;copy.setAttribute('width',String(r.width));copy.setAttribute('height',String(r.height));
 copy.querySelectorAll('[data-testid=drawing-node],[data-testid=drawing-handle],.drawing-selection').forEach(e=>e.remove());
 const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));await image.decode();const c=document.createElement('canvas');c.width=r.width;c.height=r.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
 const mean=(x:number,y:number)=>{let sum=0;for(let i=0;i<60;i++){const a=ctx.getImageData(r.width/2+x*u+i,r.height/2-y*u,1,1).data;sum+=a[3]/255*(255-a[0]);}return sum/60;};
 return {near:mean(-.85,.3+4/250),far:mean(-.85,.3+11/250),untouched:mean(.2,.3+4/250),below:mean(-.85,-.3+4/250)};
 });}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('line mist: independent members, Gaussian gray falloff, sliders are one Undo, stable zoom and Save/Load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);const before=await data(page),paths=await sharp(page),h=await history(page);
 await page.getByRole('checkbox',{name:'Contour mist',exact:true}).check();expect(await history(page)).toBe(h+1);await expect(page.getByTestId('drawing-mist-image')).toHaveCount(1);
 expect((await data(page)).curves.find((c:any)=>c.id==='b').mist).toBeUndefined();expect((await data(page)).curves.find((c:any)=>c.id==='c').mist).toBeUndefined();expect(await sharp(page)).toEqual(paths);expect((await data(page)).nodes).toEqual(before.nodes);
 await number(page,'Mist width','12');await number(page,'Mist density','80');const pixels=await scan(page);console.log('mist pixels',pixels);expect(pixels.near).toBeGreaterThan(8);expect(pixels.near).toBeGreaterThan(pixels.far*2);expect(pixels.untouched).toBeLessThan(1);expect(pixels.below).toBeLessThan(1);
 const href=await page.getByTestId('drawing-mist-image').getAttribute('href'),densityBase=await data(page),nh=await history(page),slider=page.getByRole('slider',{name:'Mist density',exact:true});await slider.scrollIntoViewIfNeeded();const r=(await slider.boundingBox())!;
 await page.mouse.move(r.x+r.width*.7,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width*.06,r.y+r.height/2,{steps:8});expect(await data(page)).toEqual(densityBase);await page.mouse.up();expect(await history(page)).toBe(nh+1);
 expect(await page.getByTestId('drawing-mist-image').getAttribute('href')).toBe(href);expect((await scan(page)).near).toBeLessThan(pixels.near*.6);
 await slider.press('Meta+z');expect(await data(page)).toEqual(densityBase);await slider.press('Meta+Shift+z');expect((await data(page)).curves[0].mist.density).toBeLessThan(.4);
 await page.locator('.drawing-status').getByRole('button',{name:'＋',exact:true}).click();expect(await page.getByTestId('drawing-mist-image').getAttribute('href')).toBe(href);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-mist-image')).toHaveCount(1);
 const saved=await data(page),dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(saved);
 expect(await page.getByTestId('drawing-mist-image').getAttribute('href')).toBe(href);await page.getByTestId('language-toggle').click();await row(page,'a').click();await expect(page.getByRole('checkbox',{name:'轮廓雾化',exact:true})).toBeChecked();expect(errors).toEqual([]);
});

test('mist is non-pickable, follows mask/source edits and disappears with hidden or disabled ink',async({page})=>{
 await seed(page);await page.getByRole('checkbox',{name:'Contour mist',exact:true}).check();const image=page.getByTestId('drawing-mist-image');expect(await image.evaluate(e=>getComputedStyle(e).pointerEvents)).toBe('none');
 const old=await image.getAttribute('href');
 await page.evaluate(async()=>{const m=await import('/src/domain/drawing/commands.ts' as string),s=(window as any).__editorPerfStore.getState(),d=s.project.drawing;s.setDrawing(m.moveHandle(d,{curveId:'a',end:0},[-.75,.5]));});expect(await image.getAttribute('href')).not.toBe(old);
 await page.evaluate(async()=>{const m=await import('/src/domain/drawing/displayIntervals.ts' as string),s=(window as any).__editorPerfStore.getState();s.setDrawing(m.addDisplayInterval(s.project.drawing,'a'));});const clipped=await image.getAttribute('width');expect(Number(clipped)).toBeLessThan(180);
 await row(page,'a').click();await page.getByRole('checkbox',{name:'Show ink on selected segments',exact:true}).uncheck();await expect(image).toHaveCount(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(image).toHaveCount(1);
 await page.getByRole('checkbox',{name:'Contour mist',exact:true}).uncheck();await expect(image).toHaveCount(0);
});

test('real hair: before/after preview and warm renders stay responsive',async({page})=>{
 await page.evaluate(d=>(window as any).__editorPerfStore.getState().setDrawing(d),hair);await page.getByRole('button',{name:'Fit',exact:true}).click();await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();
 await page.screenshot({path:'artifacts/drawing-room/mist-v01231/before.png'});const original=await sharp(page);
 await page.evaluate(async()=>{const m=await import('/src/domain/drawing/mist.ts' as string),s=(window as any).__editorPerfStore.getState();s.setDrawing(m.setContourMist(s.project.drawing,s.project.drawing.curves.map((c:any)=>c.id),{enabled:true,width:7/250,density:.45}));});await expect(page.getByTestId('drawing-mist-image').first()).toBeVisible();expect(await sharp(page)).toEqual(original);
 await page.screenshot({path:'artifacts/drawing-room/mist-v01231/soft-edges.png'});
 const hrefs=await page.getByTestId('drawing-mist-image').evaluateAll(els=>els.map(e=>e.getAttribute('href')));const start=Date.now();for(let i=0;i<5;i++){await page.locator('.drawing-status').getByRole('button',{name:'＋',exact:true}).click();await page.locator('.drawing-status').getByRole('button',{name:'−',exact:true}).click();}
 console.log('warm mist zoom average ms',(Date.now()-start)/10);expect((Date.now()-start)/10).toBeLessThan(200);expect(await page.getByTestId('drawing-mist-image').evaluateAll(els=>els.map(e=>e.getAttribute('href')))).toEqual(hrefs);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await row(page,hair.curves[0].id).click();const before=await data(page),handle=page.locator(`[data-testid=drawing-handle][data-id=\"${hair.curves[0].id}\"]`).first(),r=(await handle.boundingBox())!;
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();const dragStart=Date.now();for(let i=1;i<=8;i++)await page.mouse.move(r.x+r.width/2+i*2,r.y+r.height/2+i);await page.mouse.up();
 const dragMs=(Date.now()-dragStart)/8;console.log('mist handle drag average ms',dragMs);expect(dragMs).toBeLessThan(250);expect((await data(page)).curves).not.toEqual(before.curves);await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
});


test('softened raster is one continuous grayscale edge without separate grain islands',async({page})=>{
 await seed(page);await page.getByRole('checkbox',{name:'Contour mist',exact:true}).check();await number(page,'Mist width','12');
 const stats=await page.getByTestId('drawing-mist-image').evaluate(async el=>{
  const image=new Image();image.src=el.getAttribute('href')!;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
  const {data}=ctx.getImageData(0,0,canvas.width,canvas.height),w=canvas.width,h=canvas.height,seen=new Uint8Array(w*h);let components=0;const levels=new Set<number>(),peaks=[];
  for(let i=0;i<w*h;i++){
   levels.add(data[i*4+3]);if(seen[i]||data[i*4+3]<=4)continue;components++;const stack=[i];seen[i]=1;
   while(stack.length){const k=stack.pop()!,x=k%w,y=Math.floor(k/w);for(const n of [x>0?k-1:-1,x+1<w?k+1:-1,y>0?k-w:-1,y+1<h?k+w:-1])if(n>=0&&!seen[n]&&data[n*4+3]>4){seen[n]=1;stack.push(n);}}
  }
  for(let x=40;x<w-40;x++){let sum=0,mean=0;for(let y=0;y<h;y++){const a=data[(y*w+x)*4+3];sum+=a;mean+=y*a;}if(sum)peaks.push(mean/sum);}
  return {components,levels:levels.size,drift:Math.max(...peaks)-Math.min(...peaks),localJump:Math.max(...peaks.slice(1).map((v,i)=>Math.abs(v-peaks[i])))};
 });
 expect(stats.components).toBe(1);expect(stats.levels).toBeGreaterThan(10);expect(stats.drift).toBeGreaterThan(.2);expect(stats.localJump).toBeLessThan(.25);console.log('soft edge raster',stats);
});


test('mist above 100% increases real alpha without rebuilding or changing vector ink; Undo and save retain gain',async({page})=>{
 await seed(page);await page.getByRole('checkbox',{name:'Contour mist',exact:true}).check();await number(page,'Mist width','12');await number(page,'Mist density','100');
 const before=await data(page),base=await scan(page),paths=await sharp(page),image=page.getByTestId('drawing-mist-image'),href=await image.getAttribute('href');
 await expect(page.getByRole('slider',{name:'Mist density',exact:true})).toHaveAttribute('max','5');await number(page,'Mist density','500');
 const strong=await scan(page);expect(strong.near).toBeGreaterThan(base.near*3);expect(strong.far).toBeGreaterThan(base.far*2);expect(strong.untouched).toBeLessThan(1);expect(await image.getAttribute('href')).toBe(href);expect(await sharp(page)).toEqual(paths);
 expect((await data(page)).curves.find((c:any)=>c.id==='a').mist.density).toBe(5);expect((await data(page)).curves.find((c:any)=>c.id==='b').mist).toBeUndefined();
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);expect((await scan(page)).near).toBeCloseTo(base.near,5);
 await page.getByRole('button',{name:'Redo',exact:true}).click();const saved=await data(page),dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(saved);expect((await scan(page)).near).toBeCloseTo(strong.near,5);
});
