import {test,expect,type Page} from '@playwright/test';
import {drawingTool} from '../helpers/drawingTool';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const layer=(p:Page,name:string)=>p.locator('.drawing-layer-row').getByRole('button',{name,exact:true}).click();
async function coord(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;return {x:r.x+r.width/2+x*u,y:r.y+r.height/2-y*u};}
async function click(p:Page,x:number,y:number){const q=await coord(p,x,y);await p.mouse.click(q.x,q.y);}
async function nodeIds(p:Page){return p.getByTestId('drawing-node').evaluateAll(els=>els.map(e=>e.getAttribute('data-node')).sort());}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();
 await page.evaluate(async()=>{const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Eye');
 d=c.createCurve(d,d.layers[0].id,[[-.9,.3],[-.7,.6],[-.3,.6],[0,.3]],.014,'Lid A','a');
 d=c.createCurve(d,d.layers[0].id,[[.25,.3],[.45,.6],[.7,.6],[.9,.3]],.014,'Lid B','b');
 d=c.createCurve(d,d.layers[0].id,[[-.9,.8],[-.7,.8],[-.3,.8],[0,.8]],.014,'Hidden','hidden');d=c.curveChange(d,'hidden',{visible:false});
 d=c.createCurve(d,d.layers[0].id,[[-.9,-.8],[-.7,-.8],[-.3,-.8],[0,-.8]],.014,'Locked','locked');d=c.curveChange(d,'locked',{locked:true});
 d=c.addLayer(d,'Ear');d=c.createCurve(d,d.layers[0].id,[[-.9,-.3],[-.7,-.6],[-.3,-.6],[0,-.3]],.014,'Other A','other-a');
 // This endpoint overlaps b exactly: a hidden candidate must not win the pick.
 d=c.createCurve(d,d.layers[0].id,[[.25,.3],[.45,-.6],[.7,-.6],[.9,-.3]],.014,'Other B','other-b');
 (window as any).__editorPerfStore.getState().setDrawing(d);});
});

test('all endpoint tools show only editable endpoints of the current layer; other artwork remains visible',async({page})=>{
 await layer(page,'Eye');const d=await data(page),expected=d.curves.filter((c:any)=>['a','b'].includes(c.id)).flatMap((c:any)=>c.nodes).sort();
 for(const tool of ['merge','link','bind','smooth','cusp','arc']){
  await drawingTool(page,tool);expect(await nodeIds(page)).toEqual(expected);await expect(page.getByTestId('drawing-ink')).toHaveCount(5);
  await click(page,0,-.3);await expect(page.locator('.drawing-step')).toContainText('First');expect(await data(page)).toEqual(d);
 }
 await click(page,0,.3);await click(page,.25,.3);const result=await data(page);
 expect(result.joins).toHaveLength(1);expect(result.joins[0]).toMatchObject({mode:'ARC',a:{curveId:'a',end:1},b:{curveId:'b',end:0}});
 expect(result.curves.filter((c:any)=>c.id.startsWith('other'))).toEqual(d.curves.filter((c:any)=>c.id.startsWith('other')));
});

test('switching target layer keeps a join tool and restarts its first click, without leaking a preview',async({page})=>{
 await layer(page,'Eye');await drawingTool(page,'cusp');const before=await data(page);await click(page,0,.3);const q=await coord(page,.25,.3);await page.mouse.move(q.x,q.y);
 await expect(page.getByTestId('drawing-ink')).toHaveCount(4);expect(await data(page)).toEqual(before);
 await layer(page,'Ear');await expect(page.getByTestId('drawing-tool-cusp')).toHaveAttribute('aria-pressed','true');await expect(page.locator('.drawing-step')).toContainText('First');await expect(page.getByTestId('drawing-ink')).toHaveCount(5);
 expect(await nodeIds(page)).toEqual(before.curves.filter((c:any)=>c.id.startsWith('other')).flatMap((c:any)=>c.nodes).sort());
 await click(page,0,-.3);await click(page,.25,.3);const after=await data(page);expect(after.joins).toHaveLength(1);expect(after.joins[0].a.curveId).toBe('other-a');expect(after.joins[0].b.curveId).toBe('other-b');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(before);
});

test('starting an endpoint tool from a selected curve activates its owner layer',async({page})=>{
 await layer(page,'Ear');await page.locator('[data-testid=drawing-curve-row][data-id="a"] .drawing-object-name').click();await drawingTool(page,'smooth');
 await expect(page.locator('.drawing-status')).toContainText('Eye');const d=await data(page);expect(await nodeIds(page)).toEqual(d.curves.filter((c:any)=>['a','b'].includes(c.id)).flatMap((c:any)=>c.nodes).sort());
 await page.screenshot({path:'artifacts/drawing-room/endpoint-layer-scope.png'});
});
