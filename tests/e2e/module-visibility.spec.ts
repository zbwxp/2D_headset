import {test,expect} from '@playwright/test';
test('set visibility is independent, persistent and leaves geometry untouched',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.evaluate(async()=>{const preset='/src/domain/landmarks/presets.ts',frame='/src/domain/head/frame.ts',scaffold='/src/domain/head/scaffold.ts';const s=(window as any).__editorPerfStore.getState();s.load((await import(scaffold)).ensureScaffold((await import(frame)).migrateHeadFrame((await import(preset)).createLandmarkProject())));s.setActiveModule('EYES');s.createEyes();s.createGaze();});
 const before=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project));
 const head=page.getByTestId('module-visibility-HEADSET'),eyes=page.getByTestId('module-visibility-EYES');
 await expect(head).toHaveAttribute('aria-pressed','true');await expect(eyes).toHaveAttribute('aria-pressed','true');
 await head.click();await expect(head).toHaveAttribute('aria-pressed','false');await expect(eyes).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('canvas[data-visible-surfaces]')).toHaveAttribute('data-visible-surfaces','0');
 await expect(page.locator('[data-gaze-rim]')).toHaveCount(2);
 await eyes.click();await expect(page.locator('[data-gaze-rim]')).toHaveCount(0);await expect(page.locator('canvas[data-iris-count]')).toHaveAttribute('data-iris-count','0');
 await head.click();await expect(page.locator('canvas[data-visible-surfaces]')).not.toHaveAttribute('data-visible-surfaces','0');await expect(eyes).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project))).toBe(before);
 await page.reload();await expect(eyes).toHaveAttribute('aria-pressed','false');await expect(head).toHaveAttribute('aria-pressed','true');
 await eyes.click();await expect(page.locator('[data-gaze-rim]')).toHaveCount(2);expect(errors).toEqual([]);
});
