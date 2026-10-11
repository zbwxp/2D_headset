// The pose-pad package's boundary (docs/pose-pad-plan.md): React only; it knows nothing of the drawing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('pose-pad package boundary', () => {
  it('imports only React', () => {
    expect([...readFileSync(join(__dirname, '..', 'index.tsx'), 'utf8').matchAll(/from '([^']+)'/g)].map(m => m[1])).toEqual(['react'])
  })
})
