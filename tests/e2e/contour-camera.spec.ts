import {test,expect} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';

test.use({trace:'off',viewport:{width:1800,height:1100}});

test('settled full head: continuous camera rotation installs contours without geometry work/uploads',async({page})=>{
 test.setTimeout(60000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles('artifacts/surface-smooth/full-head-regression.json');
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();
 await page.waitForTimeout(7000);
 const preview=page.getByTestId('contour-preview');await expect(preview).toHaveAttribute('aria-busy','false');
 const geometryBefore=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project));
 const rect=await page.getByTestId('point-inspect').locator('canvas').boundingBox();if(!rect)throw Error('canvas');
 await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);await page.mouse.down();
 await page.evaluate(()=>{const m=(window as any).__contourProfile;for(const k in m)m[k]=Array.isArray(m[k])?[]:0;(window as any).__geometryPerformance.reset();});
 const start=Date.now();
 while(Date.now()-start<3000){const t=(Date.now()-start)/3000;await page.mouse.move(rect.x+rect.width*(.5+.23*Math.sin(t*8)),rect.y+rect.height*(.5+.12*Math.sin(t*5)));await page.waitForTimeout(16);}
 const during=await page.evaluate(()=>({profile:(window as any).__contourProfile,geometry:(window as any).__geometryPerformance.snapshot()}));
 await page.mouse.up();await expect(preview).toHaveAttribute('aria-busy','false',{timeout:10000});
 const after=await page.evaluate(()=>({profile:(window as any).__contourProfile,geometry:(window as any).__geometryPerformance.snapshot()}));
 mkdirSync('artifacts/contour-camera',{recursive:true});writeFileSync('artifacts/contour-camera/fixed.json',JSON.stringify({during,after},null,2));
 expect(during.profile.camera).toBeGreaterThan(30);
 expect(during.profile.installed).toBeGreaterThan(25); // Detect the original zero-update starvation.
 expect(during.profile.uploads).toBe(0);expect(during.profile.surfaceBytes).toBe(0);
 expect(during.profile.bytes/during.profile.requests).toBeLessThan(160);
 for(const key of ['sourceUpdates','dirtyPoints','dirtyCurves','dirtyPatches','pointEvaluations','curveEvaluations','patchEvaluations','patchTessellations','threeBufferRebuilds','threeCurveBufferRebuilds','smoothDispatches','renderEditView','renderPatchLayer','renderLandmarkList','renderCurvePanel','renderPatchPanel','renderOnCurveInspector'])expect(after.geometry.counters[key]??0,key).toBe(0);
 expect(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project))).toBe(geometryBefore);
 expect(errors).toEqual([]);
 mkdirSync('artifacts/contour-camera',{recursive:true});writeFileSync('artifacts/contour-camera/fixed.json',JSON.stringify({during,after},null,2));
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).uncheck();
 const n=await page.evaluate(()=>(window as any).__contourProfile.requests);await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.6,{steps:10});await page.mouse.up();await page.waitForTimeout(300);
 expect(await page.evaluate(()=>(window as any).__contourProfile.requests)).toBe(n);
});

test('worker keeps one latest request; cancels obsolete work without replacing its surface',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const response=await fetch('/artifacts/surface-smooth/full-head-regression.json');
  const {parseLandmarks}=await import('/src/domain/landmarks/persistence.ts' as string);
  const source=parseLandmarks(await response.text());
  const worker=new Worker('/src/ui/windows/contour.worker.ts',{type:'module'});
  const messages:any[]=[];
  return await new Promise<any>((resolve,reject)=>{
   const timeout=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'));},15000);
   worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(Error(e.message));};
   worker.onmessage=e=>{if(e.data.type==='STARTED')return;messages.push(e.data);if(e.data.id===100&&e.data.type==='RESULT'){clearTimeout(timeout);worker.terminate();resolve(messages);}};
   worker.postMessage({type:'SET_SURFACE',revision:'1',source});
   worker.postMessage({type:'RENDER',revision:'1',id:1,orientation:[0,0,0,1]});
   // Burst exercises cooperative yield + pending overwrite while first job is active.
   for(let id=2;id<=100;id++)worker.postMessage({type:'RENDER',revision:'1',id,orientation:[0,Math.sin(id/400),0,Math.cos(id/400)]});
  });
 });
 expect(result.some((x:any)=>x.type==='CANCELLED')).toBe(true);
 expect(result.filter((x:any)=>x.type==='RESULT').map((x:any)=>x.id)).toEqual([100]);
 expect(result.length).toBeLessThan(10);
 expect(result.at(-1).resolution).toBe(768);expect(result.at(-1).triangleCount).toBeGreaterThan(10000);
});
