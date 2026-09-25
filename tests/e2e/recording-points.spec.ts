import {test,expect,type Page} from '@playwright/test';
async function data(page:Page){return page.evaluate(()=>(window as any).__editorPerfStore.getState().project.recording);}
async function history(page:Page){return page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);}
async function view(page:Page,yaw:number){
 const parent=page.getByRole('slider',{name:'Recording Yaw',exact:true}).locator('..');
 await parent.locator('.numeric-slider-value').dblclick();await parent.locator('.numeric-slider-entry').fill(String(yaw));await parent.locator('.numeric-slider-entry').press('Enter');
}
async function drag(page:Page,selector:string,dx:number,dy:number){
 const b=(await page.locator(selector).boundingBox())!;
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
 await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:6});await page.mouse.up();
}
const pointHit=(id:string)=>`[data-testid="recording-point"][data-point="${id}"] [data-testid="recording-point-hit"]`;
async function createPoint(page:Page,name:string,x:number,y:number){
 await page.getByRole('button',{name:'New Recorded Point',exact:true}).click();
 const b=(await page.getByTestId('recording-canvas').boundingBox())!;
 await page.getByTestId('recording-canvas').click({position:{x:b.width*x,y:b.height*y}});
 const input=page.getByRole('textbox',{name:'Recorded point name',exact:true});await input.fill(name);await input.press('Enter');
 return (await data(page)).points.at(-1).id as string;
}
async function connect(page:Page,a:string,b:string){
 await page.getByRole('button',{name:'New Semantic Curve',exact:true}).click();
 await page.locator(pointHit(a)).click();await page.locator(pointHit(b)).click();
 return (await data(page)).curves.at(-1).id as string;
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));
 await page.goto('/');await page.getByTestId('room-toggle').click();
});

test('record visible points first, connect curves, move shared point without curve keys, handle Auto-Key and hide markers',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const a=await createPoint(page,'Brow',.28,.32),b=await createPoint(page,'Chin',.5,.68),c=await createPoint(page,'Ear',.75,.48);
 await expect(page.getByTestId('recording-point')).toHaveCount(3);
 await expect(page.getByTestId('recorded-final-point')).toHaveCount(0);
 await expect(page.getByTestId('recording-point-row').first().locator('.recording-point-badge')).toBeVisible();
 const front=await data(page);
 await view(page,30);await expect(page.getByTestId('recorded-final-point')).toHaveCount(0);
 for(const [id,dx,dy] of [[a,14,8],[b,18,-6],[c,-16,12]] as const)await drag(page,pointHit(id),dx,dy);
 expect((await data(page)).points.every((p:any)=>p.keys.length===2)).toBe(true);
 await expect(page.getByTestId('recorded-final-point')).toHaveCount(0);
 await view(page,0);
 const ab=await connect(page,a,b),bc=await connect(page,b,c);
 const base=await data(page),count=await history(page);
 expect(base.curves.map((c:any)=>c.semantic)).toEqual([{startPointId:a,endPointId:b},{startPointId:b,endPointId:c}]);
 await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(2);
 await drag(page,pointHit(b),20,12);
 const moved=await data(page);expect(moved.curves).toEqual(base.curves);expect(await history(page)).toBe(count+1);
 expect(moved.points.find((p:any)=>p.id===b).keys[0].position).not.toEqual(front.points[1].keys[0].position);
 const shared=await page.evaluate(async()=>{const url='/src/domain/recording/junctions.ts',e=(window as any).__editorPerfStore.getState();return [...(await import(url)).evaluateRecording(e.project.recording,{yaw:0,pitch:0})].map(([id,result]:any)=>({id,shape:result.shape}));});
 expect(shared.find((x:any)=>x.id===ab).shape[3]).toEqual(shared.find((x:any)=>x.id===bc).shape[0]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(base);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(moved);

 await view(page,-15);
 await page.getByTestId('recording-row').first().getByRole('button').first().click();
 const prior=await data(page);
 await drag(page,'[data-testid="recorded-control-1"]',-18,-24);
 const edited=await data(page);expect(edited.points).toEqual(prior.points);expect(edited.curves[0].keys).toHaveLength(2);
 expect(edited.curves[0].keys.at(-1).yaw).toBe(15);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(prior);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 const preview=await page.getByTestId('recording-final').locator('path').evaluateAll(paths=>paths.map(p=>p.getAttribute('d')));
 await page.getByTestId('recording-point-row').nth(1).getByRole('checkbox').uncheck();
 await expect(page.locator(pointHit(b))).toHaveCount(0);
 await expect(page.getByTestId('recorded-final-point')).toHaveCount(0);
 expect(await page.getByTestId('recording-final').locator('path').evaluateAll(paths=>paths.map(p=>p.getAttribute('d')))).toEqual(preview);
 await page.getByTestId('recording-point-row').nth(1).getByRole('button').first().click();
 await expect(page.getByTestId('recording-point-inspector')).toBeVisible();
 await page.getByTestId('recording-point-row').nth(1).getByRole('checkbox').check();
 await expect(page.locator(pointHit(b))).toBeVisible();
 const saved=await data(page);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await data(page)).toEqual(saved);
 await page.waitForTimeout(750);await page.reload();await page.getByTestId('room-toggle').click();expect(await data(page)).toEqual(saved);
 await page.getByTestId('language-toggle').click();
 await expect(page.getByRole('button',{name:'新建录制语义点',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'新建语义曲线',exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/recording/recorded-points.png'});
 expect(errors).toEqual([]);
});

test('semantic curves sharing a point support Smooth while the point remains the shared position owner',async({page})=>{
 const a=await createPoint(page,'Left',.25,.3),b=await createPoint(page,'Chin',.5,.65),c=await createPoint(page,'Right',.75,.3);
 await connect(page,a,b);await connect(page,b,c);
 const before=await data(page);
 await page.getByRole('button',{name:'Bind Endpoint',exact:true}).click();
 const pos=(await page.locator(pointHit(b)).boundingBox())!;
 await page.mouse.click(pos.x+pos.width/2,pos.y+pos.height/2);
 await page.mouse.click(pos.x+pos.width/2,pos.y+pos.height/2);
 expect((await data(page)).junctions).toHaveLength(1);
 await page.getByTestId('recording-junction-row').click();
 await page.getByRole('button',{name:'Enable Smooth Junction',exact:true}).click();
 await expect(page.getByTestId('smooth-final')).toHaveCount(1);
 await drag(page,pointHit(b),15,10);
 expect((await data(page)).curves).toEqual(before.curves);
 await expect(page.getByTestId('smooth-final')).toHaveCount(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 expect((await data(page)).points).toEqual(before.points);
});

test('point creation undo, tool cancellation, locks, key deletion, and referenced point deletion guard',async({page})=>{
 const a=await createPoint(page,'A',.25,.3),b=await createPoint(page,'B',.7,.7);
 await page.getByRole('button',{name:'Undo',exact:true}).click(); // rename
 await page.getByRole('button',{name:'Undo',exact:true}).click(); // creation
 await expect(page.getByTestId('recording-point')).toHaveCount(1);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await page.getByRole('button',{name:'New Semantic Curve',exact:true}).click();
 await page.locator(pointHit(a)).click();await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 expect((await data(page)).curves).toHaveLength(0);
 const ab=await connect(page,a,b);
 await page.getByTestId('recording-point-row').first().getByRole('button').first().click();
 await page.getByTestId('recording-point-inspector').locator('summary').click();
 await expect(page.getByRole('button',{name:'Delete Point and All Keys',exact:true})).toBeDisabled();
 await view(page,30);await drag(page,pointHit(a),10,15);
 expect((await data(page)).points[0].keys).toHaveLength(2);
 await page.getByTestId('recording-point-inspector').getByRole('button',{name:'Delete Key',exact:true}).last().click();
 expect((await data(page)).points[0].keys).toHaveLength(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.getByTestId('recording-point-row').first().getByRole('button').last().click();
 const locked=await data(page),n=await history(page);await drag(page,pointHit(a),30,30);
 expect(await data(page)).toEqual(locked);expect(await history(page)).toBe(n);
 await page.getByTestId('recording-row').first().getByRole('button').first().click();
 await drag(page,'[data-testid="recorded-control-1"]',-15,25);
 expect((await data(page)).curves.find((c:any)=>c.id===ab).keys).toHaveLength(2);
 expect((await data(page)).points).toEqual(locked.points);
});

test('Mirror points on canvas uses interpolated source, keys frozen target, follows curves and undoes atomically',async({page})=>{
 const a=await createPoint(page,'Source',.25,.28),b=await createPoint(page,'Target',.72,.53),c=await createPoint(page,'Chin',.52,.75);
 const curve=await connect(page,b,c);
 await view(page,30);await drag(page,pointHit(a),15,10);await view(page,15);
 const before=await data(page),n=await history(page);
 const source=before.points[0].keys,expected=[-(source[0].position[0]+source[1].position[0])/2,(source[0].position[1]+source[1].position[1])/2];
 await page.getByRole('button',{name:'Mirror Edit',exact:true}).click();
 await page.locator(pointHit(a)).click();expect(await history(page)).toBe(n);
 await expect(page.locator(`[data-testid="recording-point"][data-point="${a}"] circle`).first()).toHaveAttribute('fill','#ffd479');
 await page.locator(pointHit(b)).click();
 const mirrored=await data(page);expect(await history(page)).toBe(n+1);
 expect(mirrored.points[0]).toEqual(before.points[0]);expect(mirrored.points[1].keys).toHaveLength(2);
 const key=mirrored.points[1].keys.find((k:any)=>k.yaw===15);
 expect(key.position[0]).toBeCloseTo(expected[0],10);expect(key.position[1]).toBeCloseTo(expected[1],10);
 expect(mirrored.curves).toEqual(before.curves);
 await expect(page.getByRole('textbox',{name:'Recorded point name',exact:true})).toHaveValue('Target');
 await expect(page.getByTestId('recording-point-status')).toHaveText('Exact View Key');
 const endpoint=await page.evaluate(async(id)=>{const url='/src/domain/recording/junctions.ts';return (await import(url)).evaluateRecording((window as any).__editorPerfStore.getState().project.recording,{yaw:15,pitch:0}).get(id).shape[0];},curve);
 expect(endpoint).toEqual(key.position);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
 await expect(page.getByTestId('recording-point-status')).toHaveText('Outside coverage · frozen reference');
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(mirrored);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await data(page)).toEqual(mirrored);
});

test('Mirror point list supports negative yaw, guards target types and locks, and cancels first choice on navigation',async({page})=>{
 const a=await createPoint(page,'Source',.25,.3),b=await createPoint(page,'Target',.7,.6);
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 await view(page,30);await drag(page,pointHit(a),15,10);await view(page,-15);
 const sourceRow=page.getByTestId('recording-point-row').first(),targetRow=page.getByTestId('recording-point-row').last();
 await targetRow.getByRole('button').last().click();
 const locked=await data(page),n=await history(page);
 await page.getByRole('button',{name:'Mirror Edit',exact:true}).click();
 await sourceRow.getByRole('button').first().click();
 await page.getByTestId('recording-row').first().getByRole('button').first().click();
 await expect(page.getByRole('status')).toHaveText('Mirror source and target must both be points or both be curves');
 await targetRow.getByRole('button').first().click();
 await expect(page.getByRole('status')).toHaveText('Choose a different unlocked recorded point');
 expect(await data(page)).toEqual(locked);expect(await history(page)).toBe(n);
 await targetRow.getByRole('button').last().click(); // Unlock clears incomplete choice.
 const before=await data(page);
 await sourceRow.getByRole('button').first().click();await view(page,-20);
 await expect(page.locator('.recording-hud')).toContainText('Choose a source point or curve to mirror');
 await sourceRow.getByRole('button').first().click();await page.keyboard.press('Escape');
 await expect(page.locator('.recording-hud')).toContainText('Choose a source point or curve to mirror');
 await sourceRow.getByRole('button').first().click();await targetRow.getByRole('button').first().click();
 const after=await data(page),key=after.points[1].keys.find((k:any)=>k.yaw===20),keys=before.points[0].keys;
 expect(key.position[0]).toBeCloseTo(-(keys[0].position[0]/3+keys[1].position[0]*2/3),10);
 expect(after.points[0]).toEqual(before.points[0]);expect(after.curves).toEqual(before.curves);
 await view(page,60);await page.getByRole('button',{name:'Mirror Edit',exact:true}).click();
 await sourceRow.getByRole('button').first().click();
 await expect(page.getByRole('status')).toHaveText('Frozen shapes cannot be used as a precise source');
 expect(await data(page)).toEqual(after);
});

test('point arrow nudges follow displayed directions with modifiers, Auto-Key, shared curves and grouped undo',async({page})=>{
 const a=await createPoint(page,'A',.3,.3),b=await createPoint(page,'B',.65,.65);
 await connect(page,a,b);
 await page.locator(pointHit(a)).click();
 const front=await data(page),pos=front.points[0].keys[0].position,n=await history(page);
 await page.keyboard.press('ArrowRight');
 expect((await data(page)).points[0].keys[0].position[0]).toBeCloseTo(pos[0]+.005,10);
 await page.keyboard.press('Shift+ArrowUp');await page.keyboard.press('Alt+ArrowLeft');await page.keyboard.press('ArrowDown');
 const moved=await data(page);
 expect(moved.points[0].keys[0].position[0]).toBeCloseTo(pos[0]+.004,10);
 expect(moved.points[0].keys[0].position[1]).toBeCloseTo(pos[1]+.02,10);
 expect(moved.curves).toEqual(front.curves);expect(await history(page)).toBe(n+4);
 await view(page,-30);
 await page.getByTestId('recording-point-row').first().getByRole('button').first().click();
 const before=await data(page),count=await history(page);
 await page.keyboard.down('ArrowRight');await page.waitForTimeout(520);await page.keyboard.up('ArrowRight');
 const held=await data(page),key=held.points[0].keys.find((k:any)=>k.yaw===30);
 expect(key.position[0]).toBeLessThan(moved.points[0].keys[0].position[0]-.005);
 expect(held.points[0].keys).toHaveLength(2);expect(held.curves).toEqual(before.curves);expect(await history(page)).toBe(count+1);
 const endpoint=await page.evaluate(async()=>{const url='/src/domain/recording/junctions.ts',r=(window as any).__editorPerfStore.getState().project.recording;return (await import(url)).evaluateRecording(r,{yaw:-30,pitch:0}).get(r.curves[0].id).shape[0];});
 expect(endpoint).toEqual(key.position);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
 await expect(page.getByTestId('recording-point-status')).toHaveText('Outside coverage · frozen reference');
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(held);
});

test('point arrow keys leave inputs, sliders, other tools and locked points alone; undo stops a held key',async({page})=>{
 const a=await createPoint(page,'A',.3,.3);
 const before=await data(page),n=await history(page);
 const input=page.getByRole('textbox',{name:'Recorded point name',exact:true});await input.focus();await page.keyboard.press('ArrowLeft');
 expect(await data(page)).toEqual(before);
 await page.getByRole('slider',{name:'Recording Yaw',exact:true}).focus();await page.keyboard.press('ArrowRight');
 expect(await data(page)).toEqual(before);await view(page,0);
 await page.getByTestId('recording-point-row').first().getByRole('button').last().click();
 await page.getByTestId('recording-point-row').first().getByRole('button').first().click();
 const locked=await data(page);await page.keyboard.press('ArrowUp');expect(await data(page)).toEqual(locked);expect(await history(page)).toBe(n+1);
 await page.getByTestId('recording-point-row').first().getByRole('button').last().click();
 await page.getByRole('button',{name:'Mirror Edit',exact:true}).click();await page.locator(pointHit(a)).click();
 await page.getByTestId('recording-canvas').focus();const inTool=await data(page);await page.keyboard.press('ArrowLeft');expect(await data(page)).toEqual(inTool);
 await page.getByRole('button',{name:'Edit Curve',exact:true}).click();await page.locator(pointHit(a)).click();
 const prior=await data(page);await page.keyboard.down('ArrowDown');await page.waitForTimeout(420);
 await page.keyboard.press('ControlOrMeta+z');await page.waitForTimeout(220);await page.keyboard.up('ArrowDown');
 expect(await data(page)).toEqual(prior);
});

test('point rows drag before/after one another, retain selection and geometry, persist and undo',async({page})=>{
 const a=await createPoint(page,'A',.25,.3),b=await createPoint(page,'B',.5,.5),c=await createPoint(page,'C',.75,.7);
 await connect(page,a,b);
 const row=(id:string)=>page.locator(`[data-testid="recording-point-row"][data-point-id="${id}"]`);
 await row(b).getByRole('button').first().click();
 const before=await data(page),count=await history(page);
 const h=(await row(c).boundingBox())!.height;
 await row(a).dragTo(row(c),{targetPosition:{x:20,y:h-3}});
 const reordered=await data(page);expect(reordered.points.map((p:any)=>p.id)).toEqual([b,c,a]);
 expect(reordered.curves).toEqual(before.curves);expect(reordered.points.find((p:any)=>p.id===a)).toEqual(before.points[0]);
 expect(await history(page)).toBe(count+1);await expect(row(b)).toHaveClass(/active/);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(reordered);
 await row(a).dragTo(row(b),{targetPosition:{x:20,y:3}});expect(await data(page)).toEqual(before);
 await row(c).getByRole('button').last().click(); // Lock affects geometry, not list order.
 await row(c).dragTo(row(a),{targetPosition:{x:20,y:3}});
 const saved=await data(page);expect(saved.points.map((p:any)=>p.id)).toEqual([c,a,b]);
 const noOp=await history(page);await row(c).dragTo(row(c));expect(await history(page)).toBe(noOp);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await data(page)).toEqual(saved);
 expect(await page.getByTestId('recording-point-row').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-point-id')))).toEqual([c,a,b]);
});
