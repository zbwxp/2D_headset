import {test,expect,type Page} from '@playwright/test';
const project=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project);
const effective=(p:Page)=>p.evaluate(async()=>{const path='/src/domain/assembly/deformRecording.ts';return (await import(path)).resolvedPerspectives((window as any).__editorPerfStore.getState().project.assembly);});
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await page.getByTestId('assembly-3d').hover();await page.getByTestId('assembly-import').click();await page.getByRole('button',{name:'载入副本',exact:true}).click();}
async function value(page:Page,label:string,n:string){const s=page.locator('.assembly-controls .numeric-slider').filter({has:page.getByRole('slider',{name:label,exact:true})});await s.locator('.numeric-slider-value').dblclick();const i=s.locator('.numeric-slider-entry');await i.fill(n);await i.press('Enter');}
async function select(page:Page,id:string){await page.locator(`[data-testid="assembly-drawing-layer"][data-id="${id}"]`).getByTestId('assembly-drawing-layer-select').click();}
async function corner(page:Page,index:number,dx:number,dy:number){const p=(await page.locator(`[data-testid="assembly-perspective-corner"][data-corner="${index}"]`).boundingBox())!;await page.mouse.move(p.x+p.width/2,p.y+p.height/2);await page.mouse.down();await page.mouse.move(p.x+p.width/2+dx,p.y+p.height/2+dy,{steps:8});await page.mouse.up();}

test('record corner deformation over yaw independently of locator recording and preserve angle drafts through undo and JSON',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 const original=await project(page),layer=original.assembly.drawing.layers.find((l:any)=>l.name==='左眼睑');await select(page,layer.id);
 await page.getByRole('combobox',{name:'语义定位点',exact:true}).selectOption('eye-l');await page.getByTestId('assembly-bind').click();await page.getByTestId('assembly-pose-save').click();
 await value(page,'左右转头 Yaw','-60');await value(page,'点 X · 平面左右','-0.2');await page.getByTestId('assembly-pose-save').click();
 const before=(await project(page)).assembly;await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await corner(page,2,32,-18);await page.getByTestId('assembly-pose-save').click();
 let a=(await project(page)).assembly;expect(a.deformRecording.tracks[0].keys.map((k:any)=>k.yaw)).toEqual([0,-60]);const side=(await effective(page))[0].quad;
 await value(page,'左右转头 Yaw','0');expect((await effective(page))[0].quad).toEqual([[0,0],[1,0],[1,1],[0,1]]);
 const card=page.locator(`[data-testid="assembly-card-layer"][data-id="${layer.id}"]`);const frontMatrix=await card.locator('[data-testid="assembly-drawing-ink"]').first().getAttribute('d');
 await value(page,'左右转头 Yaw','-30');await expect(page.getByTestId('assembly-pose-status')).toHaveText('插值预览');const mid=(await effective(page))[0].quad;
 expect(mid).not.toEqual(side);expect(await card.locator('[data-testid="assembly-drawing-ink"]').first().getAttribute('d')).not.toEqual(frontMatrix);
 await corner(page,3,-14,-11);const draft=(await effective(page))[0].quad;await expect(page.getByTestId('assembly-pose-status')).toHaveText('有未保存修改');
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');expect((await effective(page))[0].quad).toEqual(mid);await page.keyboard.press('Control+Shift+z');expect((await effective(page))[0].quad).toEqual(draft);
 await value(page,'左右转头 Yaw','0');await value(page,'左右转头 Yaw','-30');expect((await effective(page))[0].quad).toEqual(draft);
 await page.locator('.app-menu-bar .auto-hide-trigger').hover();const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await download).path();await page.locator('header input[type=file]').setInputFiles(path!);await page.getByTestId('assembly-drawing-canvas').hover();
 expect((await effective(page))[0].quad).toEqual(draft);await page.getByTestId('assembly-pose-discard').click();expect((await effective(page))[0].quad).toEqual(mid);
 a=(await project(page)).assembly;expect(a.drawing).toEqual(before.drawing);expect(a.placement).toEqual(before.placement);expect((await project(page)).drawing).toEqual(original.drawing);
 await page.getByTestId('assembly-3d').hover();await page.screenshot({path:'artifacts/assembly/deform-recording.png'});expect(errors).toEqual([]);
});

test('layer tracks are separate, copied deformation can be recorded for another layer, loop and pitch controls update preview',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 const original=await project(page),layers=original.assembly.drawing.layers,left=layers.find((l:any)=>l.name==='左眼睑'),right=layers.find((l:any)=>l.name==='右眼睑');
 await select(page,left.id);await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await page.getByTestId('assembly-pose-save').click();
 await value(page,'左右转头 Yaw','-60');await corner(page,2,30,-18);await page.getByTestId('assembly-pose-save').click();
 const track=(await project(page)).assembly.deformRecording.tracks[0];await page.getByTestId('assembly-perspective-copy').click();await select(page,right.id);await page.getByTestId('assembly-perspective-paste').click();await page.getByTestId('assembly-pose-save').click();
 let a=(await project(page)).assembly;expect(a.deformRecording.tracks).toHaveLength(2);expect(a.deformRecording.tracks[0]).toEqual(track);expect(a.deformRecording.tracks[1].keys[1].quad).toEqual(track.keys[1].quad);
 await value(page,'俯仰 Pitch','30');await corner(page,3,10,12);await page.getByTestId('assembly-pose-save').click();await value(page,'俯仰 Pitch','15');await expect(page.getByTestId('assembly-pose-status')).toHaveText('插值预览');
 await value(page,'俯仰 Pitch','0');await value(page,'左右转头 Yaw','90');await page.locator('.assembly-pose-details summary').filter({hasText:'姿态管理'}).click();await page.getByTestId('assembly-pose-loop').check();
 await page.getByTestId('assembly-stage-placement').click();await expect(page.getByTestId('assembly-card-preview')).toBeVisible();await page.getByTestId('assembly-stage-bend').click();
 await page.getByTestId('assembly-pose-select').selectOption('-60:30');await page.getByRole('button',{name:'删除区域变形 · '+right.name,exact:true}).click();expect((await project(page)).assembly.deformRecording.tracks[1].keys).toHaveLength(2);
 expect((await project(page)).assembly.drawing).toEqual(original.assembly.drawing);expect(errors).toEqual([]);
});
