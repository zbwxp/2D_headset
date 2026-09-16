import {test,expect} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';
test('performance workload scenarios',async({page})=>{
 await page.goto('/');
 const results=await page.evaluate(async()=>{
  // Vite module imports access the application's actual kernel/store, without UI gesture noise.
  const useEditor=(window as any).__editorPerfStore;
  const {parseLandmarks}=await import('/src/domain/landmarks/persistence' as string);
  const {addOnCurvePoint}=await import('/src/domain/landmarks/placement' as string);
  const {createCurve}=await import('/src/domain/curves/management' as string);
  const {diagnostics}=await import('/src/domain/geometry/diagnostics' as string);
  const raw=await (await fetch('/artifacts/basic-patch/adjusted-source.json')).text();
  let p=parseLandmarks(raw);
  const {addPatch}=await import('/src/domain/patches/model' as string);
  // Build two source patches from existing triangular cycles, preserving source curves.
  outer:for(let i=0;i<p.curves.length;i++)for(let j=i+1;j<p.curves.length;j++)for(let k=j+1;k<p.curves.length;k++){
   try{p=addPatch(p,[p.curves[i].id,p.curves[j].id,p.curves[k].id]);if(p.patches.length>=4)break outer;}catch{}
  }
  p={...p,patchDisplay:{visible:true,quality:'low',opacity2d:.9,opacity3d:.7}};
  const host=p.curves.find((c:any)=>c.role==='canonical');const a=addOnCurvePoint(p,host.id);p=a.project;
  const settle=()=>new Promise(r=>setTimeout(r,250));
  const out:Record<string,unknown>={};
  useEditor.getState().load(p);await settle();diagnostics.reset();
  useEditor.getState().beginEdit();useEditor.getState().setOnCurveS(a.selectedId,.6);useEditor.getState().endEdit();await settle();out.isolated=diagnostics.snapshot();
  const target=p.landmarks.find((l:any)=>l.placement.kind==='WORLD'&&l.type===p.landmarks.find((x:any)=>x.id===a.selectedId).type&&l.id!==host.startLandmarkId)!;
  const r=createCurve(p,a.selectedId,target.id,p.views[0],'Performance downstream');useEditor.getState().load(r.project);await settle();diagnostics.reset();
  useEditor.getState().beginEdit();useEditor.getState().setOnCurveS(a.selectedId,.6);useEditor.getState().endEdit();await settle();out.downstream=diagnostics.snapshot();
  diagnostics.reset();const c=useEditor.getState().project.curves.find((x:any)=>x.id===host.id);useEditor.getState().beginEdit();useEditor.getState().setCurveShape(c.id,{...c.shape,startHandle:{...c.shape.startHandle,offset:c.shape.startHandle.offset+.03}});useEditor.getState().endEdit();await settle();out.curveHandle=diagnostics.snapshot();
  diagnostics.reset();useEditor.getState().beginEdit();useEditor.getState().setFullness(p.patches[0].id,.2);useEditor.getState().endEdit();await settle();out.fullness=diagnostics.snapshot();
  (window as any).__perfFixture={p,pointId:a.selectedId};out.debug={enabled:(await import('/src/domain/geometry/diagnostics' as string)).diagnosticsEnabled,message:useEditor.getState().message,patches:p.patches?.length};return out;
 });
 mkdirSync('artifacts/performance',{recursive:true});writeFileSync(`artifacts/performance/${process.env.PERF_STAGE??'current'}.json`,JSON.stringify(results,null,2));expect(results.isolated).toBeTruthy();
 if(process.env.PERF_STAGE!=='baseline')for(const key of ['patchEvaluations','patchTessellations','arcLengthLUTBuilds','threeBufferRebuilds','occlusionCandidateTests'])expect((results.isolated as any).counters[key]??0,key).toBe(0);
 await page.evaluate(()=>{const w=window as any,warm=w.__perfFixture;w.__editorPerfStore.getState().load({...warm.p,surfaceSmooth:{enabled:true,strength:1,edgeInfluenceOverrides:{}}});});
 await page.locator('.patch-panel .section-heading').click();
 await expect(page.getByTestId('continuity-status')).toHaveAttribute('data-state',/ready|natural|warning/);
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');
 await page.waitForTimeout(600);
 await page.evaluate(()=>{const w=window as any;w.__geometryPerformance.reset();const s=w.__editorPerfStore.getState();s.beginEdit(true);s.setOnCurveS(w.__perfFixture.pointId,.731);s.endEdit();});
 await page.waitForTimeout(700);
 const work=await page.evaluate(()=>(window as any).__geometryPerformance.snapshot());
 for(const key of ['patchEvaluations','patchTessellations','arcLengthLUTBuilds','threeBufferRebuilds','smoothDispatches','contourDispatches'])expect(work.counters[key]??0,key).toBe(0);
 expect(work.counters.autosaveWrites).toBe(1);
 writeFileSync('artifacts/performance/isolated-workers.json',JSON.stringify(work,null,2));
 await page.evaluate(()=>(window as any).__geometryPerformance.reset());
 const box=(await page.getByTestId('point-inspect').locator('canvas').boundingBox())!;await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6);await page.mouse.down();await page.mouse.move(box.x+box.width*.6+45,box.y+box.height*.6+20,{steps:8});await page.mouse.up();await page.waitForTimeout(200);
 const orbit=await page.evaluate(()=>(window as any).__geometryPerformance.snapshot());for(const key of ['patchTessellations','threeBufferRebuilds','threeCurveBufferRebuilds'])expect(orbit.counters[key]??0,key).toBe(0);
 
});
