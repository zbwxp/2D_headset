import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page){await page.goto('/');await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.reset();s.selectView('front');s.setCanvas({zoom:1,pan:[0,0]});});}
async function pointScreen(page:Page,id:string){return page.evaluate(async id=>{const s=(window as any).__editorPerfStore.getState(),{pointPosition}=await import('/src/domain/geometry/evaluation.ts' as string),{orthographicView,worldToScreen}=await import('/src/rendering/orthographic.ts' as string),v=s.project.views.find((x:any)=>x.id===s.viewId),rect=document.querySelector('[data-testid=point-editor]')!.getBoundingClientRect(),view=orthographicView(v.camera,v.canvas,rect.width,rect.height);const q=worldToScreen(pointPosition(s.project,id),view);return {x:q[0]+rect.x,y:q[1]+rect.y};},id);}
async function clickRelative(page:Page,q:number[]){const xy=await page.evaluate(async q=>{const s=(window as any).__editorPerfStore.getState(),{toHead}=await import('/src/domain/head/frame.ts' as string),{orthographicView,worldToScreen}=await import('/src/rendering/orthographic.ts' as string),v=s.project.views.find((x:any)=>x.id===s.viewId),r=document.querySelector('[data-testid=point-editor]')!.getBoundingClientRect();const xy=worldToScreen(toHead(s.project,q),orthographicView(v.camera,v.canvas,r.width,r.height));return {x:r.x+xy[0],y:r.y+xy[1]};},q);await page.mouse.click(xy.x,xy.y);return xy;}
test('2D surface point draft, branches, constrained drag, history; other 3D tools remain inspection-only',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
 const count=()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.landmarks.length),before=await count();
 await page.locator('.creation-shelf summary').filter({hasText:'点'}).click();await page.getByRole('button',{name:'辅助面定位点',exact:true}).click();
 await clickRelative(page,[.35,.25,0]);expect(await count()).toBe(before);await expect(page.getByRole('button',{name:'确认创建',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'切换前侧 / 后侧'}).click();await clickRelative(page,[.35,.25,0]);await page.getByRole('button',{name:'确认创建',exact:true}).click();await expect.poll(count).toBe(before+2);
 const id=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState(),l=s.project.landmarks.find((l:any)=>l.id===s.selectedId);if(l.placement.direction[2]>=0)throw Error('wrong branch');return l.id;});
 const placement=()=>page.evaluate(id=>JSON.stringify((window as any).__editorPerfStore.getState().project.landmarks.find((l:any)=>l.id===id).placement),id),preDrag=await placement();
 const q=await pointScreen(page,id);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+25,q.y+10,{steps:8});await page.mouse.up();
 expect(await page.evaluate(id=>(window as any).__editorPerfStore.getState().project.landmarks.find((l:any)=>l.id===id).placement.direction[2],id)).toBeLessThan(0);
 const postDrag=await placement();expect(postDrag).not.toBe(preDrag);await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await placement()).toBe(preDrag);await page.getByRole('button',{name:'重做',exact:true}).click();expect(await placement()).toBe(postDrag);
 await page.screenshot({path:'artifacts/v061/surface-point-2d.png'});
 const canvas=page.getByTestId('point-inspect').locator('canvas'),r=(await canvas.boundingBox())!;
 for(const tool of [{kind:'surfacePoint',centerline:false},{kind:'region',ids:[],preview:true}]){
  await page.evaluate(t=>(window as any).__editorPerfStore.getState().setTool(t),tool);const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return JSON.stringify([s.project,s.tool]);});
  await page.mouse.click(r.x+r.width*.5,r.y+r.height*.45);await page.keyboard.press('ArrowUp');await page.mouse.move(r.x+r.width*.5,r.y+r.height*.45);await page.mouse.down();await page.mouse.move(r.x+r.width*.5+35,r.y+r.height*.45+15,{steps:5});await page.mouse.up();
  expect(await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return JSON.stringify([s.project,s.tool]);})).toBe(before);
 }
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().cancelTool());expect(errors).toEqual([]);
});
test('2D cap selection and cap/curve drags preserve source offsets',async({page})=>{
 await setup(page);
 const data=await page.evaluate(async()=>{const store=(window as any).__editorPerfStore,s=store.getState(),{createSection,sectionFromAngles}=await import('/src/domain/curves/section.ts' as string),{addCap,addCapPoint}=await import('/src/domain/head/caps.ts' as string),{addOnCurvePoint,setOnCurveS}=await import('/src/domain/landmarks/placement.ts' as string),{setLoomisOffset}=await import('/src/domain/head/offset.ts' as string);let r=createSection(s.project),p={...r.project,loomisScaffold:{...r.project.loomisScaffold,visible:false},curves:r.project.curves.map((c:any)=>c.id===r.selectedId?{...c,section:sectionFromAngles(0,0,.3)}:c)};p=addCap(p,r.selectedId);const cap=p.loomisCaps[p.loomisCaps.length-2],cp=addCapPoint(p,cap.id,.25,.2);p=setLoomisOffset(cp.project,cp.selectedId,1,.08);const op=addOnCurvePoint(p,r.selectedId);p=setOnCurveS(op.project,op.selectedId,.15);store.setState({project:p,selection:null});return {cap:cap.id,point:cp.selectedId,onCurve:op.selectedId};});
 await page.waitForTimeout(200);
 const id=await page.evaluate(async()=>{const {editSurfacePicker}=await import('/src/rendering/edit2d/picking.ts' as string),r=document.querySelector('[data-testid=point-editor]')!.getBoundingClientRect();return editSurfacePicker.current.pick([r.width*.52,r.height*.48])?.id;});expect(id).toBeTruthy();
 // A normal interior click selects the cap through the shared ID pass.
 await clickRelative(page,[.31,-.28,.3]);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selection.source)).toBe('CAP');
 for(const point of [data.point,data.onCurve]){const q=await pointScreen(page,point),before=await page.evaluate(id=>JSON.stringify((window as any).__editorPerfStore.getState().project.landmarks.find((l:any)=>l.id===id).placement),point);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+18,q.y-12,{steps:8});await page.mouse.up();expect(await page.evaluate(id=>JSON.stringify((window as any).__editorPerfStore.getState().project.landmarks.find((l:any)=>l.id===id).placement),point)).not.toBe(before);}
 expect(await page.evaluate(id=>(window as any).__editorPerfStore.getState().project.landmarks.find((l:any)=>l.id===id).placement.offsetY,data.point)).toBe(.08);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectLandmark(id),data.point);await page.screenshot({path:'artifacts/v061/cap-point-2d.png'});
});
test('Region candidates confirm in 2D and Surface Point cancel leaves no orphan',async({page})=>{
 await setup(page);await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState(),section=s.project.curves.find((c:any)=>c.systemRole==='MAIN_Z');s.setTool({kind:'region',ids:[section.id],preview:true});});
 await expect(page.getByTestId('authoring-preview-2d').locator('polygon').first()).toBeVisible();await page.screenshot({path:'artifacts/v061/region-candidates-2d.png'});
 await clickRelative(page,[.3,.25,0]);await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().selection?.source)).toBe('REGION');
 const before=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project));await page.evaluate(()=>(window as any).__editorPerfStore.getState().setTool({kind:'surfacePoint',centerline:true}));await clickRelative(page,[0,.3,0]);await page.getByRole('button',{name:'取消 Esc'}).click();expect(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project))).toBe(before);
});
test('all four Surface sources resolve from GPU IDs into unified 2D selection',async({page})=>{
 await setup(page);
 const refs=await page.evaluate(async()=>{
 const store=(window as any).__editorPerfStore,{parseLandmarks}=await import('/src/domain/landmarks/persistence.ts' as string),{createSection,sectionFromAngles}=await import('/src/domain/curves/section.ts' as string),{addCap}=await import('/src/domain/head/caps.ts' as string),{regionCandidates}=await import('/src/domain/head/regions.ts' as string),{HELMET}=await import('/src/domain/head/scaffold.ts' as string);
 store.getState().load(parseLandmarks(await(await fetch('/tests/fixtures/continuity-overlap-head.json')).text()));let p=store.getState().project,c=createSection(p);p={...c.project,curves:c.project.curves.map((x:any)=>x.id===c.selectedId?{...x,section:sectionFromAngles(0,35,.3)}:x)};p=addCap(p,c.selectedId);const candidate=regionCandidates(p,[p.curves.find((x:any)=>x.systemRole==='MAIN_Z').id])[0];p={...p,loomisRegions:[{id:'test-region',name:'Test Region',cuts:candidate.cuts,seed:candidate.seed}]};store.setState({project:p,viewId:'front'});(window as any).__phase3source=p;return [{id:p.patches[0].id,source:'PATCH'},{id:HELMET,source:'HELMET'},{id:p.loomisCaps.at(-2).id,source:'CAP'},{id:'test-region',source:'REGION'}];});
 for(const ref of refs){await page.evaluate(ref=>{const st=(window as any).__editorPerfStore,p=(window as any).__phase3source;st.setState({selection:null,project:{...p,patchDisplay:{...p.patchDisplay,visible:true},patches:ref.source==='PATCH'?p.patches.filter((x:any)=>x.id===ref.id):[],loomisCaps:ref.source==='CAP'?p.loomisCaps:[],loomisRegions:ref.source==='REGION'?p.loomisRegions:[],loomisScaffold:{...p.loomisScaffold,visible:ref.source==='HELMET'}}});},ref);await page.waitForTimeout(150);
 const xy=await page.evaluate(async id=>{const {fineHit2D}=await import('/src/ui/authoring/InteractionDispatcher2D.ts' as string),{editSurfacePicker}=await import('/src/rendering/edit2d/picking.ts' as string),{finalSurfaceRenderData}=await import('/src/app/renderSnapshot.ts' as string),{orthographicView,worldToScreen}=await import('/src/rendering/orthographic.ts' as string),s=(window as any).__editorPerfStore.getState(),r=document.querySelector('[data-testid=point-editor]')!.getBoundingClientRect(),v=s.project.views.find((v:any)=>v.id===s.viewId),view=orthographicView(v.camera,v.canvas,r.width,r.height),m=finalSurfaceRenderData(s.project,6).find((m:any)=>m.id===id);if(!m)throw Error('missing mesh '+id);for(let i=0;i<m.indices.length;i+=Math.max(3,Math.floor(m.indices.length/90/3)*3)){const q=[0,0,0];for(let j=0;j<3;j++)for(let k=0;k<3;k++)q[k]+=m.positions[m.indices[i+j]*3+k]/3;const xy=worldToScreen(q,view);if(!fineHit2D(s.project,view,xy,document.elementFromPoint(r.x+xy[0],r.y+xy[1])?.closest('[data-curve-id]')?.getAttribute('data-curve-id')??undefined)&&editSurfacePicker.current.pick(xy)?.id===id)return {x:r.x+xy[0],y:r.y+xy[1]};}throw Error('no visible target '+id);},ref.id);
 await page.mouse.click(xy.x,xy.y);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().selection)).toEqual({kind:'surface',...ref});await expect(page.getByRole('region',{name:'曲面',exact:true}).locator('.section-heading')).toHaveAttribute('aria-expanded','true');
 }
});
test('2D authoring focus owns arrow nudge; 3D focus and orbit never move selected points',async({page})=>{
 await setup(page);const id=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.addDefaultPoint(false);return (window as any).__editorPerfStore.getState().selectedId;});
 const source=()=>page.evaluate(id=>JSON.stringify((window as any).__editorPerfStore.getState().project.landmarks.find((p:any)=>p.id===id).placement),id),before=await source();
 await page.getByTestId('point-inspect').locator('canvas').focus();await page.keyboard.press('ArrowUp');expect(await source()).toBe(before);
 await page.getByTestId('point-editor').focus();await page.keyboard.press('ArrowUp');expect(await source()).not.toBe(before);await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await source()).toBe(before);
});
test('2D span anchors and whole boundaries still create a mirror Patch transaction',async({page})=>{
 const {spanFixture}=await import('../../src/tests/span-fixture');const f=spanFixture();await setup(page);
 await page.evaluate(p=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.startPatch();s.setPatchMode('span');},f.p);
 const hit=async(id:string)=>page.getByTestId('curve-hit-'+id).dispatchEvent('pointerdown',{button:0,pointerId:1});
 await hit(f.host);await page.getByTestId('span-anchor-'+f.a).click();await page.getByTestId('span-anchor-'+f.b).click();
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.uses)).toEqual([f.use]);
 await page.getByRole('button',{name:'整线',exact:true}).click();await hit(f.ac);await hit(f.bc);
 const count=()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches?.length??0);await expect.poll(count).toBe(2);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await count()).toBe(0);await page.getByRole('button',{name:'重做',exact:true}).click();expect(await count()).toBe(2);
});
