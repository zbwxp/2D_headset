import {PerspectiveCamera,OrthographicCamera,Vector3} from 'three';
import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page){
 await page.goto('/');
 return page.evaluate(async()=>{
  const {spanFixture}=await import('/src/tests/span-fixture.ts');
  const f=spanFixture(),s=(window as any).__editorPerfStore.getState();
  s.load(f.p);s.selectView('front');s.selectObject(null);
  return {a:f.a,b:f.b,bc:f.bc,am:f.p.landmarks.find((l:any)=>l.id===f.a)!.mirrorPartnerId!,bm:f.p.landmarks.find((l:any)=>l.id===f.b)!.mirrorPartnerId!};
 });
}
async function clickPoint(page:Page,id:string,view:'2d'|'3d'){
 if(view==='2d'){
  const p=page.locator(`[data-testid=point-editor] [data-point-id="${id}"]`);
  const r=await p.boundingBox();expect(r).not.toBeNull();await page.mouse.click(r!.x+r!.width/2,r!.y+r!.height/2);return;
 }
 let xy={x:0,y:0};
 await expect(async()=>{
  const data=await page.evaluate(async id=>{
   const s=(window as any).__editorPerfStore.getState(),{pointPosition}=await import('/src/domain/geometry/evaluation.ts'),{useInspectionCamera}=await import('/src/ui/windows/state.ts');
   const r=document.querySelector('[data-testid=point-inspect] canvas')!.getBoundingClientRect();return {p:pointPosition(s.project,id),pose:useInspectionCamera.getState(),r:{x:r.x,y:r.y,width:r.width,height:r.height}};
  },id);
  const {r,pose,p}=data,aspect=r.width/r.height,c=pose.projection==='orthographic'?new OrthographicCamera(-pose.orthoHeight*aspect/2,pose.orthoHeight*aspect/2,pose.orthoHeight/2,-pose.orthoHeight/2,.1,100):new PerspectiveCamera(pose.fov,aspect,.1,100);
  c.position.fromArray(pose.position);c.quaternion.fromArray(pose.quaternion);c.updateMatrixWorld();const q=new Vector3(...p).project(c);
  xy={x:r.x+(q.x+1)*r.width/2,y:r.y+(1-q.y)*r.height/2};
  await page.mouse.move(xy.x,xy.y);await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-hover-point',id,{timeout:300});
 }).toPass({timeout:4000});
 await page.mouse.click(xy.x,xy.y);
}
test('2D menu merges both mirror pairs in one Undo step, retains connected curves and survives load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const ids=await setup(page);
 const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {points:s.project.landmarks.length,curves:s.project.curves.length,history:s.past.length};});
 await page.locator('.creation-shelf summary').filter({hasText:'点'}).click();
 await page.getByRole('button',{name:'合并曲线定位点',exact:true}).click();
 await expect(page.getByTestId('active-tool-bar')).toContainText('选择保留位置的点');
 await clickPoint(page,ids.a,'2d');await expect(page.getByTestId('active-tool-bar')).toContainText('选择要并入的点');
 await clickPoint(page,ids.b,'2d');await expect(page.getByTestId('active-tool-bar')).toHaveCount(0);
 const merged=await page.evaluate(ids=>{const s=(window as any).__editorPerfStore.getState();return {points:s.project.landmarks.length,curves:s.project.curves.length,history:s.past.length,endpoint:s.project.curves.find((c:any)=>c.id===ids.bc).startLandmarkId,selected:s.selectedId};},ids);
 expect(merged).toEqual({points:before.points-2,curves:before.curves,history:before.history+1,endpoint:ids.a,selected:ids.a});
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.length)).toBe(before.points);
 await page.getByRole('button',{name:'重做',exact:true}).click();
 await page.evaluate(async()=>{const s=(window as any).__editorPerfStore.getState(),{parseLandmarks}=await import('/src/domain/landmarks/persistence.ts');s.load(parseLandmarks(JSON.stringify(s.project)));});
 expect(await page.evaluate(id=>(window as any).__editorPerfStore.getState().project.curves.find((c:any)=>c.id===id).startLandmarkId,ids.bc)).toBe(ids.a);
 expect(errors).toEqual([]);
});
test('inspector shortcut, 3D picking, mixed view clicks and Esc cancellation',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const ids=await setup(page);
 await clickPoint(page,ids.am,'3d');
 await page.getByTestId('inline-inspector').getByRole('button',{name:'合并曲线定位点',exact:true}).click();
 await expect(page.getByTestId('active-tool-bar')).toContainText('保留点');
 await clickPoint(page,ids.bm,'3d');
 expect(await page.evaluate(id=>(window as any).__editorPerfStore.getState().project.landmarks.some((l:any)=>l.id===id),ids.b)).toBe(false);
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().startPointMerge());
 await clickPoint(page,ids.a,'2d');await clickPoint(page,ids.b,'3d');
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().tool.kind)).toBe('select');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 const before=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project));
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().startPointMerge());
 await clickPoint(page,ids.a,'3d');await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project))).toBe(before);
 expect(errors).toEqual([]);
});
