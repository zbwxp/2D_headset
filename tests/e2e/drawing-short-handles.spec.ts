import {drawingTool} from '../helpers/drawingTool';
import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync('src/tests/fixtures/drawing-eyelid-handles.json','utf8'));
const ids=fixture.curves.filter((c:any)=>c.name.startsWith('曲线17')).map((c:any)=>c.id);
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
async function seed(p:Page){await p.evaluate(async d=>{const m=await import('/src/domain/drawing/model.ts' as string);(window as any).__editorPerfStore.getState().setDrawing(m.parseDrawing(d));},fixture);}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();await seed(page);});

test('diagnose both eyelid start handles: data exists, screen positions overlap the shared node',async({page})=>{
 for(const id of ids){await page.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();const d=await data(page),c=d.curves.find((c:any)=>c.id===id),n=d.nodes.find((n:any)=>n.id===c.nodes[0]);expect(Math.hypot(c.handles[0][0]-n.position[0],c.handles[0][1]-n.position[1])).toBeCloseTo(.00016556136326817056,12);
 const handle=page.locator(`[data-testid=drawing-handle][data-id="${id}"][data-end="0"]`);await expect(handle).toHaveCount(1);const hit=await handle.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit?.getAttribute('data-testid');});expect(hit).toBe('drawing-node');
 }
});

test('short handles are clickable around the node and can be explicitly selected without changing the curve',async({page})=>{
 const before=await data(page);
 for(const id of ids){await page.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();const handle=page.locator(`[data-testid=drawing-handle][data-id="${id}"][data-end="0"]`);await expect(handle).toHaveAttribute('data-short','true');const r=(await handle.boundingBox())!;await page.mouse.click(r.x+r.width/2+7,r.y+r.height/2);await expect(handle).toHaveAttribute('data-active','true');expect(await data(page)).toEqual(before);
  await page.getByRole('button',{name:'P0 Endpoint',exact:true}).click();await expect(handle).toHaveAttribute('data-active','false');await page.getByRole('button',{name:'P0 Handle',exact:true}).click();await expect(handle).toHaveAttribute('data-active','true');
  const hit=await handle.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.getAttribute('data-testid');});expect(hit).toBe('drawing-handle');expect(await data(page)).toEqual(before);
 }
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'P0 控制柄',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/drawing-arc/eyelid-handle-select.png'});
});

test('both eyelid handles drag without geometry jumps, leave the bound node and partner alone, Undo and save/load',async({page})=>{
 for(const id of ids){await page.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();await page.getByRole('button',{name:'P0 Handle',exact:true}).click();const before=await data(page),h=await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length),handle=page.locator(`[data-testid=drawing-handle][data-id="${id}"][data-end="0"]`),r=(await handle.boundingBox())!,canvas=(await page.getByTestId('drawing-canvas').boundingBox())!,unit=Math.min(canvas.width,canvas.height)/2.8;
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+30,r.y+r.height/2-22,{steps:6});expect(await data(page)).toEqual(before);await page.mouse.up();const after=await data(page),a=after.curves.find((c:any)=>c.id===id),b=before.curves.find((c:any)=>c.id===id);expect(a.handles[0][0]-b.handles[0][0]).toBeCloseTo(30/unit,7);expect(a.handles[0][1]-b.handles[0][1]).toBeCloseTo(22/unit,7);expect(a.handles[1]).toEqual(b.handles[1]);expect(after.nodes).toEqual(before.nodes);expect(after.joins).toEqual(before.joins);expect(after.curves.filter((c:any)=>c.id!==id)).toEqual(before.curves.filter((c:any)=>c.id!==id));expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length)).toBe(h+1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(after);
 }
 const saved=await data(page),dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(saved);
});

test('a completely collapsed handle remains editable and does not prevent cusp conversion at the shared node',async({page})=>{
 const id=ids[0];await page.evaluate(async id=>{const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string),store=(window as any).__editorPerfStore.getState(),d=store.project.drawing;store.setDrawing(c.moveHandle(d,{curveId:id,end:0},m.nodeAt(d,{curveId:id,end:0}).position));},id);
 await page.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();await page.getByRole('button',{name:'P0 Endpoint',exact:true}).click();const before=await data(page),nodeId=before.curves.find((c:any)=>c.id===id).nodes[0];await page.getByRole('button',{name:'Position only',exact:true}).last().click();await drawingTool(page,'cusp');const node=page.locator(`[data-testid=drawing-node][data-node="${nodeId}"]`),r=(await node.boundingBox())!;await page.mouse.click(r.x+r.width/2,r.y+r.height/2);await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
 const after=await data(page);expect(after.joins.some((j:any)=>j.mode==='CUSP'&&[j.a,j.b].some((e:any)=>e.curveId===id&&e.end===0))).toBe(true);expect(after.curves).toEqual(before.curves);expect(after.nodes).toEqual(before.nodes);
 await page.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();await page.getByRole('button',{name:'P0 Handle',exact:true}).click();const f=page.getByRole('spinbutton',{name:'Node X',exact:true});await f.fill('-0.44');await f.press('Enter');expect((await data(page)).curves.find((c:any)=>c.id===id).handles[0][0]).toBe(-.44);
});
