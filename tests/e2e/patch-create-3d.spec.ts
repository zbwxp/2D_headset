import {test,expect,type Page} from '@playwright/test';
import {PerspectiveCamera,Vector3} from 'three';
import {spanFixture} from '../../src/tests/span-fixture';
import {followEndpoints} from '../../src/domain/curves/geometry';
async function screen(page:Page,id:string,t?:number){
 const d=await page.evaluate(async({id,t})=>{const s=(window as any).__editorPerfStore.getState(),{evaluationContext}=await import('/src/domain/geometry/evaluation.ts'),{useInspectionCamera}=await import(performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/src/ui/windows/state.ts'))??'/src/ui/windows/state.ts'),g=evaluationContext(s.project),r=document.querySelector('[data-testid=point-inspect] canvas')!.getBoundingClientRect();return {p:t===undefined?g.pointPosition(id):g.curve(id).evaluate(t),pose:useInspectionCamera.getState(),r:{x:r.x,y:r.y,width:r.width,height:r.height}};},{id,t});
 const {p,pose,r}=d,c=new PerspectiveCamera(pose.fov,r.width/r.height,.1,100);c.position.fromArray(pose.position);c.quaternion.fromArray(pose.quaternion);c.updateMatrixWorld();const q=new Vector3(...p).project(c);return {x:r.x+(q.x+1)*r.width/2,y:r.y+(1-q.y)*r.height/2};
}
async function edge(page:Page,id:string,t=.5){let q={x:0,y:0};await expect(async()=>{q=await screen(page,id,t);await page.mouse.move(q.x,q.y);await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-hover-curve',id,{timeout:200});}).toPass({timeout:4000});await page.mouse.click(q.x,q.y);}
async function anchor(page:Page,id:string){let q={x:0,y:0};await expect(async()=>{q=await screen(page,id);await page.mouse.move(q.x,q.y);await expect(page.getByTestId('point-inspect').locator('canvas')).toHaveAttribute('data-hover-point',id,{timeout:200});}).toPass({timeout:4000});await page.mouse.click(q.x,q.y);}
async function setup(page:Page){
 const f=spanFixture(),host=f.p.curves.find(c=>c.id===f.host)!;
 const locations=new Map([[host.startLandmarkId,[.3,.8,.8]],[host.endLandmarkId,[1.4,.6,.3]],[f.c,[1.3,-.7,.3]]]);
 const ids=new Set([host.startLandmarkId,host.endLandmarkId,f.c,f.a,f.b]);for(const id of [...ids]){const m=f.p.landmarks.find(l=>l.id===id)?.mirrorPartnerId;if(m)ids.add(m);}
 let p={...f.p,landmarks:f.p.landmarks.filter(l=>ids.has(l.id)).map(l=>{const q=locations.get(l.id)??(l.mirrorPartnerId&&locations.get(l.mirrorPartnerId));return q?{...l,placement:{kind:'WORLD' as const,position:[l.type==='LEFT'?-q[0]:q[0],q[1],q[2]] as [number,number,number]}}:l;}),centerlineOrder:[]};p=followEndpoints(f.p,p);
 await page.goto('/');await page.evaluate(p=>{const s=(window as any).__editorPerfStore.getState();s.load(p);s.startPatch();},p);return f;
}
test('3D span candidates, hover, mixed 2D/3D anchors, whole boundaries, undo and cancel',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const f=await setup(page),canvas=page.getByTestId('point-inspect').locator('canvas');
 await page.getByRole('button',{name:'区间',exact:true}).click();await edge(page,f.host);
 await expect(canvas).toHaveAttribute('data-patch-anchors',new RegExp(f.a));await expect(canvas).toHaveAttribute('data-patch-anchors',new RegExp(f.b));
 await anchor(page,f.a);const hover=await screen(page,f.b);await page.mouse.move(hover.x,hover.y);await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.hover)).toBe(f.b);
 await page.getByTestId('span-anchor-'+f.b).dispatchEvent('pointerdown',{button:0,pointerId:1});expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.uses)).toEqual([f.use]);
 await expect(canvas).toHaveAttribute('data-patch-anchors','');await page.getByRole('button',{name:'整线',exact:true}).click();
 await edge(page,f.ac);await edge(page,f.bc);const count=()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches?.length??0);await expect.poll(count).toBe(2);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await count()).toBe(0);await page.getByRole('button',{name:'重做',exact:true}).click();expect(await count()).toBe(2);
 await page.evaluate(() => {const s=(window as any).__editorPerfStore.getState();s.startPatch();s.setPatchMode('span');});await edge(page,f.host);await anchor(page,f.a);await page.keyboard.press('Escape');await expect(canvas).toHaveAttribute('data-patch-anchors','');expect(await count()).toBe(2);expect(errors).toEqual([]);
});
test('3D whole-line triangle creation and selected edge toggling; orbit does not author',async({page})=>{
 const f=await setup(page);const extra=await page.evaluate(async f=>{const {createCurve}=await import('/src/domain/curves/management.ts'),s=(window as any).__editorPerfStore.getState(),r=createCurve(s.project,f.a,f.b,s.project.views[0],'AB');s.load(r.project);s.startPatch();return r.selectedId;},f);
 const q=await screen(page,extra,.5);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+12,q.y+5,{steps:3});await page.mouse.up();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.uses.length)).toBe(0);
 await edge(page,extra);await edge(page,extra);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.uses.length)).toBe(0);await edge(page,extra);await edge(page,f.ac);await edge(page,f.bc);await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches?.length??0)).toBe(2);
});
test('3D closed loops create annular Patch through shared tool and confirmation',async({page})=>{
 await page.goto('/');const ids=await page.evaluate(async()=>{const {createLandmarkProject}=await import('/src/domain/landmarks/presets.ts'),{migrateHeadFrame}=await import('/src/domain/head/frame.ts'),{ensureScaffold,RING_Y}=await import('/src/domain/head/scaffold.ts'),{duplicateRing}=await import('/src/domain/head/duplicateRing.ts');let p=ensureScaffold(migrateHeadFrame(createLandmarkProject()));const d=duplicateRing(p,RING_Y);p={...d.project,curves:d.project.curves.map((c:any)=>c.id===d.selectedId?{...c,section:{...c.section,planeOffset:.45}}:c)};const s=(window as any).__editorPerfStore.getState();s.load(p);s.startPatch();s.setPatchMode('loop');return [RING_Y,d.selectedId];});
 await edge(page,ids[0],.14);await edge(page,ids[1],.14);await expect(page.getByRole('button',{name:'创建环形面',exact:true})).toBeVisible();await page.getByRole('button',{name:'创建环形面',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches?.filter((p:any)=>p.type==='loop').length??0)).toBeGreaterThan(0);
});
