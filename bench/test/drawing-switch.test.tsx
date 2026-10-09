// The panel's own temporary state ends with its drawing (dot 1791551140): a rename draft or a
// dragged row started on one drawing is never applied to the next one, even when both have a
// layer with the same id. Real App, real Core, real interaction; jsdom events.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom's Blob has no text(); the app reads opened files with it
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))

async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host)
  await act(async () => { createRoot(host).render(<App />) })
  return host
}
const bench = () => (window as unknown as { bench: { core: Core } }).bench
async function openFile(host: HTMLElement, text: string) {
  const input = host.querySelector('input[type=file]') as HTMLInputElement
  const file = new File([text], 'other.json', { type: 'application/json' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
}
const nameSpans = (host: HTMLElement) => [...host.querySelectorAll('span[title="双击改名"]')] as HTMLElement[]

describe('switching drawings ends the panel’s temporary state', () => {
  it('a rename draft started on the old drawing is not written into the new one (both have layer-1)', async () => {
    const host = await mount()
    await act(async () => { nameSpans(host)[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const draft = [...host.querySelectorAll('input')].find(i => i.style.background === 'rgb(30, 30, 30)')!
    expect(draft).toBeDefined()
    const other = Core.newDocument() // also has layer-1, named "Layer 1"
    await openFile(host, save(other))
    // the draft field is gone with the old drawing
    expect([...host.querySelectorAll('input')].some(i => i.style.background === 'rgb(30, 30, 30)')).toBe(false)
    // and an Enter on the old field writes nothing anywhere
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(draft, 'old draft')
    await act(async () => { draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(bench().core.snapshot().layers.map(l => l.name)).toEqual(['Layer 1'])
  })

  it('a row drag started on the old drawing does not reorder the new one', async () => {
    const host = await mount()
    await act(async () => { bench().core.edit(e => e.layer('B', 'B')); (window as unknown as { bench: { refresh: () => void } }).bench.refresh() })
    const other = Core.newDocument(); other.edit(e => e.layer('B', 'B'))
    const rows = () => [...host.querySelectorAll('div[draggable="true"]')] as HTMLElement[]
    await act(async () => { rows()[1]!.dispatchEvent(new Event('dragstart', { bubbles: true })) })
    await openFile(host, save(other))
    await act(async () => { rows()[0]!.dispatchEvent(new Event('drop', { bubbles: true })) })
    expect(bench().core.snapshot().layers.map(l => l.id)).toEqual(['layer-1', 'B'])
  })

  it('an open that fails keeps the current drawing and the panel’s draft', async () => {
    const host = await mount()
    const before = bench().core
    await act(async () => { nameSpans(host)[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    await openFile(host, '{not a drawing')
    expect(bench().core).toBe(before)
    expect([...host.querySelectorAll('input')].some(i => i.style.background === 'rgb(30, 30, 30)')).toBe(true)
  })
})
