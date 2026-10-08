import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'

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
// External packages each module may use.
const EXTERNAL: Record<string, string[]> = { geometry: ['bezier-js'] }

const SRC = join(__dirname, '..', 'src')

/** Every module specifier in a source text: static import/export, dynamic import(), require(). */
function specifiers(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]!)
  for (const m of text.matchAll(/import\s*['"]([^'"]+)['"]/g)) out.push(m[1]!)
  for (const m of text.matchAll(/(?:import|require)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) out.push(m[1]!)
  return out
}

/** Problems in one source file (path relative to src), judged on the resolved target path. */
export function check(fileRel: string, text: string): string[] {
  const problems: string[] = []
  const parts = fileRel.split('/')
  const own = parts.length > 1 ? parts[0]! : '(root)'
  if (own !== '(root)' && !ALLOWED[own]) problems.push(`unknown module folder ${own}`)
  for (const spec of specifiers(text)) {
    if (!spec.startsWith('.')) {
      if (own === '(root)' || !(EXTERNAL[own] ?? []).includes(spec)) problems.push(`external ${spec} not allowed in ${own}`)
      continue
    }
    const target = relative(SRC, resolve(dirname(join(SRC, fileRel)), spec)).split('/')
    if (target[0] === '..' || !target[0]) { problems.push(`${fileRel} → ${spec} leaves src`); continue }
    const mod = target[0]!
    const deep = target.length > 2 || (target.length === 2 && target[1] !== 'index' && target[1] !== 'index.ts')
    if (own === '(root)') {
      if (deep) problems.push(`root deep import ${spec}`)
      continue
    }
    if (mod === own) continue // inside the same module
    if (deep) problems.push(`deep import ${fileRel} → ${spec}`)
    if (!ALLOWED[own]?.includes(mod)) problems.push(`direction ${own} → ${mod} (${fileRel}: ${spec})`)
  }
  return problems
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('module boundaries', () => {
  it('the real sources respect every boundary', () => {
    const problems = files(SRC).flatMap(f => check(relative(SRC, f), readFileSync(f, 'utf8')))
    expect(problems).toEqual([])
  })

  it('the package root only exposes the document entry and public types', () => {
    const root = readFileSync(join(SRC, 'index.ts'), 'utf8')
    for (const spec of specifiers(root)) expect(spec).toMatch(/^\.\/[a-z]+$/)
    expect(root).toMatch(/document/)
  })
})

describe('the boundary checker catches deliberate violations (dot 1791427048)', () => {
  const cases: [string, string, RegExp][] = [
    ['network/index.ts', `import * as j from '../joins'`, /direction network → joins/],
    ['network/index.ts', `import * as j from './../joins/index'`, /direction network → joins/],
    ['groups/index.ts', `import * as f from '../network/../fills/index'`, /direction groups → fills/],
    ['derived/index.ts', `import { x } from '../joins/internal'`, /deep import/],
    ['joins/index.ts', `const m = await import('../links')`, /direction joins → links/],
    ['links/index.ts', `const m = require('../fills')`, /direction links → fills/],
    ['fills/index.ts', `import 'bezier-js'`, /external bezier-js/],
    ['fills/index.ts', `export { y } from '../groups'`, /direction fills → groups/],
    ['network/index.ts', `import x from '../../test/helper'`, /leaves src/],
  ]
  for (const [file, text, expected] of cases) {
    it(`${file}: ${text}`, () => {
      expect(check(file, text).join('\n')).toMatch(expected)
    })
  }
  it('allowed imports stay clean', () => {
    expect(check('derived/index.ts', `import * as n from '../network'\nimport * as j from '../joins/index'`)).toEqual([])
    expect(check('geometry/index.ts', `import { Bezier } from 'bezier-js'`)).toEqual([])
  })
})
