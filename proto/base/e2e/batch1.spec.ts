// Doc 18 §32 (first batch "基础编辑可靠", bowen 1791378828): accepted through REAL mouse and keyboard input in Chromium.
// Set-up may use the API; every action under test is a real click / key; expectations are what the user sees and the
// exact document afterwards (nothing else changed).
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#modeV'))
  await page.click('#fileNew')
}
async function toPage(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  return { x: box.x + e + p.x * z, y: box.y + f + p.y * z }
}
const records = (page: Page, type: string) => page.evaluate((t) => (window as any).__contour.editor.reader.allRecords().filter((r: any) => r.typeName === t), type)
/** every record by id — compared by content (toEqual), not by JSON byte order (dot 1791379735) */
const byId = async (page: Page): Promise<Record<string, unknown>> => Object.fromEntries((await page.evaluate(() => (window as any).__contour.editor.reader.allRecords())).map((r: any) => [r.id, r]))

/** two layers: 「嘴」 holds the mouth line (3 anchors), 「鼻」 the nose line (3 anchors); the view fits them */
async function mouthAndNose(page: Page) {
  await open(page)
  const L1 = (await records(page, 'container'))[0].id
  await page.click('#newLayer')
  const L2 = (await records(page, 'container')).find((c: any) => c.id !== L1).id
  await page.evaluate(({ L1, L2 }) => {
    const { api } = (window as any).__contour
    const a = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
    api.apply({ type: 'createCurve', id: 'curve:mouth', name: '嘴线', parentId: L1, anchors: { m1: a('m1', 20, 80), m2: a('m2', 50, 90), m3: a('m3', 80, 80) }, segments: [{ id: 's1', from: 'm1', to: 'm2' }, { id: 's2', from: 'm2', to: 'm3' }] })
    api.apply({ type: 'createCurve', id: 'curve:nose', name: '鼻尖短线', parentId: L2, anchors: { n1: a('n1', 40, 40), n2: a('n2', 50, 50), n3: a('n3', 60, 40) }, segments: [{ id: 's1', from: 'n1', to: 'n2' }, { id: 's2', from: 'n2', to: 'n3' }] })
  }, { L1, L2 })
  await page.keyboard.press('Meta+0')
}
async function pressDeleteOnCanvas(page: Page) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  await page.mouse.move(box.x + 5, box.y + 5)
  await page.keyboard.press('Delete')
}

test.describe('§32.1 E1: the selected anchors always belong to the selected lines', () => {
  test('A on a mouth anchor → nose in the layers list → Delete removes the nose, nothing else changes', async ({ page }) => {
    await mouthAndNose(page)
    await page.keyboard.press('a')
    const q = await toPage(page, { x: 20, y: 80 })
    await page.mouse.click(q.x, q.y)
    expect(await page.evaluate(() => (window as any).__contour.selection.getAnchors())).toEqual(['curve:mouth#m1'])
    const before = await byId(page)
    await page.click('[data-id="curve:nose"] .name')
    // the properties show no anchor of the mouth line
    expect(await page.evaluate(() => (window as any).__contour.selection.getAnchors())).toEqual([])
    await expect(page.locator('#propsPanel')).not.toContainText('嘴线#')
    await pressDeleteOnCanvas(page)
    const after = await byId(page)
    expect(after['curve:nose']).toBeUndefined()
    for (const id of Object.keys(before)) if (id !== 'curve:nose') expect(after[id], id).toEqual(before[id])
    expect(Object.keys(after).length).toBe(Object.keys(before).length - 1)
  })

  test('A on a mouth anchor → V click on the nose → Delete removes the nose', async ({ page }) => {
    await mouthAndNose(page)
    await page.keyboard.press('a')
    const q = await toPage(page, { x: 20, y: 80 })
    await page.mouse.click(q.x, q.y)
    await page.keyboard.press('v')
    const n = await toPage(page, { x: 45, y: 45 })
    await page.mouse.click(n.x, n.y)
    const before = await byId(page)
    await pressDeleteOnCanvas(page)
    const after = await byId(page)
    expect(after['curve:nose']).toBeUndefined()
    expect(after['curve:mouth']).toEqual(before['curve:mouth'])
  })

  test('anchors of a line that stays selected stay selected (⌘-add another line in the layers list)', async ({ page }) => {
    await mouthAndNose(page)
    await page.keyboard.press('a')
    const q = await toPage(page, { x: 20, y: 80 })
    await page.mouse.click(q.x, q.y)
    expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual(['curve:mouth'])
    await page.click('[data-id="curve:nose"] .name', { modifiers: ['ControlOrMeta'] })
    expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual(['curve:mouth', 'curve:nose'])
    expect(await page.evaluate(() => (window as any).__contour.selection.getAnchors())).toEqual(['curve:mouth#m1'])
  })

  test('after undo / redo no selected anchor points at a line that is not selected', async ({ page }) => {
    await mouthAndNose(page)
    await page.keyboard.press('a')
    const q = await toPage(page, { x: 20, y: 80 })
    await page.mouse.click(q.x, q.y)
    await page.click('[data-id="curve:nose"] .name')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+Shift+z')
    const sel = await page.evaluate(() => (window as any).__contour.selection.get())
    const anchors: string[] = await page.evaluate(() => (window as any).__contour.selection.getAnchors())
    for (const k of anchors) expect(sel).toContain(k.split('#')[0])
  })
})
