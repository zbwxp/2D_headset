import {test,expect,type Page} from '@playwright/test';
const reference=(page:Page)=>page.evaluate(()=>(window as any).__editorPerfStore.getState().project.recording?.reference);
const history=(page:Page)=>page.evaluate(()=>(window as any).__editorPerfStore.getState().past.length);
const curves=(page:Page)=>page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project.recording?.curves));
async function number(page:Page,label:string,value:number){const slider=page.getByRole('slider',{name:label,exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();const entry=slider.locator('..').locator('.numeric-slider-entry');await entry.fill(String(value));await entry.press('Enter');}
async function upload(page:Page){
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=3000;const g=c.getContext('2d')!;
  g.fillStyle='#fff';g.fillRect(0,0,3000,3000);g.font='200px sans-serif';g.textAlign='center';
  for(let y=0;y<3;y++)for(let x=0;x<3;x++){g.fillStyle=['#d5e2eb','#cbe0d3','#ece0ca'][(x+y)%3];g.fillRect(x*1000+8,y*1000+8,984,984);g.fillStyle='#30454b';g.fillText(String(y*3+x+1),x*1000+500,y*1000+550);g.beginPath();g.ellipse(x*1000+500,y*1000+520,290,360,0,0,Math.PI*2);g.stroke();}return c.toDataURL('image/png').split(',')[1];});
 await page.getByTestId('recording-background-input').setInputFiles({name:'nine-view-sheet.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
 await expect(page.getByRole('region',{name:'Recording Background Settings',exact:true})).toBeVisible();
}
test('nine-cell import, extended transforms, pan undo, lock, persistence and separation from keys',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 const source=await page.evaluate(()=>{const p=(window as any).__editorPerfStore.getState().project;return JSON.stringify([p.landmarks,p.curves,p.patches,p.views]);});
 await page.getByTestId('room-toggle').click();await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();const before=await curves(page),n=await history(page);await upload(page);
 expect(await history(page)).toBe(n+1);expect((await reference(page)).width).toBe(3000);expect((await reference(page)).height).toBe(3000);
 const panel=page.getByRole('region',{name:'Recording Background Settings',exact:true}),photo=page.getByTestId('recording-background-image');
 await expect(panel.getByRole('slider',{name:'Horizontal position',exact:true})).toHaveAttribute('min','-10');await expect(panel.getByRole('slider',{name:'Vertical position',exact:true})).toHaveAttribute('max','10');
 await number(page,'Image scale',300);await number(page,'Horizontal position',6);await number(page,'Vertical position',-7);expect((await reference(page)).offset).toEqual([6,-7]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await reference(page)).offset).toEqual([6,0]);await page.getByRole('button',{name:'Redo',exact:true}).click();
 await panel.getByRole('button',{name:'Reset reference image position',exact:true}).click();await number(page,'Image scale',300);await number(page,'Rotation',15);expect((await reference(page)).rotation).toBe(15);
 await page.screenshot({path:'artifacts/recording/background-controls.png'});
 // Entering pan from navigation must immediately work on the first click.
 await page.getByRole('button',{name:'View Navigation',exact:true}).click();await panel.getByRole('button',{name:'Pan image',exact:true}).click();await page.getByRole('button',{name:'Close Recording Background Settings',exact:true}).click();
 const layer=page.getByTestId('recording-background-drag');await expect(layer).toBeVisible();const box=(await layer.boundingBox())!,ref=await reference(page),unit=Number(await photo.getAttribute('width'))/(2.6*ref.scale),h=await history(page);
 await page.mouse.move(box.x+100,box.y+box.height*.6);await page.mouse.down();await page.mouse.move(box.x+180,box.y+box.height*.6+40,{steps:5});await page.mouse.up();
 expect((await reference(page)).offset[0]).toBeCloseTo(80/unit);expect((await reference(page)).offset[1]).toBeCloseTo(-40/unit);expect(await history(page)).toBe(h+1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await reference(page)).offset).toEqual([0,0]);await page.getByRole('button',{name:'Redo',exact:true}).click();const saved=await reference(page);
 await page.mouse.move(box.x+90,box.y+box.height*.7);await page.mouse.down();await page.mouse.move(box.x+140,box.y+box.height*.7+30);await page.keyboard.press('Escape');await page.mouse.up();expect(await reference(page)).toEqual(saved);expect(await history(page)).toBe(h+1);
 await page.getByRole('button',{name:'Recording Background Settings',exact:true}).click();await panel.getByRole('button',{name:'Lock reference image',exact:true}).click();await expect(panel.getByRole('button',{name:'Pan image',exact:true})).toBeDisabled();await expect(panel.getByRole('slider',{name:'Image scale',exact:true})).toBeDisabled();
 await panel.getByRole('checkbox',{name:'Show reference image',exact:true}).uncheck();await expect(photo).toHaveCount(0);await panel.getByRole('checkbox',{name:'Show reference image',exact:true}).check();await expect(photo).toBeVisible();
 expect(await curves(page)).toBe(before);await expect(page.getByTestId('recording-final').locator('image')).toHaveCount(0);
 expect(await page.evaluate(()=>{const p=(window as any).__editorPerfStore.getState().project;return JSON.stringify([p.landmarks,p.curves,p.patches,p.views]);})).toBe(source);
 const persisted=await reference(page);await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});expect(await reference(page)).toEqual(persisted);
 await page.waitForTimeout(800);await page.reload();await page.getByTestId('room-toggle').click();await expect(photo).toBeVisible();expect(await reference(page)).toEqual(persisted);
 await page.getByTestId('language-toggle').click();await expect(page.getByRole('button',{name:'录制背景设置',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

test('nine named background states switch, overwrite, extend, undo and persist without duplicating the image',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('room-toggle').click();
 await page.getByRole('button',{name:'New Recorded Curve',exact:true}).click();const recorded=await curves(page);await upload(page);
 const panel=page.getByRole('region',{name:'Recording Background Settings',exact:true});
 await expect(page.getByTestId('recording-background-state-empty')).toHaveCount(9);
 await number(page,'Image scale',300);
 for(let i=0;i<9;i++){
  await number(page,'Horizontal position',((i%3)-1)*2.6);await number(page,'Vertical position',(Math.floor(i/3)-1)*2.6);
  await panel.getByRole('button',{name:'Save Background State '+(i+1),exact:true}).click();
  const input=panel.getByRole('textbox',{name:'Background state name',exact:true});await input.fill('Cell '+(i+1));await input.press('Enter');
 }
 await expect(page.getByTestId('recording-background-state')).toHaveCount(9);await expect(page.getByTestId('recording-background-state-empty')).toHaveCount(0);
 const nine=await reference(page);expect(nine.states.map((s:any)=>s.name)).toEqual(Array.from({length:9},(_,i)=>'Cell '+(i+1)));
 expect(JSON.stringify(nine).match(/data:image/g)).toHaveLength(1);
 const count=await history(page);await page.getByTestId('recording-background-state').first().click();
 expect((await reference(page)).offset).toEqual([-2.6,-2.6]);expect((await reference(page)).scale).toBe(3);expect(await history(page)).toBe(count+1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await reference(page)).toEqual(nine);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await number(page,'Horizontal position',-3.1);await number(page,'Rotation',12);await number(page,'Opacity',75);
 const adjusted=await reference(page);expect(adjusted.states).toEqual(nine.states);
 await expect(page.getByTestId('recording-background-state-status')).toHaveText('Background adjusted; state has not been updated');
 await panel.getByRole('button',{name:'Update Current Background State',exact:true}).click();
 const overwritten=await reference(page);expect(overwritten.states[0].offset).toEqual([-3.1,-2.6]);expect(overwritten.states[0].rotation).toBe(12);expect(overwritten.states[0].opacity).toBe(.75);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await reference(page)).states).toEqual(nine.states);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await panel.getByRole('button',{name:'Lock reference image',exact:true}).click();
 await page.getByTestId('recording-background-state').nth(4).click();expect((await reference(page)).offset).toEqual([0,0]);expect((await reference(page)).locked).toBe(true);
 await page.getByTestId('recording-background-state').first().click();expect((await reference(page)).offset).toEqual([-3.1,-2.6]);expect((await reference(page)).rotation).toBe(12);
 await panel.getByRole('button',{name:'Save as New Background State',exact:true}).click();await expect(page.getByTestId('recording-background-state')).toHaveCount(10);
 await panel.getByRole('button',{name:'Delete Background State',exact:true}).click();await expect(page.getByTestId('recording-background-state')).toHaveCount(9);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByTestId('recording-background-state')).toHaveCount(10);
 const saved=await reference(page);expect(await curves(page)).toBe(recorded);
 await expect(page.getByTestId('recording-final').locator('image')).toHaveCount(0);
 await page.evaluate(async()=>{const e=(window as any).__editorPerfStore.getState(),url='/src/domain/landmarks/persistence.ts';e.load((await import(url)).parseLandmarks(JSON.stringify(e.project)));});
 expect(await reference(page)).toEqual(saved);
 await page.waitForTimeout(750);await page.reload();await page.getByTestId('room-toggle').click();expect(await reference(page)).toEqual(saved);
 await page.getByRole('button',{name:'Recording Background Settings',exact:true}).click();await expect(page.getByTestId('recording-background-state')).toHaveCount(10);
 await page.screenshot({path:'artifacts/recording/background-states.png'});
});
