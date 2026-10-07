// Asynchronous operations fix their objects and their document when they START (dot, review of 7538032): a cut deletes
// what it copied, never a newer selection; a save that finishes after another document was opened does not take over
// that document's file; edits made while the open dialog is up are asked about again; a paste whose document was
// replaced meanwhile does nothing. Each race is reproduced with a delayed clipboard / file dialog in Chromium.
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#fileSave'))
}
const has = (page: Page, id: string) => page.evaluate((id) => !!(window as any).__contour.editor.reader.get(id), id)
const settle = (page: Page, ms = 50) => page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), ms)
/** the clipboard write / read take `ms` */
const slowClipboard = (page: Page, ms: number) =>
  page.evaluate((ms) => {
    let text = ''
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => new Promise((r) => setTimeout(() => ((text = t), r(undefined)), ms)), readText: () => new Promise((r) => setTimeout(() => r(text), ms)) } })
  }, ms)

test('cut: the objects are the ones selected when the cut started — changing the selection meanwhile does not redirect the delete', async ({ page }) => {
  await open(page)
  await slowClipboard(page, 300)
  await page.click('[data-id="curve:E1"]')
  await page.keyboard.press('ControlOrMeta+x')
  await page.click('[data-id="curve:C1"]') // a new selection while the clipboard is being written
  await settle(page, 450)
  expect(await has(page, 'curve:E1')).toBe(false) // what was cut
  expect(await has(page, 'curve:C1')).toBe(true) // the newer selection is untouched
})

test('cut: an edit while the clipboard is written cancels the delete (the copy stands) and says so', async ({ page }) => {
  await open(page)
  await slowClipboard(page, 300)
  await page.click('[data-id="curve:E1"]')
  await page.keyboard.press('ControlOrMeta+x')
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setProps', id: 'container:L1', name: 'x' }))
  await settle(page, 450)
  expect(await has(page, 'curve:E1')).toBe(true)
  await expect(page.locator('#status')).toContainText('没有删除')
})

test('save A, then open B before A finishes: B keeps its own name and file; A\'s late completion changes nothing of B', async ({ page }) => {
  await open(page)
  const b = await page.evaluate(() => JSON.stringify((window as any).__contour.editor.save()))
  await page.evaluate((b) => {
    const { files } = (window as any).__contour
    files.io.save = () => new Promise((r) => setTimeout(() => r({ name: 'A.contour.json' }), 300))
    files.io.open = async () => Object.assign(new File([b], 'B.contour.json'), { handle: { name: 'B.contour.json' } })
  }, b)
  await page.keyboard.press('ArrowRight') // nothing selected: no edit; make one so A is dirty
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setProps', id: 'container:L1', name: 'A' }))
  page.once('dialog', (d) => d.accept()) // A has unsaved changes when B is opened
  const saving = page.evaluate(() => (window as any).__contour.files.save())
  await page.evaluate(() => (window as any).__contour.files.open())
  await saving
  await expect(page.locator('#fileName')).toHaveText('B.contour.json')
  expect(await page.evaluate(() => (window as any).__contour.editor.isDirty)).toBe(false)
  await expect(page.locator('#status')).toContainText('期间已打开另一个文档')
  // the next ⌘S writes B to B's file, not to A's
  const target = await page.evaluate(async () => {
    const { files } = (window as any).__contour
    let to: any = 'none'
    files.io.save = async (_b: Blob, _o: unknown, handle: any) => ((to = handle?.name ?? null), handle)
    await files.save()
    return to
  })
  expect(target).toBe('B.contour.json')
})

test('open: edits made while the dialog is up are asked about again; cancelling keeps them', async ({ page }) => {
  await open(page)
  const file = await page.evaluate(() => JSON.stringify((window as any).__contour.editor.save()))
  await page.evaluate((file) => {
    ;(window as any).__contour.files.io.open = () => new Promise((r) => setTimeout(() => r(new File([file], 'other.contour.json')), 300))
  }, file)
  const opening = page.evaluate(() => (window as any).__contour.files.open()) // clean: no question yet
  await settle(page, 50)
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setProps', id: 'container:L1', name: '新改的' }))
  let asked = false
  page.once('dialog', (d) => ((asked = true), d.dismiss()))
  expect(await opening).toBe(false)
  expect(asked).toBe(true)
  expect(await page.evaluate(() => (window as any).__contour.editor.reader.get('container:L1').name)).toBe('新改的')
})

test('paste: a document opened while the clipboard is read gets nothing pasted', async ({ page }) => {
  await open(page)
  await slowClipboard(page, 300)
  await page.click('[data-id="curve:E1"]')
  await page.keyboard.press('ControlOrMeta+c')
  await settle(page, 400)
  const file = await page.evaluate(() => JSON.stringify((window as any).__contour.editor.save()))
  await page.keyboard.press('ControlOrMeta+v') // reads the clipboard (300 ms)
  await page.evaluate(async (file) => {
    const { files } = (window as any).__contour
    files.io.open = async () => new File([file], 'other.contour.json')
    await files.open()
  }, file)
  await settle(page, 450)
  expect(await page.evaluate(() => (window as any).__contour.editor.history.undo)).toEqual([])
  await expect(page.locator('#status')).toContainText('没有粘贴')
})
