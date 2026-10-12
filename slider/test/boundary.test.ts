// The slider package's boundary (docs/slider-plan.md): React and move/ only; it knows nothing of the drawing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('slider package boundary', () => {
  it('imports only React and move/', () => {
    expect([...readFileSync(join(__dirname, '..', 'index.tsx'), 'utf8').matchAll(/from '([^']+)'/g)].map(m => m[1])).toEqual(['react', '../move'])
  })
})
