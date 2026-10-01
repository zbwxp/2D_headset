import {test,expect,type Page} from '@playwright/test';
const project=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project);
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await expect(page.getByTestId('assembly-room')).toBeVisible();await page.getByTestId('assembly-3d').hover();await expect(page.locator('.app-menu-bar')).toHaveAttribute('data-open','false');}
async function value(page:Page,label:string,n:string){const s=page.locator('.assembly-controls .numeric-slider').filter({has:page.getByRole('slider',{name:label,exact:true})});await s.locator('.numeric-slider-value').dblclick();const i=s.locator('.numeric-slider-entry');await i.fill(n);await i.press('Enter');}
async function importFace(page:Page){await page.getByTestId('assembly-import').click();await page.getByRole('button',{name:'载入副本',exact:true}).click();await expect(page.getByTestId('assembly-drawing-layer').first()).toBeVisible();}
test('front-referenced 3D card preview rotates SVG fills and ink, preserves order and source, and persists its switch',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);await importFace(page);
 const original=await project(page),layers=original.assembly.drawing.layers;
 const outer=layers.find((l:any)=>l.name==='左眼睑'),inner=layers.find((l:any)=>l.name==='左眼内结构');
 await page.getByRole('combobox',{name:'语义定位点',exact:true}).selectOption('eye-l');
 const select=(id:string)=>page.locator(`[data-testid="assembly-drawing-layer"][data-id="${id}"]`).getByTestId('assembly-drawing-layer-select');
 await select(outer.id).click();await select(inner.id).click({modifiers:['Shift']});await page.getByTestId('assembly-bind').click();
 await page.getByTestId('assembly-stage-bend').click();await page.locator('.assembly-controls summary').filter({hasText:'主轴位置与透视'}).click();
 const flag=page.getByTestId('assembly-follow-axis'),canvas=page.getByTestId('assembly-drawing-canvas');await expect(flag).not.toBeChecked();
 const bound=(await project(page)).assembly;
 const paintOrder=()=>canvas.getByTestId('assembly-drawing-paint-layer').evaluateAll(gs=>gs.map(g=>g.getAttribute('data-id')));
 const frontOrder=await paintOrder();
 const shapes=()=>canvas.locator('[data-testid="assembly-drawing-ink"],[data-testid="assembly-drawing-fill"]').evaluateAll(ps=>ps.map(p=>({path:p.getAttribute('d'),box:p.getBoundingClientRect().toJSON()})));
 const front=await shapes();await flag.check();await expect(canvas.getByTestId('assembly-card-preview')).toBeVisible();
 const cards=canvas.getByTestId('assembly-card-layer');await expect(cards).toHaveCount(2);
 const after=await shapes();expect(after).toHaveLength(front.length);
 after.forEach((p,i)=>{for(const k of ['x','y','width','height'])expect(p.box[k]).toBeCloseTo(front[i].box[k],2);});
 expect(await paintOrder()).toEqual(frontOrder);
 // Switching on at a turned pose uses absolute front orientation, not a fresh neutral pose.
 await flag.uncheck();await value(page,'左右转头 Yaw','55');await value(page,'俯仰 Pitch','18');await value(page,'歪头 Roll','20');
 const turned=await shapes();await flag.check();const rotated=await shapes();
 expect(rotated.some((p,i)=>Math.abs(p.box.width-turned[i].box.width)>3)).toBe(true);
 expect(await paintOrder()).toEqual(frontOrder);
 // Vector geometry changes while the compositor never scales the pen width.
 expect(await cards.first().evaluate(e=>getComputedStyle(e).transform)).toBe('none');
 expect(await cards.first().locator('path').evaluateAll(ps=>ps.every(p=>!/NaN|Infinity/.test(p.getAttribute('d')??'')))).toBe(true);
 await page.getByTestId('assembly-3d').hover();await page.screenshot({path:'artifacts/assembly/card-preview.png'});
 // Edge-on and rear views stay finite; the source is never inverted or baked.
 for(const yaw of ['89.9','90','90.1','180']){await value(page,'左右转头 Yaw',yaw);await expect(canvas.getByTestId('assembly-card-preview')).toBeVisible();expect(await cards.first().locator('path').evaluateAll(ps=>ps.every(p=>!/NaN|Infinity/.test(p.getAttribute('d')??'')))).toBe(true);}
 const current=(await project(page)).assembly;expect(current.drawing).toEqual(bound.drawing);expect(current.bindings).toEqual(bound.bindings);expect((await project(page)).drawing).toEqual(original.drawing);
 await flag.uncheck();await canvas.focus();await page.keyboard.press('Control+z');await expect(flag).toBeChecked();await page.keyboard.press('Control+Shift+z');await expect(flag).not.toBeChecked();await flag.check();
 await page.locator('.app-menu-bar .auto-hide-trigger').hover();const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await download).path();
 await page.locator('header input[type=file]').setInputFiles(path!);await expect(flag).toBeChecked();await expect(canvas.getByTestId('assembly-card-preview')).toBeVisible();
 await page.getByRole('button',{name:'回到正脸',exact:true}).click();await flag.uncheck();expect((await project(page)).assembly.drawing).toEqual(bound.drawing);
 expect(errors).toEqual([]);
});
test('tilted yaw spins around a fixed main axis, follows the preview circle and only labels the selected locator',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 await value(page,'左右转头 Yaw','-31.5');await value(page,'俯仰 Pitch','-30');
 const inspection=page.getByTestId('assembly-3d'),canvas=page.getByTestId('assembly-drawing-canvas');
 for(const view of [inspection,canvas]){await expect(view.getByTestId('assembly-locator-label')).toHaveCount(1);await expect(view.getByTestId('assembly-locator-label')).toHaveText('眉心');}
 await inspection.locator('[data-testid="assembly-locator"][data-id="chin"] circle').click();
 for(const view of [inspection,canvas]){await expect(view.getByTestId('assembly-locator-label')).toHaveCount(1);await expect(view.getByTestId('assembly-locator-label')).toHaveText('下巴');}
 await page.locator('.assembly-controls').evaluate(e=>e.scrollTop=0);await page.locator('.assembly-inspection').screenshot({path:'artifacts/assembly/local-yaw-orbit.png'});
 for(const roll of ['0','25']){
  await value(page,'歪头 Roll',roll);
  const paths=await Promise.all([inspection,canvas].map(async view=>({axis:await view.getByTestId('assembly-main-axis').getAttribute('d'),orbit:await view.locator('[data-testid="assembly-yaw-trajectory"][data-id="chin"]').getAttribute('d')})));
  for(const yaw of ['-31.5','0','37.5','90','180']){
   await value(page,'左右转头 Yaw',yaw);
   for(const [i,view] of [inspection,canvas].entries()){
    expect(await view.getByTestId('assembly-main-axis').getAttribute('d')).toBe(paths[i].axis);
    expect(await view.locator('[data-testid="assembly-yaw-trajectory"][data-id="chin"]').getAttribute('d')).toBe(paths[i].orbit);
    const distance=await view.evaluate(svg=>{
     const orbit=svg.querySelector('[data-testid="assembly-yaw-trajectory"][data-id="chin"]') as SVGPathElement;
     const c=svg.querySelector('[data-testid="assembly-locator"][data-id="chin"] circle')!;
     const x=Number(c.getAttribute('cx')),y=Number(c.getAttribute('cy')),length=orbit.getTotalLength();
     let min=Infinity;for(let i=0;i<=1500;i++){const p=orbit.getPointAtLength(length*i/1500);min=Math.min(min,Math.hypot(x-p.x,y-p.y));}return min;
    });expect(distance).toBeLessThan(1);
   }
  }
 }
 expect(errors).toEqual([]);
});
test('independent editor imports, binds, follows pose without rotation, edits, undoes and reloads compact saves',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);expect(await page.getByTestId('hairstyle-room-toggle').count()).toBe(0);
 const main=(await project(page)).drawing;await importFace(page);
 expect((await project(page)).assembly.drawing).toEqual(main);
 const a=(await project(page)).assembly,layer=a.drawing.layers.find((l:any)=>l.items.some((id:string)=>a.drawing.curves.some((c:any)=>c.id===id)));
 await page.getByRole('combobox',{name:'挂接图层',exact:true}).selectOption(layer.id);await page.getByTestId('assembly-bind').click();await expect(page.getByTestId('assembly-layer-scale')).toContainText('100.0%');
 await value(page,'左右转头 Yaw','45');await value(page,'俯仰 Pitch','20');await value(page,'歪头 Roll','15');
 expect((await project(page)).assembly.pose).toMatchObject({yaw:45,pitch:20,roll:15});expect((await project(page)).drawing).toEqual(main);
 const before=await page.evaluate(async()=>{const url='/src/domain/assembly/model.ts';const m=await import(url);return m.assemblyDrawing((window as any).__editorPerfStore.getState().project.assembly);});
 await page.getByRole('button',{name:'回到正脸',exact:true}).click();expect((await project(page)).assembly.pose).toMatchObject({yaw:0,pitch:0,roll:0});
 // Empty layer + pen exercises the copied tool loop, including sequential authoring and Undo.
 await page.getByTestId('assembly-drawing-new-layer').click();await page.getByTestId('assembly-drawing-tool-pen').click();
 const canvas=(await page.getByTestId('assembly-drawing-canvas').boundingBox())!;
 for(const [x,y] of [[.2,.85],[.3,.9],[.4,.85]])await page.mouse.click(canvas.x+canvas.width*x,canvas.y+canvas.height*y);
 await page.keyboard.press('Enter');const drawn=(await project(page)).assembly.drawing.curves.length;expect(drawn).toBe(main.curves.length+2);
 await page.keyboard.press('Control+z');expect((await project(page)).assembly.drawing.curves.length).toBe(drawn-1);
 await page.keyboard.press('Control+Shift+z');expect((await project(page)).assembly.drawing.curves.length).toBe(drawn);
 // New plane is selectable, and its point remains in that plane.
 await page.getByRole('button',{name:'添加定位面',exact:true}).click();const plane=(await project(page)).assembly.planes.at(-1);await page.getByRole('button',{name:'添加定位点',exact:true}).click();expect((await project(page)).assembly.locators.at(-1).planeId).toBe(plane.id);
 await value(page,'平面轴向高度','0.6');await value(page,'点 X · 平面左右','0.3');expect((await project(page)).assembly.planes.at(-1).height).toBe(.6);
 // Download uses the compact serializer, retaining both independent workspaces.
 await page.locator('.app-menu-bar .auto-hide-trigger').hover();
 const save=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const download=await save,path=await download.path();expect(path).toBeTruthy();
 const saved=await project(page);await page.locator('header input[type=file]').setInputFiles(path!);expect((await project(page)).assembly).toEqual(JSON.parse(JSON.stringify(saved.assembly)));expect((await project(page)).drawing).toEqual(main);
 await page.getByTestId('assembly-3d').hover();await page.screenshot({path:'artifacts/assembly/workspace.png'});expect(before.layers).toEqual(main.layers);expect(errors).toEqual([]);
});
test('snapshot restore includes rig pose, offset and binding; original drawing remains separate',async({page})=>{
 await enter(page);await importFace(page);const main=(await project(page)).drawing;
 await page.getByTestId('assembly-bind').click();
 async function snapshot(name:string){await page.locator('.assembly-drawing-context-bar').hover();const history=page.locator('.assembly-legacy-snapshots');if(!await history.evaluate(e=>e.hasAttribute('open')))await history.locator('summary').click();await page.getByRole('button',{name:'保存为新快照',exact:true}).click();await page.getByRole('textbox',{name:'快照名称',exact:true}).fill(name);await page.getByRole('button',{name:'保存',exact:true}).click();}
 await snapshot('Front rig');const front=(await project(page)).assembly.drawingSnapshots.activeId;
 await value(page,'左右转头 Yaw','60');await page.getByTestId('assembly-base-edit').click();await value(page,'图层偏移 X','0.12');await snapshot('Turn rig');const turn=(await project(page)).assembly.drawingSnapshots.activeId;
 await page.locator('.assembly-drawing-context-bar').hover();await page.getByRole('combobox',{name:'切换快照',exact:true}).selectOption(front);
 expect((await project(page)).assembly.pose.yaw).toBe(0);expect((await project(page)).assembly.bindings[0].offset[0]).toBe(0);
 await page.getByRole('combobox',{name:'切换快照',exact:true}).selectOption(turn);expect((await project(page)).assembly.pose.yaw).toBe(60);expect((await project(page)).assembly.bindings[0].offset[0]).toBe(.12);
 expect((await project(page)).drawing).toEqual(main);
});
test('canvas navigation locks and unlocks rig alignment, and zooms both without registration drift',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);await importFace(page);
 const canvas=page.getByTestId('assembly-drawing-canvas');
 const state=()=>page.evaluate(async()=>{const url='/src/ui/assemblyDrawing/session.ts';const {useDrawing}=await import(url);const s=useDrawing.getState();return {pan:s.pan,rigPan:s.rigPan,zoom:s.zoom};});
 const positions=()=>canvas.evaluate(svg=>{
  const hit=svg.querySelector('[data-testid="assembly-drawing-ink"]') as SVGPathElement;
  const p=hit.getPointAtLength(0),c=svg.querySelector('[data-testid="assembly-rig-overlay"] circle')!;
  const image=svg.querySelector('image') as SVGImageElement|null;
  const m=image?.transform.baseVal.consolidate()?.matrix;
  return {ink:[p.x,p.y],point:[Number(c.getAttribute('cx')),Number(c.getAttribute('cy'))],axis:svg.querySelector('[data-testid="assembly-main-axis"]')!.getAttribute('d'),reference:m?[m.e,m.f]:null};
 });
 await page.evaluate(()=>{const e=(window as any).__editorPerfStore.getState();(window as any).__navigationBefore={project:e.project,past:e.past,future:e.future};});
 const bounds=(await canvas.boundingBox())!,x=bounds.x+bounds.width*.4,y=bounds.y+bounds.height*.65;
 const initial=await positions();
 // Ordinary right drag stays a viewport operation, including its background.
 await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+70,y+40,{steps:6});await page.mouse.up({button:'right'});
 await expect.poll(async()=>(await state()).pan).toEqual([70,40]);const panned=await positions();
 expect(panned.axis).toBe(initial.axis);expect(panned.point).toEqual(initial.point);
 for(let i=0;i<2;i++){expect(panned.ink[i]-initial.ink[i]).toBeCloseTo([70,40][i],3);if(initial.reference&&panned.reference)expect(panned.reference[i]-initial.reference[i]).toBeCloseTo([70,40][i],3);}
 // H uses the same navigation semantics.
 await canvas.focus();await page.keyboard.press('h');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-20,y+10,{steps:3});await page.mouse.up();
 await expect.poll(async()=>(await state()).pan).toEqual([50,50]);expect((await positions()).axis).toBe(initial.axis);
 // Lock at the current offset, then both right-drag and H move all displayed content together.
 const lock=page.getByTestId('assembly-view-lock'),beforeLock=await positions();
 await expect(lock).toHaveAttribute('aria-pressed','false');await lock.click();await expect(lock).toHaveAttribute('aria-pressed','true');
 expect(await positions()).toEqual(beforeLock);
 for(const button of ['right','left'] as const){
  const before=await positions();await page.mouse.move(x,y);await page.mouse.down({button});await page.mouse.move(x+25,y-15,{steps:4});await page.mouse.up({button});
  const after=await positions();
  for(let i=0;i<2;i++){
   expect(after.point[i]-before.point[i]).toBeCloseTo([25,-15][i],3);
   expect(after.ink[i]-before.ink[i]).toBeCloseTo([25,-15][i],3);
   if(before.reference&&after.reference)expect(after.reference[i]-before.reference[i]).toBeCloseTo([25,-15][i],3);
  }
 }
 // Wheel zoom retains the relative world-space placement of rig and drawing.
 const beforeZoom=await state(),beforePoints=await positions();await page.mouse.wheel(0,-200);
 await expect.poll(async()=>(await state()).zoom).toBeGreaterThan(beforeZoom.zoom);
 const afterZoom=await state(),afterPoints=await positions(),ratio=afterZoom.zoom/beforeZoom.zoom;
 for(let i=0;i<2;i++)expect(afterPoints.point[i]-afterPoints.ink[i]).toBeCloseTo((beforePoints.point[i]-beforePoints.ink[i])*ratio,2);
 // A cancelled Z gesture restores both view origins exactly.
 await canvas.focus();await page.keyboard.press('z');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+12,y-60,{steps:6});
 await expect.poll(async()=>(await state()).zoom).toBeGreaterThan(afterZoom.zoom);
 await page.keyboard.press('Escape');await page.mouse.up();expect(await state()).toEqual(afterZoom);
 // Footer zoom and Fit are common view transforms, also preserving registration.
 const registration=(s:{pan:number[];rigPan:number[];zoom:number})=>s.pan.map((n,i)=>(s.rigPan[i]-n)/s.zoom);
 const registered=registration(await state());
 for(const name of ['＋','适配']){await page.locator('.assembly-drawing-status').getByRole('button',{name,exact:true}).click();registration(await state()).forEach((n,i)=>expect(n).toBeCloseTo(registered[i],8));}
 // Unlock does not snap; the next right-drag again leaves the rig alone.
 const beforeUnlock=await positions();await lock.click();await expect(lock).toHaveAttribute('aria-pressed','false');expect(await positions()).toEqual(beforeUnlock);
 await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x-30,y+10,{steps:4});await page.mouse.up({button:'right'});
 const unlocked=await positions();expect(unlocked.point).toEqual(beforeUnlock.point);expect(unlocked.axis).toEqual(beforeUnlock.axis);
 expect(unlocked.ink[0]-beforeUnlock.ink[0]).toBeCloseTo(-30,3);
 expect(await page.evaluate(()=>{const e=(window as any).__editorPerfStore.getState(),b=(window as any).__navigationBefore;return e.project===b.project&&e.past===b.past&&e.future===b.future;})).toBe(true);
 // Bind captures the visually aligned rig point, not the unpanned world origin.
 const bindingAnchor=await page.evaluate(async()=>{const url='/src/domain/assembly/model.ts',sessionUrl='/src/ui/assemblyDrawing/session.ts';const {locatorProjection}=await import(url),{useDrawing}=await import(sessionUrl);const s=useDrawing.getState(),a=(window as any).__editorPerfStore.getState().project.assembly;
  const b=document.querySelector('[data-testid="assembly-drawing-canvas"]')!.getBoundingClientRect(),unit=Math.min(b.width,b.height)/2.8*s.zoom,p=locatorProjection(a,a.locators[0].id).point;
  return [p[0]+(s.rigPan[0]-s.pan[0])/unit,p[1]-(s.rigPan[1]-s.pan[1])/unit];
 });
 await page.getByTestId('assembly-bind').click();(await project(page)).assembly.bindings[0].anchor.forEach((n:number,i:number)=>expect(n).toBeCloseTo(bindingAnchor[i],8));
 // The axis itself can still be positioned independently using its own controls.
 const axis=await canvas.getByTestId('assembly-main-axis').getAttribute('d');
 await page.locator('.assembly-controls summary').filter({hasText:'主轴位置与透视'}).click();await value(page,'主轴 X','0.2');
 expect(await canvas.getByTestId('assembly-main-axis').getAttribute('d')).not.toBe(axis);
 expect(errors).toEqual([]);
});
test('multiselect eye layers and attach to one locator, undo as one action, and detach only one layer',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);await importFace(page);
 const original=await project(page),layers=original.assembly.drawing.layers;
 const outer=layers.find((l:any)=>l.name==='左眼睑'),inner=layers.find((l:any)=>l.name==='左眼内结构');
 await page.getByRole('combobox',{name:'语义定位点',exact:true}).selectOption('eye-l');
 const select=(id:string)=>page.locator(`[data-testid="assembly-drawing-layer"][data-id="${id}"]`).getByTestId('assembly-drawing-layer-select');
 await select(outer.id).click();await select(inner.id).click({modifiers:['Shift']});
 await expect(page.getByTestId('assembly-bind')).toContainText('2 个图层');await page.getByTestId('assembly-bind').click();
 await expect(page.getByTestId('assembly-attached-layer')).toHaveCount(2);
 let a=(await project(page)).assembly;expect(a.bindings.map((b:any)=>b.locatorId)).toEqual(['eye-l','eye-l']);expect(a.drawing).toEqual(original.assembly.drawing);
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');await expect(page.getByTestId('assembly-attached-layer')).toHaveCount(0);
 await page.keyboard.press('Control+Shift+z');await expect(page.getByTestId('assembly-attached-layer')).toHaveCount(2);
 await value(page,'左右转头 Yaw','40');await value(page,'俯仰 Pitch','10');
 const movement=await page.evaluate(async([outer,inner])=>{const url='/src/domain/assembly/model.ts',m=await import(url),a=(window as any).__editorPerfStore.getState().project.assembly;return [m.layerTransform(a,outer),m.layerTransform(a,inner)];},[outer.id,inner.id]);
 expect(movement[0]).toEqual(movement[1]);expect(movement[0].scale).not.toBe(1);
 await page.getByTestId('assembly-attachments').getByRole('button',{name:outer.name,exact:true}).click();await value(page,'图层偏移 X','0.12');
 // Re-attaching a multi-selection keeps existing calibration and per-layer offsets.
 const bindings=(await project(page)).assembly.bindings;
 await select(outer.id).click();await select(inner.id).click({modifiers:['Control']});await page.getByTestId('assembly-bind').click();expect((await project(page)).assembly.bindings).toEqual(bindings);
 await page.getByRole('button',{name:`解除挂接 ${outer.name}`,exact:true}).click();
 await expect(page.getByTestId('assembly-attached-layer')).toHaveCount(1);a=(await project(page)).assembly;
 expect(a.bindings).toEqual([bindings.find((b:any)=>b.layerId===inner.id)]);expect(a.drawing.layers).toEqual(original.assembly.drawing.layers);
 expect((await project(page)).drawing).toEqual(original.drawing);expect(errors).toEqual([]);
});
test('named reference slots save, restore while locked, overwrite, undo and persist independently of rig and artwork',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);await importFace(page);
 const original=await project(page),ref0=original.assembly.drawing.reference;
 await page.locator('.assembly-drawing-reference-panel .drawing-disclosure-toggle').click();
 await page.locator('.assembly-drawing-reference-row>button').first().click();
 const slots=page.getByTestId('assembly-reference-slots');await expect(slots).toBeVisible();
 const slot=(i:number)=>page.locator(`[data-testid="assembly-reference-slot"][data-slot="${i}"]`);
 const rename=async(name:string)=>{await page.getByRole('textbox',{name:'Slot 名称',exact:true}).fill(name);await page.getByRole('textbox',{name:'Slot 名称',exact:true}).press('Enter');};
 const number=async(name:string,n:number)=>{const input=page.getByRole('spinbutton',{name,exact:true});await input.fill(String(n));await input.press('Enter');};
 await expect(page.getByTestId('assembly-reference-slot')).toHaveCount(9);
 await slot(0).click();await rename('正面');
 await number('参考图 X',1.2);await number('参考图 Y',-.8);await number('图片缩放 %',350);
 await slot(1).click();await rename('微侧');
 // Give the new slot grid enough room for visual inspection of long labels and actions.
 const sidebar=(await page.locator('.assembly-drawing-sidebar').boundingBox())!,divider=(await page.getByRole('separator',{name:'调整图层与属性高度',exact:true}).boundingBox())!;
 await page.mouse.move(divider.x+divider.width/2,divider.y+3);await page.mouse.down();await page.mouse.move(divider.x+divider.width/2,sidebar.y+sidebar.height*.2,{steps:5});await page.mouse.up();
 await slots.scrollIntoViewIfNeeded();await page.locator('.assembly-drawing-properties').screenshot({path:'artifacts/assembly/reference-slots.png'});
 const saved=(await project(page)).assembly.drawing.reference;expect(saved.states).toHaveLength(2);
 await page.getByRole('button',{name:'锁定参考图',exact:true}).click();await slot(0).click();
 let r=(await project(page)).assembly.drawing.reference;expect(r.offset).toEqual(ref0.offset);expect(r.scale).toBe(ref0.scale);expect(r.locked).toBe(true);
 await slot(1).click();r=(await project(page)).assembly.drawing.reference;expect(r.offset).toEqual([1.2,-.8]);expect(r.scale).toBe(3.5);
 // Undo restores the previous image transform and slot indicator in one step.
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');await expect(slot(0)).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('Control+Shift+z');await expect(slot(1)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'锁定参考图',exact:true}).click();await number('参考图 X',2.3);
 await expect(slots).toContainText('已调整背景，尚未更新此状态');await page.getByRole('button',{name:'用当前位置覆盖此 Slot',exact:true}).click();
 await slot(0).click();await slot(1).click();expect((await project(page)).assembly.drawing.reference.offset).toEqual([2.3,-.8]);
 await page.getByRole('button',{name:'保存为新 Slot',exact:true}).click();await rename('备用');
 await expect(slot(2)).toHaveAttribute('data-filled','true');await page.getByRole('button',{name:'清空此 Slot',exact:true}).click();await expect(slot(2)).toHaveAttribute('data-filled','false');
 const current=await project(page);expect(current.assembly.pose).toEqual(original.assembly.pose);expect(current.assembly.bindings).toEqual(original.assembly.bindings);
 const {reference,...art}=current.assembly.drawing,{reference:ignored,...originalArt}=original.assembly.drawing;expect(art).toEqual(originalArt);expect(current.drawing).toEqual(original.drawing);
 await page.locator('.app-menu-bar .auto-hide-trigger').hover();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await downloadPromise).path();
 await page.locator('header input[type=file]').setInputFiles(path!);expect((await project(page)).assembly.drawing.reference).toEqual(reference);
 expect(errors).toEqual([]);
});
test('yaw trajectory preview, side shortcuts, angle slots and persistent sidebar collapse prepare recording without authoring keys',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);await importFace(page);
 const initial=(await project(page)).assembly,canvas=page.getByTestId('assembly-drawing-canvas'),inspection=page.getByTestId('assembly-3d');
 await expect(canvas.getByTestId('assembly-yaw-trajectory')).toHaveCount(0);
 await page.getByRole('combobox',{name:'轨迹显示',exact:true}).selectOption('all');
 await expect(canvas.getByTestId('assembly-yaw-trajectory')).toHaveCount(initial.locators.length);await expect(inspection.getByTestId('assembly-yaw-trajectory')).toHaveCount(initial.locators.length);
 const orbit=canvas.getByTestId('assembly-yaw-trajectory').first(),front=await orbit.getAttribute('d');await expect(orbit).toHaveAttribute('pointer-events','none');
 await page.locator('[data-testid="assembly-view-shortcut"][data-yaw="90"]').click();expect((await project(page)).assembly.pose).toMatchObject({yaw:90,pitch:0,roll:0});expect(await orbit.getAttribute('d')).toBe(front);
 await page.locator('[data-testid="assembly-view-shortcut"][data-yaw="-90"]').click();expect((await project(page)).assembly.pose.yaw).toBe(-90);
 await page.getByRole('button',{name:'回到正脸',exact:true}).click();
 await value(page,'左右转头 Yaw','45');await value(page,'俯仰 Pitch','20');await value(page,'歪头 Roll','10');expect(await orbit.getAttribute('d')).not.toBe(front);
 const slots=page.getByTestId('assembly-view-slots');await slots.locator('summary').click();await slots.locator('[data-slot="0"]').click();
 await page.getByRole('textbox',{name:'视角 Slot 名称',exact:true}).fill('微侧俯视');await page.getByRole('textbox',{name:'视角 Slot 名称',exact:true}).press('Enter');
 await page.getByRole('button',{name:'回到正脸',exact:true}).click();await page.getByTestId('assembly-base-edit').click();await value(page,'点 X · 平面左右','0.25');await page.getByTestId('assembly-base-edit').click();
 await slots.locator('[data-slot="0"]').click();let a=(await project(page)).assembly;expect(a.pose).toMatchObject({yaw:45,pitch:20,roll:10});expect(a.locators[0].x).toBe(.25);expect(a.frames).toEqual(initial.frames);
 await canvas.focus();await page.keyboard.press('Control+z');expect((await project(page)).assembly.pose.yaw).toBe(0);await page.keyboard.press('Control+Shift+z');
 await page.getByRole('combobox',{name:'轨迹显示',exact:true}).selectOption('selected');await expect(canvas.getByTestId('assembly-yaw-trajectory')).toHaveCount(1);
 await page.getByRole('combobox',{name:'语义定位点',exact:true}).selectOption('eye-l');await expect(canvas.getByTestId('assembly-yaw-trajectory')).toHaveAttribute('data-id','eye-l');
 await page.getByRole('combobox',{name:'轨迹显示',exact:true}).selectOption('off');await expect(canvas.getByTestId('assembly-yaw-trajectory')).toHaveCount(0);
 await page.getByRole('combobox',{name:'轨迹显示',exact:true}).selectOption('selected');
 // Side collapse stays available while the top options are hidden, preserves list state and gives space to the canvas.
 const edge=page.getByTestId('assembly-drawing-sidebar-edge'),sidebar=page.locator('.assembly-drawing-sidebar'),w=(await canvas.boundingBox())!.width;
 await page.evaluate(()=>{(window as any).__sidebarNode=document.querySelector('.assembly-drawing-sidebar');});
 await edge.click();await expect(sidebar).toBeHidden();expect((await canvas.boundingBox())!.width).toBeGreaterThan(w+100);await expect(edge).toBeVisible();
 await page.locator('.assembly-controls').evaluate(e=>e.scrollTop=0);await page.screenshot({path:'artifacts/assembly/trajectory-preparation.png'});
 await edge.click();await expect(sidebar).toBeVisible();expect(await page.evaluate(()=>document.querySelector('.assembly-drawing-sidebar')===(window as any).__sidebarNode)).toBe(true);
 a=(await project(page)).assembly;expect(a.drawing).toEqual(initial.drawing);expect(a.bindings).toEqual(initial.bindings);expect(a.planes).toEqual(initial.planes);
 const saved=await project(page);await page.locator('.app-menu-bar .auto-hide-trigger').hover();const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await download).path();
 await page.locator('header input[type=file]').setInputFiles(path!);expect((await project(page)).assembly.viewSlots).toEqual(saved.assembly.viewSlots);expect(errors).toEqual([]);
});
