import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const source=JSON.parse(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8'));
test.use({viewport:{width:1600,height:1050},deviceScaleFactor:2});
for(const renderer of ['cpu','gpu'])test(`${renderer} real HeadShell A/B/C/D/E workload`,async({page})=>{
 test.setTimeout(180000);await page.goto('/?renderer='+renderer);await expect(page.locator('input[type=file][accept=".json,application/json"]')).toBeAttached();
 const results:any={};
 for(const scenario of ['A','B','C','D','E']){
  await page.evaluate(async({source,scenario})=>{
   const w=window as any,{useWindows}=await import('/src/ui/windows/state.ts' as string);useWindows.setState({visible:{viewport:true,threeD:true,contour:scenario==='C'}});
   const {parseLandmarks}=await import('/src/domain/landmarks/persistence.ts' as string);
   w.__editorPerfStore.getState().load({...parseLandmarks(JSON.stringify(source)),patchDisplay:{visible:true,quality:'medium',opacity2d:.75,opacity3d:.7},surfaceSmooth:{...source.surfaceSmooth,enabled:['B','C'].includes(scenario)}});
   w.__editorPerfStore.getState().setCanvas({zoom:1,pan:[0,0]});
  },{source,scenario});
  await expect.poll(()=>page.evaluate(async()=>{
   const s=(window as any).__editorPerfStore.getState(),{getSmoothResult}=await import('/src/domain/smooth/evaluation.ts' as string);return !s.project.surfaceSmooth.enabled||!!getSmoothResult(s.project);
  })).toBe(true);
  if(scenario==='C')await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');
  await page.waitForTimeout(200);
  if(scenario==='D'){
   // Pick a real boundary curve, then drag the actual SVG handle.
   await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.selectView('right45');s.setCanvas({zoom:.85,pan:[0,0]});s.selectCurve(s.project.curves.find((c:any)=>c.name==='左面壳前边界·额颞至颧颊').id);});
   await expect(page.getByTestId('curve-handle-1')).toBeVisible();
  }
  await page.evaluate(()=>{const w=window as any;w.__geometryPerformance.reset();w.__frameTimes=[];w.__collectFrames=true;let prev=performance.now();const loop=(t:number)=>{if(!w.__collectFrames)return;w.__frameTimes.push(t-prev);prev=t;requestAnimationFrame(loop);};requestAnimationFrame(loop);});
  const started=Date.now();
  if(scenario==='D'){
   await page.getByTestId('curve-handle-1').hover({timeout:5000});
   const b=(await page.getByTestId('curve-handle-1').boundingBox())!;await page.mouse.down();
   for(let i=1;i<=40;i++){await page.mouse.move(b.x+b.width/2+25*Math.sin(i/40*Math.PI),b.y+b.height/2+12*i/40);await page.waitForTimeout(16);}await page.mouse.up();
  }else{
   await page.evaluate(async(scenario)=>{
    const w=window as any,store=w.__editorPerfStore,s=store.getState(),id=s.project.patches.find((x:any)=>!x.canonicalId).id;
    if(scenario!=='E')s.beginEdit();for(let i=1;i<=60;i++){
     if(scenario==='E')store.getState().setCanvas({zoom:1+.3*Math.sin(i/60*Math.PI),pan:[i/2,-i/3]});
     else store.getState().setFullness(id,.45*i/60+(scenario==='B'?.01:scenario==='C'?.02:0));
     await new Promise(requestAnimationFrame);
    }if(scenario!=='E')store.getState().endEdit();
   },scenario);
  }
  results[scenario]=await page.evaluate(()=>{const w=window as any;w.__collectFrames=false;const frames=w.__frameTimes.slice(2).sort((a:number,b:number)=>a-b);return {...w.__geometryPerformance.snapshot(),frames:frames.length,medianFrameMs:frames[Math.floor(frames.length*.5)],p95FrameMs:frames[Math.floor(frames.length*.95)],svgTriangles:document.querySelectorAll('[data-layer=surface-render] path').length};});
  results[scenario].elapsedMs=Date.now()-started;
  if(scenario==='D'){expect(results[scenario].counters.sourceUpdates??0).toBeGreaterThan(20);expect(results[scenario].counters.dirtyPatches??0).toBeGreaterThan(0);}
  if(renderer==='gpu'){expect(results[scenario].counters.occlusionCandidateTests??0).toBe(0);expect(results[scenario].svgTriangles).toBe(0);if(scenario==='E')for(const k of ['gpuSurfaceUploads','gpuCurveUploads','patchTessellations','threeBufferRebuilds','smoothDispatches'])expect(results[scenario].counters[k]??0,k).toBe(0);}
  const settleStarted=Date.now();
  await expect.poll(()=>page.evaluate(async()=>{const s=(window as any).__editorPerfStore.getState(),{getSmoothResult}=await import('/src/domain/smooth/evaluation.ts' as string);return !s.project.surfaceSmooth.enabled||!!getSmoothResult(s.project);})).toBe(true);
  if(scenario==='C')await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false');
  await page.waitForTimeout(100);results[scenario].settleMs=Date.now()-settleStarted;results[scenario].settledCounters=await page.evaluate(()=>(window as any).__geometryPerformance.snapshot().counters);
 }
 mkdirSync('artifacts/gpu-renderer',{recursive:true});writeFileSync(`artifacts/gpu-renderer/performance-${renderer}.json`,JSON.stringify(results,null,2));
});
