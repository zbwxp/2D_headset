import {test,expect} from '@playwright/test';
test('Loomis panel builds an ellipsoid region through 3D picking, undo, reload and removal',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.evaluate(async()=>{const {createLandmarkProject}=await import('/src/domain/landmarks/presets.ts' as string),{migrateHeadFrame}=await import('/src/domain/head/frame.ts' as string);const p=migrateHeadFrame(createLandmarkProject());p.landmarks=[];p.curves=[];p.patches=[];p.centerlineOrder=[];(window as any).__editorPerfStore.getState().load(p);});
 await page.getByText('Loomis Set',{exact:true}).click();
 await page.getByRole('button',{name:'+ 中线剖面',exact:true}).click();
 const panel=page.locator('.head-frame-panel');await expect(panel.getByText('解析闭合中线剖面 · 固定于 Loomis 对称平面',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'+ 球面区域',exact:true}).click();
 await panel.getByRole('checkbox',{name:'Loomis 中线剖面',exact:true}).check();await page.getByRole('button',{name:'预览区域',exact:true}).click();
 const canvas=page.getByTestId('point-inspect').locator('canvas'),box=(await canvas.boundingBox())!;
 // Click an interior point on the visible sphere, not a curve or landmark.
 const xy=await page.evaluate(async({w,h})=>{const three=await import('/node_modules/.vite/deps/three.js' as string),{useInspectionCamera}=await import('/src/ui/windows/state.ts' as string);const pose=useInspectionCamera.getState(),camera=new three.PerspectiveCamera(34,w/h,.1,100);camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();const f=(window as any).__editorPerfStore.getState().project.headFrame,v=new three.Vector3(...f.center).project(camera);return [(v.x+1)*w/2,(1-v.y)*h/2];},{w:box.width,h:box.height});
 await page.mouse.click(box.x+xy[0],box.y+xy[1]);
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisRegions?.length)).toBe(2);
 await expect(page.getByTestId('gpu-derived-renderer')).toHaveAttribute('data-surface-count','2');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisRegions?.length??0)).toBe(0);
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisRegions?.length)).toBe(2);
 await page.waitForTimeout(600);await page.reload();await page.getByText('Loomis Set',{exact:true}).click();await page.locator('[data-region-id] > [role=button]').click();await expect(page.locator('[data-region-id]').getByRole('button',{name:'Delete',exact:true})).toHaveCount(1);
 await page.screenshot({path:'artifacts/section-axes/loomis-region.png'});
 await page.locator('[data-region-id]').getByRole('button',{name:'Delete',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisRegions?.length)).toBe(0);expect(errors).toEqual([]);
});
