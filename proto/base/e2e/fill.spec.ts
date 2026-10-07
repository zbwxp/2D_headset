// New document and the Live Paint Bucket (doc 18 §30.11) through real clicks in Chromium.
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#modeK'))
}
async function click(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  await page.mouse.click(box.x + e + p.x * z, box.y + f + p.y * z)
}
const records = (page: Page, type: string) => page.evaluate((t) => (window as any).__contour.editor.reader.allRecords().filter((r: any) => r.typeName === t), type)
const undoLabels = (page: Page) => page.evaluate(() => (window as any).__contour.editor.history.undo as string[])

test('新建 → a blank document with one layer (asks first when there are unsaved changes); draw a closed path, K fills it as its own attribute in the toolbar colour, just below the line, one undo step; panels, 无, V selects the path', async ({ page }) => {
  await open(page)
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setProps', id: 'container:L1', name: 'x' })) // unsaved change
  page.once('dialog', (d) => d.accept())
  await page.click('#fileNew')
  const layers = await records(page, 'container')
  expect(layers.map((l: any) => l.name)).toEqual(['图层 1'])
  expect(await records(page, 'curve')).toEqual([])
  await expect(page.locator('#fileName')).toHaveText('未命名')
  expect(await undoLabels(page)).toEqual([])
  // a closed triangle with the pen
  await page.keyboard.press('p')
  for (const p of [{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 50, y: 70 }, { x: 20, y: 10 }]) await click(page, p)
  const [curve] = await records(page, 'curve')
  expect(curve.closed).toBe(true)
  // K with a chosen colour
  await page.locator('#fillColor').fill('#3366cc')
  await page.keyboard.press('k')
  await click(page, { x: 50, y: 30 })
  // one closed path: the fill is the path's own attribute (doc 18 §30.18) — no group; the path is selected
  const [fill] = await records(page, 'fill')
  expect((await records(page, 'container')).length).toBe(1)
  expect(fill).toMatchObject({ color: '#3366cc', parentId: layers[0].id, owner: { kind: 'path', curveId: curve.id } })
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([curve.id])
  const order = await page.evaluate(() => (window as any).__contour.editor.derived.evaluated().paint.map((p: any) => p.item.address))
  expect(order).toEqual([fill.id, curve.id]) // just below its path
  expect(await undoLabels(page)).toEqual(['createCurve', 'paintRegion'])
  // the same area again recolours it (no second fill)
  await page.locator('#fillColor').fill('#cc3333')
  await click(page, { x: 50, y: 30 })
  expect((await records(page, 'fill')).map((f: any) => f.color)).toEqual(['#cc3333'])
  // outside any area: said, nothing written
  await click(page, { x: 120, y: 100 })
  await expect(page.locator('#status')).toContainText('没有被线围起来的区域')
  expect(await undoLabels(page)).toEqual(['createCurve', 'paintRegion', 'paintRegion'])
  // panels: no row of its own; the path's properties show 填充 with 无
  await expect(page.locator(`[data-id="${fill.id}"]`)).toHaveCount(0)
  await expect(page.locator(`#propsPanel [data-path-fill="${fill.id}"]`)).toHaveCount(1)
  // 无: the fill stays as colourless (its area kept, not drawn); 填充 colours it again; ⌘Z steps back
  await page.click('#propsPanel [data-path-fill-none]')
  expect((await records(page, 'fill')).map((f: any) => [f.id, f.color])).toEqual([[fill.id, 'none']])
  expect(await records(page, 'curve')).toHaveLength(1)
  await page.locator('#fillColor').fill('#22aa22')
  await page.click('#propsPanel [data-path-fill-paint]')
  expect((await records(page, 'fill')).map((f: any) => [f.id, f.color])).toEqual([[fill.id, '#22aa22']])
  await page.keyboard.press('Meta+z')
  await page.keyboard.press('Meta+z')
  expect((await records(page, 'fill')).map((f: any) => [f.id, f.color])).toEqual([[fill.id, '#cc3333']])
  // V on the fill selects the path
  await page.keyboard.press('v')
  await click(page, { x: 120, y: 100 })
  await click(page, { x: 50, y: 40 })
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([curve.id])
})

test('K on the example jaw: the existing fill F is recoloured (refused while its layer is locked)', async ({ page }) => {
  await open(page)
  await page.keyboard.press('k')
  await click(page, { x: 30, y: 50 })
  await expect(page.locator('#status')).toContainText('LOCKED')
  await page.click('#unlock')
  await page.locator('#fillColor').fill('#00aa00')
  await click(page, { x: 30, y: 50 })
  expect((await records(page, 'fill')).map((f: any) => [f.id, f.color])).toEqual([['fill:F', '#00aa00']])
})

test('select a closed line, 填充 in the properties panel: its own fill in the toolbar colour, under the line, one step; an open line is refused with the reason', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]')
  await page.keyboard.press('p')
  for (const p of [{ x: 100, y: 10 }, { x: 140, y: 10 }, { x: 120, y: 40 }, { x: 100, y: 10 }]) await click(page, p)
  const [curve] = await page.evaluate(() => (window as any).__contour.selection.get())
  await page.locator('#fillColor').fill('#123456')
  await page.click('#propsPanel #makeFill')
  const fill = (await records(page, 'fill')).find((f: any) => f.id !== 'fill:F')
  expect(fill).toMatchObject({ color: '#123456', parentId: 'container:L1', owner: { kind: 'path', curveId: curve } })
  expect(fill.boundary.map((b: any) => b.curveId)).toEqual([curve, curve, curve])
  expect((await undoLabels(page)).at(-1)).toBe('paintRegion')
  await page.click('[data-id="curve:E1"]') // an open line
  await page.click('#propsPanel #makeFill')
  await expect(page.locator('#status')).toContainText('没有围成闭合轮廓')
})

test('K inside three separate lines: a 形状 group holds them and the face; the panels; ungroup refused while it has a colour; pulled apart + 清除 + K colours the same face (dot 1791358732)', async ({ page }) => {
  await open(page)
  await page.click('#fileNew')
  const layer = (await records(page, 'container'))[0].id
  await page.evaluate((L) => {
    const { api } = (window as any).__contour
    const a = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
    const line = (n: string, i: string, p: [number, number], q: [number, number]) => api.apply({ type: 'createCurve', id: `curve:${n}`, parentId: L, index: i, anchors: { p: a('p', ...p), q: a('q', ...q) }, segments: [{ id: 's', from: 'p', to: 'q' }] })
    line('a', 'a1', [20, 10], [80, 10])
    line('b', 'a2', [80, 10], [50, 70])
    line('c', 'a3', [50, 70], [20, 10])
  }, layer)
  expect((await records(page, 'curve')).length).toBe(3)
  await page.locator('#fillColor').fill('#3366cc')
  await page.keyboard.press('k')
  await click(page, { x: 50, y: 30 })
  const [fill] = await records(page, 'fill')
  const shape = (await records(page, 'container')).find((c: any) => c.shape)
  expect(shape).toMatchObject({ name: '形状', parentId: layer })
  expect(fill).toMatchObject({ color: '#3366cc', parentId: shape.id })
  expect(fill.owner).toBeUndefined()
  for (const c of await records(page, 'curve')) expect(c.parentId).toBe(shape.id)
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([shape.id])
  expect((await undoLabels(page)).at(-1)).toBe('paintRegion')
  // panels: a 形状 row, no face row; the shape's faces in its properties
  await expect(page.locator(`[data-id="${shape.id}"] .kind`)).toHaveAttribute('title', '形状')
  await expect(page.locator(`[data-id="${fill.id}"]`)).toHaveCount(0)
  await expect(page.locator(`#propsPanel [data-face="${fill.id}"]`)).toHaveCount(1)
  // ungroup refused while it has a face
  await page.click('#ungroupSel')
  await expect(page.locator('#status')).toContainText('先在属性里清除')
  // dot 1791358732: pull a's end away from b's start (A drag; the face keeps a bridge there), 清除, then K inside:
  // the SAME face is coloured again
  await page.keyboard.press('a')
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  await page.click(`[data-id="${layer}"]`) // nothing of the shape selected: A drags the anchor under the pointer
  await page.mouse.move(box.x + e + 80 * z, box.y + f + 10 * z)
  await page.mouse.down()
  await page.mouse.move(box.x + e + 86 * z, box.y + f + 4 * z, { steps: 4 })
  await page.mouse.up()
  const a = (await records(page, 'curve')).find((c: any) => c.id === 'curve:a')
  const b = (await records(page, 'curve')).find((c: any) => c.id === 'curve:b')
  expect(a.anchors.q.p.x !== b.anchors.p.p.x || a.anchors.q.p.y !== b.anchors.p.p.y).toBe(true) // no longer meet
  await page.click(`[data-id="${shape.id}"]`)
  await page.click(`#propsPanel [data-face="${fill.id}"] [data-face-clear]`)
  expect((await records(page, 'fill')).map((x: any) => [x.id, x.color])).toEqual([[fill.id, 'none']])
  for (const c of await records(page, 'curve')) expect(c.parentId).toBe(shape.id)
  await expect(page.locator(`#propsPanel [data-face="${fill.id}"]`)).toContainText('无')
  await page.locator('#fillColor').fill('#aa2222')
  await page.keyboard.press('k')
  await click(page, { x: 50, y: 30 })
  expect((await records(page, 'fill')).map((x: any) => [x.id, x.color])).toEqual([[fill.id, '#aa2222']])
  // ⌘Z: colourless again, then back to the colour before the clear
  await page.keyboard.press('Meta+z')
  expect((await records(page, 'fill')).map((x: any) => x.color)).toEqual(['none'])
  await page.keyboard.press('Meta+z')
  expect((await records(page, 'fill')).map((x: any) => x.color)).toEqual(['#3366cc'])
})

test('K never reaches through what is drawn in front (dot 1791359954): a blue fill covering a small one is the one recoloured; locked, the click is refused and the small one stays', async ({ page }) => {
  await open(page)
  await page.click('#fileNew')
  const L1 = (await records(page, 'container'))[0].id
  const ids = await page.evaluate((L) => {
    const { api } = (window as any).__contour
    const a = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
    api.apply({ type: 'createContainer', id: 'container:F', parentId: null, name: '前景' })
    const sq = (id: string, parent: string, x0: number, y0: number, x1: number, y1: number) =>
      api.apply({ type: 'createCurve', id, parentId: parent, anchors: { a: a('a', x0, y0), b: a('b', x1, y0), c: a('c', x1, y1), d: a('d', x0, y1) }, segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }, { id: 's3', from: 'c', to: 'd' }, { id: 's4', from: 'd', to: 'a' }], closed: true })
    sq('curve:small', L, 40, 30, 60, 50)
    sq('curve:big', 'container:F', 10, 10, 90, 70)
    const steps = (c: string) => ['s1', 's2', 's3', 's4'].map((s) => ({ curveId: c, segmentId: s, dir: 1 }))
    const small = api.apply({ type: 'paintRegion', boundary: steps('curve:small'), color: '#ff0000' })
    const big = api.apply({ type: 'paintRegion', boundary: steps('curve:big'), color: '#0000ff' })
    return { small: small.affected[1] as string, big: big.affected[1] as string }
  }, L1)
  const color = async (id: string) => (await records(page, 'fill')).find((f: any) => f.id === id)?.color
  expect(await color(ids.small)).toBe('#ff0000')
  await page.locator('#fillColor').fill('#00aa00')
  await page.keyboard.press('k')
  await click(page, { x: 50, y: 40 }) // inside both; the blue one is drawn in front
  expect(await color(ids.big)).toBe('#00aa00')
  expect(await color(ids.small)).toBe('#ff0000')
  // locked front layer: refused, nothing behind changes (also when the small one is colourless)
  for (const behind of ['#ff0000', 'none']) {
    await page.evaluate(([id, c]) => (window as any).__contour.api.apply({ type: 'setProps', id, color: c }), [ids.small, behind])
    await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setContainerFlags', containerId: 'container:F', locked: true }))
    const steps = (await undoLabels(page)).length
    await page.locator('#fillColor').fill('#123456')
    await click(page, { x: 50, y: 40 })
    await expect(page.locator('#status')).toContainText('LOCKED')
    expect(await color(ids.small)).toBe(behind)
    expect(await color(ids.big)).toBe('#00aa00')
    expect((await undoLabels(page)).length).toBe(steps)
    await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setContainerFlags', containerId: 'container:F', locked: false }))
  }
})

test('dot 1791361223 ① / 1791362995: a front fill masked away at the click — coloured or colourless — is not there; K colours what is drawn behind it, locked or not', async ({ page }) => {
  await open(page)
  await page.click('#fileNew')
  const L1 = (await records(page, 'container'))[0].id
  const ids = await page.evaluate((L) => {
    const { api } = (window as any).__contour
    const a = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
    api.apply({ type: 'createContainer', id: 'container:F', parentId: null, name: '前景' })
    const sq = (id: string, parent: string, x0: number, y0: number, x1: number, y1: number) =>
      api.apply({ type: 'createCurve', id, parentId: parent, anchors: { a: a('a', x0, y0), b: a('b', x1, y0), c: a('c', x1, y1), d: a('d', x0, y1) }, segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }, { id: 's3', from: 'c', to: 'd' }, { id: 's4', from: 'd', to: 'a' }], closed: true })
    // behind: a big square; in front: a small square inside it whose fill (and line) a mask hides at the click
    sq('curve:big', L, 10, 10, 90, 70)
    sq('curve:small', 'container:F', 40, 30, 60, 50)
    api.apply({ type: 'createCurve', id: 'curve:far', parentId: 'container:F', anchors: { p: a('p', 150, 150), q: a('q', 160, 150) }, segments: [{ id: 's', from: 'p', to: 'q' }] })
    const steps = (c: string) => ['s1', 's2', 's3', 's4'].map((s) => ({ curveId: c, segmentId: s, dir: 1 }))
    const rb = api.apply({ type: 'paintRegion', boundary: steps('curve:big'), color: '#0000ff' })
    const rs = api.apply({ type: 'paintRegion', boundary: steps('curve:small'), color: '#ff0000' })
    if (!rb.ok || !rs.ok) throw new Error(JSON.stringify([rb, rs]))
    const big = rb.affected[1] as string, small = rs.affected[1] as string
    // shown only inside the far line's ink: the small fill and its line are not drawn at the click
    api.apply({ type: 'setMask', name: 'm', sources: { fills: [], strokes: ['curve:far'] }, targets: ['curve:small', small], mode: 'inside' })
    return { small, big }
  }, L1)
  const color = async (id: string) => (await records(page, 'fill')).find((f: any) => f.id === id)?.color
  await page.keyboard.press('k')
  // the masked front fill coloured or colourless (dot 1791362995: the same mask test for both), unlocked or locked
  for (const front of ['#ff0000', 'none'])
    for (const [lock, c] of [[false, '#00aa00'], [true, '#aa00aa']] as const) {
      await page.evaluate(([id, col, l]) => {
        const { api } = (window as any).__contour
        api.apply({ type: 'setContainerFlags', containerId: 'container:F', locked: false })
        api.apply({ type: 'setProps', id, color: col })
        api.apply({ type: 'setContainerFlags', containerId: 'container:F', locked: l })
      }, [ids.small, front, lock] as const)
      await page.locator('#fillColor').fill(c)
      await click(page, { x: 50, y: 40 })
      expect(await color(ids.big), `front ${front}, locked ${lock}`).toBe(c) // what is drawn there
      expect(await color(ids.small), `front ${front}, locked ${lock}`).toBe(front) // masked away there: not coloured, not blocking
    }
})
