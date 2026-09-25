import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const fixture=JSON.parse(readFileSync('src/tests/fixtures/drawing-ear-performance.json','utf8'));
test('saved ear drawing: pointer, selection and handle interaction performance',async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();
 if(process.env.DRAWING_PERF_PROJECT){const text=readFileSync(process.env.DRAWING_PERF_PROJECT,'utf8');await page.evaluate(async text=>{const {parseLandmarks}=await import('/src/domain/landmarks/persistence' as string);(window as any).__editorPerfStore.getState().load(parseLandmarks(text));},text);}
 else await page.evaluate(d=>(window as any).__editorPerfStore.getState().setDrawing(d),fixture);
 await expect(page.getByTestId('drawing-curve-row')).toHaveCount(fixture.curves.length);await page.waitForTimeout(300);
 const domain=await page.evaluate(async()=>{
  const d=(window as any).__editorPerfStore.getState().project.drawing;
  const s=await import('/src/domain/drawing/strokes' as string),g=await import('/src/domain/drawing/groups' as string),a=await import('/src/domain/drawing/appearance' as string),sample=await import('/src/domain/drawing/sampling' as string),m=await import('/src/domain/drawing/model' as string);
  const bench=(fn:()=>unknown)=>{const start=performance.now();for(let i=0;i<5;i++)fn();return (performance.now()-start)/5;};
  const paths=d.layers.flatMap((l:any)=>s.strokes(d,l.id)),table=d.curves.map((c:any)=>sample.samples(m.shapeOf(d,c.id)).length);
  return {curves:d.curves.length,strokes:paths.length,samples:table.reduce((x:number,y:number)=>x+y,0),maxSamples:Math.max(...table),strokeLookupMs:bench(()=>d.curves.forEach((c:any)=>s.strokeFor(d,c.id))),sidebarMs:bench(()=>d.layers.map((l:any)=>g.groupTree(d,l.id))),inkMs:bench(()=>paths.map((p:any)=>a.strokeInk(d,p)))};
 });
 const stage=process.env.PERF_STAGE??'current';mkdirSync('artifacts/drawing-performance',{recursive:true});
 const before=await page.getByTestId('drawing-canvas').locator('path[data-testid="drawing-ink"],path[data-testid="drawing-fill"],path[data-testid="drawing-cusp-tip"]').evaluateAll(els=>els.map(e=>({type:e.getAttribute('data-testid'),d:e.getAttribute('d')})));
 writeFileSync(`artifacts/drawing-performance/${stage}-paths.json`,JSON.stringify(before));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 await page.evaluate(()=>{const w=window as any;w.__drawingLongTasks=[];w.__drawingObserver=new PerformanceObserver(list=>w.__drawingLongTasks.push(...list.getEntries().map(e=>e.duration)));w.__drawingObserver.observe({type:'longtask',buffered:false});w.__drawingFrames=[];let last=performance.now();const tick=(now:number)=>{w.__drawingFrames.push(now-last);last=now;w.__drawingRaf=requestAnimationFrame(tick);};w.__drawingRaf=requestAnimationFrame(tick);});
 const canvas=page.getByTestId('drawing-canvas'),b=(await canvas.boundingBox())!;let start=Date.now();
 for(let i=0;i<30;i++)await page.mouse.move(b.x+70+i*4,b.y+80+i*2);const hoverMs=(Date.now()-start)/30;
 const id=fixture.curves.find((c:any)=>c.name==='内耳廓').id;start=Date.now();await page.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();const selectionMs=Date.now()-start;
 const handle=page.locator(`[data-testid=drawing-handle][data-id="${id}"]`).first();await expect(handle).toBeVisible();const h=(await handle.boundingBox())!;await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();start=Date.now();
 for(let i=1;i<=12;i++)await page.mouse.move(h.x+h.width/2+i,h.y+h.height/2-i*.4);await page.mouse.up();const dragMs=(Date.now()-start)/12;
 const observations=await page.evaluate(()=>{const w=window as any;cancelAnimationFrame(w.__drawingRaf);w.__drawingObserver.disconnect();const frames=w.__drawingFrames.sort((a:number,b:number)=>a-b);return {longTasks:w.__drawingLongTasks,frameP95Ms:frames[Math.floor(frames.length*.95)],frameMaxMs:frames.at(-1),heap:(performance as any).memory?.usedJSHeapSize};});
 const {profile}=await cdp.send('Profiler.stop');const nodes=new Map(profile.nodes.map((n:any)=>[n.id,n])),times=new Map<number,number>();profile.samples?.forEach((id:number,i:number)=>times.set(id,(times.get(id)??0)+(profile.timeDeltas?.[i]??0)));
 const hottest=[...times].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([id,us])=>({ms:us/1000,fn:nodes.get(id)?.callFrame.functionName,url:nodes.get(id)?.callFrame.url,line:nodes.get(id)?.callFrame.lineNumber}));
 const result={domain,hoverMs,selectionMs,dragMs,...observations,hottest,errors};writeFileSync(`artifacts/drawing-performance/${stage}.json`,JSON.stringify(result,null,2));writeFileSync(`artifacts/drawing-performance/${stage}.cpuprofile`,JSON.stringify(profile));console.log(JSON.stringify(result,null,2));expect(errors).toEqual([]);
 // Broad budgets catch the original multi-hundred-ms stalls without asserting 60 fps on CI.
 expect(domain.strokeLookupMs).toBeLessThan(50);expect(dragMs).toBeLessThan(250);expect(observations.frameP95Ms).toBeLessThan(150);
 await page.screenshot({path:`artifacts/drawing-performance/${stage}.png`});
});


test('saved ear drawing: layer copy, mirror, edit and Undo/Redo keep source and derived ink synchronized',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();
 await page.evaluate(d=>(window as any).__editorPerfStore.getState().setDrawing(d),fixture);
 const data=()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
 const ear=fixture.layers.find((l:any)=>l.name==='左耳');
 await page.locator(`[data-testid=drawing-layer][data-id="${ear.id}"] > .drawing-layer-row .drawing-object-name`).click();
 await page.getByRole('button',{name:'Duplicate layer',exact:true}).click();const copied=await data();
 expect(copied.curves.length).toBe(fixture.curves.length+16);expect(copied.layers.length).toBe(fixture.layers.length+1);
 const layer=copied.layers[0];await page.locator(`[data-testid=drawing-layer][data-id="${layer.id}"] > .drawing-layer-row .drawing-object-name`).click();
 await page.getByRole('button',{name:'Flip horizontally',exact:true}).click();const mirrored=await data();
 expect(mirrored.curves.filter((c:any)=>!layer.items.includes(c.id))).toEqual(copied.curves.filter((c:any)=>!layer.items.includes(c.id)));
 expect(mirrored.curves.filter((c:any)=>layer.items.includes(c.id))).not.toEqual(copied.curves.filter((c:any)=>layer.items.includes(c.id)));
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data()).toEqual(copied);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data()).toEqual(mirrored);
 const id=mirrored.curves.find((c:any)=>layer.items.includes(c.id)&&c.name.includes('内耳廓')).id;
 await page.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();
 await page.getByRole('button',{name:'P0 Handle',exact:true}).click();await page.keyboard.press('ArrowRight');
 expect((await data()).curves.find((c:any)=>c.id===id).handles).not.toEqual(mirrored.curves.find((c:any)=>c.id===id).handles);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data()).toEqual(mirrored);
 const invalid=await page.evaluate(async()=>{const m=await import('/src/domain/drawing/model' as string);m.parseDrawing((window as any).__editorPerfStore.getState().project.drawing);return false;});expect(invalid).toBe(false);
});
