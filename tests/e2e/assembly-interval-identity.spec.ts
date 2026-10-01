import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync('src/tests/fixtures/jaw-60-90-intervals.json','utf8'));
const allAngles=JSON.parse(readFileSync('src/tests/fixtures/jaw-all-angle-intervals.json','utf8'));
for(const scenario of [
 {name:'stable IDs at 60/90',track:fixture.track,angles:['-60','-60.01','-69','-69.619','-75','-89.99','-90'],stable:true,shot:'jaw-interval-identity'},
 {name:'legacy IDs at 30/45',track:allAngles,angles:['-30','-30.01','-37','-37.207','-37.499','-37.501','-44.99','-45','-69','-37.207'],stable:false,shot:'jaw-legacy-interval-identity'},
])test(`jaw has two interval rows and four grips: ${scenario.name}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__editorPerfStore);
 await page.evaluate(async(f)=>{
  const m=await import('/src/domain/assembly/model.ts' as string),tl=await import('/src/domain/assembly/timeline.ts' as string),dm=await import('/src/domain/drawing/model.ts' as string);
  let a=tl.ensureTimeline(m.createAssembly(dm.parseDrawing(f.drawing)));a={...a,pose:{...a.pose,yaw:f.yaw},timeline:{...a.timeline,loop:true,stage:'BEND',intervals:[f.track]}};(window as any).__editorPerfStore.getState().setAssembly(a);
 },{...fixture,track:scenario.track,yaw:Number(scenario.angles[0])});
 await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();await page.getByTestId('assembly-room-toggle').click();await page.getByTestId('assembly-3d').hover();
 await page.getByTestId('assembly-drawing-chain-select').click();await page.getByTestId('assembly-drawing-tool-select').click();
 const ids=fixture.track.keys[0].tracks[0].ranges.map((r:any)=>r.id);
 for(const yaw of scenario.angles){
  const slider=page.locator('.assembly-controls .numeric-slider').filter({has:page.getByRole('slider',{name:'左右转头 Yaw',exact:true})});
  await slider.locator('.numeric-slider-value').dblclick();const input=slider.locator('.numeric-slider-entry');await input.fill(yaw);await input.press('Enter');
  const rows=page.getByTestId('assembly-drawing-display-range');await expect(rows).toHaveCount(2);if(scenario.stable)expect(await rows.evaluateAll(els=>els.map(e=>e.getAttribute('data-id')))).toEqual(ids);
  await expect(page.getByTestId('assembly-drawing-display-grip')).toHaveCount(4);expect((await page.getByTestId('assembly-drawing-display-interval-overlay').locator('text').allTextContents()).sort()).toEqual(['1A','1B','2A','2B']);
 }
 const a=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.assembly);expect(a.timeline.intervals).toEqual([scenario.track]);expect(a.drawing).toEqual(fixture.drawing);expect(errors).toEqual([]);
 await page.screenshot({path:`artifacts/assembly/${scenario.shot}.png`});
});
