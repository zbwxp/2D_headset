// 录制标准 / 捏脸 and standards in the bench (B3; docs/bone-lines-checklist.md §6b): the mode switch, 存为标准 with 覆盖
// confirmed by a second press, 用标准 per layer, 删除 only when unused, 从文件导入标准 showing the target layer and importing
// + choosing in one edit (one undo), and off the front in 捏脸 a bone says where it comes from and refuses a drag.
// jsdom only: real mouse checks are listed in the hand-in.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
let n = 0
type B = { core: Core; ix: { setTool(t: string): void }; refresh(): void; chooseView(k: string): void }
const bench = () => (window as unknown as { bench: B }).bench
const P = (x: number, y = 0) => ({ x, y })
function pe(type: string, x: number, y: number, buttons: number) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e
}

/** Bones U (上骨) and D (下骨) sharing their ends, in a layer of this test's own (眼k), placed at its own height. */
function eye(e: Parameters<Parameters<Core['edit']>[0]>[0], L: string, Y: number, k: string) {
  e.layer(L, `眼${k}`)
  e.line(`U${k}`, { id: `i${k}`, layer: L, position: P(0, Y) }, { id: `o${k}`, layer: L, position: P(40, Y) }, { ha: P(10, -12), hb: P(-10, -12) })
  e.line(`D${k}`, `i${k}`, `o${k}`, { ha: P(10, 8), hb: P(-10, 8) })
  e.renameLine(`U${k}`, '上骨'); e.renameLine(`D${k}`, '下骨')
}
let last: { root: ReturnType<typeof createRoot>; host: HTMLElement } | null = null
async function setup() {
  const k = String(++n), Y = 400 * Number(k), L = `L${k}`
  if (last) { const l = last; await act(async () => { l.root.unmount() }); l.host.remove() }
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  last = { root, host }
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => eye(e, L, Y, k))
    bench().core.edit(e => e.markBone([`U${k}`, `D${k}`]))
    bench().ix.setTool('V'); bench().refresh()
  })
  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
  const click = async (sel: string) => { await act(async () => { q(sel)!.click() }) }
  const type = async (sel: string, v: string) => { const el = q(sel) as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
  const choose = async (sel: string, v: string) => { const el = q(sel) as HTMLSelectElement; await act(async () => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })) }) }
  const file = async (sel: string, name: string, text: string) => {
    const input = q(sel) as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([text], name, { type: 'application/json' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
  }
  return { host, svg, k, Y, L, q, click, type, choose, file }
}
const snap = () => bench().core.snapshot()
const sideOf = (id: string, view = 'view:90,0') => JSON.stringify(bench().core.in(view).snapshot().lines.find(l => l.id === id))

describe('录制标准 / 捏脸 in the bench', () => {
  it('the mode switch: 捏脸 and back; the status line says 捏脸', async () => {
    const t = await setup()
    await t.click('[data-testid="bone-mode-make"]')
    expect(snap().boneMode).toBe('make')
    expect(t.host.textContent).toContain('· 捏脸')
    await t.click('[data-testid="bone-mode-record"]')
    expect(snap().boneMode).toBe('record')
  })

  it('存为标准: saved under its name; the same name again asks 覆盖 first and only a second press overwrites', async () => {
    const t = await setup()
    await t.type(`[data-std-name="${t.L}"]`, 'S')
    await t.click(`[data-std-save="${t.L}"]`)
    const saved = bench().core.standardsData().filter(x => x.layer === t.L)
    expect(saved.map(x => x.name)).toEqual(['S'])
    // a side bone changed in 录制标准, then 存为标准 under the same name
    await act(async () => { bench().core.editIn('view:90,0', e => e.moveHandle(`U${t.k}`, 'a', P(3, -14))); bench().refresh() })
    expect(t.q(`[data-std-save="${t.L}"]`)!.textContent).toBe('覆盖「S」…')
    await t.click(`[data-std-save="${t.L}"]`)
    expect(JSON.stringify(bench().core.standardsData().filter(x => x.layer === t.L))).toBe(JSON.stringify(saved))
    expect(t.q(`[data-std-save="${t.L}"]`)!.textContent).toBe('确认覆盖「S」')
    await t.click(`[data-std-save="${t.L}"]`)
    const now = bench().core.standardsData().filter(x => x.layer === t.L)
    expect(now.map(x => x.id)).toEqual(saved.map(x => x.id))
    expect(JSON.stringify(now)).not.toBe(JSON.stringify(saved))
  })

  it('用标准 per layer shows the pairs; a used standard cannot be removed; (不用) frees it and 删除 removes it', async () => {
    const t = await setup()
    await t.type(`[data-std-name="${t.L}"]`, 'S'); await t.click(`[data-std-save="${t.L}"]`)
    const id = snap().standards.find(x => x.layer === t.L)!.id
    await t.choose(`[data-std-use="${t.L}"]`, id)
    expect(snap().standardChoices.find(c => c.layer === t.L)?.standard).toBe(id)
    expect(t.q(`[data-std-pairs="${t.L}"]`)!.textContent).toBe('匹配 2 / 2 根')
    expect((t.q(`[data-std-remove="${id}"]`) as HTMLButtonElement).disabled).toBe(true)
    await t.choose(`[data-std-use="${t.L}"]`, '')
    await t.click(`[data-std-remove="${id}"]`)
    expect(snap().standards.some(x => x.id === id)).toBe(false)
  })

  it('从文件导入标准: the target layer shown (the same-named layer); imported and chosen in one edit — one undo takes both back', async () => {
    const t = await setup()
    const other = Core.newDocument({ layer: { id: 'X', name: 'X' } })
    other.edit(e => eye(e, 'Lo', t.Y, t.k)); other.edit(e => e.markBone([`U${t.k}`, `D${t.k}`]))
    other.editIn('view:90,0', e => e.moveHandle(`U${t.k}`, 'a', P(2, -15)))
    other.edit(e => e.saveStandard('Lo', '默认眼'))
    await t.file('[data-testid="std-import-file"]', 'default.json', save(other))
    expect(t.q('[data-testid="std-import-target"]')!.textContent).toBe(`放到同名图层「眼${t.k}」`)
    const before = save(bench().core)
    await t.click('[data-testid="std-import-go"]')
    expect(t.q('[data-testid="std-import"]')).toBeNull()
    const std = snap().standards.find(x => x.layer === t.L && x.name === '默认眼')!
    expect(snap().standardChoices.find(c => c.layer === t.L)).toEqual({ layer: t.L, standard: std.id, pairs: [{ bone: `D${t.k}`, key: `D${t.k}` }, { bone: `U${t.k}`, key: `U${t.k}` }] })
    await act(async () => { bench().core.undo(); bench().refresh() })
    expect(save(bench().core)).toBe(before)
  })

  it('从文件导入标准 with no same-named layer: into the current layer, said before importing; a same name asks 覆盖 first', async () => {
    const t = await setup()
    const other = Core.newDocument({ layer: { id: 'X', name: 'X' } })
    other.edit(e => eye(e, 'Lo', 0, 'z')); other.edit(e => e.markBone(['Uz', 'Dz']))
    other.edit(e => e.saveStandard('Lo', 'S'))
    await t.file('[data-testid="std-import-file"]', 'other.json', save(other))
    expect(t.q('[data-testid="std-import-target"]')!.textContent).toMatch(/^没有同名图层「眼z」，放到当前层「/)
    await t.click('[data-testid="std-import-cancel"]')
    expect(t.q('[data-testid="std-import"]')).toBeNull()
    // same-named layer, and a standard of that name already there: 覆盖 asked first
    const again = Core.newDocument({ layer: { id: 'X', name: 'X' } })
    // recorded where this eye is (a standard carries a face drawn near its own 0,0 bones)
    again.edit(e => eye(e, 'Lo', t.Y, t.k)); again.edit(e => e.markBone([`U${t.k}`, `D${t.k}`])); again.edit(e => e.saveStandard('Lo', 'S'))
    await t.type(`[data-std-name="${t.L}"]`, 'S'); await t.click(`[data-std-save="${t.L}"]`)
    const mine = JSON.stringify(bench().core.standardsData().filter(x => x.layer === t.L))
    await t.file('[data-testid="std-import-file"]', 'again.json', save(again))
    expect(t.q('[data-testid="std-import-go"]')!.textContent).toBe('覆盖「S」并选用…')
    await t.click('[data-testid="std-import-go"]')
    expect(JSON.stringify(bench().core.standardsData().filter(x => x.layer === t.L))).toBe(mine)
    await t.click('[data-testid="std-import-go"]')
    expect(snap().standards.filter(x => x.layer === t.L).length).toBe(1)
    expect(snap().standardChoices.find(c => c.layer === t.L)?.standard).toBe(snap().standards.find(x => x.layer === t.L)!.id)
  })

  it('捏脸, off the front: a bone says where it comes from; dragging it there is refused and nothing changes', async () => {
    const t = await setup()
    await t.type(`[data-std-name="${t.L}"]`, 'S'); await t.click(`[data-std-save="${t.L}"]`)
    await t.choose(`[data-std-use="${t.L}"]`, snap().standards.find(x => x.layer === t.L)!.id)
    await t.click('[data-testid="bone-mode-make"]')
    await act(async () => { bench().chooseView('view:90,0'); bench().ix.setTool('A'); bench().refresh() })
    expect(t.q(`[data-bone="U${t.k}"] title`)?.textContent).toBe('来自标准「S」（在录制标准里改）')
    const text = save(bench().core), u = sideOf(`U${t.k}`)
    const o = bench().core.in('view:90,0').snapshot().points.find(p => p.id === `o${t.k}`)!.position
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', o.x, o.y, 1)); window.dispatchEvent(pe('pointermove', o.x + 9, o.y - 9, 1)); window.dispatchEvent(pe('pointerup', o.x + 9, o.y - 9, 0)) })
    expect(sideOf(`U${t.k}`)).toBe(u)
    expect(save(bench().core)).toBe(text)
    // no standard chosen: still refused off the front in 捏脸, and the hover says why
    await t.choose(`[data-std-use="${t.L}"]`, '')
    expect(t.q(`[data-bone="U${t.k}"] title`)?.textContent).toBe('捏脸：这一层没有选标准；侧面骨骼回录制标准改')
  })
})
