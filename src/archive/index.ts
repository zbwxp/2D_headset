// archive — save a drawing to text and open it again (graph "Save and open": an
// independent module; docs/archive-plan.md). The drawing is saved; the selection and the
// undo history are not. Opening makes a new document, so a refused file never touches
// the current one.
import { exportState, importState, fromV5, fromV6, type Core } from '../document'
export const FORMAT = 'headset-v3-drawing'
/**
 * Format versions (docs/archive-plan.md "Format versions"); older ones are refused, with no migration:
 * - 1: single view; not supported (bowen 1791651929).
 * - 2: shape layers, nine views (stage 1); not supported since 3 (dot 1791680650).
 * - 3: plus animation's owned record layer `base:angle` (stage 2); `copyNew` only on owned layers; not supported since 4.
 * - 4: plus the in-between responses (`animation`, stage 3b package 2); not supported since 5.
 * - 5: plus reference pictures (`reference`, docs/reference-images-plan.md); converted once to 6 when opened —
 *   the one exception, for version 5 only (bowen 1791726456: "可以 仅此一次 一般不需要支持前代").
 * - 6: reference pictures in a library, each picture's content once (docs/reference-images-plan.md §10);
 *   converted once to 7 when opened — the second approved exception (bowen 1791808493): a point with
 *   exactly two line ends and no join gets a 'bound' join (docs/ink-joins-principle.md §2.6).
 * - 7: binding is a join ('bound'); each point's joins are an ordered list (docs/j1-joins-checklist.md); read as it is
 *   (a 7 file is an 8 file without end widths) — an older program must refuse an 8 file rather than drop its widths
 *   (dot 1791819678).
 * - 8: a line's two end widths (`stroke.widthB`, docs/two-end-widths-checklist.md, bowen 1791818995).
 */
export const VERSION = 8

export function save(core: Core): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, document: exportState(core) })
}

export function open(text: string): Core {
  let file: unknown
  try { file = JSON.parse(text) } catch { throw new Error('open-failed: not a drawing file (not JSON)') }
  const f = file as { format?: unknown; version?: unknown; document?: unknown } | null
  if (!f || f.format !== FORMAT) throw new Error('open-failed: not a headset v3 drawing')
  if (f.version === 5) return importState(fromV6(fromV5(f.document)))
  if (f.version === 6) return importState(fromV6(f.document))
  if (f.version === 7) return importState(f.document)
  if (f.version !== VERSION) throw new Error(`open-failed: unsupported version ${String(f.version)}`)
  return importState(f.document)
}
