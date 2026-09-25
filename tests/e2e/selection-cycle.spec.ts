import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const saved=JSON.parse(readFileSync('src/tests/fixtures/on-patch-group-11.json','utf8'));
const hosted='fcca89a0-4f6d-4768-81f8-3387c9c6f67b',original='c5da2905-545c-4c55-98df-a215a4873aa4';
for(const view of ['2d','3d'])test(`${view}: repeated actual clicks reach both overlapping source and surface curves`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.evaluate(p=>(window as any).__editorPerfStore.getState().load(p),saved);
 const area=view==='2d'?page.getByTestId('point-editor'):page.getByTestId('point-inspect').locator('canvas');await expect(area).toBeVisible();
 const xy=await area.evaluate(async(el,{view,id})=>{
  const store=(window as any).__editorPerfStore.getState(),path='/src/domain/geometry/evaluation.ts',{evaluationContext}=await import(path),p=evaluationContext(store.project).curve(id).evaluate(.55),r=el.getBoundingClientRect();
  if(view==='2d'){const path='/src/rendering/orthographic.ts',m=await import(path),v=store.project.views.find((v:any)=>v.id===store.viewId),q=m.worldToScreen(p,m.orthographicView(v.camera,v.canvas,r.width,r.height));return{x:r.left+q[0],y:r.top+q[1]};}
  const cameraPath='/src/ui/windows/state.ts',pose=(await import(cameraPath)).useInspectionCamera.getState(),three=await import('/node_modules/.vite/deps/three.js'),camera=new three.PerspectiveCamera(34,r.width/r.height,.1,100);camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();const q=new three.Vector3(...p).project(camera);return{x:r.left+(q.x+1)*r.width/2,y:r.top+(1-q.y)*r.height/2};
 },{view,id:hosted});
 const history=await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
 const before=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project)),selected=[];
 for(let i=0;i<8;i++){await page.mouse.click(xy.x,xy.y);selected.push(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selection?.id));if(selected.includes(hosted)&&selected.includes(original))break;}
 expect(selected).toContain(hosted);expect(selected).toContain(original);expect(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project))).toBe(before);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length)).toBe(history);expect(errors).toEqual([]);
});
