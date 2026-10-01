import {test,expect,type Page} from '@playwright/test';
const state=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.assembly);
async function setup(page:Page){
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__editorPerfStore);
 await page.evaluate(async()=>{
  const m=await import('/src/domain/assembly/model.ts' as string),tl=await import('/src/domain/assembly/timeline.ts' as string),dm=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);
  let d=c.addLayer(dm.emptyDrawing(),'下颌');d=c.createCurve(d,d.layers[0].id,[[-.6,.5],[-.6,-.1],[-.3,-.5],[0,-.5]],.02);d=c.createCurve(d,d.layers[0].id,[[0,-.5],[.3,-.5],[.6,-.1],[.6,.5]],.02);d=c.connect(d,{curveId:d.curves[0].id,end:1},{curveId:d.curves[1].id,end:0},'SMOOTH');
  d.displayIntervals=[{id:'range',anchor:{id:d.curves[0].id,reverse:false},ranges:[{id:'r',start:.1,end:.9,mode:'SHOW'}]}];let a=tl.setTimelineStage(tl.ensureTimeline(m.createAssembly(d)),'BEND');a.pose.yaw=60;(window as any).__editorPerfStore.getState().setAssembly(a);
 });
 await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await page.getByTestId('assembly-3d').hover();
 const a=await state(page);await page.locator(`[data-testid="assembly-drawing-layer"][data-id="${a.drawing.layers[0].id}"]`).getByTestId('assembly-drawing-layer-select').click();return a;
}
async function pick(page:Page,id:string){const pos=await page.locator(`[data-testid="assembly-projected-curve-hit"][data-id="${id}"]`).evaluate((el:any)=>{const q=el.getPointAtLength(el.getTotalLength()*.5),p=new DOMPoint(q.x,q.y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};});await page.mouse.click(pos.x,pos.y);}
async function drag(page:Page,selector:string,dx:number,dy:number,cancel=false){const b=(await page.locator(selector).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:5});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();}
test('one cage; V whole stroke intervals, A source segment structure; pose correction stays separate from source',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const a=await setup(page),id=a.drawing.curves[0].id;
 await page.getByTestId('assembly-perspective-edit').click();await expect(page.getByTestId('assembly-perspective-corner')).toHaveCount(4);await expect(page.getByTestId('assembly-bend-handle')).toHaveCount(8);
 await drag(page,'[data-testid="assembly-bend-midpoint"][data-edge="1"]',20,0);await drag(page,'[data-testid="assembly-perspective-corner"][data-corner="2"]',-14,10);
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('v');await expect(page.getByTestId('assembly-perspective-corner')).toHaveCount(0);await pick(page,id);
 await expect(page.getByTestId('assembly-projected-selection')).toHaveCount(2);await expect(page.getByTestId('assembly-drawing-display-grip')).toHaveCount(2);await expect(page.getByTestId('assembly-refinement-grip')).toHaveCount(0);
 await page.keyboard.press('a');await pick(page,id);await expect(page.getByTestId('assembly-drawing-display-grip')).toHaveCount(0);await expect(page.getByTestId('assembly-refinement-grip')).toHaveCount(4);expect((await state(page)).timeline.editingBase).toBe(false);
 const shapeBefore=await page.locator(`[data-testid="assembly-refinement-curve"][data-id="${id}"] > path`).first().getAttribute('d');await page.getByTestId('assembly-stage-refine').click();expect(await page.locator(`[data-testid="assembly-refinement-curve"][data-id="${id}"] > path`).first().getAttribute('d')).toEqual(shapeBefore);
 const grip=`[data-testid="assembly-refinement-grip"][data-id="${id}"][data-index="1"]`;
 await drag(page,grip,30,-12);const edited=await state(page);expect(edited.drawing).toEqual(a.drawing);expect(edited.timeline.refinements).toHaveLength(1);await expect(page.getByTestId('assembly-pose-status')).toHaveText('有未保存修改');
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');expect((await state(page)).timeline.refinements??[]).toHaveLength(0);await page.keyboard.press('Control+Shift+z');expect((await state(page)).timeline.refinements).toEqual(edited.timeline.refinements);
 await drag(page,grip,-20,12,true);expect((await state(page)).timeline.refinements).toEqual(edited.timeline.refinements);
 await page.getByTestId('assembly-pose-save').click();expect((await state(page)).timeline.refinements[0].keys.map((k:any)=>k.yaw)).toEqual([0,60]);
 await page.getByTestId('assembly-pose-select').selectOption('0:0');await page.getByTestId('assembly-pose-select').selectOption('60:0');expect((await state(page)).drawing).toEqual(a.drawing);
 await page.screenshot({path:'artifacts/assembly/refinement.png'});
 await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await download).path();await page.locator('header input[type=file]').setInputFiles(path!);await page.getByTestId('assembly-3d').hover();expect((await state(page)).timeline.refinements[0].keys).toHaveLength(2);
 await page.getByTestId('assembly-base-edit').click();await expect(page.getByTestId('assembly-refinement-overlay')).toHaveCount(0);expect((await state(page)).timeline.editingBase).toBe(true);expect(errors).toEqual([]);
});
test('fresh refinement starts at zero, saved region poses do not inherit corrections, and in-between yaw still interpolates',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const a=await setup(page),id=a.drawing.curves[0].id,layer=a.drawing.layers[0].id;
 await page.evaluate(async()=>{
  const store=(window as any).__editorPerfStore,ref=await import('/src/domain/assembly/refinement.ts' as string),tl=await import('/src/domain/assembly/timeline.ts' as string),b=await import('/src/domain/assembly/bending.ts' as string);
  let a=store.getState().project.assembly;a=tl.savePose(ref.moveRefinedControl(a,a.drawing.curves[0].id,1,[.2,.1]));a={...a,pose:{...a.pose,yaw:30}};
  const bend=b.neutralBend();bend.handles[1][0][0]=1.2;a=tl.savePose(b.writeBend(a,a.drawing.layers[0].id,bend));store.getState().setAssembly(tl.setTimelineStage(a,'BEND'));
 });
 const yaw=async(value:string)=>{const s=page.locator('.assembly-controls .numeric-slider').filter({has:page.getByRole('slider',{name:'左右转头 Yaw',exact:true})});await s.locator('.numeric-slider-value').dblclick();await s.locator('.numeric-slider-entry').fill(value);await s.locator('.numeric-slider-entry').press('Enter');};
 const delta=()=>page.evaluate(async(id)=>{const ref=await import('/src/domain/assembly/refinement.ts' as string);return ref.refinementEvaluation((window as any).__editorPerfStore.getState().project.assembly,id).delta;},id);
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('a');await pick(page,id);
 const path=page.locator(`[data-testid="assembly-refinement-curve"][data-id="${id}"] > path`).first(),before=await path.getAttribute('d'),records=(await state(page)).timeline.refinements;
 await page.getByTestId('assembly-stage-refine').click();expect(await path.getAttribute('d')).toEqual(before);expect((await delta()).flat().every((n:number)=>n===0)).toBe(true);expect((await state(page)).timeline.refinements).toEqual(records);
 await expect(page.locator(`[data-testid="assembly-layer-key"][data-layer="${layer}"] [data-channel="refine"]`)).toHaveAttribute('data-status','zero');
 await yaw('60');const end=await delta();expect(end[1][0]).toBeGreaterThan(0);
 await yaw('45');expect((await delta())[1][0]).toBeCloseTo(end[1][0]/2,8);expect((await state(page)).timeline.refinements).toEqual(records);
 await page.getByTestId('assembly-stage-bend').click();const uncorrected=await path.getAttribute('d');await page.getByTestId('assembly-stage-refine').click();expect(await path.getAttribute('d')).toEqual(uncorrected);expect((await delta()).flat().every((n:number)=>n===0)).toBe(true);
 await expect(page.getByTestId('assembly-pose-status')).toHaveText('有未保存修改');await page.getByTestId('assembly-pose-save').click();
 await yaw('52.5');expect((await delta())[1][0]).toBeCloseTo(end[1][0]/2,8);expect((await state(page)).drawing).toEqual(a.drawing);expect(errors).toEqual([]);
});
