import {test,expect,type Page} from '@playwright/test';
const data=(p:Page)=>p.evaluate(()=>(window as any).__editorPerfStore.getState().project.drawing);
async function seed(page:Page,kind:'open'|'closed'='open'){
 return page.evaluate(async kind=>{const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string),p=await import('/src/domain/drawing/paintCommands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Intervals');let ids:string[];
 if(kind==='open'){d=c.createCurve(d,d.layers[0].id,[[-.9,0],[-.6,.3],[-.3,.3],[0,0]],.025,'A','a');d=c.createCurve(d,d.layers[0].id,[[0,0],[.3,-.3],[.6,-.3],[.9,0]],.025,'B','b');d=c.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'SMOOTH');ids=['a','b'];}
 else{const e=c.ellipse(d,d.layers[0].id,[-.8,-.6],[.8,.6],.025);d=p.createFill(e.document,e.ids,'black');ids=e.ids;}
 (window as any).__editorPerfStore.getState().setDrawing(d);return ids;
 },kind);
}
async function select(page:Page,id:string){await page.locator(`[data-testid=drawing-curve-row][data-id="${id}"] .drawing-object-name`).click();}
async function setField(page:Page,label:string,value:number,index=0){const f=page.getByRole('spinbutton',{name:label,exact:true}).nth(index);await f.fill(String(value));await f.press('Enter');}
async function point(page:Page,s:number){return page.evaluate(async s=>{const m=await import('/src/domain/drawing/displayIntervals.ts' as string),d=(window as any).__editorPerfStore.getState().project.drawing,t=d.displayIntervals[0],f=m.displayField(d,m.displayPath(d,t.anchor.id));return f.at(f.native(t,s)).p;},s);}
async function screen(page:Page,p:number[]){const r=(await page.getByTestId('drawing-canvas').boundingBox())!,u=Math.min(r.width,r.height)/2.8;return [r.x+r.width/2+p[0]*u,r.y+r.height/2-p[1]*u];}
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();});

test('continuous path interval grips slide across a join without editing geometry; one Undo, Redo, Save/Load',async({page})=>{
 await seed(page);await select(page,'a');const before=await data(page);await page.getByRole('button',{name:'Add display interval',exact:true}).click();await expect(page.getByTestId('drawing-display-grip')).toHaveCount(2);
 const initial=await data(page),t=initial.displayIntervals[0];expect(t.ranges[0].start).toBeCloseTo(1/3);expect(t.ranges[0].end).toBeCloseTo(2/3);
 const grip=page.locator('[data-testid=drawing-display-grip][data-end="0"]'),r=(await grip.boundingBox())!,target=await screen(page,await point(page,.57));const past=await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(target[0],target[1],{steps:8});expect(await data(page)).toEqual(initial);await page.mouse.up();const moved=await data(page);expect(moved.displayIntervals[0].ranges[0].start).toBeCloseTo(.57,3);expect(moved.curves).toEqual(before.curves);expect(moved.nodes).toEqual(before.nodes);expect(moved.joins).toEqual(before.joins);expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length)).toBe(past+1);
 const actual=await grip.boundingBox();expect(actual!.x+actual!.width/2).toBeCloseTo(target[0],0);expect(actual!.y+actual!.height/2).toBeCloseTo(target[1],0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await data(page)).toEqual(initial);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await data(page)).toEqual(moved);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Save JSON',exact:true}).click();await page.locator('header input[type=file]').setInputFiles((await (await dl).path())!);await expect.poll(()=>data(page)).toEqual(moved);
});

test('multiple intervals crop preview, overlap merges, deleting last restores entire stroke',async({page})=>{
 await seed(page);await select(page,'a');await page.getByRole('button',{name:'Add display interval',exact:true}).click();await setField(page,'Interval start %',10);await setField(page,'Interval end %',30);await page.getByRole('button',{name:'Add display interval',exact:true}).click();await setField(page,'Interval start %',65,1);await setField(page,'Interval end %',90,1);await expect(page.getByTestId('drawing-ink')).toHaveCount(2);await expect(page.getByTestId('drawing-display-grip')).toHaveCount(4);
 await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();await expect(page.getByTestId('drawing-display-grip')).toHaveCount(0);await expect(page.getByTestId('drawing-ink')).toHaveCount(2);await page.screenshot({path:'artifacts/drawing-intervals/preview.png'});await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();
 await setField(page,'Interval start %',20,1);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);await page.getByRole('button',{name:'Delete display interval',exact:true}).last().click();await page.getByRole('button',{name:'Delete display interval',exact:true}).click();await expect(page.getByTestId('drawing-display-grip')).toHaveCount(0);expect((await data(page)).displayIntervals).toEqual([]);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);
});

test('closed interval wraps across origin while black fill is unchanged, deleting selected marker only removes interval',async({page})=>{
 const ids=await seed(page,'closed');await select(page,ids[0]);const path=await page.getByTestId('drawing-fill').getAttribute('d'),before=await data(page);await page.getByRole('button',{name:'Add display interval',exact:true}).click();await setField(page,'Interval start %',85);await setField(page,'Interval end %',15);await expect(page.getByTestId('drawing-ink')).toHaveCount(1);expect(await page.getByTestId('drawing-fill').getAttribute('d')).toBe(path);expect((await data(page)).fills).toEqual(before.fills);
 await page.getByRole('button',{name:'Interval start',exact:true}).click();await page.getByTestId('drawing-canvas').focus();await page.keyboard.press('Delete');expect((await data(page)).curves).toEqual(before.curves);expect((await data(page)).displayIntervals).toEqual([]);await page.getByRole('button',{name:'Undo',exact:true}).click();await select(page,ids[0]);await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'添加显示区间',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/drawing-intervals/closed.png'});
});

test('an individual curve is supported; cancel drag leaves data untouched and locks prevent edits',async({page})=>{
 await page.evaluate(async()=>{const m=await import('/src/domain/drawing/model.ts' as string),c=await import('/src/domain/drawing/commands.ts' as string);let d=c.addLayer(m.emptyDrawing(),'Single');d=c.createCurve(d,d.layers[0].id,[[-.9,0],[-.3,.3],[.3,.3],[.9,0]],.02,'A','a');(window as any).__editorPerfStore.getState().setDrawing(d);});await select(page,'a');await page.getByRole('button',{name:'Add display interval',exact:true}).click();const before=await data(page),grip=page.locator('[data-testid=drawing-display-grip][data-end="1"]'),r=(await grip.boundingBox())!;
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+50,r.y+r.height/2+60,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();expect(await data(page)).toEqual(before);
 await page.evaluate(async()=>{const c=await import('/src/domain/drawing/commands.ts' as string),s=(window as any).__editorPerfStore.getState();s.setDrawing(c.curveChange(s.project.drawing,'a',{locked:true}));});await expect(page.getByRole('button',{name:'Add display interval',exact:true})).toBeDisabled();
});

test('overlapping default markers stay selectable independently; dragging off the line is constrained',async({page})=>{
 await seed(page);await select(page,'a');await page.getByRole('button',{name:'Add display interval',exact:true}).click();await page.getByRole('button',{name:'Add display interval',exact:true}).click();await page.getByRole('button',{name:'Interval start',exact:true}).first().click();const before=await data(page),track=before.displayIntervals[0],first=track.ranges[0],second=track.ranges[1];
 const grip=page.locator(`[data-testid=drawing-display-grip][data-range="${first.id}"][data-end="0"]`),r=(await grip.boundingBox())!;expect(await grip.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.getAttribute('data-range');})).toBe(first.id);
 const target=await screen(page,await point(page,.2));await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(target[0],target[1]-35,{steps:6});await page.mouse.up();const after=await data(page);expect(after.displayIntervals[0].ranges[1]).toEqual(second);expect(after.nodes).toEqual(before.nodes);expect(after.curves).toEqual(before.curves);
 const actual=await grip.boundingBox(),p=await screen(page,await point(page,after.displayIntervals[0].ranges[0].start));expect(actual!.x+actual!.width/2).toBeCloseTo(p[0],3);expect(actual!.y+actual!.height/2).toBeCloseTo(p[1],3);expect(Math.abs(p[1]-(target[1]-35))).toBeGreaterThan(15);
 await page.getByTestId('drawing-canvas').focus();await page.keyboard.press('ArrowRight');const nudged=await data(page);expect(nudged.curves).toEqual(before.curves);expect(nudged.displayIntervals[0].ranges[0].start).toBeCloseTo(after.displayIntervals[0].ranges[0].start+.004,8);
 await page.screenshot({path:'artifacts/drawing-intervals/editing.png'});
});
