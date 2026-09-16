import {test,expect} from '@playwright/test';
test('full side rings, Rim selection/slider/Undo, on-curve point and reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.evaluate(()=>(window as any).__editorPerfStore.getState().reset());
 const id='05500000-0000-4000-8000-000000000007';await page.getByTestId('curve-hit-'+id).click({force:true});
 await expect(page.getByRole('button',{name:'Helmet Rim',exact:true})).toBeVisible();const slider=page.getByRole('slider',{name:'Rim Sag',exact:true}).last();await slider.press('ArrowRight');await slider.blur();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisScaffold.rimSag)).toBeGreaterThan(.2);await page.getByRole('button',{name:'撤销',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisScaffold.rimSag)).toBe(.2);await page.getByRole('button',{name:'Helmet Rim',exact:true}).click();await page.getByRole('button',{name:'+ 添加在线定位点',exact:true}).click();expect(await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.landmarks.find((l:any)=>l.id===s.selectedId).placement.hostCurveId;})).toBe(id);
 await expect(page.getByRole('slider',{name:'在线位置',exact:true})).toBeVisible();await page.waitForTimeout(650);await page.reload();await page.waitForFunction(()=>!!(window as any).__editorPerfStore);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.curves.filter((c:any)=>c.geometryType==='LOOMIS_SECTION').length)).toBe(5);expect(errors).toEqual([]);await page.screenshot({path:'artifacts/scaffold/rim.png'});
});
test('3D can pick analytic Rim without Bezier handles',async({page})=>{
 const {PerspectiveCamera,Vector3}=await import('three');const {evaluationContext}=await import('../../src/domain/geometry/evaluation');
 await page.goto('/');await page.evaluate(()=>(window as any).__editorPerfStore.getState().reset());const id='05500000-0000-4000-8000-000000000007';
 const p=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project),pose=await page.evaluate(async()=>{const path='/src/ui/windows/state.ts';return (await import(path)).useInspectionCamera.getState();});
 const box=(await page.getByTestId('point-inspect').locator('canvas').boundingBox())!;const camera=new PerspectiveCamera(34,box.width/box.height,.1,100);camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();
 const v=new Vector3(...evaluationContext(p).curve(id).evaluate(.37)).project(camera);await page.mouse.click(box.x+(v.x+1)*box.width/2,box.y+(1-v.y)*box.height/2);
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().selectedCurveId)).toBe(id);await expect(page.getByTestId('curve-handle-1')).toHaveCount(0);
});
