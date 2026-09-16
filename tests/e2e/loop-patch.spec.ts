import {test,expect} from '@playwright/test';
test('Loop authoring: 2D picks, preview/flip/create, Fullness, Undo/Redo and reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.waitForFunction(()=>!!(window as any).__editorPerfStore);
 const ids=await page.evaluate(async()=>{const store=(window as any).__editorPerfStore;store.getState().reset();const path='/src/domain/head/duplicateRing.ts',{duplicateRing}=await import(path);let p=store.getState().project;const ids:string[]=[];for(const d of [-.5,.2]){const r=duplicateRing(p,'05500000-0000-4000-8000-000000000002');p=r.project;ids.push(r.selectedId);p={...p,curves:p.curves.map((c:any)=>c.id===r.selectedId?{...c,section:{...c.section,planeOffset:d}}:c)};}store.getState().load(p);return ids;});
 await page.getByRole('button',{name:/曲面 Patch/}).click();await page.getByRole('button',{name:'绘制面',exact:true}).click();await page.getByRole('button',{name:'环形 Patch',exact:true}).click();
 for(const id of ids){const pt=await page.getByTestId('curve-hit-'+id).evaluate((el:SVGPathElement)=>{const p=el.getPointAtLength(el.getTotalLength()*.17),q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM()!);return {x:q.x,y:q.y};});await page.mouse.click(pt.x,pt.y);}
 await expect(page.getByRole('button',{name:'创建环形 Patch',exact:true})).toBeVisible();await expect(page.getByTestId('boundary-authoring-overlay').locator('line')).toHaveCount(8);
 await page.getByRole('button',{name:'翻转第二条环方向'}).click();await page.getByRole('button',{name:'翻转第二条环方向'}).click();
 await page.getByRole('button',{name:'创建环形 Patch',exact:true}).click();await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.map((p:any)=>p.type))).toEqual(['loop']);
 const f=page.getByRole('slider',{name:'面凸度 Fullness'});await f.press('ArrowRight');await f.blur();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches[0].fullness)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches[0].fullness)).toBe(0);
 await page.getByRole('button',{name:'重做',exact:true}).click();await page.waitForTimeout(650);await page.reload();await page.waitForFunction(()=>!!(window as any).__editorPerfStore);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches[0].type)).toBe('loop');
 await page.screenshot({path:'artifacts/loop-patch/preview.png'});expect(errors).toEqual([]);
});

test('3D and 2D pick the same loop creation state, then live Ring edit updates mesh',async({page})=>{
 const {PerspectiveCamera,Vector3}=await import('three');const {evaluationContext}=await import('../../src/domain/geometry/evaluation');const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__editorPerfStore);
 const ids=await page.evaluate(async()=>{const s=(window as any).__editorPerfStore;s.getState().reset();const path='/src/domain/head/duplicateRing.ts',{duplicateRing}=await import(path);let p=s.getState().project;const ids:string[]=[];for(const d of [-.65,.25]){const r=duplicateRing(p,'05500000-0000-4000-8000-000000000002');p=r.project;ids.push(r.selectedId);p={...p,curves:p.curves.map((c:any)=>c.id===r.selectedId?{...c,section:{...c.section,planeOffset:d}}:c)};}s.getState().load(p);return ids;});
 await page.getByRole('button',{name:/曲面 Patch/}).click();await page.getByRole('button',{name:'绘制面',exact:true}).click();await page.getByRole('button',{name:'环形 Patch',exact:true}).click();
 const p=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project),pose=await page.evaluate(async()=>{const path='/src/ui/windows/state.ts';return (await import(path)).useInspectionCamera.getState();}),box=(await page.getByTestId('point-inspect').locator('canvas').boundingBox())!;
 const camera=new PerspectiveCamera(34,box.width/box.height,.1,100);camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();const v=new Vector3(...evaluationContext(p).curve(ids[0]).evaluate(.18)).project(camera);await page.mouse.click(box.x+(v.x+1)*box.width/2,box.y+(1-v.y)*box.height/2);
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.uses.map((b:any)=>b.curveId))).toEqual([ids[0]]);
 await page.getByTestId('curve-hit-'+ids[1]).dispatchEvent('pointerdown',{button:0,pointerId:1});await page.getByRole('button',{name:'创建环形 Patch',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');
 const before=await page.getByTestId('point-inspect').locator('canvas').screenshot();
 await page.evaluate(id=>{const s=(window as any).__editorPerfStore.getState();const c=s.project.curves.find((c:any)=>c.id===id);s.setSection(id,{...c.section,planeOffset:-.3});},ids[0]);
 await page.waitForTimeout(300);expect((await page.getByTestId('point-inspect').locator('canvas').screenshot()).equals(before)).toBe(false);expect(errors).toEqual([]);
});
