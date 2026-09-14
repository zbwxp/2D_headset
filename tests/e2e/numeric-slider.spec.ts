import{test,expect}from'@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/tests/fixtures/numeric-slider.html');});
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
 await page.goto('/');await page.clock.install();const s=page.getByRole('slider',{name:'Smooth Strength',exact:true});await s.fill('42.35');await s.blur();
 const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('contour.landmarks.v039')!));
 expect((await state()).surfaceSmooth.strength).toBe(.4235);await expect(page.locator('.point-footer')).toContainText('撤销 1 / 100');
 await s.focus();await page.keyboard.down('ArrowRight');await page.clock.runFor(1400);await page.keyboard.up('ArrowRight');const changed=(await state()).surfaceSmooth.strength;
 expect(changed).toBeGreaterThan(.4235);await expect(page.locator('.point-footer')).toContainText('撤销 2 / 100');
 await page.getByRole('slider',{name:'2D Patch 不透明度',exact:true}).fill('42.35');await expect(page.locator('.point-footer')).toContainText('撤销 2 / 100');
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await state()).surfaceSmooth.strength).toBe(.4235);expect((await state()).patchDisplay.opacity2d).toBe(.4235);
 await page.getByRole('button',{name:'重做',exact:true}).click();expect((await state()).surfaceSmooth.strength).toBe(changed);
});
test('explicit step changes keyboard increment only, fine and pointer remain unsnapped',async({page})=>{
 const s=page.getByRole('slider',{name:'Stepped',exact:true});await s.press('ArrowRight');await expect(s).toHaveValue('0.7');await s.press('Alt+ArrowRight');await expect(s).toHaveValue('0.84');
 const r=(await s.boundingBox())!;await page.mouse.click(r.x+r.width*.333,r.y+r.height/2);expect(+(await s.inputValue())).toBeCloseTo(33.3,1);
});
