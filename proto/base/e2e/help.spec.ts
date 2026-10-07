// Operation help (doc 18 §30.8): the hint line below the canvas follows the tool, the selection and the step in
// progress; the tool help in the side panel collapses / closes / reopens and is remembered across reloads.
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#hint'))
}
async function at(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  return { x: box.x + e + p.x * z, y: box.y + f + p.y * z }
}

test('the hint line follows the tool, the selection and the step (marquee with E, pen drawing); it is outside the canvas', async ({ page }) => {
  await open(page)
  const canvas = (await page.locator('.canvas-container').boundingBox())!
  const hint = (await page.locator('#hint').boundingBox())!
  expect(hint.y).toBeGreaterThanOrEqual(canvas.y + canvas.height) // never over the drawing
  await page.keyboard.press('v')
  await expect(page.locator('#hint')).toContainText('空白处拖 = 框选')
  await page.click('[data-id="curve:E1"]')
  await expect(page.locator('#hint')).toContainText('已选 1 个')
  // a marquee in progress, E toggles the mode shown
  const a = await at(page, { x: 120, y: 100 }), b = await at(page, { x: 140, y: 110 })
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 3 })
  await expect(page.locator('#hint')).toContainText('碰到就选')
  await page.keyboard.press('e')
  await expect(page.locator('#hint')).toContainText('完全框进才选')
  await page.mouse.up()
  // the pen while drawing
  await page.keyboard.press('p')
  await expect(page.locator('#hint')).toContainText('点开放路径的端点 = 接着画')
  const p = await at(page, { x: 120, y: 100 })
  await page.mouse.click(p.x, p.y)
  await expect(page.locator('#hint')).toContainText('Enter / Esc 结束')
  await page.keyboard.press('Escape')
  await expect(page.locator('#hint')).toContainText('点 = 角点')
})

test('tool help: shows the current tool, collapses, closes, reopens from ？, and is remembered after a reload', async ({ page }) => {
  await open(page)
  await expect(page.locator('#toolHelp')).toContainText('A 直接选择')
  await page.keyboard.press('p')
  await expect(page.locator('#toolHelp')).toContainText('P 钢笔')
  await page.click('#toolHelp .help-title')
  await expect(page.locator('#toolHelp')).toHaveAttribute('data-state', 'collapsed')
  await page.click('#helpClose')
  await expect(page.locator('#toolHelp')).toHaveCount(0)
  await page.reload()
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#hint'))
  await expect(page.locator('#toolHelp')).toHaveCount(0) // remembered: closed
  await page.click('#helpOpen')
  await expect(page.locator('#toolHelp')).toHaveAttribute('data-state', 'open')
})
