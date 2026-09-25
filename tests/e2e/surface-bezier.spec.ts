import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('saved eye study: choose cylinder through HeadSet reference, create curve and drag surface handles',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const raw=readFileSync('/Users/bowen/Desktop/眼睛研究1.json','utf8');
 const data=await page.evaluate(async raw=>{const store=(window as any).__editorPerfStore,url='/src/domain/landmarks/persistence.ts',p=(await import(url)).parseLandmarks(raw);store.getState().load(p);const s=store.getState();s.setActiveModule('EYES');s.selectView(p.views[0].id);s.setCanvas({zoom:2,pan:[0,0]});s.selectObject(null);s.setTool({kind:'onPatch'});return {host:p.patches.find((x:any)=>x.name==='眼柱前面'&&!x.canonicalId).id,a:p.landmarks.find((x:any)=>x.name==='右内眼角').id,b:p.landmarks.find((x:any)=>x.name==='右外眼角').id};},raw);
 const screen=async(id:string,surface=false)=>page.evaluate(async({id,surface})=>{const s=(window as any).__editorPerfStore.getState(),p=s.project,g='/src/domain/geometry/evaluation.ts',patch='/src/domain/patches/geometry.ts',o='/src/rendering/orthographic.ts',e='/src/rendering/eyeDisplay.ts',ortho=await import(o),r=document.querySelector('[data-testid="point-editor"]')!.getBoundingClientRect(),v=p.views.find((x:any)=>x.id===s.viewId),view=ortho.orthographicView(v.camera,v.canvas,r.width,r.height),world=surface?(await import(patch)).evaluator(p,p.patches.find((x:any)=>x.id===id))(.4,.4):(await import(g)).pointPosition(p,id),q=ortho.worldToScreen((await import(e)).displayEyePoint(p,id,world,view.forward),view);return {x:r.left+q[0],y:r.top+q[1]};},{id,surface});
 const h=await screen(data.host,true);await page.mouse.click(h.x,h.y);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().tool.hostId)).toBe(data.host);
 for(const id of [data.a,data.b]){const q=await screen(id);await page.mouse.click(q.x,q.y);}
 await page.getByRole('button',{name:'Confirm On Surface Curve',exact:true}).click();
 const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {id:s.selectedCurveId,history:s.past.length};});
 const handle=page.getByTestId('on-patch-handle-1');await expect(handle).toBeVisible();const box=(await handle.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-26,{steps:8});await page.mouse.up();
 const path=()=>page.evaluate(id=>{const s=(window as any).__editorPerfStore.getState(),c=s.project.curves.find((x:any)=>x.id===id);return {offsets:c.path.handleOffsets,history:s.past.length};},before.id);
 const changed=await path();expect(changed.offsets).toHaveLength(2);expect(changed.history).toBe(before.history+1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await path()).offsets).toBeUndefined();await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await path()).offsets).toEqual(changed.offsets);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),before.id);await page.screenshot({path:'artifacts/eyes/surface-bezier.png'});expect(errors).toEqual([]);
});
