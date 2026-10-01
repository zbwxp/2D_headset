import {test,expect,type Page} from '@playwright/test';
const effective=(p:Page)=>p.evaluate(async()=>{const url='/src/domain/assembly/deformRecording.ts';return (await import(url)).resolvedPerspectives((window as any).__editorPerfStore.getState().project.assembly);});
const project=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project);
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await page.getByTestId('assembly-3d').hover();await page.getByTestId('assembly-import').click();await page.getByRole('button',{name:'载入副本',exact:true}).click();}
async function select(page:Page,id:string){await page.locator(`[data-testid="assembly-drawing-layer"][data-id="${id}"]`).getByTestId('assembly-drawing-layer-select').click();}
async function corner(page:Page,index:number,dx:number,dy:number,finish=true){const p=(await page.locator(`[data-testid="assembly-perspective-corner"][data-corner="${index}"]`).boundingBox())!;await page.mouse.move(p.x+p.width/2,p.y+p.height/2);await page.mouse.down();await page.mouse.move(p.x+p.width/2+dx,p.y+p.height/2+dy,{steps:7});if(finish)await page.mouse.up();}
async function saveSnapshot(page:Page,name:string){await page.locator('.assembly-drawing-context-bar').hover();if(!await page.locator('.assembly-legacy-snapshots').evaluate(e=>e.hasAttribute('open')))await page.locator('.assembly-legacy-snapshots summary').click();await page.getByRole('button',{name:'保存为新快照',exact:true}).click();await page.getByRole('textbox',{name:'快照名称',exact:true}).fill(name);await page.getByRole('button',{name:'保存',exact:true}).click();}
async function value(page:Page,label:string,n:string){const s=page.locator('.assembly-controls .numeric-slider').filter({has:page.getByRole('slider',{name:label,exact:true})});await s.locator('.numeric-slider-value').dblclick();const i=s.locator('.numeric-slider-entry');await i.fill(n);await i.press('Enter');}

test('layer perspective keeps source vectors, supports repeated corner editing, Undo, cancellation, toggle and reuse',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 const before=await project(page),a=before.assembly,layer=a.drawing.layers.find((l:any)=>l.name==='左眼睑'),other=a.drawing.layers.find((l:any)=>l.name==='右眼睑');
 await select(page,layer.id);await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await expect(page.getByTestId('assembly-perspective-corner')).toHaveCount(4);
 const start=(await effective(page))[0];await corner(page,2,40,-28);const first=(await effective(page))[0];
 expect(first.quad[2]).not.toEqual(start.quad[2]);expect((await project(page)).assembly.drawing).toEqual(a.drawing);
 await corner(page,3,17,14);const second=(await effective(page))[0];expect(second.quad[2]).toEqual(first.quad[2]);expect(second.quad[3]).not.toEqual(first.quad[3]);
 await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');expect((await effective(page))[0]).toEqual(first);
 await page.keyboard.press('Control+Shift+z');expect((await effective(page))[0]).toEqual(second);
 await corner(page,1,25,10,false);await page.keyboard.press('Escape');await page.mouse.up();expect((await effective(page))[0]).toEqual(second);
 // Crossing corners must keep the last valid quad, not discard the complete drag.
 await corner(page,2,-230,130);const valid=(await effective(page))[0];expect(valid).toBeTruthy();
 await page.keyboard.press('Control+z');expect((await effective(page))[0]).toEqual(second);
 await page.getByTestId('assembly-perspective-enabled').uncheck();expect((await effective(page))[0].enabled).toBe(false);
 await page.getByTestId('assembly-perspective-enabled').check();await expect(page.getByTestId('assembly-card-preview')).toBeVisible();
 await page.getByTestId('assembly-perspective-copy').click();await select(page,other.id);await page.getByTestId('assembly-perspective-paste').click();
 const applied=(await effective(page)).find((p:any)=>p.layerId===other.id);expect(applied.quad).toEqual(second.quad);expect(applied.source).not.toEqual(second.source);
 await page.getByTestId('assembly-base-edit').click();await expect(page.getByTestId('assembly-card-preview')).toHaveCount(0);expect((await project(page)).assembly.perspectives).toHaveLength(2);
 await page.getByTestId('assembly-base-edit').click();await expect(page.getByTestId('assembly-card-preview')).toBeVisible();
 await page.getByTestId('assembly-perspective-reset').click();expect((await effective(page)).find((p:any)=>p.layerId===other.id).quad).toEqual([[0,0],[1,0],[1,1],[0,1]]);
 expect((await project(page)).assembly.drawing).toEqual(a.drawing);expect((await project(page)).drawing).toEqual(before.drawing);expect(errors).toEqual([]);
});

test('persistent perspective snapshots restore, project reloads, and browser composition matches the 3D card',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 const before=await project(page),layer=before.assembly.drawing.layers.find((l:any)=>l.name==='左眼内结构');
 await select(page,layer.id);await page.getByRole('combobox',{name:'语义定位点',exact:true}).selectOption('eye-l');await page.getByTestId('assembly-bind').click();
 await saveSnapshot(page,'Original');const front=(await project(page)).assembly.drawingSnapshots.activeId;
 await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await page.getByTestId('assembly-3d').hover();await corner(page,2,34,-21);await corner(page,0,-10,15);
 await value(page,'左右转头 Yaw','36');await value(page,'俯仰 Pitch','12');await page.locator('.assembly-controls summary').filter({hasText:'主轴位置与透视'}).click();await page.getByTestId('assembly-follow-axis').check();
 await page.getByTestId('assembly-stage-bend').click();await page.getByTestId('assembly-perspective-edit').click();await corner(page,3,12,-9);
 const card=page.locator(`[data-testid="assembly-card-layer"][data-id="${layer.id}"]`),ink=card.locator('[data-testid="assembly-drawing-ink"]').first(),oldPath=await ink.getAttribute('d');
 await value(page,'点 X · 平面左右','-0.31');expect(await ink.getAttribute('d')).not.toBe(oldPath);await value(page,'点 X · 平面左右','-0.4');
 const changed=await effective(page);
 // Perspective is now evaluated on vector centerlines, not a CSS-scaled stroke.
 expect(await card.evaluate(e=>getComputedStyle(e).transform)).toBe('none');
 expect(await card.locator('path').evaluateAll(ps=>ps.every(p=>!/NaN|Infinity/.test(p.getAttribute('d')??'')))).toBe(true);
 await page.getByTestId('assembly-3d').hover();await page.screenshot({path:'artifacts/assembly/perspective.png'});
 await saveSnapshot(page,'Perspective');const turned=(await project(page)).assembly.drawingSnapshots.activeId;
 await page.locator('.assembly-drawing-context-bar').hover();await page.getByRole('combobox',{name:'切换快照',exact:true}).selectOption(front);expect((await project(page)).assembly.perspectives.every((p:any)=>!p.enabled)).toBe(true);
 await page.getByRole('combobox',{name:'切换快照',exact:true}).selectOption(turned);expect((await project(page)).assembly.perspectives).toEqual(changed);
 await page.locator('.app-menu-bar .auto-hide-trigger').hover();const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const path=await (await download).path();await page.locator('header input[type=file]').setInputFiles(path!);
 expect((await project(page)).assembly.perspectives).toEqual(changed);await page.getByTestId('assembly-base-edit').click();await expect(page.getByTestId('assembly-card-preview')).toBeVisible();
 expect((await project(page)).assembly.drawing).toEqual(before.assembly.drawing);expect((await project(page)).drawing).toEqual(before.drawing);expect(errors).toEqual([]);
});
