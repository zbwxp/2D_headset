import {test,expect} from '@playwright/test';

for(const room of ['assembly','drawing'] as const)test(`${room} reference X/Y numbers and sliders preview immediately and commit one undo`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('button',{name:'菜单 · 文件与工作区',exact:true}).hover();
 if(room==='assembly'||!await page.getByTestId('drawing-canvas').count())await page.getByTestId(`${room}-room-toggle`).click();
 await page.getByTestId(room==='assembly'?'assembly-3d':'drawing-canvas').hover();await expect(page.locator('.app-menu-bar')).toHaveAttribute('data-open','false');
 if(room==='assembly'){await page.getByTestId('assembly-import').click();await page.getByRole('button',{name:'载入副本',exact:true}).click();}
 const prefix=room==='assembly'?'assembly-drawing':'drawing';
 await page.locator(`.${prefix}-reference-panel .drawing-disclosure-toggle`).click();
 await page.locator(`.${prefix}-reference-row>button`).first().click();
 const canvas=page.getByTestId(`${prefix}-canvas`),reference=page.getByTestId(`${prefix}-reference`);
 const doc=()=>page.evaluate(room=>{const p=(window as any).__editorPerfStore.getState().project;return room==='assembly'?p.assembly.drawing:p.drawing;},room);
 if((await doc()).reference.locked)await page.getByRole('button',{name:'锁定参考图',exact:true}).click();
 const initial=await doc(),before=await reference.getAttribute('transform');
 const input=page.getByRole('spinbutton',{name:'参考图 X',exact:true}),target=initial.reference.offset[0]+.25;
 await input.fill(String(target));
 await expect(reference).not.toHaveAttribute('transform',before!);expect((await doc()).reference.offset).toEqual(initial.reference.offset);
 await expect(input).toBeFocused();await input.press('Escape');await expect(reference).toHaveAttribute('transform',before!);
 await input.fill(String(target));await input.press('Enter');expect((await doc()).reference.offset[0]).toBe(target);
 await canvas.focus();await page.keyboard.press('Control+z');expect((await doc()).reference.offset).toEqual(initial.reference.offset);
 await page.keyboard.press('Control+Shift+z');expect((await doc()).reference.offset[0]).toBe(target);
 const beforeDrag=await doc(),transform=await reference.getAttribute('transform');
 const slider=page.getByRole('slider',{name:'参考图 Y',exact:true});await slider.scrollIntoViewIfNeeded();const box=(await slider.boundingBox())!;
 const x=box.x+box.width*(beforeDrag.reference.offset[1]+10)/20,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+box.width*.03,y,{steps:5});
 await expect(reference).not.toHaveAttribute('transform',transform!);expect((await doc()).reference.offset).toEqual(beforeDrag.reference.offset);
 await page.mouse.up();const final=await doc();expect(final.reference.offset[1]).not.toBe(beforeDrag.reference.offset[1]);expect(final.curves).toEqual(initial.curves);expect(final.nodes).toEqual(initial.nodes);
 await canvas.focus();await page.keyboard.press('Control+z');expect((await doc()).reference.offset).toEqual(beforeDrag.reference.offset);
 await page.locator('.reference-position-controls').screenshot({path:`artifacts/assembly/reference-position-${room}.png`});
 await page.getByRole('button',{name:'锁定参考图',exact:true}).click();await expect(input).toBeDisabled();await expect(slider).toBeDisabled();
 expect(errors).toEqual([]);
});
