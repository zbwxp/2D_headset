import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
test('endpoint Join authoring, radius edit Undo/Redo, curve relation navigation, removal and save/load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 const ids=await page.evaluate(async()=>{
  const {createLandmarkProject}=await import('/src/domain/landmarks/presets.ts');
  const {createCurve}=await import('/src/domain/curves/management.ts');
  const s=(window as any).__editorPerfStore.getState();let p=createLandmarkProject();const point=p.landmarks.find((l:any)=>l.name==='下巴尖点')!,end=p.landmarks.find((l:any)=>l.name==='右外眼角点')!;
  const made=createCurve(p,point.id,end.id,p.views[0],'Smooth Join example');p=made.project;const c=p.curves.find((c:any)=>c.id===made.selectedId)!;
  s.load(p);s.selectObject({kind:'point',id:point.id});return {point:point.id,curve:c.id,mirror:c.mirrorPartnerCurveId};
 });
 await page.getByRole('button',{name:'＋添加平滑连接',exact:true}).click();
 await page.getByRole('combobox',{name:'曲线 A',exact:true}).selectOption(JSON.stringify([ids.curve,'START']));
 await page.getByRole('combobox',{name:'曲线 B',exact:true}).selectOption(JSON.stringify([ids.mirror,'START']));
 await page.getByRole('button',{name:'创建平滑连接',exact:true}).click();
 const state=()=>page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {joins:s.project.curveSmoothJoins??[],past:s.past.length,message:s.message};});
 await expect.poll(async()=>(await state()).joins.length).toBe(1);
 const before=await state(),slider=page.getByRole('slider',{name:'平滑半径',exact:true});await slider.focus();await page.keyboard.down('ArrowRight');await page.waitForTimeout(1100);await page.keyboard.up('ArrowRight');const after=await state();expect(after.joins[0].radiusRatio).toBeGreaterThan(.08);expect(after.past).toBe(before.past+1);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().undo());expect((await state()).joins[0].radiusRatio).toBe(.08);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().redo());expect((await state()).joins[0].radiusRatio).toBe(after.joins[0].radiusRatio);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectObject({kind:'curve',id}),ids.curve);await expect(page.getByTestId('inline-inspector')).toContainText('平滑连接');await page.getByRole('button',{name:'下巴尖点 →',exact:true}).click();
 const saved=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project);writeFileSync('artifacts/v063/symmetric-example.json',JSON.stringify(saved,null,2));await page.screenshot({path:'artifacts/v063/join-inspector.png'});
 await page.getByRole('button',{name:'移除平滑连接',exact:true}).click();expect((await state()).joins.length).toBe(0);await page.evaluate(()=>(window as any).__editorPerfStore.getState().undo());expect((await state()).joins.length).toBe(1);
 await page.evaluate(async p=>{const {parseLandmarks}=await import('/src/domain/landmarks/persistence.ts');(window as any).__editorPerfStore.getState().load(parseLandmarks(JSON.stringify(p)));},saved);expect((await state()).joins).toEqual(saved.curveSmoothJoins);
 expect(errors).toEqual([]);
});
test('same-side paired Join updates Patch and contour input, examples and bilingual inspector',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {spanFixture}=await import('/src/tests/span-fixture.ts');const {addPatch}=await import('/src/domain/patches/model.ts');const {addSmoothJoin}=await import('/src/domain/curves/smoothJoin/commands.ts');
  const {contourSource}=await import('/src/domain/contour/source.ts');const {evaluationContext}=await import('/src/domain/geometry/evaluation.ts');
  const f=spanFixture();let p=addPatch(f.p,[f.use,f.ac,f.bc]);p={...p,curves:p.curves.map((c:any)=>c.id===f.ac?{...c,contourRole:'OPEN_EDGE'}:c)};
  p=addSmoothJoin(p,f.c,{curveId:f.ac,endpoint:'END'},{curveId:f.bc,endpoint:'END'},.15);
  const out=contourSource(p),line=out.mesh.boundaries.at(-1),g=evaluationContext(p).curve(f.ac),same=JSON.stringify(line)===JSON.stringify(g.sample(512));
  const s=(window as any).__editorPerfStore.getState();s.load(p);s.selectObject({kind:'point',id:f.c});return {p,same,invalid:out.invalid};
 });
 expect(result.same).toBe(true);expect(result.invalid).toEqual([]);writeFileSync('artifacts/v063/same-side-patch-example.json',JSON.stringify(result.p,null,2));
 await expect(page.getByRole('button',{name:'移除平滑连接',exact:true})).toBeVisible();await page.getByTestId('language-toggle').click();await expect(page.getByRole('slider',{name:'Smooth Radius',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/v063/same-side-patch.png'});expect(errors).toEqual([]);
});
