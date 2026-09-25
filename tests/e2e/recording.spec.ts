import {test,expect,type Page} from '@playwright/test';
async function data(page:Page){return page.evaluate(()=>(window as any).__editorPerfStore.getState().project.recording);}
async function history(page:Page){return page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);}
async function view(page:Page,yaw:number,pitch=0){
 for(const [label,value] of [['Recording Yaw',yaw],['Recording Pitch',pitch]] as const){
  const slider=page.getByRole('slider',{name:label,exact:true});
  await slider.locator('..').locator('.numeric-slider-value').dblclick();
  const entry=slider.locator('..').locator('.numeric-slider-entry');await entry.fill(String(value));await entry.press('Enter');
 }
}
async function undo(page:Page){await page.getByRole('button',{name:'Undo',exact:true}).click();}
async function dragHandle(page:Page,index:number,dx:number,dy:number){const h=page.getByTestId(`recorded-control-${index}`),b=(await h.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:5});await page.mouse.up();}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('room-toggle').click();});
test('create, interpolation/frozen Auto-Key, pointer transaction, negative yaw and persistence',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const source=await page.evaluate(()=>{const p=(window as any).__editorPerfStore.getState().project;return JSON.stringify([p.landmarks,p.curves,p.patches]);});
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();expect((await data(page)).curves[0].keys).toHaveLength(1);
 await view(page,30);await expect(page.getByTestId('recording-status')).toHaveText('Outside coverage · frozen reference');await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(0);
 const before=await history(page);await dragHandle(page,1,25,15);expect(await history(page)).toBe(before+1);expect((await data(page)).curves[0].keys).toHaveLength(2);await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(1);
 await undo(page);expect((await data(page)).curves[0].keys).toHaveLength(1);await expect(page.getByTestId('recording-status')).toHaveText('Outside coverage · frozen reference');
 await page.getByRole('button',{name:'Redo',exact:true}).click();await view(page,15);await expect(page.getByTestId('recording-status')).toHaveText('Valid interpolation');await dragHandle(page,2,10,-10);expect((await data(page)).curves[0].keys).toHaveLength(3);await undo(page);expect((await data(page)).curves[0].keys).toHaveLength(2);
 await view(page,-30);await dragHandle(page,0,-12,5);const recorded=await data(page);expect(recorded.curves[0].keys.every((k:any)=>k.yaw>=0)).toBe(true);
 expect(await page.evaluate(()=>{const p=(window as any).__editorPerfStore.getState().project;return JSON.stringify([p.landmarks,p.curves,p.patches]);})).toBe(source);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});expect(await data(page)).toEqual(recorded);
 await page.waitForTimeout(700);await page.reload();await page.getByTestId('room-toggle').click();expect(await data(page)).toEqual(recorded);expect(errors).toEqual([]);
});
test('Mirror reads interpolated source and creates only target key; Merge seeds frozen shape; undo restores absence',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();await view(page,30);await dragHandle(page,1,15,10);
 await page.getByRole('button',{name:'Duplicate Current Frame',exact:true}).click();await view(page,15);
 const original=await data(page),source=original.curves[0],target=original.curves[1];await page.getByRole('button',{name:'Mirror Edit',exact:true}).click();const before=await history(page);
 await page.getByTestId('recording-row').nth(0).getByRole('button').first().click();expect(await history(page)).toBe(before);
 await page.getByTestId('recording-row').nth(1).getByRole('button').first().click();const mirrored=await data(page);expect(mirrored.curves[0]).toEqual(source);expect(mirrored.curves[1].keys).toHaveLength(2);expect(await history(page)).toBe(before+1);
 await undo(page);expect(await data(page)).toEqual(original);
 await page.getByRole('button',{name:'Endpoint Merge',exact:true}).click();for(const [end,n] of [[3,0],[0,1]]){const b=(await page.getByTestId(`merge-end-${end}`).nth(n).boundingBox())!;await page.mouse.click(b.x+b.width/2,b.y+b.height/2);}const merged=await data(page);expect(merged.curves[0]).toEqual(source);expect(merged.curves[1].keys).toHaveLength(2);
 const k=merged.curves[1].keys.find((k:any)=>k.yaw===15),prior=target.keys[0].shape;expect(k.shape[3]).toEqual(prior[3]);expect(k.shape[2]).toEqual(prior[2]);expect(k.shape[1][0]-k.shape[0][0]).toBeCloseTo(prior[1][0]-prior[0][0]);
 await undo(page);expect(await data(page)).toEqual(original);await expect(page.getByTestId('recording-status')).toHaveText('Outside coverage · frozen reference');
});
test('Duplicate frozen WYSIWYG, tool cancellation, ViewMap and camera-only navigation, resize',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();const base=await data(page);await view(page,-45);
 await page.getByRole('button',{name:'Duplicate Current Frame',exact:true}).click();const r=await data(page);expect(r.curves).toHaveLength(2);expect(r.curves[1].keys).toHaveLength(1);expect(r.curves[1].keys[0].yaw).toBe(45);
 await undo(page);expect(await data(page)).toEqual(base);await page.getByTestId('recording-row').first().getByRole('button').first().click();await view(page,0);
 await page.getByRole('button',{name:'Mirror Edit',exact:true}).click();await page.getByTestId('recording-row').first().getByRole('button').first().click();await page.keyboard.press('Escape');expect(await data(page)).toEqual(base);await page.keyboard.press('Escape');
 await page.getByTestId('recording-map').click({position:{x:80,y:60}});expect(await data(page)).toEqual(base);
 await page.getByRole('button',{name:'View Navigation',exact:true}).click();const canvas=(await page.getByTestId('recording-canvas').boundingBox())!;await page.mouse.move(canvas.x+200,canvas.y+200);await page.mouse.down();await page.mouse.move(canvas.x+300,canvas.y+250,{steps:12});await page.mouse.up();
 const v=await page.evaluate(async()=>{const url='/src/ui/recording/session.ts';return (await import(url)).useRecording.getState().view;});expect(Number.isFinite(v.yaw)).toBe(true);expect(await data(page)).toEqual(base);
 await page.setViewportSize({width:1700,height:1100});await view(page,0);await page.getByRole('button',{name:'Edit Curve',exact:true}).click();await page.screenshot({path:'artifacts/recording/recording-room.png'});await dragHandle(page,1,20,0);expect((await data(page)).curves[0].keys).toHaveLength(1);
 await page.getByTestId('room-toggle').click();await expect(page.getByTestId('recording-room')).toHaveCount(0);await page.getByTestId('room-toggle').click();await expect(page.getByTestId('recording-room')).toBeVisible();
});
test('cancelled drags do not create keys or history; frozen sources rejected; hide/lock and rename undo',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();await view(page,20);const original=await data(page),n=await history(page);
 const h=(await page.getByTestId('recorded-control-1').boundingBox())!;await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+30,h.y+20);await expect(page.getByTestId('recording-status')).toHaveText('Exact View Key');await page.keyboard.press('Escape');await page.mouse.up();expect(await data(page)).toEqual(original);expect(await history(page)).toBe(n);
 await page.getByRole('button',{name:'Mirror Edit',exact:true}).click();await page.getByTestId('recording-row').first().getByRole('button').first().click();await expect(page.getByRole('status')).toHaveText('Frozen shapes cannot be used as a precise source');expect(await history(page)).toBe(n);
 await page.getByRole('button',{name:'Edit Curve',exact:true}).click();await view(page,0);
 const name=page.getByRole('textbox',{name:'Recorded curve name'});await name.fill('Jaw');await name.press('Enter');await expect(name).toHaveValue('Jaw');await undo(page);await expect(name).toHaveValue(original.curves[0].name);
 const row=page.getByTestId('recording-row').first();await row.getByRole('checkbox').uncheck();await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(0);await row.getByRole('checkbox').check();await row.getByRole('button').last().click();const locked=await data(page),count=await history(page);await dragHandle(page,1,30,0);expect(await data(page)).toEqual(locked);expect(await history(page)).toBe(count);
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'镜像编辑',exact:true})).toBeVisible();
});
test('retired Gridify recordings retain samples and show every ordinary key',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts',p=structuredClone(e.project),c=p.recording.curves[0];c.gridStepDegrees=5;c.keys=[[0,0],[5,0],[0,5],[2,2]].map(([yaw,pitch])=>({yaw,pitch,shape:c.keys[0].shape}));e.load((await import(url)).parseLandmarks(JSON.stringify(p)));});
 await page.getByTestId('recording-row').first().getByRole('button').first().click();
 expect((await data(page)).curves[0].keys).toHaveLength(4);expect((await data(page)).curves[0]).not.toHaveProperty('gridStepDegrees');
 await expect(page.getByRole('button',{name:/Gridify/})).toHaveCount(0);
 await expect(page.getByTestId('recording-key-marker')).toHaveCount(4);
});
test('Bind closes immediately, derived picking, shared endpoint, handle edit and undo persist',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();await view(page,30);await dragHandle(page,1,15,0);
 await page.getByRole('button',{name:'Duplicate Current Frame',exact:true}).click();await view(page,0);await dragHandle(page,1,10,0);await view(page,15);
 const raw=await data(page),before=await history(page);
 await page.getByRole('button',{name:'Bind Endpoint',exact:true}).click();
 for(const [end,n] of [[3,0],[0,1]]){const b=(await page.getByTestId(`merge-end-${end}`).nth(n).boundingBox())!;await page.mouse.click(b.x+b.width/2,b.y+b.height/2);}
 const bound=await data(page);expect(bound.junctions).toHaveLength(1);expect(bound.curves).toEqual(raw.curves);expect(await history(page)).toBe(before+1);
 await dragHandle(page,0,30,20);const shared=await data(page);expect(shared.junctions).toEqual(bound.junctions);expect(await history(page)).toBe(before+2);
 for(const c of shared.curves)expect(c.keys.some((k:any)=>k.yaw===15)).toBe(true);
 await undo(page);expect(await data(page)).toEqual(bound);
 await dragHandle(page,1,10,0);expect(await history(page)).toBe(before+2);await undo(page);expect(await data(page)).toEqual(bound);
 await undo(page);expect(await data(page)).toEqual(raw);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(bound);
 await view(page,-15);await expect(page.getByTestId('recorded-control-0')).toBeVisible();
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});expect(await data(page)).toEqual(bound);
 await page.waitForTimeout(700);await page.reload();await page.getByTestId('room-toggle').click();expect(await data(page)).toEqual(bound);
});
test('front centerline snaps endpoint exactly at different zooms and stays out of preview',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 for(const zoom of [1,2]){
 if(zoom===2){await page.getByTestId('recording-canvas').hover();await page.mouse.wheel(0,-693);await page.waitForTimeout(100);}
 const h=(await page.getByTestId('recorded-control-3').boundingBox())!,line=page.getByTestId('recording-centerline'),canvas=(await page.getByTestId('recording-canvas').boundingBox())!;
 const x=Number(await line.getAttribute('x1'))+canvas.x;
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(x+3,h.y+h.height/2,{steps:5});await page.mouse.up();
 expect((await data(page)).curves[0].keys[0].shape[3][0]).toBe(0);
 }
 await expect(page.getByTestId('recording-final').locator('line')).toHaveCount(0);
 await view(page,5);await expect(page.getByTestId('recording-centerline')).toHaveCount(0);
});
test('Smooth singleton propagation, style Auto-Key undo, constrained handles, negative yaw and persistence',async({page})=>{
 await page.evaluate(()=>{const e=(window as any).__editorPerfStore.getState();const shapes=[[[-.8,.6],[-.7,0],[-.3,-.6],[0,-.6]],[[0,-.6],[.3,-.6],[.7,0],[.8,.6]]];e.setRecording({version:1,curves:shapes.map((shape,i)=>({id:i?'b':'a',name:i?'Right':'Left',locked:false,visible:true,keys:[[0,0],[60,0],[0,60]].map(([yaw,pitch])=>({yaw,pitch,shape}))})),junctions:[{id:'j',masterCurveId:'a',masterEndpoint:'P1',followerCurveId:'b',followerEndpoint:'P0',mode:'POSITION'}]});});
 const raw=await data(page);await page.getByTestId('recording-junction-row').click();await page.getByRole('button',{name:'Enable Smooth Junction',exact:true}).click();
 await expect(page.getByTestId('smooth-final')).toHaveCount(1);const enabled=await data(page);expect(enabled.curves).toEqual(raw.curves);expect(enabled.junctions[0].smoothKeys).toHaveLength(1);
 await undo(page);await expect(page.getByTestId('smooth-final')).toHaveCount(0);await page.getByRole('button',{name:'Redo',exact:true}).click();
 await view(page,20,10);await expect(page.getByTestId('smooth-final')).toHaveCount(1);expect((await data(page)).junctions[0].smoothKeys).toHaveLength(1);
 const h=(await page.getByTestId('smooth-handle-0').boundingBox())!,before=await history(page);await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+15,h.y+h.height/2+5,{steps:4});await page.mouse.up();
 expect((await data(page)).junctions[0].smoothKeys).toHaveLength(2);expect(await history(page)).toBe(before+1);await undo(page);expect((await data(page)).junctions[0].smoothKeys).toHaveLength(1);
 await view(page,-30,5);const slider=page.getByRole('slider',{name:'Tension B',exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();const input=slider.locator('..').locator('.numeric-slider-entry');await input.fill('2');await input.press('Enter');
 const edited=await data(page);expect(edited.junctions[0].smoothKeys.some((k:any)=>k.yaw===30&&k.pitch===5&&k.tensionB===2)).toBe(true);expect(edited.curves).toEqual(raw.curves);
 await expect(page.getByTestId('recording-key-marker')).toHaveCount(2);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});expect(await data(page)).toEqual(edited);
 await page.waitForTimeout(700);await page.reload();await page.getByTestId('room-toggle').click();expect(await data(page)).toEqual(edited);await page.getByTestId('recording-junction-row').click();await expect(page.getByTestId('smooth-final')).toHaveCount(1);
 await page.screenshot({path:'artifacts/recording/smooth-junction.png'});
 await view(page,80);await expect(page.getByTestId('smooth-final')).toHaveCount(0);await expect(page.getByRole('slider',{name:'Tension A',exact:true})).toBeDisabled();
});
test('Key list shift range delete is atomic, preserves junctions, and protects last key',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 await page.evaluate(()=>{const e=(window as any).__editorPerfStore.getState(),r=structuredClone(e.project.recording),c=r.curves[0];c.keys=[30,0,20,10,40].map(yaw=>({yaw,pitch:0,shape:c.keys[0].shape}));r.curves.push({...structuredClone(c),id:'follower',name:'Follower'});r.junctions=[{id:'bind-test',mode:'POSITION',masterCurveId:c.id,masterEndpoint:'P1',followerCurveId:'follower',followerEndpoint:'P0'}];e.setRecording(r);});
 const original=await data(page),before=await history(page),rows=page.locator('.recording-inspector .recording-key');
 await expect(rows.nth(0)).toContainText('Yaw 0°');
 await rows.nth(1).getByRole('button').first().click();await rows.nth(3).getByRole('button').first().click({modifiers:['Shift']});
 await expect(page.locator('.recording-key.selected')).toHaveCount(3);expect(await history(page)).toBe(before);
 await page.getByRole('button',{name:'Delete Selected Keys (3)',exact:true}).click();
 let r=await data(page);expect(r.curves[0].keys.map((k:any)=>k.yaw).sort((a:number,b:number)=>a-b)).toEqual([0,40]);expect(r.curves[1]).toEqual(original.curves[1]);expect(r.junctions).toEqual(original.junctions);expect(await history(page)).toBe(before+1);
 await undo(page);expect(await data(page)).toEqual(original);await page.getByRole('button',{name:'Redo',exact:true}).click();
 await rows.first().getByRole('button').first().click();await rows.last().getByRole('button').first().click({modifiers:['Shift']});await expect(page.getByRole('button',{name:'Delete Selected Keys (2)',exact:true})).toBeDisabled();
 await rows.last().getByRole('button',{name:'Delete Key',exact:true}).click();await expect(rows).toHaveCount(1);await expect(rows.first().getByRole('button',{name:'Delete Key',exact:true})).toBeDisabled();
});
test('dragging bound endpoint at a new view auto-keys every member and undo restores frozen field',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 await page.evaluate(()=>{const e=(window as any).__editorPerfStore.getState(),r=structuredClone(e.project.recording),a=r.curves[0];r.curves.push({...structuredClone(a),id:'b',name:'B'},{...structuredClone(a),id:'c',name:'C'});r.junctions=[{id:'ab',mode:'POSITION',masterCurveId:a.id,masterEndpoint:'P0',followerCurveId:'b',followerEndpoint:'P0'},{id:'bc',mode:'POSITION',masterCurveId:'b',masterEndpoint:'P0',followerCurveId:'c',followerEndpoint:'P0'}];e.setRecording(r);});
 await page.getByTestId('recording-row').nth(2).getByRole('button').first().click();await view(page,-35,10);
 const before=await data(page),count=await history(page);await expect(page.getByTestId('recording-status')).toHaveText('Outside coverage · frozen reference');
 await dragHandle(page,0,15,10);const after=await data(page);for(const c of after.curves)expect(c.keys.some((k:any)=>k.yaw===35&&k.pitch===10)).toBe(true);
 expect(await history(page)).toBe(count+1);await expect(page.locator('[data-curve][data-status="frozen"]')).toHaveCount(0);
 await undo(page);expect(await data(page)).toEqual(before);await expect(page.getByTestId('recording-status')).toHaveText('Outside coverage · frozen reference');
});
test('per-view unbind hides Smooth, snapshots position and supports undo, negative yaw and save/load',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 await page.evaluate(()=>{const e=(window as any).__editorPerfStore.getState(),r=structuredClone(e.project.recording),a=r.curves[0];a.keys=[0,30].map(yaw=>({yaw,pitch:0,shape:[[-1,0],[-.7,0],[-.3,0],[0,0]]}));r.curves.push({...structuredClone(a),id:'b',name:'B',keys:[0,30].map(yaw=>({yaw,pitch:0,shape:[[.2,0],[.2,.3],[.2,.7],[.2,1]]}))});r.junctions=[{id:'ab',mode:'SMOOTH',masterCurveId:a.id,masterEndpoint:'P1',followerCurveId:'b',followerEndpoint:'P0',baseRadius:.08,smoothKeys:[{yaw:0,pitch:0,radiusScale:1,tensionA:1,tensionB:1}]}];e.setRecording(r);});
 await page.getByTestId('recording-junction-row').click();await view(page,30);
 await expect(page.getByTestId('smooth-transition')).toHaveCount(1);const prior=await data(page),n=await history(page);
 await page.getByRole('button',{name:'Unbind at This View',exact:true}).click();
 await expect(page.getByTestId('binding-state')).toHaveText('Current view: Unbound');await expect(page.getByTestId('smooth-transition')).toHaveCount(0);
 const saved=await data(page);expect(saved.curves[1].keys.find((k:any)=>k.yaw===30).shape[0]).toEqual([0,0]);expect(await history(page)).toBe(n+1);
 await undo(page);expect(await data(page)).toEqual(prior);await expect(page.getByTestId('smooth-transition')).toHaveCount(1);await page.getByRole('button',{name:'Redo',exact:true}).click();
 await view(page,-30);await expect(page.getByTestId('binding-state')).toHaveText('Current view: Unbound');
 await view(page,0);await expect(page.getByTestId('smooth-transition')).toHaveCount(1);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});expect(await data(page)).toEqual(saved);
});
test('hide at current view preserves all keys, suppresses picking and Smooth, undo restores',async({page})=>{
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();
 await page.evaluate(()=>{const e=(window as any).__editorPerfStore.getState(),r=structuredClone(e.project.recording),a=r.curves[0];a.keys=[0,30].map(yaw=>({yaw,pitch:0,shape:[[-1,0],[-.7,0],[-.3,0],[0,0]]}));r.curves.push({...structuredClone(a),id:'b',name:'B',keys:[0,30].map(yaw=>({yaw,pitch:0,shape:[[0,0],[0,.3],[0,.7],[0,1]]}))});r.junctions=[{id:'ab',mode:'SMOOTH',masterCurveId:a.id,masterEndpoint:'P1',followerCurveId:'b',followerEndpoint:'P0',baseRadius:.08,smoothKeys:[{yaw:0,pitch:0,radiusScale:1,tensionA:1,tensionB:1}]}];e.setRecording(r);});
 await view(page,30);const before=await data(page),n=await history(page);await expect(page.getByTestId('smooth-transition')).toHaveCount(1);
 await page.getByRole('button',{name:'Hide/Delete at This View',exact:true}).click();let after=await data(page);expect(after.curves[0].keys).toEqual(before.curves[0].keys);expect(after.junctions).toEqual(before.junctions);expect(after.curves).toHaveLength(2);expect(await history(page)).toBe(n+1);
 await expect(page.getByTestId('recorded-hit')).toHaveCount(1);await expect(page.getByTestId('smooth-transition')).toHaveCount(0);await expect(page.getByTestId('recording-final').locator('path')).toHaveCount(1);
 await view(page,0);await expect(page.getByTestId('recorded-hit')).toHaveCount(2);await expect(page.getByTestId('smooth-transition')).toHaveCount(1);
 await view(page,-30);await expect(page.getByTestId('recorded-hit')).toHaveCount(1);await page.getByRole('button',{name:'Restore at This View',exact:true}).click();await expect(page.getByTestId('recorded-hit')).toHaveCount(2);
 await undo(page);await expect(page.getByTestId('recorded-hit')).toHaveCount(1);await undo(page);expect(await data(page)).toEqual(before);
});
