// archive — save a drawing to text and open it again (graph "Save and open": an
// independent module; docs/archive-plan.md). The drawing is saved; the selection and the
// undo history are not. Opening makes a new document, so a refused file never touches
// the current one.
import { exportState, importState, type Core } from '../document'

export const FORMAT = 'headset-v3-drawing'
/**
 * Format versions (docs/archive-plan.md "Format versions"); older ones are refused, with no migration:
 * - 1: single view; not supported (bowen 1791651929).
 * - 2: shape layers, nine views (stage 1); not supported since 3 (dot 1791680650).
 * - 3: plus animation's owned record layer `base:angle` (stage 2); `copyNew` only on owned layers.
 */
export const VERSION = 3

export function save(core: Core): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, document: exportState(core) })
}

export function open(text: string): Core {
  let file: unknown
  try { file = JSON.parse(text) } catch { throw new Error('open-failed: not a drawing file (not JSON)') }
  const f = file as { format?: unknown; version?: unknown; document?: unknown } | null
  if (!f || f.format !== FORMAT) throw new Error('open-failed: not a headset v3 drawing')
  if (f.version !== VERSION) throw new Error(`open-failed: unsupported version ${String(f.version)}`)
  return importState(f.document)
}
