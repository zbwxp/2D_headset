import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
const state=(page:any)=>page.evaluate(()=>JSON.parse(localStorage.getItem('contour.landmarks.v039')!));
const settle=async(page:any)=>page.waitForTimeout(450);
test.beforeEach(async({page})=>{await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'source.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});});
test('pair rows reflect UUID selection; singles, toggles, rename gestures and Undo',async({page})=>{
 const right=data.landmarks.find((x:any)=>x.type==='RIGHT'),left=data.landmarks.find((x:any)=>x.id===right.mirrorPartnerId);
 const row=page.locator(`[data-pair-primary="${right.id}"]`);
 expect(await page.locator('.point-list [role=button]').count()).toBe(data.landmarks.filter((x:any)=>x.type!=='LEFT').length);
 const before=await state(page);await row.click();await settle(page);await expect(row).toHaveAttribute('data-active-id',right.id);
 await row.click();await settle(page);await expect(row).toHaveAttribute('data-active-id',left.id);
 await row.click();await settle(page);await expect(row).toHaveAttribute('data-active-id',right.id);
 await row.dblclick();await expect(page.getByRole('textbox',{name:'语义点名称'})).toBeVisible();await expect(row).toHaveAttribute('data-active-id',right.id);
 await page.getByRole('textbox',{name:'语义点名称'}).press('Escape');await settle(page);await expect(row).toHaveAttribute('data-active-id',right.id);
 expect((await state(page)).landmarks).toEqual(before.landmarks);await expect(page.locator('.point-footer')).toContainText('撤销 1 / 100');
 // 2D viewport selection uses actual member IDs.
 await page.locator('svg').getByRole('button',{name:left.name,exact:true}).first().click({force:true});
 await expect(row).toHaveAttribute('data-active-id',left.id);await row.click();await settle(page);await expect(row).toHaveAttribute('data-active-id',right.id);
 await row.press('F2');await page.getByRole('textbox',{name:'语义点名称'}).fill('成对新名称');await page.getByRole('textbox',{name:'语义点名称'}).press('Enter');
 expect((await state(page)).landmarks.filter((x:any)=>[left.id,right.id].includes(x.id)).map((x:any)=>x.name).sort()).toEqual(['右成对新名称','左成对新名称']);
 await row.press('Enter');await expect(page.getByRole('textbox',{name:'语义点名称'})).toBeVisible();await page.getByRole('textbox',{name:'语义点名称'}).press('Escape');
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await state(page)).landmarks).toEqual(before.landmarks);
});
test('Curve and Patch use same row gestures; Patch names persist with pair history',async({page})=>{
 const names=['面壳前边界·颧颊至下颊','颊部体积线·颧颊至颊峰','颊部体积线·颊峰至下颊'];
 await page.getByRole('button',{name:'绘制面',exact:true}).click();
 for(const name of names){await page.locator('.curve-list').getByRole('button',{name,exact:true}).click();await settle(page);}
 await page.keyboard.press('Escape');const p=await state(page);expect(p.patches).toHaveLength(2);
 const patch=page.locator('.patch-panel [data-pair-mirror]');await expect(patch).toHaveCount(1);
 await patch.click();await settle(page);const r=await patch.getAttribute('data-active-id');await patch.click();await settle(page);expect(await patch.getAttribute('data-active-id')).not.toBe(r);
 const l=await patch.getAttribute('data-active-id');await patch.dblclick();await expect(patch).toHaveAttribute('data-active-id',l!);
 await page.getByRole('textbox',{name:'曲面名称'}).fill('前颊曲面');await page.getByRole('textbox',{name:'曲面名称'}).press('Enter');
 expect((await state(page)).patches.map((x:any)=>x.name)).toEqual(['前颊曲面','前颊曲面']);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await state(page)).patches.map((x:any)=>x.name)).toEqual([undefined,undefined]);
 await page.getByRole('button',{name:'重做',exact:true}).click();await page.reload();expect((await state(page)).patches.map((x:any)=>x.name)).toEqual(['前颊曲面','前颊曲面']);
 const cr=page.locator('.curve-list').getByRole('button',{name:names[0],exact:true});await cr.click();await settle(page);const cid=await cr.getAttribute('data-active-id');await cr.dblclick();await expect(cr).toHaveAttribute('data-active-id',cid!);
 await page.getByRole('textbox',{name:'结构线名称'}).fill('成对结构线');await page.getByRole('textbox',{name:'结构线名称'}).press('Enter');
 expect((await state(page)).curves.filter((x:any)=>x.name.endsWith('成对结构线'))).toHaveLength(2);
 await page.getByRole('button',{name:'删除 Patch 1',exact:true}).click();expect((await state(page)).patches).toHaveLength(0);expect((await state(page)).curves).toHaveLength(data.curves.length);
});
