import {test,expect} from '@playwright/test';
test('free 3D handles edit in front/side panes with depth preservation, mirror, history and reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const id=await page.evaluate(async()=>{
  const path='/src/domain/landmarks/presets.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(path)).createLandmarkProject());
  const p=(window as any).__editorPerfStore.getState().project,a=p.landmarks.find((l:any)=>l.name==='下巴尖点'),b=p.landmarks.find((l:any)=>l.name==='右外眼角点');
  s.startCurve();s.pickCurveEndpoint(a.id);s.pickCurveEndpoint(b.id);return (window as any).__editorPerfStore.getState().selectedCurveId;
 });
 const first=page.getByTestId('main-panel-viewport'),third=page.getByTestId('main-panel-threeD');
 await third.getByRole('combobox',{name:'Window content'}).selectOption('viewport');
 await first.getByRole('button',{name:'Front view',exact:true}).click();await third.getByRole('button',{name:'Side view',exact:true}).click();
 await expect(page.getByTestId('free3d-inspector')).toBeVisible();await expect(page.getByRole('slider',{name:'Curve plane angle',exact:true})).toHaveCount(0);
 const read=()=>page.evaluate(async id=>{const path='/src/domain/geometry/evaluation.ts',{evaluationContext}=await import(path),s=(window as any).__editorPerfStore.getState(),c=s.project.curves.find((x:any)=>x.id===id),ctx=evaluationContext(s.project);return {shape:c.shape,cp:ctx.sourceCurveControls(id),mirror:ctx.sourceCurveControls(c.mirrorPartnerCurveId),past:s.past.length};},id);
 const drag=async(panel:typeof first,index:number,dx:number,dy:number)=>{const handle=panel.locator(`[data-testid="curve-handle-${index}"][data-curve-id="${id}"]`);await expect(handle).toBeVisible();const r=(await handle.boundingBox())!;await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:8});await page.mouse.up();};
 const a=await read();expect(a.shape.kind).toBe('FREE_3D');await drag(first,1,24,-19);const b=await read();expect(b.shape).not.toEqual(a.shape);expect(b.cp[1][2]).toBeCloseTo(a.cp[1][2],10);expect(b.past).toBe(a.past+1);
 await drag(third,2,30,17);const c=await read();expect(c.shape).not.toEqual(b.shape);expect(c.cp[2][0]).toBeCloseTo(b.cp[2][0],10);expect(Math.abs(c.cp[2][2]-b.cp[2][2])).toBeGreaterThan(.05);expect(c.past).toBe(b.past+1);
 for(let i=0;i<4;i++){expect(c.mirror[i][0]).toBeCloseTo(-c.cp[i][0],10);expect(c.mirror[i][1]).toBeCloseTo(c.cp[i][1],10);expect(c.mirror[i][2]).toBeCloseTo(c.cp[i][2],10);}
 await page.keyboard.press('Control+z');await expect.poll(async()=>(await read()).shape).toEqual(b.shape);
 await page.keyboard.press('Control+Shift+z');await expect.poll(async()=>(await read()).shape).toEqual(c.shape);
 // Endpoint dragging follows the point but does not rewrite either handle offset.
 const anchor=first.getByTestId('landmark-下巴尖点'),ar=(await anchor.boundingBox())!;
 await page.mouse.move(ar.x+ar.width/2,ar.y+ar.height/2);await page.mouse.down();await page.mouse.move(ar.x+ar.width/2,ar.y+ar.height/2-18,{steps:6});await page.mouse.up();
 const moved=await read();expect(moved.shape).toEqual(c.shape);expect(moved.cp[0]).not.toEqual(c.cp[0]);expect(moved.past).toBe(c.past+1);
 await page.keyboard.press('Control+z');expect((await read()).cp).toEqual(c.cp);
 // Deletion still removes the same pair; undo restores the edited source.
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().deleteCurve(id),id);
 await expect.poll(()=>page.evaluate(id=>(window as any).__editorPerfStore.getState().project.curves.some((c:any)=>c.id===id),id)).toBe(false);
 await page.evaluate(()=>(window as any).__editorPerfStore.getState().undo());expect((await read()).shape).toEqual(c.shape);
 await page.evaluate(id=>(window as any).__editorPerfStore.getState().selectCurve(id),id);
 await page.screenshot({path:'artifacts/free3d/multi-view.png'});
 await page.reload();expect((await read()).shape).toEqual(c.shape);expect(errors).toEqual([]);
});
