import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import ts from 'typescript'

// Allowed module dependencies (README "Dependency direction").
const ALLOWED: Record<string, string[]> = {
  geometry: [],
  network: ['geometry'],
  groups: ['geometry', 'network'],
  joins: ['geometry', 'network'],
  links: ['geometry', 'network'],
  fills: ['geometry', 'network'],
  derived: ['geometry', 'network', 'joins', 'fills'],
  locks: ['network', 'joins', 'links'],
  editing: ['geometry', 'network', 'groups', 'fills'],
  apply: ['geometry', 'network', 'groups', 'joins', 'links', 'fills'],
  document: ['geometry', 'network', 'groups', 'joins', 'links', 'fills', 'derived', 'locks', 'editing', 'apply'],
}
// External packages each module may use.
const EXTERNAL: Record<string, string[]> = { geometry: ['bezier-js'] }

const SRC = join(__dirname, '..', 'src')

/**
 * Every module specifier in a source text, read from the TypeScript syntax tree
 * (dot 1791427941): import / export-from (incl. type-only), import = require,
 * dynamic import() and require(). A non-literal dynamic specifier is reported.
 */
function specifiers(text: string): string[] {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: string[] = []
  const literal = (n: ts.Node | undefined) =>
    n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      out.push(literal(node.moduleSpecifier) ?? '<non-literal>')
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      out.push(literal(node.moduleReference.expression) ?? '<non-literal>')
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword
      const req = ts.isIdentifier(callee) && callee.text === 'require'
      if (dynamic || req) out.push(literal(node.arguments[0]) ?? '<non-literal>')
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      out.push(literal(node.argument.literal) ?? '<non-literal>')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Runtime (non-type) names the package root exports; `export *` is reported as '*'. */
function rootRuntimeExports(text: string): string[] {
  const sf = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names: string[] = []
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue
      if (!st.exportClause) { names.push('*'); continue }
      if (ts.isNamespaceExport(st.exportClause)) { names.push(st.exportClause.name.text); continue }
      if (ts.isNamedExports(st.exportClause)) for (const el of st.exportClause.elements) if (!el.isTypeOnly) names.push(el.name.text)
    } else if (ts.isExportAssignment(st)) {
      names.push('default')
    } else if (ts.canHaveModifiers(st) && ts.getModifiers(st)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      names.push(ts.isVariableStatement(st) ? 'variable' : (st as { name?: ts.Identifier }).name?.text ?? 'default')
    }
  }
  return names
}

/** Problems in one source file (path relative to src), judged on the resolved target path. */
export function check(fileRel: string, text: string): string[] {
  const problems: string[] = []
  const parts = fileRel.split('/')
  const own = parts.length > 1 ? parts[0]! : '(root)'
  if (own !== '(root)' && !ALLOWED[own]) problems.push(`unknown module folder ${own}`)
  for (const spec of specifiers(text)) {
    if (spec === '<non-literal>') { problems.push(`${fileRel}: computed module path`); continue }
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

  it('the package root exports exactly one runtime value, Core; everything else is types', () => {
    const root = readFileSync(join(SRC, 'index.ts'), 'utf8')
    expect(rootRuntimeExports(root)).toEqual(['Core'])
    expect(rootRuntimeExports(`export * from './network'`)).toEqual(['*'])
    expect(rootRuntimeExports(`export { create } from './network'\nexport type { Vec } from './geometry'`)).toEqual(['create'])
    expect(rootRuntimeExports(`export * as network from './network'`)).toEqual(['network'])
    expect(rootRuntimeExports(`export default 42`)).toEqual(['default'])
    expect(rootRuntimeExports(`export default class X {}`)).toEqual(['X'])
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
    ['network/index.ts', `import{Core}from'../document'`, /direction network → document/],
    ['network/index.ts', `const m = await import(/* note */ '../document')`, /direction network → document/],
    ['network/index.ts', `const m = await import('../' + name)`, /computed module path/],
    ['network/index.ts', `import x = require('../fills')`, /direction network → fills/],
    ['network/index.ts', `let t: import('../fills').FillsState`, /direction network → fills/],
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
