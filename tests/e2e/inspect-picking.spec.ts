import {savedProject} from '../helpers/persistence';
import {pickCurve} from '../../src/ui/inspect3d/picking';
import {selectSidebar,pairRow} from "../helpers/sidebar";
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {PerspectiveCamera,Vector3} from 'three';
import {addPatch} from '../../src/domain/patches/model';
import {evaluator} from '../../src/domain/patches/geometry';
import {controls,bezier} from '../../src/domain/curves/geometry';
import {parseLandmarks} from '../../src/domain/landmarks/persistence';
const base=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
const names=['左面壳前边界·额颞至颧颊','左斜面带横向桥·额颞层','左面壳后边界·颞侧至颧弓','左斜面带横向桥·颧颊层'];
const project=addPatch(base,names.map(n=>base.curves.find(c=>c.name===n)!.id));
test('3D picks curve and nearest patch, respects orbit gestures and sorted triangle mapping',async({page})=>{
 await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'picking.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 const canvas=page.getByTestId('point-inspect').locator('canvas');const rect=await canvas.boundingBox();if(!rect)throw Error('canvas');
 const camera=new PerspectiveCamera(34,rect.width/rect.height,.1,100);camera.position.set(3,1.25,4.6);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const screen=(p:number[])=>{const v=new Vector3(...p as [number,number,number]).project(camera);return {x:rect.x+(v.x+1)*rect.width/2,y:rect.y+(1-v.y)*rect.height/2};};
 const cp=project.patches![0],position=screen(evaluator(project,cp)(.5,.5));
 await page.mouse.click(position.x,position.y);
 await expect(pairRow(page,cp.id)).toHaveAttribute('aria-pressed','true');
 const c=project.curves.find(c=>c.name==='左颅壳侧弧·颅顶至颞侧')!;const xy=screen(bezier(controls(project,c),.38));
 await page.mouse.click(xy.x,xy.y);await expect(page.getByTestId('curve-current')).toContainText(c.name);
 await expect(page.locator('.patch-panel .section-heading')).toHaveAttribute('aria-expanded','false');
 // Orbit begins on the surface; a drag must not change selection.
 await page.mouse.move(position.x,position.y);await page.mouse.down();await page.mouse.move(position.x+55,position.y+10,{steps:8});await page.mouse.up();await expect(page.getByTestId('curve-current')).toContainText(c.name);
 await page.getByRole('button',{name:'居中视图 ↗',exact:true}).click();
 await page.mouse.click(position.x,position.y);await expect(pairRow(page,cp.id)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('slider',{name:'3D Patch 不透明度',exact:true}).fill('0');await selectSidebar(page,'curve',c.name);const fresh=await canvas.boundingBox();if(!fresh)throw Error('canvas');const pose=await page.evaluate(async()=>{const path='/src/ui/windows/state.ts';return (await import(path)).useInspectionCamera.getState();});camera.aspect=fresh.width/fresh.height;camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateProjectionMatrix();camera.updateMatrixWorld();const segments=project.curves.flatMap(edge=>{const points=Array.from({length:97},(_,i)=>new Vector3(...bezier(controls(project,edge),i/96)));return points.slice(1).map((b,i)=>({id:edge.id,a:points[i],b}));});let clear:{x:number;y:number}|undefined;for(const u of [.25,.35,.45,.55,.65,.75])for(const v of [.25,.35,.45,.55,.65,.75]){const q=new Vector3(...evaluator(project,cp)(u,v)).project(camera),x=(q.x+1)*fresh.width/2,y=(1-q.y)*fresh.height/2;if(!pickCurve(segments,camera,fresh.width,fresh.height,x,y,12))clear={x,y};}if(!clear)throw Error('No curve-free patch interior');await page.mouse.click(fresh.x+clear.x,fresh.y+clear.y);await expect(page.getByTestId('curve-current')).toContainText(c.name);
 const saved=await savedProject(page);expect(saved.landmarks).toEqual(project.landmarks);expect(saved.curves).toEqual(project.curves);expect(saved.patches).toEqual(project.patches);await expect(page.locator('.point-footer')).toContainText('撤销 1 / 100');
});
test('patch creation highlights selected 3D boundaries and clears on deselect',async({page})=>{
 await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'highlight.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(base))});
 await page.locator('.patch-panel .section-heading').click();await page.getByRole('button',{name:'绘制面',exact:true}).click();
 const view=page.getByTestId('point-inspect');
 const before=await view.screenshot();
 await selectSidebar(page,'curve',names[0]);
 const selected=await view.screenshot({path:'test-results/3d-selected-boundary.png'});
 expect(selected.equals(before)).toBeFalsy();
 await selectSidebar(page,'curve',names[0]);
 const cleared=await view.screenshot();expect(cleared.equals(before)).toBeTruthy();
});
test('display quality changes tessellation without changing geometry or history',async({page})=>{
 await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'quality.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 await page.locator('.patch-panel .section-heading').click();const select=page.getByRole('combobox',{name:'Patch 显示精度',exact:true});await expect(select).toHaveValue('high');
 for(const [quality,n] of [['veryLow',4],['low',6],['medium',12],['high',24]] as const){await select.selectOption(quality);await expect(page.getByTestId('gpu-derived-renderer')).toHaveAttribute('data-surface-triangles',String(4*n*n));}
 await select.selectOption('low');const saved=await savedProject(page);expect(saved.curves).toEqual(project.curves);expect(saved.landmarks).toEqual(project.landmarks);expect(saved.patches).toEqual(project.patches);await expect(page.locator('.point-footer')).toContainText('撤销 1 / 100');
 await page.getByRole('button',{name:'删除 Patch 1',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(select).toHaveValue('low');await savedProject(page);await page.reload();await page.locator('.patch-panel .section-heading').click();await expect(select).toHaveValue('low');await expect(page.getByTestId('gpu-derived-renderer')).toHaveAttribute('data-surface-triangles','144');
});
test('3D geometry follows handle edits after reducing quality',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().includes('GL_INVALID'))errors.push(m.text())});
 await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'quality-edit.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 await selectSidebar(page,'curve',names[0]);
 for(const opacity of ['77','100']){
 if(await page.locator('.patch-panel .section-heading').getAttribute('aria-expanded')==='false')await page.locator('.patch-panel .section-heading').click();await page.getByRole('slider',{name:'3D Patch 不透明度',exact:true}).fill(opacity);
 for(const quality of ['high','veryLow','medium','low']){
 if(await page.locator('.patch-panel .section-heading').getAttribute('aria-expanded')==='false')await page.locator('.patch-panel .section-heading').click();await page.getByRole('combobox',{name:'Patch 显示精度',exact:true}).selectOption(quality);
 const view=page.getByTestId('point-inspect');const before=await view.screenshot();const h=await page.getByTestId('curve-handle-1').boundingBox();if(!h)throw Error('handle');
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+50,h.y+15,{steps:6});await page.mouse.up();
 expect((await view.screenshot()).equals(before),`${opacity}/${quality} must update 3D`).toBeFalsy();
 }
 }expect(errors).toEqual([]);
});
