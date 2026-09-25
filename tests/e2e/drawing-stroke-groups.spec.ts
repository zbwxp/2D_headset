import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
async function seed(p:Page,branch=false){await p.evaluate(async(branch)=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Line art');
 const pts=[[-.9,0],[-.45,.25],[0,.05],[.45,.3],[.9,0]];for(let i=0;i<4;i++){const a=pts[i],b=pts[i+1],v=b.map((x,k)=>x-a[k]);d=c.createCurve(d,d.layers[0].id,[a,a.map((x,k)=>x+v[k]/3),a.map((x,k)=>x+v[k]*2/3),b],.018,'Curve '+i,String(i));}
 for(let i=0;i<3;i++)d=c.connect(d,{curveId:String(i),end:1},{curveId:String(i+1),end:0},(['POSITION','SMOOTH','ARC'] as const)[i]);
 if(branch){d=c.createCurve(d,d.layers[0].id,[[0,.05],[0,-.2],[.1,-.45],[.2,-.6]],.018,'Branch','branch');d=c.connect(d,{curveId:'1',end:1},{curveId:'branch',end:0},'POSITION');}
 (window as any).__editorPerfStore.getState().setDrawing(d);
 },branch);}
async function hit(p:Page,id:string){const q=await p.locator(`[data-testid=drawing-hit][data-id="${id}"]`).first().evaluate(el=>{const path=el as SVGPathElement,q=path.getPointAtLength(path.getTotalLength()*.5).matrixTransform(path.getScreenCTM()!);return {x:q.x,y:q.y};});await p.mouse.click(q.x,q.y);}
async function name(p:Page,value:string){const f=p.getByRole('textbox',{name:'Stroke name',exact:true});await f.fill(value);await f.press('Enter');}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('all connection types form one selectable group, named independently with Undo and Save/Load',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);await expect(page.getByTestId('drawing-chain-select')).toHaveCount(1);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);
 await page.getByTestId('drawing-tool-select').click();await hit(page,'0');await expect(page.getByTestId('drawing-selected')).toHaveCount(4);const before=await data(page),h=await history(page);await name(page,'Upper eyelid');await expect(page.getByTestId('drawing-chain-select')).toContainText('Upper eyelid');expect(await history(page)).toBe(h+1);const named=await data(page);expect(named.curves.map((x:any)=>x.name)).toEqual(before.curves.map((x:any)=>x.name));expect(named.nodes).toEqual(before.nodes);expect(named.joins).toEqual(before.joins);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(named);
 await page.locator('[data-testid=drawing-curve-row][data-id="1"] .drawing-object-name').click();await expect(page.getByTestId('drawing-selected')).toHaveCount(1);await expect(page.getByRole('textbox',{name:'Stroke name',exact:true})).toHaveValue('Upper eyelid');await name(page,'Lid outline');await expect(page.getByTestId('drawing-chain-select')).toContainText('Lid outline');
 const saved=await data(page),dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(saved);await expect(page.getByTestId('drawing-chain-select')).toContainText('Lid outline');
 await page.getByTestId('drawing-chain-select').click();await page.getByTestId('language-toggle').click();await expect(page.getByRole('textbox',{name:'笔画名称',exact:true})).toHaveValue('Lid outline');await page.screenshot({path:'artifacts/drawing-arc/stroke-group-name.png'});expect(errors).toEqual([]);
});

test('POSITION chain keeps independent handles while becoming one group; unbind and rebind regroup immediately',async({page})=>{
 await seed(page);await page.locator('[data-testid=drawing-curve-row][data-id="0"] .drawing-object-name').click();const before=await data(page),nodeId=before.curves[0].nodes[1];await page.locator(`[data-testid=drawing-node][data-node="${nodeId}"]`).click();await expect(page.getByText('Position only',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Unbind this endpoint',exact:true}).click();await expect(page.getByTestId('drawing-stroke-row')).toHaveCount(2);await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByTestId('drawing-stroke-row')).toHaveCount(1);expect(await data(page)).toEqual(before);
 await page.getByTestId('drawing-chain-select').click();await name(page,'Face line');await page.getByRole('button',{name:'Duplicate',exact:true}).click();await expect(page.getByTestId('drawing-chain-select')).toHaveCount(2);await name(page,'Face line copy');await expect(page.getByTestId('drawing-chain-select').filter({hasText:'Face line copy'})).toHaveCount(1);expect((await data(page)).curves.filter((x:any)=>x.strokeName==='Face line')).toHaveLength(4);
});

test('branched bindings select and name every member without losing the branch or adding phantom ink',async({page})=>{
 await seed(page,true);await expect(page.getByTestId('drawing-chain-select')).toHaveCount(1);await expect(page.getByTestId('drawing-ink')).toHaveCount(2);await page.getByTestId('drawing-tool-select').click();await hit(page,'branch');await expect(page.getByTestId('drawing-selected')).toHaveCount(5);await name(page,'Branch network');expect((await data(page)).curves.every((x:any)=>x.strokeName==='Branch network')).toBe(true);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-ink')).toHaveCount(2);
});

test('whole-stroke visibility and lock actions are atomic, handle mixed states and persist',async({page})=>{
 await seed(page,true);await page.getByTestId('drawing-chain-select').click();await name(page,'Network');const before=await data(page),h=await history(page);
 const visibility=page.getByTestId('drawing-chain-visibility'),lock=page.getByTestId('drawing-chain-lock');
 await visibility.click();await expect(page.getByTestId('drawing-ink')).toHaveCount(0);await expect(page.getByTestId('drawing-selected')).toHaveCount(0);await expect(page.getByTestId('drawing-transform-box')).toHaveCount(0);await expect(page.getByTestId('drawing-chain-select')).toHaveCount(1);expect((await data(page)).curves.every((c:any)=>!c.visible)).toBe(true);expect(await history(page)).toBe(h+1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);await expect(page.getByTestId('drawing-ink')).toHaveCount(2);await page.getByRole('button',{name:'Redo',exact:true}).click();await visibility.click();expect(await data(page)).toEqual(before);
 // Child toggles remain independent; mixed group actions include all members.
 await page.getByRole('button',{name:'Hide Curve 0',exact:true}).click();await expect(visibility).toHaveAttribute('aria-pressed','mixed');await visibility.click();await expect(visibility).toHaveAttribute('aria-pressed','false');await visibility.click();expect((await data(page)).curves.every((c:any)=>c.visible)).toBe(true);
 await page.getByRole('button',{name:'Lock Curve 0',exact:true}).click();await expect(lock).toHaveAttribute('aria-pressed','mixed');await lock.click();await expect(lock).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('drawing-transform-box')).toHaveCount(0);const locked=await data(page);expect(locked.curves.every((c:any)=>c.locked)).toBe(true);
 await page.locator('[data-testid=drawing-curve-row][data-id="1"] .drawing-object-name').click();await expect(page.getByTestId('drawing-handle')).toHaveCount(0);await expect(page.getByTestId('drawing-node')).toHaveCount(0);await expect(page.getByRole('button',{name:'Delete',exact:true})).toBeDisabled();
 // Locked geometry can still be hidden/shown using the group row.
 await visibility.click();await expect(page.getByTestId('drawing-ink')).toHaveCount(0);await visibility.click();expect(await data(page)).toEqual(locked);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(locked);await lock.click();expect((await data(page)).curves.every((c:any)=>!c.locked)).toBe(true);await expect(page.getByTestId('drawing-ink')).toHaveCount(2);
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'隐藏整笔 Network',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'锁定整笔 Network',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/drawing-arc/stroke-group-controls.png'});
});

test('closed strokes can override a layer batch lock',async({page})=>{
 await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Loop layer');const result=c.ellipse(d,d.layers[0].id,[-.6,-.4],[.6,.4],.015);d=c.renameStroke(result.document,result.ids[0],'Iris');(window as any).__editorPerfStore.getState().setDrawing(d);});
 await expect(page.getByTestId('drawing-chain-select')).toContainText('Closed stroke');const v=page.getByTestId('drawing-chain-visibility'),l=page.getByTestId('drawing-chain-lock');await v.click();await expect(page.getByTestId('drawing-ink')).toHaveCount(0);await v.click();await l.click();expect((await data(page)).curves.every((c:any)=>c.locked)).toBe(true);await l.click();
 await page.getByRole('button',{name:'Lock Loop layer',exact:true}).click();await expect(v).toBeEnabled();await expect(l).toBeEnabled();await l.click();expect((await data(page)).curves.every((c:any)=>!c.locked)).toBe(true);await expect(v).toBeEnabled();await expect(l).toBeEnabled();await expect(page.getByTestId('drawing-ink')).toHaveCount(1);
});
