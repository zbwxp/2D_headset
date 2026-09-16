import {selectSidebar,openPatch} from '../helpers/sidebar';
import{test,expect}from'@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/tests/fixtures/numeric-slider.html');});
test('zero detent accepts fine departure and snaps inward with stable pointer capture',async({page})=>{
 const s=page.getByRole('slider',{name:'Angle',exact:true});
 await s.press('Alt+ArrowRight');await expect(s).toHaveValue('0.18');
 await s.press('Alt+ArrowLeft');await expect(s).toHaveValue('0');
 await s.fill('10');await s.press('ArrowLeft');await expect(s).toHaveValue('9.1');
 const r=(await s.boundingBox())!,y=r.y+r.height/2;
 await page.mouse.move(r.x+r.width*.53,y);await page.mouse.down();
 await page.mouse.move(r.x+r.width*.505,y);await expect(s).toHaveValue('0');
 await page.mouse.move(r.x+r.width*.504,y);await expect(s).toHaveValue('0');
 await page.mouse.move(r.x+r.width*.48,y);expect(+(await s.inputValue())).toBeLessThan(-3.6);
 await page.mouse.up();
});
test('fine taps, modifiers, normalized ranges, Home/End and float values',async({page})=>{
 const s=page.getByRole('slider',{name:'Test',exact:true});
 await s.press('ArrowRight');await expect(s).toHaveValue('50.25');
 await s.press('Alt+ArrowRight');await expect(s).toHaveValue('50.3');
 await s.press('Shift+ArrowRight');await expect(s).toHaveValue('51.55');
 await s.press('Alt+Shift+ArrowRight');await expect.poll(async()=>+(await s.inputValue())).toBeCloseTo(51.6,10);
 await page.getByRole('slider',{name:'Angle',exact:true}).press('ArrowRight');await expect(page.getByRole('slider',{name:'Angle',exact:true})).toHaveValue('0.9');
 await s.press('Home');await expect(s).toHaveValue('0');await s.press('ArrowLeft');await expect(page.getByTestId('counts')).toHaveText('5,5');
 await s.press('End');await expect(s).toHaveValue('100');await s.press('ArrowRight');await expect(page.getByTestId('counts')).toHaveText('6,6');
});
test('hold accelerates independently of OS repeat; release resets speed and groups session',async({page})=>{
 await page.clock.install();const s=page.getByRole('slider',{name:'Test',exact:true});await s.focus();await page.keyboard.down('ArrowRight');
 await expect(s).toHaveValue('50.25');await page.clock.runFor(280);await expect(s).toHaveValue('50.25');
 await page.clock.runFor(500);const early=+(await s.inputValue());await page.clock.runFor(500);const later=+(await s.inputValue());
 expect(later-early).toBeGreaterThan(early-50.25);
 await page.keyboard.up('ArrowRight');await expect(page.getByTestId('counts')).toHaveText('1,1');const stopped=+(await s.inputValue());
 await page.clock.runFor(1000);expect(+(await s.inputValue())).toBe(stopped);
 await s.press('ArrowRight');expect(+(await s.inputValue())-stopped).toBeCloseTo(.25,10);await expect(page.getByTestId('counts')).toHaveText('2,2');
});
test('pointer mapping, capture outside track, resize and CSS zoom',async({page})=>{
 const s=page.getByRole('slider',{name:'Test',exact:true});
 for(const zoom of [1,1.5]){await page.evaluate(z=>{document.body.style.zoom=String(z);},zoom);await page.setViewportSize({width:zoom===1?1000:1400,height:900});
 const r=(await s.boundingBox())!;await page.mouse.move(r.x+r.width*.2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width*.7,r.y+r.height/2,{steps:5});await page.mouse.up();expect(+(await s.inputValue())).toBeCloseTo(70,0);
 }
 await expect(page.getByTestId('counts')).toHaveText('2,2');
 const r=(await s.boundingBox())!;await page.mouse.move(r.x+r.width*.5,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width+100,r.y-30);await page.mouse.up();await expect(s).toHaveValue('100');await expect(page.getByTestId('counts')).toHaveText('3,3');
 await page.locator('.numeric-slider-value').first().click();await expect(s).toBeFocused();
});
test('blur, visibility, disabled, unmount and pointer cancellation close sessions',async({page})=>{
 await page.clock.install();const s=page.getByRole('slider',{name:'Test',exact:true});
 for(const action of ['blur','visibility','disabled','unmount','cancel']){
 await page.getByRole('button',{name:'Reset',exact:true}).click();await s.focus();await page.keyboard.down('ArrowRight');
 if(action==='blur')await page.getByRole('textbox',{name:'Text',exact:true}).focus();
 if(action==='visibility')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 if(action==='disabled')await page.getByRole('button',{name:'Disable',exact:true}).dispatchEvent('click');
 if(action==='unmount')await page.getByRole('button',{name:'Unmount',exact:true}).dispatchEvent('click');
 if(action==='cancel')await s.dispatchEvent('pointercancel');
 await expect(page.getByTestId('counts')).toHaveText('1,1');await page.clock.runFor(600);await expect(page.getByTestId('value')).toHaveText('50.25');await page.keyboard.up('ArrowRight');
 if(action==='disabled')await page.getByRole('button',{name:'Disable',exact:true}).click();if(action==='unmount')await page.getByRole('button',{name:'Unmount',exact:true}).click();
 }
 await page.getByRole('textbox',{name:'Text',exact:true}).press('ArrowLeft');await expect(page.getByTestId('counts')).toHaveText('1,1');
});
test('geometry keyboard hold is one Undo; float settings persist and display sliders do not add history',async({page})=>{
 await page.goto('/');
 const patchId=await page.evaluate(async()=>{const {parseLandmarks}=await import('/src/domain/landmarks/persistence' as string),{addPatch}=await import('/src/domain/patches/model' as string),store=(window as any).__editorPerfStore;let p=parseLandmarks(await(await fetch('/artifacts/basic-patch/adjusted-source.json')).text());p=addPatch(p,['左面壳前边界·颧颊至下颊','左颊部体积线·颧颊至颊峰','左颊部体积线·颊峰至下颊'].map(n=>p.curves.find((c:any)=>c.name===n).id));store.getState().load(p);store.setState({past:[]});return p.patches[0].id;});
 await selectSidebar(page,'patch',patchId);await page.clock.install();const s=page.getByRole('slider',{name:'面凸度 Fullness',exact:true});await s.fill('42.35');await s.blur();
 const state=async()=>{await page.clock.runFor(550);return page.evaluate(()=>JSON.parse(localStorage.getItem('contour.landmarks.v039')!));};
 expect((await state()).patches.find((x:any)=>x.id===patchId).fullness).toBe(.4235);await expect(page.locator('.point-footer')).toContainText('撤销 1 / 100');
 await s.focus();await page.keyboard.down('ArrowRight');await page.clock.runFor(1400);await page.keyboard.up('ArrowRight');const changed=(await state()).patches.find((x:any)=>x.id===patchId).fullness;
 expect(changed).toBeGreaterThan(.4235);await expect(page.locator('.point-footer')).toContainText('撤销 2 / 100');
 await openPatch(page);await page.getByRole('slider',{name:'3D Patch 不透明度',exact:true}).fill('42.35');await expect(page.locator('.point-footer')).toContainText('撤销 2 / 100');
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await state()).patches.find((x:any)=>x.id===patchId).fullness).toBe(.4235);expect((await state()).patchDisplay.opacity3d).toBe(.4235);
 await page.getByRole('button',{name:'重做',exact:true}).click();expect((await state()).patches.find((x:any)=>x.id===patchId).fullness).toBe(changed);
});
test('explicit step changes keyboard increment only, fine and pointer remain unsnapped',async({page})=>{
 const s=page.getByRole('slider',{name:'Stepped',exact:true});await s.press('ArrowRight');await expect(s).toHaveValue('0.7');await s.press('Alt+ArrowRight');await expect(s).toHaveValue('0.84');
 const r=(await s.boundingBox())!;await page.mouse.click(r.x+r.width*.333,r.y+r.height/2);expect(+(await s.inputValue())).toBeCloseTo(33.3,1);
});
test('double-click numeric entry confirms one session, cancels, validates and clamps',async({page})=>{
 const value=page.locator('.numeric-slider-value').first(),entry=page.getByRole('textbox',{name:'Test 数值',exact:true}),slider=page.getByRole('slider',{name:'Test',exact:true});
 await value.dblclick();await expect(entry).toBeFocused();await entry.fill('42.357');await expect(slider).toHaveValue('50');await entry.press('Enter');await expect(slider).toHaveValue('42.357');await expect(page.getByTestId('counts')).toHaveText('1,1');
 await value.dblclick();await entry.fill('70');await entry.press('Escape');await expect(slider).toHaveValue('42.357');await expect(page.getByTestId('counts')).toHaveText('1,1');
 await value.dblclick();await entry.fill('oops');await entry.press('Enter');await expect(entry).toHaveAttribute('aria-invalid','true');await expect(slider).toHaveValue('42.357');await entry.fill('125');await page.getByRole('textbox',{name:'Text',exact:true}).click();await expect(slider).toHaveValue('100');await expect(page.getByTestId('counts')).toHaveText('2,2');
});
test('direct entry supports precise angles without detent and normalized percentage units',async({page})=>{
 await page.locator('.numeric-slider-value').nth(1).dblclick();await page.getByRole('textbox',{name:'Angle 数值',exact:true}).fill('89.99');await page.getByRole('textbox',{name:'Angle 数值',exact:true}).press('Enter');await expect(page.getByRole('slider',{name:'Angle',exact:true})).toHaveValue('89.99');
 await page.locator('.numeric-slider-value').nth(1).dblclick();await page.getByRole('textbox',{name:'Angle 数值',exact:true}).fill('0.1234');await page.getByRole('textbox',{name:'Angle 数值',exact:true}).press('Enter');await expect(page.getByRole('slider',{name:'Angle',exact:true})).toHaveValue('0.1234');
 await page.locator('.numeric-slider-value').nth(3).dblclick();const entry=page.getByRole('textbox',{name:'Percent 数值',exact:true});await entry.fill('42.35%');await entry.press('Enter');await expect(page.getByRole('slider',{name:'Percent',exact:true})).toHaveValue('0.4235');
});
