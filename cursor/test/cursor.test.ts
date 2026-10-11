// cursor/ (bowen 1791708333; docs/rename-and-cursor-plan.md §2): the table, and the package's boundary.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cursorFor } from '../index'

describe('cursorFor', () => {
  it('Pen and Fill show their pictures (pressed or not), each with a hotspot and a keyword fallback', () => {
    for (const [tool, hot] of [['pen', '2 2'], ['fill', '3 21']] as const) {
      for (const pressed of [false, true]) expect(cursorFor(tool, pressed)).toMatch(new RegExp(`^url\\("data:image/svg\\+xml,[^"]+"\\) ${hot}, crosshair$`))
    }
    expect(cursorFor('pen', false)).not.toBe(cursorFor('fill', false))
  })
  it('A and V: an open hand, closed while pressed; Z zooms', () => {
    expect(['A', 'V'].flatMap(t => [cursorFor(t, false), cursorFor(t, true)])).toEqual(['grab', 'grabbing', 'grab', 'grabbing'])
    expect([cursorFor('Z', false), cursorFor('Z', true)]).toEqual(['zoom-in', 'zoom-in'])
  })
  it('any other tool, an unknown name or an inherited property name: the default arrow', () => {
    for (const t of ['split', 'bind', 'join', 'link', '', 'nope', 'toString', '__proto__', 'constructor']) expect([t, cursorFor(t, false), cursorFor(t, true)]).toEqual([t, 'default', 'default'])
  })
  it('each SVG decodes to a well-formed picture', () => {
    for (const t of ['pen', 'fill']) {
      const src = decodeURIComponent(cursorFor(t, false).match(/^url\("data:image\/svg\+xml,([^"]+)"\)/)![1]!)
      expect(src).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="24" height="24"[^>]*>.*<\/svg>$/)
    }
  })
  it('imports nothing', () => {
    expect(readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')).not.toMatch(/^import /m)
  })
})
