import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
test('front cylinder patch creation is atomic, idempotent, selectable and persisted',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();
 await page.getByRole('button',{name:'Create Default Eye Scaffold',exact:true}).click();
 const read=()=>page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {count:s.project.patches.length,history:s.past.length};});const first=await read();expect(first.count).toBe(2);
 await page.getByRole('button',{name:'Add Missing Front Cylinder Patches',exact:true}).click();expect(await read()).toEqual(first);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await read()).count).toBe(0);await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await read()).count).toBe(2);
 const xy=await page.evaluate(async()=>{const store=(window as any).__editorPerfStore,s=store.getState(),geometry='/src/domain/patches/geometry.ts',eye='/src/rendering/eyeDisplay.ts',cameraState='/src/ui/windows/state.ts',three='/node_modules/.vite/deps/three.js',T=await import(three),pose=(await import(cameraState)).useInspectionCamera.getState(),p=s.project,patch=p.patches.find((x:any)=>!x.canonicalId),pos=(await import(geometry)).evaluator(p,patch)(.45,.55),rect=document.querySelector('[data-testid="point-inspect"] canvas')!.getBoundingClientRect(),camera=new T.PerspectiveCamera(pose.fov,rect.width/rect.height,.1,100);camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();const v=new T.Vector3(...pos).applyMatrix4((await import(eye)).eyeObjectMatrix(p,patch.id,new T.Vector3(0,0,1).applyQuaternion(camera.quaternion).toArray())).project(camera);return {id:patch.id,x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2};});
 for(let i=0;i<6;i++){await page.mouse.click(xy.x,xy.y);if(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selectedPatchId)===xy.id)break;}
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selectedPatchId)).toBe(xy.id);
 await page.screenshot({path:'artifacts/eyes/eye-surface-anchors.png'});
 expect(errors).toEqual([]);
});
test('upgrade the supplied eye study without changing authored geometry',async({page})=>{
 test.skip(!process.env.EYE_STUDY_SOURCE,'Optional user save diagnostic');
 await page.goto('/');const source=readFileSync(process.env.EYE_STUDY_SOURCE!,'utf8');
 const result=await page.evaluate(async source=>{const url='/src/domain/landmarks/persistence.ts',store=(window as any).__editorPerfStore,p=(await import(url)).parseLandmarks(source);store.getState().load(p);store.getState().setActiveModule('EYES');const before=store.getState().project;store.getState().addEyeFrontSurfaces();const next=store.getState().project;return {json:JSON.stringify(next,null,2),unchanged:JSON.stringify([before.landmarks,before.curves,before.eyeScaffold?.parameters,before.gazeEyeball,before.headFrame])===JSON.stringify([next.landmarks,next.curves.filter((x:any)=>before.curves.some((c:any)=>c.id===x.id)),next.eyeScaffold?.parameters,next.gazeEyeball,next.headFrame]),added:next.patches.length-(p.patches?.length??0)};},source);
 expect(result.unchanged).toBe(true);expect(result.added).toBe(2);writeFileSync('artifacts/eyes/眼部研究-前半周曲面.json',result.json);await page.screenshot({path:'artifacts/eyes/front-cylinder-patches.png'});
});

test('smart module collapses and eye surface creation hits the cylinder rather than HeadSet',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();await page.getByRole('button',{name:'Create Default Eye Scaffold',exact:true}).click();
 const smart=page.getByTestId('gaze-eyeball').getByRole('button',{name:/Smart Modules/});await smart.click();await expect(smart).toHaveAttribute('aria-expanded','false');await smart.click();await expect(smart).toHaveAttribute('aria-expanded','true');
 const xy=await page.evaluate(async()=>{const s=(window as any).__editorPerfStore.getState(),p=s.project,patch=p.patches.find((x:any)=>!x.canonicalId),g='/src/domain/patches/geometry.ts',o='/src/rendering/orthographic.ts',e='/src/rendering/eyeDisplay.ts',T='/node_modules/.vite/deps/three.js',ortho=await import(o),three=await import(T),rect=document.querySelector('[data-testid="point-editor"]')!.getBoundingClientRect(),v=p.views.find((x:any)=>x.id===s.viewId),view=ortho.orthographicView(v.camera,v.canvas,rect.width,rect.height),world=(await import(g)).evaluator(p,patch)(.37,.43),display=new three.Vector3(...world).applyMatrix4((await import(e)).eyeObjectMatrix(p,patch.id,view.forward)).toArray(),xy=ortho.worldToScreen(display,view);s.setTool({kind:'surfacePoint',centerline:false});return {x:rect.left+xy[0],y:rect.top+xy[1],host:patch.id};});
 await page.mouse.click(xy.x,xy.y);
 const draft=await page.evaluate(()=>(window as any).__editorPerfStore.getState().tool.draft?.points);expect(draft).toHaveLength(2);expect(draft[0].placement.kind).toBe('ON_PATCH');expect(draft[0].placement.hostPatchId).toBe(xy.host);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().commitToolDraft());
 expect(await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.landmarks.filter((x:any)=>x.placement.kind==='ON_PATCH').map((x:any)=>s.project.geometryModules[x.id]);})).toEqual(['EYES','EYES']);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.filter((x:any)=>x.placement.kind==='ON_PATCH').length)).toBe(0);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.filter((x:any)=>x.placement.kind==='ON_PATCH').length)).toBe(2);
 await page.screenshot({path:'artifacts/eyes/eye-surface-anchors.png'});
 expect(errors).toEqual([]);
});

test('eye cylinder On Surface Curve: select host, interior corner points, preview, commit and undo',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByTestId('geometry-modules').getByRole('button',{name:'Eyes',exact:true}).click();await page.getByRole('button',{name:'Create Default Eye Scaffold',exact:true}).click();
 const data=await page.evaluate(async()=>{const store=(window as any).__editorPerfStore,s=store.getState(),path='/src/domain/patches/point.ts',m=await import(path),host=s.project.patches.find((x:any)=>!x.canonicalId),a=m.addPatchPoint(s.project,host.id,.2,.35),b=m.addPatchPoint(a.project,host.id,.8,.6),p=b.project;p.geometryModules={...p.geometryModules,...Object.fromEntries(p.landmarks.filter((x:any)=>x.placement.kind==='ON_PATCH').map((x:any)=>[x.id,'EYES']))};s.load(p);store.getState().setActiveModule('EYES');store.getState().selectObject(null);store.getState().setTool({kind:'onPatch'});return {host:host.id,a:a.id,b:b.id};});
 // Sidebar/3D selection uses the common selection command, and must also advance the tool.
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectObject({kind:'surface',source:'PATCH',id}),data.host);
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().tool.hostId)).toBe(data.host);
 for(const id of [data.a,data.b]){
 const xy=await page.evaluate(async id=>{const s=(window as any).__editorPerfStore.getState(),g='/src/domain/geometry/evaluation.ts',o='/src/rendering/orthographic.ts',e='/src/rendering/eyeDisplay.ts',ortho=await import(o),r=document.querySelector('[data-testid="point-editor"]')!.getBoundingClientRect(),v=s.project.views.find((x:any)=>x.id===s.viewId),view=ortho.orthographicView(v.camera,v.canvas,r.width,r.height),p=(await import(g)).pointPosition(s.project,id),q=ortho.worldToScreen((await import(e)).displayEyePoint(s.project,id,p,view.forward),view);return {x:r.left+q[0],y:r.top+q[1]};},id);await page.mouse.click(xy.x,xy.y);
 }
 await expect(page.getByTestId('on-patch-preview').first()).toBeVisible();await page.getByRole('button',{name:'Confirm On Surface Curve',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.curves.filter((c:any)=>c.geometryType==='ON_PATCH').length)).toBe(2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.curves.filter((c:any)=>c.geometryType==='ON_PATCH').length)).toBe(0);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await page.screenshot({path:'artifacts/eyes/eye-on-surface-curve.png'});expect(errors).toEqual([]);
});
