import {savedProject} from '../helpers/persistence';
import {addOnCurvePoint} from '../../src/domain/landmarks/placement';
import {addPatch} from '../../src/domain/patches/model';
import {defaultSmooth} from '../../src/domain/smooth/model';
import {test,expect,type Page} from '@playwright/test';
import {createLandmarkProject} from '../../src/domain/landmarks/presets';
import {createCurve} from '../../src/domain/curves/management';
import {parseLandmarks} from '../../src/domain/landmarks/persistence';
import {pointPosition} from '../../src/domain/geometry/evaluation';
import {selectSidebar,pairRow} from '../helpers/sidebar';
const state=savedProject;
const seed=()=>{const p=createLandmarkProject(),id=(n:string)=>p.landmarks.find(l=>l.name===n)!.id;return createCurve(p,id('右眉头点'),id('右眉尾点'),p.views[0],'测试宿主').project;};
async function load(page:Page,p:any){await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'locator.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});}
async function create(page:Page){const p=seed();await load(page,p);const host=p.curves.find(c=>p.landmarks.find(l=>l.id===c.startLandmarkId)?.type==='RIGHT')!;await selectSidebar(page,'curve',host.id);await page.getByRole('button',{name:'添加结构线定位点',exact:true}).click();const q=await state(page),point=q.landmarks.find((l:any)=>l.placement.kind==='ON_CURVE'&&l.type==='RIGHT');return {p,host,point};}
test('same-side pair, slider precision, snap, no spatial drag, rename, duplicate, Save and Undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const {p,host,point}=await create(page);const slider=page.getByRole('slider',{name:'在线位置',exact:true});
 await expect(slider).toHaveValue('0.5');await expect(pairRow(page,point.id)).toHaveAttribute('data-active-id',point.id);expect((await state(page)).landmarks.length).toBe(p.landmarks.length+2);await expect(page.getByTestId('dof')).toHaveText('1 DOF');
 await slider.press('ArrowRight');await expect(slider).toHaveValue('0.5025');await slider.press('Alt+ArrowRight');await expect(slider).toHaveValue('0.503');await slider.press('Shift+ArrowRight');await expect(slider).toHaveValue('0.5155');await slider.press('ArrowLeft');await slider.press('ArrowLeft');await slider.press('ArrowLeft');await expect(slider).toHaveValue('0.5');
 await slider.fill('0.7');const before=await state(page);const other=before.landmarks.find((l:any)=>l.id===point.mirrorPartnerId);expect(pointPosition(before,other.id)).toEqual(pointPosition(before,point.id).map((x,i)=>i===0?-x:x));expect(before.curves).toEqual(p.curves);
 const el=page.getByTestId(`landmark-${point.name}`),b=(await el.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+30,b.y+b.height/2+20,{steps:5});await page.mouse.up();expect((await state(page)).landmarks).toEqual(before.landmarks);await expect(page.getByTestId('motion-status')).not.toContainText('Unlock');
 await page.getByTestId(`landmark-${other.name}`).click({force:true});await expect(pairRow(page,point.id)).toHaveAttribute('data-active-id',other.id);await expect(slider).toHaveValue('0.7');await slider.fill('0.4');
 const row=pairRow(page,point.id);await row.focus();await row.press('F2');const input=row.locator('input');await input.fill('测试定位');await input.press('Enter');expect((await state(page)).landmarks.filter((l:any)=>l.name==='左测试定位'||l.name==='右测试定位')).toHaveLength(2);
 await page.getByRole('button',{name:'保存 JSON',exact:true}).click();const saved=await state(page);await page.reload();await expect(page.getByTestId('point-editor')).toBeVisible();expect((await state(page)).landmarks).toEqual(saved.landmarks);
 await selectSidebar(page,'landmark',other.id);await slider.fill('0.65');await page.getByRole('button',{name:'撤销',exact:true}).click();await selectSidebar(page,'landmark',other.id);await expect(slider).toHaveValue('0.4');
 expect(errors).toEqual([]);
});
test('locator endpoint curve updates; host handle changes keep s; hold is one history step',async({page})=>{
 const {point,host}=await create(page);const slider=page.getByRole('slider',{name:'在线位置',exact:true});
 await page.locator('.curve-panel .section-heading').click();await page.getByRole('button',{name:'创建曲线',exact:true}).click();await page.getByTestId(`landmark-${point.name}`).dispatchEvent('pointerdown',{button:0,pointerId:4});await page.getByTestId('landmark-右外眼角点').dispatchEvent('pointerdown',{button:0,pointerId:4});
 let p=await state(page);expect(p.curves.length).toBe(4);const downstream=p.curves.find((c:any)=>c.startLandmarkId===point.id)!,path=page.getByTestId('point-editor').getByTestId('curve-'+downstream.id),old=await path.getAttribute('d');await selectSidebar(page,'landmark',point.id);
 await slider.fill('0.75');expect(await path.getAttribute('d')).not.toEqual(old);const before=await state(page);await selectSidebar(page,'curve',host.id);
 const handle=page.locator('[data-testid^="curve-handle-"]').first();await expect(handle).toBeVisible();const box=(await handle.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-28,{steps:5});await page.mouse.up();p=await state(page);expect(pointPosition(p,point.id)).not.toEqual(pointPosition(before,point.id));parseLandmarks(JSON.stringify(p));
 await selectSidebar(page,'landmark',point.id);await expect(slider).toHaveValue('0.75');await slider.fill('0.3');const prior=await state(page);await slider.focus();await page.keyboard.down('ArrowRight');await page.waitForTimeout(850);await page.keyboard.up('ArrowRight');const held=+(await slider.inputValue());expect(held).toBeGreaterThan(.305);await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await state(page)).landmarks).toEqual(prior.landmarks);
});
test('duplicate same placement, Delete Point keeps host, Delete Host removes downstream pair, Undo restores',async({page})=>{
 const {point,host}=await create(page);await page.locator('.point-workspace').focus();await page.keyboard.press('Control+c');await page.getByLabel('语义点名称').fill('副本定位');await page.getByRole('region',{name:'复制语义点',exact:true}).getByRole('button',{name:'复制',exact:true}).click();let p=await state(page);expect(p.landmarks.filter((l:any)=>l.placement.kind==='ON_CURVE')).toHaveLength(4);expect(p.curves.length).toBe(2);
 const copy=p.landmarks.find((l:any)=>l.name==='右副本定位');expect(pointPosition(p,copy.id)).toEqual(pointPosition(p,point.id));
 const remove=async()=>{await page.locator('.point-workspace').focus();await page.keyboard.press('Delete');await page.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click();};
 await remove();p=await state(page);expect(p.landmarks.filter((l:any)=>l.placement.kind==='ON_CURVE')).toHaveLength(2);expect(p.curves.length).toBe(2);
 await selectSidebar(page,'curve',host.id);const before=await state(page);await remove();p=await state(page);expect(p.curves).toHaveLength(0);expect(p.landmarks.some((l:any)=>l.placement.kind==='ON_CURVE')).toBe(false);await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await state(page)).landmarks).toEqual(before.landmarks);expect((await state(page)).curves).toEqual(before.curves);await page.getByRole('button',{name:'重做',exact:true}).click();expect((await state(page)).curves).toHaveLength(0);
});

test('locator slider updates rendered Patch, Smooth result and Contour',async({page})=>{
 let p=seed();const host=p.curves[0],a=addOnCurvePoint(p,host.id);p=a.project;const point=p.landmarks.find(l=>l.id===a.selectedId)!,side=point.type==='LEFT'?'左':'右',end=p.landmarks.find(l=>l.name===side+'外眼角点')!,tail=p.landmarks.find(l=>l.name===side+'嘴角点')!;
 const edges:string[]=[];for(const [x,y]of [[point.id,end.id],[end.id,tail.id],[tail.id,point.id]]){const r=createCurve(p,x,y,p.views[0],'边界');p=r.project;edges.push(r.selectedId);}p=addPatch(p,edges);p={...p,surfaceSmooth:{...defaultSmooth,enabled:true},patchDisplay:{opacity2d:.9,opacity3d:.7,quality:'low',visible:true}};
 await load(page,p);await page.locator('.patch-panel .section-heading').click();await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();await expect(page.getByTestId('smooth-controls')).toHaveAttribute('data-state','ready');await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');
 const contour=()=>page.getByTestId('contour-silhouette').locator('path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d'))),old=await contour();expect(old.length).toBeGreaterThan(0);
 await selectSidebar(page,'landmark',point.id);await page.getByRole('slider',{name:'在线位置',exact:true}).fill('0.8');await page.locator('.patch-panel .section-heading').click();await expect(page.getByTestId('smooth-controls')).toHaveAttribute('data-state','ready');await expect.poll(contour).not.toEqual(old);await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');
 await selectSidebar(page,'landmark',point.id);await page.screenshot({path:'artifacts/on-curve/preview.png',fullPage:true});
});
