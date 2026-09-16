import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const raw=JSON.parse(readFileSync('artifacts/head-frame/source.json','utf8'));
test('analytic Section creation, sliders, ON_CURVE, undo and reload in existing head shell',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(p=>{if(!localStorage.getItem('contour.landmarks.v039'))localStorage.setItem('contour.landmarks.v039',JSON.stringify(p));},raw);await page.goto('/');await page.waitForFunction(()=>!!(window as any).__editorPerfStore);
 await page.getByText('Loomis Set',{exact:true}).click();await page.getByRole('button',{name:'+ 自定义剖面',exact:true}).click();await expect(page.getByTestId('section-inspector')).toBeVisible();
 const before=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return {id:s.selectedCurveId,curves:s.project.curves,points:s.project.landmarks.length};});
 expect(before.curves.filter((c:any)=>c.geometryType==='LOOMIS_SECTION')).toHaveLength(2);expect(before.points).toBe(raw.landmarks.length);
 await expect(page.getByTestId('curve-'+before.id)).toHaveCount(1);await expect(page.getByTestId('curve-handle-1')).toHaveCount(0);
 const slider=page.getByRole('slider',{name:'Section Offset',exact:true});await slider.focus();await slider.press('ArrowRight');const offset=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.curves.find((c:any)=>c.id===s.selectedCurveId).section.planeOffset;});expect(offset).toBeGreaterThan(.25);await slider.press('Meta+z');await expect(slider).toHaveValue('0.25');await slider.press('Meta+Shift+z');
 await page.getByRole('button',{name:'+ 添加在线定位点',exact:true}).click();const point=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();return s.project.landmarks.find((l:any)=>l.id===s.selectedId);});expect(point.placement.hostCurveId).toBe(before.id);
 const position=page.getByRole('slider',{name:/在线位置/});await position.focus();await position.press('ArrowRight');await position.blur();await page.waitForTimeout(250);
 await page.reload();await page.waitForFunction(()=>!!(window as any).__editorPerfStore);const after=await page.evaluate(()=>{const s=(window as any).__editorPerfStore.getState();s.selectCurve(s.project.curves.find((c:any)=>c.geometryType==='LOOMIS_SECTION'&&c.role==='canonical').id);return s.project;});expect(after.curves.filter((c:any)=>c.geometryType==='LOOMIS_SECTION')).toHaveLength(2);expect(after.landmarks.find((l:any)=>l.id===point.id).placement.s).toBeGreaterThan(.5);
 await expect(page.getByTestId('section-inspector')).toBeVisible();await page.screenshot({path:'artifacts/section/editor.png'});expect(errors).toEqual([]);
});

test('wrapped analytic span: 2D host, 3D anchors, mixed Patch and live update',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 const f=await page.evaluate(async()=>{
  const presets=await import('/src/domain/landmarks/presets.ts' as string),frame=await import('/src/domain/head/frame.ts' as string),sections=await import('/src/domain/curves/section.ts' as string),points=await import('/src/domain/landmarks/placement.ts' as string),curves=await import('/src/domain/curves/management.ts' as string);
  let r=sections.createSection(frame.migrateHeadFrame(presets.createLandmarkProject())),p=r.project,host=r.selectedId;
  const a=points.addOnCurvePoint(p,host);p=points.setOnCurveS(a.project,a.selectedId,.8);const b=points.addOnCurvePoint(p,host);p=points.setOnCurveS(b.project,b.selectedId,.2);
  const c=p.landmarks.find((l:any)=>l.name==='右嘴角点').id,ac=curves.createCurve(p,a.selectedId,c,p.views[0],'AC');p=ac.project;const bc=curves.createCurve(p,b.selectedId,c,p.views[0],'BC');p=bc.project;
  const s=(window as any).__editorPerfStore.getState();s.load(p);s.startPatch();s.setPatchMode('span');return {host,a:a.selectedId,b:b.selectedId,ac:ac.selectedId,bc:bc.selectedId};
 });
 await page.getByTestId('curve-hit-'+f.host).dispatchEvent('pointerdown',{button:0,pointerId:1});
 // Candidate picking goes through the real 3D canvas, not the store action.
 for(const id of [f.a,f.b]){
  const box=(await page.getByTestId('point-inspect').locator('canvas').boundingBox())!;
  const xy=await page.evaluate(async({id,w,h})=>{const ev=await import('/src/domain/geometry/evaluation.ts' as string),cam=await import('/src/ui/windows/state.ts' as string),three=await import('/node_modules/.vite/deps/three.js' as string),pose=cam.useInspectionCamera.getState(),camera=new three.PerspectiveCamera(34,w/h,.1,100);camera.position.fromArray(pose.position);camera.quaternion.fromArray(pose.quaternion);camera.updateMatrixWorld();const p=ev.pointPosition((window as any).__editorPerfStore.getState().project,id),v=new three.Vector3(...p).project(camera);return [(v.x+1)*w/2,(1-v.y)*h/2];},{id,w:box.width,h:box.height});await page.mouse.click(box.x+xy[0],box.y+xy[1]);
 }
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().patchCreation.uses.length)).toBe(1);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().setPatchMode('whole'));
 for(const id of [f.ac,f.bc])await page.getByTestId('curve-hit-'+id).dispatchEvent('pointerdown',{button:0,pointerId:1});
 await expect.poll(()=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.length)).toBe(2);
 await expect(page.getByTestId('gpu-derived-renderer')).toHaveAttribute('data-surface-count','2');await page.keyboard.press('Escape');
 await page.evaluate(id=>{const s=(window as any).__editorPerfStore.getState();s.beginEdit(true);s.setOnCurveS(id,.76);s.endEdit();},f.a);
 await expect(page.getByTestId('gpu-derived-renderer')).toHaveAttribute('data-surface-count','2');expect(errors).toEqual([]);
});

test('selected edge-on Section keeps a valid visible 2D highlight',async({page})=>{
 await page.goto('/');
 const id=await page.evaluate(async()=>{
  const presets=await import('/src/domain/landmarks/presets.ts' as string),frame=await import('/src/domain/head/frame.ts' as string),sections=await import('/src/domain/curves/section.ts' as string);
  const p=frame.migrateHeadFrame(presets.createLandmarkProject());p.landmarks=[];p.curves=[];p.patches=[];p.centerlineOrder=[];
  const r=sections.createSection(p);r.project.curves.find((c:any)=>c.id===r.selectedId).section=sections.sectionFromAngles(0,90,.66);
  const s=(window as any).__editorPerfStore.getState();s.load(r.project);s.selectCurve(r.selectedId);return r.selectedId;
 });
 const path=page.getByTestId('curve-'+id);await expect(path).toHaveAttribute('opacity','1');
 const d=(await path.getAttribute('d'))!;
 // SVG M/L accept XY pairs, never the camera-space depth component.
 for(const command of d.split(/(?=[ML])/).filter(Boolean))expect(command.slice(1).trim().split(',')).toHaveLength(2);
 const box=await path.evaluate((p:SVGPathElement)=>({height:p.getBBox().height,length:p.getTotalLength()}));expect(box.height).toBeGreaterThan(100);expect(box.length).toBeGreaterThan(200);
 await expect(page.getByTestId('curve-handle-1')).toHaveCount(0);
});
