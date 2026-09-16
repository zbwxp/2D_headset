import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');await page.evaluate(async()=>{const {createLandmarkProject}=await import('/src/domain/landmarks/presets.ts' as string),{migrateHeadFrame}=await import('/src/domain/head/frame.ts' as string);const p=migrateHeadFrame(createLandmarkProject());Object.assign(p,{landmarks:[],curves:[],patches:[],centerlineOrder:[],loomisRegions:[]});(window as any).__editorPerfStore.getState().load(p);});await page.getByText('Loomis Set',{exact:true}).click();});
test('side preset, local Section and point inspectors, host jump, pair rename',async({page})=>{
 await page.getByRole('button',{name:'+ 侧面剖面对',exact:true}).click();
 const state=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {curves:s.project.curves,past:s.past.length};});expect(state.curves).toHaveLength(2);expect(state.curves[0].section.planeNormal[0]).toBeCloseTo(1,12);
 const card=page.locator('[data-loomis-card]').filter({has:page.getByTestId('section-inspector')});await expect(card.getByRole('slider',{name:'Section Offset',exact:true})).toBeVisible();await expect(card.getByRole('slider',{name:'Section Tilt Y',exact:true})).not.toBeVisible();
 await card.getByRole('button',{name:'+ 添加在线定位点'}).click();
 const point=page.locator('[data-loomis-card]').filter({has:page.getByTestId('on-curve-inspector')});await expect(point.getByRole('slider',{name:'在线位置'})).toBeVisible();await point.getByRole('button',{name:'Rename',exact:true}).click();await point.getByRole('textbox',{name:'语义点名称'}).fill('测试在线点');await point.getByRole('textbox',{name:'语义点名称'}).press('Enter');
 await point.getByRole('button',{name:'跳转宿主 Section'}).click();await expect(card.getByRole('slider',{name:'Section Offset',exact:true})).toBeVisible();await expect(page.getByTestId('on-curve-inspector')).toHaveCount(0);
});
test('continuous surface creation and local controls remain in viewport',async({page})=>{
 await page.setViewportSize({width:1422,height:757});
 await page.getByRole('button',{name:'+ 球面定位点',exact:true}).click();const canvas=page.getByTestId('point-inspect').locator('canvas'),box=(await canvas.boundingBox())!;
 for(let i=0;i<4;i++)await page.mouse.click(box.x+box.width/2+5*i,box.y+box.height/2);
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.length)).toBe(8);
 await expect(page.getByRole('button',{name:'结束球面取点'})).toBeVisible();await page.keyboard.press('Escape');
 const card=page.locator('[data-loomis-card]').filter({has:page.getByTestId('surface-point-inspector')});await expect(card.getByRole('button',{name:'Rename',exact:true})).toBeVisible();
 await expect.poll(async()=>{const b=await card.boundingBox(),scroll=await page.locator('.loomis-object-scroll').boundingBox();return !!b&&!!scroll&&b.y>=scroll.y-2&&b.y+b.height<=scroll.y+scroll.height+2;}).toBe(true);
});
test('Region multiselect uses Section rows, selection, rename history and source jump',async({page})=>{
 await page.getByRole('button',{name:'+ 中线剖面',exact:true}).click();await page.getByRole('button',{name:'+ 球面区域',exact:true}).click();
 const sections=page.getByRole('region',{name:'SECTIONS'}); // DOM section has an accessible name.
 await expect(sections.getByRole('checkbox',{name:'Loomis 中线剖面',exact:true})).toHaveCount(1);await sections.getByRole('checkbox',{name:'Loomis 中线剖面',exact:true}).check();await page.getByRole('button',{name:'预览区域',exact:true}).click();
 const box=(await page.getByTestId('point-inspect').locator('canvas').boundingBox())!;await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 const card=page.locator('[data-region-id]');await expect(card.locator('[aria-pressed=true]')).toHaveCount(1);await expect(sections.getByRole('checkbox')).toHaveCount(0);
 await card.getByRole('button',{name:'Rename',exact:true}).click();await card.getByRole('textbox').fill('颅顶区域');await card.getByRole('textbox').press('Enter');
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisRegions.every((r:any)=>r.name==='颅顶区域'))).toBe(true);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisRegions.some((r:any)=>r.name==='颅顶区域'))).toBe(false);
 await card.locator('[role=button]').click();await card.getByRole('button',{name:'Loomis 中线剖面 →',exact:true}).click();await expect(page.getByText('解析闭合中线剖面 · 固定于 Loomis 对称平面',{exact:true})).toBeVisible();
});
