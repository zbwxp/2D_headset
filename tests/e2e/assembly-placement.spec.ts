import {test,expect,type Page} from '@playwright/test';
const project=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project);
const resolved=(p:Page)=>p.evaluate(async()=>{const url='/src/domain/assembly/placement.ts';return (await import(url)).resolvePlacement((window as any).__editorPerfStore.getState().project.assembly);});
const eyeX=async(p:Page)=>(await resolved(p)).locators.find((l:any)=>l.id==='eye-l').x;
async function enter(page:Page,face=true){await page.goto('/');await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await page.getByTestId('assembly-3d').hover();if(face){await page.getByTestId('assembly-import').click();await page.getByRole('button',{name:'载入副本',exact:true}).click();}await page.getByRole('combobox',{name:'语义定位点',exact:true}).selectOption('eye-l');}
async function value(page:Page,label:string,n:string){const s=page.locator('.assembly-controls .numeric-slider').filter({has:page.getByRole('slider',{name:label,exact:true})});await s.locator('.numeric-slider-value').dblclick();const i=s.locator('.numeric-slider-entry');await i.fill(n);await i.press('Enter');}
async function manage(page:Page){const d=page.locator('.assembly-pose-details details').filter({has:page.locator('summary').filter({hasText:'姿态管理'})});if(!await d.evaluate(e=>e.hasAttribute('open')))await d.locator('summary').click();}
const save=async(p:Page)=>p.getByTestId('assembly-pose-save').click();

test('unified pose recording interpolates locators, planes and layer offsets with angle drafts and Undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);const original=await project(page),layer=original.assembly.drawing.layers.find((l:any)=>l.name==='左眼内结构');
 await page.getByRole('combobox',{name:'挂接图层',exact:true}).selectOption(layer.id);await page.getByTestId('assembly-bind').click();await save(page);
 await value(page,'左右转头 Yaw','60');await value(page,'点 X · 平面左右','0.2');await value(page,'平面轴向高度','0.75');await value(page,'图层偏移 X','0.1');await save(page);
 await value(page,'左右转头 Yaw','30');expect(await eyeX(page)).toBeCloseTo(-.1);let f=await resolved(page);expect(f.planes.find((p:any)=>p.id==='eyes').height).toBeCloseTo(.55);expect(f.bindings.find((b:any)=>b.layerId===layer.id).offset[0]).toBeCloseTo(.05);
 await value(page,'点 X · 平面左右','0.7');await value(page,'左右转头 Yaw','0');expect(await eyeX(page)).toBe(-.4);await value(page,'左右转头 Yaw','30');expect(await eyeX(page)).toBe(.7);
 await page.getByTestId('assembly-pose-discard').click();expect(await eyeX(page)).toBeCloseTo(-.1);await page.getByTestId('assembly-drawing-canvas').focus();await page.keyboard.press('Control+z');expect(await eyeX(page)).toBe(.7);await page.keyboard.press('Control+Shift+z');expect(await eyeX(page)).toBeCloseTo(-.1);
 await page.getByTestId('assembly-base-edit').click();expect(await eyeX(page)).toBe(-.4);await page.getByTestId('assembly-base-edit').click();expect(await eyeX(page)).toBeCloseTo(-.1);
 expect((await project(page)).assembly.drawing).toEqual(original.assembly.drawing);expect((await project(page)).drawing).toEqual(original.drawing);expect(errors).toEqual([]);
});
test('non-front base, seam, shared loop and pitch interpolation use the same pose controls',async({page})=>{
 await enter(page,false);await value(page,'左右转头 Yaw','170');await page.locator('.assembly-pose-details summary').filter({hasText:'原稿基准角度'}).click();await page.getByTestId('assembly-set-base-angle').click();
 await value(page,'左右转头 Yaw','-170');await value(page,'点 X · 平面左右','0.4');await save(page);await value(page,'左右转头 Yaw','180');expect(await eyeX(page)).toBeCloseTo(0);
 await value(page,'左右转头 Yaw','-180');expect(await eyeX(page)).toBeCloseTo(0);await manage(page);await page.getByTestId('assembly-pose-loop').check();await value(page,'左右转头 Yaw','0');expect(await eyeX(page)).toBeCloseTo(0);
 await value(page,'俯仰 Pitch','30');await value(page,'点 X · 平面左右','0.8');await save(page);await value(page,'俯仰 Pitch','15');expect(await eyeX(page)).toBeCloseTo(.4);await value(page,'歪头 Roll','25');expect(await eyeX(page)).toBeCloseTo(.4);
 await page.getByTestId('assembly-pose-select').selectOption('0:30');await manage(page);await page.getByTestId('assembly-pose-delete').click();expect((await project(page)).assembly.placement.keys).toHaveLength(2);
});
test('selected trajectory keeps its saved angle row during top-view inspection and marks only corresponding keys',async({page})=>{
 await enter(page,false);for(const [yaw,z] of [[0,.38],[-21.531,.67],[-42.217,.54],[-57.545,.56]]){await value(page,'左右转头 Yaw',String(yaw));await value(page,'点 Z · 平面前后',String(z));await save(page);}
 await manage(page);await page.getByTestId('assembly-pose-loop').check();await page.getByRole('combobox',{name:'检查定位点',exact:true}).selectOption('eye-l');
 const inspection=page.getByTestId('assembly-3d');await expect(inspection.getByTestId('assembly-trajectory-key')).toHaveCount(4);expect(await inspection.getByTestId('assembly-trajectory-angle').allTextContents()).toEqual(['-57.5°','-42.2°','-21.5°','0°']);
 const keys=(await project(page)).assembly.placement.keys,old=await inspection.getByTestId('assembly-yaw-trajectory').getAttribute('d');await value(page,'俯仰 Pitch','70');await expect(inspection.getByTestId('assembly-trajectory-key')).toHaveCount(4);expect(await inspection.getByTestId('assembly-yaw-trajectory').getAttribute('d')).not.toBe(old);expect((await project(page)).assembly.placement.keys).toEqual(keys);
 await page.getByRole('combobox',{name:'轨迹范围',exact:true}).selectOption('full');expect((await inspection.getByTestId('assembly-yaw-trajectory').getAttribute('d'))!.endsWith('Z')).toBe(true);
 await page.getByRole('combobox',{name:'轨迹显示',exact:true}).selectOption('off');await expect(inspection.getByTestId('assembly-yaw-trajectory')).toHaveCount(0);
});
