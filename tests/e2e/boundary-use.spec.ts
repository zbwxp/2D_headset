import {migrateHeadFrame} from '../../src/domain/head/frame';
import {test,expect,type Page} from '@playwright/test';
import {PerspectiveCamera,Vector3} from 'three';
import {spanFixture} from '../../src/tests/span-fixture';
import {pointPosition} from '../../src/domain/geometry/evaluation';
import {controls,bezier} from '../../src/domain/curves/geometry';
import {savedProject} from '../helpers/persistence';
import {openPatch} from '../helpers/sidebar';
const f=spanFixture();
async function load(page:Page){await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'span.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.p))});await openPatch(page);await page.getByRole('button',{name:'绘制面',exact:true}).click();await page.getByRole('button',{name:'区间',exact:true}).click();}
async function state(page:Page){return page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {tool:s.patchCreation,project:s.project,past:s.past.length};});}
async function clickCurve2d(page:Page,id:string){await page.getByTestId('curve-hit-'+id).dispatchEvent('pointerdown',{button:0,pointerId:1});}
async function screen3d(page:Page,position:number[]){const r=await page.getByTestId('point-inspect').locator('canvas').boundingBox();if(!r)throw Error('3D missing');const pose=await page.evaluate(async()=>{const path='/src/ui/windows/state.ts';return (await import(path)).useInspectionCamera.getState();});const c=new PerspectiveCamera(34,r.width/r.height,.1,100);c.position.fromArray(pose.position);c.quaternion.fromArray(pose.quaternion);c.updateProjectionMatrix();c.updateMatrixWorld();const v=new Vector3(...position as [number,number,number]).project(c);return {x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2};}
async function click3d(page:Page,position:number[]){const q=await screen3d(page,position);await page.mouse.click(q.x,q.y);}
async function finishWhole2d(page:Page){await page.getByRole('button',{name:'整线',exact:true}).click();await clickCurve2d(page,f.ac);await clickCurve2d(page,f.bc);await expect.poll(async()=>(await state(page)).project.patches?.length).toBe(2);}
test('2D span creation, preview, live s/fullness/smooth, persistence and history',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await load(page);await clickCurve2d(page,f.host);
 await expect(page.getByTestId('span-anchor-'+f.a)).toBeVisible();await page.getByTestId('span-anchor-'+f.a).click();await page.getByTestId('span-anchor-'+f.b).hover();expect((await state(page)).tool.hover).toBe(f.b);await page.getByTestId('span-anchor-'+f.b).click();expect((await state(page)).tool.uses).toEqual([f.use]);await finishWhole2d(page);await page.keyboard.press('Escape');
 const created=(await state(page)).project;expect(created.curves).toEqual(f.p.curves);expect(created.landmarks).toEqual(migrateHeadFrame(f.p).landmarks);expect(created.patches[0].boundaryUses).toContainEqual(f.use);
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');const contourBefore=await page.evaluate(()=>(window as any).__contourProfile.uploads);
 await page.getByRole('slider',{name:'面凸度 Fullness',exact:true}).fill('45.25');await expect.poll(async()=>await page.evaluate(()=>(window as any).__contourProfile.uploads)).toBeGreaterThan(contourBefore);await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');await expect(page.getByTestId('contour-silhouette').locator('path').first()).toBeVisible();await expect(page.getByTestId('gpu-derived-renderer')).toHaveAttribute('data-surface-count','2');
 await page.screenshot({path:'artifacts/boundary-use/tri-fullness-three-views.png'});expect((await state(page)).project.patches.find((p:any)=>!p.canonicalId).fullness).toBe(.4525);
 // Actual locator inspector uses the existing NumericSlider session.
 await page.getByTestId('landmark-'+f.p.landmarks.find(l=>l.id===f.a)!.name).dispatchEvent('pointerdown',{button:0,pointerId:1,clientX:500,clientY:400});
 const slider=page.getByRole('slider',{name:'在线位置',exact:true});await expect(slider).toBeVisible();await slider.focus();const n=(await state(page)).past;await page.keyboard.down('ArrowRight');await page.waitForTimeout(420);await page.keyboard.up('ArrowRight');expect((await state(page)).past).toBe(n+1);expect((await state(page)).project.curves).not.toEqual(created.curves);await page.getByRole('button',{name:'撤销',exact:true}).click();
 await openPatch(page);await expect(page.getByTestId('continuity-status')).toHaveAttribute('data-state','natural');await expect(page.locator('body')).not.toContainText('Smooth 已回退');
 const saved=await savedProject(page);expect(saved.patches[0].boundaryUses).toContainEqual(f.use);expect(JSON.stringify(saved.patches)).not.toContain('boundaryEdgeIds');await page.reload();expect((await savedProject(page)).patches).toEqual(saved.patches);expect(errors).toEqual([]);
});
test('3D host → 2D first anchor → 3D second anchor shares tool state; Esc is two-stage',async({page})=>{
 await load(page);await click3d(page,bezier(controls(f.p,f.p.curves.find(c=>c.id===f.host)!),.5));await expect.poll(async()=>(await state(page)).tool.host).toBe(f.host);
 await page.getByTestId('span-anchor-'+f.a).click();await click3d(page,pointPosition(f.p,f.b));await expect.poll(async()=>(await state(page)).tool.uses.length).toBe(1);expect((await state(page)).tool.uses[0]).toEqual(f.use);await finishWhole2d(page);
 await page.getByRole('button',{name:'区间',exact:true}).click();await clickCurve2d(page,f.host);await page.keyboard.press('Escape');expect((await state(page)).tool.host).toBeUndefined();await page.keyboard.press('Escape');expect((await state(page)).tool).toBeNull();
});
test('entire authoring in 3D: candidates prioritized over host, normal orbit unchanged',async({page})=>{
 await load(page);await click3d(page,bezier(controls(f.p,f.p.curves.find(c=>c.id===f.host)!),.5));await expect.poll(async()=>(await state(page)).tool.host).toBe(f.host);
 await click3d(page,pointPosition(f.p,f.a));await expect.poll(async()=>(await state(page)).tool.start).toBe(f.a);await click3d(page,pointPosition(f.p,f.b));await expect.poll(async()=>(await state(page)).tool.uses.length).toBe(1);
 await page.getByRole('button',{name:'整线',exact:true}).click();for(const id of [f.ac,f.bc])await click3d(page,bezier(controls(f.p,f.p.curves.find(c=>c.id===id)!),.6));await expect.poll(async()=>(await state(page)).project.patches?.length).toBe(2);await page.keyboard.press('Escape');const before=(await state(page)).project;const canvas=await page.getByTestId('point-inspect').boundingBox();await page.mouse.move(canvas!.x+40,canvas!.y+40);await page.mouse.down();await page.mouse.move(canvas!.x+100,canvas!.y+70,{steps:8});await page.mouse.up();expect((await state(page)).project).toEqual(before);
});
