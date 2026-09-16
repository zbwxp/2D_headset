import {savedProject} from "../helpers/persistence";
import {selectSidebar,openPatch} from "../helpers/sidebar";
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('artifacts/basic-patch/adjusted-source.json', 'utf8'));
const names = ['左面壳前边界·颧颊至下颊', '左颊部体积线·颧颊至颊峰', '左颊部体积线·颊峰至下颊'];
const ids = names.map(n => data.curves.find((c: any) => c.name === n).id);
const state = savedProject;
test('create mirror patches, opacity outside undo, edit curve, save/load, delete pair', async ({ page }) => {
    await page.goto('/?renderer=cpu');
    await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({ name: 'adjusted.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await openPatch(page);await page.getByRole('button', { name: '绘制面', exact: true }).click();
    // Sidebar uses the same selection dispatch as viewport curve hit paths.
    for (const name of names)
        await selectSidebar(page,'curve',name);
    expect((await state(page)).patches).toHaveLength(2);
    await expect(page.getByRole('button', { name: '退出绘制面（Esc）' })).toBeVisible();
    await expect(page.getByTestId('patch-layer')).toHaveCount(1);
    await page.getByRole('combobox', { name: '2D Patch 不透明度', exact: true }).selectOption('0.75');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await state(page)).patches ?? []).toHaveLength(0);
    expect((await state(page)).patchDisplay.opacity2d).toBe(.75);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect((await state(page)).patches).toHaveLength(2);
    expect((await state(page)).patchDisplay.opacity2d).toBe(.75);
    await selectSidebar(page,'curve',names[1]);
    const before = await page.getByTestId('patch-layer').first().innerHTML();
    const handle = page.getByTestId('curve-handle-1');
    const b = await handle.boundingBox();
    if (!b)
        throw Error('handle missing');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 30, b.y + 20, { steps: 5 });
    await page.mouse.up();
    expect(await page.getByTestId('patch-layer').first().innerHTML()).not.toEqual(before);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    for (const view of ['正面', '右 45°', '侧面']) {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await page.screenshot({ path: `test-results/patch-${view}.png`, animations: 'disabled' });
    }
    const saved = await state(page);
    await state(page);await page.reload();await openPatch(page);
    expect((await state(page)).patches).toEqual(saved.patches);
    await page.getByRole('button', { name: '删除 Patch 1', exact: true }).click();
    expect((await state(page)).patches).toHaveLength(0);
    expect((await state(page)).curves).toHaveLength(66);
    expect((await state(page)).landmarks).toHaveLength(50);
});
test('quad viewport creation, fixed hidden appearance, node update and edge cascade', async ({ page }) => {
    await page.goto('/?renderer=cpu');
    await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({ name: 'adjusted.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error' || m.text().includes('GL_INVALID'))
        errors.push(m.text()); });
    const ns = ['左面壳前边界·额颞至颧颊', '左斜面带横向桥·额颞层', '左面壳后边界·颞侧至颧弓', '左斜面带横向桥·颧颊层'];
    await openPatch(page);await page.getByRole('button', { name: '绘制面', exact: true }).click();
    for (const n of ns) {
        const c = data.curves.find((c: any) => c.name === n);
        await page.getByTestId(`curve-hit-${c.id}`).dispatchEvent('pointerdown', { button: 0, clientX: 600, clientY: 400, pointerId: 1 });
    }
    const created = await state(page);
    expect(created.patches).toHaveLength(2);
    expect(created.patches.every((p: any) => p.type === 'quad')).toBeTruthy();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '侧面', exact: true }).first().click();
    const paths = page.locator('[data-layer=curve-render] [stroke-opacity]');
    await page.getByRole('combobox', { name: '2D Patch 不透明度', exact: true }).selectOption('0.75');
    const alpha = await paths.evaluateAll(ps => ps.map(p => Number(p.getAttribute('stroke-opacity'))));
    expect(alpha.some(a => a > 0 && a < .4)).toBeTruthy();
    expect(alpha.some(a => a === 1)).toBeTruthy();
    await page.getByRole('combobox', { name: '2D Patch 不透明度', exact: true }).selectOption('1');
    expect(await paths.evaluateAll(ps => ps.some(p => p.getAttribute('stroke-opacity') === '0.25'))).toBeTruthy();
    await page.getByRole('checkbox', { name: '显示 Patch', exact: true }).uncheck();
    expect(await paths.evaluateAll(ps => ps.every(p => p.getAttribute('stroke-opacity') === '1'))).toBeTruthy();
    await page.getByRole('checkbox', { name: '显示 Patch', exact: true }).check();
    const before = await page.getByTestId('patch-layer').first().innerHTML();
    const point = page.getByTestId('landmark-左面壳前边界·颧颊转折点');
    const b = await point.boundingBox();
    if (!b)
        throw Error('point missing');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 25, b.y + 2, { steps: 5 });
    await page.mouse.up();
    expect(await page.getByTestId('patch-layer').first().innerHTML()).not.toEqual(before);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    for (const view of ['正面', '右 45°', '侧面']) {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await page.screenshot({ path: `test-results/quad-${view}.png`, animations: 'disabled' });
    }
    expect(errors).toEqual([]);
    // Load a file with one missing edge and its patches is rejected, not silently broken.
    const malformed = { ...created, curves: created.curves.filter((c: any) => c.id !== created.patches[0].boundaryUses[0].curveId) };
    await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(malformed)) });
    expect((await state(page)).patches).toHaveLength(2);
    await selectSidebar(page,'curve',ns[0]);
    await page.locator('.point-workspace').focus();
    await page.keyboard.press('Delete');
    await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click();
    expect((await state(page)).patches).toHaveLength(0);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await state(page)).patches).toHaveLength(2);
});
test('patch switch skips surfaces, preserves edits and display choice through history/load',async({page})=>{
 await page.goto('/?renderer=cpu');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'adjusted.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 await openPatch(page);await page.getByRole('button',{name:'绘制面',exact:true}).click();for(const name of names)await selectSidebar(page,'curve',name);await page.keyboard.press('Escape');
 const before=await state(page);await page.getByRole('checkbox',{name:'显示 Patch',exact:true}).uncheck();await expect(page.getByTestId('patch-layer')).toHaveCount(0);await expect(page.locator('[data-layer=curve-render] path').first()).toHaveAttribute('stroke-opacity','1');
 await selectSidebar(page,'curve',names[1]);const h=await page.getByTestId('curve-handle-1').boundingBox();if(!h)throw Error('handle');await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+30,h.y+20,{steps:5});await page.mouse.up();const edited=await state(page);expect(edited.curves).not.toEqual(before.curves);expect(edited.patches).toEqual(before.patches);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await state(page)).patchDisplay.visible).toBe(false);expect((await state(page)).curves).toEqual(before.curves);await page.getByRole('button',{name:'重做',exact:true}).click();
 await state(page);await page.reload();await openPatch(page);await expect(page.getByRole('checkbox',{name:'显示 Patch',exact:true})).not.toBeChecked();await expect(page.getByTestId('patch-layer')).toHaveCount(0);await page.getByRole('checkbox',{name:'显示 Patch',exact:true}).check();await expect(page.getByTestId('patch-layer')).toHaveCount(1);expect((await state(page)).curves).toEqual(edited.curves);
});
