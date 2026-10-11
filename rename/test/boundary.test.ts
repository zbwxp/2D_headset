// The rename package's boundary (docs/rename-and-cursor-plan.md §1): React only; it knows nothing of core.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('rename package boundary', () => {
  it('imports only React', () => {
    const text = readFileSync(join(__dirname, '..', 'index.tsx'), 'utf8')
    expect([...text.matchAll(/from '([^']+)'/g)].map(m => m[1])).toEqual(['react'])
  })
})
