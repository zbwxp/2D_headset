// Runs the compiler so the compile-time checks (test/encapsulation.typecheck.ts) are part of `vitest run`.
import { it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

it('tsc --noEmit passes (including every @ts-expect-error encapsulation check)', () => {
  const root = join(__dirname, '..')
  let output = ''
  try { execFileSync(join(root, 'node_modules/.bin/tsc'), ['--noEmit', '-p', root], { encoding: 'utf8' }) }
  catch (e) { output = String((e as { stdout?: string }).stdout ?? e) }
  expect(output).toBe('')
}, 60000)
