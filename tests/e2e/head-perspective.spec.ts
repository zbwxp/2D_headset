import {test,expect} from '@playwright/test';

test('HeadSet XY display perspective, history, persistence, aligned picking and inverse 3D handle edits',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const id=await page.evaluate(async()=>{
  const presets='/src/domain/landmarks/presets.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(presets)).createLandmarkProject());
  const p=(window as any).__editorPerfStore.getState().project,a=p.landmarks.find((l:any)=>l.name==='下巴尖点'),b=p.landmarks.find((l:any)=>l.name==='右外眼角点');
  s.startCurve();s.pickCurveEndpoint(a.id);s.pickCurveEndpoint(b.id);
  const id=(window as any).__editorPerfStore.getState().selectedCurveId;s.selectObject({kind:'frame',id:'head'});
  const state=performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/src/ui/windows/state.ts'))!;
  const {useWindows}=await import(state);useWindows.getState().setView('viewport','right45');s.selectView('right45');return id;
 });
 const read=()=>page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {settings:s.project.headPerspective,eye:s.project.eyeScaffold,source:JSON.stringify([s.project.headFrame,s.project.landmarks,s.project.curves,s.project.patches]),past:s.past.length};});
 const before=await read(),path=page.getByTestId(`curve-hit-${id}`),original=await path.getAttribute('d');
 const panel=page.getByTestId('head-perspective');await expect(panel).toBeVisible();
 for(const [axis,value] of [['X','1'],['Y','.7']]){const slider=panel.getByRole('slider',{name:`${axis} Perspective Strength`,exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();const input=slider.locator('..').locator('.numeric-slider-entry');await input.fill(value);await input.press('Enter');}
 const changed=await read();expect(changed.settings).toEqual({x:1,y:.7});expect(changed.source).toBe(before.source);expect(changed.eye).toEqual(before.eye);expect(changed.past).toBe(before.past+2);
 await expect.poll(()=>path.getAttribute('d')).not.toEqual(original);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await read()).settings).toEqual({x:1,y:0});
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await read()).settings).toEqual({x:1,y:.7});
 await page.evaluate(async()=>{const path='/src/domain/landmarks/persistence.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(path)).parseLandmarks(JSON.stringify(s.project)));});expect((await read()).settings).toEqual({x:1,y:.7});
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),id);
 const handle=page.getByTestId('point-inspect').getByTestId('inspect-curve-handle-1');await expect(handle).toBeVisible();
 const start=(await handle.boundingBox())!,a=await read();
 await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(start.x+start.width/2+24,start.y+start.height/2-15,{steps:6});await page.mouse.up();
 const end=(await handle.boundingBox())!;expect(end.x-start.x).toBeCloseTo(24,0);expect(end.y-start.y).toBeCloseTo(-15,0);expect((await read()).past).toBe(a.past+1);
 await page.keyboard.press('Control+z');expect((await read()).source).toEqual(a.source);
 // Pick a transformed source point in 3D using the actual camera. No orbit input.
 const hit=await page.evaluate(async id=>{
  const s=(window as any).__editorPerfStore.getState(),p=s.project,c=p.curves.find((c:any)=>c.id===id),pointId=c.endLandmarkId;
  const m='/src/rendering/moduleDisplay.ts',g='/src/domain/geometry/evaluation.ts',t='/node_modules/.vite/deps/three.js',state=performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/src/ui/windows/state.ts'))!,T=await import(t),pose=(await import(state)).useInspectionCamera.getState(),r=document.querySelector('[data-testid="point-inspect"] canvas')!.getBoundingClientRect();
  const camera=new T.PerspectiveCamera(pose.fov,r.width/r.height,.1,100);camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();
  const facing=new T.Vector3(0,0,1).applyQuaternion(camera.quaternion).toArray(),world=(await import(m)).displayPoint(p,pointId,(await import(g)).pointPosition(p,pointId),facing),q=new T.Vector3(...world).project(camera);s.selectObject(null);return {id:pointId,x:r.left+(q.x+1)*r.width/2,y:r.top+(1-q.y)*r.height/2};
 },id);
 await page.mouse.move(hit.x,hit.y);await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-hover-point',hit.id);await page.mouse.click(hit.x,hit.y);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selectedId)).toBe(hit.id);
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.selectObject({kind:'frame',id:'head'});});
 await page.screenshot({path:'artifacts/scaffold/head-perspective.png'});expect(errors).toEqual([]);
});

test('final surfaces and Contour respond to independent HeadSet perspective and orbit',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.evaluate(async()=>{const presets='/src/domain/landmarks/presets.ts',frame='/src/domain/head/frame.ts',scaffold='/src/domain/head/scaffold.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(scaffold)).ensureScaffold((await import(frame)).migrateHeadFrame((await import(presets)).createLandmarkProject())));const state=performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/src/ui/windows/state.ts'))!;(await import(state)).useWindows.getState().toggle('contour');s.selectObject({kind:'frame',id:'head'});});
 const preview=page.getByTestId('contour-preview');await expect(preview).toHaveAttribute('aria-busy','false',{timeout:20000});
 const paths=()=>preview.locator('svg').innerHTML(),original=await paths();expect(await preview.locator('path').count()).toBeGreaterThan(0);
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.setHeadPerspective('x',1);s.setHeadPerspective('y',.4);});
 await expect.poll(paths).not.toBe(original);await expect(preview).toHaveAttribute('aria-busy','false');
 const canvas=page.getByTestId('point-inspect').locator('canvas'),before=await canvas.screenshot();
 const r=(await canvas.boundingBox())!;await page.mouse.move(r.x+45,r.y+90);await page.mouse.down();await page.mouse.move(r.x+90,r.y+100,{steps:5});await page.mouse.up();
 await expect.poll(async()=>Buffer.compare(before,await canvas.screenshot())).not.toBe(0);await expect(preview).toHaveAttribute('aria-busy','false',{timeout:20000});
 await page.getByTestId('head-perspective').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/scaffold/head-perspective-surfaces.png'});expect(errors).toEqual([]);
});
