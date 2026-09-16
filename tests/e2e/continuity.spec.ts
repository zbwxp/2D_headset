import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../../src/domain/landmarks/persistence';
import {addPatch} from '../../src/domain/patches/model';
import {selectSidebar,openPatch} from '../helpers/sidebar';
import {savedProject} from '../helpers/persistence';
const base=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
const seam='左面壳前边界·颧颊至下颊';
let p=addPatch(base,[seam,'左颊部体积线·颧颊至颊峰','左颊部体积线·颊峰至下颊'].map(n=>base.curves.find(c=>c.name===n)!.id));
p=addPatch(p,[seam,'左斜面带横向桥·颧颊层','左面壳后边界·颧弓至下颌角','左斜面带横向桥·下颊层'].map(n=>base.curves.find(c=>c.name===n)!.id));
async function load(page:any,project=p){await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'continuity.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.waitForFunction(async()=>{const m=await import('/src/domain/continuity/evaluation.ts' as string);return !!m.getSmoothResult((window as any).__editorPerfStore.getState().project);});}
test('Auto by default; Crease mirror, undo/redo, Save/Load and hover exact boundary',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await load(page);await selectSidebar(page,'curve',seam);
 const controls=page.getByTestId('surface-continuity'),row=controls.locator('.continuity-boundary').first();await expect(row).toContainText('2 surfaces · Auto');await row.locator('button').first().click();await row.hover();await expect(page.getByTestId('continuity-span-highlight')).toBeVisible();
 await row.getByRole('button',{name:'Crease',exact:true}).click();await expect(row).toContainText('Crease');const saved=await savedProject(page);expect(Object.values(saved.surfaceContinuity.overrides)).toEqual([{mode:'crease'},{mode:'crease'}]);expect(saved.surfaceSmooth).toBeUndefined();expect(saved.landmarks).toEqual(p.landmarks);expect(saved.curves).toEqual(p.curves);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await selectSidebar(page,'curve',seam);await expect(row).toContainText('Auto');await page.getByRole('button',{name:'重做',exact:true}).click();await selectSidebar(page,'curve',seam);await expect(row).toContainText('Crease');
 await selectSidebar(page,'curve',seam.replace('左','右'));await expect(controls).toContainText('Crease');await savedProject(page);await page.reload();await selectSidebar(page,'curve',seam);await expect(controls).toContainText('Crease');await expect(page.getByRole('slider',{name:'Smooth Strength',exact:true})).toHaveCount(0);await expect(page.getByRole('slider',{name:'Smooth Influence',exact:true})).toHaveCount(0);
 await page.screenshot({path:'artifacts/continuity/inspector.png'});expect(errors).toEqual([]);
});
test('Fullness updates final GPU surface without dispatch; geometry edits re-solve',async({page})=>{
 await load(page);await selectSidebar(page,'patch',p.patches![0].id);await page.evaluate(()=>{(window as any).__geometryPerformance.reset();});
 const before=await page.getByTestId('point-inspect').locator('canvas').screenshot();const slider=page.getByRole('slider',{name:'面凸度 Fullness',exact:true});await slider.fill('45');await slider.blur();await savedProject(page);
 const stats=await page.evaluate(()=>(window as any).__geometryPerformance.snapshot());expect(stats.counters.smoothDispatches??0).toBe(0);expect((await page.getByTestId('point-inspect').locator('canvas').screenshot()).equals(before)).toBe(false);
 await selectSidebar(page,'curve',seam);await page.getByRole('slider',{name:'调整曲线平面',exact:true}).fill('12');await page.getByRole('slider',{name:'调整曲线平面',exact:true}).blur();
 await expect.poll(async()=>page.evaluate(()=>(window as any).__geometryPerformance.snapshot().counters.smoothDispatches??0)).toBeGreaterThan(0);
 await page.waitForFunction(async()=>{const m=await import('/src/domain/continuity/evaluation.ts' as string);return !!m.getSmoothResult((window as any).__editorPerfStore.getState().project);});
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');await expect(page.getByTestId('contour-silhouette').locator('path')).not.toHaveCount(0);
 await page.screenshot({path:'artifacts/continuity/fair-fullness-contour.png'});
});
test('actual head automatically settles with no legacy opt-in',async({page})=>{
 const project=parseLandmarks(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8'));await load(page,project);await openPatch(page);await expect(page.getByTestId('continuity-status')).not.toHaveAttribute('data-state','pending');await page.screenshot({path:'artifacts/continuity/head.png'});
});
test('high-quality opaque visual comparison',async({page})=>{
 const project=parseLandmarks(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8'));project.patchDisplay={...project.patchDisplay!,opacity3d:1,quality:'high'};await load(page,project);
 await page.screenshot({path:'artifacts/continuity/head-high-auto.png'});
 await page.evaluate(async()=>{const store=(window as any).__editorPerfStore,m=await import('/src/domain/continuity/model.ts' as string);let p=store.getState().project;for(const r of m.relations(p))if(r.pair)p=m.setRelationship(p,r.key,{mode:'crease'});store.getState().load(p);});
 await page.waitForFunction(async()=>{const m=await import('/src/domain/continuity/evaluation.ts' as string);return !!m.getSmoothResult((window as any).__editorPerfStore.getState().project);});await page.screenshot({path:'artifacts/continuity/head-high-crease.png'});
});
test('three surfaces: manual pair, clear and persistence',async({page})=>{
 await load(page);
 // Add a topologically distinct third triangle to the same source edge using existing endpoints.
 await page.evaluate(async(name)=>{const store=(window as any).__editorPerfStore,m=await import('/src/domain/curves/management.ts' as string),pm=await import('/src/domain/patches/model.ts' as string);let p=store.getState().project;const c=p.curves.find((c:any)=>c.name===name),d=p.landmarks.find((l:any)=>l.name==='左耳部接口·耳根上端').id;const a=m.createCurve(p,c.startLandmarkId,d,p.views[0],'耳侧连接 A');p=a.project;const b=m.createCurve(p,c.endLandmarkId,d,p.views[0],'耳侧连接 B');p=pm.addPatch(b.project,[c.id,a.selectedId,b.selectedId]);store.getState().load(p);},seam);
 await selectSidebar(page,'curve',seam);const row=page.getByTestId('surface-continuity').locator('.continuity-boundary').first();await expect(row).toContainText('3 surfaces · Natural');await row.locator('button').first().click();await row.getByRole('button',{name:'Set Pair',exact:true}).click();await expect(row).toContainText('Manual Pair');
 const saved=await savedProject(page);expect(Object.values(saved.surfaceContinuity.overrides).every((r:any)=>r.mode==='manual')).toBe(true);await page.reload();await selectSidebar(page,'curve',seam);await expect(row).toContainText('Manual Pair');await row.locator('button').first().click();await row.getByRole('button',{name:'Clear Pair',exact:true}).click();await expect(row).toContainText('3 surfaces · Natural');
});
