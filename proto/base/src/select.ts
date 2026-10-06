// Stage 4 (doc 18 §21.2): what a pick selects. A hit through a reference instance selects on the PLACEMENT side —
// the container chain of the reference record — never the container of the source curve (dot 1791304319 point 3).
// Entering a reference to edit its source is a separate, explicit action (not here).
import type { Hit } from './evaluate'
import type { BaseReader, DocRecord } from './schema'

/** The top-level container a V-mode pick selects (one group per top-level container). */
export function topContainerOfHit(reader: Pick<BaseReader, 'get'>, hit: Hit): string | undefined {
  const start = hit.kind === 'fill' ? hit.address : hit.referenceId ?? hit.curveId
  let rec = reader.get(start as any) as DocRecord | undefined
  let top: string | undefined
  while (rec && 'parentId' in rec && rec.parentId) {
    top = rec.parentId
    rec = reader.get(rec.parentId as any) as DocRecord | undefined
  }
  return top
}
