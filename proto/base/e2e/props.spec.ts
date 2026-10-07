// The properties panel and the layer rename (doc 18 §30.4), through real typing / picking in Chromium.
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#layersPanel'))
}
const rec = (page: Page, id: string) => page.evaluate((id) => (window as any).__contour.editor.reader.get(id), id)
const undoLabels = (page: Page) => page.evaluate(() => (window as any).__contour.editor.history.undo as string[])

test('rename by double-clicking a layer row (Enter commits, Esc cancels) and in the properties panel; one undo step each', async ({ page }) => {
  await open(page)
  await page.dblclick('[data-id="curve:E1"] .name')
  await page.locator('[data-rename="curve:E1"]').fill('耳朵线')
  await page.keyboard.press('Enter')
  expect((await rec(page, 'curve:E1')).name).toBe('耳朵线')
  await expect(page.locator('[data-id="curve:E1"] .name')).toHaveText('耳朵线')
  await page.dblclick('[data-id="curve:E1"] .name')
  await page.locator('[data-rename="curve:E1"]').fill('不要')
  await page.keyboard.press('Escape')
  expect((await rec(page, 'curve:E1')).name).toBe('耳朵线')
  // the properties panel's name field (the row is selected by the clicks above)
  await page.locator('#propsPanel [data-prop=name]').fill('左耳')
  await page.keyboard.press('Enter')
  expect((await rec(page, 'curve:E1')).name).toBe('左耳')
  expect(await undoLabels(page)).toEqual(['setProps', 'setProps'])
  // typing in the field did not trigger shortcuts (e.g. "a" = Direct Selection, Backspace = delete)
  expect(await page.evaluate(() => !!(window as any).__contour.editor.reader.get('curve:E1'))).toBe(true)
  await page.keyboard.press('ControlOrMeta+z')
  expect((await rec(page, 'curve:E1')).name).toBe('耳朵线')
})

test('stroke width and colour, fill colour from the properties panel; refused input says why and writes nothing', async ({ page }) => {
  await open(page)
  await page.click('[data-id="curve:E1"]')
  await page.locator('#propsPanel [data-prop=strokeWidth]').fill('6')
  await page.keyboard.press('Enter')
  expect((await rec(page, 'curve:E1')).stroke.width).toBe(6)
  await page.locator('#propsPanel [data-prop=strokeColor]').fill('#ff0000')
  expect((await rec(page, 'curve:E1')).stroke.color).toBe('#ff0000')
  await page.locator('#propsPanel [data-prop=strokeWidth]').fill('0')
  await page.keyboard.press('Enter')
  await expect(page.locator('#status')).toContainText('positive')
  expect((await rec(page, 'curve:E1')).stroke.width).toBe(6)
  // a fill in a locked layer: refused; unlocked: changed
  await page.click('[data-id="fill:F"]')
  await page.locator('#propsPanel [data-prop=fillColor]').fill('#00ff00')
  await expect(page.locator('#status')).toContainText('LOCKED')
  await page.click('#unlock')
  await page.click('[data-id="fill:F"]')
  await page.locator('#propsPanel [data-prop=fillColor]').fill('#00ff00')
  expect((await rec(page, 'fill:F')).color).toBe('#00ff00')
  expect(await undoLabels(page)).toEqual(['setProps', 'setProps', 'setContainerFlags', 'setProps'])
})
