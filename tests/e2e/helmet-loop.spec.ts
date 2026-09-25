import {test,expect,type Page} from '@playwright/test';
import {PerspectiveCamera,Vector3} from 'three';

async function setup(page:Page){
 await page.goto('/');
 return page.evaluate(async()=>{
  const {createLandmarkProject}=await import('/src/domain/landmarks/presets.ts'),{migrateHeadFrame}=await import('/src/domain/head/frame.ts'),{ensureScaffold,HELMET_LOOP,RIM_R,RING_Y,systemId}=await import('/src/domain/head/scaffold.ts'),{duplicateRing}=await import('/src/domain/head/duplicateRing.ts'),{createCurve}=await import('/src/domain/curves/management.ts');
  const seed=migrateHeadFrame(createLandmarkProject());let p=ensureScaffold({...seed,landmarks:[],curves:[],patches:[],centerlineOrder:[]});
  const a=systemId(100),b=systemId(109),neck=systemId(103),c=createCurve(p,a,neck,p.views[0],'Front connector');p=c.project;const d=createCurve(p,neck,b,p.views[0],'Back connector');p=d.project;
  const copy=duplicateRing(p,RING_Y);p={...copy.project,curves:copy.project.curves.map((c:any)=>c.id===copy.selectedId?{...c,section:{...c.section,planeOffset:-.4}}:c)};
  const s=(window as any).__editorPerfStore.getState();s.load(p);s.setActiveModule('HEADSET');s.selectCurve(RIM_R);
  return {loop:HELMET_LOOP,a,b,front:c.selectedId,back:d.selectedId,copy:copy.selectedId};
 });
}
async function click3D(page:Page,id:string,t=.14){
 await expect(async()=>{
  const d=await page.evaluate(async({id,t})=>{const s=(window as any).__editorPerfStore.getState(),{evaluationContext}=await import('/src/domain/geometry/evaluation.ts'),{useInspectionCamera}=await import(performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/src/ui/windows/state.ts'))??'/src/ui/windows/state.ts'),r=document.querySelector('[data-testid=point-inspect] canvas')!.getBoundingClientRect();return {p:evaluationContext(s.project).curve(id).evaluate(t),pose:useInspectionCamera.getState(),r:{x:r.x,y:r.y,width:r.width,height:r.height}};},{id,t});
  const {p,pose,r}=d,c=new PerspectiveCamera(pose.fov,r.width/r.height,.1,100);c.position.fromArray(pose.position);c.quaternion.fromArray(pose.quaternion);c.updateMatrixWorld();const q=new Vector3(...p).project(c),x=r.x+(q.x+1)*r.width/2,y=r.y+(1-q.y)*r.height/2;
  await page.mouse.move(x,y);await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-hover-curve',id,{timeout:200});await page.mouse.click(x,y);
 }).toPass({timeout:5000});
}
test('Rim inspector opens one closed lower boundary; 3D whole-loop authoring, height undo, save/load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const ids=await setup(page);
 await page.getByRole('button',{name:'选择 Helmet 闭合下缘 →',exact:true}).click();
 await expect(page.getByTestId('helmet-loop-inspector')).toBeVisible();
 await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-highlighted-curve',ids.loop);
 const slider=page.getByRole('slider',{name:'水平环高度 Y',exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();await slider.locator('..').locator('.numeric-slider-entry').fill('0.12');await slider.locator('..').locator('.numeric-slider-entry').press('Enter');
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisScaffold.horizontalOffset)).toBe(.12);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.loomisScaffold.horizontalOffset)).toBe(0);
 await page.getByRole('region',{name:'曲线',exact:true}).getByRole('button').first().click();await page.getByRole('button',{name:'Helmet 闭合下缘',exact:true}).click();
 await page.getByRole('button',{name:'用整圈建立环形 Patch',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.uses)).toEqual([{kind:'closed',curveId:ids.loop}]);
 await click3D(page,ids.copy);await page.getByRole('button',{name:'创建环形面',exact:true}).click();
 const patches=()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches);
 await expect.poll(async()=>(await patches()).length).toBe(1);const created=await patches();expect(created[0].boundaryUses[0].curveId).toBe(ids.loop);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await patches()).toEqual([]);await page.getByRole('button',{name:'重做',exact:true}).click();expect(await patches()).toEqual(created);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('contour.landmarks.v039')!).patches?.length)).toBe(1);
 await page.reload();await expect.poll(patches).toEqual(created);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),ids.loop);
 await expect(page.getByTestId('helmet-loop-inspector')).toBeVisible();await page.screenshot({path:'artifacts/scaffold/helmet-boundary-loop.png'});
 await page.getByRole('button',{name:'Switch interface to English',exact:true}).click();await expect(page.getByRole('button',{name:'Create annular Patch from whole loop',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
test('cross-junction span uses existing 2D anchors and completes an ordinary mirrored Patch',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const ids=await setup(page);
 await page.getByRole('button',{name:'选择 Helmet 闭合下缘 →',exact:true}).click();await page.getByRole('button',{name:'用下缘区间建立 Patch',exact:true}).click();
 await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-patch-anchors',new RegExp(ids.b));
 for(const id of [ids.a,ids.b])await page.getByTestId('span-anchor-'+id).dispatchEvent('pointerdown',{button:0,pointerId:1});
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.uses)).toEqual([{curveId:ids.loop,startLandmarkId:ids.a,endLandmarkId:ids.b}]);
 await page.getByRole('button',{name:'整线',exact:true}).click();
 for(const id of [ids.front,ids.back])await page.getByTestId('curve-hit-'+id).dispatchEvent('pointerdown',{button:0,pointerId:1});
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.length)).toBe(2);
 expect(errors).toEqual([]);
});
