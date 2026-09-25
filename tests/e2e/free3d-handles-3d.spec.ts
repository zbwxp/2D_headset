import {test,expect} from '@playwright/test';
import {Quaternion,Vector3} from 'three';

test('3D source handles drag without orbit, sync sliders, mirror and undo in both projections',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const id=await page.evaluate(async()=>{
  const path='/src/domain/landmarks/presets.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(path)).createLandmarkProject());
  const p=(window as any).__editorPerfStore.getState().project,a=p.landmarks.find((l:any)=>l.name==='下巴尖点'),b=p.landmarks.find((l:any)=>l.name==='右外眼角点');
  s.startCurve();s.pickCurveEndpoint(a.id);s.pickCurveEndpoint(b.id);return (window as any).__editorPerfStore.getState().selectedCurveId;
 });
 const panel=page.getByTestId('point-inspect'),handle=(i:number)=>panel.getByTestId(`inspect-curve-handle-${i}`);
 const read=()=>page.evaluate(async id=>{
  const path='/src/domain/geometry/evaluation.ts',cameraPath=performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/src/ui/windows/state.ts'))??'/src/ui/windows/state.ts';
  const s=(window as any).__editorPerfStore.getState(),c=s.project.curves.find((c:any)=>c.id===id),ctx=(await import(path)).evaluationContext(s.project);
  return {shape:c.shape,cp:ctx.sourceCurveControls(id),mirror:ctx.sourceCurveControls(c.mirrorPartnerCurveId),mirrorId:c.mirrorPartnerCurveId,pose:(await import(cameraPath)).useInspectionCamera.getState(),past:s.past.length};
 },id);
 const drag=async(i:number,dx:number,dy:number)=>{
  await expect(handle(i)).toBeVisible();const r=(await handle(i).boundingBox())!;
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
  await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:6});await page.mouse.up();
 };
 await expect(handle(1)).toHaveAttribute('data-curve-id',id);
 const a=await read();await drag(1,25,-20);const b=await read();
 expect(b.shape).not.toEqual(a.shape);expect(b.cp[0]).toEqual(a.cp[0]);expect(b.cp[2]).toEqual(a.cp[2]);expect(b.cp[3]).toEqual(a.cp[3]);
 expect(b.pose.quaternion).toEqual(a.pose.quaternion);expect(b.pose.position).toEqual(a.pose.position);expect(b.past).toBe(a.past+1);
 const normal=new Vector3(0,0,1).applyQuaternion(new Quaternion().fromArray(a.pose.quaternion));
 expect(new Vector3(...b.cp[1]).sub(new Vector3(...a.cp[1])).dot(normal)).toBeCloseTo(0,10);
 const start=page.getByTestId('startHandleOffset');for(const [i,axis] of ['X','Y','Z'].entries())await expect.poll(async()=>+(await start.getByRole('slider',{name:axis,exact:true}).inputValue())).toBeCloseTo(b.shape.startHandleOffset[i],10);
 await page.keyboard.press('Control+z');await expect.poll(async()=>(await read()).shape).toEqual(a.shape);
 await page.keyboard.press('Control+Shift+z');await expect.poll(async()=>(await read()).shape).toEqual(b.shape);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),b.mirrorId);
 await page.getByRole('button',{name:'Toggle 3D projection',exact:true}).click();
 await expect.poll(async()=>(await read()).pose.perspective).toBe(false);
 const c=await read();await drag(2,-22,16);const d=await read();expect(d.shape).not.toEqual(c.shape);expect(d.past).toBe(c.past+1);expect(d.pose.quaternion).toEqual(c.pose.quaternion);
 for(let i=0;i<4;i++){expect(d.mirror[i][0]).toBeCloseTo(-d.cp[i][0],10);expect(d.mirror[i][1]).toBeCloseTo(d.cp[i][1],10);expect(d.mirror[i][2]).toBeCloseTo(d.cp[i][2],10);}
 // Normal canvas drags still orbit after a handle releases capture.
 const rect=(await panel.locator('canvas').boundingBox())!;
 await page.mouse.move(rect.x+45,rect.y+125);await page.mouse.down();await page.mouse.move(rect.x+95,rect.y+145,{steps:5});await page.mouse.up();
 await expect.poll(async()=>(await read()).pose.quaternion).not.toEqual(d.pose.quaternion);
 await expect(handle(1)).toBeVisible();await expect(handle(2)).toBeVisible();
 await page.screenshot({path:'artifacts/free3d/handles-3d.png'});
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().startCurve());await expect(handle(1)).toBeHidden();
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.cancelCurve();s.selectLandmark(s.project.landmarks[0].id);});await expect(handle(1)).toBeHidden();expect(errors).toEqual([]);
});
