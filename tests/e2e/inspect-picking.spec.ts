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
 await expect(page.getByTestId(`patch-row-${cp.id}`).getByRole('button').first()).toHaveAttribute('aria-pressed','true');
 const c=project.curves.find(c=>c.name==='左颅壳侧弧·颅顶至颞侧')!;const xy=screen(bezier(controls(project,c),.38));
 await page.mouse.click(xy.x,xy.y);await expect(page.getByTestId('curve-current')).toContainText(c.name);
 await expect(page.getByTestId(`patch-row-${cp.id}`).getByRole('button').first()).toHaveAttribute('aria-pressed','false');
 // Orbit begins on the surface; a drag must not change selection.
 await page.mouse.move(position.x,position.y);await page.mouse.down();await page.mouse.move(position.x+55,position.y+10,{steps:8});await page.mouse.up();await expect(page.getByTestId('curve-current')).toContainText(c.name);
 await page.getByRole('button',{name:'居中视图 ↗',exact:true}).click();
 await page.mouse.click(position.x,position.y);await expect(page.getByTestId(`patch-row-${cp.id}`).getByRole('button').first()).toHaveAttribute('aria-pressed','true');
 await page.getByRole('slider',{name:'3D Patch 不透明度',exact:true}).fill('0');await page.getByRole('button',{name:c.name,exact:true}).click();await page.mouse.click(position.x,position.y);await expect(page.getByTestId('curve-current')).toContainText(c.name);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('contour.landmarks.v039')!));expect(saved.landmarks).toEqual(project.landmarks);expect(saved.curves).toEqual(project.curves);expect(saved.patches).toEqual(project.patches);await expect(page.locator('.point-footer')).toContainText('撤销 1 / 100');
});
test('patch creation highlights selected 3D boundaries and clears on deselect',async({page})=>{
 await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'highlight.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(base))});
 await page.getByRole('button',{name:'绘制面',exact:true}).click();
 const view=page.getByTestId('point-inspect');
 const before=await view.screenshot();
 await page.getByRole('button',{name:names[0],exact:true}).click();
 const selected=await view.screenshot({path:'test-results/3d-selected-boundary.png'});
 expect(selected.equals(before)).toBeFalsy();
 await page.getByRole('button',{name:names[0],exact:true}).click();
 const cleared=await view.screenshot();expect(cleared.equals(before)).toBeTruthy();
});
