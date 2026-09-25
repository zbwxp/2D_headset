import {test,expect} from '@playwright/test';
test('module creation, command isolation, selection, rendering and save/load',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const prior=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.addDefaultPoint(false);return {p:s.project,id:(window as any).__editorPerfStore.getState().selectedId};});
 const pointId=prior.id;const before=await page.evaluate(()=>structuredClone((window as any).__editorPerfStore.getState().project));
 const canvas=page.getByTestId('point-inspect').locator('canvas');await expect(canvas).toBeVisible();
 const visiblePoints=await canvas.getAttribute('data-visible-points');
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selection)).toBeNull();
 await expect(page.locator(`.object-card[data-object-id="${pointId}"]`)).toHaveCount(0);
 await expect(canvas).toHaveAttribute('data-visible-points',visiblePoints!);
 const guard=await page.evaluate(id=>{const s=(window as any).__editorPerfStore.getState(),before=JSON.stringify(s.project);s.selectLandmark(id);const selected=(window as any).__editorPerfStore.getState().selection;s.renameSelected('bad',id);s.deleteSelected(id);s.duplicateSelected('bad',id);s.movePoint(id,[10,10]);return {selected,same:before===JSON.stringify((window as any).__editorPerfStore.getState().project)};},pointId);
 expect(guard).toEqual({selected:null,same:true});
 // Actual UI creation uses the active module, including its mirror partner.
 await page.getByText('＋ Point ▾',{exact:true}).click();await page.getByRole('button',{name:'Regular Point · Symmetric Pair',exact:true}).click();
 const eye=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {id:s.selectedId,owner:s.project.geometryModules[s.selectedId],ids:s.project.landmarks.filter((l:any)=>s.project.geometryModules[l.id]==='EYES').map((l:any)=>l.id)};});expect(eye.owner).toBe('EYES');expect(eye.ids).toHaveLength(2);
 // New eye geometry remains editable and gets a complete curve/patch loop.
 const made=await page.evaluate(()=>{const store=(window as any).__editorPerfStore,ids:string[]=[];for(let i=0;i<3;i++){store.getState().addDefaultPoint(true);ids.push(store.getState().selectedId);store.getState().nudgePoint(ids[i],1,i===1?.4:0);store.getState().nudgePoint(ids[i],2,i===2?.4:0);}const curves:string[]=[];for(let i=0;i<3;i++){const s=store.getState();s.startCurve();s.pickCurveEndpoint(ids[i]);store.getState().pickCurveEndpoint(ids[(i+1)%3]);curves.push(store.getState().selectedCurveId);}store.getState().startPatch();for(const id of curves)store.getState().pickPatchEdge(id);const s=store.getState();return {ids,curves,patch:s.selectedPatchId,owners:[...ids,...curves,s.selectedPatchId].map(id=>s.project.geometryModules[id])};});
 expect(made.owners,JSON.stringify(made)).toEqual(Array(7).fill('EYES'));expect(made.patch).toBeTruthy();
 await page.getByTestId('geometry-modules').getByRole('button',{name:'HeadSet',exact:true}).click();
 const blocked=await page.evaluate(({id,patch,curve})=>{const s=(window as any).__editorPerfStore.getState(),before=JSON.stringify(s.project);s.deleteSelected(id);s.deletePatch(patch);s.deleteCurve(curve);s.selectLandmark(id);return {same:before===JSON.stringify((window as any).__editorPerfStore.getState().project),selected:(window as any).__editorPerfStore.getState().selection};},{id:eye.id,patch:made.patch,curve:made.curves[0]});expect(blocked).toEqual({same:true,selected:null});
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();
 const helmet=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState(),id='05500000-0000-4000-8000-000000000006';s.selectObject({kind:'surface',source:'HELMET',id});return (window as any).__editorPerfStore.getState().selection;});expect(helmet?.source).toBe('HELMET');
 const saved=await page.evaluate(async()=>{const s=(window as any).__editorPerfStore.getState(),p=s.project,url='/src/domain/landmarks/persistence.ts';s.load((await import(url)).parseLandmarks(JSON.stringify(p)));return (window as any).__editorPerfStore.getState().project.geometryModules;});expect(saved[eye.id]).toBe('EYES');expect(saved[pointId]).toBe('HEADSET');
 const final=await page.evaluate(()=>(window as any).__editorPerfStore.getState().project);for(const l of before.landmarks)expect(final.landmarks.find((x:any)=>x.id===l.id)).toEqual(l);
});
test('inactive 2D and 3D points cannot be picked or dragged; scaffold remains selectable',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const id=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.addDefaultPoint(false);return (window as any).__editorPerfStore.getState().selectedId;});
 const target=page.locator(`[data-point-id="${id}"]`).first();await expect(target).toBeVisible();
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();
 const before=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project));
 const b=(await target.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+25,b.y+b.height/2+15,{steps:4});await page.mouse.up();
 expect(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project))).toBe(before);
 await target.click({force:true});expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selection?.id)).not.toBe(id);
 const xy=await page.evaluate(async id=>{const path='/src/domain/geometry/evaluation.ts',three='/node_modules/.vite/deps/three.js',cameraPath='/src/ui/windows/state.ts';const {pointPosition}=await import(path),T=await import(three),pose=(await import(cameraPath)).useInspectionCamera.getState(),p=(window as any).__editorPerfStore.getState().project,rect=document.querySelector('[data-testid="point-inspect"] canvas')!.getBoundingClientRect();const camera=new T.PerspectiveCamera(34,rect.width/rect.height,.1,100);camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();const q=new T.Vector3(...pointPosition(p,id)).project(camera);return {x:rect.left+(q.x+1)*rect.width/2,y:rect.top+(1-q.y)*rect.height/2};},id);
 await page.mouse.click(xy.x,xy.y);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selection?.id)).not.toBe(id);
 await page.getByTestId('geometry-modules').getByRole('button',{name:'HeadSet',exact:true}).click();await target.click({force:true});expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selection?.id)).toBe(id);
 await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.startCurve();s.pickCurveEndpoint(s.selectedId);});
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().tool.kind)).toBe('select');
});
