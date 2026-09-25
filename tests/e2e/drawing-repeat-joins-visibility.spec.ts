import {test,expect,type Page} from '@playwright/test';
import {drawingTool} from '../helpers/drawingTool';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const position=(d:any,id:string,end:number)=>d.nodes.find((n:any)=>n.id===d.curves.find((c:any)=>c.id===id).nodes[end]).position;
async function click(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;await p.mouse.click(r.x+r.width/2+x*u,r.y+r.height/2-y*u);}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

for(const tool of ['bind','smooth','cusp','arc','link','merge'])test(`${tool} stays active across two endpoint pairs and Undo`,async({page})=>{
 await page.evaluate(async()=>{
  const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),s=await import('/src/ui/drawing/session.ts' as string);
  let d=c.addLayer(m.emptyDrawing(),'Connections');const layer=d.layers[0].id;
  for(const [a,b,y] of [['a','b',.45],['c','d',-.65]] as const){
   d=c.createCurve(d,layer,[[-.9,y],[-.6,y],[-.3,y],[0,y]],.016,a,a);
   d=c.createCurve(d,layer,[[.2,y],[.2,y+.15],[.2,y+.3],[.2,y+.45]],.016,b,b);
  }
  (window as any).__editorPerfStore.getState().setDrawing(d);s.useDrawing.setState({selection:{ids:[]},layerId:layer,tool:'select',preview:false,zoom:1,pan:[0,0]});
 });
 const h=await history(page);await drawingTool(page,tool);
 await click(page,0,.45);await click(page,.2,.45);
 const first=await data(page);expect(position(first,'a',1)).toEqual(position(first,'b',0));expect(await history(page)).toBe(h+1);
 await expect(page.getByTestId(`drawing-tool-${tool}`)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.drawing-step')).toContainText('First:');
 // No toolbar click between independent pairs.
 await click(page,0,-.65);await click(page,.2,-.65);
 const second=await data(page);expect(position(second,'c',1)).toEqual(position(second,'d',0));expect(await history(page)).toBe(h+2);
 if(['smooth','cusp','arc'].includes(tool))expect(second.joins.map((j:any)=>j.mode)).toEqual([tool.toUpperCase(),tool.toUpperCase()]);
 if(tool==='link')expect(second.endpointLinks).toHaveLength(2);
 await expect(page.getByTestId(`drawing-tool-${tool}`)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(first);
 await expect(page.getByTestId(`drawing-tool-${tool}`)).toHaveAttribute('aria-pressed','true');
 await click(page,0,-.65);const partial=await data(page);await page.keyboard.press('Escape');expect(await data(page)).toEqual(partial);
 await expect(page.locator('.drawing-step')).toContainText('First:');
 await drawingTool(page,'direct');await expect(page.getByTestId('drawing-tool-direct')).toHaveAttribute('aria-pressed','true');
});

test('global show/hide is a one-shot batch; layer overrides, ink masks, locks, history and saved states remain independent',async({page})=>{
 await expect(page.getByTestId('drawing-show-all')).toBeDisabled();await expect(page.getByTestId('drawing-hide-all')).toBeDisabled();
 const ids=await page.evaluate(async()=>{
  const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string),g=await import('/src/domain/drawing/groups.ts' as string);
  let d=c.addLayer(m.emptyDrawing(),'Eye');const eye=d.layers[0].id,e=c.ellipse(d,eye,[-.4,-.3],[.4,.3],.02);
  d=p.createFill(p.setInk(e.document,e.ids,{inkVisible:false}),e.ids,'black');
  d=c.createCurve(d,eye,[[-.6,.5],[-.2,.7],[.2,.7],[.6,.5]],.02,'Brow','brow');d=p.createOffset(d,'brow');d=g.createGroup(d,[e.ids[0],'brow']);d=c.layerChange(d,eye,{locked:true});
  d=c.addLayer(d,'Hair');const hair=d.layers[0].id;d=c.createCurve(d,hair,[[-.6,.9],[-.2,1],[.2,1],[.6,.9]],.02,'Hair line','hair');
  (window as any).__editorPerfStore.getState().setDrawing(d);return {eye,hair};
 });
 const before=await data(page),h=await history(page),all=(d:any)=>[...d.curves,...d.fills,...d.offsets];
 await page.getByTestId('drawing-hide-all').click();const hidden=await data(page);
 expect(all(hidden).every(o=>!o.visible)).toBe(true);expect(await history(page)).toBe(h+1);
 await expect(page.getByTestId('drawing-ink')).toHaveCount(0);await expect(page.getByTestId('drawing-fill')).toHaveCount(0);await expect(page.getByTestId('drawing-offset')).toHaveCount(0);
 await page.locator(`[data-testid=drawing-layer][data-id="${ids.eye}"]`).getByTestId('drawing-layer-visibility').click();
 const onlyEye=await data(page);expect(onlyEye.curves.find((c:any)=>c.id==='hair').visible).toBe(false);expect(onlyEye.fills[0].visible).toBe(true);
 await expect(page.getByTestId('drawing-fill')).toHaveCount(1);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);await expect(page.getByTestId('drawing-offset')).toHaveCount(1);
 await page.getByTestId('drawing-show-all').click();const shown=await data(page);expect(all(shown).every(o=>o.visible)).toBe(true);expect(shown).toEqual(before);expect(await history(page)).toBe(h+3);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(onlyEye);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(shown);
 await page.getByTestId('drawing-hide-all').click();
 await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),s=(window as any).__editorPerfStore.getState(),d=s.project.drawing;s.setDrawing(c.createCurve(d,d.layers[0].id,[[0,-.8],[.1,-.8],[.2,-.8],[.3,-.8]],.02,'New','new'));});
 await expect(page.getByTestId('drawing-ink')).toHaveCount(1);expect((await data(page)).curves.find((c:any)=>c.id==='new').visible).toBe(true);
 const saved=await data(page),download=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await download).path())!);await expect.poll(()=>data(page)).toEqual(saved);
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'显示全部图层',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'隐藏全部图层',exact:true})).toBeVisible();
 await page.setViewportSize({width:1100,height:900});
 const header=page.locator('.drawing-layers > header'),box=(await header.boundingBox())!;
 for(const button of await header.getByRole('button').all()){const b=(await button.boundingBox())!;expect(b.x).toBeGreaterThanOrEqual(box.x);expect(b.x+b.width).toBeLessThanOrEqual(box.x+box.width);}
 await page.screenshot({path:'artifacts/drawing-room/global-layer-visibility.png'});
});
