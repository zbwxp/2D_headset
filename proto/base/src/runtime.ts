// Read-only evaluation entry (docs 16 §1: the maker, the customizer and the runtime share "how this
// face is computed"). Input: saved author data + parameters. No Editor, no transactions, no undo, no
// UI, no tldraw Store — a plain record map. It must give exactly the maker's results (tested), and it
// cannot write anything: it only reads the records it is given.
import { asCharacter, ctxOf, playCharacter, prepareCharacter } from './character'
import { evaluate, type Evaluated } from './evaluate'
import { graphProblems } from './model'
import { evaluateAtYaw } from './pose'
import { validateRecord, type BaseReader, type DocRecord } from './schema'

export type Saved = { store: Record<string, DocRecord> } | DocRecord[]

/**
 * A read-only reader over a plain record map (what a runtime loading an exported file would have). Only
 * a BaseReader: membership lookups on it scan its records (indexes.ts), nothing pretends to be a store.
 */
export function plainReader(saved: Saved): BaseReader {
  const records = Array.isArray(saved) ? saved : Object.values(saved.store)
  const byId = new Map<string, DocRecord>(records.map((r) => [r.id, r]))
  return {
    get: ((id: string) => byId.get(id)) as BaseReader['get'],
    allRecords: () => records,
  }
}

/**
 * Validate the data like `Editor.open` does, then evaluate at the given parameters. With a `character`, the family
 * curves are that character's prepared and played shapes (stage 3a, doc 18 §24); without one, the old evaluation.
 */
export function evaluateSaved(saved: Saved, params: { yaw?: number; character?: string; expr?: Record<string, number> } = {}): Evaluated {
  const reader = plainReader(saved)
  for (const r of reader.allRecords()) validateRecord(r as DocRecord)
  const problems = graphProblems(reader)
  if (problems.length) throw new Error(`invalid document: ${problems.join('; ')}`)
  const base = params.yaw === undefined ? evaluate(reader) : evaluateAtYaw(reader, params.yaw)
  if (!params.character) return base
  const p = prepareCharacter(ctxOf(reader), params.character)
  if (!p.ok) throw new Error(`character ${params.character} cannot be prepared: ${p.problems.join('; ')}`)
  const played = playCharacter(p.grid, { yaw: params.yaw, params: params.expr })
  if (!played.ok) throw new Error(`character ${params.character} cannot be played: ${played.problems.join('; ')}`)
  return asCharacter(reader, base, played)
}
