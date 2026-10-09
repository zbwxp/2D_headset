// The visual package's boundary (docs/visual-plan.md).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')
const files = (dir: string, ext: RegExp) => readdirSync(join(root, dir), { recursive: true }).map(String).filter(f => ext.test(f) && !f.startsWith('test') && !f.includes('node_modules'))
const specs = (path: string) => [...readFileSync(path, 'utf8').matchAll(/from '([^']+)'/g)].map(m => m[1]!)

describe('visual package boundary', () => {
  it('imports only core’s package root (as types), React, or its own files', () => {
    for (const f of files('visual', /\.(ts|tsx)$/)) {
      const text = readFileSync(join(root, 'visual', f), 'utf8')
      for (const s of specs(join(root, 'visual', f))) expect(s === '../src' || s === 'react' || s.startsWith('./'), `${f}: ${s}`).toBe(true)
      for (const line of text.split('\n').filter(l => l.includes("from '../src'"))) expect(line.startsWith('import type'), `${f}: ${line}`).toBe(true)
    }
  })
  it('core and interaction never import it', () => {
    for (const dir of ['src', 'interaction']) for (const f of files(dir, /\.ts$/)) {
      expect(specs(join(root, dir, f)).some(s => s.includes('visual')), `${dir}/${f}`).toBe(false)
    }
  })
})
