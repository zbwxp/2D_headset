import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8'));
fixture.patchDisplay={visible:true,quality:'low',opacity2d:.75,opacity3d:.7};fixture.surfaceSmooth.enabled=false;
test.use({viewport:{width:1600,height:1050},deviceScaleFactor:2});
test('shared projection aligns SVG across views, resize, pan/zoom and DPR; layered renderer preserves picking',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?renderer=cpu');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'render.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 await expect(page.getByTestId('patch-layer')).toHaveCount(1);
 await expect(page.locator('.point-mini,.point-minis,.mini-preview')).toHaveCount(0);
 expect(await page.getByTestId('point-inspect').locator('canvas').count()).toBe(1);
 const check=async()=>page.evaluate(async()=>{
  const {orthographicView,worldToScreen,framebufferSize}=await import('/src/rendering/orthographic.ts' as string);
  const {pointPosition}=await import('/src/domain/geometry/evaluation.ts' as string);
  const s=(window as any).__editorPerfStore.getState(),view=s.project.views.find((v:any)=>v.id===s.viewId),svg=document.querySelector('[data-testid=point-editor]')!,rect=svg.getBoundingClientRect(),state=orthographicView(view.camera,view.canvas,rect.width,rect.height,devicePixelRatio);
  let max=0;
  for(const l of s.project.landmarks){const circle=document.querySelector(`[data-testid="landmark-${l.name}"]`)!;const actual=circle.getBoundingClientRect(),expected=worldToScreen(pointPosition(s.project,l.id),state);max=Math.max(max,Math.hypot(actual.x+actual.width/2-rect.x-expected[0],actual.y+actual.height/2-rect.y-expected[1]));}
  return {max,dpr:devicePixelRatio,framebuffer:framebufferSize(state),width:rect.width};
 });
 for(const label of ['正面','右 45°','侧面']){
  await page.getByRole('button',{name:label,exact:true}).first().click();
  for(const size of [{width:1600,height:1050},{width:1250,height:900}]){
   await page.setViewportSize(size);await expect.poll(async()=>(await check()).max).toBeLessThan(.1);
   await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.setCanvas({zoom:1.43,pan:[24,-19]});});
   await expect.poll(async()=>(await check()).max).toBeLessThan(.1);
  }
 }
 expect((await check()).dpr).toBe(2);
 const state=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project);
 const id=state.curves[0].id;await page.getByTestId(`curve-hit-${id}`).dispatchEvent('pointerdown',{button:0,clientX:600,clientY:400,pointerId:1});
 await expect(page.getByTestId(`curve-${id}`)).toHaveAttribute('opacity','1');
 expect(await page.getByTestId(`curve-${id}`).evaluate(n=>!!n.closest('[data-layer=interaction-overlay]'))).toBe(true);
 await expect(page.getByTestId('curve-handle-1')).toBeVisible();
 await page.getByTestId('point-editor').dispatchEvent('pointerup',{pointerId:1});
 await page.locator('.patch-panel .section-heading').click();
 const opacity=page.getByRole('combobox',{name:'2D Patch 不透明度',exact:true});await expect(opacity.locator('option')).toHaveText(['50%','75%','100%']);
 await opacity.selectOption('1');
 expect(await page.locator('[data-layer=curve-render] [data-depth=behind]').count()).toBeGreaterThan(0);
 await expect(page.locator('[data-layer=curve-render] [data-depth=behind]').first()).toHaveAttribute('stroke-opacity','0.25');
 await expect(page.getByTestId(`curve-${id}`)).toHaveAttribute('opacity','1');
 expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/renderer-preparation.png'});
});
