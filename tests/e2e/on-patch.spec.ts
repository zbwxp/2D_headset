import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
import {spanFixture} from '../../src/tests/span-fixture';
import {addPatch} from '../../src/domain/patches/model';
async function setup(page:Page){
 const f=spanFixture(),p=addPatch(f.p,[f.use,f.ac,f.bc]);await page.goto('/');
 await page.evaluate(p=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.selectView('front');s.setCanvas({zoom:3,pan:[-260,140]});s.selectObject({kind:'surface',source:'PATCH',id:p.patches![0].id});},p);
 await page.evaluate(async id=>{const s=(window as any).__editorPerfStore.getState(),{evaluationContext}=await import('/src/domain/geometry/evaluation.ts' as string),q=evaluationContext(s.project).curve(id).evaluate(.5);s.setCanvas({zoom:5,pan:[-q[0]*160*5,q[1]*160*5]});},f.ac);
 return {f,host:p.patches![0].id};
}
async function curveXY(page:Page,id:string,t:number){return page.evaluate(async({id,t})=>{const s=(window as any).__editorPerfStore.getState(),{evaluationContext}=await import('/src/domain/geometry/evaluation.ts' as string),{worldToScreen,orthographicView}=await import('/src/rendering/orthographic.ts' as string),r=document.querySelector('[data-testid=point-editor]')!.getBoundingClientRect(),v=s.project.views.find((x:any)=>x.id===s.viewId),q=worldToScreen(evaluationContext(s.project).curve(id).evaluate(t),orthographicView(v.camera,v.canvas,r.width,r.height));return {x:r.x+q[0],y:r.y+q[1]};},{id,t});}
async function start(page:Page){await page.locator('.creation-shelf summary').filter({hasText:'曲线'}).click();await page.getByRole('button',{name:'贴面曲线',exact:true}).click();}
test('2D draft boundary points + ON_PATCH commit atomically, cancel, role, drag and derived Inspector',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const {f,host}=await setup(page);
 const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {points:s.project.landmarks.length,curves:s.project.curves.length,history:s.past.length};});
 await start(page);
 for(const [id,t] of [[f.ac,.35],[f.bc,.5]] as const){const q=await curveXY(page,id,t);await page.mouse.click(q.x,q.y);}
 await expect(page.getByTestId('on-patch-preview').first()).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.curves.length)).toBe(before.curves);
 await page.screenshot({path:'artifacts/v062/2d-on-patch-preview.png'});
 await page.getByRole('button',{name:'确认创建贴面曲线'}).click();
 const id=await page.evaluate(()=>(window as any).__editorPerfStore.getState().selectedCurveId);
 await expect(page.getByTestId('inline-inspector')).toContainText('贴面曲线');await expect(page.getByRole('checkbox',{name:'显示在 Contour 中',exact:true})).toBeChecked();await expect(page.getByTestId('curve-handle-1')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length)).toBe(before.history+1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.length)).toBe(before.points);
 await page.getByRole('button',{name:'重做',exact:true}).click();await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),id);
 await page.getByRole('checkbox',{name:'显示在 Contour 中',exact:true}).uncheck();await page.getByRole('checkbox',{name:'显示在 Contour 中',exact:true}).check();
 await page.getByRole('button',{name:'添加曲线定位点',exact:true}).click();await expect(page.getByRole('slider',{name:'在线位置',exact:true})).toBeVisible();
 await page.evaluate(host=>(window as any).__editorPerfStore.getState().selectObject({kind:'surface',source:'PATCH',id:host}),host);
 await start(page);const q=await curveXY(page,f.ac,.2);await page.mouse.click(q.x,q.y);
 const source=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project));await page.getByRole('button',{name:'取消 Esc'}).click();expect(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project))).toBe(source);
 expect(errors).toEqual([]);
});
test('four Host topologies render, endpoint 2D drag and Fullness update derived geometry',async({page})=>{
 const {onPatchExample}=await import('../helpers/onPatchExamples');const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 for(const type of ['tri','quad','lens','loop'] as const){
  const f=onPatchExample(type);mkdirSync("artifacts/v062",{recursive:true});writeFileSync("artifacts/v062/"+type+"-example.json",JSON.stringify(f.project,null,2));
  await page.evaluate(async f=>{const s=(window as any).__editorPerfStore.getState();s.load(f.project);s.setScaffold('visible',false);s.selectView('front');s.selectCurve(f.curveId);const {evaluationContext}=await import('/src/domain/geometry/evaluation.ts' as string),q=evaluationContext((window as any).__editorPerfStore.getState().project).curve(f.curveId).evaluate(.5),zoom=f.project.patches[0].type==='loop'?1:4;s.setCanvas({zoom,pan:[-q[0]*160*zoom,q[1]*160*zoom]});},f);
  await expect(page.getByTestId('inline-inspector')).toContainText('贴面曲线');
  await page.screenshot({path:'artifacts/v062/'+type+'-host.png'});
  const evaluate=()=>page.evaluate(async id=>{const {evaluationContext}=await import('/src/domain/geometry/evaluation.ts' as string);return evaluationContext((window as any).__editorPerfStore.getState().project).curve(id).evaluate(.5);},f.curveId);
  const before=await evaluate();
  await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectObject({kind:'surface',source:'PATCH',id}),f.hostId);
  await page.getByRole('slider',{name:'面凸度',exact:true}).fill('35');expect(await evaluate()).not.toEqual(before);
  if(type==='tri'){
   const xy=await page.evaluate(async id=>{const s=(window as any).__editorPerfStore.getState(),{evaluationContext}=await import('/src/domain/geometry/evaluation.ts' as string),{worldToScreen,orthographicView}=await import('/src/rendering/orthographic.ts' as string),r=document.querySelector('[data-testid=point-editor]')!.getBoundingClientRect(),v=s.project.views.find((x:any)=>x.id===s.viewId),q=worldToScreen(evaluationContext(s.project).pointPosition(id),orthographicView(v.camera,v.canvas,r.width,r.height));return {x:r.x+q[0],y:r.y+q[1]};},f.startId);
   const old=await evaluate();await page.mouse.move(xy.x,xy.y);await page.mouse.down();await page.mouse.move(xy.x+18,xy.y+10,{steps:6});await page.mouse.up();expect(await evaluate()).not.toEqual(old);
  }
 }
 expect(errors).toEqual([]);
});

test('jaw OPEN_EDGE appears in real HeadShell Contour through the existing worker',async({page})=>{
 test.setTimeout(60000);await page.goto('/');
 const raw=readFileSync('tests/fixtures/continuity-overlap-head.json','utf8');
 const r=await page.evaluate(async raw=>{
  const {parseLandmarks}=await import('/src/domain/landmarks/persistence.ts' as string),{domainBoundaries}=await import('/src/domain/patches/domain.ts' as string),{createOnPatch}=await import('/src/domain/curves/onPatch.ts' as string),{addOnCurvePoint,setOnCurveS}=await import('/src/domain/landmarks/placement.ts' as string),{boundaryParameters}=await import('/src/domain/patches/boundary.ts' as string),{evaluationContext}=await import('/src/domain/geometry/evaluation.ts' as string),{tToNormalizedArcLength}=await import('/src/domain/geometry/bezier.ts' as string),{useWindows,useInspectionCamera}=await import('/src/ui/windows/state.ts' as string);
  let p=parseLandmarks(raw);const h=p.patches.find((x:any)=>x.id==='6a31f047-573a-4ee0-aaaf-e7399a747488'),b=domainBoundaries(p,h),ids=[];for(let i=0;i<2;i++){const q=b[i],{t0,t1}=boundaryParameters(p,q),s=tToNormalizedArcLength(evaluationContext(p).curve(q.curveId).arcLengthLUT(),t0+(t1-t0)*.5),a=addOnCurvePoint(p,q.curveId);p=setOnCurveS(a.project,a.selectedId,s);ids.push(a.selectedId);}const r=createOnPatch(p,h.id,ids[0],ids[1]);
  const s=(window as any).__editorPerfStore.getState();s.load(r.project);s.selectCurve(r.selectedId);useWindows.setState({visible:{viewport:true,contour:true,threeD:false}});useInspectionCamera.setState({quaternion:[0,0,0,1],position:[0,0,5]});return r;
 },raw);
 writeFileSync('artifacts/v062/jaw-contour-example.json',JSON.stringify(r.project,null,2));
 const preview=page.getByTestId('contour-preview');await expect(preview).toHaveAttribute('aria-busy','false',{timeout:30000});
 const shown=await preview.locator('svg').innerHTML();await page.screenshot({path:'artifacts/v062/jaw-open-edge.png'});
 await page.getByRole('checkbox',{name:'显示在 Contour 中',exact:true}).uncheck();await expect.poll(()=>preview.locator('svg').innerHTML(),{timeout:30000}).not.toBe(shown);await expect(preview).toHaveAttribute('aria-busy','false');
 await page.screenshot({path:'artifacts/v062/jaw-role-none.png'});
 await page.evaluate(async()=>{const {useInspectionCamera}=await import('/src/ui/windows/state.ts' as string);useInspectionCamera.setState({quaternion:[0,1,0,0],position:[0,0,-5]});});await expect(preview).toHaveAttribute('aria-busy','false',{timeout:30000});
 await page.getByRole('checkbox',{name:'显示在 Contour 中',exact:true}).check();await page.waitForTimeout(700);await expect(preview).toHaveAttribute('aria-busy','false');await page.screenshot({path:'artifacts/v062/jaw-rear-exposure.png'});
});
