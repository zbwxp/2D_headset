import {drawingTool} from '../helpers/drawingTool';
import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
const history=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
async function field(p:Page,name:string,value:string){const x=p.getByRole('spinbutton',{name,exact:true});await x.fill(value);await x.press('Enter');}
async function coord(p:Page,x:number,y:number){const r=(await p.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;return {x:r.x+r.width/2+x*u,y:r.y+r.height/2-y*u};}
async function click(p:Page,x:number,y:number){const q=await coord(p,x,y);await p.mouse.click(q.x,q.y);}
async function hit(p:Page,testid:string,id?:string){const el=p.getByTestId(testid).filter(id?{visible:true}:{});const loc=id?p.locator(`[data-testid=${testid}][data-id="${id}"]`).first():el.first();const q=await loc.evaluate(el=>{const path=el as SVGPathElement;const q=path.getPointAtLength(path.getTotalLength()*.45).matrixTransform(path.getScreenCTM()!);return {x:q.x,y:q.y};});await p.mouse.click(q.x,q.y);}
async function seed(p:Page,arc=false){await p.evaluate(async arc=>{
 const c=await import('/src/domain/drawing/commands.ts' as string),m=await import('/src/domain/drawing/model.ts' as string),s=await import('/src/ui/drawing/session.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Arc study');
 d=c.createCurve(d,d.layers[0].id,[[-1,0],[-2/3,0],[-1/3,0],[0,0]],.016,'Source A','a');d=c.createCurve(d,d.layers[0].id,[[.25,0],[.25,1/3],[.25,2/3],[.25,1]],.016,'Target B','b');
 if(arc)d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);
 (window as any).__editorPerfStore.getState().setDrawing(d);s.useDrawing.setState({selection:{ids:[]},layerId:d.layers[0].id,tool:'select',preview:false,zoom:1,pan:[0,0]});
 },arc);}
async function saveReload(p:Page){const saved=await data(p),dl=p.waitForEvent('download');await p.getByRole('button',{name:'Save JSON',exact:true}).click();await p.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(p)).toEqual(saved);await p.evaluate(async()=>{const m=await import('/src/domain/drawing/model.ts' as string);m.parseDrawing((window as any).__editorPerfStore.getState().project.drawing);});}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('ARC two-click preview, independent handles, range drag transaction, undo/redo and persistence',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);const raw=await data(page),h=await history(page);
 await drawingTool(page,'arc');await click(page,0,0);const q=await coord(page,.25,0);await page.mouse.move(q.x,q.y);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);expect(await data(page)).toEqual(raw);expect(await history(page)).toBe(h);
 await page.keyboard.press('Escape');await expect(page.getByTestId('drawing-ink')).toHaveCount(2);await click(page,0,0);await click(page,.25,0);
 let d=await data(page);expect(d.joins[0].mode).toBe('ARC');expect(d.nodes).toHaveLength(3);expect(await history(page)).toBe(h+1);await expect(page.getByTestId('drawing-arc-controls')).toBeVisible();await expect(page.getByTestId('drawing-arc-status')).toContainText('tangent angle');
 await field(page,'Influence radius px','75');expect((await data(page)).joins[0].radius).toBe(.3);const before=await data(page),n=await history(page);
 const slider=page.getByRole('slider',{name:'Arc range',exact:true}),r=(await slider.boundingBox())!;await page.mouse.move(r.x+r.width*.3,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width*.9,r.y+r.height/2,{steps:8});expect(await data(page)).toEqual(before);await page.mouse.up();expect(await history(page)).toBe(n+1);expect((await data(page)).joins[0].radius).toBeGreaterThan(.3);
 await slider.press('Meta+z');expect(await data(page)).toEqual(before);await slider.press('Meta+Shift+z');expect((await data(page)).joins[0].radius).toBeGreaterThan(.3);
 // Directly selecting the derived arc exposes its joint controls, not a new Curve asset.
 await drawingTool(page,'direct');
 await click(page,.8,-.7);await hit(page,'drawing-arc-hit');await expect(page.getByTestId('drawing-arc-controls')).toBeVisible();expect((await data(page)).curves).toHaveLength(2);
 const path=await page.getByTestId('drawing-ink').getAttribute('d'),b=(await data(page)).curves.find((c:any)=>c.id==='b').handles;
 await page.locator('[data-testid=drawing-handle][data-id=a][data-end="1"]').click();await field(page,'Node Y','0.15');expect(await page.getByTestId('drawing-ink').getAttribute('d')).not.toBe(path);expect((await data(page)).curves.find((c:any)=>c.id==='b').handles).toEqual(b);
 await saveReload(page);expect(errors).toEqual([]);
});

test('mirror axis numeric and drag, live source preview, cancel, target, undo and saved axis',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);await page.getByTestId('drawing-tool-mirror').click();await expect(page.getByTestId('drawing-mirror-axis')).toHaveCount(1);await field(page,'Mirror axis X','0.1');await hit(page,'drawing-hit','a');
 await expect(page.getByTestId('drawing-mirror-preview')).toHaveCount(1);const old=await data(page),preview=await page.getByTestId('drawing-mirror-preview').getAttribute('d'),h=await history(page),a=await coord(page,.1,-.7),b=await coord(page,.35,-.7);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});expect(await data(page)).toEqual(old);expect(await page.getByTestId('drawing-mirror-preview').getAttribute('d')).not.toBe(preview);await page.mouse.up();expect((await data(page)).mirrorAxisX).toBeCloseTo(.35,4);expect(await history(page)).toBe(h+1);await expect(page.getByTestId('drawing-mirror-preview')).toHaveCount(1);
 const source=await data(page);await hit(page,'drawing-hit','b');let d=await data(page);const ac=d.curves.find((c:any)=>c.id==='a'),bc=d.curves.find((c:any)=>c.id==='b');expect(ac).toEqual(source.curves.find((c:any)=>c.id==='a'));expect(bc.handles[0][0]).toBeCloseTo(.7-ac.handles[0][0],4);expect(d.joins).toHaveLength(0);await expect(page.getByTestId('drawing-mirror-guide')).toHaveCount(1);await expect(page.getByTestId('drawing-mirror-preview')).toHaveCount(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(source);
 await page.getByTestId('drawing-tool-mirror').click();const current=await coord(page,.35,-.7),to=await coord(page,.6,-.7),n=await history(page);await page.mouse.move(current.x,current.y);await page.mouse.down();await page.mouse.move(to.x,to.y);await page.keyboard.press('Escape');await page.mouse.up();expect(await data(page)).toEqual(source);expect(await history(page)).toBe(n);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-mirror-guide')).toHaveCount(0);await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-mirror-guide')).toBeVisible();
 await saveReload(page);await page.getByTestId('drawing-tool-mirror').click();await page.getByTestId('language-toggle').click();await expect(page.getByRole('navigation',{name:'当前工具选项'}).getByRole('spinbutton',{name:'镜像轴 X',exact:true})).toHaveValue('0.35');await page.screenshot({path:'artifacts/drawing-arc/mirror-axis-zh.png'});expect(errors).toEqual([]);
});

test('ARC clamps visibly, converts to existing join types, and reports degeneracy',async({page})=>{
 await seed(page,true);await page.locator('[data-testid=drawing-curve-row][data-id=a] .drawing-object-name').click();await field(page,'Influence radius px','500');await expect(page.getByTestId('drawing-arc-status')).toContainText('Range reduced');
 await page.getByTestId('drawing-node').last().click();await page.getByRole('button',{name:'Change to smooth',exact:true}).click();expect((await data(page)).joins[0].mode).toBe('SMOOTH');await expect(page.getByTestId('drawing-arc-controls')).toHaveCount(0);
 await page.getByRole('button',{name:'Change to cusp',exact:true}).click();expect((await data(page)).joins[0].mode).toBe('CUSP');await page.getByRole('button',{name:'Change to arc',exact:true}).click();expect((await data(page)).joins[0].mode).toBe('ARC');
 await page.getByRole('button',{name:'Position only',exact:true}).last().click();expect((await data(page)).joins).toHaveLength(0);expect((await data(page)).nodes).toHaveLength(3);
 await seed(page,true);await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),s=(window as any).__editorPerfStore.getState();let d=s.project.drawing;const b=d.curves.find((c:any)=>c.id==='b');d=c.moveNode(d,b.nodes[1],[-1,0]);d=c.moveHandle(d,{curveId:'b',end:0},[-1/3,0]);d=c.moveHandle(d,{curveId:'b',end:1},[-2/3,0]);s.setDrawing(d);});await page.locator('[data-testid=drawing-curve-row][data-id=a] .drawing-object-name').click();await expect(page.getByTestId('drawing-arc-status')).toContainText('coincide');await expect(page.getByTestId('drawing-ink')).toHaveCount(1);
});

test('Chinese ARC controls and clean rounded preview',async({page})=>{
 await seed(page,true);await page.locator('[data-testid=drawing-curve-row][data-id=a] .drawing-object-name').click();await field(page,'Influence radius px','90');await page.getByTestId('language-toggle').click();await expect(page.getByRole('slider',{name:'圆弧范围',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/drawing-arc/arc-controls-zh.png'});await page.getByRole('button',{name:'隐藏编辑辅助',exact:true}).click();await expect(page.getByTestId('drawing-arc-guide')).toHaveCount(0);await page.screenshot({path:'artifacts/drawing-arc/arc-preview-zh.png'});
});
