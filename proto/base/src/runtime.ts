// Read-only evaluation entry (docs 16 §1: the maker, the customizer and the runtime share "how this
// face is computed"). Input: saved author data + parameters. No Editor, no transactions, no undo, no
// UI, no tldraw Store — a plain record map. It must give exactly the maker's results (tested), and it
// cannot write anything: it only reads the records it is given.
import { evaluate, type Evaluated } from './evaluate'
import { graphProblems } from './model'
import { evaluateAtYaw } from './pose'
import { validateRecord, type DocReader, type DocRecord } from './schema'

export type Saved = { store: Record<string, DocRecord> } | DocRecord[]

/** A read-only reader over a plain record map (what a runtime loading an exported file would have). */
export function plainReader(saved: Saved): DocReader {
  const records = Array.isArray(saved) ? saved : Object.values(saved.store)
  const byId = new Map<string, DocRecord>(records.map((r) => [r.id, r]))
  const unsupported = (name: string) => () => {
    throw new Error(`read-only runtime reader: ${name} is not available`)
  }
  return {
    get: ((id: string) => byId.get(id)) as DocReader['get'],
    allRecords: () => records,
    getStoreSnapshot: unsupported('getStoreSnapshot') as DocReader['getStoreSnapshot'],
    serialize: unsupported('serialize') as DocReader['serialize'],
    query: undefined as unknown as DocReader['query'], // the full evaluation needs no indexes
  }
}

/** Validate the data like `Editor.open` does, then evaluate at the given parameters. */
export function evaluateSaved(saved: Saved, params: { yaw?: number } = {}): Evaluated {
  const reader = plainReader(saved)
  for (const r of reader.allRecords()) validateRecord(r as DocRecord)
  const problems = graphProblems(reader)
  if (problems.length) throw new Error(`invalid document: ${problems.join('; ')}`)
  return params.yaw === undefined ? evaluate(reader) : evaluateAtYaw(reader, params.yaw)
}
