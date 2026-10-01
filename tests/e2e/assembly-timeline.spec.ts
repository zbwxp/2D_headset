import {test,expect,type Page} from '@playwright/test';
const state=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.assembly);
async function seed(page:Page,base=0){
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__editorPerfStore);
 await page.evaluate(async(base)=>{
  const m=await import('/src/domain/assembly/model.ts' as string),tl=await import('/src/domain/assembly/timeline.ts' as string),d=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);
  let drawing=c.addLayer(d.emptyDrawing(),'眼睛');drawing=c.createCurve(drawing,drawing.layers[0].id,[[-.65,-.1],[-.45,.4],[.25,.45],[.65,0]],.018);
  drawing=c.addLayer(drawing,'头发');drawing=c.createCurve(drawing,drawing.layers[0].id,[[-.5,.7],[-.2,1.1],[.4,.8],[.5,.15]],.016);
  let a=m.createAssembly(drawing);a.pose.yaw=base;a=tl.ensureTimeline(a);a=m.bindLayer(a,drawing.layers[1].id,'eye-l');(window as any).__editorPerfStore.getState().setAssembly(a);
 },base);
 await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await page.getByTestId('assembly-3d').hover();
}
async function value(page:Page,label:string,n:string){const s=page.locator('.assembly-controls .numeric-slider').filter({has:page.getByRole('slider',{name:label,exact:true})});await s.locator('.numeric-slider-value').dblclick();const i=s.locator('.numeric-slider-entry');await i.fill(n);await i.press('Enter');}
async function select(page:Page,id:string){await page.locator(`[data-testid="assembly-drawing-layer"][data-id="${id}"]`).getByTestId('assembly-drawing-layer-select').click();}
async function corner(page:Page,index:number,dx:number,dy:number){const p=(await page.locator(`[data-testid="assembly-perspective-corner"][data-corner="${index}"]`).boundingBox())!;await page.mouse.move(p.x+p.width/2,p.y+p.height/2);await page.mouse.down();await page.mouse.move(p.x+p.width/2+dx,p.y+p.height/2+dy,{steps:5});await page.mouse.up();}
async function curve(page:Page,id:string){await page.locator(`[data-testid="assembly-drawing-curve-row"][data-id="${id}"] .assembly-drawing-object-name`).click();const toggle=page.locator('.assembly-drawing-properties-toggle');if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();}

test('one pose action records sparse position and perspective, stage preview preserves them, and layer keys are removable',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);let a=await state(page);const eye=a.drawing.layers[1].id,base=a.drawing;
 await select(page,eye);await value(page,'左右转头 Yaw','60');await page.getByRole('combobox',{name:'语义定位点',exact:true}).selectOption('eye-l');await value(page,'点 X · 平面左右','0.2');
 await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await corner(page,3,25,-16);
 await expect(page.getByTestId('assembly-pose-status')).toHaveText('有未保存修改');await page.getByTestId('assembly-pose-save').click();a=await state(page);
 expect(a.placement.keys.map((k:any)=>k.yaw)).toEqual([0,60]);expect(a.deformRecording.tracks[0].keys.map((k:any)=>k.yaw)).toEqual([0,60]);expect(a.drawing).toEqual(base);
 await value(page,'左右转头 Yaw','30');await expect(page.locator(`[data-testid="assembly-layer-key"][data-layer="${eye}"] [data-channel="bend"]`)).toHaveAttribute('data-status','interpolated');
 await page.getByTestId('assembly-pose-save').click();a=await state(page);expect(a.deformRecording.tracks[0].keys).toHaveLength(2);expect(a.placement.keys).toHaveLength(2);
 const recording=a.deformRecording;await page.getByTestId('assembly-stage-base').click();await expect(page.getByTestId('assembly-card-preview')).toBeVisible();await page.getByTestId('assembly-stage-placement').click();await expect(page.getByTestId('assembly-card-preview')).toBeVisible();await page.getByTestId('assembly-stage-bend').click();await expect(page.getByTestId('assembly-card-preview')).toBeVisible();expect((await state(page)).deformRecording).toEqual(recording);
 await page.getByTestId('assembly-pose-select').selectOption('60:0');await page.getByRole('button',{name:'删除区域变形 · 眼睛',exact:true}).click();a=await state(page);expect(a.deformRecording.tracks[0].keys).toHaveLength(1);expect(a.placement.keys).toHaveLength(2);
 expect(errors).toEqual([]);
});

test('interval edits remain in the current pose including projected endpoint dragging, toggle, undo and file roundtrip',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);let a=await state(page);const eye=a.drawing.layers[1].id,id=a.drawing.layers[1].items[0];
 await select(page,eye);await value(page,'左右转头 Yaw','45');await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await corner(page,3,-18,12);await page.getByTestId('assembly-pose-save').click();
 expect((await state(page)).deformRecording.tracks[0].keys).toHaveLength(2);
 await curve(page,id);await page.getByRole('combobox',{name:'新增区间类型',exact:true}).selectOption('HIDE');await page.getByRole('button',{name:'添加显示区间',exact:true}).click();await expect(page.getByTestId('assembly-pose-status')).toHaveText('有未保存修改');
 expect((await state(page)).drawing.displayIntervals??[]).toHaveLength(0);await page.getByTestId('assembly-drawing-canvas').hover();
 await page.getByTestId('assembly-drawing-tool-select').click();const grip=page.locator('[data-testid="assembly-projected-intervals"] [data-testid="assembly-drawing-display-grip"]').first();await expect(grip).toBeVisible();
 const before=await state(page),box=(await grip.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+25,box.y+box.height/2-6,{steps:5});await page.mouse.up();
 a=await state(page);expect(a.timeline.intervals[0].drafts).not.toEqual(before.timeline.intervals[0].drafts);
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');expect((await state(page)).timeline.intervals[0].drafts).toEqual(before.timeline.intervals[0].drafts);await page.keyboard.press('Control+Shift+z');
 await page.getByTestId('assembly-pose-save').click();const keys=(await state(page)).timeline.intervals;await page.getByTestId('assembly-apply-intervals').uncheck();await expect(grip).toHaveCount(0);await page.getByTestId('assembly-pose-save').click();expect((await state(page)).timeline.intervals).toEqual(keys);await page.getByTestId('assembly-apply-intervals').check();
 await value(page,'左右转头 Yaw','15');await expect(page.getByTestId('assembly-pose-status')).toHaveText('插值预览');await value(page,'左右转头 Yaw','45');expect((await state(page)).timeline.intervals).toEqual(keys);
 await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await download).path();await page.locator('header input[type=file]').setInputFiles(path!);await page.getByTestId('assembly-drawing-canvas').hover();expect((await state(page)).timeline.intervals).toEqual(keys);
 await page.screenshot({path:'artifacts/assembly/unified-poses.png'});expect(errors).toEqual([]);
});

test('side-angle source is retained, draft changes survive navigation and source editing is explicit',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page,30);const initial=await state(page),layer=initial.drawing.layers[0].id;
 await select(page,layer);await value(page,'左右转头 Yaw','60');await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await corner(page,2,20,-12);
 let a=await state(page);expect(a.deformRecording.tracks[0].keys.map((k:any)=>k.yaw)).toEqual([30]);const draft=a.deformRecording.tracks[0].drafts;
 await page.getByTestId('assembly-pose-select').selectOption('30:0');await value(page,'左右转头 Yaw','60');expect((await state(page)).deformRecording.tracks[0].drafts).toEqual(draft);
 await page.getByTestId('assembly-pose-discard').click();expect((await state(page)).deformRecording.tracks[0].drafts).toHaveLength(0);
 await page.getByTestId('assembly-base-edit').click();await expect(page.getByTestId('assembly-pose-status')).toHaveText('原稿编辑 · 影响共用资产');await expect(page.getByTestId('assembly-pose-save')).toBeDisabled();await page.getByTestId('assembly-base-edit').click();
 expect((await state(page)).drawing).toEqual(initial.drawing);expect(errors).toEqual([]);
});

test('each interval switch is recorded by angle and holds until the keyed yaw, with undo and reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);const original=await state(page),id=original.drawing.layers[0].items[0];
 await curve(page,id);await page.getByRole('combobox',{name:'新增区间类型',exact:true}).selectOption('HIDE');await page.getByRole('button',{name:'添加显示区间',exact:true}).click();
 const enabled=page.getByTestId('assembly-drawing-interval-enabled');await expect(enabled).toBeChecked();await enabled.uncheck();await page.getByTestId('assembly-pose-save').click();
 const inspect=()=>page.evaluate(async()=>{const m=await import('/src/domain/assembly/model.ts' as string),f=await import('/src/domain/drawing/displayIntervals.ts' as string),a=(window as any).__editorPerfStore.getState().project.assembly,d=m.assemblyDrawing(a),tr=d.displayIntervals[0];return {range:tr.ranges[0],mask:f.displayField(d,f.displayPath(d,tr.anchor.id)).mask??null};});
 const disabled=await inspect();expect(disabled.mask).toBeNull();
 await value(page,'左右转头 Yaw','30');await enabled.check();await expect(page.getByTestId('assembly-pose-status')).toHaveText('有未保存修改');
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');await expect(enabled).not.toBeChecked();await page.keyboard.press('Control+Shift+z');await expect(enabled).toBeChecked();
 await page.getByTestId('assembly-pose-save').click();const records=(await state(page)).timeline.intervals;
 for(const [yaw,on] of [['0',false],['15',false],['29.9',false],['30',true],['35',true]] as const){
  await value(page,'左右转头 Yaw',yaw);await expect(enabled).toBeChecked({checked:on});const current=await inspect();expect(current.range.enabled).toBe(on);expect(current.mask===null).toBe(!on);expect(current.range.start).toBeCloseTo(disabled.range.start);expect(current.range.end).toBeCloseTo(disabled.range.end);
 }
 expect((await state(page)).drawing).toEqual(original.drawing);
 await page.getByTestId('assembly-apply-intervals').uncheck();await page.getByTestId('assembly-pose-save').click();expect((await state(page)).timeline.intervals).toEqual(records);await page.getByTestId('assembly-apply-intervals').check();
 await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await download).path();await page.locator('header input[type=file]').setInputFiles(path!);await page.getByTestId('assembly-drawing-canvas').hover();
 expect((await state(page)).timeline.intervals).toEqual(records);await value(page,'左右转头 Yaw','15');expect((await inspect()).range.enabled).toBe(false);await value(page,'左右转头 Yaw','30');expect((await inspect()).range.enabled).toBe(true);
 await page.screenshot({path:'artifacts/assembly/interval-switch.png'});expect(errors).toEqual([]);
});
