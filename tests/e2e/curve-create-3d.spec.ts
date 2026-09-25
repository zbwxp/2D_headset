import {PerspectiveCamera,Vector3} from 'three';
import {test,expect,type Page} from '@playwright/test';
async function pointXY(page:Page,id:string,view:'2d'|'3d'){
 if(view==='3d'){
  const data=await page.evaluate(async id=>{const s=(window as any).__editorPerfStore.getState(),{pointPosition}=await import('/src/domain/geometry/evaluation.ts'),{useInspectionCamera}=await import(performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/src/ui/windows/state.ts'))??'/src/ui/windows/state.ts'),r=document.querySelector('[data-testid=point-inspect] canvas')!.getBoundingClientRect();return {p:pointPosition(s.project,id),pose:useInspectionCamera.getState(),r:{x:r.x,y:r.y,width:r.width,height:r.height}};},id);
  const {p,pose,r}=data,c=new PerspectiveCamera(pose.fov,r.width/r.height,.1,100);c.position.fromArray(pose.position);c.quaternion.fromArray(pose.quaternion);c.updateMatrixWorld();const q=new Vector3(...p).project(c);return {x:r.x+(q.x+1)*r.width/2,y:r.y+(1-q.y)*r.height/2};
 }
 return page.evaluate(async id=>{const s=(window as any).__editorPerfStore.getState(),{pointPosition}=await import('/src/domain/geometry/evaluation.ts'),{worldToScreen,orthographicView}=await import('/src/rendering/orthographic.ts'),r=document.querySelector('[data-testid=point-editor]')!.getBoundingClientRect(),v=s.project.views.find((v:any)=>v.id===s.viewId),xy=worldToScreen(pointPosition(s.project,id),orthographicView(v.camera,v.canvas,r.width,r.height));return {x:r.x+xy[0],y:r.y+xy[1]};},id);
}
test('create FREE curve in 3D and across 2D/3D; drag orbits, undo and cancel remain safe',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 const ids=await page.evaluate(async()=>{const {createLandmarkProject}=await import('/src/domain/landmarks/presets.ts');const p=createLandmarkProject(),s=(window as any).__editorPerfStore.getState();s.load({...p,curves:[],patches:[]});s.selectView('front');return ['下巴尖点','右外眼角点'].map(name=>p.landmarks.find((l:any)=>l.name===name)!.id);});
 const count=()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.curves.length);
 const before=await count();
 await page.locator('.creation-shelf summary').filter({hasText:'曲线'}).click();await page.getByRole('button',{name:'自由曲线',exact:true}).click();
 const a=await pointXY(page,ids[0],'3d');await page.mouse.move(a.x,a.y);await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-hover-point',ids[0]);
 await page.mouse.down();await page.mouse.move(a.x+45,a.y+20,{steps:6});await page.mouse.up();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().curveCreation.startId)).toBeNull();
 for(const id of ids){let q={x:0,y:0};await expect(async()=>{q=await pointXY(page,id,'3d');await page.mouse.move(q.x,q.y);await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-hover-point',id,{timeout:200});}).toPass({timeout:4000});await page.mouse.click(q.x,q.y);}
 await expect.poll(count).toBe(before+2);
 const created=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.curves.find((c:any)=>c.id===s.selectedCurveId);});expect([created.startLandmarkId,created.endLandmarkId]).toEqual(ids);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await count()).toBe(before);await page.getByRole('button',{name:'重做',exact:true}).click();expect(await count()).toBe(before+2);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().startCurve());const q=await pointXY(page,ids[0],'2d');await page.mouse.click(q.x,q.y);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().curveCreation.startId)).toBe(ids[0]);const end=await pointXY(page,ids[1],'3d');await page.mouse.click(end.x,end.y);await expect.poll(count).toBe(before+4);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().startCurve());const start=await pointXY(page,ids[1],'3d');await page.mouse.click(start.x,start.y);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().curveCreation.startId)).toBe(ids[1]);const last=await pointXY(page,ids[0],'2d');await page.mouse.click(last.x,last.y);await expect.poll(count).toBe(before+6);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().startCurve());const cancel=await pointXY(page,ids[0],'3d');await page.mouse.click(cancel.x,cancel.y);await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().tool.kind)).toBe('select');expect(await count()).toBe(before+6);expect(errors).toEqual([]);
});
