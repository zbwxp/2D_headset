import {test,expect,type Page} from '@playwright/test';
const state=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.assembly);
async function seed(page:Page){
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__editorPerfStore);
 await page.evaluate(async()=>{
  const m=await import('/src/domain/assembly/model.ts' as string),tl=await import('/src/domain/assembly/timeline.ts' as string),d=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);
  let drawing=c.addLayer(d.emptyDrawing(),'弯曲测试');const id=drawing.layers[0].id;
  for(const y of [-.6,-.3,0,.3,.6])drawing=c.createCurve(drawing,id,[[-.7,y],[-.25,y],[.25,y],[.7,y]],.012);
  for(const x of [-.6,-.3,0,.3,.6])drawing=c.createCurve(drawing,id,[[x,-.7],[x,-.25],[x,.25],[x,.7]],.012);
  drawing=c.createCurve(drawing,id,[[-.55,-.45],[-.3,.5],[.35,-.5],[.5,.45]],.02);
  let a=tl.ensureTimeline(m.createAssembly(drawing));(window as any).__editorPerfStore.getState().setAssembly(a);
 });
 await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await page.getByTestId('assembly-3d').hover();
 const a=await state(page);await page.locator(`[data-testid="assembly-drawing-layer"][data-id="${a.drawing.layers[0].id}"]`).getByTestId('assembly-drawing-layer-select').click();
}
async function drag(page:Page,selector:string,dx:number,dy:number){const b=(await page.locator(selector).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:5});await page.mouse.up();}
async function yaw(page:Page,n:number){const s=page.locator('.assembly-controls .numeric-slider').filter({has:page.getByRole('slider',{name:'左右转头 Yaw',exact:true})});await s.locator('.numeric-slider-value').dblclick();await s.locator('.numeric-slider-entry').fill(String(n));await s.locator('.numeric-slider-entry').press('Enter');}
test('curved boundaries edit, undo, pose interpolation and source-preserving round trip',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);const raw=(await state(page)).drawing;
 await yaw(page,60);await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await expect(page.getByTestId('assembly-bend-handle')).toHaveCount(8);
 await drag(page,'[data-testid="assembly-bend-midpoint"][data-edge="1"]',28,0);let a=await state(page);expect(a.timeline.bends[0].drafts).toHaveLength(1);const bent=a.timeline.bends;
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');expect((await state(page)).timeline.bends??[]).toHaveLength(0);await page.keyboard.press('Control+Shift+z');expect((await state(page)).timeline.bends).toEqual(bent);
 await drag(page,'[data-testid="assembly-bend-handle"][data-edge="2"][data-handle="0"]',-10,-20);
 await page.getByTestId('assembly-pose-save').click();a=await state(page);expect(a.timeline.bends[0].keys.map((k:any)=>k.yaw)).toEqual([0,60]);expect(a.drawing).toEqual(raw);
 await yaw(page,30);await expect(page.locator('[data-channel="bend"]')).toHaveAttribute('data-status','interpolated');
 await expect(page.locator('[data-testid="assembly-card-preview"] foreignObject')).toHaveCount(0);
 await page.screenshot({path:'artifacts/assembly/bending.png'});
 const keys=(await state(page)).timeline.bends;await page.getByTestId('assembly-stage-placement').click();await expect(page.getByTestId('assembly-bend-cage')).toHaveCount(0);await page.getByTestId('assembly-stage-bend').click();expect((await state(page)).timeline.bends).toEqual(keys);
 await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await download).path();await page.locator('header input[type=file]').setInputFiles(path!);await page.getByTestId('assembly-drawing-canvas').hover();expect((await state(page)).timeline.bends).toEqual(keys);
 expect(errors).toEqual([]);
});

test('width stays fixed under depth and perspective; curved interval grips follow the projected curve',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);
 await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();
 await drag(page,'[data-testid="assembly-bend-midpoint"][data-edge="1"]',45,0);
 const before=await page.getByTestId('assembly-drawing-ink').evaluateAll(ps=>ps.map(p=>p.getAttribute('stroke-width')));
 await drag(page,'[data-testid="assembly-perspective-corner"][data-corner="2"]',-45,45);
 expect(await page.getByTestId('assembly-drawing-ink').evaluateAll(ps=>ps.map(p=>p.getAttribute('stroke-width')))).toEqual(before);
 const a=await state(page),id=a.drawing.curves.at(-1).id;
 await page.evaluate(async(id)=>{const c=await import('/src/domain/drawing/displayIntervals.ts' as string),m=await import('/src/domain/assembly/model.ts' as string),w=await import('/src/ui/assemblyDrawing/workspace.tsx' as string),s=await import('/src/ui/assemblyDrawing/session.ts' as string),e=(window as any).__editorPerfStore.getState();let d=c.addDisplayInterval(m.assemblyDrawing(e.project.assembly),id,'HIDE');const tr=d.displayIntervals[0];d=c.setDisplayIntervalEnd(d,tr.id,tr.ranges[0].id,0,{taper:.1});e.setAssembly(w.updateAssemblyDrawing(e.project.assembly,d));s.useDrawing.getState().set({selection:{ids:[id]},tool:'select'});},id);
 const selector='[data-testid="assembly-projected-intervals"] [data-testid="assembly-drawing-display-grip"][data-end="0"]';await expect(page.locator(selector)).toBeVisible();
 const old=(await state(page)).timeline.intervals;await drag(page,selector,20,-15);expect((await state(page)).timeline.intervals).not.toEqual(old);
 await page.getByTestId('assembly-pose-save').click();await page.getByTestId('assembly-apply-intervals').uncheck();await expect(page.locator(selector)).toHaveCount(0);await page.getByTestId('assembly-apply-intervals').check();await expect(page.locator(selector)).toBeVisible();
 expect(errors).toEqual([]);
});

test('face layers, fills and bend preview remain finite across yaw',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await page.getByTestId('assembly-3d').hover();await page.getByTestId('assembly-import').click();await page.getByRole('button',{name:'载入副本',exact:true}).click();
 const report=await page.evaluate(async()=>{
  const b=await import('/src/domain/assembly/bending.ts' as string),t=await import('/src/domain/assembly/timeline.ts' as string),m=await import('/src/domain/assembly/model.ts' as string),e=(window as any).__editorPerfStore;
  let a=t.setTimelineStage(e.getState().project.assembly,'BEND');a={...a,drawing:{...a.drawing,layers:a.drawing.layers.map((l:any)=>({...l,visible:true})),curves:a.drawing.curves.map((c:any)=>({...c,visible:true})),reference:undefined}};const source=JSON.stringify(a.drawing);a={...a,pose:{...a.pose,yaw:60}};
  for(const l of a.drawing.layers.filter((l:any)=>l.items.some((id:string)=>a.drawing.curves.some((c:any)=>c.id===id)))){const v=b.neutralBend();v.handles[1][0][0]=v.handles[1][1][0]=1.12;a=b.writeBend(a,l.id,v);}
  a=t.savePose(a);e.getState().setAssembly(a);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  const durations:number[]=[];
  for(let i=0;i<20;i++){const start=performance.now();e.getState().setAssembly({...a,pose:{...a.pose,yaw:i*3}});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);durations.push(performance.now()-start);}
  return {curves:a.drawing.curves.length,layers:a.drawing.layers.length,mean:durations.reduce((n,v)=>n+v)/durations.length,max:Math.max(...durations),unchanged:source===JSON.stringify(e.getState().project.assembly.drawing)};
 });
 console.log('Full face curved-vector preview',report);expect(report.unchanged).toBe(true);expect(report.mean).toBeLessThan(200);
 expect(await page.getByTestId('assembly-card-preview').locator('path').evaluateAll(ps=>ps.every(p=>!/NaN|Infinity/.test(p.getAttribute('d')??'')))).toBe(true);
 await page.screenshot({path:'artifacts/assembly/bending-face.png'});expect(errors).toEqual([]);
});
