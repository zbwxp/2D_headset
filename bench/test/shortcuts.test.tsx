// Shortcuts are never blocked by a focused button (bowen 1791556992). One App in this file:
// every mounted App listens to keys on the window. Real App, real Core; jsdom events.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Core } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
type B = { core: Core; ix: { tool: string; setTool(t: string): void } }
const bench = () => (window as unknown as { bench: B }).bench
const keyOn = (target: EventTarget, key: string, meta = false) => target.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: meta, bubbles: true }))

describe('a focused button never blocks a shortcut (bowen 1791556992)', () => {
  it('after clicking Flip, V and A switch tools; after clicking Zoom, ⌘Z undoes; a text field keeps its keys', async () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    await act(async () => { createRoot(host).render(<App />) })
    const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
    const flip = button('Flip')
    await act(async () => { flip.focus(); flip.click() })
    await act(async () => { keyOn(flip, 'a') })
    expect(bench().ix.tool).toBe('A')
    await act(async () => { keyOn(flip, 'v') })
    expect(bench().ix.tool).toBe('V')

    await act(async () => { bench().core.edit(e => e.line('s', { id: 's1', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 's2', layer: 'layer-1', position: { x: 10, y: 0 } })) })
    await act(async () => { bench().core.edit(e => e.translate(5, 0, [{ kind: 'line', id: 's' }])) })
    const zoom = button('Zoom Z')
    await act(async () => { zoom.focus(); zoom.click() })
    await act(async () => { keyOn(zoom, 'z', true) })
    expect(bench().core.snapshot().points.find(p => p.id === 's1')!.position).toEqual({ x: 0, y: 0 })

    const field = [...host.querySelectorAll('input')].find(i => i.type !== 'file')!
    await act(async () => { field.focus(); keyOn(field, 'a') })
    expect(bench().ix.tool).toBe('V')
  })
})
