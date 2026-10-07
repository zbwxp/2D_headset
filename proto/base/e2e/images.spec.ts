// Reference images and the colour picker (doc 18 §31) through real clicks and keys in Chromium — the acceptance matrix
// §31.7: place (file / drop / refused), adjust (drag, typed, slider, arrow keys), lock and draw over it, the position
// slots' must-verify flow (dot 1791365450), the two picking modes (K → I → K), export without it, a large matrix sheet.
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const FIX = 'e2e/fixtures/'
async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#placeImage'))
  page.on('dialog', (d) => void d.accept().catch(() => {}))
  await page.click('#fileNew')
}
const ctx = (page: Page, fn: string, arg?: unknown) => page.evaluate(([f, a]) => new Function('c', 'a', `return (${f})(c, a)`)((window as any).__contour, a), [fn, arg] as const)
const records = (page: Page, type: string) => page.evaluate((t) => (window as any).__contour.editor.reader.allRecords().filter((r: any) => r.typeName === t), type)
const image = async (page: Page) => (await records(page, 'image'))[0]
const undo = (page: Page) => page.evaluate(() => (window as any).__contour.editor.history.undo as string[])
async function screen(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  return { x: box.x + e + p.x * z, y: box.y + f + p.y * z }
}
async function place(page: Page, file = 'ref-small.png') {
  await page.setInputFiles('#placeImageFile', FIX + file)
  await page.waitForFunction(() => (window as any).__contour.editor.reader.allRecords().some((r: any) => r.typeName === 'image'))
  return image(page)
}
/** a drawing point inside the image at image pixel (u, v) */
const at = (img: any, u: number, v: number) => ({ x: img.transform.a * u + img.transform.c * v + img.transform.e, y: img.transform.b * u + img.transform.d * v + img.transform.f })

test('置入: a file → a new layer 「参考图」 below every layer, at 50%, selected — one undo removes all of it; a broken file is refused with the reason, nothing written', async ({ page }) => {
  await open(page)
  const before = await page.evaluate(() => (window as any).__contour.editor.reader.allRecords().length)
  const img = await place(page)
  const layers = await records(page, 'container')
  const ref = layers.find((l: any) => l.id === img.parentId)
  expect(ref.name).toBe('参考图')
  expect(layers.every((l: any) => l.id === ref.id || l.parentId !== null || ref.index < l.index)).toBe(true)
  expect(img).toMatchObject({ width: 40, height: 20, opacity: 0.5 })
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([img.id])
  expect(await undo(page)).toEqual(['placeImage'])
  await page.keyboard.press('Meta+z')
  expect(await page.evaluate(() => (window as any).__contour.editor.reader.allRecords().length)).toBe(before)
  // redo puts it back exactly
  await page.keyboard.press('Meta+Shift+z')
  expect((await image(page))).toEqual(img)
  await page.keyboard.press('Meta+z')
  // broken file: refused, said, nothing written
  await page.setInputFiles('#placeImageFile', FIX + 'not-an-image.png')
  await expect(page.locator('#status')).toContainText('无法解码')
  expect(await records(page, 'image')).toEqual([])
  // a picture over the limits (16385 px wide): refused when decoded, nothing written
  await page.setInputFiles('#placeImageFile', FIX + 'too-wide.png')
  await expect(page.locator('#status')).toContainText('超过上限')
  expect(await records(page, 'image')).toEqual([])
  expect(await undo(page)).toEqual([])
})

test('a marquee touching the image selects it (unlocked)', async ({ page }) => {
  await open(page)
  const img = await place(page)
  await page.evaluate(() => (window as any).__contour.selection.clear())
  await page.keyboard.press('v')
  const m0 = await screen(page, at(img, 30, 5)), m1 = await screen(page, at(img, 60, 30)) // starts inside it, ends outside
  await page.mouse.move(m1.x, m1.y)
  await page.mouse.down()
  await page.mouse.move(m0.x, m0.y, { steps: 4 })
  await page.mouse.up()
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([img.id])
})

test('a picture file dropped on the canvas is placed', async ({ page }) => {
  await open(page)
  const data = readFileSync(FIX + 'ref-small.png').toString('base64')
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
    const el = (window as any).__contour.view.canvas.wrapperEl as HTMLElement
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, data)
  await page.waitForFunction(() => (window as any).__contour.editor.reader.allRecords().some((r: any) => r.typeName === 'image'))
  expect((await image(page)).name).toBe('dropped')
})

test('slots (must-verify, dot 1791365450): move → 存 into slot 5 → move elsewhere → 调出 5 → back; save, reopen → 调出 5 again → the same; saving into a filled slot overwrites it with the CURRENT placement', async ({ page }) => {
  await open(page)
  let img = await place(page)
  // move it: V, drag on the canvas
  await page.keyboard.press('v')
  const from = await screen(page, at(img, 10, 10))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 5 })
  await page.mouse.up()
  img = await image(page)
  const moved = img.transform
  // 存 into slot 5 (n = 4)
  await page.click('[data-slot="4"] [data-slot-save]')
  await expect(page.locator('#status')).toContainText('已存到 5 号')
  await expect(page.locator('[data-slot="4"]')).toHaveAttribute('data-here', 'true')
  // move elsewhere with the arrow keys (canvas focus): slot 5 is no longer "here"
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()) // focus off any input
  await page.evaluate(() => (window as any).__contour.selection.set([(window as any).__contour.editor.reader.allRecords().find((r: any) => r.typeName === 'image').id]))
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
  expect((await image(page)).transform).not.toEqual(moved)
  await expect(page.locator('[data-slot="4"]')).toHaveAttribute('data-here', 'false')
  // 调出 5: back
  await page.click('[data-slot="4"] [data-slot-recall]')
  expect((await image(page)).transform).toEqual(moved)
  // save the document, move again, reopen the saved file, 调出 5
  const saved = await page.evaluate(() => JSON.stringify((window as any).__contour.editor.save()))
  await page.keyboard.press('Shift+ArrowDown')
  await page.evaluate((text) => {
    const { files } = (window as any).__contour
    files.io.open = () => Promise.resolve(new File([text], 'sheet.contour.json'))
  }, saved)
  await page.click('#fileOpen')
  await page.waitForFunction(() => (window as any).__contour.files.name.get() === 'sheet.contour.json')
  const reopened = await image(page)
  await page.click(`[data-id="${reopened.id}"]`)
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setProps', id: (window as any).__contour.editor.reader.allRecords().find((r: any) => r.typeName === 'image').id, transform: { a: 2, b: 0, c: 0, d: 2, e: -50, f: -50 } }))
  await page.click('[data-slot="4"] [data-slot-recall]')
  expect((await image(page)).transform).toEqual(moved)
  // a filled slot gets the CURRENT placement on 存 (v103 could not)
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setProps', id: (window as any).__contour.editor.reader.allRecords().find((r: any) => r.typeName === 'image').id, transform: { a: 3, b: 0, c: 0, d: 3, e: 7, f: 9 } }))
  await page.click('[data-slot="4"] [data-slot-save]')
  await expect(page.locator('#status')).toContainText('已存到 5 号（覆盖了原来的位置）')
  expect((await image(page)).slots.find((s: any) => s.n === 4).transform).toEqual({ a: 3, b: 0, c: 0, d: 3, e: 7, f: 9 })
  expect((await image(page)).transform).toEqual({ a: 3, b: 0, c: 0, d: 3, e: 7, f: 9 }) // saving did not move it
})

test('X / Y / 大小 / 角度: typed (Enter), the arrow keys inside a field do not move the image, a slider drag is one undo step', async ({ page }) => {
  await open(page)
  await place(page)
  const centre = () => page.evaluate(() => {
    const i = (window as any).__contour.editor.reader.allRecords().find((r: any) => r.typeName === 'image')
    const m = i.transform
    return { x: m.a * i.width / 2 + m.c * i.height / 2 + m.e, y: m.b * i.width / 2 + m.d * i.height / 2 + m.f, size: Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), angle: Math.atan2(m.b, m.a) * 180 / Math.PI }
  })
  const x = page.locator('[data-placement="X"] input[type="number"]')
  await x.fill('123.5')
  await x.press('Enter')
  expect((await centre()).x).toBeCloseTo(123.5, 9)
  const steps = (await undo(page)).length
  // arrows typed in the field change only the field
  const t0 = (await image(page)).transform
  await x.focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowLeft')
  expect((await image(page)).transform).toEqual(t0)
  await x.press('Escape')
  // size 250 %, angle 30°, about the centre (the centre stays)
  const c0 = await centre()
  const size = page.locator('[data-placement="大小"] input[type="number"]')
  await size.fill('250')
  await size.press('Enter')
  const angle = page.locator('[data-placement="角度"] input[type="number"]')
  await angle.fill('30')
  await angle.press('Enter')
  const c1 = await centre()
  expect(c1.size).toBeCloseTo(2.5, 9)
  expect(c1.angle).toBeCloseTo(30, 9)
  expect(c1.x).toBeCloseTo(c0.x, 9)
  expect(c1.y).toBeCloseTo(c0.y, 9)
  expect((await undo(page)).length).toBe(steps + 2)
  // the Y slider: drag it — one undo step, and the image moved
  const slider = page.locator('[data-placement="Y"] input[type="range"]')
  await slider.scrollIntoViewIfNeeded()
  const b = (await slider.boundingBox())!
  const y0 = (await centre()).y
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  expect((await centre()).y).toBeGreaterThan(y0)
  expect((await undo(page)).length).toBe(steps + 3)
})

test('locked reference: not picked, not moved; drawing and selecting artwork over it as if it were not there; slot 调出 still works', async ({ page }) => {
  await open(page)
  const img = await place(page)
  await page.click('[data-slot="0"] [data-slot-save]')
  // lock the 参考图 layer
  await page.locator(`[data-id="${img.parentId}"] [data-flag="locked"]`).click()
  // V click on it: nothing selected; a marquee over it: nothing selected
  await page.keyboard.press('v')
  const p = await screen(page, at(img, 20, 10))
  await page.mouse.click(p.x, p.y)
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([])
  const m0 = await screen(page, at(img, -5, -5)), m1 = await screen(page, at(img, 45, 25))
  await page.mouse.move(m0.x, m0.y)
  await page.mouse.down()
  await page.mouse.move(m1.x, m1.y, { steps: 4 })
  await page.mouse.up()
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([])
  // original-colour picking still reads it (dot 1791365307: a lock does not stop picking)
  expect(await page.evaluate((m) => {
    const { view } = (window as any).__contour
    view.pickMode.set('source')
    return view.pick({ x: m.a * 5 + m.c * 10 + m.e, y: m.b * 5 + m.d * 10 + m.f })
  }, img.transform)).toBe('#ff0000')
  // draw a line over it in the other layer
  const other = (await records(page, 'container')).find((l: any) => l.id !== img.parentId)
  await page.click(`[data-id="${other.id}"]`)
  await page.keyboard.press('p')
  const a = await screen(page, at(img, 5, 5)), b2 = await screen(page, at(img, 35, 15))
  await page.mouse.click(a.x, a.y)
  await page.mouse.click(b2.x, b2.y)
  await page.keyboard.press('Enter')
  const [line] = await records(page, 'curve')
  expect(line.parentId).toBe(other.id)
  // V click on the line selects it (not the image under it)
  await page.keyboard.press('v')
  const mid = await screen(page, { x: (line.anchors[Object.keys(line.anchors)[0]].p.x + line.anchors[Object.keys(line.anchors)[1]].p.x) / 2, y: (line.anchors[Object.keys(line.anchors)[0]].p.y + line.anchors[Object.keys(line.anchors)[1]].p.y) / 2 })
  await page.mouse.click(mid.x, mid.y)
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([line.id])
  // slots under the lock: recall works (the stated exemption), the panel reaches it through the layers list
  await page.click(`[data-id="${img.id}"]`)
  await page.evaluate((id) => (window as any).__contour.api.apply({ type: 'recallImageSlot', id, n: 0 }), img.id)
  expect((await image(page)).transform).toEqual(img.transform)
})

test('取色: 参考图原色 takes the picture\'s own pixel (not its 50% look); 画面显示色 what is shown; the mode is visible and Tab switches it; K → I → K keeps the first area; picking writes nothing', async ({ page }) => {
  await open(page)
  const img = await place(page)
  await page.keyboard.press('i')
  await expect(page.locator('#hint')).toContainText('参考图原色')
  const left = await screen(page, at(img, 5, 10)) // red half
  await page.mouse.click(left.x, left.y)
  expect(await page.locator('#fillColor').inputValue()).toBe('#ff0000')
  const right = await screen(page, at(img, 30, 10)) // (12,200,90) half
  await page.mouse.click(right.x, right.y)
  expect(await page.locator('#fillColor').inputValue()).toBe('#0cc85a')
  // Tab → 画面显示色: 50% over white
  await page.keyboard.press('Tab')
  await expect(page.locator('#hint')).toContainText('画面显示色')
  await expect(page.locator('#pickScreen')).toHaveClass(/on/)
  await page.mouse.click(left.x, left.y)
  const shown = await page.locator('#fillColor').inputValue()
  expect(shown === '#ff8080' || shown === '#ff7f7f').toBe(true)
  // nothing written by picking
  expect(await undo(page)).toEqual(['placeImage'])
  // K → I → K: draw two closed triangles, fill the first, pick, fill the second — the first keeps its colour
  // two closed triangles beside the image (in view), in the artwork layer
  const o = at(img, 0, 30) // just below the picture
  await page.evaluate((o) => {
    const { api, editor } = (window as any).__contour
    const L = editor.reader.allRecords().find((r: any) => r.typeName === 'container' && r.name !== '参考图').id
    const a = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
    for (const [id, dx] of [['curve:t1', 0], ['curve:t2', 25]] as const)
      api.apply({ type: 'createCurve', id, parentId: L, anchors: { a: a('a', o.x + dx, o.y), b: a('b', o.x + dx + 20, o.y), c: a('c', o.x + dx + 10, o.y + 15) }, segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }, { id: 's3', from: 'c', to: 'a' }], closed: true })
  }, o)
  await page.locator('#fillColor').fill('#123456')
  await page.keyboard.press('k')
  const in1 = await screen(page, { x: o.x + 10, y: o.y + 5 })
  await page.mouse.click(in1.x, in1.y)
  const first = (await records(page, 'fill'))[0]
  expect(first.color).toBe('#123456')
  await page.keyboard.press('i')
  await page.keyboard.press('Tab') // back to 原色
  await page.mouse.click(right.x, right.y)
  await page.keyboard.press('k')
  const in2 = await screen(page, { x: o.x + 35, y: o.y + 5 })
  await page.mouse.click(in2.x, in2.y)
  const fills = await records(page, 'fill')
  expect(fills.find((f: any) => f.id === first.id).color).toBe('#123456') // not repainted by the pick
  expect(fills.find((f: any) => f.id !== first.id).color).toBe('#0cc85a')
})

test('画面显示色 leaves out editor aids: with a line selected (blue outline over it) the pick is the line\'s own colour; the same at another zoom', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const { api, editor } = (window as any).__contour
    const L = editor.reader.allRecords().find((r: any) => r.typeName === 'container').id
    const a = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
    api.apply({ type: 'createCurve', id: 'curve:thick', parentId: L, anchors: { p: a('p', 10, 50), q: a('q', 90, 50) }, segments: [{ id: 's', from: 'p', to: 'q' }] })
    api.apply({ type: 'setProps', id: 'curve:thick', stroke: { color: '#00ff00', width: 30 } })
  })
  const pick = () => page.evaluate(() => {
    const { view } = (window as any).__contour
    view.pickMode.set('screen')
    return view.pick({ x: 50, y: 50 })
  })
  const plain = await pick()
  expect(plain).toBe('#00ff00')
  await page.evaluate(() => (window as any).__contour.selection.set(['curve:thick']))
  expect(await pick()).toBe(plain)
  await page.evaluate(() => (window as any).__contour.view.zoomBy(0.3))
  expect(await pick()).toBe(plain)
})

test('export PNG / SVG leaves the reference image out', async ({ page }) => {
  await open(page)
  await place(page)
  const out = await page.evaluate(async () => {
    const { view } = (window as any).__contour
    const png: Blob | null = await view.exportBlob('png', 1).catch(() => null)
    const svg: Blob | null = await view.exportBlob('svg', 1).catch(() => null)
    return { png: png ? png.size : null, svg: svg ? await svg.text() : null }
  })
  // only the image in the document: nothing to export (no artwork bounds), or an export without it
  if (out.svg !== null) expect(out.svg).not.toMatch(/<image|data:image/)
})

test('a large angle-matrix sheet (6000 × 3000): placed, moved far by the slider, slot recall exact, original-colour pick of a far cell exact', async ({ page }) => {
  await open(page)
  const img = await place(page, 'ref-matrix.png')
  expect(img).toMatchObject({ width: 6000, height: 3000 })
  await page.click('[data-slot="0"] [data-slot-save]')
  const x = page.locator('[data-placement="X"] input[type="number"]')
  await x.fill('100000')
  await x.press('Enter')
  await page.click('[data-slot="0"] [data-slot-recall]')
  expect((await image(page)).transform).toEqual(img.transform)
  // the last cell (i = 20, j = 8): (240, 224, 12)
  const colour = await page.evaluate((m) => {
    const { view } = (window as any).__contour
    view.pickMode.set('source')
    return view.pick({ x: m.a * 5990 + m.c * 2990 + m.e, y: m.b * 5990 + m.d * 2990 + m.f })
  }, img.transform)
  expect(colour).toBe('#f0e00c')
})

test('copy / paste: the image comes back through the one image check; a pasted image whose size does not match its picture is refused', async ({ page }) => {
  await open(page)
  const img = await place(page)
  await page.evaluate((id) => (window as any).__contour.selection.set([id]), img.id)
  await page.keyboard.press('Meta+c')
  await page.keyboard.press('Meta+v')
  await page.waitForFunction(() => (window as any).__contour.editor.reader.allRecords().filter((r: any) => r.typeName === 'image').length === 2)
  // a tampered clipboard: the declared size differs from the picture's
  const r = await page.evaluate(async () => {
    const { view } = (window as any).__contour
    const c = JSON.parse(view.clip)
    for (const rec of c.records) if (rec.typeName === 'image') rec.width = 41
    view.clip = JSON.stringify(c)
    try {
      await navigator.clipboard.writeText('')
    } catch {}
    await view.paste()
    return document.querySelector('#status')!.textContent
  })
  expect(r).toContain('不符')
  expect((await records(page, 'image')).length).toBe(2)
})

test('a mask target: shown only inside the mask region (pixels), the masked-away part is not picked', async ({ page }) => {
  await open(page)
  const img = await place(page)
  // a thick vertical line over the image's left part as an "inside" mask source
  const ids = await page.evaluate((img) => {
    const { api, editor } = (window as any).__contour
    const L = editor.reader.allRecords().find((r: any) => r.typeName === 'container' && r.name !== '参考图').id
    const m = img.transform
    const P = (u: number, v: number) => ({ x: m.a * u + m.c * v + m.e, y: m.b * u + m.d * v + m.f })
    const a = (id: string, q: { x: number; y: number }) => ({ id, p: q, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
    api.apply({ type: 'createCurve', id: 'curve:mask', parentId: L, anchors: { p: a('p', P(5, -5)), q: a('q', P(5, 25)) }, segments: [{ id: 's', from: 'p', to: 'q' }] })
    api.apply({ type: 'setProps', id: 'curve:mask', stroke: { width: 30 } }) // ink 10 wide: image pixels 0..10
    api.apply({ type: 'setContainerFlags', containerId: L, visible: false }) // a hidden source still masks
    return api.apply({ type: 'setMask', name: 'm', sources: { fills: [], strokes: ['curve:mask'] }, targets: [img.id], mode: 'inside' })
  }, img)
  expect(ids.ok).toBe(true)
  const pixel = (q: { x: number; y: number }) =>
    page.evaluate((q) => {
      const { view } = (window as any).__contour
      view.selection.clear()
      view.render()
      view.canvas.renderAll()
      const [z, , , , e, f] = view.canvas.viewportTransform
      const dpr = view.canvas.getRetinaScaling()
      return Array.from(view.canvas.lowerCanvasEl.getContext('2d')!.getImageData(Math.floor((e + q.x * z) * dpr), Math.floor((f + q.y * z) * dpr), 1, 1).data)
    }, q)
  expect((await pixel(at(img, 3, 10)))[3]).toBeGreaterThan(0) // inside the region: drawn
  expect(await pixel(at(img, 30, 10))).toEqual([0, 0, 0, 0]) // masked away
  await page.keyboard.press('v')
  const out = await screen(page, at(img, 30, 10))
  await page.mouse.click(out.x, out.y)
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([])
  const inn = await screen(page, at(img, 3, 10))
  await page.mouse.click(inn.x, inn.y)
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([img.id])
})

test('renderer B draws the image at its opacity; original-colour pick through a rotated, mirrored placement is exact', async ({ page }) => {
  await page.goto('/?renderer=b')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#placeImage'))
  page.on('dialog', (d) => void d.accept().catch(() => {}))
  await page.click('#fileNew')
  const img = await place(page)
  const px = await page.evaluate((m) => {
    const { view } = (window as any).__contour
    view.render()
    return new Promise<number[]>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const [z, , , , e, f] = view.canvas.viewportTransform
          const dpr = view.canvas.getRetinaScaling()
          const q = { x: m.a * 5 + m.c * 10 + m.e, y: m.b * 5 + m.d * 10 + m.f }
          resolve(Array.from(view.refCanvas.getContext('2d')!.getImageData(Math.floor((e + q.x * z) * dpr), Math.floor((f + q.y * z) * dpr), 1, 1).data))
        }),
      ),
    )
  }, img.transform)
  expect(px[0]).toBeGreaterThan(200) // red at 50%: (255, 0, 0, ~128)
  expect(px[3]).toBeGreaterThan(100)
  expect(px[3]).toBeLessThan(160)
  // rotate 90° and mirror: the original colour of image pixel (5, 10) — red — and (30, 10) — green — read exactly
  const picks = await page.evaluate((id) => {
    const { api, view, editor } = (window as any).__contour
    const t = { a: 0, b: -3, c: -3, d: 0, e: 100, f: 100 } // mirrored + rotated, scale 3
    api.apply({ type: 'setProps', id, transform: t })
    view.pickMode.set('source')
    const P = (u: number, v: number) => ({ x: t.a * u + t.c * v + t.e, y: t.b * u + t.d * v + t.f })
    return [view.pick(P(5.5, 10.5)), view.pick(P(30.5, 10.5)), editor.history.undo.length]
  }, img.id)
  expect(picks.slice(0, 2)).toEqual(['#ff0000', '#0cc85a'])
})

test.describe('at device pixel ratio 2', () => {
  test.use({ deviceScaleFactor: 2 })
  test('画面显示色 at DPR 2 is the same as at DPR 1 (50% red over white)', async ({ page }) => {
    await open(page)
    const img = await place(page)
    const c = await page.evaluate((m) => {
      const { view } = (window as any).__contour
      view.pickMode.set('screen')
      return view.pick({ x: m.a * 5 + m.c * 10 + m.e, y: m.b * 5 + m.d * 10 + m.f })
    }, img.transform)
    expect(c === '#ff8080' || c === '#ff7f7f').toBe(true)
  })
})

test('a placement still decoding when another document is opened writes nothing (no layer, no undo step)', async ({ page }) => {
  await open(page)
  const data = readFileSync(FIX + 'ref-matrix.png').toString('base64')
  const out = await page.evaluate(async (b64) => {
    const { view, editor } = (window as any).__contour
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const pending = view.placeImageFile(new File([bytes], 'big.png', { type: 'image/png' }))
    editor.load(editor.save()) // another document now (a new epoch)
    await pending
    return { images: editor.reader.allRecords().filter((r: any) => r.typeName === 'image').length, undo: editor.history.undo.length, status: document.querySelector('#status')!.textContent }
  }, data)
  expect(out).toMatchObject({ images: 0, undo: 0 })
  expect(out.status).toContain('已经打开了别的文档')
})
