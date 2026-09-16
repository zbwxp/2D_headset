import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const source=JSON.parse(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8'));
const fixture={...source,patchDisplay:{visible:true,quality:'low',opacity2d:.75,opacity3d:.7},surfaceSmooth:{...source.surfaceSmooth,enabled:false}};
test.use({viewport:{width:1600,height:1050},deviceScaleFactor:2});
test('GPU head shell projection, overlay, zero CPU occlusion and camera uploads',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/?renderer=gpu');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'gpu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 await expect(page.getByTestId('gpu-derived-canvas')).toBeVisible();await page.waitForTimeout(600);
 expect(await page.getByTestId('cpu-svg-renderer').count()).toBe(0);expect(await page.locator('[data-layer=surface-render] path').count()).toBe(0);
 for(const name of ['正面','右 45°','侧面']){
  await page.getByRole('button',{name,exact:true}).first().click();await page.waitForTimeout(180);
  const result=await page.evaluate(async()=>{
   const {Camera,Vector3}=await import('/node_modules/.vite/deps/three.js' as string),{applyCamera}=await import('/src/rendering/edit2d/GpuScene.ts' as string),{orthographicView,worldToScreen}=await import('/src/rendering/orthographic.ts' as string),{pointPosition}=await import('/src/domain/geometry/evaluation.ts' as string);
   const s=(window as any).__editorPerfStore.getState(),v=s.project.views.find((v:any)=>v.id===s.viewId),box=document.querySelector('[data-testid=point-editor]')!.getBoundingClientRect(),state=orthographicView(v.camera,v.canvas,box.width,box.height,devicePixelRatio),camera=new Camera();applyCamera(camera,state);let max=0;
   for(const l of s.project.landmarks){const p=pointPosition(s.project,l.id),q=new Vector3(...p).project(camera),expected=worldToScreen(p,state);max=Math.max(max,Math.hypot((q.x+1)*box.width/2-expected[0],(1-q.y)*box.height/2-expected[1]));}
   const canvas=document.querySelector('[data-testid=gpu-derived-canvas]') as HTMLCanvasElement;return {max,width:canvas.width,cssWidth:box.width,dpr:devicePixelRatio};
  });expect(result.max).toBeLessThan(.1);expect(Math.abs(result.width-result.cssWidth*result.dpr)).toBeLessThan(2);
  await page.screenshot({path:`artifacts/gpu-renderer/gpu-${name}.png`});
 }
 await page.evaluate(()=>{(window as any).__geometryPerformance.reset();});
 await page.evaluate(async()=>{const s=(window as any).__editorPerfStore;for(let i=0;i<20;i++){s.getState().setCanvas({zoom:1+i*.03,pan:[i,-i]});await new Promise(requestAnimationFrame);}});await page.waitForTimeout(150);
 const counts=await page.evaluate(()=>(window as any).__geometryPerformance.snapshot());
 for(const k of ['gpuSurfaceUploads','gpuCurveUploads','occlusionCandidateTests','patchTessellations','curveEvaluations'])expect(counts.counters[k]??0,k).toBe(0);expect(counts.counters.gpuFrames).toBeGreaterThan(0);
 const id=fixture.curves[0].id;await page.getByTestId(`curve-hit-${id}`).dispatchEvent('pointerdown',{button:0,clientX:600,clientY:400,pointerId:1});await page.getByTestId('point-editor').dispatchEvent('pointerup',{pointerId:1});
 await expect(page.getByTestId(`curve-${id}`)).toHaveAttribute('opacity','1');await expect(page.getByTestId('curve-handle-1')).toBeVisible();
 await page.setViewportSize({width:1200,height:950});await page.waitForTimeout(150);await page.screenshot({path:'artifacts/gpu-renderer/gpu-zoom-dpr2.png'});
 expect(errors).toEqual([]);
});
test('nearest-only alpha, front/xray strength, boundary stability and DPR AA use actual GPU pixels',async({page})=>{
 await page.goto('/?renderer=gpu');await expect(page.getByTestId('gpu-derived-canvas')).toBeVisible();
 const results=await page.evaluate(async()=>{
  const {WebGLRenderer}=await import('/node_modules/.vite/deps/three.js' as string),{GpuScene}=await import('/src/rendering/edit2d/GpuScene.ts' as string),{orthographicView,worldToScreen}=await import('/src/rendering/orthographic.ts' as string);
  const r=new WebGLRenderer({alpha:true,antialias:true,stencil:true});r.autoClear=false;r.sortObjects=false;r.setClearColor(0,0);r.setSize(600,560);const scene=new GpuScene();
  const out:any[]=[];
  for(const dpr of [1,2])for(const yaw of [0,45,90]){
   r.setPixelRatio(dpr);const rad=yaw*Math.PI/180,view=orthographicView({position:[Math.sin(rad),0,Math.cos(rad)],target:[0,0,0],up:[0,1,0]},{zoom:1,pan:[0,0]},600,560,dpr);
   const world=(x:number,y:number,z:number)=>[view.right[0]*x+view.up[0]*y+view.forward[0]*z,view.right[1]*x+view.up[1]*y+view.forward[1]*z,view.right[2]*x+view.up[2]*y+view.forward[2]*z];
   const mesh=(z:number,id:string)=>({id,geometryToken:id+yaw,positions:new Float32Array([world(-1,-1,z),world(1,-1,z),world(1,1,z),world(-1,1,z)].flat()),indices:new Uint32Array([0,1,2,0,2,3]),normals:new Float32Array(Array.from({length:4},()=>view.forward).flat())});
   const curve=(y:number,z:number,id:string)=>({id,geometryToken:id+yaw,samples:new Float32Array([world(-.9,y,z),world(.9,y,z)].flat())});
   scene.update({surface:[mesh(-.5,'back'),mesh(0,'front'),mesh(0,'coincident')],curves:[curve(.3,.2,'visible'),curve(-.3,-.2,'hidden'),curve(1,0,'boundary')],geometryToken:'test'}, {surfaceOpacity:.75,hiddenCurveOpacity:.25,selectedCurveIds:new Set()});scene.draw(r,view);
   // Test-only pixel inspection via browser canvas compositor, never used for picking.
   const image=document.createElement('canvas');image.width=r.domElement.width;image.height=r.domElement.height;const ctx=image.getContext('2d')!;ctx.drawImage(r.domElement,0,0);
   const at=(x:number,y:number)=>{const p=worldToScreen(world(x,y,0),view);return [...ctx.getImageData(Math.floor(p[0]*dpr),Math.floor(p[1]*dpr),1,1).data];};
   out.push({dpr,yaw,surface:at(.1,.1),front:at(0,.3),back:at(0,-.3),boundary:at(0,1)});
  }
  scene.dispose();r.dispose();r.forceContextLoss();return out;
 });
 for(const r of results){expect(r.surface[3],JSON.stringify(r)).toBeGreaterThanOrEqual(190);expect(r.surface[3]).toBeLessThanOrEqual(193);expect(r.front[3]).toBeGreaterThan(235);expect(r.back[3]).toBeLessThan(226);expect(r.back[3]).toBeGreaterThan(198);expect(r.boundary[3]).toBeGreaterThan(230);}
 mkdirSync('artifacts/gpu-renderer',{recursive:true});writeFileSync('artifacts/gpu-renderer/pixel-check.json',JSON.stringify(results,null,2));
});
test('opacity/selection reuse resources; hiding and reopening Main 2D disposes its context',async({page})=>{
 await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'gpu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await expect(page.getByTestId('gpu-derived-canvas')).toBeVisible();await page.waitForTimeout(200);
 await page.evaluate(()=>{const w=window as any;w.__geometryPerformance.reset();const s=w.__editorPerfStore.getState();s.setPatchDisplay('opacity2d',.5);s.selectCurve(s.project.curves[0].id);});
 await page.waitForTimeout(100);let counts=await page.evaluate(()=>(window as any).__geometryPerformance.snapshot().counters);for(const k of ['gpuSurfaceUploads','gpuCurveUploads','patchTessellations','curveEvaluations'])expect(counts[k]??0,k).toBe(0);
 for(let i=0;i<3;i++){await page.getByRole('checkbox',{name:'显示 2D 视角 窗口',exact:true}).uncheck();await expect(page.getByTestId('gpu-derived-canvas')).toHaveCount(0);await page.getByRole('checkbox',{name:'显示 2D 视角 窗口',exact:true}).check();await expect(page.getByTestId('gpu-derived-canvas')).toBeVisible();}
 counts=await page.evaluate(()=>(window as any).__geometryPerformance.snapshot().counters);expect(counts.gpuRendererDisposed).toBeGreaterThanOrEqual(3);await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveCount(1);
});
test('DPR1 high-quality zoom screenshot keeps GPU and overlay aligned',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1400,height:1000},deviceScaleFactor:1}),page=await context.newPage();
 try{
  await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'gpu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...fixture,patchDisplay:{...fixture.patchDisplay,quality:'high'}}))});
  await expect(page.getByTestId('gpu-derived-canvas')).toBeVisible();await page.getByRole('button',{name:'右 45°',exact:true}).first().click();
  await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.setCanvas({zoom:1.6,pan:[0,0]});});await page.waitForTimeout(200);await page.screenshot({path:'artifacts/gpu-renderer/gpu-dpr1-high-zoom.png'});
  const result=await page.getByTestId('gpu-derived-canvas').evaluate(c=>({width:(c as HTMLCanvasElement).width,css:c.getBoundingClientRect().width,dpr:devicePixelRatio}));expect(result.dpr).toBe(1);expect(Math.abs(result.width-result.css)).toBeLessThan(1);
 }finally{await context.close();}
});
test('high-subdivision head color covers every fully covered depth sample',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('gpu-derived-canvas')).toBeVisible();
 const result=await page.evaluate(async(raw)=>{
  const {WebGLRenderer}=await import('/node_modules/.vite/deps/three.js' as string),{GpuScene}=await import('/src/rendering/edit2d/GpuScene.ts' as string),{orthographicView}=await import('/src/rendering/orthographic.ts' as string),{editRenderSnapshot}=await import('/src/app/renderSnapshot.ts' as string),{parseLandmarks}=await import('/src/domain/landmarks/persistence.ts' as string);
  const p=parseLandmarks(JSON.stringify(raw)),snapshot=editRenderSnapshot(p,{subdivisions:24,curveSegments:96,includeSurface:true});snapshot.curves=[];
  const r=new WebGLRenderer({alpha:true,antialias:true,stencil:true});r.setSize(700,700);r.setClearColor(0,0);r.autoClear=false;const scene=new GpuScene(),v=orthographicView(p.views.find((v:any)=>v.id==='right45').camera,{zoom:1.6,pan:[0,0]},700,700,1);
  const image=document.createElement('canvas');image.width=image.height=700;const ctx=image.getContext('2d')!;const pixels=()=>{ctx.clearRect(0,0,700,700);ctx.drawImage(r.domElement,0,0);return ctx.getImageData(0,0,700,700).data;};
  scene.update(snapshot,{surfaceOpacity:.75,hiddenCurveOpacity:.25,selectedCurveIds:new Set()});scene.draw(r,v);const actual=pixels();
  scene.depthMaterial.colorWrite=true;r.clear(true,true,true);r.render(scene.depthScene,scene.camera);const mask=pixels();let holes=0,interior=0;
  for(let i=3;i<mask.length;i+=4)if(mask[i]>250){interior++;if(actual[i]<160)holes++;}
  scene.dispose();r.dispose();r.forceContextLoss();return {holes,interior};
 },fixture);
 expect(result.interior).toBeGreaterThan(20000);expect(result.holes).toBeLessThan(5);
});
