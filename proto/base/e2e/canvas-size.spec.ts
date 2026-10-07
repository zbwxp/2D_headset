// The canvas follows the window (doc 18 §30.14): it fills the stage, keeps zoom and pan, never below 640 × 420.
import { expect, test } from '@playwright/test'

test('a bigger window gives a bigger canvas (zoom / pan kept, the drawing at the same screen place); a small one keeps 640 × 420', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour)
  const size = () => page.evaluate(() => {
    const v = (window as any).__contour.view
    return { w: v.canvas.getWidth(), h: v.canvas.getHeight(), vpt: [...v.canvas.viewportTransform] }
  })
  await expect.poll(async () => (await size()).w).toBeGreaterThan(900)
  const big = await size()
  expect(big.h).toBeGreaterThan(600)
  expect(big.vpt).toEqual([3, 0, 0, 3, 150, 60])
  // the canvas edge is inside the window (no page scroll), the side panel still there
  const side = (await page.locator('#side').boundingBox())!
  const canvas = (await page.locator('canvas.upper-canvas').boundingBox())!
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(side.x + 1)
  await page.setViewportSize({ width: 800, height: 600 })
  await expect.poll(async () => (await size()).w).toBe(640)
  expect((await size()).h).toBe(420)
  expect((await size()).vpt).toEqual([3, 0, 0, 3, 150, 60])
})

test('a narrow window keeps the side panel reachable: the stage narrows and scrolls its canvas (review of 63a0efc C4)', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 })
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour)
  const l = await page.evaluate(() => {
    const st = document.querySelector('#stage')!, side = document.querySelector('#side')!.getBoundingClientRect()
    return { sideX: side.x, sideW: side.width, stageClient: st.clientWidth, stageScroll: st.scrollWidth }
  })
  expect(l.sideX + l.sideW).toBeLessThanOrEqual(641)
  expect(l.sideW).toBeGreaterThan(100)
  expect(l.stageScroll).toBeGreaterThan(l.stageClient)
})
