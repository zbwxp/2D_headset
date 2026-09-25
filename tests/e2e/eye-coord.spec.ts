import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('migrated eye study: no cylinder, editable mirrored lid handles, undo/redo and gaze',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 const raw=readFileSync('/Users/bowen/Desktop/眼睛研究1.json','utf8');
 const data=await page.evaluate(async raw=>{const store=(window as any).__editorPerfStore,url='/src/domain/landmarks/persistence.ts',p=(await import(url)).parseLandmarks(raw);store.getState().load(p);const s=store.getState();s.setActiveModule('EYES');s.selectView(p.views[0].id);s.setCanvas({zoom:2,pan:[0,0]});const c=p.eyeScaffold.coord.right.curves[0];s.selectCurve(c);return {curve:c,point:p.eyeScaffold.coord.right.points[2]};},raw);
 const snapshot=()=>page.evaluate(id=>{const s=(window as any).__editorPerfStore.getState();return {local:s.project.landmarks.find((x:any)=>x.id===id).placement.local,history:s.past.length};},data.point);
 const before=await snapshot();const handle=page.getByTestId('lid-handle-0');await expect(handle).toBeVisible();const b=(await handle.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2-24,{steps:8});await page.mouse.up();const after=await snapshot();expect(after.local).not.toEqual(before.local);expect(after.history).toBe(before.history+1);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().undo());expect((await snapshot()).local).toEqual(before.local);await page.evaluate(()=>(window as any).__editorPerfStore.getState().redo());expect((await snapshot()).local).toEqual(after.local);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),data.curve);await page.screenshot({path:'artifacts/eyes/eye-coord.png'});expect(errors).toEqual([]);
});
test('new Eyes builds EyeCoord directly; ball and lid position edits are independent with undo',async({page})=>{
 await page.goto('/');const data=await page.evaluate(async()=>{const base='/src/domain/landmarks/presets.ts',frame='/src/domain/head/frame.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(frame)).migrateHeadFrame((await import(base)).createLandmarkProject()));s.setActiveModule('EYES');s.createEyes();const current=(window as any).__editorPerfStore.getState(),e=current.project.eyeScaffold;current.selectObject({kind:'point',id:e.right.pointIds[20]});return {center:e.right.pointIds[20],corner:e.coord.right.points[0],x:e.parameters.x};});
 await expect(page.getByTestId('eye-controls')).toBeVisible();await expect(page.getByText('柱体横向半径',{exact:true})).toHaveCount(0);
 const positions=()=>page.evaluate(async ids=>{const g='/src/domain/geometry/evaluation.ts',s=(window as any).__editorPerfStore.getState(),f=(await import(g)).pointPosition;return ids.map(id=>f(s.project,id));},[data.center,data.corner]);const before=await positions();
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.beginEdit();s.setEyeParameter('right','x',s.project.eyeScaffold.parameters.x+.1);s.endEdit();});const after=await positions();expect(after[1]).toEqual(before[1]);expect(after[0]).not.toEqual(before[0]);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().undo());expect(await positions()).toEqual(before);
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState(),e=s.project.eyeScaffold;s.beginEdit();s.setEyeCoord('position',[e.coord.position[0],e.coord.position[1]+.1,e.coord.position[2]]);s.endEdit();});const lid=await positions();expect(lid[0]).toEqual(before[0]);expect(lid[1]).not.toEqual(before[1]);
});
