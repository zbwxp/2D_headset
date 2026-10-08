import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Allowed module dependencies (README "Dependency direction").
const ALLOWED: Record<string, string[]> = {
  geometry: [],
  network: ['geometry'],
  groups: ['geometry', 'network'],
  joins: ['geometry', 'network'],
  links: ['geometry', 'network'],
  fills: ['geometry', 'network'],
  derived: ['geometry', 'network', 'joins', 'fills'],
  document: ['geometry', 'network', 'groups', 'joins', 'links', 'fills', 'derived'],
}

const SRC = join(__dirname, '..', 'src')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })
}

function imports(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)].map(m => m[1]!)
}

describe('module boundaries', () => {
  it('every module only imports allowed modules, and only through their index', () => {
    const problems: string[] = []
    for (const file of files(SRC)) {
      const rel = relative(SRC, file).split('/')
      const own = rel.length > 1 ? rel[0]! : '(root)'
      for (const spec of imports(file)) {
        if (!spec.startsWith('.')) continue
        const parts = spec.split('/')
        if (parts[0] === '.') continue // inside the same module
        if (own === '(root)') {
          if (!/^\.\/[a-z]+(\/index)?$/.test(spec)) problems.push(`${relative(SRC, file)} → ${spec}`)
          continue
        }
        // '../other' or '../other/index' only
        const target = parts[1]!
        const deep = parts.length > 3 || (parts.length === 3 && parts[2] !== 'index')
        if (deep) problems.push(`deep import ${relative(SRC, file)} → ${spec}`)
        if (!ALLOWED[own]?.includes(target)) problems.push(`direction ${own} → ${target} (${relative(SRC, file)})`)
      }
    }
    expect(problems).toEqual([])
  })

  it('the package root only exposes the document entry and public types', () => {
    const root = readFileSync(join(SRC, 'index.ts'), 'utf8')
    for (const spec of imports(join(SRC, 'index.ts'))) expect(spec).toMatch(/^\.\/[a-z]+$/)
    expect(root).toMatch(/document/)
  })
})
